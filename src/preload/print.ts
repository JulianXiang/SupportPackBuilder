import { contextBridge, ipcRenderer } from 'electron'
import type { PrintPayload } from '../shared/types/print.js'

const PRINT_GET_PAYLOAD_CHANNEL = 'print:get-payload'
const PRINT_READY_CHANNEL = 'print:ready'

const printBridge = {
  getPayload: async (): Promise<PrintPayload> =>
    (await ipcRenderer.invoke(PRINT_GET_PAYLOAD_CHANNEL)) as PrintPayload,
  ready: (): void => {
    ipcRenderer.send(PRINT_READY_CHANNEL)
  },
}

contextBridge.exposeInMainWorld('printBridge', printBridge)
