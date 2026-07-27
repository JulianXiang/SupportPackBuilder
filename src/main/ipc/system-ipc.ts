import { shell, type BrowserWindow } from 'electron'
import { relative, resolve } from 'node:path'
import { IPC_CHANNELS } from '../../shared/constants/ipc.js'
import {
  SystemExternalInputSchema,
  SystemPathInputSchema,
} from '../../shared/schemas/ipc-schema.js'
import type { AppRuntime } from '../app-runtime.js'
import { registerValidatedHandler } from './ipc-helpers.js'

const assertAllowedPath = (runtime: AppRuntime, requestedPath: string): string => {
  const session = runtime.requireSession()
  const normalized = resolve(requestedPath)
  const relativeToProject = relative(session.projectDirectory, normalized)
  const insideProject =
    relativeToProject === '' ||
    (!relativeToProject.startsWith('..') && !relativeToProject.startsWith('/'))
  if (!insideProject && !runtime.allowedSystemPaths.has(normalized)) {
    throw new Error('拒绝打开未获授权的本地路径。')
  }
  return normalized
}

export const registerSystemIpc = (input: {
  mainWindow: BrowserWindow
  runtime: AppRuntime
}): void => {
  const { mainWindow, runtime } = input
  registerValidatedHandler({
    channel: IPC_CHANNELS.systemOpenPath,
    schema: SystemPathInputSchema,
    stage: '打开文件',
    mainWindow,
    handler: async ({ path }) => {
      const error = await shell.openPath(assertAllowedPath(runtime, path))
      if (error) throw new Error(`无法打开文件：${error}`)
    },
  })
  registerValidatedHandler({
    channel: IPC_CHANNELS.systemRevealPath,
    schema: SystemPathInputSchema,
    stage: '打开所在位置',
    mainWindow,
    handler: ({ path }) => {
      shell.showItemInFolder(assertAllowedPath(runtime, path))
    },
  })
  registerValidatedHandler({
    channel: IPC_CHANNELS.systemOpenExternal,
    schema: SystemExternalInputSchema,
    stage: '打开外部链接',
    mainWindow,
    handler: async ({ url }) => {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('外部链接只允许使用 http 或 https 协议。')
      }
      await shell.openExternal(parsed.toString())
    },
  })
}
