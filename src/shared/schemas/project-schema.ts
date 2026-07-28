import { z } from 'zod'
import {
  DEFAULT_PAGE_MARGINS_POINTS,
  DEFAULT_PAGE_NUMBER_BOTTOM_OFFSET_POINTS,
} from '../constants/document.js'

export const AssetStorageModeSchema = z.enum(['copy', 'reference'])
export const SourceTypeSchema = z.enum(['pdf', 'image', 'imageCollection', 'office'])
export const OfficeFormatSchema = z.enum(['docx', 'pptx', 'xlsx'])
export const ConversionSnapshotStatusSchema = z.enum(['ready', 'stale', 'error'])
export const ValidationStatusSchema = z.enum([
  'valid',
  'warning',
  'error',
  'missing',
  'encrypted',
  'unsupported',
])
export const IssueSeveritySchema = z.enum(['error', 'warning', 'info'])
export const RotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
export const TargetOrientationSchema = z.enum(['portrait', 'landscape'])
export const ImageQualitySchema = z.enum(['screen', 'standard', 'high'])
export const PageNumberPositionSchema = z.enum(['bottomCenter', 'bottomRight'])
export const PageNumberFormatSchema = z.enum(['number', 'dash', 'chinese', 'fraction'])
export const ContentHeadingModeSchema = z.enum(['none', 'firstPage'])

export const ValidationMessageSchema = z.object({
  code: z.string().min(1).max(100),
  severity: IssueSeveritySchema,
  message: z.string().min(1).max(1000),
  suggestion: z.string().max(1000).optional(),
})

export const OfficeConversionSchema = z.object({
  adapterId: z.literal('libreoffice'),
  engineVersion: z.string().min(1).max(100),
  officeFormat: OfficeFormatSchema,
  pdfStoredPath: z.string().min(1).max(4096),
  sourceFileHash: z.string().regex(/^[a-f0-9]{64}$/i),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i),
  fileSize: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  convertedAt: z.iso.datetime(),
  snapshotStatus: ConversionSnapshotStatusSchema,
  warnings: z.array(z.string().min(1).max(1000)).max(100),
})

export const MaterialSourceSchema = z.object({
  id: z.uuid(),
  sourcePath: z.string().min(1),
  storedPath: z.string().min(1).nullable(),
  originalFileName: z.string().min(1).max(255),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i),
  fileSize: z.number().int().nonnegative(),
  modifiedTime: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(200),
  pageCount: z.number().int().positive(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  exifOrientation: z.number().int().min(1).max(8).optional(),
  conversion: OfficeConversionSchema.optional(),
})

export const MaterialSchema = z
  .object({
    id: z.uuid(),
    outlineNodeId: z.uuid(),
    title: z.string().min(1).max(300),
    category: z.string().max(100),
    sourceType: SourceTypeSchema,
    sourcePath: z.string().min(1),
    storedPath: z.string().min(1).nullable(),
    originalFileName: z.string().min(1).max(255),
    fileHash: z.string().regex(/^[a-f0-9]{64}$/i),
    fileSize: z.number().int().nonnegative(),
    modifiedTime: z.number().int().nonnegative(),
    pageCount: z.number().int().positive(),
    selectedPageRanges: z.string().min(1).max(4096),
    pageOrder: z.array(z.string().min(1)),
    rotationByPage: z.record(z.string(), RotationSchema),
    removedPages: z.array(z.string().min(1)),
    enabled: z.boolean(),
    startOnNewPage: z.literal(true),
    insertTitlePage: z.boolean(),
    notes: z.string().max(5000),
    validationStatus: ValidationStatusSchema,
    validationMessages: z.array(ValidationMessageSchema),
    order: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    sourceItems: z.array(MaterialSourceSchema).min(1),
  })
  .superRefine((material, context) => {
    if (material.sourceType === 'imageCollection' && material.sourceItems.length < 2) {
      context.addIssue({
        code: 'custom',
        path: ['sourceItems'],
        message: '图片集合至少需要两张图片。',
      })
    }
    if (material.sourceType !== 'imageCollection' && material.sourceItems.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['sourceItems'],
        message: '单文件材料必须且只能包含一个来源文件。',
      })
    }
    if (
      material.sourceType === 'office' &&
      material.sourceItems.some((source) => !source.conversion)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceItems'],
        message: 'Office 材料必须包含可用的 PDF 转换快照。',
      })
    }
    if (
      material.sourceType !== 'office' &&
      material.sourceItems.some((source) => source.conversion !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceItems'],
        message: '非 Office 材料不能包含 Office 转换快照。',
      })
    }
  })

