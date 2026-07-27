import type { PagePlan } from '../schemas/page-plan-schema.js'

export type ExportStage =
  | 'validating'
  | 'planning'
  | 'cover'
  | 'toc'
  | 'pdf'
  | 'image'
  | 'numbering'
  | 'verifying'
  | 'saving'
  | 'completed'
  | 'cancelled'

export type ExportProgress = {
  taskId: string
  stage: ExportStage
  stageLabel: string
  currentOutline?: string
  currentMaterial?: string
  currentFile?: string
  processedPages: number
  totalPages: number
  percentage: number
  elapsedMilliseconds: number
  warning?: string
}

export type ExportReportCheck = {
  code: string
  label: string
  passed: boolean
  detail: string
}

export type ExportReport = {
  exportId: string
  createdAt: string
  outputPath: string
  planFingerprint: string
  pageCount: number
  checks: ExportReportCheck[]
  warnings: string[]
}

export type ExportResult = {
  status: 'success' | 'cancelled' | 'failed'
  outputPath?: string
  reportPath?: string
  report?: ExportReport
  message: string
}

export type ExportPreflight = {
  taskId: string
  plan: PagePlan
  errors: string[]
  warnings: string[]
  information: {
    materialCount: number
    totalPages: number
    tocPages: number
    estimatedFileSize: number
    includesCover: boolean
    bodyStartNumber: number
  }
}
