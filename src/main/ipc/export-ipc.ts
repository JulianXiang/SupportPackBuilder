import type { BrowserWindow } from 'electron'
import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../shared/constants/ipc.js'
import {
  ExportCancelInputSchema,
  ExportPreflightInputSchema,
  ExportStartInputSchema,
} from '../../shared/schemas/ipc-schema.js'
import type { AppRuntime } from '../app-runtime.js'
import { confirmOverwrite, showSaveDialog } from '../services/dialog-service.js'
import { registerValidatedHandler } from './ipc-helpers.js'

export const registerExportIpc = (input: {
  mainWindow: BrowserWindow
  runtime: AppRuntime
}): void => {
  const { mainWindow, runtime } = input
  registerValidatedHandler({
    channel: IPC_CHANNELS.exportPreflight,
    schema: ExportPreflightInputSchema,
    stage: '导出前检查',
    mainWindow,
    handler: async ({ project, expectedRevision }) =>
      await runtime.preflight(project, expectedRevision),
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.exportStart,
    schema: ExportStartInputSchema,
    stage: '启动 PDF 导出',
    mainWindow,
    handler: async ({ taskId }) => {
      const session = runtime.requireSession()
      const prepared = runtime.getPreparedExport(taskId)
      const selection = await showSaveDialog(mainWindow, {
        title: '导出完整支撑材料 PDF',
        buttonLabel: '导出',
        defaultPath: join(
          session.projectDirectory,
          'output',
          prepared.project.exportSettings.outputFileName,
        ),
        filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      })
      if (selection.canceled || !selection.filePath) return null
      const targetExists = await access(selection.filePath, fsConstants.F_OK).then(
        () => true,
        () => false,
      )
      if (targetExists) {
        if (!(await confirmOverwrite(mainWindow))) return null
      }
      runtime.startExport({
        taskId,
        outputPath: selection.filePath,
        overwriteExisting: targetExists,
      })
      return { started: true }
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.exportCancel,
    schema: ExportCancelInputSchema,
    stage: '取消 PDF 导出',
    mainWindow,
    handler: async ({ taskId }) => await runtime.cancelExport(taskId),
  })
}