export type Material = z.infer<typeof MaterialSchema>

export type OutlineNode = {
  id: string
  parentId: string | null
  level: 1 | 2
  title: string
  order: number
  enabled: boolean
  insertDividerPage: boolean
  children: OutlineNode[]
  materials: Material[]
}

export const OutlineNodeSchema: z.ZodType<OutlineNode> = z.lazy(() =>
  z.object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    level: z.union([z.literal(1), z.literal(2)]),
    title: z.string().min(1).max(200),
    order: z.number().int().nonnegative(),
    enabled: z.boolean(),
    insertDividerPage: z.boolean(),
    children: z.array(OutlineNodeSchema),
    materials: z.array(MaterialSchema),
  }),
)

export const CoverSettingsSchema = z.object({
  enabled: z.boolean(),
  title: z.string().min(1).max(300),
  ownerName: z.string().max(100),
  organization: z.string().max(200),
  purpose: z.string().max(500),
  compiledDate: z.iso.date(),
  insertBlankBackPage: z.boolean().default(true),
  showPageNumber: z.boolean(),
  countInLogicalNumber: z.boolean(),
})

export const TocSettingsSchema = z.object({
  enabled: z.boolean(),
  title: z.string().min(1).max(100),
  showPageNumber: z.boolean(),
  countInLogicalNumber: z.boolean(),
})

export const PageNumberSettingsSchema = z.object({
  enabled: z.boolean(),
  bodyStartNumber: z.number().int().positive(),
  position: PageNumberPositionSchema,
  format: PageNumberFormatSchema,
  fontSize: z.number().min(8).max(18),
  bottomOffsetPoints: z.number().min(8).max(30),
  showOnDivider: z.boolean(),
  showOnMaterialTitle: z.boolean(),
})

export const PdfMetadataSchema = z.object({
  title: z.string().max(300),
  author: z.string().max(200),
  subject: z.string().max(500),
  creator: z.string().max(200),
  producer: z.string().max(200),
})

export const ExportSettingsSchema = z.object({
  outputFileName: z.string().min(1).max(255),
  includeCover: z.boolean(),
  includeToc: z.boolean(),
  includeDividerPages: z.boolean(),
  includeMaterialTitlePages: z.boolean(),
  contentHeadingMode: ContentHeadingModeSchema.default('firstPage'),
  addPageNumbers: z.boolean(),
  targetOrientation: TargetOrientationSchema,
  margins: z.object({
    top: z.number().min(0).max(144),
    right: z.number().min(0).max(144),
    bottom: z.number().min(0).max(144),
    left: z.number().min(0).max(144),
  }),
  imageQuality: ImageQualitySchema,
  metadata: PdfMetadataSchema,
  overwriteExisting: z.boolean(),
  openAfterExport: z.boolean(),
  revealAfterExport: z.boolean(),
})

