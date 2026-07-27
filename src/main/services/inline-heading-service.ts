import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import { TEMPLATE_INLINE_HEADING_STYLES } from '../../shared/constants/document.js'
import type { PlannedPage } from '../../shared/schemas/page-plan-schema.js'
import type { Project } from '../../shared/schemas/project-schema.js'
import type { PageMargins } from '../../shared/utils/a4-layout.js'
import { wrapTextByWidth } from '../../shared/utils/text-layout.js'

type InlineHeadingLine = {
  text: string
  x: number
  y: number
  fontSize: number
}

export type InlineHeadingLayout = {
  lines: InlineHeadingLine[]
  contentMargins: PageMargins
}

export const prepareInlineHeadingFont = async (
  document: PDFDocument,
  fontPath: string | undefined,
): Promise<PDFFont> => {
  if (!fontPath) {
    throw new Error('材料同页标题需要中文字体，但未找到随应用捆绑的粗体字体。')
  }
  document.registerFontkit(fontkit)
  const fontBytes = await readFile(fontPath)
  return await document.embedFont(fontBytes, { subset: false })
}

export const layoutInlineHeadings = (
  page: PDFPage,
  plannedPage: PlannedPage,
  project: Project,
  font: PDFFont,
): InlineHeadingLayout => {
  const baseMargins = project.exportSettings.margins
  const availableWidth = page.getWidth() - baseMargins.left - baseMargins.right
  let cursorY = page.getHeight() - baseMargins.top
  const lines: InlineHeadingLine[] = []

  for (const heading of plannedPage.inlineHeadings) {
    const style = TEMPLATE_INLINE_HEADING_STYLES[heading.level]
    const wrapped = wrapTextByWidth(heading.text, availableWidth, (text) =>
      font.widthOfTextAtSize(text, style.fontSize),
    )
    for (const line of wrapped) {
      lines.push({
        text: line,
        x: baseMargins.left,
        y: cursorY - style.fontSize,
        fontSize: style.fontSize,
      })
      cursorY -= style.lineHeight
    }
    cursorY -= style.gapAfter
  }

  const reservedHeight = page.getHeight() - baseMargins.top - cursorY
  const contentMargins = {
    ...baseMargins,
    top: baseMargins.top + reservedHeight,
  }
  if (page.getHeight() - contentMargins.top - contentMargins.bottom < 72) {
    throw new Error(
      `材料“${plannedPage.displayTitle}”的同页标题过长，已没有足够空间放置正文。请缩短标题或改用独立标题页。`,
    )
  }
  return {
    lines,
    contentMargins,
  }
}

export const drawInlineHeadings = (
  page: PDFPage,
  layout: InlineHeadingLayout,
  font: PDFFont,
): void => {
  for (const line of layout.lines) {
    page.drawText(line.text, {
      x: line.x,
      y: line.y,
      size: line.fontSize,
      font,
    })
  }
}
