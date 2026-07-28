import type { OfficeFormat } from '../../shared/schemas/project-schema.js'

export type OfficeConversionRequest = {
  sourcePath: string
  officeFormat: OfficeFormat
  workingDirectory: string
  hasPrintSettings: boolean
  signal: AbortSignal
  onProgress?: (stageLabel: string, percentage: number) => void
}

export type OfficeConversionResult = {
  adapterId: 'libreoffice'
  engineVersion: string
  officeFormat: OfficeFormat
  pdfPath: string
  fileHash: string
  fileSize: number
  pageCount: number
  convertedAt: string
  warnings: string[]
}

export type FileConversionAdapter = {
  readonly id: 'libreoffice'
  supports(format: OfficeFormat): boolean
  convert(request: OfficeConversionRequest): Promise<OfficeConversionResult>
}
