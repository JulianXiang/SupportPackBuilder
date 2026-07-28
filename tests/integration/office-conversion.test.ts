import {
  access,
  appendFile,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateFixtures, type FixtureManifest } from '../../scripts/generate-fixtures.js'
import { ConversionManager } from '../../src/main/services/conversion-manager.js'
import { ImportService } from '../../src/main/services/import-service.js'
import { LibreOfficeConversionAdapter } from '../../src/main/services/libreoffice-conversion-adapter.js'
import { resolveLibreOfficeExecutable } from '../../src/main/services/libreoffice-runtime.js'
import { executePdfExport } from '../../src/main/services/pdf-export-service.js'
import {
  exportPortableProject,
  importPortableProject,
} from '../../src/main/services/portable-project-service.js'
import { writeProjectAtomically } from '../../src/main/services/project-service.js'
import {
  synchronizeProjectFileStatuses,
  validateSourceFile,
} from '../../src/main/services/validation-service.js'
import { A4_SIZE_POINTS } from '../../src/shared/constants/document.js'
import { buildPagePlan } from '../../src/shared/utils/page-plan.js'
import type { PdfExportWorkerStart } from '../../src/shared/types/worker-protocol.js'
import { createProjectFixture, IDS } from '../helpers/project-fixture.js'

