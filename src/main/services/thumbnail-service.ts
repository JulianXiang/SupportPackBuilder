import { access, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { PDFDocument } from 'pdf-lib'
import type { PlannedPage } from '../../shared/schemas/page-plan-schema.js'
import type { Project } from '../../shared/schemas/project-schema.js'
import type { GeneratedPageReference } from '../../shared/types/worker-protocol.js'
import { CacheService } from './cache-service.js'
import { resolveMaterialContentPath } from './project-service.js'
import {
  addPageMarkers,
  appendGeneratedPage,
  appendPlannedContentPage,
  loadSourcePdf,
} from './pdf-layout-service.js'
import { prepareInlineHeadingFont } from './inline-heading-service.js'
import { drawPageNumber, preparePageNumberFont } from './page-number-service.js'
import { appLog } from './log-service.js'
import type {
  ThumbnailWorkerRequest,
  ThumbnailWorkerResponse,
} from '../workers/thumbnail-worker.js'

type QueueItem = {
  request: ThumbnailWorkerRequest
  resolve: (value: string) => void
  reject: (error: Error) => void
}

export class ThumbnailService {
  readonly #cache: CacheService
  readonly #workerPath: string
  readonly #projectDirectory: string
  readonly #fontPath: string
  readonly #boldFontPath: string
  readonly #queue: QueueItem[] = []
  #active = 0

  constructor(
    projectDirectory: string,
    workerDirectory: string,
    fontPath: string,
    boldFontPath: string,
  ) {
    this.#cache = new CacheService(projectDirectory)
    this.#workerPath = join(workerDirectory, 'workers', 'thumbnail-worker.cjs')
    this.#projectDirectory = projectDirectory
    this.#fontPath = fontPath
    this.#boldFontPath = boldFontPath
  }

  async initialize(): Promise<void> {
    await this.#cache.initialize()
  }

  resolveOpaquePath(cacheId: string): string | null {
    return this.#cache.resolveOpaquePath(cacheId)
  }

  async clear(): Promise<void> {
    await this.#cache.clear()
  }

  async createThumbnail(input: {
    projectDirectory: string
    project: Project
    page: PlannedPage
    width: number
    planFingerprint: string
    generatedPage?: GeneratedPageReference
  }): Promise<string | null> {
    if (input.page.pageType === 'blank') return null
    const cached = this.#cache.previewPath({
      fileHash: `${input.planFingerprint}:${input.page.id}`,
      modifiedTime: 0,
      sourcePageIndex: input.page.sourcePageIndex ?? input.generatedPage?.pageIndex ?? 0,
      rotation: input.page.rotation,
      size: input.width,
    })
    try {
      await access(cached.path)
      return cached.cacheId
    } catch {
      const temporaryPdf = join(
        this.#projectDirectory,
        'cache',
        'previews',
        `thumbnail-page-${crypto.randomUUID()}.pdf`,
      )
      try {
        await this.#composePagePdf({
          projectDirectory: input.projectDirectory,
          project: input.project,
          page: input.page,
          ...(input.generatedPage ? { generatedPage: input.generatedPage } : {}),
          outputPath: temporaryPdf,
        })
        await this.#enqueue({
          id: crypto.randomUUID(),
          sourcePath: temporaryPdf,
          sourceType: 'pdf',
          sourcePageIndex: 0,
          rotation: 0,
          width: input.width,
          outputPath: cached.path,
        })
        return cached.cacheId
      } finally {
        await rm(temporaryPdf, { force: true }).catch((error: unknown) => {
          appLog.warn('清理缩略图临时 PDF 失败', error)
        })
      }
    }
  }

  async #composePagePdf(input: {
    projectDirectory: string
    project: Project
    page: PlannedPage
    generatedPage?: GeneratedPageReference
    outputPath: string
  }): Promise<void> {
    const document = await PDFDocument.create()
    const inlineHeadingFont =
      input.page.inlineHeadings.length > 0
        ? await prepareInlineHeadingFont(document, this.#boldFontPath)
        : undefined
    let outputPage
    if (input.generatedPage) {
      outputPage = await appendGeneratedPage({
        targetDocument: document,
        generatedPdfPath: input.generatedPage.pdfPath,
        generatedPageIndex: input.generatedPage.pageIndex,
        project: input.project,
      })
    } else {
      if (!input.page.materialId || !input.page.sourceId || !input.page.sourcePageId) {
        throw new Error(`页面“${input.page.displayTitle}”缺少材料来源。`)
      }
      const material = input.project.outlineNodes
        .flatMap((node) => node.children)
        .flatMap((node) => node.materials)
        .find((candidate) => candidate.id === input.page.materialId)
      if (!material) throw new Error(`找不到页面所属材料“${input.page.displayTitle}”。`)
      const sourcePath = resolveMaterialContentPath(
        input.projectDirectory,
        material,
        input.page.sourceId,
      )
      const sourceDocument =
        input.page.pageType === 'pdfContent' ? await loadSourcePdf(sourcePath) : undefined
      outputPage = await appendPlannedContentPage({
        targetDocument: document,
        projectDirectory: input.projectDirectory,
        plannedPage: input.page,
        project: input.project,
        ...(sourceDocument ? { sourceDocument } : {}),
        ...(inlineHeadingFont ? { inlineHeadingFont } : {}),
      })
    }
    const pageNumberFont = await preparePageNumberFont(document, input.project, this.#fontPath)
    const pageNumberDrawn = drawPageNumber(outputPage, input.page, input.project, pageNumberFont)
    addPageMarkers(outputPage, input.page, pageNumberDrawn)
    await writeFile(input.outputPath, await document.save({ useObjectStreams: true }))
  }

  async #enqueue(request: ThumbnailWorkerRequest): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      this.#queue.push({ request, resolve, reject })
      this.#drain()
    })
  }

  #drain(): void {
    while (this.#active < 2 && this.#queue.length > 0) {
      const item = this.#queue.shift()
      if (!item) return
      this.#active += 1
      const worker = new Worker(this.#workerPath)
      const finish = (): void => {
        this.#active -= 1
        void worker.terminate()
        this.#drain()
      }
      worker.once('message', (response: ThumbnailWorkerResponse) => {
        if (response.ok) item.resolve(response.outputPath)
        else item.reject(new Error(response.error))
        finish()
      })
      worker.once('error', (error) => {
        item.reject(new Error(`缩略图后台任务失败：${error.message}`))
        finish()
      })
      worker.postMessage(item.request)
    }
  }
}
