import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { generateFixtures } from './generate-fixtures.js'
import { validateSourceFile } from '../src/main/services/validation-service.js'
import type { OfficeFormat } from '../src/shared/schemas/project-schema.js'

const conversionFilter = (format: OfficeFormat): string => {
  if (format === 'docx') return 'pdf:writer_pdf_Export'
  if (format === 'pptx') {
    return 'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"false"},"ExportNotesPages":{"type":"boolean","value":"false"}}'
  }
  return 'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"false"}}'
}

const run = async (executable: string, arguments_: string[]): Promise<string> =>
  await new Promise((resolveCommand, reject) => {
    const child = spawn(executable, arguments_, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SAL_USE_VCLPLUGIN: 'svp',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolveCommand(output.trim())
      else reject(new Error(`打包 LibreOffice 执行失败（退出码 ${String(code)}）：${output}`))
    })
  })

const applicationPath = process.argv[2] ?? resolve('release', 'mac-arm64', '个人支撑材料编排器.app')
const executable =
  process.platform === 'darwin'
    ? join(
        applicationPath,
        'Contents',
        'Resources',
        'libreoffice',
        'LibreOffice.app',
        'Contents',
        'MacOS',
        'soffice',
      )
    : join(applicationPath, 'resources', 'libreoffice', 'program', 'soffice.exe')
await access(executable)
if (process.platform === 'darwin') {
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', applicationPath])
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'supportpack-packaged-office-'))
try {
  const fixtures = await generateFixtures(join(temporaryDirectory, 'fixtures'))
  const engineVersion = await run(executable, ['--version'])
  const sources = [fixtures.docxDocument, fixtures.pptxPresentation, fixtures.xlsxWorkbook]
  const results = []
  for (const [index, sourcePath] of sources.entries()) {
    const validated = await validateSourceFile(sourcePath)
    if (validated.sourceType !== 'office' || !validated.officeFormat) {
      throw new Error(`夹具《${sourcePath}》没有被识别为 Office 文件。`)
    }
    const workingDirectory = join(temporaryDirectory, `conversion-${index}`)
    const profileDirectory = join(workingDirectory, 'profile')
    const outputDirectory = join(workingDirectory, 'output')
    await Promise.all([
      mkdir(profileDirectory, { recursive: true }),
      mkdir(outputDirectory, { recursive: true }),
    ])
    await run(executable, [
      '--headless',
      '--invisible',
      '--nologo',
      '--nodefault',
      '--nolockcheck',
      '--norestore',
      '--nofirststartwizard',
      `-env:UserInstallation=${pathToFileURL(profileDirectory).toString()}`,
      '--convert-to',
      conversionFilter(validated.officeFormat),
      '--outdir',
      outputDirectory,
      sourcePath,
    ])
    const outputName = (await readdir(outputDirectory)).find(
      (name) => extname(name).toLowerCase() === '.pdf',
    )
    if (!outputName) throw new Error(`打包 LibreOffice 没有为《${basename(sourcePath)}》生成 PDF。`)
    const pdfPath = join(outputDirectory, outputName)
    const bytes = await readFile(pdfPath)
    const document = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    })
    if (document.getPageCount() <= 0 || document.isEncrypted) {
      throw new Error(
        `打包 LibreOffice 转换的 ${validated.officeFormat.toUpperCase()} PDF 校验失败。`,
      )
    }
    const fileStat = await stat(pdfPath)
    results.push({
      format: validated.officeFormat,
      pageCount: document.getPageCount(),
      fileSize: fileStat.size,
      fileHash: createHash('sha256').update(bytes).digest('hex'),
      engineVersion,
    })
  }
  if (process.platform === 'darwin') {
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', applicationPath])
  }
  process.stdout.write(
    `${JSON.stringify({
      status: 'PACKAGED_LIBREOFFICE_OK',
      applicationPath,
      executable,
      results,
    })}\n`,
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