let temporaryDirectory = ''
let projectDirectory = ''
let fixtures: FixtureManifest
let libreOfficeExecutable = ''

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'spack-office-integration-'))
  projectDirectory = join(temporaryDirectory, 'project')
  fixtures = await generateFixtures(join(temporaryDirectory, 'fixtures'))
  const executable = await resolveLibreOfficeExecutable({
    appPath: process.cwd(),
    resourcesPath: process.cwd(),
    packaged: false,
  })
  if (!executable) {
    throw new Error('Office 集成测试要求先运行 npm run prepare:libreoffice。')
  }
  libreOfficeExecutable = executable
}, 60_000)

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('OOXML 安全校验与 LibreOffice 离线转换', () => {
  it('识别 DOCX、PPTX、XLSX 真实格式并拒绝损坏伪装文件', async () => {
    const validated = await Promise.all([
      validateSourceFile(fixtures.docxDocument),
      validateSourceFile(fixtures.pptxPresentation),
      validateSourceFile(fixtures.xlsxWorkbook),
      validateSourceFile(fixtures.xlsxWithoutPrintSettings),
    ])

    expect(validated.map((item) => item.officeFormat)).toEqual(['docx', 'pptx', 'xlsx', 'xlsx'])
    expect(validated.every((item) => item.sourceType === 'office')).toBe(true)
    expect(validated[2].officeHasPrintSettings).toBe(true)
    expect(validated[3].officeHasPrintSettings).toBe(false)
    await expect(validateSourceFile(fixtures.corruptedDocx)).rejects.toThrow()
  })

  it('把三种 Office 文件转换为可重新读取的 PDF，且隐藏幻灯片不输出', async () => {
    const manager = new ConversionManager(new LibreOfficeConversionAdapter(libreOfficeExecutable))
    const inputs = [
      { path: fixtures.docxDocument, format: 'docx' as const, hasPrintSettings: false },
      { path: fixtures.pptxPresentation, format: 'pptx' as const, hasPrintSettings: false },
      { path: fixtures.xlsxWorkbook, format: 'xlsx' as const, hasPrintSettings: true },
      {
        path: fixtures.xlsxWithoutPrintSettings,
        format: 'xlsx' as const,
        hasPrintSettings: false,
      },
    ]
    const results = []
    for (const [index, input] of inputs.entries()) {
      const workingDirectory = join(temporaryDirectory, `direct-conversion-${index}`)
      await mkdir(workingDirectory)
      results.push(
        await manager.convert({
          sourcePath: input.path,
          officeFormat: input.format,
          workingDirectory,
          hasPrintSettings: input.hasPrintSettings,
          signal: new AbortController().signal,
        }),
      )
    }

    expect(results.every((result) => result.engineVersion.includes('26.2.5'))).toBe(true)
    expect(results[0]?.pageCount).toBeGreaterThanOrEqual(2)
    expect(results[1]?.pageCount).toBe(2)
    expect(results[2]?.pageCount).toBeGreaterThan(0)
    expect(results[3]?.pageCount).toBeGreaterThan(0)
    for (const result of results) {
      const document = await PDFDocument.load(await readFile(result.pdfPath), {
        updateMetadata: false,
      })
      expect(document.getPageCount()).toBe(result.pageCount)
      expect(document.isEncrypted).toBe(false)
    }
  }, 180_000)

  it('保存 Office 原件与转换快照，并通过既有流水线导出全 A4 PDF', async () => {
    const base = createProjectFixture()
    const outlineNodes = structuredClone(base.outlineNodes)
    const parent = outlineNodes[0]
    const child = parent?.children[0]
    if (!parent || !child) throw new Error('测试目录结构无效。')
    parent.insertDividerPage = false
    child.materials = []
    const project = await writeProjectAtomically(projectDirectory, {
      ...base,
      coverSettings: { ...base.coverSettings, enabled: false },
      tocSettings: { ...base.tocSettings, enabled: false },
      exportSettings: {
        ...base.exportSettings,
        includeCover: false,
        includeToc: false,
        includeDividerPages: false,
        includeMaterialTitlePages: false,
      },
      outlineNodes,
    })
    const importService = new ImportService(
      new ConversionManager(new LibreOfficeConversionAdapter(libreOfficeExecutable)),
    )
    const analysis = await importService.analyze(
      project,
      [fixtures.docxDocument, fixtures.pptxPresentation, fixtures.xlsxWithoutPrintSettings],
      { projectDirectory },
    )
    expect(analysis.candidates.every((candidate) => candidate.sourceType === 'office')).toBe(true)
    expect(
      analysis.candidates.every(
        (candidate) => candidate.validationStatus !== 'error' && candidate.conversion,
      ),
    ).toBe(true)
    const committed = await importService.commit(projectDirectory, project, {
      token: analysis.token,
      targetOutlineNodeId: IDS.level2,
      imageGrouping: 'separate',
      resolutions: analysis.candidates.map((candidate) => ({
        candidateId: candidate.id,
        action: 'import' as const,
      })),
    })
    const materials = committed.project.outlineNodes
      .flatMap((node) => node.children)
      .flatMap((node) => node.materials)
    expect(materials).toHaveLength(3)
    expect(materials.every((material) => material.sourceType === 'office')).toBe(true)
    for (const material of materials) {
      const source = material.sourceItems[0]
      if (!source?.storedPath || !source.conversion) {
        throw new Error('Office 材料缺少原件或转换快照。')
      }
      await expect(access(join(projectDirectory, source.storedPath))).resolves.toBeUndefined()
      await expect(
        access(join(projectDirectory, source.conversion.pdfStoredPath)),
      ).resolves.toBeUndefined()
    }
    expect(
      (await readdir(join(projectDirectory, 'assets', 'conversions'))).filter((name) =>
        name.endsWith('.pdf'),
      ),
    ).toHaveLength(3)
    const savedProject = await writeProjectAtomically(projectDirectory, committed.project)
    const archivePath = join(temporaryDirectory, 'office-project.spack')
    const portable = await exportPortableProject(
      {
        project: savedProject,
        projectDirectory,
        revision: 1,
      },
      archivePath,
    )
    expect(portable.assetCount).toBe(6)
    const portableParent = join(temporaryDirectory, 'portable-import')
    await mkdir(portableParent)
    const portableImported = await importPortableProject(archivePath, portableParent)
    const portableOfficeSources = portableImported.project.outlineNodes
      .flatMap((node) => node.children)
      .flatMap((node) => node.materials)
      .flatMap((material) => material.sourceItems)
      .filter((source) => source.conversion)
    expect(portableOfficeSources).toHaveLength(3)
    for (const source of portableOfficeSources) {
      await expect(
        access(join(portableImported.projectDirectory, source.conversion?.pdfStoredPath ?? '')),
      ).resolves.toBeUndefined()
    }

    const plan = buildPagePlan(committed.project, { revision: 1, tocPageCount: 0 })
    expect(plan.pages.every((page) => page.pageType === 'pdfContent')).toBe(true)
    const request: PdfExportWorkerStart = {
      type: 'start',
      taskId: 'office-export',
      projectDirectory,
      outputPath: join(projectDirectory, 'output', 'office-export.pdf'),
      reportPath: join(projectDirectory, 'output', 'office-export-report.json'),
      project: committed.project,
      plan,
      generatedPages: {},
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
    }
    const result = await executePdfExport(request, {
      isCancelled: () => false,
      onProgress: () => undefined,
    })
    expect(result.status).toBe('success')
    const output = await PDFDocument.load(await readFile(request.outputPath), {
      updateMetadata: false,
    })
    expect(output.getPageCount()).toBe(plan.totalPageCount)
    output.getPages().forEach((page) => {
      expect(page.getWidth()).toBeCloseTo(A4_SIZE_POINTS.width, 1)
      expect(page.getHeight()).toBeCloseTo(A4_SIZE_POINTS.height, 1)
    })

    const firstMaterial = materials[0]
    if (!firstMaterial) throw new Error('缺少重新转换测试材料。')
    firstMaterial.rotationByPage = { [`${firstMaterial.sourceItems[0]?.id ?? ''}:0`]: 90 }
    const reconverted = await importService.reconvertOffice(
      projectDirectory,
      committed.project,
      firstMaterial.id,
      false,
    )
    expect(reconverted.status).toBe('completed')
    if (reconverted.status === 'completed') {
      const updated = reconverted.project.outlineNodes
        .flatMap((node) => node.children)
        .flatMap((node) => node.materials)
        .find((material) => material.id === firstMaterial.id)
      expect(updated?.rotationByPage).toEqual(firstMaterial.rotationByPage)
      expect(updated?.sourceItems[0]?.conversion?.engineVersion).toContain('26.2.5')
    }
  }, 240_000)

  it('引用模式保留 Office 原件绝对路径，但转换快照仍存入项目', async () => {
    const referenceProjectDirectory = join(temporaryDirectory, 'reference-project')
    const referenceSource = join(temporaryDirectory, 'reference-source.docx')
    await copyFile(fixtures.docxDocument, referenceSource)
    const base = createProjectFixture({ assetStorageMode: 'reference' })
    const outlineNodes = structuredClone(base.outlineNodes)
    const child = outlineNodes[0]?.children[0]
    if (!child) throw new Error('测试目录结构无效。')
    child.materials = []
    const project = await writeProjectAtomically(referenceProjectDirectory, {
      ...base,
      outlineNodes,
    })
    const importService = new ImportService(
      new ConversionManager(new LibreOfficeConversionAdapter(libreOfficeExecutable)),
    )
    const analysis = await importService.analyze(project, [referenceSource], {
      projectDirectory: referenceProjectDirectory,
    })
    const candidate = analysis.candidates[0]
    if (!candidate) throw new Error('Office 导入分析未返回候选项。')
    const committed = await importService.commit(referenceProjectDirectory, project, {
      token: analysis.token,
      targetOutlineNodeId: IDS.level2,
      imageGrouping: 'separate',
      resolutions: [{ candidateId: candidate.id, action: 'import' }],
    })
    const source = committed.project.outlineNodes[0]?.children[0]?.materials[0]?.sourceItems[0]
    expect(source?.storedPath).toBeNull()
    expect(source?.sourcePath).toBe(referenceSource)
    expect(source?.conversion?.pdfStoredPath).toMatch(/^assets\/conversions\//)
    await expect(
      access(
        join(referenceProjectDirectory, source?.conversion?.pdfStoredPath ?? 'missing-snapshot'),
      ),
    ).resolves.toBeUndefined()

    await appendFile(referenceSource, '\n原件变化')
    const refreshed = await synchronizeProjectFileStatuses(
      referenceProjectDirectory,
      committed.project,
    )
    const refreshedMaterial = refreshed.outlineNodes[0]?.children[0]?.materials[0]
    expect(refreshedMaterial?.sourceItems[0]?.conversion?.snapshotStatus).toBe('stale')
    expect(refreshedMaterial?.validationStatus).toBe('warning')
    expect(
      refreshedMaterial?.validationMessages.some(
        (message) => message.code === 'office-snapshot-stale',
      ),
    ).toBe(true)
  }, 120_000)

  it.runIf(process.platform !== 'win32')(
    '转换取消与超时会终止子进程并清理配置和临时输出',
    async () => {
      const fakeExecutable = join(temporaryDirectory, 'slow-libreoffice.sh')
      await writeFile(fakeExecutable, '#!/bin/sh\nsleep 30\n', { mode: 0o700 })
      await chmod(fakeExecutable, 0o700)

      const cancelDirectory = join(temporaryDirectory, 'cancel-conversion')
      await mkdir(cancelDirectory)
      const cancelController = new AbortController()
      setTimeout(() => cancelController.abort(), 50)
      await expect(
        new LibreOfficeConversionAdapter(fakeExecutable).convert({
          sourcePath: fixtures.docxDocument,
          officeFormat: 'docx',
          workingDirectory: cancelDirectory,
          hasPrintSettings: false,
          signal: cancelController.signal,
        }),
      ).rejects.toThrow('取消')
      await expect(access(join(cancelDirectory, 'libreoffice-profile'))).rejects.toThrow()
      await expect(access(join(cancelDirectory, 'converted'))).rejects.toThrow()

      const timeoutDirectory = join(temporaryDirectory, 'timeout-conversion')
      await mkdir(timeoutDirectory)
      await expect(
        new LibreOfficeConversionAdapter(fakeExecutable, 50).convert({
          sourcePath: fixtures.docxDocument,
          officeFormat: 'docx',
          workingDirectory: timeoutDirectory,
          hasPrintSettings: false,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('超过')
      await expect(access(join(timeoutDirectory, 'libreoffice-profile'))).rejects.toThrow()
      await expect(access(join(timeoutDirectory, 'converted'))).rejects.toThrow()
    },
    15_000,
  )
})
