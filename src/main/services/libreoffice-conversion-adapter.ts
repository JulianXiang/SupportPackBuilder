import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { OFFICE_CONVERSION_TIMEOUT_MILLISECONDS } from '../../shared/constants/document.js'
import type { OfficeFormat } from '../../shared/schemas/project-schema.js'
import type {
  FileConversionAdapter,
  OfficeConversionRequest,
  OfficeConversionResult,
} from './file-conversion-adapter.js'
import { calculateFileHash } from './validation-service.js'
import { ensureXlsxPrintSettings } from './xlsx-print-settings-service.js'
import { appLog } from './log-service.js'

const PROFILE_SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
</oor:items>
`

const conversionFilter = (format: OfficeFormat): string => {
  if (format === 'docx') return 'pdf:writer_pdf_Export'
  if (format === 'pptx') {
    return 'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"false"},"ExportNotesPages":{"type":"boolean","value":"false"}}'
  }
  return 'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"false"}}'
}

const runProcess = async (input: {
  executable: string
  arguments: string[]
  signal: AbortSignal
  timeoutMilliseconds: number
}): Promise<{ stdout: string; stderr: string }> => {
  if (input.signal.aborted) throw new Error('用户取消了 Office 转换。')
  return await new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.arguments, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SAL_USE_VCLPLUGIN: 'svp',
      },
    })
    let stdout = ''
    let stderr = ''
    const append = (current: string, chunk: Buffer | string): string =>
      `${current}${chunk.toString()}`.slice(-32_768)
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = append(stderr, chunk)
    })
    let settled = false
    let terminationError: Error | null = null
    let forceKillTimer: NodeJS.Timeout | null = null
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      input.signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve({ stdout, stderr })
    }
    const terminate = (reason: Error): void => {
      if (settled || terminationError) return
      terminationError = reason
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
          finish(reason)
        }, 2_000)
        forceKillTimer.unref()
      } else {
        finish(reason)
      }
    }
    const abort = (): void => terminate(new Error('用户取消了 Office 转换。'))
    const timeout = setTimeout(
      () =>
        terminate(
          new Error(
            `Office 转换超过 ${Math.max(1, Math.ceil(input.timeoutMilliseconds / 1_000))} 秒，已停止后台进程。`,
          ),
        ),
      input.timeoutMilliseconds,
    )
    input.signal.addEventListener('abort', abort, { once: true })
    child.once('error', (error) =>
      finish(terminationError ?? new Error(`无法启动 LibreOffice：${error.message}`)),
    )
    child.once('exit', (code, processSignal) => {
      if (settled) return
      if (terminationError) finish(terminationError)
      else if (code === 0) finish()
      else {
        finish(
          new Error(
            `LibreOffice 转换失败（退出码 ${String(code)}${
              processSignal ? `，信号 ${processSignal}` : ''
            }）：${stderr.trim() || stdout.trim() || '未返回详细信息'}`,
          ),
        )
      }
    })
  })
}

export class LibreOfficeConversionAdapter implements FileConversionAdapter {
  readonly id = 'libreoffice' as const
  readonly #executablePath: string | null
  readonly #timeoutMilliseconds: number
  #version: string | null = null

  constructor(
    executablePath: string | null,
    timeoutMilliseconds = OFFICE_CONVERSION_TIMEOUT_MILLISECONDS,
  ) {
    this.#executablePath = executablePath
    this.#timeoutMilliseconds = timeoutMilliseconds
  }

  supports(): boolean {
    return true
  }

  async convert(request: OfficeConversionRequest): Promise<OfficeConversionResult> {
    if (!this.#executablePath) {
      throw new Error(
        '未找到随应用提供的 LibreOffice 离线转换运行时。请重新安装完整版本的个人支撑材料编排器。',
      )
    }
    request.onProgress?.('正在准备 Office 转换环境', 10)
    const profileDirectory = join(request.workingDirectory, 'libreoffice-profile')
    const outputDirectory = join(request.workingDirectory, 'converted')
    await Promise.all([
      mkdir(join(profileDirectory, 'user'), { recursive: true }),
      mkdir(outputDirectory, { recursive: true }),
    ])
    await writeFile(join(profileDirectory, 'user', 'registrymodifications.xcu'), PROFILE_SETTINGS)

    let conversionInput = request.sourcePath
    let completed = false
    try {
      if (request.officeFormat === 'xlsx' && !request.hasPrintSettings) {
        conversionInput = join(
          request.workingDirectory,
          `${basename(request.sourcePath, extname(request.sourcePath))}-print-ready.xlsx`,
        )
        await ensureXlsxPrintSettings(request.sourcePath, conversionInput)
      }

      request.onProgress?.('正在调用 LibreOffice 生成 PDF', 35)
      await runProcess({
        executable: this.#executablePath,
        arguments: [
          '--headless',
          '--invisible',
          '--nologo',
          '--nodefault',
          '--nolockcheck',
          '--norestore',
          '--nofirststartwizard',
          `-env:UserInstallation=${pathToFileURL(profileDirectory).toString()}`,
          '--convert-to',
          conversionFilter(request.officeFormat),
          '--outdir',
          outputDirectory,
          conversionInput,
        ],
        signal: request.signal,
        timeoutMilliseconds: this.#timeoutMilliseconds,
      })

      request.onProgress?.('正在校验 Office 转换结果', 80)
      const outputEntries = await readdir(outputDirectory)
      const pdfName = outputEntries.find((name) => extname(name).toLowerCase() === '.pdf')
      if (!pdfName) throw new Error('LibreOffice 未生成 PDF 文件。')
      const pdfPath = join(outputDirectory, pdfName)
      const bytes = await readFile(pdfPath)
      if (bytes.length === 0) throw new Error('LibreOffice 生成的 PDF 为空。')
      const document = await PDFDocument.load(bytes, {
        ignoreEncryption: false,
        throwOnInvalidObject: true,
        updateMetadata: false,
      })
      if (document.isEncrypted) throw new Error('LibreOffice 生成了加密 PDF，无法继续导入。')
      const pageCount = document.getPageCount()
      if (pageCount <= 0) throw new Error('LibreOffice 生成的 PDF 没有可用页面。')
      const [fileHash, fileStat, engineVersion] = await Promise.all([
        calculateFileHash(pdfPath),
        stat(pdfPath),
        this.#getVersion(request.signal),
      ])
      request.onProgress?.('Office 转换完成', 100)
      completed = true
      return {
        adapterId: this.id,
        engineVersion,
        officeFormat: request.officeFormat,
        pdfPath,
        fileHash,
        fileSize: fileStat.size,
        pageCount,
        convertedAt: new Date().toISOString(),
        warnings:
          request.officeFormat === 'docx'
            ? ['DOCX 排版受本机字体可用性影响，复杂对象可能与 Microsoft Word 略有差异。']
            : request.officeFormat === 'pptx'
              ? ['PPTX 仅转换可见幻灯片；动画、视频和演讲者备注不会进入 PDF。']
              : ['XLSX 转换尊重现有打印设置；未设置时按每个工作表一页宽输出。'],
      }
    } finally {
      const cleanupTargets = [
        profileDirectory,
        ...(conversionInput === request.sourcePath ? [] : [conversionInput]),
        ...(completed ? [] : [outputDirectory]),
      ]
      await Promise.all(
        cleanupTargets.map(async (path) => {
          await rm(path, { recursive: true, force: true }).catch((error: unknown) => {
            appLog.warn('清理 Office 转换临时文件失败', error)
          })
        }),
      )
    }
  }

  async #getVersion(signal: AbortSignal): Promise<string> {
    if (this.#version) return this.#version
    if (!this.#executablePath) throw new Error('LibreOffice 运行时不可用。')
    const result = await runProcess({
      executable: this.#executablePath,
      arguments: ['--version'],
      signal,
      timeoutMilliseconds: 15_000,
    })
    const version = result.stdout.trim() || result.stderr.trim()
    this.#version = version || 'LibreOffice（版本未知）'
    return this.#version
  }
}
