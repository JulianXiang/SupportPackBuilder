import { A4_SIZE_POINTS, POINTS_PER_INCH } from '../constants/document.js'
import type { LayoutFit, LayoutSheet, TargetOrientation } from '../schemas/project-schema.js'
import { calculateLayoutSlotBounds, type LayoutBounds } from './layout-tree.js'

export type ClarityInput = {
  sourceKind: 'pdf' | 'image'
  sourceWidth: number
  sourceHeight: number
  sourceDpi?: number
  bounds: LayoutBounds
  orientation: TargetOrientation
  fit?: LayoutFit
  rasterPreferredDpi: number
  rasterMinimumAutoDpi: number
  pdfWarningScale: number
  pdfMinimumAutoScale: number
}

export type ClarityAssessment = {
  metric: number
  metricLabel: string
  level: 'good' | 'warning' | 'blocked'
  message: string
}

const pageSize = (orientation: TargetOrientation): [number, number] =>
  orientation === 'portrait'
    ? [A4_SIZE_POINTS.width, A4_SIZE_POINTS.height]
    : [A4_SIZE_POINTS.height, A4_SIZE_POINTS.width]

/**
 * 使用与 PDF 合成器相同的边距、区段比例和槽位间距，计算槽位相对整张 A4 的边界。
 * 标题高度采用合成器的固定 22pt；调用方可在确认不显示区段标题时关闭预留。
 */
export const calculateCompositeSlotBounds = (
  sheet: Pick<
    LayoutSheet,
    'orientation' | 'margins' | 'sectionGapPoints' | 'slotGapPoints' | 'sections'
  >,
  sectionIndex: number,
  showSectionTitle = true,
): LayoutBounds[] => {
  const section = sheet.sections[sectionIndex]
  if (!section) return []
  const [pageWidth, pageHeight] = pageSize(sheet.orientation)
  const contentWidth = Math.max(1, pageWidth - sheet.margins.left - sheet.margins.right)
  const contentHeight = Math.max(1, pageHeight - sheet.margins.top - sheet.margins.bottom)
  const sectionGapTotal = sheet.sectionGapPoints * Math.max(0, sheet.sections.length - 1)
  const usableSectionHeight = Math.max(1, contentHeight - sectionGapTotal)
  const precedingHeight = sheet.sections
    .slice(0, sectionIndex)
    .reduce(
      (total, candidate) =>
        total + usableSectionHeight * (candidate.heightWeight / 10000) + sheet.sectionGapPoints,
      0,
    )
  const sectionTop = sheet.margins.top + precedingHeight
  const sectionHeight = usableSectionHeight * (section.heightWeight / 10000)
  const titleHeight = showSectionTitle ? 22 : 0
  const layoutHeight = Math.max(1, sectionHeight - titleHeight)

  return calculateLayoutSlotBounds(section.layout).map((bounds) => ({
    x: (sheet.margins.left + bounds.x * contentWidth + sheet.slotGapPoints / 2) / pageWidth,
    y: (sectionTop + titleHeight + bounds.y * layoutHeight + sheet.slotGapPoints / 2) / pageHeight,
    width: Math.max(1, bounds.width * contentWidth - sheet.slotGapPoints) / pageWidth,
    height: Math.max(1, bounds.height * layoutHeight - sheet.slotGapPoints) / pageHeight,
  }))
}

export const assessLayoutClarity = (input: ClarityInput): ClarityAssessment => {
  const [pageWidth, pageHeight] = pageSize(input.orientation)
  const targetWidthPoints = pageWidth * input.bounds.width
  const targetHeightPoints = pageHeight * input.bounds.height
  const widthScale = targetWidthPoints / Math.max(1, input.sourceWidth)
  const heightScale = targetHeightPoints / Math.max(1, input.sourceHeight)
  const scale =
    input.fit === 'cover'
      ? Math.max(widthScale, heightScale)
      : input.fit === 'fitWidth'
        ? widthScale
        : input.fit === 'fitHeight'
          ? heightScale
          : Math.min(widthScale, heightScale)
  if (input.sourceKind === 'pdf') {
    const level =
      scale < input.pdfMinimumAutoScale
        ? 'blocked'
        : scale < input.pdfWarningScale
          ? 'warning'
          : 'good'
    return {
      metric: scale,
      metricLabel: `${Math.round(scale * 100)}%`,
      level,
      message:
        level === 'good'
          ? '矢量页面缩放比例清晰。'
          : level === 'warning'
            ? '页面缩放后文字可能偏小，建议改用更少槽位或横向 A4。'
            : '自动拼版不会采用该比例；如需手工保留，必须确认清晰度风险。',
    }
  }
  const pixelWidth = input.sourceWidth
  const pixelHeight = input.sourceHeight
  const renderedWidthInches = targetWidthPoints / POINTS_PER_INCH
  const renderedHeightInches = targetHeightPoints / POINTS_PER_INCH
  const dpi = Math.min(
    pixelWidth / Math.max(0.01, renderedWidthInches),
    pixelHeight / Math.max(0.01, renderedHeightInches),
  )
  const level =
    dpi < input.rasterMinimumAutoDpi
      ? 'blocked'
      : dpi < input.rasterPreferredDpi
        ? 'warning'
        : 'good'
  return {
    metric: dpi,
    metricLabel: `${Math.round(dpi)} DPI`,
    level,
    message:
      level === 'good'
        ? '图片输出分辨率适合阅读和打印。'
        : level === 'warning'
          ? '图片分辨率略低，建议减少同页图片数量。'
          : '自动拼版不会采用该分辨率；如需手工保留，必须确认清晰度风险。',
  }
}

export const calculatePaperSavings = (
  originalPageCount: number,
  composedPageCount: number,
): {
  savedPages: number
  savedPercent: number
  originalSheetsDuplex: number
  composedSheetsDuplex: number
} => {
  const savedPages = Math.max(0, originalPageCount - composedPageCount)
  return {
    savedPages,
    savedPercent:
      originalPageCount > 0 ? Math.round((savedPages / originalPageCount) * 1000) / 10 : 0,
    originalSheetsDuplex: Math.ceil(originalPageCount / 2),
    composedSheetsDuplex: Math.ceil(composedPageCount / 2),
  }
}
