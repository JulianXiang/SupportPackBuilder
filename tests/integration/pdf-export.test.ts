import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateFixtures, type FixtureManifest } from '../../scripts/generate-fixtures.js'
import { executePdfExport } from '../../src/main/services/pdf-export-service.js'
import { ImportService } from '../../src/main/services/import-service.js'
import { ConversionManager } from '../../src/main/services/conversion-manager.js'
import { LibreOfficeConversionAdapter } from '../../src/main/services/libreoffice-conversion-adapter.js'
import { A4_SIZE_POINTS } from '../../src/shared/constants/document.js'
import type { LayoutSection } from '../../src/shared/schemas/project-schema.js'
import {
  createLayoutSection,
  createLayoutSheet,
  mapLayoutNode,
} from '../../src/shared/utils/layout-tree.js'
import { buildPagePlan } from '../../src/shared/utils/page-plan.js'
import type { PdfExportWorkerStart } from '../../src/shared/types/worker-protocol.js'
import { createProjectFixture, IDS } from '../helpers/project-fixture.js'

let testDirectory = ''
let fixtures: FixtureManifest

const acknowledgeClarity = (section: LayoutSection): LayoutSection => ({
  ...section,
  layout: mapLayoutNode(section.layout, (node) =>
    node.kind === 'slot' ? { ...node, clarityRiskAcknowledged: true } : node,
  ),
})

beforeAll(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), 'spack-export-integration-'))
  fixtures = await generateFixtures(join(testDirectory, 'fixtures'))
}, 30_000)

afterAll(async () => {
  await rm(testDirectory, { recursive: true, force: true })
})

const prepareExportRequest = async (
  taskId: string,
  materialGrouping: 'separate' | 'singleResult' = 'separate',
): Promise<PdfExportWorkerStart> => {
  const base = createProjectFixture()
  const emptyOutline = structuredClone(base.outlineNodes)
  const parent = emptyOutline[0]
  const child = parent?.children[0]
  if (!parent || !child) throw new Error('测试目录结构无效。')
  child.materials = []
  parent.insertDividerPage = false
  const project = {
    ...base,
    assetStorageMode: 'reference' as const,
    coverSettings: { ...base.coverSettings, enabled: false },
    tocSettings: { ...base.tocSettings, enabled: false },
    exportSettings: {
      ...base.exportSettings,
      includeCover: false,
      includeToc: false,
      includeDividerPages: false,
      includeMaterialTitlePages: false,
    },
    outlineNodes: emptyOutline,
  }
  const importService = new ImportService(
    new ConversionManager(new LibreOfficeConversionAdapter(null)),
  )
  const analysis = await importService.analyze(project, [fixtures.tenPagePdf, fixtures.pngImage], {
    projectDirectory: testDirectory,
  })
  const imported = await importService.commit(testDirectory, project, {
    token: analysis.token,
    targetOutlineNodeId: IDS.level2,
    materialGrouping,
    ...(materialGrouping === 'singleResult'
      ? { groupedMaterialTitle: '同一成果的 PDF 证明与图片附件' }
      : {}),
    imageGrouping: 'separate',
    resolutions: analysis.candidates.map((candidate) => ({
      candidateId: candidate.id,
      action: 'import' as const,
    })),
  })
  const pdfMaterial = imported.project.outlineNodes
    .flatMap((node) => node.children)
    .flatMap((node) => node.materials)
    .find((material) => material.sourceItems.some((source) => source.sourceType === 'pdf'))
  if (!pdfMaterial) throw new Error('未创建 PDF 测试材料。')
  const pdfSource = pdfMaterial.sourceItems.find((source) => source.sourceType === 'pdf')
  if (!pdfSource) throw new Error('未创建 PDF 测试来源。')
  if (pdfMaterial.sourceItems.length === 1) pdfMaterial.selectedPageRanges = '1,3,5-7'
  else pdfSource.selectedPageRanges = '1,3,5-7'
  const plan = buildPagePlan(imported.project, { revision: 1, tocPageCount: 0 })
  const outputPath = join(testDirectory, `${taskId}.pdf`)
  return {
    type: 'start',
    taskId,
    projectDirectory: testDirectory,
    outputPath,
    reportPath: join(testDirectory, `${taskId}-report.json`),
    project: imported.project,
    plan,
    generatedPages: {},
    fontPath: join(process.cwd(), 'resources', 'public', 'fonts', 'SupportPackSansSC-Regular.ttf'),
    boldFontPath: join(process.cwd(), 'resources', 'public', 'fonts', 'SupportPackSansSC-Bold.ttf'),
  }
}

