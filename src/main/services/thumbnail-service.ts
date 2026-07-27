import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { PlannedPage } from '../../shared/schemas/page-plan-schema.js'
import type { Project } from '../../shared/schemas/project-schema.js'
import { CacheService } from './cache-service.js'
import { resolveMaterialSourcePath } from './project-service.js'
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
  readonly #queue: QueueItem[] = []
  #active = 0

  constructor(projectDirectory: string, workerDirectory: string) {
    this.#cache = new CacheService(projectDirectory)
    this.#workerPath = join(workerDirectory, 'workers', 'thumbnail-worker.cjs')
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
  }): Promise<string | null> {
    if (!input.page.materialId || !input.page.sourceId || !input.page.sourcePageId) return null
    const material = input.project.outlineNodes
      .flatMap((node) => node.children)
      .flatMap((node) => node.materials)
      .find((candidate) => candidate.id === input.page.materialId)
    if (!material) throw new Error(`找不到页面所属材料“${input.page.displayTitle}”。`)
    const source = material.sourceItems.find((candidate) => candidate.id === input.page.sourceId)
    if (!source) throw new Error(`材料“${material.title}”缺少来源文件。`)
    const sourcePath = resolveMaterialSourcePath(
      input.projectDirectory,
      material,
      input.page.sourceId,
    )
    const cached = this.#cache.thumbnailPath({
      fileHash: source.fileHash,
      modifiedTime: source.modifiedTime,
      sourcePageIndex: input.page.sourcePageIndex ?? 0,
      rotation: input.page.rotation,
      size: input.width,
    })
    try {
      await access(cached.path)
      return cached.cacheId
    } catch {
      await this.#enqueue({
        id: crypto.randomUUID(),
        sourcePath,
        sourceType: input.page.pageType === 'pdfContent' ? 'pdf' : 'image',
        sourcePageIndex: input.page.sourcePageIndex ?? 0,
        rotation: input.page.rotation,
        width: input.width,
        outputPath: cached.path,
      })
      return cached.cacheId
    }
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
