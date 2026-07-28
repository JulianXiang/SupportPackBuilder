import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import { generateFixtures, type FixtureManifest } from '../../scripts/generate-fixtures.js'
import { A4_SIZE_POINTS } from '../../src/shared/constants/document.js'
import { ProjectSchema } from '../../src/shared/schemas/project-schema.js'
import type { ExportReport } from '../../src/shared/types/export.js'

let temporaryDirectory = ''
let fixtures: FixtureManifest
let projectParent = ''
let projectDirectory = ''
let outputPath = ''
let electronApp: ElectronApplication | null = null
let page: Page | null = null

test.beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'spack-e2e-'))
  fixtures = await generateFixtures(join(temporaryDirectory, 'fixtures'))
  projectParent = join(temporaryDirectory, 'projects')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(projectParent, { recursive: true })
  projectDirectory = join(projectParent, '2026 年度个人成果支撑材料')
  outputPath = join(projectDirectory, 'output', '验收导出.pdf')
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  electronApp = await electron.launch({
    args: [`--user-data-dir=${join(temporaryDirectory, 'electron-user-data')}`, resolve('.')],
    env: {
      ...environment,
      SPACK_E2E: '1',
      SPACK_E2E_DIALOGS: JSON.stringify({
        projectParent,
        projectOpen: join(projectDirectory, 'project.json'),
        importFiles: [
          [fixtures.tenPagePdf, fixtures.landscapePdf, ...fixtures.jpgImages],
          [fixtures.nonStandardPdf, fixtures.rotatedPdf, fixtures.pngImage, fixtures.webpImage],
          [fixtures.docxDocument, fixtures.pptxPresentation, fixtures.xlsxWithoutPrintSettings],
        ],
        exportPath: outputPath,
        confirmOverwrite: true,
      }),
    },
  })
  page = await electronApp.firstWindow()
})

test.afterAll(async () => {
  await electronApp?.close()
  if (process.env.SPACK_KEEP_E2E_ARTIFACTS !== '1') {
    await rm(temporaryDirectory, { recursive: true, force: true })
  } else {
    process.stdout.write(`\nE2E_ARTIFACT_DIRECTORY=${temporaryDirectory}\n`)
  }
})

const currentPage = (): Page => {
  if (!page) throw new Error('Electron 页面尚未启动。')
  return page
}

const addDirectory = async (level: '一级' | '二级', title: string): Promise<void> => {
  const window = currentPage()
  await window.locator('.outline-actions').getByRole('button', { name: level }).click()
  const dialog = window.getByRole('dialog')
  const input = dialog.getByRole('textbox')
  await input.fill(title)
  await dialog.getByRole('button', { name: /确\s*定/ }).click()
  await expect(
    window.locator('.outline-panel').locator('.outline-row').filter({ hasText: title }),
  ).toBeVisible()
}

const dragRowBefore = async (sourceTitle: string, targetTitle: string): Promise<void> => {
  const window = currentPage()
  const outline = window.locator('.outline-panel')
  const source = outline.locator('.outline-row').filter({ hasText: sourceTitle }).first()
  const target = outline.locator('.outline-row').filter({ hasText: targetTitle }).first()
  const handle = source.getByRole('button', { name: '拖拽排序' })
  await expect(handle).toBeVisible()
  await expect(target).toBeVisible()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sourceBefore = await source.boundingBox()
    const targetBefore = await target.boundingBox()
    if (!sourceBefore || !targetBefore) throw new Error('无法读取拖拽目标的位置。')
    if (sourceBefore.y < targetBefore.y) return
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('无法读取拖拽手柄的位置。')
    await window.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await window.mouse.down()
    await window.waitForTimeout(100)
    await window.mouse.move(handleBox.x + handleBox.width / 2 + 10, handleBox.y, { steps: 3 })
    await window.waitForTimeout(100)
    const liveTargetBox = await target.boundingBox()
    if (!liveTargetBox) throw new Error('拖拽期间目标目录不可见。')
    await window.mouse.move(
      liveTargetBox.x + liveTargetBox.width / 2,
      liveTargetBox.y + liveTargetBox.height / 2,
      { steps: 16 },
    )
    await window.waitForTimeout(100)
    await window.mouse.up()
    await window.waitForTimeout(250)
  }
  throw new Error(`拖拽排序未生效：“${sourceTitle}”仍位于“${targetTitle}”之后。`)
}

