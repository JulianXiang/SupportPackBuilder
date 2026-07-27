import { createHash } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PREVIEW_CACHE_VERSION, THUMBNAIL_CACHE_VERSION } from '../../shared/constants/document.js'
import type { Rotation } from '../../shared/schemas/project-schema.js'

export type CacheDescriptor = {
  fileHash: string
  modifiedTime: number
  sourcePageIndex: number
  rotation: Rotation
  size: number
}

export class CacheService {
  readonly #projectDirectory: string
  readonly #opaquePaths = new Map<string, string>()

  constructor(projectDirectory: string) {
    this.#projectDirectory = projectDirectory
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(join(this.#projectDirectory, 'cache', 'thumbnails'), { recursive: true }),
      mkdir(join(this.#projectDirectory, 'cache', 'previews'), { recursive: true }),
    ])
  }

  thumbnailPath(descriptor: CacheDescriptor): { cacheId: string; path: string } {
    return this.#cachePath('thumbnails', THUMBNAIL_CACHE_VERSION, descriptor)
  }

  previewPath(descriptor: CacheDescriptor): { cacheId: string; path: string } {
    return this.#cachePath('previews', PREVIEW_CACHE_VERSION, descriptor)
  }

  resolveOpaquePath(cacheId: string): string | null {
    return this.#opaquePaths.get(cacheId) ?? null
  }

  registerExistingPath(cacheId: string, path: string): void {
    this.#opaquePaths.set(cacheId, path)
  }

  async clear(): Promise<void> {
    await rm(join(this.#projectDirectory, 'cache'), { recursive: true, force: true })
    this.#opaquePaths.clear()
    await this.initialize()
  }

  #cachePath(
    kind: 'thumbnails' | 'previews',
    version: number,
    descriptor: CacheDescriptor,
  ): { cacheId: string; path: string } {
    const key = createHash('sha256')
      .update(
        JSON.stringify({
          version,
          ...descriptor,
        }),
      )
      .digest('hex')
    const path = join(this.#projectDirectory, 'cache', kind, key.slice(0, 2), `${key}.webp`)
    const cacheId = `${kind}-${key}`
    this.#opaquePaths.set(cacheId, path)
    return { cacheId, path }
  }
}
