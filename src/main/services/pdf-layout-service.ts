import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import {
  clip,
  degrees,
  endPath,
  PDFDocument,
  PDFHexString,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFPage,
} from 'pdf-lib'
import sharp from 'sharp'
import {
  A4_SIZE_POINTS,
  IMAGE_QUALITY_PRESETS,
  POINTS_PER_INCH,
} from '../../shared/constants/document.js'
import type { PlannedContentItem, PlannedPage } from '../../shared/schemas/page-plan-schema.js'
import type {
  LayoutAlignment,
  LayoutFit,
  Project,
  Rotation,
} from '../../shared/schemas/project-schema.js'
import {
  calculateA4Placement,
  combineRotations,
  type PageMargins,
} from '../../shared/utils/a4-layout.js'
import { calculateLayoutSlotBounds, flattenLayoutSlots } from '../../shared/utils/layout-tree.js'
import { resolveMaterialContentPath, resolveMaterialSourcePath } from './project-service.js'
import {
  drawInlineHeadings,
  layoutInlineHeadings,
  type InlineHeadingLayout,
} from './inline-heading-service.js'
import type { PDFFont } from 'pdf-lib'

export const targetPageSize = (
  orientation: Project['exportSettings']['targetOrientation'],
): [number, number] =>
  orientation === 'portrait'
    ? [A4_SIZE_POINTS.width, A4_SIZE_POINTS.height]
    : [A4_SIZE_POINTS.height, A4_SIZE_POINTS.width]

const createWhiteA4Page = (
  document: PDFDocument,
  project: Project,
  orientation = project.exportSettings.targetOrientation,
): PDFPage => {
  const [width, height] = targetPageSize(orientation)
  const page = document.addPage([width, height])
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(1, 1, 1),
  })
  return page
}

export const appendBlankPage = (document: PDFDocument, project: Project): PDFPage =>
  createWhiteA4Page(document, project)

export const addPageMarkers = (
  page: PDFPage,
  plannedPage: PlannedPage,
  pageNumberDrawn: boolean,
): void => {
  page.node.set(PDFName.of('SPackPageId'), PDFHexString.fromText(plannedPage.id))
  page.node.set(PDFName.of('SPackPageType'), PDFHexString.fromText(plannedPage.pageType))
  page.node.set(
    PDFName.of('SPackMaterialIds'),
    PDFHexString.fromText(JSON.stringify(plannedPage.materialIds)),
  )
  page.node.set(
    PDFName.of('SPackOutlineNodeIds'),
    PDFHexString.fromText(JSON.stringify(plannedPage.outlineNodeIds)),
  )
  if (plannedPage.materialId) {
    page.node.set(PDFName.of('SPackMaterialId'), PDFHexString.fromText(plannedPage.materialId))
  }
  if (plannedPage.outlineNodeId) {
    page.node.set(
      PDFName.of('SPackOutlineNodeId'),
      PDFHexString.fromText(plannedPage.outlineNodeId),
    )
  }
  page.node.set(
    PDFName.of('SPackInlineHeadings'),
    PDFHexString.fromText(JSON.stringify(plannedPage.inlineHeadings)),
  )
  const sourcePageIds = plannedPage.composite
    ? plannedPage.composite.contentItems.map((item) => item.sourcePageId)
    : plannedPage.sourcePageId
      ? [plannedPage.sourcePageId]
      : []
  page.node.set(
    PDFName.of('SPackSourcePageIds'),
    PDFHexString.fromText(JSON.stringify(sourcePageIds)),
  )
  if (plannedPage.composite) {
    page.node.set(
      PDFName.of('SPackLayoutDigest'),
      PDFHexString.fromText(plannedPage.composite.layoutDigest),
    )
  }
  if (pageNumberDrawn) {
    page.node.set(PDFName.of('SPackPageNumber'), PDFHexString.fromText('true'))
    if (plannedPage.printedPageLabel) {
      page.node.set(
        PDFName.of('SPackPageNumberLabel'),
        PDFHexString.fromText(plannedPage.printedPageLabel),
      )
    }
  }
}

