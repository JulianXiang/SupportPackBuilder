import { extname, isAbsolute, posix } from 'node:path'
import { openPromise, type Entry } from 'yauzl'
import {
  OOXML_MAX_COMPRESSION_RATIO,
  OOXML_MAX_ENTRY_COUNT,
  OOXML_MAX_UNCOMPRESSED_BYTES,
} from '../../shared/constants/document.js'
import type { OfficeFormat } from '../../shared/schemas/project-schema.js'

const FORMAT_DEFINITIONS: Record<
  OfficeFormat,
  {
    extension: string
    mimeType: string
    requiredEntry: string
    contentTypeFragment: string
  }
> = {
  docx: {
    extension: '.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    requiredEntry: 'word/document.xml',
    contentTypeFragment:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  },
  pptx: {
    extension: '.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    requiredEntry: 'ppt/presentation.xml',
    contentTypeFragment:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  },
  xlsx: {
    extension: '.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    requiredEntry: 'xl/workbook.xml',
    contentTypeFragment:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  },
}

const MACRO_EXTENSIONS = new Set(['.docm', '.pptm', '.xlsm'])
const LEGACY_EXTENSIONS = new Set(['.doc', '.ppt', '.xls'])
const MAX_INSPECTED_XML_BYTES = 20 * 1024 * 1024

export type OoxmlInspection = {
  officeFormat: OfficeFormat
  mimeType: string
  warnings: string[]
  hasExternalRelationships: boolean
  hasPrintSettings: boolean
}

export const officeFormatFromPath = (filePath: string): OfficeFormat | null => {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.docx') return 'docx'
  if (extension === '.pptx') return 'pptx'
  if (extension === '.xlsx') return 'xlsx'
  return null
}

export const isExplicitlyUnsupportedOfficePath = (filePath: string): boolean => {
  const extension = extname(filePath).toLowerCase()
  return MACRO_EXTENSIONS.has(extension) || LEGACY_EXTENSIONS.has(extension)
}

