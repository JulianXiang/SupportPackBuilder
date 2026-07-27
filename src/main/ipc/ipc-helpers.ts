import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import type { ZodType } from 'zod'
import type { Result } from '../../shared/types/result.js'
import { failure, success } from '../../shared/types/result.js'
import { appLog } from '../services/log-service.js'

const isTrustedUrl = (url: string): boolean =>
  url.startsWith('spack-app://renderer/') ||
  (process.env.NODE_ENV === 'development' && /^https?:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url))

export const assertTrustedSender = (
  event: IpcMainInvokeEvent | Electron.IpcMainEvent,
  mainWindow: BrowserWindow,
): void => {
  const frameUrl = event.senderFrame?.url ?? ''
  if (event.sender.id !== mainWindow.webContents.id || !isTrustedUrl(frameUrl)) {
    throw new Error('IPC 调用来源未通过安全校验。')
  }
}

const appError = (stage: string, error: unknown) => ({
  code: 'operation-failed',
  message: error instanceof Error ? error.message : '操作失败，请查看日志。',
  stage,
  canContinue: true,
  suggestion: '请检查输入和文件权限；若问题持续，请查看应用日志。',
})

export const registerValidatedHandler = <TInput, TOutput>(input: {
  channel: string
  schema: ZodType<TInput>
  stage: string
  mainWindow: BrowserWindow
  handler: (value: TInput, event: IpcMainInvokeEvent) => Promise<TOutput> | TOutput
}): void => {
  ipcMain.handle(input.channel, async (event, rawInput: unknown): Promise<Result<TOutput>> => {
    try {
      assertTrustedSender(event, input.mainWindow)
      const parsed = input.schema.parse(rawInput ?? {})
      return success(await input.handler(parsed, event))
    } catch (error) {
      appLog.error(`${input.stage}失败`, error)
      return failure(appError(input.stage, error))
    }
  })
}