export const appendPdfContentPage = async (input: {
  targetDocument: PDFDocument
  sourceDocument: PDFDocument
  plannedPage: PlannedPage
  project: Project
  contentMargins?: PageMargins
}): Promise<PDFPage> => {
  const sourceIndex = input.plannedPage.sourcePageIndex
  if (sourceIndex === null || sourceIndex >= input.sourceDocument.getPageCount()) {
    throw new Error(`材料“${input.plannedPage.displayTitle}”的来源页码无效。`)
  }
  const sourcePage = input.sourceDocument.getPage(sourceIndex)
  const cropBox = sourcePage.getCropBox()
  const embeddedPage = await input.targetDocument.embedPage(sourcePage, {
    left: cropBox.x,
    bottom: cropBox.y,
    right: cropBox.x + cropBox.width,
    top: cropBox.y + cropBox.height,
  })
  const sourceRotation = sourcePage.getRotation().angle
  const rotation = combineRotations(sourceRotation, input.plannedPage.rotation)
  const placement = calculateA4Placement({
    sourceWidth: cropBox.width,
    sourceHeight: cropBox.height,
    rotation,
    orientation: input.project.exportSettings.targetOrientation,
    margins: input.contentMargins ?? input.project.exportSettings.margins,
  })
  const targetPage = createWhiteA4Page(
    input.targetDocument,
    input.project,
    input.plannedPage.targetOrientation,
  )
  targetPage.drawPage(embeddedPage, {
    x: placement.matrix[4],
    y: placement.matrix[5],
    xScale: placement.scale,
    yScale: placement.scale,
    rotate: degrees(rotation),
  })
  return targetPage
}

export const appendImageContentPage = async (input: {
  targetDocument: PDFDocument
  projectDirectory: string
  plannedPage: PlannedPage
  project: Project
  contentMargins?: PageMargins
}): Promise<PDFPage> => {
  const material = input.project.outlineNodes
    .flatMap((node) => node.children)
    .flatMap((node) => node.materials)
    .find((candidate) => candidate.id === input.plannedPage.materialId)
  if (!material || !input.plannedPage.sourceId) {
    throw new Error(`图片页面“${input.plannedPage.displayTitle}”缺少材料来源。`)
  }
  const sourcePath = resolveMaterialSourcePath(
    input.projectDirectory,
    material,
    input.plannedPage.sourceId,
  )
  const preset = IMAGE_QUALITY_PRESETS[input.project.exportSettings.imageQuality]
  const [targetWidth, targetHeight] = targetPageSize(input.project.exportSettings.targetOrientation)
  const contentMargins = input.contentMargins ?? input.project.exportSettings.margins
  const availableWidthPoints = targetWidth - contentMargins.left - contentMargins.right
  const availableHeightPoints = targetHeight - contentMargins.top - contentMargins.bottom
  const maxWidthPixels = Math.round((availableWidthPoints / POINTS_PER_INCH) * preset.dpi)
  const maxHeightPixels = Math.round((availableHeightPoints / POINTS_PER_INCH) * preset.dpi)
  const converted = await sharp(sourcePath, { failOn: 'error' })
    .rotate()
    .rotate(input.plannedPage.rotation)
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .resize({
      width: maxWidthPixels,
      height: maxHeightPixels,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: preset.jpegQuality,
      chromaSubsampling: '4:4:4',
      mozjpeg: true,
    })
    .toBuffer({ resolveWithObject: true })
  const embedded = await input.targetDocument.embedJpg(converted.data)
  const placement = calculateA4Placement({
    sourceWidth: converted.info.width,
    sourceHeight: converted.info.height,
    rotation: 0,
    orientation: input.project.exportSettings.targetOrientation,
    margins: contentMargins,
  })
  const page = createWhiteA4Page(
    input.targetDocument,
    input.project,
    input.plannedPage.targetOrientation,
  )
  page.drawImage(embedded, {
    x: placement.drawX,
    y: placement.drawY,
    width: placement.drawWidth,
    height: placement.drawHeight,
  })
  return page
}

type ContentRectangle = {
  x: number
  y: number
  width: number
  height: number
}

type RectanglePlacement = {
  x: number
  y: number
  scale: number
  drawWidth: number
  drawHeight: number
}

const alignmentFactors = (alignment: LayoutAlignment): [number, number] => {
  const horizontal = alignment.endsWith('Left') ? 0 : alignment.endsWith('Right') ? 1 : 0.5
  const vertical = alignment.startsWith('top') ? 1 : alignment.startsWith('bottom') ? 0 : 0.5
  return [horizontal, vertical]
}

