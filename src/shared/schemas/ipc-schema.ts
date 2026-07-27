import { z } from 'zod'
import { ProjectSchema } from './project-schema.js'

export const EmptyInputSchema = z.object({}).strict()

export const ProjectCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  ownerName: z.string().trim().max(100).default(''),
  organization: z.string().trim().max(200).default(''),
  purpose: z.string().trim().max(500).default(''),
  compiledDate: z.iso.date(),
  templateId: z.string().min(1).max(100),
})

export const ProjectSaveInputSchema = z.object({
  project: ProjectSchema,
  expectedRevision: z.number().int().nonnegative(),
})

export const ProjectSaveAsInputSchema = z.object({
  project: ProjectSchema,
  expectedRevision: z.number().int().nonnegative(),
})

export const ProjectDuplicateInputSchema = z.object({
  newTitle: z.string().trim().min(1).max(300),
})

export const ProjectRelocateMissingInputSchema = z.object({
  materialId: z.uuid(),
  sourceId: z.uuid(),
})

export const RecentProjectRemoveInputSchema = z.object({
  projectDirectory: z.string().min(1).max(4096),
})

export const RecentProjectOpenInputSchema = RecentProjectRemoveInputSchema

export const ImportCommitInputSchema = z.object({
  token: z.uuid(),
  targetOutlineNodeId: z.uuid(),
  imageGrouping: z.enum(['separate', 'collection']),
  resolutions: z.array(
    z.discriminatedUnion('action', [
      z.object({ candidateId: z.uuid(), action: z.literal('import') }),
      z.object({ candidateId: z.uuid(), action: z.literal('skip') }),
      z.object({
        candidateId: z.uuid(),
        action: z.literal('replace'),
        materialId: z.uuid(),
      }),
    ]),
  ),
})

export const DroppedPathsInputSchema = z.object({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
})

export const PreviewPlanInputSchema = z.object({
  project: ProjectSchema,
  expectedRevision: z.number().int().nonnegative(),
  tocPageCount: z.number().int().nonnegative().max(100).optional(),
})

export const PreviewThumbnailInputSchema = z.object({
  pageId: z.string().min(1).max(500),
  width: z.number().int().min(120).max(900),
})

export const ExportPreflightInputSchema = z.object({
  project: ProjectSchema,
  expectedRevision: z.number().int().nonnegative(),
})

export const ExportStartInputSchema = z.object({
  taskId: z.uuid(),
})

export const ExportCancelInputSchema = z.object({
  taskId: z.uuid(),
})

export const SystemPathInputSchema = z.object({
  path: z.string().min(1).max(4096),
})

export const SystemExternalInputSchema = z.object({
  url: z.url().max(2048),
})

export const AppDirtyInputSchema = z.object({ dirty: z.boolean() })

export const AppCloseResponseInputSchema = z.object({
  action: z.enum(['save', 'discard', 'cancel']),
})

export type ProjectCreateInput = z.infer<typeof ProjectCreateInputSchema>
export type ProjectSaveInput = z.infer<typeof ProjectSaveInputSchema>
export type PreviewPlanInput = z.infer<typeof PreviewPlanInputSchema>
export type PreviewThumbnailInput = z.infer<typeof PreviewThumbnailInputSchema>
