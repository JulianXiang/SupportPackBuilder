import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/constants/ipc.js'
import type { ProjectCreateInput } from '../shared/schemas/ipc-schema.js'
import type { ExportProgress, ExportResult } from '../shared/types/export.js'
import type {
  ImportAnalysis,
  ImportAnalysisProgress,
  ImportCommitInput,
} from '../shared/types/import.js'
import type { Result } from '../shared/types/result.js'
import type { AppCommand, SupportPackApi } from './api-types.js'

const invoke = async <T>(channel: string, input: unknown = {}): Promise<Result<T>> =>
  (await ipcRenderer.invoke(channel, input)) as Result<T>

const droppedCallbacks = new Set<(result: Result<ImportAnalysis>) => void>()

window.addEventListener(
  'dragover',
  (event) => {
    event.preventDefault()
  },
  { capture: true },
)

window.addEventListener(
  'drop',
  (event) => {
    event.preventDefault()
    const paths = Array.from(event.dataTransfer?.files ?? [])
      .map((file) => webUtils.getPathForFile(file))
      .filter((path) => path.length > 0)
    if (paths.length === 0) return
    void invoke<ImportAnalysis>(IPC_CHANNELS.importDropped, { paths }).then((result) => {
      droppedCallbacks.forEach((callback) => callback(result))
    })
  },
  { capture: true },
)

const api: SupportPackApi = {
  project: {
    create: async (input: ProjectCreateInput) => await invoke(IPC_CHANNELS.projectCreate, input),
    createSample: async () => await invoke(IPC_CHANNELS.projectCreateSample),
    open: async () => await invoke(IPC_CHANNELS.projectOpen),
    openRecent: async (projectDirectory) =>
      await invoke(IPC_CHANNELS.projectOpenRecent, { projectDirectory }),
    save: async (input) => await invoke(IPC_CHANNELS.projectSave, input),
    saveAs: async (input) => await invoke(IPC_CHANNELS.projectSaveAs, input),
    duplicate: async (input) => await invoke(IPC_CHANNELS.projectDuplicate, input),
    exportPortable: async (input) => await invoke(IPC_CHANNELS.projectExportPortable, input),
    importPortable: async () => await invoke(IPC_CHANNELS.projectImportPortable),
    relocateMissing: async (input) => await invoke(IPC_CHANNELS.projectRelocateMissing, input),
    recent: async () => await invoke(IPC_CHANNELS.projectRecentList),
    removeRecent: async (projectDirectory) =>
      await invoke(IPC_CHANNELS.projectRecentRemove, { projectDirectory }),
    clearCache: async () => await invoke(IPC_CHANNELS.projectClearCache),
  },
  import: {
    selectFiles: async () => await invoke(IPC_CHANNELS.importSelect),
    selectFolder: async () => await invoke(IPC_CHANNELS.importFolder),
    commit: async (input: ImportCommitInput) => await invoke(IPC_CHANNELS.importCommit, input),
    cancelAnalysis: async (identifier) =>
      await invoke(IPC_CHANNELS.importCancelAnalysis, { identifier }),
    reconvertOffice: async (input) => await invoke(IPC_CHANNELS.importReconvertOffice, input),
    onAnalysisProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: ImportAnalysisProgress,
      ): void => {
        callback(progress)
      }
      ipcRenderer.on(IPC_CHANNELS.importAnalysisProgress, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.importAnalysisProgress, listener)
    },
    onDropped: (callback) => {
      droppedCallbacks.add(callback)
      return () => droppedCallbacks.delete(callback)
    },
  },
  preview: {
    plan: async (input) => await invoke(IPC_CHANNELS.previewPlan, input),
    thumbnail: async (input) => await invoke(IPC_CHANNELS.previewThumbnail, input),
    sourceThumbnail: async (input) => await invoke(IPC_CHANNELS.previewSourceThumbnail, input),
    detectCrop: async (input) => await invoke(IPC_CHANNELS.previewDetectCrop, input),
    refresh: async () => await invoke(IPC_CHANNELS.previewRefresh),
  },
  export: {
    preflight: async (input) => await invoke(IPC_CHANNELS.exportPreflight, input),
    start: async (taskId) => await invoke(IPC_CHANNELS.exportStart, { taskId }),
    cancel: async (taskId) => await invoke(IPC_CHANNELS.exportCancel, { taskId }),
    onProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: ExportProgress): void => {
        callback(progress)
      }
      ipcRenderer.on(IPC_CHANNELS.exportProgress, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.exportProgress, listener)
    },
    onFinished: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, result: ExportResult): void => {
        callback(result)
      }
      ipcRenderer.on(IPC_CHANNELS.exportFinished, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.exportFinished, listener)
    },
  },
  system: {
    openPath: async (path) => await invoke(IPC_CHANNELS.systemOpenPath, { path }),
    revealPath: async (path) => await invoke(IPC_CHANNELS.systemRevealPath, { path }),
    openExternal: async (url) => await invoke(IPC_CHANNELS.systemOpenExternal, { url }),
  },
  app: {
    setDirty: (dirty) => ipcRenderer.send(IPC_CHANNELS.appSetDirty, { dirty }),
    respondToClose: (action) => ipcRenderer.send(IPC_CHANNELS.appCloseResponse, { action }),
    onBeforeClose: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC_CHANNELS.appBeforeClose, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.appBeforeClose, listener)
    },
    onCommand: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, command: AppCommand): void => {
        callback(command)
      }
      ipcRenderer.on(IPC_CHANNELS.appCommand, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.appCommand, listener)
    },
  },
  preferences: {
    get: async () => await invoke(IPC_CHANNELS.preferencesGet),
    update: async (input) => await invoke(IPC_CHANNELS.preferencesUpdate, input),
  },
}

contextBridge.exposeInMainWorld('supportPack', api)
