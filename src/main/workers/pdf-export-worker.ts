import type {
  PdfExportWorkerMessage,
  PdfExportWorkerRequest,
} from '../../shared/types/worker-protocol.js'
import { executePdfExport } from '../services/pdf-export-service.js'

const parentPort = process.parentPort
const cancelledTasks = new Set<string>()

const postMessage = (message: PdfExportWorkerMessage): void => {
  parentPort.postMessage(message)
}

parentPort.on('message', (event: { data: PdfExportWorkerRequest }) => {
  const request = event.data
  if (request.type === 'cancel') {
    cancelledTasks.add(request.taskId)
    return
  }
  void executePdfExport(request, {
    isCancelled: () => cancelledTasks.has(request.taskId),
    onProgress: (progress) => {
      postMessage({ type: 'progress', progress })
    },
  }).then((result) => {
    postMessage({
      type: 'result',
      taskId: request.taskId,
      result,
    })
  })
})

postMessage({ type: 'ready' })
