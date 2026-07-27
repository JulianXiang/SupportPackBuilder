import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Material, MaterialSource, Project } from '../../shared/schemas/project-schema.js'
import type {
  DuplicateResolution,
  ImportAnalysis,
  ImportCandidate,
  ImportCommitInput,
  ImportCommitResult,
} from '../../shared/types/import.js'
import { copyAssetIntoProject } from './project-service.js'
import { validateSourceFile } from './validation-service.js'

type PendingImport = {
  analysis: ImportAnalysis
  createdAt: number
}

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp'])
const TEN_MINUTES = 10 * 60 * 1000

const allProjectMaterials = (project: Project): Material[] =>
  project.outlineNodes.flatMap((node) => node.children.flatMap((child) => child.materials))

export const scanImportDirectory = async (directory: string): Promise<string[]> => {
  const discovered: string[] = []
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile() && ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        discovered.push(path)
      }
    }
  }
  await visit(directory)
  return discovered.sort((left, right) =>
    left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' }),
  )
}

export class ImportService {
  readonly #pending = new Map<string, PendingImport>()

  async analyze(project: Project, paths: string[]): Promise<ImportAnalysis> {
    this.#pruneExpired()
    const existingMaterials = allProjectMaterials(project)
    const candidates: ImportCandidate[] = []
    for (const path of paths) {
      try {
        const validated = await validateSourceFile(path)
        const duplicateMaterialIds = existingMaterials
          .filter((material) =>
            material.sourceItems.some(
              (source) =>
                source.fileHash === validated.source.fileHash ||
                (source.fileSize === validated.source.fileSize &&
                  source.originalFileName === validated.source.originalFileName),
            ),
          )
          .map((material) => material.id)
        candidates.push({
          id: crypto.randomUUID(),
          originalPath: path,
          originalFileName: validated.source.originalFileName,
          sourceType: validated.sourceType,
          fileHash: validated.source.fileHash,
          fileSize: validated.source.fileSize,
          modifiedTime: validated.source.modifiedTime,
          mimeType: validated.source.mimeType,
          pageCount: validated.source.pageCount,
          ...(validated.source.width ? { width: validated.source.width } : {}),
          ...(validated.source.height ? { height: validated.source.height } : {}),
          ...(validated.source.exifOrientation
            ? { exifOrientation: validated.source.exifOrientation }
            : {}),
          validationStatus: validated.validationStatus,
          validationMessages: validated.validationMessages,
          duplicateMaterialIds,
        })
      } catch (error) {
        candidates.push({
          id: crypto.randomUUID(),
          originalPath: path,
          originalFileName: basename(path),
          sourceType: extname(path).toLowerCase() === '.pdf' ? 'pdf' : 'image',
          fileHash: '0'.repeat(64),
          fileSize: 0,
          modifiedTime: 0,
          mimeType: 'application/octet-stream',
          pageCount: 1,
          validationStatus: 'error',
          validationMessages: [
            {
              code: 'import-validation-failed',
              severity: 'error',
              message: error instanceof Error ? error.message : '文件校验失败。',
              suggestion: '请确认文件完整、可读且格式与扩展名一致。',
            },
          ],
          duplicateMaterialIds: [],
        })
      }
    }
    const token = crypto.randomUUID()
    const analysis: ImportAnalysis = {
      token,
      candidates,
      expiresAt: new Date(Date.now() + TEN_MINUTES).toISOString(),
    }
    this.#pending.set(token, { analysis, createdAt: Date.now() })
    return analysis
  }

