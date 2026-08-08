import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const app = {
    getPath: () => process.env.SPACK_PREFLIGHT_USER_DATA ?? '/tmp',
    getVersion: () => '0.2.0-test',
    isReady: () => true,
  }
  const ipcMain = { on: vi.fn(), handle: vi.fn() }
  const shell = { openPath: vi.fn(() => Promise.resolve('')) }
  const electron = { app, ipcMain, shell }
  return {
    default: electron,
    app,
    ipcMain,
    shell,
    utilityProcess: {
      fork: vi.fn(() => {
        throw new Error('结构化预检测试不应启动导出进程。')
      }),
    },
  }
})

vi.mock('../../src/main/services/recent-project-service.js', () => ({
  RecentProjectService: class {
    list(): [] {
      return []
    }
    add(): void {
      return undefined
    }
    remove(): void {
      return undefined
    }
  },
}))

vi.mock('../../src/main/services/app-preferences-service.js', () => ({
  AppPreferencesService: class {
    get(): { schemaVersion: 1; experienceMode: 'basic'; dismissedOnboardingVersion: 0 } {
      return { schemaVersion: 1, experienceMode: 'basic', dismissedOnboardingVersion: 0 }
    }
  },
}))

import { AppRuntime } from '../../src/main/app-runtime.js'
import { createProjectDirectory } from '../../src/main/services/project-service.js'
import { createProjectFixture, IDS } from '../helpers/project-fixture.js'

let testDirectory = ''

beforeAll(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), 'spack-preflight-integration-'))
  process.env.SPACK_PREFLIGHT_USER_DATA = join(testDirectory, 'user-data')
})

afterAll(async () => {
  delete process.env.SPACK_PREFLIGHT_USER_DATA
  await rm(testDirectory, { recursive: true, force: true })
})

describe('结构化导出预检', () => {
  it('把实时文件错误关联到材料与目录，并允许废弃预检任务', async () => {
    const session = await createProjectDirectory(testDirectory, createProjectFixture())
    const runtime = new AppRuntime({
      mainWindow: { webContents: { send: vi.fn() } } as never,
      printWindow: {
        renderPdf: vi.fn(() => Promise.reject(new Error('存在文件错误时不应准备生成页面。'))),
      } as never,
      workerDirectory: join(process.cwd(), 'out', 'main'),
      fontPath: join(
        process.cwd(),
        'resources',
        'public',
        'fonts',
        'SupportPackSansSC-Regular.ttf',
      ),
      boldFontPath: join(
        process.cwd(),
        'resources',
        'public',
        'fonts',
        'SupportPackSansSC-Bold.ttf',
      ),
      libreOfficeExecutable: null,
    })
    runtime.session = session

    const preflight = await runtime.preflight(session.project, session.revision)
    expect(preflight.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'source-missing',
          severity: 'error',
          source: 'file',
          outlineNodeId: IDS.level2,
          materialId: IDS.material,
        }),
      ]),
    )
    expect(preflight.errors.every((item) => typeof item.message === 'string')).toBe(true)
    expect(preflight.errors.every((item) => item.suggestion.length > 0)).toBe(true)
    expect(() => runtime.getPreparedExport(preflight.taskId)).toThrow('导出检查存在错误')

    await runtime.cancelExport(preflight.taskId)
    expect(() => runtime.getPreparedExport(preflight.taskId)).toThrow('导出检查结果已失效')
    await runtime.cleanup()
  })
})
