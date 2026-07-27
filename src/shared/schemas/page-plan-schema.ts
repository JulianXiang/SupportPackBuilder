import { z } from 'zod'
import {
  IssueSeveritySchema,
  RotationSchema,
  TargetOrientationSchema,
  ValidationStatusSchema,
} from './project-schema.js'

export const PageTypeSchema = z.enum([
  'cover',
  'blank',
  'toc',
  'divider',
  'materialTitle',
  'pdfContent',
  'imageContent',
])

export const LogicalPageNumberSchema = z.object({
  value: z.number().int().positive(),
  label: z.string().min(1),
})

export const ValidationIssueSchema = z.object({
  code: z.string().min(1),
  severity: IssueSeveritySchema,
  message: z.string().min(1),
  outlineNodeId: z.uuid().nullable(),
  materialId: z.uuid().nullable(),
})

export const InlineHeadingSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string().min(1),
})

export const PlannedPageSchema = z.object({
  id: z.string().min(1),
  physicalIndex: z.number().int().nonnegative(),
  pageType: PageTypeSchema,
  outlineNodeId: z.uuid().nullable(),
  materialId: z.uuid().nullable(),
  sourceId: z.uuid().nullable(),
  sourceFile: z.string().nullable(),
  sourcePageIndex: z.number().int().nonnegative().nullable(),
  sourcePageId: z.string().nullable(),
  displayTitle: z.string(),
  inlineHeadings: z.array(InlineHeadingSchema),
  logicalPageNumber: LogicalPageNumberSchema.nullable(),
  showPageNumber: z.boolean(),
  printedPageLabel: z.string().nullable(),
  rotation: RotationSchema,
  targetOrientation: TargetOrientationSchema,
  validationStatus: ValidationStatusSchema,
})

export const TocEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['level1', 'level2', 'material']),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().min(1),
  outlineNodeId: z.uuid().nullable(),
  materialId: z.uuid().nullable(),
  logicalPageNumber: z.number().int().positive(),
})

export const PlannedSectionSchema = z.object({
  id: z.string().min(1),
  outlineNodeId: z.uuid().nullable(),
  materialId: z.uuid().nullable(),
  startPhysicalIndex: z.number().int().nonnegative(),
  endPhysicalIndex: z.number().int().nonnegative(),
  startLogicalPage: z.number().int().positive().nullable(),
  endLogicalPage: z.number().int().positive().nullable(),
})

export const PagePlanSchema = z.object({
  planFingerprint: z.string().min(1),
  projectId: z.uuid(),
  revision: z.number().int().nonnegative(),
  totalPageCount: z.number().int().nonnegative(),
  logicalPageCount: z.number().int().nonnegative(),
  tocPageCount: z.number().int().nonnegative(),
  pages: z.array(PlannedPageSchema),
  sections: z.array(PlannedSectionSchema),
  outlineStartPages: z.record(z.string(), z.number().int().positive()),
  materialStartPages: z.record(z.string(), z.number().int().positive()),
  materialEndPages: z.record(z.string(), z.number().int().positive()),
  tocEntries: z.array(TocEntrySchema),
  errors: z.array(ValidationIssueSchema),
  warnings: z.array(ValidationIssueSchema),
})

export type PageType = z.infer<typeof PageTypeSchema>
export type LogicalPageNumber = z.infer<typeof LogicalPageNumberSchema>
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>
export type InlineHeading = z.infer<typeof InlineHeadingSchema>
export type PlannedPage = z.infer<typeof PlannedPageSchema>
export type TocEntry = z.infer<typeof TocEntrySchema>
export type PlannedSection = z.infer<typeof PlannedSectionSchema>
export type PagePlan = z.infer<typeof PagePlanSchema>
