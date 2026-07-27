import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { degrees, PDFDocument, PDFHexString, PDFName, rgb, type PDFPage } from 'pdf-lib'
import sharp from 'sharp'
import {
  A4_SIZE_POINTS,
  IMAGE_QUALITY_PRESETS,
  POINTS_PER_INCH,
} from '../../shared/constants/document.js'
import type { PlannedPage } from '../../shared/schemas/page-plan-schema.js'
import type { Project } from '../../shared/schemas/project-schema.js'
import {
  calculateA4Placement,
  combineRotations,
  type PageMargins,
} from '../../shared/utils/a4-layout.js'
import { resolveMaterialSourcePath } from './project-service.js'

export const targetPageSize = (
  orientation: Project['exportSettings']['targetOrientation'],
): [number, number] =>
  orientation === 'portrait'
    ? [A4_SIZE_POINTS.width, A4_SIZE_POINTS.height]
    : [A4_SIZE_POINTS.height, A4_SIZE_POINTS.width]

const createWhiteA4Page = (document: PDFDocument, project: Project): PDFPage => {
  const [width, height] = targetPageSize(project.exportSettings.targetOrientation)
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
    PDFName.of('SPackInlineHeadings'),
    PDFHexString.fromText(JSON.stringify(plannedPage.inlineHeadings)),
  )
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
  const targetPage = createWhiteA4Page(input.targetDocument, input.project)
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
  const page = createWhiteA4Page(input.targetDocument, input.project)
  page.drawImage(embedded, {
    x: placement.drawX,
    y: placement.drawY,
    width: placement.drawWidth,
    height: placement.drawHeight,
  })
  return page
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