test('完成真实项目、导入、页面编辑、保存、重开和 A4 PDF 导出', async () => {
  const window = currentPage()
  const consoleErrors: string[] = []
  const sourcePaths = [
    fixtures.tenPagePdf,
    fixtures.landscapePdf,
    fixtures.nonStandardPdf,
    fixtures.rotatedPdf,
    ...fixtures.jpgImages,
    fixtures.pngImage,
    fixtures.webpImage,
    fixtures.docxDocument,
    fixtures.pptxPresentation,
    fixtures.xlsxWithoutPrintSettings,
  ]
  const sourceSnapshots = await Promise.all(sourcePaths.map(async (path) => await readFile(path)))
  window.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await expect(window.getByText('整理个人支撑材料', { exact: true })).toBeVisible()
  await window.getByRole('button', { name: '新建项目' }).first().click()
  const newDialog = window.getByRole('dialog')
  await newDialog.getByLabel('项目名称').fill('2026 年度个人成果支撑材料')
  await newDialog.getByLabel('姓名').fill('张老师')
  await newDialog.getByLabel('单位').fill('示例大学')
  await newDialog.getByLabel('材料用途').fill('年度考核与成果汇编')
  await newDialog.getByLabel('目录模板').click()
  await window.getByText('自定义空白模板', { exact: true }).click()
  await newDialog.getByRole('button', { name: '选择位置并创建' }).click()

  await expect(window.getByText('项目目录', { exact: true })).toBeVisible()
  const inspector = window.locator('.inspector-panel')
  await inspector.getByLabel('项目名称').fill('修改后的项目属性名称')
  await inspector.getByLabel('项目名称').blur()
  await expect(inspector.getByLabel('封面标题')).toHaveValue('2026 年度个人成果支撑材料')
  await inspector.getByLabel('封面标题').fill('独立封面：2026 年度个人成果支撑材料')
  await inspector.getByLabel('封面标题').blur()

  await addDirectory('一级', '论文成果')
  await window.locator('.outline-panel').getByText('论文成果', { exact: true }).click()
  await addDirectory('二级', '遥感变化描述论文')
  await window.locator('.outline-panel').getByText('论文成果', { exact: true }).click()
  await addDirectory('二级', '人工智能教育论文')
  await addDirectory('一级', '知识产权')
  await window.locator('.outline-panel').getByText('知识产权', { exact: true }).click()
  await addDirectory('二级', '发明专利')
  await addDirectory('一级', '空目录')

  const outlinePanel = window.locator('.outline-panel')
  await outlinePanel
    .locator('.outline-row')
    .filter({ hasText: '论文成果' })
    .locator('.expand-button')
    .click()
  await outlinePanel
    .locator('.outline-row')
    .filter({ hasText: '知识产权' })
    .locator('.expand-button')
    .click()
  await dragRowBefore('知识产权', '论文成果')
  await expect(
    outlinePanel.locator('.outline-row').filter({ hasText: '知识产权' }).first(),
  ).toContainText('未输出')
  await expect(
    outlinePanel.locator('.outline-row').filter({ hasText: '论文成果' }).first(),
  ).toContainText('未输出')
  await outlinePanel
    .locator('.outline-row')
    .filter({ hasText: '论文成果' })
    .locator('.expand-button')
    .click()
  await dragRowBefore('人工智能教育论文', '遥感变化描述论文')
  await outlinePanel
    .locator('.outline-row')
    .filter({ hasText: '知识产权' })
    .locator('.expand-button')
    .click()

  await window.locator('.outline-panel').getByText('遥感变化描述论文', { exact: true }).click()
  await window
    .locator('.top-toolbar')
    .getByRole('button', { name: /导入文件$/ })
    .click()
  const importDialog = window.getByRole('dialog', { name: '导入材料检查' })
  await expect(importDialog.getByText('导入材料检查')).toBeVisible()
  await importDialog.getByRole('radio', { name: '合并为同一材料', exact: true }).check()
  await importDialog.getByRole('button', { name: '确认导入' }).click()
  await expect(importDialog).toBeHidden({ timeout: 30_000 })
  const outline = window.locator('.outline-panel')
  await outline
    .locator('.outline-row')
    .filter({ hasText: '遥感变化描述论文' })
    .locator('.expand-button')
    .click()
  await expect(outline.getByText('ten-pages-a4', { exact: true })).toBeVisible()
  await expect(outline.getByText('three-pages-landscape', { exact: true })).toBeVisible()
  await expect(outline.getByText('图片材料（3 张）', { exact: true })).toBeVisible()

  await dragRowBefore('图片材料（3 张）', 'ten-pages-a4')

  await outline.getByText('ten-pages-a4', { exact: true }).click()
  const rangeInput = window.getByLabel('PDF 页码范围')
  await rangeInput.fill('1,3,5-7')
  await rangeInput.blur()
  await expect(rangeInput).toHaveValue('1,3,5-7')

  const pdfCards = window.locator('.page-card').filter({ hasText: 'ten-pages-a4' })
  await expect(pdfCards).toHaveCount(5, { timeout: 30_000 })
  await expect(pdfCards.first()).toBeVisible()
  const beforeDeleteCount = await pdfCards.count()
  await pdfCards.first().click()
  await window.locator('.inspector-panel').getByRole('button', { name: '顺时针旋转' }).click()
  await expect(window.locator('.page-card.selected')).toContainText('旋转 90°')
  await pdfCards.nth(1).click()
  await window.locator('.inspector-panel').getByRole('button', { name: '删除页面' }).click()
  await expect(window.locator('.page-card').filter({ hasText: 'ten-pages-a4' })).toHaveCount(
    beforeDeleteCount - 1,
  )

  await outline.locator('.outline-row').filter({ hasText: '发明专利' }).first().click()
  await window
    .locator('.top-toolbar')
    .getByRole('button', { name: /导入文件$/ })
    .click()
  const secondImportDialog = window.getByRole('dialog', { name: '导入材料检查' })
  await expect(secondImportDialog.getByText('导入材料检查')).toBeVisible()
  await expect(secondImportDialog.locator('input[type="radio"][value="separate"]')).toBeChecked()
  await secondImportDialog.getByRole('button', { name: '确认导入' }).click()
  await expect(secondImportDialog).toBeHidden({ timeout: 30_000 })
  const patentRow = outline.locator('.outline-row').filter({ hasText: '发明专利' })
  await patentRow.locator('.expand-button').click()
  await expect(outline.getByText('non-standard-scan', { exact: true })).toBeVisible()
  await expect(outline.getByText('rotated-source-page', { exact: true })).toBeVisible()
  await expect(outline.getByText('certificate', { exact: true })).toBeVisible()
  await expect(outline.getByText('scan', { exact: true })).toBeVisible()
  await expect(
    outlinePanel.locator('.outline-row').filter({ hasText: '知识产权' }).first(),
  ).toContainText('一、')
  await expect(
    outlinePanel.locator('.outline-row').filter({ hasText: '论文成果' }).first(),
  ).toContainText('二、')
  await expect(
    outlinePanel.locator('.outline-row').filter({ hasText: '空目录' }).first(),
  ).toContainText('未输出')

  await outline.locator('.outline-row').filter({ hasText: '发明专利' }).first().click()
  await window
    .locator('.top-toolbar')
    .getByRole('button', { name: /导入文件$/ })
    .click()
  const officeImportDialog = window.getByRole('dialog', { name: '导入材料检查' })
  await expect(officeImportDialog.getByText('导入材料检查')).toBeVisible({ timeout: 120_000 })
  await expect(officeImportDialog).toContainText('DOCX')
  await expect(officeImportDialog).toContainText('PPTX')
  await expect(officeImportDialog).toContainText('XLSX')
  await officeImportDialog.getByRole('button', { name: '确认导入' }).click()
  await expect(officeImportDialog).toBeHidden({ timeout: 30_000 })
  await expect(outline.getByText('office-document', { exact: true })).toBeVisible()
  await expect(outline.getByText('office-presentation', { exact: true })).toBeVisible()
  await expect(outline.getByText('office-workbook-auto-print', { exact: true })).toBeVisible()

  await outline.getByText('office-document', { exact: true }).click()
  const officeCards = window.locator('.page-card').filter({ hasText: 'office-document' })
  await expect(officeCards.first()).toBeVisible({ timeout: 30_000 })
  await officeCards.first().click()
  await window.locator('.inspector-panel').getByRole('button', { name: '顺时针旋转' }).click()
  await expect(window.locator('.page-card.selected')).toContainText('旋转 90°')

  await window.locator('.top-toolbar').getByRole('button', { name: '保存' }).click()
  await expect(window.locator('.status-bar')).toContainText('已保存', { timeout: 15_000 })
  const saved = ProjectSchema.parse(
    JSON.parse(await readFile(join(projectDirectory, 'project.json'), 'utf8')) as unknown,
  )
  expect(saved.title).toBe('修改后的项目属性名称')
  expect(saved.coverSettings.title).toBe('独立封面：2026 年度个人成果支撑材料')
  expect(saved.ownerName).toBe('张老师')
  expect(saved.organization).toBe('示例大学')
  expect(saved.tocSettings.title).toBe('支撑材料目录')
  expect(saved.exportSettings.contentHeadingMode).toBe('firstPage')
  expect(saved.pageNumberSettings.format).toBe('dash')
  expect(saved.outlineNodes).toHaveLength(3)
  expect(saved.outlineNodes.map((node) => node.title)).toEqual(['知识产权', '论文成果', '空目录'])
  expect(saved.outlineNodes.flatMap((node) => node.children)).toHaveLength(3)
  expect(
    saved.outlineNodes
      .find((node) => node.title === '论文成果')
      ?.children.map((child) => child.title),
  ).toEqual(['人工智能教育论文', '遥感变化描述论文'])
  expect(
    saved.outlineNodes
      .flatMap((node) => node.children)
      .find((node) => node.title === '遥感变化描述论文')
      ?.materials.map((material) => material.title),
  ).toEqual(['图片材料（3 张）', 'ten-pages-a4', 'three-pages-landscape'])
  expect(
    saved.outlineNodes.flatMap((node) => node.children).flatMap((node) => node.materials),
  ).toHaveLength(10)
  expect(
    saved.outlineNodes
      .flatMap((node) => node.children)
      .flatMap((node) => node.materials)
      .filter((material) => material.sourceType === 'office')
      .every((material) => material.sourceItems[0]?.conversion?.snapshotStatus === 'ready'),
  ).toBe(true)

  await window.locator('.top-toolbar').getByRole('button', { name: '打开项目' }).click()
  await expect(outline.getByText('ten-pages-a4', { exact: true })).toBeVisible()
  await expect(window.locator('.status-bar')).toContainText('已保存')
  const previewResult = await window.evaluate(
    async () => await globalThis.window.supportPack.preview.refresh(),
  )
  expect(previewResult.ok).toBe(true)
  if (!previewResult.ok) throw new Error(previewResult.error.message)
  const previewPlan = previewResult.value
  expect(
    previewPlan.pages.find((plannedPage) => plannedPage.pageType === 'cover')?.displayTitle,
  ).toBe('独立封面：2026 年度个人成果支撑材料')
  expect(previewPlan.outputOutlineNodeIds).not.toContain(
    saved.outlineNodes.find((node) => node.title === '空目录')?.id,
  )
  expect(previewPlan.tocEntries.some((entry) => entry.title === '空目录')).toBe(false)
  expect(
    previewPlan.tocEntries
      .filter((entry) => entry.kind === 'level1')
      .map((entry) => entry.displayText),
  ).toEqual(['一、知识产权', '二、论文成果'])
  const firstContentPage = previewPlan.pages.find(
    (plannedPage) =>
      plannedPage.pageType === 'pdfContent' || plannedPage.pageType === 'imageContent',
  )
  expect(firstContentPage?.inlineHeadings.length).toBeGreaterThan(0)
  expect(
    previewPlan.pages
      .filter((plannedPage) => plannedPage.logicalPageNumber !== null)
      .every(
        (plannedPage) =>
          plannedPage.printedPageLabel === `— ${plannedPage.logicalPageNumber?.value ?? ''} —`,
      ),
  ).toBe(true)

  const previewScroll = window.locator('.preview-scroll')
  const previewScrollbar = window.getByRole('scrollbar', { name: '页面预览滚动条' })
  const previewScrollbarThumb = previewScrollbar.locator('.preview-scrollbar-thumb')
  await expect(previewScrollbar).toBeVisible()
  await expect(previewScrollbar).toHaveAttribute('aria-controls', 'preview-scroll-region')
  const maximumScrollTop = Number(await previewScrollbar.getAttribute('aria-valuemax'))
  expect(maximumScrollTop).toBeGreaterThan(0)
  const initialRenderedPageCount = await window.locator('.page-card').count()
  expect(initialRenderedPageCount).toBeLessThan(previewPlan.totalPageCount)

  const scrollbarBounds = await previewScrollbar.boundingBox()
  if (!scrollbarBounds) throw new Error('无法读取页面预览滚动条的位置。')
  await previewScrollbar.click({
    position: { x: scrollbarBounds.width / 2, y: scrollbarBounds.height - 2 },
  })
  await expect
    .poll(async () => await previewScroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)

  await previewScrollbar.focus()
  await window.keyboard.press('Home')
  await expect
    .poll(async () => await previewScroll.evaluate((element) => element.scrollTop))
    .toBe(0)
  await window.keyboard.press('PageDown')
  await expect
    .poll(async () => await previewScroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
  await window.keyboard.press('PageUp')
  await expect
    .poll(async () => await previewScroll.evaluate((element) => element.scrollTop))
    .toBe(0)
  await window.keyboard.press('End')
  await expect
    .poll(async () => await previewScroll.evaluate((element) => element.scrollTop))
    .toBeCloseTo(maximumScrollTop, 0)
  await expect(
    window.locator('.page-card').filter({ hasText: `物理页 ${previewPlan.totalPageCount}` }),
  ).toBeVisible()

  await window.keyboard.press('Home')
  await expect
    .poll(async () => await previewScroll.evaluate((element) => element.scrollTop))
    .toBe(0)
  await previewScrollbarThumb.scrollIntoViewIfNeeded()
  await expect(previewScrollbarThumb).toBeInViewport()
  await window.evaluate(
    async () =>
      await new Promise<void>((resolveAnimationFrame) => {
        globalThis.requestAnimationFrame(() => resolveAnimationFrame())
      }),
  )
  const thumbBounds = await previewScrollbarThumb.boundingBox()
  const dragTrackBounds = await previewScrollbar.boundingBox()
  if (!thumbBounds || !dragTrackBounds) throw new Error('无法读取页面预览滑块的位置。')
  expect(thumbBounds.height).toBeGreaterThanOrEqual(36)
  await window.mouse.move(
    thumbBounds.x + thumbBounds.width / 2,
    thumbBounds.y + thumbBounds.height / 2,
  )
  await window.mouse.down()
  await window.mouse.move(
    dragTrackBounds.x + dragTrackBounds.width / 2,
    dragTrackBounds.y + dragTrackBounds.height - 2,
    { steps: 8 },
  )
  await window.mouse.up()
  await expect
    .poll(async () => await previewScroll.evaluate((element) => element.scrollTop))
    .toBeCloseTo(maximumScrollTop, 0)

  await previewScrollbar.focus()
  await window.keyboard.press('Home')
  const initialThumbHeight = (await previewScrollbarThumb.boundingBox())?.height
  if (!initialThumbHeight) throw new Error('无法读取初始页面预览滑块高度。')
  const zoomSlider = window.locator('.zoom-control').getByRole('slider')
  await zoomSlider.focus()
  await window.keyboard.press('End')
  await expect(zoomSlider).toHaveAttribute('aria-valuenow', '290')
  await expect
    .poll(async () => (await previewScrollbarThumb.boundingBox())?.height ?? 0)
    .toBeLessThan(initialThumbHeight)
  await previewScrollbar.focus()
  await window.keyboard.press('Home')

  await window.locator('.top-toolbar').getByRole('button', { name: '导出 PDF' }).click()
  const exportDialog = window.getByRole('dialog')
  await expect(exportDialog.getByText('导出前检查')).toBeVisible({ timeout: 30_000 })
  await expect(exportDialog).toContainText('没有阻止导出的错误')
  await exportDialog.getByRole('button', { name: '选择位置并导出' }).click()
  await expect(exportDialog.getByText('导出完成并通过自动校验')).toBeVisible({ timeout: 90_000 })

  const output = await PDFDocument.load(await readFile(outputPath), {
    updateMetadata: false,
    throwOnInvalidObject: true,
  })
  expect(output.getPageCount()).toBeGreaterThan(10)
  output.getPages().forEach((outputPage) => {
    expect(outputPage.getWidth()).toBeCloseTo(A4_SIZE_POINTS.width, 1)
    expect(outputPage.getHeight()).toBeCloseTo(A4_SIZE_POINTS.height, 1)
  })
  const readMarker = (
    outputPage: ReturnType<typeof output.getPages>[number],
    name: string,
  ): string | null => {
    const marker = outputPage.node.get(PDFName.of(name))
    return marker instanceof PDFHexString || marker instanceof PDFString
      ? marker.decodeText()
      : null
  }
  const outputPageIds = output.getPages().map((outputPage) => readMarker(outputPage, 'SPackPageId'))
  expect(outputPageIds).toEqual(previewPlan.pages.map((plannedPage) => plannedPage.id))
  const outputMaterialIds = output
    .getPages()
    .map((outputPage) => readMarker(outputPage, 'SPackMaterialId'))
  expect(outputMaterialIds).toEqual(previewPlan.pages.map((plannedPage) => plannedPage.materialId))
  const reportNames = (await readdir(join(projectDirectory, 'output'))).filter((name) =>
    name.endsWith('-report.json'),
  )
  expect(reportNames).toHaveLength(1)
  const report = JSON.parse(
    await readFile(join(projectDirectory, 'output', reportNames[0] ?? ''), 'utf8'),
  ) as unknown as ExportReport
  expect(report.planFingerprint).toBe(previewPlan.planFingerprint)
  expect(report.pageCount).toBe(previewPlan.totalPageCount)
  expect(report.checks.every((check) => check.passed)).toBe(true)
  expect(report.checks.find((check) => check.code === 'toc-mapping')?.passed).toBe(true)
  expect(report.checks.find((check) => check.code === 'inline-headings')?.passed).toBe(true)
  expect(report.checks.find((check) => check.code === 'page-number-labels')?.passed).toBe(true)
  expect(report.checks.find((check) => check.code === 'semantic-page-markers')?.passed).toBe(true)
  const sourceSnapshotsAfter = await Promise.all(
    sourcePaths.map(async (path) => await readFile(path)),
  )
  sourceSnapshotsAfter.forEach((snapshot, index) => {
    const sourceBefore = sourceSnapshots[index]
    if (!sourceBefore) throw new Error(`缺少第 ${index + 1} 个原始文件快照。`)
    expect(snapshot.equals(sourceBefore)).toBe(true)
  })
  expect(consoleErrors).toEqual([])
})
