import type { BrowserWindow } from 'electron'
import { stat } from 'node:fs/promises'
import { IPC_CHANNELS } from '../../shared/constants/ipc.js'
import {
  DroppedPathsInputSchema,
  EmptyInputSchema,
  ImportCommitInputSchema,
} from '../../shared/schemas/ipc-schema.js'
import type { AppRuntime } from '../app-runtime.js'
import { showOpenDialog } from '../services/dialog-service.js'
import { scanImportDirectory } from '../services/import-service.js'
import { registerValidatedHandler } from './ipc-helpers.js'

const FILE_FILTERS = [{ name: '支持的材料', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'] }]

const expandDroppedPaths = async (paths: string[]): Promise<string[]> => {
  const expanded: string[] = []
  for (const path of paths) {
    const entry = await stat(path)
    if (entry.isDirectory()) expanded.push(...(await scanImportDirectory(path)))
    else if (entry.isFile()) expanded.push(path)
  }
  return expanded
}

export const registerFileIpc = (input: {
  mainWindow: BrowserWindow
  runtime: AppRuntime
}): void => {
  const { mainWindow, runtime } = input
  registerValidatedHandler({
    channel: IPC_CHANNELS.importSelect,
    schema: EmptyInputSchema,
    stage: '选择导入文件',
    mainWindow,
    handler: async () => {
      const session = runtime.requireSession()
      const selection = await showOpenDialog(mainWindow, 'importFiles', {
        title: '选择 PDF 或图片材料',
        buttonLabel: '分析所选文件',
        properties: ['openFile', 'multiSelections'],
        filters: FILE_FILTERS,
      })
      if (selection.canceled || selection.filePaths.length === 0) return null
      return await runtime.importService.analyze(session.project, selection.filePaths)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.importFolder,
    schema: EmptyInputSchema,
    stage: '选择导入文件夹',
    mainWindow,
    handler: async () => {
      const session = runtime.requireSession()
      const selection = await showOpenDialog(mainWindow, 'importFolder', {
        title: '选择材料文件夹',
        buttonLabel: '扫描文件夹',
        properties: ['openDirectory'],
      })
      const directory = selection.filePaths[0]
      if (selection.canceled || !directory) return null
      const paths = await scanImportDirectory(directory)
      if (paths.length === 0) throw new Error('所选文件夹中没有支持的 PDF 或图片。')
      return await runtime.importService.analyze(session.project, paths)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.importDropped,
    schema: DroppedPathsInputSchema,
    stage: '分析拖入文件',
    mainWindow,
    handler: async ({ paths }) => {
      const session = runtime.requireSession()
      const expanded = await expandDroppedPaths(paths)
      if (expanded.length === 0) throw new Error('拖入内容中没有支持的 PDF 或图片。')
      return await runtime.importService.analyze(session.project, expanded)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.importCommit,
    schema: ImportCommitInputSchema,
    stage: '导入材料',
    mainWindow,
    handler: async (value) => {
      const session = runtime.requireSession()
      const result = await runtime.importService.commit(
        session.projectDirectory,
        session.project,
        value,
      )
      session.project = result.project
      session.revision += 1
      runtime.dirty = true
      return result
    },
  })
}
