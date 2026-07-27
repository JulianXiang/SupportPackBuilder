import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateFixtures, type FixtureManifest } from '../../scripts/generate-fixtures.js'
import { executePdfExport } from '../../src/main/services/pdf-export-service.js'
import { ImportService } from '../../src/main/services/import-service.js'
import { A4_SIZE_POINTS } from '../../src/shared/constants/document.js'
import { buildPagePlan } from '../../src/shared/utils/page-plan.js'
import type { PdfExportWorkerStart } from '../../src/shared/types/worker-protocol.js'
import { createProjectFixture, IDS } from '../helpers/project-fixture.js'

let testDirectory = ''
let fixtures: FixtureManifest

beforeAll(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), 'spack-export-integration-'))
  fixtures = await generateFixtures(join(testDirectory, 'fixtures'))
}, 30_000)

afterAll(async () => {
  await rm(testDirectory, { recursive: true, force: true })
})

const prepareExportRequest = async (taskId: string): Promise<PdfExportWorkerStart> => {
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
  const importService = new ImportService()
  const analysis = await importService.analyze(project, [fixtures.tenPagePdf, fixtures.pngImage])
  const imported = await importService.commit(testDirectory, project, {
    token: analysis.token,
    targetOutlineNodeId: IDS.level2,
    imageGrouping: 'separate',
    resolutions: analysis.candidates.map((candidate) => ({
      candidateId: candidate.id,
      action: 'import' as const,
    })),
  })
  const pdfMaterial = imported.project.outlineNodes
    .flatMap((node) => node.children)
    .flatMap((node) => node.materials)
    .find((material) => material.sourceType === 'pdf')
  if (!pdfMaterial) throw new Error('未创建 PDF 测试材料。')
  pdfMaterial.selectedPageRanges = '1,3,5-7'
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
})
