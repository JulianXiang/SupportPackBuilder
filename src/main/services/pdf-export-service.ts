import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import { A4_SIZE_TOLERANCE_POINTS, A4_SIZE_POINTS } from '../../shared/constants/document.js'
import type { ExportProgress, ExportReport, ExportResult } from '../../shared/types/export.js'
import type { PdfExportWorkerStart } from '../../shared/types/worker-protocol.js'
import {
  addPageMarkers,
  appendBlankPage,
  appendGeneratedPage,
  appendPlannedContentPage,
  loadSourcePdf,
} from './pdf-layout-service.js'
import { prepareInlineHeadingFont } from './inline-heading-service.js'
import { drawPageNumber, preparePageNumberFont } from './page-number-service.js'
import { resolveMaterialContentPath } from './project-service.js'

export class ExportCancelledError extends Error {
  constructor() {
    super('用户已取消导出。')
    this.name = 'ExportCancelledError'
  }
}

export type ExportExecutionOptions = {
  isCancelled: () => boolean
  onProgress: (progress: ExportProgress) => void
}

const readMarker = (
  document: PDFDocument,
  pageIndex: number,
  markerName: string,
): string | null => {
  const value = document.getPage(pageIndex).node.get(PDFName.of(markerName))
  if (value instanceof PDFHexString || value instanceof PDFString) return value.decodeText()
  return null
}