const assertSafeEntry = (entry: Entry): void => {
  const name = entry.fileName
  if (
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    isAbsolute(name)
  ) {
    throw new Error(`Office 文件包含不安全路径“${name}”。`)
  }
  const normalized = posix.normalize(name)
  if (normalized !== name || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Office 文件包含目录穿越路径“${name}”。`)
  }
  if (entry.isEncrypted()) {
    throw new Error(`Office 文件条目“${name}”已加密，当前版本不支持密码文件。`)
  }
  if (!entry.canDecodeFileData()) {
    throw new Error(`Office 文件条目“${name}”使用了不支持的压缩方式。`)
  }
  const unixMode = entry.externalFileAttributes >>> 16
  if ((unixMode & 0o170000) === 0o120000) {
    throw new Error(`Office 文件条目“${name}”是符号链接，已拒绝导入。`)
  }
  if (
    !name.endsWith('/') &&
    entry.uncompressedSize > 0 &&
    (entry.compressedSize === 0 ||
      entry.uncompressedSize / entry.compressedSize > OOXML_MAX_COMPRESSION_RATIO)
  ) {
    throw new Error(`Office 文件条目“${name}”压缩比异常，可能是 ZIP 炸弹。`)
  }
}

const readEntryText = async (
  zip: Awaited<ReturnType<typeof openPromise>>,
  entry: Entry,
): Promise<string> => {
  if (entry.uncompressedSize > MAX_INSPECTED_XML_BYTES) {
    throw new Error(`Office XML 条目“${entry.fileName}”超过 20 MB 安全检查上限。`)
  }
  const stream = await zip.openReadStreamPromise(entry)
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_INSPECTED_XML_BYTES) {
      stream.destroy()
      throw new Error(`Office XML 条目“${entry.fileName}”读取时超过安全上限。`)
    }
    chunks.push(new Uint8Array(buffer))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export const inspectOoxmlPackage = async (
  filePath: string,
  expectedFormat: OfficeFormat,
): Promise<OoxmlInspection> => {
  const definition = FORMAT_DEFINITIONS[expectedFormat]
  if (extname(filePath).toLowerCase() !== definition.extension) {
    throw new Error(`文件扩展名与 ${expectedFormat.toUpperCase()} 格式不一致。`)
  }

  const zip = await openPromise(filePath, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  })
  try {
    if (zip.entryCount > OOXML_MAX_ENTRY_COUNT) {
      throw new Error(`Office 文件条目过多（${zip.entryCount}），已拒绝导入。`)
    }
    const names = new Set<string>()
    const inspectedXml = new Map<string, string>()
    let totalUncompressedBytes = 0
    let visitedEntries = 0

    for await (const entry of zip.eachEntry()) {
      visitedEntries += 1
      if (visitedEntries > OOXML_MAX_ENTRY_COUNT) {
        throw new Error('Office 文件条目数量超过安全限制。')
      }
      assertSafeEntry(entry)
      totalUncompressedBytes += entry.uncompressedSize
      if (totalUncompressedBytes > OOXML_MAX_UNCOMPRESSED_BYTES) {
        throw new Error('Office 文件解压后的大小超过 1 GB 安全限制。')
      }
      names.add(entry.fileName)
      if (
        entry.fileName === '[Content_Types].xml' ||
        entry.fileName.endsWith('.rels') ||
        entry.fileName === 'word/document.xml' ||
        entry.fileName === 'ppt/presentation.xml' ||
        entry.fileName === 'xl/workbook.xml' ||
        entry.fileName.startsWith('xl/worksheets/sheet')
      ) {
        inspectedXml.set(entry.fileName, await readEntryText(zip, entry))
      }
    }

    if (!names.has('[Content_Types].xml') || !names.has('_rels/.rels')) {
      throw new Error('Office 文件缺少 OOXML 必需的内容类型或关系入口。')
    }
    if (!names.has(definition.requiredEntry)) {
      throw new Error(`Office 文件缺少 ${definition.requiredEntry}，可能已损坏或格式伪装。`)
    }
    const contentTypes = inspectedXml.get('[Content_Types].xml') ?? ''
    if (!contentTypes.includes(definition.contentTypeFragment)) {
      throw new Error(`Office 文件的真实内容类型与 ${expectedFormat.toUpperCase()} 不一致。`)
    }
    if (/macroEnabled|vbaProject/i.test(contentTypes) || names.has('word/vbaProject.bin')) {
      throw new Error('当前版本不支持包含宏的 Office 文件。')
    }

    const relationshipText = [...inspectedXml.entries()]
      .filter(([name]) => name.endsWith('.rels'))
      .map(([, text]) => text)
      .join('\n')
    const hasExternalRelationships = /TargetMode\s*=\s*["']External["']/i.test(relationshipText)
    const warnings: string[] = []
    if (hasExternalRelationships) {
      warnings.push('文件包含外部链接或外部数据关系；离线转换时不会主动更新外部内容。')
    }
    if (expectedFormat === 'docx') {
      const documentXml = inspectedXml.get('word/document.xml') ?? ''
      if (names.has('word/comments.xml'))
        warnings.push('文档包含批注，PDF 排版可能与 Word 略有差异。')
      if (/<w:(?:ins|del)\b/.test(documentXml)) {
        warnings.push('文档包含修订记录，转换结果取决于文件当前保存的修订显示状态。')
      }
    }
    if (expectedFormat === 'pptx') {
      if ([...names].some((name) => name.startsWith('ppt/notesSlides/'))) {
        warnings.push('演讲者备注不会进入 PDF。')
      }
      if ([...names].some((name) => name.startsWith('ppt/media/'))) {
        warnings.push('动画、音频和视频不会作为动态内容进入 PDF。')
      }
    }
    const worksheetText = [...inspectedXml.entries()]
      .filter(([name]) => name.startsWith('xl/worksheets/sheet'))
      .map(([, text]) => text)
      .join('\n')
    const hasPrintSettings =
      expectedFormat === 'xlsx' &&
      (/<pageSetup\b/.test(worksheetText) ||
        (inspectedXml.get('xl/workbook.xml') ?? '').includes('_xlnm.Print_Area'))
    if (expectedFormat === 'xlsx' && !hasPrintSettings) {
      warnings.push('工作簿未设置打印规则，将按每个可见工作表一页宽、纵向不限页转换。')
    }

    return {
      officeFormat: expectedFormat,
      mimeType: definition.mimeType,
      warnings,
      hasExternalRelationships,
      hasPrintSettings,
    }
  } finally {
    zip.close()
  }
}
