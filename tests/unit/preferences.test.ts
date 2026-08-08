import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppPreferencesService } from '../../src/main/services/app-preferences-service.js'
import {
  AppPreferencesUpdateSchema,
  DEFAULT_APP_PREFERENCES,
} from '../../src/shared/schemas/preferences-schema.js'

const temporaryDirectories: string[] = []

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'spack-preferences-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }),
  )
})

describe('全局体验偏好', () => {
  it('首次读取默认使用基础模式并显示引导', async () => {
    const directory = await createTemporaryDirectory()
    const service = new AppPreferencesService({ cwd: directory })

    expect(service.get()).toEqual(DEFAULT_APP_PREFERENCES)
  })

  it('严格拒绝未知字段和非法模式', () => {
    expect(AppPreferencesUpdateSchema.safeParse({ experienceMode: 'expert' }).success).toBe(false)
    expect(
      AppPreferencesUpdateSchema.safeParse({ experienceMode: 'basic', extra: true }).success,
    ).toBe(false)
  })

  it('更新后可由另一个存储实例读取', async () => {
    const directory = await createTemporaryDirectory()
    const first = new AppPreferencesService({ cwd: directory })
    first.update({ experienceMode: 'advanced', dismissedOnboardingVersion: 1 })

    const second = new AppPreferencesService({ cwd: directory })
    expect(second.get()).toMatchObject({
      experienceMode: 'advanced',
      dismissedOnboardingVersion: 1,
    })
  })

  it('配置语义无效或 JSON 损坏时回退到基础模式与未关闭引导', async () => {
    const semanticDirectory = await createTemporaryDirectory()
    const semanticPath = join(semanticDirectory, 'ui-preferences.json')
    await writeFile(
      semanticPath,
      JSON.stringify({ schemaVersion: 1, experienceMode: 'expert', dismissedOnboardingVersion: 9 }),
    )
    expect(new AppPreferencesService({ cwd: semanticDirectory }).get()).toEqual(
      DEFAULT_APP_PREFERENCES,
    )

    const malformedDirectory = await createTemporaryDirectory()
    const malformedPath = join(malformedDirectory, 'ui-preferences.json')
    await writeFile(malformedPath, '{broken')
    expect(new AppPreferencesService({ cwd: malformedDirectory }).get()).toEqual(
      DEFAULT_APP_PREFERENCES,
    )
    expect(JSON.parse(await readFile(malformedPath, 'utf8'))).toEqual(DEFAULT_APP_PREFERENCES)
  })
})