const verifyOutput = async (
  temporaryPath: string,
  request: PdfExportWorkerStart,
): Promise<ExportReport> => {
  const fileStat = await stat(temporaryPath)
  const checks: ExportReport['checks'] = [
    {
      code: 'file-exists',
      label: '输出文件存在且非空',
      passed: fileStat.size > 0,
      detail: `文件大小 ${fileStat.size} 字节`,
    },
  ]
  const bytes = await readFile(temporaryPath)
  const document = await PDFDocument.load(bytes, {
    updateMetadata: false,
    throwOnInvalidObject: true,
  })
  checks.push({
    code: 'page-count',
    label: '实际页数与页面计划一致',
    passed: document.getPageCount() === request.plan.totalPageCount,
    detail: `计划 ${request.plan.totalPageCount} 页，实际 ${document.getPageCount()} 页`,
  })
  const expectedSize =
    request.project.exportSettings.targetOrientation === 'portrait'
      ? A4_SIZE_POINTS
      : { width: A4_SIZE_POINTS.height, height: A4_SIZE_POINTS.width }
  const nonA4Pages: number[] = []
  const actualMarkers: (string | null)[] = []
  const actualMaterialMarkers: (string | null)[] = []
  const actualOutlineMarkers: (string | null)[] = []
  const actualInlineHeadingMarkers: (string | null)[] = []
  const actualPageNumberLabels: (string | null)[] = []
  let pageNumberMarkerCount = 0
  document.getPages().forEach((page, index) => {
    if (
      Math.abs(page.getWidth() - expectedSize.width) > A4_SIZE_TOLERANCE_POINTS ||
      Math.abs(page.getHeight() - expectedSize.height) > A4_SIZE_TOLERANCE_POINTS
    ) {
      nonA4Pages.push(index + 1)
    }
    actualMarkers.push(readMarker(document, index, 'SPackPageId'))
    actualMaterialMarkers.push(readMarker(document, index, 'SPackMaterialId'))
    actualOutlineMarkers.push(readMarker(document, index, 'SPackOutlineNodeId'))
    actualInlineHeadingMarkers.push(readMarker(document, index, 'SPackInlineHeadings'))
    actualPageNumberLabels.push(readMarker(document, index, 'SPackPageNumberLabel'))
    if (readMarker(document, index, 'SPackPageNumber') === 'true') {
      pageNumberMarkerCount += 1
    }
  })
  checks.push({
    code: 'a4-pages',
    label: '所有物理页面均为 A4',
    passed: nonA4Pages.length === 0,
    detail: nonA4Pages.length === 0 ? '全部页面尺寸合格' : `异常页面：${nonA4Pages.join('、')}`,
  })
  const expectedInlineHeadingMarkers = request.plan.pages.map((page) =>
    JSON.stringify(page.inlineHeadings),
  )
  const inlineHeadingsMatch = actualInlineHeadingMarkers.every(
    (marker, index) => marker === expectedInlineHeadingMarkers[index],
  )
  checks.push({
    code: 'inline-headings',
    label: '同页分级标题与 PagePlan 一致',
    passed: inlineHeadingsMatch,
    detail: inlineHeadingsMatch ? '全部同页标题标记一致' : '存在同页标题标记不一致',
  })
  const expectedMarkers = request.plan.pages.map((page) => page.id)
  const orderMatches =
    actualMarkers.length === expectedMarkers.length &&
    actualMarkers.every((marker, index) => marker === expectedMarkers[index])
  checks.push({
    code: 'page-order',
    label: '页面顺序与 PagePlan 一致',
    passed: orderMatches,
    detail: orderMatches ? '全部页面标记顺序一致' : '页面标记顺序不一致',
  })
  const semanticMarkersMatch = request.plan.pages.every(
    (page, index) =>
      actualMaterialMarkers[index] === page.materialId &&
      actualOutlineMarkers[index] === page.outlineNodeId,
  )
  checks.push({
    code: 'semantic-page-markers',
    label: '材料和目录节点标记与 PagePlan 一致',
    passed: semanticMarkersMatch,
    detail: semanticMarkersMatch ? '全部语义页面标记一致' : '存在材料或目录节点标记不一致',
  })
  const expectedPageNumberLabels = request.plan.pages.map((page) =>
    page.showPageNumber ? page.printedPageLabel : null,
  )
  const pageNumberLabelsMatch = actualPageNumberLabels.every(
    (label, index) => label === expectedPageNumberLabels[index],
  )
  checks.push({
    code: 'page-number-labels',
    label: '打印页码文本与 PagePlan 一致',
    passed: pageNumberLabelsMatch,
    detail: pageNumberLabelsMatch ? '全部页码文本一致' : '存在页码文本不一致',
  })
  const expectedPageNumberCount = request.plan.pages.filter(
    (page) => page.showPageNumber && page.printedPageLabel,
  ).length
  checks.push({
    code: 'page-numbers',
    label: '页码数量与设置一致',
    passed: expectedPageNumberCount === pageNumberMarkerCount,
    detail: `计划 ${expectedPageNumberCount} 个，实际 ${pageNumberMarkerCount} 个`,
  })
  const uniqueMarkers = new Set(actualMarkers.filter((marker): marker is string => marker !== null))
  checks.push({
    code: 'no-duplicates',
    label: '不存在重复的计划页面',
    passed: uniqueMarkers.size === actualMarkers.length,
    detail: `唯一页面标记 ${uniqueMarkers.size} 个`,
  })
  const enabledMaterialIds = request.project.outlineNodes
    .filter((node) => node.enabled)
    .flatMap((node) => node.children.filter((child) => child.enabled))
    .flatMap((node) => node.materials.filter((material) => material.enabled))
    .map((material) => material.id)
  const plannedMaterialIds = new Set(
    request.plan.pages.map((page) => page.materialId).filter((id): id is string => id !== null),
  )
  const omittedMaterials = enabledMaterialIds.filter((id) => !plannedMaterialIds.has(id))
  checks.push({
    code: 'enabled-materials',
    label: '启用材料均已纳入导出',
    passed: omittedMaterials.length === 0,
    detail:
      omittedMaterials.length === 0
        ? '全部启用材料均有计划页面'
        : `遗漏材料数量：${omittedMaterials.length}`,
  })
  const tocMappingMatches = request.plan.tocEntries.every((entry) => {
    if (entry.materialId) {
      return request.plan.materialStartPages[entry.materialId] === entry.logicalPageNumber
    }
    if (entry.outlineNodeId) {
      return request.plan.outlineStartPages[entry.outlineNodeId] === entry.logicalPageNumber
    }
    return false
  })
  checks.push({
    code: 'toc-mapping',
    label: '目录起始页码与计划一致',
    passed: tocMappingMatches,
    detail: tocMappingMatches ? '全部目录条目映射正确' : '存在目录页码映射错误',
  })
  return {
    exportId: request.taskId,
    createdAt: new Date().toISOString(),
    outputPath: request.outputPath,
    planFingerprint: request.plan.planFingerprint,
    pageCount: document.getPageCount(),
    checks,
    warnings: request.plan.warnings.map((warning) => warning.message),
  }
}