export const ProjectSchema = z
  .object({
    id: z.uuid(),
    schemaVersion: z.literal(2),
    title: z.string().min(1).max(300),
    ownerName: z.string().max(100),
    organization: z.string().max(200),
    purpose: z.string().max(500),
    compiledDate: z.iso.date(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    projectDirectory: z.literal('.'),
    assetStorageMode: AssetStorageModeSchema,
    coverSettings: CoverSettingsSchema,
    tocSettings: TocSettingsSchema,
    pageNumberSettings: PageNumberSettingsSchema,
    exportSettings: ExportSettingsSchema,
    outlineNodes: z.array(OutlineNodeSchema),
  })
  .superRefine((project, context) => {
    const ids = new Set<string>()
    const visit = (
      node: OutlineNode,
      expectedParent: string | null,
      expectedLevel: 1 | 2,
    ): void => {
      if (ids.has(node.id)) {
        context.addIssue({
          code: 'custom',
          path: ['outlineNodes'],
          message: `目录节点 ID 重复：${node.id}`,
        })
      }
      ids.add(node.id)
      if (node.parentId !== expectedParent || node.level !== expectedLevel) {
        context.addIssue({
          code: 'custom',
          path: ['outlineNodes'],
          message: `目录“${node.title}”的层级或父节点配置无效。`,
        })
      }
      if (node.level === 1 && node.materials.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['outlineNodes'],
          message: `一级目录“${node.title}”不能直接包含材料。`,
        })
      }
      if (node.level === 2 && node.children.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['outlineNodes'],
          message: `二级目录“${node.title}”不能继续包含子目录。`,
        })
      }
      node.materials.forEach((material) => {
        if (material.outlineNodeId !== node.id) {
          context.addIssue({
            code: 'custom',
            path: ['outlineNodes'],
            message: `材料“${material.title}”引用了错误的目录节点。`,
          })
        }
      })
      node.children.forEach((child) => {
        visit(child, node.id, 2)
      })
    }
    project.outlineNodes.forEach((node) => {
      visit(node, null, 1)
    })
  })

export type Project = z.infer<typeof ProjectSchema>
export type MaterialSource = z.infer<typeof MaterialSourceSchema>
export type OfficeConversion = z.infer<typeof OfficeConversionSchema>
export type OfficeFormat = z.infer<typeof OfficeFormatSchema>
export type ValidationMessage = z.infer<typeof ValidationMessageSchema>
export type Rotation = z.infer<typeof RotationSchema>
export type ValidationStatus = z.infer<typeof ValidationStatusSchema>
export type TargetOrientation = z.infer<typeof TargetOrientationSchema>
export type ImageQuality = z.infer<typeof ImageQualitySchema>
export type ContentHeadingMode = z.infer<typeof ContentHeadingModeSchema>

export const createDefaultProject = (
  input: {
    title: string
    ownerName?: string
    organization?: string
    purpose?: string
    compiledDate?: string
    outlineNodes?: OutlineNode[]
  },
  now = new Date(),
): Project => {
  const iso = now.toISOString()
  const date = input.compiledDate ?? iso.slice(0, 10)
  const ownerName = input.ownerName ?? ''
  const organization = input.organization ?? ''
  const purpose = input.purpose ?? ''

  return ProjectSchema.parse({
    id: crypto.randomUUID(),
    schemaVersion: 2,
    title: input.title,
    ownerName,
    organization,
    purpose,
    compiledDate: date,
    createdAt: iso,
    updatedAt: iso,
    projectDirectory: '.',
    assetStorageMode: 'copy',
    coverSettings: {
      enabled: true,
      title: input.title,
      ownerName,
      organization,
      purpose,
      compiledDate: date,
      insertBlankBackPage: true,
      showPageNumber: false,
      countInLogicalNumber: false,
    },
    tocSettings: {
      enabled: true,
      title: '支撑材料目录',
      showPageNumber: false,
      countInLogicalNumber: false,
    },
    pageNumberSettings: {
      enabled: true,
      bodyStartNumber: 1,
      position: 'bottomCenter',
      format: 'dash',
      fontSize: 12,
      bottomOffsetPoints: DEFAULT_PAGE_NUMBER_BOTTOM_OFFSET_POINTS,
      showOnDivider: true,
      showOnMaterialTitle: true,
    },
    exportSettings: {
      outputFileName: `${input.title}.pdf`,
      includeCover: true,
      includeToc: true,
      includeDividerPages: true,
      includeMaterialTitlePages: true,
      contentHeadingMode: 'firstPage',
      addPageNumbers: true,
      targetOrientation: 'portrait',
      margins: DEFAULT_PAGE_MARGINS_POINTS,
      imageQuality: 'standard',
      metadata: {
        title: input.title,
        author: ownerName,
        subject: purpose,
        creator: '个人支撑材料编排器',
        producer: 'SupportPack Builder',
      },
      overwriteExisting: false,
      openAfterExport: false,
      revealAfterExport: true,
    },
    outlineNodes: input.outlineNodes ?? [],
  })
}
