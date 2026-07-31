import type {
  OfficeFormat,
  MaterialSource,
  Project,
  SourceTypeSchema,
  ValidationMessage,
  ValidationStatus,
} from '../schemas/project-schema.js'
import type { z } from 'zod'

export type SourceType = z.infer<typeof SourceTypeSchema>

export type ImportCandidate = {
  id: string
  originalPath: string
  originalFileName: string
  sourceType: 'pdf' | 'image' | 'office'
  officeFormat?: OfficeFormat
  fileHash: string
  fileSize: number
  modifiedTime: number
  mimeType: string
  pageCount: number
  width?: number
  height?: number
  exifOrientation?: number
  validationStatus: ValidationStatus
  validationMessages: ValidationMessage[]
  duplicateMaterialIds: string[]
  conversion?: {
    adapterId: 'libreoffice'
    engineVersion: string
    officeFormat: OfficeFormat
    fileHash: string
    fileSize: number
    pageCount: number
    convertedAt: string
    warnings: string[]
  }
}

export type ImportAnalysis = {
  taskId: string
  token: string
  candidates: ImportCandidate[]
  expiresAt: string
}

export type DuplicateResolution =
  | {
      candidateId: string
      action: 'import' | 'skip'
    }
  | {
      candidateId: string
      action: 'replace'
      materialId: string
    }

export type ImportCommitInput = {
  token: string
  targetOutlineNodeId: string
  materialGrouping: 'separate' | 'singleResult'
  groupedMaterialTitle?: string
  imageGrouping: 'separate' | 'collection'
  resolutions: DuplicateResolution[]
}

export type ImportCommitResult = {
  project: Project
  importedMaterialIds: string[]
  skippedCount: number
  replacedMaterialIds: string[]
}

export type ValidatedSource = {
  sourceType: 'pdf' | 'image' | 'office'
  source: Omit<MaterialSource, 'id' | 'sourcePath' | 'storedPath'>
  validationStatus: ValidationStatus
  validationMessages: ValidationMessage[]
  officeFormat?: OfficeFormat
  officeHasPrintSettings?: boolean
}

export type ImportAnalysisProgress = {
  taskId: string
  stageLabel: string
  currentFile: string
  processedFiles: number
  totalFiles: number
  percentage: number
  cancellable: boolean
}

export type OfficeReconversionResult =
  | {
      status: 'completed'
      project: Project
      pageCountChanged: boolean
      previousPageCount: number
      pageCount: number
    }
  | {
      status: 'confirmation-required'
      previousPageCount: number
      pageCount: number
    }
