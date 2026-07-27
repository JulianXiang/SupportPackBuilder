import type { PrintPayload } from '../../shared/types/print.js'

declare global {
  interface Window {
    printBridge: {
      getPayload: () => Promise<PrintPayload>
      ready: () => void
    }
  }
}

export {}
