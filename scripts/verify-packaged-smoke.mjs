import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { stdout } from 'node:process'
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'

const projectDirectory = resolve('fixtures/generated/package-smoke/打包成品导入导出回归')
const projectPath = join(projectDirectory, 'project.json')
const outputDirectory = join(projectDirectory, 'output')
const outputPath = join(outputDirectory, '打包成品导出.pdf')

const project = JSON.parse(await readFile(projectPath, 'utf8'))
const outputBytes = await readFile(outputPath)
const document = await PDFDocument.load(outputBytes, {
  updateMetadata: false,
  throwOnInvalidObject: true,
})

const readMarker = (pageIndex, markerName) => {
  const value = document.getPage(pageIndex).node.get(PDFName.of(markerName))
  return value instanceof PDFHexString || value instanceof PDFString ? value.decodeText() : null
}

const firstPageTypes = Array.from({ length: 3 }, (_, pageIndex) =>
  readMarker(pageIndex, 'SPackPageType'),
)
if (firstPageTypes.join(',') !== 'cover,blank,toc') {
  throw new Error(`打包成品前置页面顺序错误：${firstPageTypes.join('、')}`)
}

const nonA4Pages = document
  .getPages()
  .map((page, index) => ({ page, index }))
  .filter(
    ({ page }) =>
      Math.abs(page.getWidth() - 595.2755905511812) > 0.5 ||
      Math.abs(page.getHeight() - 841.8897637795277) > 0.5,
  )
  .map(({ index }) => index + 1)
if (nonA4Pages.length > 0) {
  throw new Error(`打包成品存在非 A4 页面：${nonA4Pages.join('、')}`)
}

const pageIds = document.getPages().map((_, pageIndex) => readMarker(pageIndex, 'SPackPageId'))
if (pageIds.some((pageId) => !pageId) || new Set(pageIds).size !== pageIds.length) {
  throw new Error('打包成品页面标记存在缺失或重复。')
}

const pageNumberLabels = document
  .getPages()
  .map((_, pageIndex) => readMarker(pageIndex, 'SPackPageNumberLabel'))
  .filter((label) => label !== null)
if (
  pageNumberLabels.length !== 6 ||
  pageNumberLabels.some((label, index) => label !== `— ${index + 1} —`)
) {
  throw new Error(`打包成品页码标记错误：${pageNumberLabels.join('、')}`)
}

const firstContentPageIndex = document
  .getPages()
  .findIndex((_, pageIndex) => readMarker(pageIndex, 'SPackPageType') === 'pdfContent')
const inlineHeadings =
  firstContentPageIndex >= 0 ? readMarker(firstContentPageIndex, 'SPackInlineHeadings') : null
if (!inlineHeadings || JSON.parse(inlineHeadings).length !== 3) {
  throw new Error('打包成品首张材料页没有保留三级同页标题。')
}

const reportNames = (await readdir(outputDirectory)).filter((name) => name.endsWith('-report.json'))
if (reportNames.length !== 1) {
  throw new Error(`应当且只能存在一份输出校验报告，实际为 ${reportNames.length} 份。`)
}
const report = JSON.parse(await readFile(join(outputDirectory, reportNames[0]), 'utf8'))
if (report.pageCount !== document.getPageCount()) {
  throw new Error('打包成品输出报告页数与 PDF 不一致。')
}
if (!report.checks.every((check) => check.passed)) {
  throw new Error('打包成品输出报告存在失败检查。')
}

const collectMaterials = (nodes) =>
  nodes.flatMap((node) => [...node.materials, ...collectMaterials(node.children)])
for (const material of collectMaterials(project.outlineNodes)) {
  for (const source of material.sourceItems) {
    const assetPath = join(projectDirectory, source.storedPath ?? source.sourcePath)
    const digest = createHash('sha256')
      .update(await readFile(assetPath))
      .digest('hex')
    if (digest !== source.fileHash) {
      throw new Error(`项目资产《${source.originalFileName}》哈希发生变化。`)
    }
  }
}

const temporaryEntries = await readdir(join(projectDirectory, 'temp'))
if (temporaryEntries.length > 0) {
  throw new Error(`打包成品导出后仍有临时目录：${temporaryEntries.join('、')}`)
}

stdout.write(
  `${JSON.stringify({
    status: 'PACKAGED_SMOKE_OK',
    pageCount: document.getPageCount(),
    outputBytes: outputBytes.length,
    reportChecks: report.checks.length,
    pageNumberCount: pageNumberLabels.length,
    firstPageTypes,
    outputSha256: createHash('sha256').update(outputBytes).digest('hex'),
    outputPath,
  })}\n`,
)
