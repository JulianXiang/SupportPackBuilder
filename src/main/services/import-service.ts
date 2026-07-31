import { createHash } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type {
  Material,
  MaterialSource,
  Project,
  ValidationMessage,
} from '../../shared/schemas/project-schema.js'
import type {
  DuplicateResolution,
  ImportAnalysis,
  ImportAnalysisProgress,
  ImportCandidate,
  ImportCommitInput,
  ImportCommitResult,
  OfficeReconversionResult,
} from '../../shared/types/import.js'
import type { OfficeConversionResult } from './file-conversion-adapter.js'
import { ConversionManager } from './conversion-manager.js'
import {
  copyAssetIntoProject,
  copyConversionSnapshotIntoProject,
  replaceConversionSnapshotAtomically,
  resolveMaterialSourcePath,
} from './project-service.js'
import { validateSourceFile } from './validation-service.js'

type PendingImport = {
  analysis: ImportAnalysis
  createdAt: number
  temporaryDirectory: string
  officeSnapshots: Map<string, OfficeConversionResult>
}

type AnalyzeOptions = {
  projectDirectory: string
  onProgress?: (progress: ImportAnalysisProgress) => void
}

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.docx',
  '.pptx',
  '.xlsx',
])
const TEN_MINUTES = 10 * 60 * 1000

const allProjectMaterials = (project: Project): Material[] =>
  project.outlineNodes.flatMap((node) => node.children.flatMap((child) => child.materials))

const isCancellation = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('取消')

