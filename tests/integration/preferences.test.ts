import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppPreferencesService } from '../../src/main/services/app-preferences-service.js'

let testDirectory = ''

beforeAll(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), 'spack-preferences-integration-'))
})

afterAll(async () => {
  await rm(testDirectory, { recursive: true, force: true })
})

describe('ElectronStore 偏好持久化', () => {
  it('在隔离目录中的不同实例之间保持全局体验模式和引导版本', () => {
    const first = new AppPreferencesService({ cwd: testDirectory })
    first.update({ experienceMode: 'advanced', dismissedOnboardingVersion: 1 })

    const second = new AppPreferencesService({ cwd: testDirectory })
    expect(second.get()).toEqual({
      schemaVersion: 1,
      experienceMode: 'advanced',
      dismissedOnboardingVersion: 1,
    })
  })
})
