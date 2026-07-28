import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc.js'
import {
  EmptyInputSchema,
  PreviewPlanInputSchema,
  PreviewThumbnailInputSchema,
} from '../../shared/schemas/ipc-schema.js'
import type { AppRuntime } from '../app-runtime.js'
import { registerValidatedHandler } from './ipc-helpers.js'

export const registerPreviewIpc = (input: {
  mainWindow: BrowserWindow
  runtime: AppRuntime
}): void => {
  const { mainWindow, runtime } = input
  registerValidatedHandler({
    channel: IPC_CHANNELS.previewPlan,
    schema: PreviewPlanInputSchema,
    stage: '计算页面预览',
    mainWindow,
    handler: async ({ project, expectedRevision }) =>
      await runtime.preparePreview(project, expectedRevision),
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.previewRefresh,
    schema: EmptyInputSchema,
    stage: '刷新页面预览',
    mainWindow,
    handler: async () => await runtime.preparePreview(),
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.previewThumbnail,
    schema: PreviewThumbnailInputSchema,
    stage: '生成缩略图',
    mainWindow,
    handler: async ({ pageId, planFingerprint, width }) => {
      const session = runtime.requireSession()
      const prepared = runtime.getPreparedPreview(planFingerprint)
      const plan = prepared.plan
      const page = plan.pages.find((candidate) => candidate.id === pageId)
      if (!page) throw new Error('页面计划已变化，请刷新预览。')
      const cacheId = await runtime.thumbnailService?.createThumbnail({
        projectDirectory: session.projectDirectory,
        project: session.project,
        page,
        width,
        planFingerprint,
        ...(prepared.generatedPages[page.id]
          ? { generatedPage: prepared.generatedPages[page.id] }
          : {}),
      })
      return { url: cacheId ? `spack-cache://cache/${encodeURIComponent(cacheId)}` : null }
    },
  })
}
