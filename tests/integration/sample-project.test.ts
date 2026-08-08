import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConversionManager } from '../../src/main/services/conversion-manager.js'
import { ImportService } from '../../src/main/services/import-service.js'
import { LibreOfficeConversionAdapter } from '../../src/main/services/libreoffice-conversion-adapter.js'
import { executePdfExport } from '../../src/main/services/pdf-export-service.js'
import { createSampleProject } from '../../src/main/services/sample-project-service.js'
import { A4_SIZE_POINTS } from '../../src/shared/constants/document.js'
import { ProjectSchema } from '../../src/shared/schemas/project-schema.js'
import { flattenLayoutSlots } from '../../src/shared/utils/layout-tree.js'
import { buildPagePlan } from '../../src/shared/utils/page-plan.js'
import type {
  GeneratedPageReference,
  PdfExportWorkerStart,
} from '../../src/shared/types/worker-protocol.js'

let testDirectory = ''

beforeAll(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), 'spack-sample-integration-'))
})

afterAll(async () => {
  await rm(testDirectory, { recursive: true, force: true })
})

describe('真实示例项目', () => {
  it('经真实导入创建 schema v3 项目、四图拼版并导出 A4 PDF', async () => {
    const fontPath = join(
      process.cwd(),
      'resources',
      'public',
      'fonts',
      'SupportPackSansSC-Regular.ttf',
    )
    const boldFontPath = join(
      process.cwd(),
      'resources',
      'public',
      'fonts',
      'SupportPackSansSC-Bold.ttf',
    )
    const session = await createSampleProject({
      parentDirectory: testDirectory,
      fontPath,
      boldFontPath,
      importService: new ImportService(
        new ConversionManager(new LibreOfficeConversionAdapter(null)),
      ),
    })
    const project = ProjectSchema.parse(
      JSON.parse(await readFile(join(session.projectDirectory, 'project.json'), 'utf8')),
    )

    expect(project.schemaVersion).toBe(3)
    expect(project.title).toBe('示例：个人成果支撑材料')
    expect(relative(testDirectory, session.projectDirectory)).not.toMatch(/^\.\./)
    const materials = project.outlineNodes
      .flatMap((node) => node.children)
      .flatMap((node) => node.materials)
    expect(materials.map((material) => material.title)).toEqual(
      expect.arrayContaining(['年度工作总结示例', '代表性论文示例', '教学活动照片示例']),
    )
    const imageCollection = materials.find((material) => material.title === '教学活动照片示例')
    expect(imageCollection).toMatchObject({ sourceType: 'imageCollection' })
    expect(imageCollection?.sourceItems).toHaveLength(4)

    for (const source of materials.flatMap((material) => material.sourceItems)) {
      expect(source.storedPath).toBeTruthy()
      if (!source.storedPath) continue
      expect(isAbsolute(source.storedPath)).toBe(false)
      const assetPath = resolve(session.projectDirectory, source.storedPath)
      expect(relative(session.projectDirectory, assetPath)).not.toMatch(/^\.\./)
      await expect(access(assetPath)).resolves.toBeUndefined()
    }

    expect(project.layoutSheets).toHaveLength(1)
    expect(project.layoutSheets[0]?.templateId).toBe('four-up')
    const layoutSlots = project.layoutSheets[0]?.sections.flatMap((section) =>
      flattenLayoutSlots(section.layout),
    )
    expect(layoutSlots).toHaveLength(4)
    expect(layoutSlots?.every((slot) => slot.sourcePageId !== null)).toBe(true)
    expect(new Set(layoutSlots?.map((slot) => slot.sourcePageId)).size).toBe(4)

    const plan = buildPagePlan(project, { revision: 1, tocPageCount: 1 })
    expect(plan.errors).toEqual([])
    const composite = plan.pages.find((page) => page.pageType === 'compositeContent')
    expect(composite?.composite?.contentItems).toHaveLength(4)

    const generatedPagePath = join(testDirectory, 'sample-generated-page.pdf')
    const generatedDocument = await PDFDocument.create()
    generatedDocument.addPage([A4_SIZE_POINTS.width, A4_SIZE_POINTS.height])
    await writeFile(generatedPagePath, await generatedDocument.save())
    const generatedPages = Object.fromEntries(
      plan.pages
        .filter((page) => ['cover', 'toc', 'divider', 'materialTitle'].includes(page.pageType))
        .map((page): [string, GeneratedPageReference] => [
          page.id,
          { pdfPath: generatedPagePath, pageIndex: 0 },
        ]),
    )
    const outputPath = join(testDirectory, '示例项目导出.pdf')
    const request: PdfExportWorkerStart = {
      type: 'start',
      taskId: 'sample-project-export',
      projectDirectory: session.projectDirectory,
      outputPath,
      reportPath: join(testDirectory, '示例项目导出-report.json'),
      project,
      plan,
      generatedPages,
      fontPath,
      boldFontPath,
    }
    const result = await executePdfExport(request, {
      isCancelled: () => false,
      onProgress: () => undefined,
    })

    expect(result.status, result.message).toBe('success')
    expect(result.report?.checks.every((check) => check.passed)).toBe(true)
    const output = await PDFDocument.load(await readFile(outputPath))
    expect(output.getPageCount()).toBe(plan.totalPageCount)
    output.getPages().forEach((page) => {
      expect([page.getWidth(), page.getHeight()].sort((left, right) => left - right)).toEqual([
        expect.closeTo(A4_SIZE_POINTS.width, 1),
        expect.closeTo(A4_SIZE_POINTS.height, 1),
      ])
    })
  }, 60_000)

  it('导入失败时清理未完成的示例项目目录', async () => {
    const parentDirectory = join(testDirectory, 'failed-sample')
    await mkdir(parentDirectory, { recursive: true })
    const failingImportService = {
      analyze: () => Promise.reject(new Error('模拟导入失败。')),
    } as unknown as ImportService

    await expect(
      createSampleProject({
        parentDirectory,
        fontPath: join(
          process.cwd(),
          'resources',
          'public',
          'fonts',
          'SupportPackSansSC-Regular.ttf',
        ),
        boldFontPath: join(
          process.cwd(),
          'resources',
          'public',
          'fonts',
          'SupportPackSansSC-Bold.ttf',
        ),
        importService: failingImportService,
      }),
    ).rejects.toThrow('模拟导入失败')
    expect(await readdir(parentDirectory)).toEqual([])
  }, 30_000)
})