const calculateRectanglePlacement = (input: {
  sourceWidth: number
  sourceHeight: number
  rotation: Rotation
  fit: LayoutFit
  alignment: LayoutAlignment
  target: ContentRectangle
}): RectanglePlacement => {
  const quarterTurn = input.rotation === 90 || input.rotation === 270
  const effectiveWidth = quarterTurn ? input.sourceHeight : input.sourceWidth
  const effectiveHeight = quarterTurn ? input.sourceWidth : input.sourceHeight
  const widthScale = input.target.width / effectiveWidth
  const heightScale = input.target.height / effectiveHeight
  const scale =
    input.fit === 'cover'
      ? Math.max(widthScale, heightScale)
      : input.fit === 'fitWidth'
        ? widthScale
        : input.fit === 'fitHeight'
          ? heightScale
          : Math.min(widthScale, heightScale)
  const drawWidth = effectiveWidth * scale
  const drawHeight = effectiveHeight * scale
  const [horizontal, vertical] = alignmentFactors(input.alignment)
  return {
    x: input.target.x + (input.target.width - drawWidth) * horizontal,
    y: input.target.y + (input.target.height - drawHeight) * vertical,
    scale,
    drawWidth,
    drawHeight,
  }
}

const withClippingRectangle = (page: PDFPage, bounds: ContentRectangle, draw: () => void): void => {
  page.pushOperators(
    pushGraphicsState(),
    rectangle(bounds.x, bounds.y, bounds.width, bounds.height),
    clip(),
    endPath(),
  )
  draw()
  page.pushOperators(popGraphicsState())
}

const rotatedDrawOrigin = (
  placement: RectanglePlacement,
  sourceWidth: number,
  sourceHeight: number,
  rotation: Rotation,
): { x: number; y: number } => {
  switch (rotation) {
    case 0:
      return { x: placement.x, y: placement.y }
    case 90:
      return { x: placement.x + sourceHeight * placement.scale, y: placement.y }
    case 180:
      return {
        x: placement.x + sourceWidth * placement.scale,
        y: placement.y + sourceHeight * placement.scale,
      }
    case 270:
      return { x: placement.x, y: placement.y + sourceWidth * placement.scale }
  }
}

const resolveItemMaterial = (project: Project, item: PlannedContentItem) => {
  const material = project.outlineNodes
    .flatMap((node) => node.children)
    .flatMap((node) => node.materials)
    .find((candidate) => candidate.id === item.materialId)
  if (!material) {
    throw new Error(`拼版内容槽引用的材料 ${item.materialId} 不存在。`)
  }
  return material
}

const cropPdfBox = (
  cropBox: { x: number; y: number; width: number; height: number },
  item: PlannedContentItem,
): { left: number; bottom: number; right: number; top: number; width: number; height: number } => {
  const left = cropBox.x + (item.cropRect.x / 10000) * cropBox.width
  const width = (item.cropRect.width / 10000) * cropBox.width
  const height = (item.cropRect.height / 10000) * cropBox.height
  const bottom =
    cropBox.y + ((10000 - item.cropRect.y - item.cropRect.height) / 10000) * cropBox.height
  return {
    left,
    bottom,
    right: left + width,
    top: bottom + height,
    width,
    height,
  }
}

const drawCompositePdfItem = async (input: {
  targetDocument: PDFDocument
  targetPage: PDFPage
  sourceDocument: PDFDocument
  item: PlannedContentItem
  bounds: ContentRectangle
}): Promise<void> => {
  if (input.item.sourcePageIndex >= input.sourceDocument.getPageCount()) {
    throw new Error(`拼版来源页 ${input.item.sourcePageIndex + 1} 超出 PDF 页数。`)
  }
  const sourcePage = input.sourceDocument.getPage(input.item.sourcePageIndex)
  const crop = cropPdfBox(sourcePage.getCropBox(), input.item)
  const embedded = await input.targetDocument.embedPage(sourcePage, {
    left: crop.left,
    bottom: crop.bottom,
    right: crop.right,
    top: crop.top,
  })
  const rotation = combineRotations(
    sourcePage.getRotation().angle,
    combineRotations(input.item.sourceRotation, input.item.slotRotation),
  )
  const placement = calculateRectanglePlacement({
    sourceWidth: crop.width,
    sourceHeight: crop.height,
    rotation,
    fit: input.item.fit,
    alignment: input.item.alignment,
    target: input.bounds,
  })
  const origin = rotatedDrawOrigin(placement, crop.width, crop.height, rotation)
  withClippingRectangle(input.targetPage, input.bounds, () => {
    input.targetPage.drawPage(embedded, {
      x: origin.x,
      y: origin.y,
      xScale: placement.scale,
      yScale: placement.scale,
      rotate: degrees(rotation),
    })
  })
}

