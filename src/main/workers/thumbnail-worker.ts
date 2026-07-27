import { parentPort } from 'node:worker_threads'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'

export type ThumbnailWorkerRequest = {
  id: string
  sourcePath: string
  sourceType: 'pdf' | 'image'
  sourcePageIndex: number
  rotation: 0 | 90 | 180 | 270
  width: number
  outputPath: string
}

export type ThumbnailWorkerResponse =
  | {
      id: string
      ok: true
      outputPath: string
    }
  | {
      id: string
      ok: false
      error: string
    }

const renderPdfThumbnail = async (request: ThumbnailWorkerRequest): Promise<void> => {
  const loadingTask = getDocument({
    url: request.sourcePath,
    useSystemFonts: true,
  })
  const document = await loadingTask.promise
  try {
    const page = await document.getPage(request.sourcePageIndex + 1)
    const baseViewport = page.getViewport({ scale: 1, rotation: request.rotation })
    const scale = request.width / baseViewport.width
    const viewport = page.getViewport({ scale, rotation: request.rotation })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    await page.render({
      canvas: canvas as never,
      canvasContext: context as never,
      viewport,
    }).promise
    const png = await canvas.encode('png')
    await sharp(png).webp({ quality: 82 }).toFile(request.outputPath)
  } finally {
    await loadingTask.destroy()
  }
}

const renderImageThumbnail = async (request: ThumbnailWorkerRequest): Promise<void> => {
  await sharp(request.sourcePath, { failOn: 'error' })
    .rotate()
    .rotate(request.rotation)
    .resize({
      width: request.width,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toFile(request.outputPath)
}

parentPort?.on('message', (request: ThumbnailWorkerRequest) => {
  void (async (): Promise<ThumbnailWorkerResponse> => {
    try {
      await mkdir(dirname(request.outputPath), { recursive: true })
      if (request.sourceType === 'pdf') await renderPdfThumbnail(request)
      else await renderImageThumbnail(request)
      return {
        id: request.id,
        ok: true,
        outputPath: request.outputPath,
      }
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : '缩略图生成失败。',
      }
    }
  })().then((response) => parentPort?.postMessage(response))
})
