import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc.js'
import { AppPreferencesUpdateSchema } from '../../shared/schemas/preferences-schema.js'
import { EmptyInputSchema } from '../../shared/schemas/ipc-schema.js'
import type { AppRuntime } from '../app-runtime.js'
import { registerValidatedHandler } from './ipc-helpers.js'

export const registerPreferencesIpc = (input: {
  mainWindow: BrowserWindow
  runtime: AppRuntime
}): void => {
  const { mainWindow, runtime } = input
  registerValidatedHandler({
    channel: IPC_CHANNELS.preferencesGet,
    schema: EmptyInputSchema,
    stage: '读取界面偏好',
    mainWindow,
    handler: () => runtime.preferences.get(),
  })
  registerValidatedHandler({
    channel: IPC_CHANNELS.preferencesUpdate,
    schema: AppPreferencesUpdateSchema,
    stage: '保存界面偏好',
    mainWindow,
    handler: (value) => runtime.preferences.update(value),
  })
}