const drawCompositeImageItem = async (input: {
  targetDocument: PDFDocument
  targetPage: PDFPage
  projectDirectory: string
  project: Project
  item: PlannedContentItem
  bounds: ContentRectangle
}): Promise<void> => {
  const material = resolveItemMaterial(input.project, input.item)
  const sourcePath = resolveMaterialSourcePath(
    input.projectDirectory,
    material,
    input.item.sourceId,
  )
  const oriented = await sharp(sourcePath, { failOn: 'error' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .toBuffer({ resolveWithObject: true })
  const cropLeft = Math.min(
    oriented.info.width - 1,
    Math.floor((input.item.cropRect.x / 10000) * oriented.info.width),
  )
  const cropTop = Math.min(
    oriented.info.height - 1,
    Math.floor((input.item.cropRect.y / 10000) * oriented.info.height),
  )
  const cropWidth = Math.max(
    1,
    Math.min(
      oriented.info.width - cropLeft,
      Math.round((input.item.cropRect.width / 10000) * oriented.info.width),
    ),
  )
  const cropHeight = Math.max(
    1,
    Math.min(
      oriented.info.height - cropTop,
      Math.round((input.item.cropRect.height / 10000) * oriented.info.height),
    ),
  )
  const preset = IMAGE_QUALITY_PRESETS[input.project.exportSettings.imageQuality]
  const maxWidthPixels = Math.max(
    1,
    Math.round((input.bounds.width / POINTS_PER_INCH) * preset.dpi),
  )
  const maxHeightPixels = Math.max(
    1,
    Math.round((input.bounds.height / POINTS_PER_INCH) * preset.dpi),
  )
  const rotation = combineRotations(input.item.sourceRotation, input.item.slotRotation)
  const converted = await sharp(oriented.data)
    .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
    .rotate(rotation)
    .resize({
      width: maxWidthPixels,
      height: maxHeightPixels,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: preset.jpegQuality,
      chromaSubsampling: '4:4:4',
      mozjpeg: true,
    })
    .toBuffer({ resolveWithObject: true })
  const embedded = await input.targetDocument.embedJpg(converted.data)
  const placement = calculateRectanglePlacement({
    sourceWidth: converted.info.width,
    sourceHeight: converted.info.height,
    rotation: 0,
    fit: input.item.fit,
    alignment: input.item.alignment,
    target: input.bounds,
  })
  withClippingRectangle(input.targetPage, input.bounds, () => {
    input.targetPage.drawImage(embedded, {
      x: placement.x,
      y: placement.y,
      width: placement.drawWidth,
      height: placement.drawHeight,
    })
  })
}

export const appendCompositeContentPage = async (input: {
  targetDocument: PDFDocument
  projectDirectory: string
  plannedPage: PlannedPage
  project: Project
  inlineHeadingFont: PDFFont
  sourceDocuments?: Map<string, PDFDocument>
}): Promise<PDFPage> => {
  const composite = input.plannedPage.composite
  if (input.plannedPage.pageType !== 'compositeContent' || !composite) {
    throw new Error(`页面“${input.plannedPage.displayTitle}”不是有效拼版页。`)
  }
  const page = createWhiteA4Page(
    input.targetDocument,
    input.project,
    input.plannedPage.targetOrientation,
  )
  const headingLayout =
    input.plannedPage.inlineHeadings.length > 0
      ? layoutInlineHeadings(
          page,
          input.plannedPage,
          input.project,
          input.inlineHeadingFont,
          composite.margins,
        )
      : null
  const margins = headingLayout?.contentMargins ?? composite.margins
  const contentWidth = page.getWidth() - margins.left - margins.right
  const contentHeight = page.getHeight() - margins.top - margins.bottom
  const sectionGapTotal = composite.sectionGapPoints * Math.max(0, composite.sections.length - 1)
  const usableSectionHeight = contentHeight - sectionGapTotal
  if (contentWidth <= 0 || usableSectionHeight <= 0) {
    throw new Error('拼版页边距或区段间距过大，A4 页面没有可用内容区域。')
  }
  const itemBySlotId = new Map(composite.contentItems.map((item) => [item.slotId, item]))
  const pdfDocuments = input.sourceDocuments ?? new Map<string, PDFDocument>()
  let cursorTop = page.getHeight() - margins.top

  for (const [sectionIndex, section] of composite.sections.entries()) {
    const sectionHeight = usableSectionHeight * (section.heightWeight / 10000)
    const sectionBottom = cursorTop - sectionHeight
    const showSectionTitle =
      composite.sections.length > 1 || !section.isContinuation || section.showContinuationTitle
    const titleHeight = showSectionTitle ? 22 : 0
    if (showSectionTitle) {
      const title = `${section.sequenceLabel} ${section.materialTitle}${
        section.isContinuation ? '（续）' : ''
      }`
      page.drawText(title, {
        x: margins.left,
        y: cursorTop - 14,
        size: 11,
        font: input.inlineHeadingFont,
        color: rgb(0.12, 0.18, 0.24),
        maxWidth: contentWidth,
      })
      page.drawLine({
        start: { x: margins.left, y: cursorTop - 19 },
        end: { x: margins.left + contentWidth, y: cursorTop - 19 },
        thickness: 0.5,
        color: rgb(0.72, 0.76, 0.8),
      })
    }
    const layoutHeight = sectionHeight - titleHeight
    if (layoutHeight <= 12) {
      throw new Error(`成果“${section.materialTitle}”的拼版区段高度不足。`)
    }
    const slotBounds = calculateLayoutSlotBounds(section.layout)
    const layoutSlots = new Map(flattenLayoutSlots(section.layout).map((slot) => [slot.id, slot]))
    for (const normalized of slotBounds) {
      const halfGap = composite.slotGapPoints / 2
      const bounds: ContentRectangle = {
        x: margins.left + normalized.x * contentWidth + halfGap,
        y: sectionBottom + (1 - normalized.y - normalized.height) * layoutHeight + halfGap,
        width: Math.max(1, normalized.width * contentWidth - composite.slotGapPoints),
        height: Math.max(1, normalized.height * layoutHeight - composite.slotGapPoints),
      }
      const item = itemBySlotId.get(normalized.slotId)
      if (!item) {
        const configuredSlot = layoutSlots.get(normalized.slotId)
        const missingSource = Boolean(configuredSlot?.sourcePageId)
        page.drawRectangle({
          ...bounds,
          borderWidth: missingSource ? 1.2 : 0.75,
          borderColor: missingSource ? rgb(0.76, 0.16, 0.16) : rgb(0.8, 0.82, 0.84),
          color: missingSource ? rgb(1, 0.93, 0.93) : rgb(0.98, 0.98, 0.98),
        })
        if (missingSource) {
          page.drawText('来源页面缺失', {
            x: bounds.x + 6,
            y: bounds.y + bounds.height / 2,
            size: 9,
            maxWidth: Math.max(1, bounds.width - 12),
            font: input.inlineHeadingFont,
            color: rgb(0.68, 0.08, 0.08),
          })
        }
        continue
      }
      if (item.sourceKind === 'pdf') {
        const material = resolveItemMaterial(input.project, item)
        const sourcePath = resolveMaterialContentPath(
          input.projectDirectory,
          material,
          item.sourceId,
        )
        let sourceDocument = pdfDocuments.get(sourcePath)
        if (!sourceDocument) {
          sourceDocument = await loadSourcePdf(sourcePath)
          pdfDocuments.set(sourcePath, sourceDocument)
        }
        await drawCompositePdfItem({
          targetDocument: input.targetDocument,
          targetPage: page,
          sourceDocument,
          item,
          bounds,
        })
      } else {
        await drawCompositeImageItem({
          targetDocument: input.targetDocument,
          targetPage: page,
          projectDirectory: input.projectDirectory,
          project: input.project,
          item,
          bounds,
        })
      }
    }
    cursorTop =
      sectionBottom -
      (sectionIndex < composite.sections.length - 1 ? composite.sectionGapPoints : 0)
  }
  if (headingLayout) drawInlineHeadings(page, headingLayout, input.inlineHeadingFont)
  return page
}

export const appendPlannedContentPage = async (input: {
  targetDocument: PDFDocument
  projectDirectory: string
  plannedPage: PlannedPage
  project: Project
  sourceDocument?: PDFDocument
  inlineHeadingFont?: PDFFont
  sourceDocuments?: Map<string, PDFDocument>
}): Promise<PDFPage> => {
  const [pageWidth, pageHeight] = targetPageSize(input.plannedPage.targetOrientation)
  const layoutPage = input.targetDocument.addPage([pageWidth, pageHeight])
  const inlineHeadingLayout: InlineHeadingLayout | null =
    input.inlineHeadingFont && input.plannedPage.inlineHeadings.length > 0
      ? layoutInlineHeadings(layoutPage, input.plannedPage, input.project, input.inlineHeadingFont)
      : null
  input.targetDocument.removePage(input.targetDocument.getPageCount() - 1)

  let outputPage: PDFPage
  if (input.plannedPage.pageType === 'compositeContent') {
    if (!input.inlineHeadingFont) {
      throw new Error('拼版页需要中文字体以绘制成果区段标题。')
    }
    outputPage = await appendCompositeContentPage({
      targetDocument: input.targetDocument,
      projectDirectory: input.projectDirectory,
      plannedPage: input.plannedPage,
      project: input.project,
      inlineHeadingFont: input.inlineHeadingFont,
      ...(input.sourceDocuments ? { sourceDocuments: input.sourceDocuments } : {}),
    })
  } else if (input.plannedPage.pageType === 'pdfContent') {
    if (!input.sourceDocument) {
      throw new Error(`PDF 页面“${input.plannedPage.displayTitle}”缺少已解析的来源文档。`)
    }
    outputPage = await appendPdfContentPage({
      targetDocument: input.targetDocument,
      sourceDocument: input.sourceDocument,
      plannedPage: input.plannedPage,
      project: input.project,
      ...(inlineHeadingLayout ? { contentMargins: inlineHeadingLayout.contentMargins } : {}),
    })
  } else if (input.plannedPage.pageType === 'imageContent') {
    outputPage = await appendImageContentPage({
      targetDocument: input.targetDocument,
      projectDirectory: input.projectDirectory,
      plannedPage: input.plannedPage,
      project: input.project,
      ...(inlineHeadingLayout ? { contentMargins: inlineHeadingLayout.contentMargins } : {}),
    })
  } else {
    throw new Error(`页面“${input.plannedPage.displayTitle}”不是材料内容页。`)
  }
  if (inlineHeadingLayout && input.inlineHeadingFont) {
    drawInlineHeadings(outputPage, inlineHeadingLayout, input.inlineHeadingFont)
  }
  return outputPage
}

export const appendGeneratedPage = async (input: {
  targetDocument: PDFDocument
  generatedPdfPath: string
  generatedPageIndex: number
  project: Project
}): Promise<PDFPage> => {
  const bytes = await readFile(input.generatedPdfPath)
  const generated = await PDFDocument.load(bytes, {
    updateMetadata: false,
  })
  if (input.generatedPageIndex >= generated.getPageCount()) {
    throw new Error(`生成页面索引 ${input.generatedPageIndex + 1} 超出范围。`)
  }
  const [copied] = await input.targetDocument.copyPages(generated, [input.generatedPageIndex])
  if (!copied) throw new Error('复制生成页面失败。')
  const [width, height] = targetPageSize(input.project.exportSettings.targetOrientation)
  copied.setSize(width, height)
  input.targetDocument.addPage(copied)
  return copied
}

export const loadSourcePdf = async (sourcePath: string): Promise<PDFDocument> => {
  if (extname(sourcePath).toLowerCase() !== '.pdf') {
    throw new Error('来源文件不是 PDF。')
  }
  const bytes = await readFile(sourcePath)
  const document = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    throwOnInvalidObject: true,
    updateMetadata: false,
  })
  if (document.isEncrypted) throw new Error('来源 PDF 已加密，无法导出。')
  return document
}
