import { BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '../../shared/constants/ipc.js'
import type { PrintPayload } from '../../shared/types/print.js'

type PendingPrint = {
  payload: PrintPayload
  resolveReady: () => void
  rejectReady: (error: Error) => void
}

const currentDirectory = dirname(fileURLToPath(import.meta.url))

export class PrintWindowService {
  readonly #pending = new Map<number, PendingPrint>()
  #registered = false

  registerIpc(): void {
    if (this.#registered) return
    this.#registered = true
    ipcMain.handle(IPC_CHANNELS.printGetPayload, (event) => {
      const pending = this.#pending.get(event.sender.id)
      if (!pending) throw new Error('未找到打印任务。')
      return pending.payload
    })
    ipcMain.on(IPC_CHANNELS.printReady, (event) => {
      this.#pending.get(event.sender.id)?.resolveReady()
    })
  }

  async renderPdf(payload: PrintPayload): Promise<Buffer> {
    this.registerIpc()
    const window = new BrowserWindow({
      show: false,
      width: payload.orientation === 'portrait' ? 900 : 1200,
      height: payload.orientation === 'portrait' ? 1200 : 900,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: join(currentDirectory, '../preload/print.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: process.env.NODE_ENV === 'development',
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => {
      event.preventDefault()
    })
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('打印页面渲染超时。'))
      }, 30_000)
      this.#pending.set(window.webContents.id, {
        payload,
        resolveReady: () => {
          clearTimeout(timeout)
          resolve()
        },
        rejectReady: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
      })
    })
    window.webContents.once('render-process-gone', (_event, details) => {
      this.#pending
        .get(window.webContents.id)
        ?.rejectReady(new Error(`打印进程异常退出：${details.reason}`))
    })

    try {
      const developmentUrl = process.env.ELECTRON_RENDERER_URL
      if (developmentUrl) {
        await window.loadURL(new URL('print.html', `${developmentUrl}/`).toString())
      } else {
        await window.loadURL('spack-app://renderer/print.html')
      }
      await ready
      return await window.webContents.printToPDF({
        pageSize: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        margins: {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        },
      })
    } finally {
      this.#pending.delete(window.webContents.id)
      if (!window.isDestroyed()) window.destroy()
    }
  }
}