  async commit(
    projectDirectory: string,
    project: Project,
    input: ImportCommitInput,
  ): Promise<ImportCommitResult> {
    this.#pruneExpired()
    const pending = this.#pending.get(input.token)
    if (!pending) throw new Error('导入会话已过期，请重新选择文件。')
    this.#pending.delete(input.token)

    const target = project.outlineNodes
      .flatMap((node) => node.children)
      .find((node) => node.id === input.targetOutlineNodeId)
    if (!target) throw new Error('未找到目标二级目录。')
    const resolutionMap = new Map(
      input.resolutions.map((resolution) => [resolution.candidateId, resolution]),
    )
    const accepted = pending.analysis.candidates.filter((candidate) => {
      if (candidate.validationStatus === 'error' || candidate.validationStatus === 'encrypted') {
        return false
      }
      const resolution = resolutionMap.get(candidate.id)
      if (candidate.duplicateMaterialIds.length > 0 && !resolution) {
        throw new Error(`重复文件《${candidate.originalFileName}》尚未选择处理方式。`)
      }
      return resolution?.action !== 'skip' && resolution?.action !== 'replace'
    })
    const importedMaterialIds: string[] = []
    const replacedMaterialIds: string[] = []
    let skippedCount = pending.analysis.candidates.filter((candidate) => {
      const action = resolutionMap.get(candidate.id)?.action
      return (
        candidate.validationStatus === 'error' ||
        candidate.validationStatus === 'encrypted' ||
        action === 'skip'
      )
    }).length
    const createdMaterials: Material[] = []

    const createSource = async (candidate: ImportCandidate): Promise<MaterialSource> => {
      const sourceId = crypto.randomUUID()
      const storedPath =
        project.assetStorageMode === 'copy'
          ? await copyAssetIntoProject(projectDirectory, candidate.originalPath, sourceId)
          : null
      return {
        id: sourceId,
        sourcePath: storedPath ?? candidate.originalPath,
        storedPath,
        originalFileName: candidate.originalFileName,
        fileHash: candidate.fileHash,
        fileSize: candidate.fileSize,
        modifiedTime: candidate.modifiedTime,
        mimeType: candidate.mimeType,
        pageCount: candidate.pageCount,
        ...(candidate.width ? { width: candidate.width } : {}),
        ...(candidate.height ? { height: candidate.height } : {}),
        ...(candidate.exifOrientation ? { exifOrientation: candidate.exifOrientation } : {}),
      }
    }

    const createMaterial = (
      candidates: ImportCandidate[],
      sources: MaterialSource[],
      sourceType: Material['sourceType'],
    ): Material => {
      const now = new Date().toISOString()
      const firstCandidate = candidates[0]
      const firstSource = sources[0]
      if (!firstCandidate || !firstSource) throw new Error('材料来源不能为空。')
      const compositeHash = createHash('sha256')
        .update(sources.map((source) => source.fileHash).join(':'))
        .digest('hex')
      const pageOrder = sources.flatMap((source) =>
        Array.from({ length: source.pageCount }, (_, pageIndex) => `${source.id}:${pageIndex}`),
      )
      return {
        id: crypto.randomUUID(),
        outlineNodeId: target.id,
        title:
          sourceType === 'imageCollection'
            ? `图片材料（${sources.length} 张）`
            : basename(firstCandidate.originalFileName, extname(firstCandidate.originalFileName)),
        category: target.title,
        sourceType,
        sourcePath: firstSource.sourcePath,
        storedPath: firstSource.storedPath,
        originalFileName:
          sourceType === 'imageCollection'
            ? `${firstSource.originalFileName} 等 ${sources.length} 张图片`
            : firstSource.originalFileName,
        fileHash: sources.length === 1 ? firstSource.fileHash : compositeHash,
        fileSize: sources.reduce((total, source) => total + source.fileSize, 0),
        modifiedTime: Math.max(...sources.map((source) => source.modifiedTime)),
        pageCount: sources.reduce((total, source) => total + source.pageCount, 0),
        selectedPageRanges: 'all',
        pageOrder,
        rotationByPage: {},
        removedPages: [],
        enabled: true,
        startOnNewPage: true,
        insertTitlePage: false,
        notes: '',
        validationStatus: candidates.some((candidate) => candidate.validationStatus === 'warning')
          ? 'warning'
          : 'valid',
        validationMessages: candidates.flatMap((candidate) => candidate.validationMessages),
        order: target.materials.length + createdMaterials.length,
        createdAt: now,
        updatedAt: now,
        sourceItems: sources,
      }
    }

    const imageCandidates = accepted.filter((candidate) => candidate.sourceType === 'image')
    const pdfCandidates = accepted.filter((candidate) => candidate.sourceType === 'pdf')
    if (input.imageGrouping === 'collection' && imageCandidates.length > 1) {
      const sources: MaterialSource[] = []
      for (const candidate of imageCandidates) sources.push(await createSource(candidate))
      createdMaterials.push(createMaterial(imageCandidates, sources, 'imageCollection'))
      importedMaterialIds.push(createdMaterials.at(-1)?.id ?? '')
    } else {
      for (const candidate of imageCandidates) {
        const source = await createSource(candidate)
        const material = createMaterial([candidate], [source], 'image')
        createdMaterials.push(material)
        importedMaterialIds.push(material.id)
      }
    }
    for (const candidate of pdfCandidates) {
      const source = await createSource(candidate)
      const material = createMaterial([candidate], [source], 'pdf')
      createdMaterials.push(material)
      importedMaterialIds.push(material.id)
    }

    const updatedProject = structuredClone(project)
    const replaceResolutions = input.resolutions.filter(
      (resolution): resolution is Extract<DuplicateResolution, { action: 'replace' }> =>
        resolution.action === 'replace',
    )
    for (const resolution of replaceResolutions) {
      const candidate = pending.analysis.candidates.find(
        (item) => item.id === resolution.candidateId,
      )
      if (!candidate || candidate.validationStatus === 'error') continue
      const replacementExists = allProjectMaterials(updatedProject).some(
        (material) => material.id === resolution.materialId,
      )
      if (!replacementExists) {
        skippedCount += 1
        continue
      }
      const source = await createSource(candidate)
      updatedProject.outlineNodes = updatedProject.outlineNodes.map((node) => ({
        ...node,
        children: node.children.map((child) => ({
          ...child,
          materials: child.materials.map((material) => {
            if (material.id !== resolution.materialId) return material
            const replacement = createMaterial(
              [candidate],
              [source],
              candidate.sourceType === 'pdf' ? 'pdf' : 'image',
            )
            return {
              ...replacement,
              id: material.id,
              outlineNodeId: material.outlineNodeId,
              title: material.title,
              category: material.category,
              notes: material.notes,
              order: material.order,
              createdAt: material.createdAt,
            }
          }),
        })),
      }))
      replacedMaterialIds.push(resolution.materialId)
    }

    updatedProject.outlineNodes = updatedProject.outlineNodes.map((node) => ({
      ...node,
      children: node.children.map((child) =>
        child.id === target.id
          ? {
              ...child,
              materials: [...child.materials, ...createdMaterials],
            }
          : child,
      ),
    }))
    updatedProject.updatedAt = new Date().toISOString()
    return {
      project: updatedProject,
      importedMaterialIds: importedMaterialIds.filter(Boolean),
      skippedCount,
      replacedMaterialIds,
    }
  }

  #pruneExpired(): void {
    const cutoff = Date.now() - TEN_MINUTES
    for (const [token, pending] of this.#pending) {
      if (pending.createdAt < cutoff) this.#pending.delete(token)
    }
  }
}
