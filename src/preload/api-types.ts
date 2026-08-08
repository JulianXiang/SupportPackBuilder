import type { PagePlan } from '../shared/schemas/page-plan-schema.js'
import type { Project } from '../shared/schemas/project-schema.js'
import type { ProjectCreateInput } from '../shared/schemas/ipc-schema.js'
import type { AppPreferences, AppPreferencesUpdate } from '../shared/schemas/preferences-schema.js'
import type { ExportPreflight, ExportProgress, ExportResult } from '../shared/types/export.js'
import type {
  ImportAnalysis,
  ImportAnalysisProgress,
  ImportCommitInput,
  ImportCommitResult,
  OfficeReconversionResult,
} from '../shared/types/import.js'
import type { Result } from '../shared/types/result.js'

export type ProjectSessionView = {
  project: Project
  projectDirectory: string
  revision: number
}

export type RecentProjectView = {
  projectDirectory: string
  title: string
  lastOpenedAt: string
}

export type AppCommand =
  | 'new-project'
  | 'open-project'
  | 'save-project'
  | 'save-as-project'
  | 'import-files'
  | 'export-pdf'
  | 'undo'
  | 'redo'
  | 'delete-selection'

export type SupportPackApi = {
  project: {
    create(input: ProjectCreateInput): Promise<Result<ProjectSessionView | null>>
    createSample(): Promise<Result<ProjectSessionView | null>>
    open(): Promise<Result<ProjectSessionView | null>>
    openRecent(projectDirectory: string): Promise<Result<ProjectSessionView>>
    save(input: { project: Project; expectedRevision: number }): Promise<Result<ProjectSessionView>>
    saveAs(input: {
      project: Project
      expectedRevision: number
    }): Promise<Result<ProjectSessionView | null>>
    duplicate(input: { newTitle: string }): Promise<Result<ProjectSessionView | null>>
    exportPortable(input: {
      project: Project
      expectedRevision: number
    }): Promise<Result<{ outputPath: string; assetCount: number } | null>>
    importPortable(): Promise<Result<ProjectSessionView | null>>
    relocateMissing(input: {
      materialId: string
      sourceId: string
    }): Promise<Result<ProjectSessionView | null>>
    recent(): Promise<Result<RecentProjectView[]>>
    removeRecent(projectDirectory: string): Promise<Result<void>>
    clearCache(): Promise<Result<void>>
  }
  import: {
    selectFiles(): Promise<Result<ImportAnalysis | null>>
    selectFolder(): Promise<Result<ImportAnalysis | null>>
    commit(input: ImportCommitInput): Promise<Result<ImportCommitResult>>
    cancelAnalysis(identifier: string): Promise<Result<void>>
    reconvertOffice(input: {
      materialId: string
      sourceId?: string
      confirmPageReset: boolean
    }): Promise<Result<OfficeReconversionResult>>
    onAnalysisProgress(callback: (progress: ImportAnalysisProgress) => void): () => void
    onDropped(callback: (result: Result<ImportAnalysis>) => void): () => void
  }
  preview: {
    plan(input: {
      project: Project
      expectedRevision: number
      tocPageCount?: number
    }): Promise<Result<PagePlan>>
    thumbnail(input: {
      pageId: string
      planFingerprint: string
      width: number
    }): Promise<Result<{ url: string | null }>>
    sourceThumbnail(input: {
      sourcePageId: string
      planFingerprint: string
      width: number
    }): Promise<Result<{ url: string | null }>>
    detectCrop(input: { sourcePageId: string; planFingerprint: string }): Promise<
      Result<{
        cropRect: { x: number; y: number; width: number; height: number }
        message: string
      }>
    >
    refresh(): Promise<Result<PagePlan>>
  }
  export: {
    preflight(input: {
      project: Project
      expectedRevision: number
    }): Promise<Result<ExportPreflight>>
    start(taskId: string): Promise<Result<{ started: boolean } | null>>
    cancel(taskId: string): Promise<Result<void>>
    onProgress(callback: (progress: ExportProgress) => void): () => void
    onFinished(callback: (result: ExportResult) => void): () => void
  }
  system: {
    openPath(path: string): Promise<Result<void>>
    revealPath(path: string): Promise<Result<void>>
    openExternal(url: string): Promise<Result<void>>
  }
  app: {
    setDirty(dirty: boolean): void
    respondToClose(action: 'save' | 'discard' | 'cancel'): void
    onBeforeClose(callback: () => void): () => void
    onCommand(callback: (command: AppCommand) => void): () => void
  }
  preferences: {
    get(): Promise<Result<AppPreferences>>
    update(input: AppPreferencesUpdate): Promise<Result<AppPreferences>>
  }
}

declare global {
  interface Window {
    supportPack: SupportPackApi
  }
}
