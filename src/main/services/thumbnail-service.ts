import { access, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import type { PlannedPage } from '../../shared/schemas/page-plan-schema.js'
import type { NormalizedCropRect, Project, Rotation } from '../../shared/schemas/project-schema.js'
import { FULL_CROP_RECT, unrotateCropRect } from '../../shared/utils/layout-tree.js'
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

  async detectContentCrop(input: {
    projectDirectory: string
    project: Project
    page: PlannedPage
    safetyMillimeters: number
  }): Promise<NormalizedCropRect> {
    if (
      !input.page.materialId ||
      !input.page.sourceId ||
      input.page.sourcePageIndex === null ||
      !['pdfContent', 'imageContent'].includes(input.page.pageType)
    ) {
      throw new Error('当前页面不是可自动裁切的 PDF 或图片来源页。')
    }
    const material = input.project.outlineNodes
      .flatMap((node) => node.children)
      .flatMap((node) => node.materials)
      .find((candidate) => candidate.id === input.page.materialId)
    if (!material) throw new Error('找不到自动裁切页面所属的材料。')
    const sourcePath = resolveMaterialContentPath(
      input.projectDirectory,
      material,
      input.page.sourceId,
    )
    const renderedPath = join(
      this.#projectDirectory,
      'cache',
      'previews',
      `crop-detection-${crypto.randomUUID()}.webp`,
    )
    try {
      await this.#enqueue({
        id: crypto.randomUUID(),
        sourcePath,
        sourceType: input.page.pageType === 'pdfContent' ? 'pdf' : 'image',
        sourcePageIndex: input.page.sourcePageIndex,
        rotation: input.page.rotation,
        width: 1800,
        outputPath: renderedPath,
      })
      const flattened = await sharp(renderedPath)
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer({ resolveWithObject: true })
      const statistics = await sharp(flattened.data).stats()
      if (
        statistics.channels.slice(0, 3).every((channel) => channel.mean > 250 && channel.stdev < 2)
      ) {
        return { ...FULL_CROP_RECT }
      }
      const trimmed = await sharp(flattened.data)
        .trim({ background: '#ffffff', threshold: 12 })
        .png()
        .toBuffer({ resolveWithObject: true })
      const originalWidth = flattened.info.width
      const originalHeight = flattened.info.height
      const offsetLeft = Math.max(0, trimmed.info.trimOffsetLeft ?? 0)
      const offsetTop = Math.max(0, trimmed.info.trimOffsetTop ?? 0)
      const safetyRatio = Math.max(0, input.safetyMillimeters) / 210
      const safetyX = Math.round(originalWidth * safetyRatio)
      const safetyY = Math.round(originalHeight * safetyRatio)
      const left = Math.max(0, offsetLeft - safetyX)
      const top = Math.max(0, offsetTop - safetyY)
      const right = Math.min(originalWidth, offsetLeft + trimmed.info.width + safetyX)
      const bottom = Math.min(originalHeight, offsetTop + trimmed.info.height + safetyY)
      const renderedCrop: NormalizedCropRect = {
        x: Math.round((left / originalWidth) * 10000),
        y: Math.round((top / originalHeight) * 10000),
        width: Math.max(1, Math.round(((right - left) / originalWidth) * 10000)),
        height: Math.max(1, Math.round(((bottom - top) / originalHeight) * 10000)),
      }
      renderedCrop.width = Math.min(10000 - renderedCrop.x, renderedCrop.width)
      renderedCrop.height = Math.min(10000 - renderedCrop.y, renderedCrop.height)

      let totalRotation = input.page.rotation
      if (input.page.pageType === 'pdfContent') {
        const sourceDocument = await PDFDocument.load(await readFile(sourcePath), {
          updateMetadata: false,
        })
        const sourcePage = sourceDocument.getPage(input.page.sourcePageIndex)
        totalRotation = ((sourcePage.getRotation().angle + input.page.rotation) % 360) as Rotation
      }
      const sourceCrop = unrotateCropRect(renderedCrop, totalRotation)
      const retainedArea = (sourceCrop.width * sourceCrop.height) / 100_000_000
      return retainedArea > 0.97 ? { ...FULL_CROP_RECT } : sourceCrop
    } finally {
      await rm(renderedPath, { force: true }).catch((error: unknown) => {
        appLog.warn('清理自动裁切临时缩略图失败', error)
      })
    }
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
      input.page.inlineHeadings.length > 0 || input.page.pageType === 'compositeContent'
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
    } else if (input.page.pageType === 'compositeContent') {
      outputPage = await appendPlannedContentPage({
        targetDocument: document,
        projectDirectory: input.projectDirectory,
        plannedPage: input.page,
        project: input.project,
        ...(inlineHeadingFont ? { inlineHeadingFont } : {}),
        sourceDocuments: new Map<string, PDFDocument>(),
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