const officeConversionMessages = (
  fileName: string,
  conversion: OfficeConversionResult,
): ValidationMessage[] =>
  conversion.warnings.map((message, index) => ({
    code: `office-conversion-${index + 1}`,
    severity: 'warning',
    message: `文件《${fileName}》：${message}`,
    suggestion: '请在中间预览区检查转换页面，必要时调整原 Office 文件后重新转换。',
  }))

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
  readonly #active = new Map<string, AbortController>()
  readonly #conversionManager: ConversionManager

  constructor(conversionManager: ConversionManager) {
    this.#conversionManager = conversionManager
  }

  async analyze(
    project: Project,
    paths: string[],
    options: AnalyzeOptions,
  ): Promise<ImportAnalysis> {
    await this.#pruneExpired()
    const taskId = crypto.randomUUID()
    const temporaryDirectory = join(options.projectDirectory, 'temp', `import-${taskId}`)
    await mkdir(join(options.projectDirectory, 'temp'), { recursive: true })
    await mkdir(temporaryDirectory, { recursive: false })
    const controller = new AbortController()
    this.#active.set(taskId, controller)
    const existingMaterials = allProjectMaterials(project)
    const candidates: ImportCandidate[] = []
    const officeSnapshots = new Map<string, OfficeConversionResult>()
    const totalFiles = paths.length
    const emitProgress = (
      stageLabel: string,
      currentFile: string,
      processedFiles: number,
      percentage: number,
    ): void => {
      options.onProgress?.({
        taskId,
        stageLabel,
        currentFile,
        processedFiles,
        totalFiles,
        percentage: Math.max(0, Math.min(100, Math.round(percentage))),
        cancellable: true,
      })
    }

    emitProgress('正在准备文件检查', '', 0, 0)
    try {
      for (const [pathIndex, path] of paths.entries()) {
        if (controller.signal.aborted) throw new Error('用户取消了导入分析。')
        const fileName = basename(path)
        const candidateId = crypto.randomUUID()
        emitProgress(
          '正在检查文件格式与完整性',
          fileName,
          pathIndex,
          (pathIndex / Math.max(1, totalFiles)) * 100,
        )
        try {
          const validated = await validateSourceFile(path)
          let conversion: OfficeConversionResult | undefined
          if (validated.sourceType === 'office') {
            if (!validated.officeFormat) throw new Error('Office 文件缺少可识别的格式信息。')
            const workingDirectory = join(temporaryDirectory, candidateId)
            await mkdir(workingDirectory, { recursive: true })
            conversion = await this.#conversionManager.convert({
              sourcePath: path,
              officeFormat: validated.officeFormat,
              workingDirectory,
              hasPrintSettings: validated.officeHasPrintSettings ?? false,
              signal: controller.signal,
              onProgress: (stageLabel, localPercentage) => {
                emitProgress(
                  stageLabel,
                  fileName,
                  pathIndex,
                  ((pathIndex + localPercentage / 100) / Math.max(1, totalFiles)) * 100,
                )
              },
            })
            officeSnapshots.set(candidateId, conversion)
          }
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
          const conversionMessages = conversion
            ? officeConversionMessages(fileName, conversion)
            : []
          const validationMessages = [...validated.validationMessages, ...conversionMessages]
          candidates.push({
            id: candidateId,
            originalPath: path,
            originalFileName: validated.source.originalFileName,
            sourceType: validated.sourceType,
            ...(validated.officeFormat ? { officeFormat: validated.officeFormat } : {}),
            fileHash: validated.source.fileHash,
            fileSize: validated.source.fileSize,
            modifiedTime: validated.source.modifiedTime,
            mimeType: validated.source.mimeType,
            pageCount: conversion?.pageCount ?? validated.source.pageCount,
            ...(validated.source.width ? { width: validated.source.width } : {}),
            ...(validated.source.height ? { height: validated.source.height } : {}),
            ...(validated.source.exifOrientation
              ? { exifOrientation: validated.source.exifOrientation }
              : {}),
            validationStatus: validationMessages.some((message) => message.severity === 'warning')
              ? 'warning'
              : validated.validationStatus,
            validationMessages,
            duplicateMaterialIds,
            ...(conversion
              ? {
                  conversion: {
                    adapterId: conversion.adapterId,
                    engineVersion: conversion.engineVersion,
                    officeFormat: conversion.officeFormat,
                    fileHash: conversion.fileHash,
                    fileSize: conversion.fileSize,
                    pageCount: conversion.pageCount,
                    convertedAt: conversion.convertedAt,
                    warnings: conversion.warnings,
                  },
                }
              : {}),
          })
        } catch (error) {
          if (isCancellation(error)) throw error
          const extension = extname(path).toLowerCase()
          const sourceType =
            extension === '.pdf'
              ? 'pdf'
              : ['.docx', '.pptx', '.xlsx'].includes(extension)
                ? 'office'
                : 'image'
          candidates.push({
            id: candidateId,
            originalPath: path,
            originalFileName: fileName,
            sourceType,
            ...(sourceType === 'office'
              ? { officeFormat: extension.slice(1) as 'docx' | 'pptx' | 'xlsx' }
              : {}),
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
                message: error instanceof Error ? error.message : '文件校验或转换失败。',
                suggestion: '请确认文件完整、未加密、可读，且格式与扩展名一致。',
              },
            ],
            duplicateMaterialIds: [],
          })
        }
        emitProgress(
          '已完成当前文件检查',
          fileName,
          pathIndex + 1,
          ((pathIndex + 1) / Math.max(1, totalFiles)) * 100,
        )
      }
      const token = crypto.randomUUID()
      const analysis: ImportAnalysis = {
        taskId,
        token,
        candidates,
        expiresAt: new Date(Date.now() + TEN_MINUTES).toISOString(),
      }
      this.#pending.set(token, {
        analysis,
        createdAt: Date.now(),
        temporaryDirectory,
        officeSnapshots,
      })
      emitProgress('导入检查完成', '', totalFiles, 100)
      return analysis
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    } finally {
      this.#active.delete(taskId)
    }
  }

  async cancelAnalysis(identifier: string): Promise<void> {
    const active = this.#active.get(identifier)
    if (active) {
      active.abort()
      return
    }
    const pending = this.#pending.get(identifier)
    if (pending) {
      this.#pending.delete(identifier)
      await rm(pending.temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async commit(
    projectDirectory: string,
    project: Project,
    input: ImportCommitInput,
  ): Promise<ImportCommitResult> {
    await this.#pruneExpired()
    const pending = this.#pending.get(input.token)
    if (!pending) throw new Error('导入会话已过期，请重新选择文件。')

    try {
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
        const snapshot = pending.officeSnapshots.get(candidate.id)
        const conversionStoredPath = snapshot
          ? await copyConversionSnapshotIntoProject(
              projectDirectory,
              snapshot.pdfPath,
              sourceId,
              candidate.originalFileName,
            )
          : null
        return {
          id: sourceId,
          sourceType: candidate.sourceType,
          sourcePath: storedPath ?? candidate.originalPath,
          storedPath,
          originalFileName: candidate.originalFileName,
          fileHash: candidate.fileHash,
          fileSize: candidate.fileSize,
          modifiedTime: candidate.modifiedTime,
          mimeType: candidate.mimeType,
          pageCount: candidate.pageCount,
          selectedPageRanges: 'all',
          ...(candidate.width ? { width: candidate.width } : {}),
          ...(candidate.height ? { height: candidate.height } : {}),
          ...(candidate.exifOrientation ? { exifOrientation: candidate.exifOrientation } : {}),
          ...(snapshot && conversionStoredPath
            ? {
                conversion: {
                  adapterId: snapshot.adapterId,
                  engineVersion: snapshot.engineVersion,
                  officeFormat: snapshot.officeFormat,
                  pdfStoredPath: conversionStoredPath,
                  sourceFileHash: candidate.fileHash,
                  fileHash: snapshot.fileHash,
                  fileSize: snapshot.fileSize,
                  pageCount: snapshot.pageCount,
                  convertedAt: snapshot.convertedAt,
                  snapshotStatus: 'ready' as const,
                  warnings: snapshot.warnings,
                },
              }
            : {}),
        }
      }

      const createMaterial = (
        candidates: ImportCandidate[],
        sources: MaterialSource[],
        sourceType: Material['sourceType'],
        groupedTitle?: string,
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
            groupedTitle ??
            (sourceType === 'imageCollection'
              ? `图片材料（${sources.length} 张）`
              : basename(
                  firstCandidate.originalFileName,
                  extname(firstCandidate.originalFileName),
                )),
          category: target.title,
          sourceType,
          sourcePath: firstSource.sourcePath,
          storedPath: firstSource.storedPath,
          originalFileName:
            sources.length > 1
              ? `${firstSource.originalFileName} 等 ${sources.length} 个文件`
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
          startPolicy: 'newSheet',
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
      const officeCandidates = accepted.filter((candidate) => candidate.sourceType === 'office')
      if (input.materialGrouping === 'singleResult' && accepted.length > 1) {
        const sources: MaterialSource[] = []
        for (const candidate of accepted) sources.push(await createSource(candidate))
        const sourceType: Material['sourceType'] = accepted.every(
          (candidate) => candidate.sourceType === 'image',
        )
          ? 'imageCollection'
          : 'mixed'
        createdMaterials.push(
          createMaterial(accepted, sources, sourceType, input.groupedMaterialTitle),
        )
        importedMaterialIds.push(createdMaterials.at(-1)?.id ?? '')
      } else {
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
        for (const candidate of officeCandidates) {
          const source = await createSource(candidate)
          if (!source.conversion) {
            throw new Error(`Office 文件《${candidate.originalFileName}》缺少转换快照。`)
          }
          const material = createMaterial([candidate], [source], 'office')
          createdMaterials.push(material)
          importedMaterialIds.push(material.id)
        }
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
                candidate.sourceType === 'pdf'
                  ? 'pdf'
                  : candidate.sourceType === 'office'
                    ? 'office'
                    : 'image',
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
    } finally {
      this.#pending.delete(input.token)
      await rm(pending.temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async reconvertOffice(
    projectDirectory: string,
    project: Project,
    materialId: string,
    sourceId: string | undefined,
    confirmPageReset: boolean,
  ): Promise<OfficeReconversionResult> {
    const material = allProjectMaterials(project).find((candidate) => candidate.id === materialId)
    if (!material) {
      throw new Error('未找到可重新转换的 Office 材料。')
    }
    const source = sourceId
      ? material.sourceItems.find((candidate) => candidate.id === sourceId)
      : material.sourceItems.find((candidate) => candidate.sourceType === 'office')
    const previousConversion = source?.conversion
    if (source?.sourceType !== 'office' || !previousConversion) {
      throw new Error(`Office 材料《${material.title}》缺少原件或转换快照记录。`)
    }
    const sourcePath = resolveMaterialSourcePath(projectDirectory, material, source.id)
    const validated = await validateSourceFile(sourcePath)
    if (validated.sourceType !== 'office' || !validated.officeFormat) {
      throw new Error(`文件《${source.originalFileName}》已不再是受支持的 Office 文件。`)
    }
    const temporaryDirectory = join(
      projectDirectory,
      'temp',
      `reconvert-${materialId}-${crypto.randomUUID()}`,
    )
    await mkdir(temporaryDirectory, { recursive: false })
    const controller = new AbortController()
    try {
      const conversion = await this.#conversionManager.convert({
        sourcePath,
        officeFormat: validated.officeFormat,
        workingDirectory: temporaryDirectory,
        hasPrintSettings: validated.officeHasPrintSettings ?? false,
        signal: controller.signal,
      })
      const pageCountChanged = conversion.pageCount !== previousConversion.pageCount
      if (pageCountChanged && !confirmPageReset) {
        return {
          status: 'confirmation-required',
          previousPageCount: previousConversion.pageCount,
          pageCount: conversion.pageCount,
        }
      }
      await replaceConversionSnapshotAtomically(
        projectDirectory,
        previousConversion.pdfStoredPath,
        conversion.pdfPath,
      )
      const updatedProject = structuredClone(project)
      const updatedMaterial = allProjectMaterials(updatedProject).find(
        (candidate) => candidate.id === materialId,
      )
      const updatedSource = updatedMaterial?.sourceItems.find(
        (candidate) => candidate.id === source.id,
      )
      if (!updatedMaterial || !updatedSource) throw new Error('重新转换后无法更新材料记录。')
      updatedSource.originalFileName = validated.source.originalFileName
      updatedSource.fileHash = validated.source.fileHash
      updatedSource.fileSize = validated.source.fileSize
      updatedSource.modifiedTime = validated.source.modifiedTime
      updatedSource.mimeType = validated.source.mimeType
      updatedSource.pageCount = conversion.pageCount
      updatedSource.conversion = {
        adapterId: conversion.adapterId,
        engineVersion: conversion.engineVersion,
        officeFormat: conversion.officeFormat,
        pdfStoredPath: previousConversion.pdfStoredPath,
        sourceFileHash: validated.source.fileHash,
        fileHash: conversion.fileHash,
        fileSize: conversion.fileSize,
        pageCount: conversion.pageCount,
        convertedAt: conversion.convertedAt,
        snapshotStatus: 'ready',
        warnings: conversion.warnings,
      }
      if (updatedMaterial.sourceItems.length === 1) {
        updatedMaterial.fileHash = validated.source.fileHash
        updatedMaterial.fileSize = validated.source.fileSize
        updatedMaterial.modifiedTime = validated.source.modifiedTime
        updatedMaterial.pageCount = conversion.pageCount
      } else {
        updatedMaterial.fileHash = createHash('sha256')
          .update(updatedMaterial.sourceItems.map((item) => item.fileHash).join(':'))
          .digest('hex')
        updatedMaterial.fileSize = updatedMaterial.sourceItems.reduce(
          (total, item) => total + item.fileSize,
          0,
        )
        updatedMaterial.modifiedTime = Math.max(
          ...updatedMaterial.sourceItems.map((item) => item.modifiedTime),
        )
        updatedMaterial.pageCount = updatedMaterial.sourceItems.reduce(
          (total, item) => total + (item.conversion?.pageCount ?? item.pageCount),
          0,
        )
      }
      updatedMaterial.validationMessages = [
        ...validated.validationMessages,
        ...officeConversionMessages(updatedSource.originalFileName, conversion),
      ]
      updatedMaterial.validationStatus = updatedMaterial.validationMessages.some(
        (message) => message.severity === 'warning',
      )
        ? 'warning'
        : 'valid'
      if (pageCountChanged) {
        updatedSource.selectedPageRanges = 'all'
        if (updatedMaterial.sourceItems.length === 1) {
          updatedMaterial.selectedPageRanges = 'all'
        }
        const sourcePrefix = `${updatedSource.id}:`
        const firstSourcePosition = updatedMaterial.pageOrder.findIndex((id) =>
          id.startsWith(sourcePrefix),
        )
        const remainingOrder = updatedMaterial.pageOrder.filter(
          (id) => !id.startsWith(sourcePrefix),
        )
        const replacementOrder = Array.from(
          { length: conversion.pageCount },
          (_, pageIndex) => `${updatedSource.id}:${pageIndex}`,
        )
        remainingOrder.splice(
          firstSourcePosition < 0 ? remainingOrder.length : firstSourcePosition,
          0,
          ...replacementOrder,
        )
        updatedMaterial.pageOrder = remainingOrder
        updatedMaterial.rotationByPage = Object.fromEntries(
          Object.entries(updatedMaterial.rotationByPage).filter(
            ([pageId]) => !pageId.startsWith(sourcePrefix),
          ),
        )
        updatedMaterial.removedPages = updatedMaterial.removedPages.filter(
          (pageId) => !pageId.startsWith(sourcePrefix),
        )
      }
      updatedMaterial.updatedAt = new Date().toISOString()
      updatedProject.updatedAt = updatedMaterial.updatedAt
      return {
        status: 'completed',
        project: updatedProject,
        pageCountChanged,
        previousPageCount: previousConversion.pageCount,
        pageCount: conversion.pageCount,
      }
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async #pruneExpired(): Promise<void> {
    const cutoff = Date.now() - TEN_MINUTES
    const expired: PendingImport[] = []
    for (const [token, pending] of this.#pending) {
      if (pending.createdAt < cutoff) {
        this.#pending.delete(token)
        expired.push(pending)
      }
    }
    await Promise.all(
      expired.map(async (pending) => {
        await rm(pending.temporaryDirectory, { recursive: true, force: true }).catch(
          () => undefined,
        )
      }),
    )
  }
}
