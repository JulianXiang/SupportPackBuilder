import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc.js'
import {
  EmptyInputSchema,
  PreviewDetectCropInputSchema,
  PreviewPlanInputSchema,
  PreviewSourceThumbnailInputSchema,
  PreviewThumbnailInputSchema,
} from '../../shared/schemas/ipc-schema.js'
import type { PagePlan, PlannedPage } from '../../shared/schemas/page-plan-schema.js'
import type { AppRuntime } from '../app-runtime.js'
import { registerValidatedHandler } from './ipc-helpers.js'

const resolveSourcePreviewPage = (plan: PagePlan, sourcePageId: string): PlannedPage | null => {
  const ordinaryPage = plan.pages.find(
    (page) => page.sourcePageId === sourcePageId && page.pageType !== 'compositeContent',
  )
  if (ordinaryPage) return ordinaryPage
  const compositeEntry = plan.pages
    .flatMap((page) => page.composite?.contentItems ?? [])
    .find((item) => item.sourcePageId === sourcePageId)
  if (!compositeEntry) return null
  return {
    id: `source-preview:${sourcePageId}`,
    physicalIndex: 0,
    pageType: compositeEntry.sourceKind === 'pdf' ? 'pdfContent' : 'imageContent',
    outlineNodeId: compositeEntry.outlineNodeId,
    materialId: compositeEntry.materialId,
    outlineNodeIds: [compositeEntry.outlineNodeId],
    materialIds: [compositeEntry.materialId],
    sourceId: compositeEntry.sourceId,
    sourceFile: compositeEntry.sourceFile,
    sourcePageIndex: compositeEntry.sourcePageIndex,
    sourcePageId: compositeEntry.sourcePageId,
    displayTitle: '拼版来源页面',
    sequenceLabel: null,
    inlineHeadings: [],
    logicalPageNumber: null,
    showPageNumber: false,
    printedPageLabel: null,
    rotation: compositeEntry.sourceRotation,
    targetOrientation: 'portrait',
    validationStatus: 'valid',
    composite: null,
  }
}

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

  registerValidatedHandler({
    channel: IPC_CHANNELS.previewSourceThumbnail,
    schema: PreviewSourceThumbnailInputSchema,
    stage: '生成拼版来源缩略图',
    mainWindow,
    handler: async ({ sourcePageId, planFingerprint, width }) => {
      const session = runtime.requireSession()
      const prepared = runtime.getPreparedPreview(planFingerprint)
      const plannedPage = resolveSourcePreviewPage(prepared.plan, sourcePageId)
      if (!plannedPage) throw new Error('来源页面已不存在，请刷新拼版工作台。')
      const cacheId = await runtime.thumbnailService?.createThumbnail({
        projectDirectory: session.projectDirectory,
        project: session.project,
        page: plannedPage,
        width,
        planFingerprint: `${planFingerprint}:source:${sourcePageId}`,
      })
      return { url: cacheId ? `spack-cache://cache/${encodeURIComponent(cacheId)}` : null }
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.previewDetectCrop,
    schema: PreviewDetectCropInputSchema,
    stage: '检测页面白边',
    mainWindow,
    handler: async ({ sourcePageId, planFingerprint }) => {
      const session = runtime.requireSession()
      const prepared = runtime.getPreparedPreview(planFingerprint)
      const plannedPage = resolveSourcePreviewPage(prepared.plan, sourcePageId)
      if (!plannedPage) throw new Error('来源页面已不存在，请刷新拼版工作台。')
      const cropRect = await runtime.thumbnailService?.detectContentCrop({
        projectDirectory: session.projectDirectory,
        project: session.project,
        page: plannedPage,
        safetyMillimeters: session.project.collageSettings.autoCropSafetyMillimeters,
      })
      if (!cropRect) throw new Error('缩略图服务尚未就绪，无法检测白边。')
      const isFullPage =
        cropRect.x === 0 &&
        cropRect.y === 0 &&
        cropRect.width === 10000 &&
        cropRect.height === 10000
      return {
        cropRect,
        message: isFullPage
          ? '未检测到可安全去除的白边，已保留完整页面。'
          : `已保留约 ${session.project.collageSettings.autoCropSafetyMillimeters} mm 安全边，请在 A4 画布中复核。`,
      }
    },
  })
}