describe('真实 PDF 导出流水线', () => {
  it('将 PDF 指定页和图片合并为可重新读取的 A4 PDF，并验证顺序与页码标记', async () => {
    const request = await prepareExportRequest('export-success')
    const sourceBefore = await Promise.all([
      readFile(fixtures.tenPagePdf),
      readFile(fixtures.pngImage),
    ])
    const progress: number[] = []
    const result = await executePdfExport(request, {
      isCancelled: () => false,
      onProgress: (event) => progress.push(event.percentage),
    })

    expect(result.status).toBe('success')
    expect(result.report?.checks.every((check) => check.passed)).toBe(true)
    expect(progress.at(-1)).toBe(100)
    const output = await PDFDocument.load(await readFile(request.outputPath))
    expect(output.getPageCount()).toBe(6)
    output.getPages().forEach((page) => {
      expect(page.getWidth()).toBeCloseTo(A4_SIZE_POINTS.width, 1)
      expect(page.getHeight()).toBeCloseTo(A4_SIZE_POINTS.height, 1)
    })
    const sourceAfter = await Promise.all([
      readFile(fixtures.tenPagePdf),
      readFile(fixtures.pngImage),
    ])
    expect(sourceAfter[0].equals(sourceBefore[0])).toBe(true)
    expect(sourceAfter[1].equals(sourceBefore[1])).toBe(true)
  }, 30_000)

  it('取消时清理临时文件且不产生目标 PDF', async () => {
    const request = await prepareExportRequest('export-cancelled')
    const result = await executePdfExport(request, {
      isCancelled: () => true,
      onProgress: () => undefined,
    })
    expect(result.status).toBe('cancelled')
    await expect(access(request.outputPath)).rejects.toBeDefined()
  })

  it('把同一成果的 PDF 页面真实合成为一张横向 A4 拼版页', async () => {
    const request = await prepareExportRequest('export-collage')
    const pdfMaterial = request.project.outlineNodes
      .flatMap((node) => node.children)
      .flatMap((node) => node.materials)
      .find((material) => material.sourceType === 'pdf')
    const source = pdfMaterial?.sourceItems[0]
    if (!pdfMaterial || !source) throw new Error('未找到拼版测试材料。')
    const firstPageId = `${source.id}:0`
    const secondPageId = `${source.id}:2`
    const section = acknowledgeClarity(
      createLayoutSection(pdfMaterial.id, [firstPageId, secondPageId], 'two-up'),
    )
    request.project.layoutSheets = [
      createLayoutSheet({
        anchorSourcePageId: firstPageId,
        sections: [section],
        order: 0,
        orientation: 'landscape',
        templateId: 'two-up',
        project: request.project,
      }),
    ]
    request.plan = buildPagePlan(request.project, { revision: 2, tocPageCount: 0 })
    expect(request.plan.errors).toEqual([])
    expect(request.plan.pages.filter((page) => page.pageType === 'compositeContent')).toHaveLength(
      1,
    )

    const result = await executePdfExport(request, {
      isCancelled: () => false,
      onProgress: () => undefined,
    })
    expect(result.status, result.message).toBe('success')
    expect(result.report?.checks.every((check) => check.passed)).toBe(true)
    const output = await PDFDocument.load(await readFile(request.outputPath))
    expect(output.getPageCount()).toBe(5)
    const compositeIndex = request.plan.pages.findIndex(
      (page) => page.pageType === 'compositeContent',
    )
    const compositePage = output.getPage(compositeIndex)
    expect(compositePage.getWidth()).toBeCloseTo(A4_SIZE_POINTS.height, 1)
    expect(compositePage.getHeight()).toBeCloseTo(A4_SIZE_POINTS.width, 1)
  }, 30_000)

  it('把 PDF 与图片作为同一项混合成果导入、选页并导出', async () => {
    const request = await prepareExportRequest('export-mixed-result', 'singleResult')
    const materials = request.project.outlineNodes.flatMap((node) =>
      node.children.flatMap((child) => child.materials),
    )
    expect(materials).toHaveLength(1)
    const material = materials[0]
    if (!material) throw new Error('未创建混合成果。')
    expect(material.sourceType).toBe('mixed')
    expect(material.sourceItems.map((source) => source.sourceType)).toEqual(['pdf', 'image'])
    expect(
      request.plan.pages.filter((page) => page.materialIds.includes(material.id)),
    ).toHaveLength(6)

    const result = await executePdfExport(request, {
      isCancelled: () => false,
      onProgress: () => undefined,
    })
    expect(result.status, result.message).toBe('success')
    expect(result.report?.checks.every((check) => check.passed)).toBe(true)
  }, 30_000)

  it('把相邻的两项成果按全宽上下区段合成同一 A4 页并共享目录页码', async () => {
    const request = await prepareExportRequest('export-cross-material')
    const materials = request.project.outlineNodes.flatMap((node) =>
      node.children.flatMap((child) => child.materials),
    )
    const imageMaterial = materials.find((material) => material.sourceType === 'image')
    const pdfMaterial = materials.find((material) => material.sourceType === 'pdf')
    const imageSource = imageMaterial?.sourceItems[0]
    const pdfSource = pdfMaterial?.sourceItems[0]
    if (!imageMaterial || !pdfMaterial || !imageSource || !pdfSource) {
      throw new Error('缺少跨成果拼版测试来源。')
    }
    const imagePageId = `${imageSource.id}:0`
    const pdfPageId = `${pdfSource.id}:0`
    const sections = [
      acknowledgeClarity(createLayoutSection(imageMaterial.id, [imagePageId], 'two-up')),
      acknowledgeClarity(createLayoutSection(pdfMaterial.id, [pdfPageId], 'two-up')),
    ]
    request.project.layoutSheets = [
      createLayoutSheet({
        anchorSourcePageId: imagePageId,
        sections,
        order: 0,
        orientation: 'portrait',
        templateId: 'multi-material-sections',
        project: request.project,
      }),
    ]
    request.plan = buildPagePlan(request.project, { revision: 3, tocPageCount: 0 })
    expect(request.plan.errors).toEqual([])
    const composite = request.plan.pages.find((page) => page.pageType === 'compositeContent')
    expect(composite?.materialIds).toEqual([imageMaterial.id, pdfMaterial.id])
    expect(request.plan.materialStartPages[imageMaterial.id]).toBe(
      request.plan.materialStartPages[pdfMaterial.id],
    )

    const result = await executePdfExport(request, {
      isCancelled: () => false,
      onProgress: () => undefined,
    })
    expect(result.status, result.message).toBe('success')
    expect(result.report?.checks.every((check) => check.passed)).toBe(true)
    await expect(PDFDocument.load(await readFile(request.outputPath))).resolves.toBeDefined()
  }, 30_000)
})
