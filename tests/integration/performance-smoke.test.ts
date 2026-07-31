import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executePdfExport } from '../../src/main/services/pdf-export-service.js'
import { A4_SIZE_POINTS } from '../../src/shared/constants/document.js'
import { buildPagePlan } from '../../src/shared/utils/page-plan.js'
import type { PdfExportWorkerStart } from '../../src/shared/types/worker-protocol.js'
import { createMaterialFixture, createProjectFixture } from '../helpers/project-fixture.js'

let testDirectory = ''

beforeAll(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), 'spack-performance-'))
})

afterAll(async () => {
  await rm(testDirectory, { recursive: true, force: true })
})

const createThreeHundredPagePdf = async (outputPath: string): Promise<void> => {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < 300; index += 1) {
    const page = document.addPage([A4_SIZE_POINTS.width, A4_SIZE_POINTS.height])
    page.drawText(`SupportPack performance fixture ${index + 1}`, {
      x: 48,
      y: A4_SIZE_POINTS.height - 72,
      size: 12,
      font,
      color: rgb(0.15, 0.25, 0.35),
    })
  }
  await writeFile(outputPath, await document.save())
}

describe('300 页性能烟测', () => {
  it('真实转换并重新读取 300 个 A4 物理页面', async () => {
    const sourcePath = join(testDirectory, 'source-300-pages.pdf')
    const outputPath = join(testDirectory, 'output-300-pages.pdf')
    const reportPath = join(testDirectory, 'output-300-pages-report.json')
    await createThreeHundredPagePdf(sourcePath)
    const sourceStat = await stat(sourcePath)
    const source = {
      id: '00000000-0000-4000-8000-000000000105',
      sourceType: 'pdf' as const,
      sourcePath,
      storedPath: null,
      originalFileName: 'source-300-pages.pdf',
      fileHash: 'b'.repeat(64),
      fileSize: sourceStat.size,
      modifiedTime: sourceStat.mtimeMs,
      mimeType: 'application/pdf',
      pageCount: 300,
      selectedPageRanges: 'all',
    }
    const material = createMaterialFixture({
      sourcePath,
      storedPath: null,
      originalFileName: source.originalFileName,
      fileHash: source.fileHash,
      fileSize: source.fileSize,
      modifiedTime: source.modifiedTime,
      pageCount: 300,
      selectedPageRanges: 'all',
      sourceItems: [source],
    })
    const base = createProjectFixture()
    const outlineNodes = structuredClone(base.outlineNodes)
    const first = outlineNodes[0]
    const child = first?.children[0]
    if (!first || !child) throw new Error('性能测试目录结构无效。')
    first.insertDividerPage = false
    child.materials = [material]
    const project = createProjectFixture({
      assetStorageMode: 'reference',
      coverSettings: { ...base.coverSettings, enabled: false },
      tocSettings: { ...base.tocSettings, enabled: false },
      pageNumberSettings: { ...base.pageNumberSettings, enabled: false },
      exportSettings: {
        ...base.exportSettings,
        includeCover: false,
        includeToc: false,
        includeDividerPages: false,
        includeMaterialTitlePages: false,
        addPageNumbers: false,
      },
      outlineNodes,
    })
    const plan = buildPagePlan(project, { tocPageCount: 0, revision: 1 })
    expect(plan.totalPageCount).toBe(300)
    const request: PdfExportWorkerStart = {
      type: 'start',
      taskId: 'performance-300-pages',
      projectDirectory: testDirectory,
      outputPath,
      reportPath,
      project,
      plan,
      generatedPages: {},
      boldFontPath: join(
        process.cwd(),
        'resources',
        'public',
        'fonts',
        'SupportPackSansSC-Bold.ttf',
      ),
    }

    let peakResidentBytes = process.memoryUsage().rss
    const monitor = setInterval(() => {
      peakResidentBytes = Math.max(peakResidentBytes, process.memoryUsage().rss)
    }, 20)
    const startedAt = performance.now()
    try {
      const result = await executePdfExport(request, {
        isCancelled: () => false,
        onProgress: () => undefined,
      })
      expect(result.status, result.message).toBe('success')
      expect(result.report?.checks.every((check) => check.passed)).toBe(true)
    } finally {
      clearInterval(monitor)
    }
    const elapsedMilliseconds = Math.round(performance.now() - startedAt)
    const output = await PDFDocument.load(await readFile(outputPath), {
      updateMetadata: false,
      throwOnInvalidObject: true,
    })
    expect(output.getPageCount()).toBe(300)
    output.getPages().forEach((page) => {
      expect(page.getWidth()).toBeCloseTo(A4_SIZE_POINTS.width, 1)
      expect(page.getHeight()).toBeCloseTo(A4_SIZE_POINTS.height, 1)
    })
    const outputStat = await stat(outputPath)
    process.stdout.write(
      `\nPERFORMANCE_SMOKE pages=300 input_bytes=${sourceStat.size} output_bytes=${outputStat.size} elapsed_ms=${elapsedMilliseconds} peak_rss_bytes=${peakResidentBytes}\n`,
    )
  }, 120_000)
})
