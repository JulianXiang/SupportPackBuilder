import type { PagePlan } from '../schemas/page-plan-schema.js'
import type { Project } from '../schemas/project-schema.js'
import type { ExportProgress, ExportResult } from './export.js'

export type GeneratedPageReference = {
  pdfPath: string
  pageIndex: number
}

export type PdfExportWorkerStart = {
  type: 'start'
  taskId: string
  projectDirectory: string
  outputPath: string
  reportPath: string
  project: Project
  plan: PagePlan
  generatedPages: Record<string, GeneratedPageReference>
  fontPath?: string
  boldFontPath?: string
}

export type PdfExportWorkerCancel = {
  type: 'cancel'
  taskId: string
}

export type PdfExportWorkerRequest = PdfExportWorkerStart | PdfExportWorkerCancel

export type PdfExportWorkerProgress = {
  type: 'progress'
  progress: ExportProgress
}

export type PdfExportWorkerReady = {
  type: 'ready'
}

export type PdfExportWorkerResult = {
  type: 'result'
  taskId: string
  result: ExportResult
}

export type PdfExportWorkerMessage =
  PdfExportWorkerReady | PdfExportWorkerProgress | PdfExportWorkerResult
