import type {
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
  sourceType: 'pdf' | 'image'
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
}

export type ImportAnalysis = {
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
  sourceType: 'pdf' | 'image'
  source: Omit<MaterialSource, 'id' | 'sourcePath' | 'storedPath'>
  validationStatus: ValidationStatus
  validationMessages: ValidationMessage[]
}
