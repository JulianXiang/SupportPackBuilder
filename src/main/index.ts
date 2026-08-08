import {
  Menu,
  app,
  ipcMain,
  net,
  protocol,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron'
import { dirname, extname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AppRuntime } from './app-runtime.js'
import { registerExportIpc } from './ipc/export-ipc.js'
import { registerFileIpc } from './ipc/file-ipc.js'
import { assertTrustedSender } from './ipc/ipc-helpers.js'
import { registerPreviewIpc } from './ipc/preview-ipc.js'
import { registerProjectIpc } from './ipc/project-ipc.js'
import { registerPreferencesIpc } from './ipc/preferences-ipc.js'
import { registerSystemIpc } from './ipc/system-ipc.js'
import { initializeLogService, appLog } from './services/log-service.js'
import { createMainWindow, loadMainWindow } from './windows/main-window.js'
import { PrintWindowService } from './windows/print-window.js'
import { resolveLibreOfficeExecutable } from './services/libreoffice-runtime.js'
import { IPC_CHANNELS } from '../shared/constants/ipc.js'
import { AppCloseResponseInputSchema, AppDirtyInputSchema } from '../shared/schemas/ipc-schema.js'
import type { AppCommand } from '../preload/api-types.js'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'spack-app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
  {
    scheme: 'spack-cache',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
])

const currentDirectory = dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let runtime: AppRuntime | null = null
let forceClose = false

const sendCommand = (command: AppCommand): void => {
  mainWindow?.webContents.send(IPC_CHANNELS.appCommand, command)
}

const installApplicationMenu = (): void => {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new-project') },
        { label: '打开项目', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('open-project') },
        { type: 'separator' },
        { label: '保存项目', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save-project') },
        {
          label: '另存为',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendCommand('save-as-project'),
        },
        { type: 'separator' },
        { label: '导入文件', accelerator: 'CmdOrCtrl+I', click: () => sendCommand('import-files') },
        { label: '导出 PDF', accelerator: 'CmdOrCtrl+E', click: () => sendCommand('export-pdf') },
        ...(!isMac ? [{ type: 'separator' as const }, { role: 'quit' as const }] : []),
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => sendCommand('undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendCommand('redo') },
        { type: 'separator' },
        {
          label: '删除所选项',
          accelerator: 'Delete',
          click: () => sendCommand('delete-selection'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        ...(process.env.NODE_ENV === 'development' ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const installProtocols = (): void => {
  const rendererRoot = resolve(currentDirectory, '../renderer')
  protocol.handle('spack-app', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'renderer') return new Response('未找到资源', { status: 404 })
    const requested = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'index.html'
    const filePath = resolve(rendererRoot, normalize(requested))
    const relativePath = relative(rendererRoot, filePath)
    if (relativePath.startsWith('..') || relativePath.startsWith('/')) {
      return new Response('拒绝访问', { status: 403 })
    }
    return await net.fetch(pathToFileURL(filePath).toString())
  })
  protocol.handle('spack-cache', async (request) => {
    const url = new URL(request.url)
    const cacheId = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const filePath = runtime?.thumbnailService?.resolveOpaquePath(cacheId) ?? null
    if (!filePath || extname(filePath).toLowerCase() !== '.webp') {
      return new Response('未找到缩略图', { status: 404 })
    }
    return await net.fetch(pathToFileURL(filePath).toString())
  })
}

const registerAppEvents = (window: BrowserWindow, appRuntime: AppRuntime): void => {
  ipcMain.on(IPC_CHANNELS.appSetDirty, (event, rawInput: unknown) => {
    try {
      assertTrustedSender(event, window)
      appRuntime.dirty = AppDirtyInputSchema.parse(rawInput).dirty
    } catch (error) {
      appLog.warn('更新未保存状态失败', error)
    }
  })
  ipcMain.on(IPC_CHANNELS.appCloseResponse, (event, rawInput: unknown) => {
    try {
      assertTrustedSender(event, window)
      const { action } = AppCloseResponseInputSchema.parse(rawInput)
      if (action === 'cancel') return
      if (action === 'save') {
        sendCommand('save-project')
        return
      }
      forceClose = true
      window.close()
    } catch (error) {
      appLog.warn('处理关闭响应失败', error)
    }
  })
  window.on('close', (event) => {
    if (!forceClose && appRuntime.dirty) {
      event.preventDefault()
      window.webContents.send(IPC_CHANNELS.appBeforeClose)
    }
  })
}

const start = async (): Promise<void> => {
  initializeLogService()
  installProtocols()
  const window = createMainWindow()
  mainWindow = window
  const printWindow = new PrintWindowService()
  const fontPath = app.isPackaged
    ? join(process.resourcesPath, 'fonts', 'SupportPackSansSC-Regular.ttf')
    : join(app.getAppPath(), 'resources', 'public', 'fonts', 'SupportPackSansSC-Regular.ttf')
  const boldFontPath = app.isPackaged
    ? join(process.resourcesPath, 'fonts', 'SupportPackSansSC-Bold.ttf')
    : join(app.getAppPath(), 'resources', 'public', 'fonts', 'SupportPackSansSC-Bold.ttf')
  const libreOfficeExecutable = await resolveLibreOfficeExecutable({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    packaged: app.isPackaged,
  })
  const appRuntime = new AppRuntime({
    mainWindow: window,
    printWindow,
    workerDirectory: currentDirectory,
    fontPath,
    boldFontPath,
    libreOfficeExecutable,
  })
  runtime = appRuntime
  registerProjectIpc({ mainWindow: window, runtime: appRuntime })
  registerPreferencesIpc({ mainWindow: window, runtime: appRuntime })
  registerFileIpc({ mainWindow: window, runtime: appRuntime })
  registerPreviewIpc({ mainWindow: window, runtime: appRuntime })
  registerExportIpc({ mainWindow: window, runtime: appRuntime })
  registerSystemIpc({ mainWindow: window, runtime: appRuntime })
  registerAppEvents(window, appRuntime)
  installApplicationMenu()
  window.on('closed', () => {
    mainWindow = null
  })
  await loadMainWindow(window)
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  void app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      appLog.error('应用启动失败', error)
      app.quit()
    })
}

app.on('activate', () => {
  if (mainWindow === null)
    void start().catch((error: unknown) => {
      appLog.error('重新创建主窗口失败', error)
    })
})

app.on('before-quit', () => {
  forceClose = true
  void runtime?.cleanup()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
