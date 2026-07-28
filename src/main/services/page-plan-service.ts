import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { MAX_TOC_ITERATIONS } from '../../shared/constants/document.js'
import type { PagePlan } from '../../shared/schemas/page-plan-schema.js'
import type { Project } from '../../shared/schemas/project-schema.js'
import type { GeneratedPageReference } from '../../shared/types/worker-protocol.js'
import { buildPagePlan } from '../../shared/utils/page-plan.js'
import type { PrintWindowService } from '../windows/print-window.js'

export type PreparedPagePlan = {
  plan: PagePlan
  generatedPages: Record<string, GeneratedPageReference>
  temporaryDirectory: string
}

const writeGeneratedPdf = async (
  temporaryDirectory: string,
  name: string,
  buffer: Buffer,
): Promise<string> => {
  const path = join(temporaryDirectory, name)
  await writeFile(path, buffer)
  return path
}

export class PagePlanService {
  readonly #printWindow: PrintWindowService

  constructor(printWindow: PrintWindowService) {
    this.#printWindow = printWindow
  }

  preview(project: Project, revision: number, tocPageCount = 1): PagePlan {
    return buildPagePlan(project, { revision, tocPageCount })
  }

  async prepareForPreview(
    project: Project,
    revision: number,
    projectDirectory: string,
  ): Promise<PreparedPagePlan> {
    const temporaryDirectory = join(
      projectDirectory,
      'cache',
      'previews',
      `plan-${revision}-${crypto.randomUUID()}`,
    )
    return await this.#prepareGeneratedPlan(project, revision, temporaryDirectory)
  }

  async prepareForExport(
    project: Project,
    revision: number,
    projectDirectory: string,
    taskId: string,
  ): Promise<PreparedPagePlan> {
    const temporaryDirectory = join(projectDirectory, 'temp', `export-${taskId}`)
    return await this.#prepareGeneratedPlan(project, revision, temporaryDirectory)
  }

  async #prepareGeneratedPlan(
    project: Project,
    revision: number,
    temporaryDirectory: string,
  ): Promise<PreparedPagePlan> {
    await rm(temporaryDirectory, { recursive: true, force: true })
    await mkdir(temporaryDirectory, { recursive: true })
    const generatedPages: Record<string, GeneratedPageReference> = {}

    try {
      let tocPageCount = project.tocSettings.enabled && project.exportSettings.includeToc ? 1 : 0
      let tocBuffer: Buffer | null = null
      let stable = tocPageCount === 0

      for (let iteration = 0; iteration < MAX_TOC_ITERATIONS && !stable; iteration += 1) {
        const iterationPlan = buildPagePlan(project, { revision, tocPageCount })
        tocBuffer = await this.#printWindow.renderPdf({
          kind: 'toc',
          orientation: project.exportSettings.targetOrientation,
          title: project.tocSettings.title,
          entries: iterationPlan.tocEntries,
        })
        const tocDocument = await PDFDocument.load(tocBuffer, { updateMetadata: false })
        const actualPageCount = tocDocument.getPageCount()
        if (actualPageCount === tocPageCount) {
          stable = true
        } else {
          tocPageCount = actualPageCount
        }
      }
      if (!stable) {
        throw new Error(`目录页数在 ${MAX_TOC_ITERATIONS} 次迭代后仍未稳定，处理已中止。`)
      }
      const stablePlan = buildPagePlan(project, { revision, tocPageCount })

      if (tocBuffer && tocPageCount > 0) {
        const tocPath = await writeGeneratedPdf(temporaryDirectory, 'toc.pdf', tocBuffer)
        for (let index = 0; index < tocPageCount; index += 1) {
          generatedPages[`toc:${index}`] = {
            pdfPath: tocPath,
            pageIndex: index,
          }
        }
      }

      const coverPage = stablePlan.pages.find((page) => page.pageType === 'cover')
      if (coverPage) {
        const coverBuffer = await this.#printWindow.renderPdf({
          kind: 'cover',
          orientation: project.exportSettings.targetOrientation,
          title: project.coverSettings.title,
          ownerName: project.coverSettings.ownerName,
          organization: project.coverSettings.organization,
          purpose: project.coverSettings.purpose,
          compiledDate: project.coverSettings.compiledDate,
        })
        const coverPath = await writeGeneratedPdf(temporaryDirectory, 'cover.pdf', coverBuffer)
        generatedPages[coverPage.id] = {
          pdfPath: coverPath,
          pageIndex: 0,
        }
      }

      const titlePages = stablePlan.pages.filter(
        (page) => page.pageType === 'divider' || page.pageType === 'materialTitle',
      )
      if (titlePages.length > 0) {
        const materials = new Map(
          project.outlineNodes
            .flatMap((node) => node.children)
            .flatMap((node) => node.materials)
            .map((material) => [material.id, material]),
        )
        const titleBuffer = await this.#printWindow.renderPdf({
          kind: 'titles',
          orientation: project.exportSettings.targetOrientation,
          pages: titlePages.map((page) => {
            const material = page.materialId ? materials.get(page.materialId) : undefined
            return {
              id: page.id,
              kind: page.pageType === 'divider' ? 'divider' : 'materialTitle',
              ...(page.sequenceLabel ? { sequenceLabel: page.sequenceLabel } : {}),
              title: page.displayTitle,
              ...(material
                ? {
                    category: material.category,
                    ...(material.notes ? { notes: material.notes } : {}),
                  }
                : {}),
            }
          }),
        })
        const titleDocument = await PDFDocument.load(titleBuffer, { updateMetadata: false })
        if (titleDocument.getPageCount() !== titlePages.length) {
          throw new Error(
            `标题页生成数量不一致：计划 ${titlePages.length} 页，实际 ${titleDocument.getPageCount()} 页。`,
          )
        }
        const titlePath = await writeGeneratedPdf(temporaryDirectory, 'titles.pdf', titleBuffer)
        titlePages.forEach((page, index) => {
          generatedPages[page.id] = {
            pdfPath: titlePath,
            pageIndex: index,
          }
        })
      }

      return {
        plan: stablePlan,
        generatedPages,
        temporaryDirectory,
      }
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
}