const emitProgress = (
  request: PdfExportWorkerStart,
  options: ExportExecutionOptions,
  startedAt: number,
  input: Omit<ExportProgress, 'taskId' | 'elapsedMilliseconds'>,
): void => {
  options.onProgress({
    taskId: request.taskId,
    elapsedMilliseconds: Date.now() - startedAt,
    ...input,
  })
}

const checkCancellation = (options: ExportExecutionOptions): void => {
  if (options.isCancelled()) throw new ExportCancelledError()
}

export const executePdfExport = async (
  request: PdfExportWorkerStart,
  options: ExportExecutionOptions,
): Promise<ExportResult> => {
  const startedAt = Date.now()
  const temporaryPath = join(
    dirname(request.outputPath),
    `.${basename(request.outputPath)}.${request.taskId}.tmp`,
  )
  const backupPath = `${request.outputPath}.spack-backup`
  await mkdir(dirname(request.outputPath), { recursive: true })
  await mkdir(dirname(request.reportPath), { recursive: true })

  try {
    checkCancellation(options)
    emitProgress(request, options, startedAt, {
      stage: 'pdf',
      stageLabel: '正在处理页面',
      processedPages: 0,
      totalPages: request.plan.totalPageCount,
      percentage: 5,
    })
    const outputDocument = await PDFDocument.create()
    const pageNumberFont = await preparePageNumberFont(
      outputDocument,
      request.project,
      request.fontPath,
    )
    const hasInlineHeadings = request.plan.pages.some((page) => page.inlineHeadings.length > 0)
    const inlineHeadingFont = hasInlineHeadings
      ? await prepareInlineHeadingFont(outputDocument, request.boldFontPath)
      : null
    let currentPdfPath: string | null = null
    let currentPdfDocument: PDFDocument | null = null

    for (const [index, plannedPage] of request.plan.pages.entries()) {
      checkCancellation(options)
      let outputPage
      const generated = request.generatedPages[plannedPage.id]
      if (generated) {
        outputPage = await appendGeneratedPage({
          targetDocument: outputDocument,
          generatedPdfPath: generated.pdfPath,
          generatedPageIndex: generated.pageIndex,
          project: request.project,
        })
      } else if (plannedPage.pageType === 'blank') {
        outputPage = appendBlankPage(outputDocument, request.project)
      } else if (plannedPage.pageType === 'pdfContent') {
        if (!plannedPage.materialId || !plannedPage.sourceId) {
          throw new Error(`页面“${plannedPage.displayTitle}”缺少 PDF 来源。`)
        }
        const material = request.project.outlineNodes
          .flatMap((node) => node.children)
          .flatMap((node) => node.materials)
          .find((candidate) => candidate.id === plannedPage.materialId)
        if (!material) throw new Error(`找不到材料“${plannedPage.displayTitle}”。`)
        const sourcePath = resolveMaterialContentPath(
          request.projectDirectory,
          material,
          plannedPage.sourceId,
        )
        if (currentPdfPath !== sourcePath || !currentPdfDocument) {
          currentPdfDocument = await loadSourcePdf(sourcePath)
          currentPdfPath = sourcePath
        }
        outputPage = await appendPlannedContentPage({
          targetDocument: outputDocument,
          projectDirectory: request.projectDirectory,
          sourceDocument: currentPdfDocument,
          plannedPage,
          project: request.project,
          ...(inlineHeadingFont ? { inlineHeadingFont } : {}),
        })
      } else if (plannedPage.pageType === 'imageContent') {
        outputPage = await appendPlannedContentPage({
          targetDocument: outputDocument,
          projectDirectory: request.projectDirectory,
          plannedPage,
          project: request.project,
          ...(inlineHeadingFont ? { inlineHeadingFont } : {}),
        })
      } else {
        throw new Error(`页面“${plannedPage.displayTitle}”缺少生成文件。`)
      }

      const pageNumberDrawn = drawPageNumber(
        outputPage,
        plannedPage,
        request.project,
        pageNumberFont,
      )
      addPageMarkers(outputPage, plannedPage, pageNumberDrawn)
      const processedPages = index + 1
      emitProgress(request, options, startedAt, {
        stage:
          plannedPage.pageType === 'imageContent'
            ? 'image'
            : plannedPage.pageType === 'pdfContent'
              ? 'pdf'
              : plannedPage.pageType === 'toc'
                ? 'toc'
                : 'cover',
        stageLabel:
          plannedPage.pageType === 'imageContent'
            ? '正在处理图片'
            : plannedPage.pageType === 'pdfContent'
              ? '正在处理 PDF'
              : '正在合并正式页面',
        currentMaterial: plannedPage.displayTitle,
        currentFile: plannedPage.sourceFile
          ? basename(plannedPage.sourceFile)
          : plannedPage.displayTitle,
        processedPages,
        totalPages: request.plan.totalPageCount,
        percentage: Math.min(
          85,
          Math.round(5 + (processedPages / Math.max(1, request.plan.totalPageCount)) * 80),
        ),
      })
    }

    checkCancellation(options)
    outputDocument.setTitle(request.project.exportSettings.metadata.title)
    outputDocument.setAuthor(request.project.exportSettings.metadata.author)
    outputDocument.setSubject(request.project.exportSettings.metadata.subject)
    outputDocument.setCreator(request.project.exportSettings.metadata.creator)
    outputDocument.setProducer(request.project.exportSettings.metadata.producer)
    outputDocument.setCreationDate(new Date())
    outputDocument.setModificationDate(new Date())
    emitProgress(request, options, startedAt, {
      stage: 'saving',
      stageLabel: '正在写入临时文件',
      processedPages: request.plan.totalPageCount,
      totalPages: request.plan.totalPageCount,
      percentage: 88,
    })
    const bytes = await outputDocument.save({
      useObjectStreams: true,
      addDefaultPage: false,
      updateFieldAppearances: false,
    })
    await writeFile(temporaryPath, bytes)

    checkCancellation(options)
    emitProgress(request, options, startedAt, {
      stage: 'verifying',
      stageLabel: '正在校验输出',
      processedPages: request.plan.totalPageCount,
      totalPages: request.plan.totalPageCount,
      percentage: 92,
    })
    const report = await verifyOutput(temporaryPath, request)
    const failedChecks = report.checks.filter((check) => !check.passed)
    if (failedChecks.length > 0) {
      throw new Error(`输出校验失败：${failedChecks.map((check) => check.label).join('、')}`)
    }

    let targetExists = false
    try {
      await access(request.outputPath, fsConstants.F_OK)
      targetExists = true
    } catch {
      targetExists = false
    }
    if (targetExists) {
      if (!request.project.exportSettings.overwriteExisting) {
        throw new Error('目标文件已存在，且未获得覆盖确认。')
      }
      await rm(backupPath, { force: true })
      await rename(request.outputPath, backupPath)
    }
    try {
      await rename(temporaryPath, request.outputPath)
      if (targetExists) await rm(backupPath, { force: true })
    } catch (error) {
      if (targetExists) await rename(backupPath, request.outputPath).catch(() => undefined)
      throw error
    }
    await writeFile(request.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    emitProgress(request, options, startedAt, {
      stage: 'completed',
      stageLabel: '导出完成',
      processedPages: request.plan.totalPageCount,
      totalPages: request.plan.totalPageCount,
      percentage: 100,
    })
    return {
      status: 'success',
      outputPath: request.outputPath,
      reportPath: request.reportPath,
      report,
      message: 'PDF 已成功导出并通过自动校验。',
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    if (error instanceof ExportCancelledError) {
      return {
        status: 'cancelled',
        message: '用户已取消导出，临时文件已清理。',
      }
    }
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : '导出过程中发生未知错误。',
    }
  }
}
