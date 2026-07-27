import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import type { PlannedPage } from '../../shared/schemas/page-plan-schema.js'
import type { Project } from '../../shared/schemas/project-schema.js'

export const preparePageNumberFont = async (
  document: PDFDocument,
  project: Project,
  fontPath?: string,
): Promise<PDFFont> => {
  if (!project.pageNumberSettings.enabled || !project.exportSettings.addPageNumbers) {
    return await document.embedFont(StandardFonts.Helvetica)
  }
  if (
    project.pageNumberSettings.format !== 'chinese' &&
    project.pageNumberSettings.format !== 'dash'
  ) {
    return await document.embedFont(StandardFonts.Helvetica)
  }
  if (!fontPath) {
    throw new Error('页码格式包含中文，但未找到随应用捆绑的中文字体。')
  }
  document.registerFontkit(fontkit)
  const fontBytes = await readFile(fontPath)
  return await document.embedFont(fontBytes, { subset: false })
}

export const drawPageNumber = (
  page: PDFPage,
  plannedPage: PlannedPage,
  project: Project,
  font: PDFFont,
): boolean => {
  if (!plannedPage.showPageNumber || !plannedPage.printedPageLabel) return false
  const text = plannedPage.printedPageLabel
  const fontSize = project.pageNumberSettings.fontSize
  const textWidth = font.widthOfTextAtSize(text, fontSize)
  const pageWidth = page.getWidth()
  const x =
    project.pageNumberSettings.position === 'bottomRight'
      ? pageWidth - project.exportSettings.margins.right - textWidth
      : (pageWidth - textWidth) / 2
  const y = Math.max(4, project.pageNumberSettings.bottomOffsetPoints - fontSize * 0.35)
  page.drawText(text, {
    x,
    y,
    size: fontSize,
    font,
  })
  return true
}
