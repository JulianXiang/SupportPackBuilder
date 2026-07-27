import { BrowserWindow, session } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appLog } from '../services/log-service.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

export const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    title: '个人支撑材料编排器',
    width: 1480,
    height: 920,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: '#f3f5f7',
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: process.env.NODE_ENV === 'development',
      spellcheck: false,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const allowed =
      url.startsWith('spack-app://renderer/') ||
      (process.env.NODE_ENV === 'development' &&
        /^https?:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url))
    if (!allowed) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('console-message', (details) => {
    const log = details.level === 'error' ? appLog.error : appLog.debug
    log('Renderer 控制台', details.message, details.sourceId, details.lineNumber)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  window.once('ready-to-show', () => window.show())
  return window
}

export const loadMainWindow = async (window: BrowserWindow): Promise<void> => {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) await window.loadURL(developmentUrl)
  else await window.loadURL('spack-app://renderer/index.html')
}
