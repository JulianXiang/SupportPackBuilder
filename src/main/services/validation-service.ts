import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, extname, isAbsolute, join } from 'node:path'
import { fileTypeFromFile } from 'file-type'
import { PDFDocument } from 'pdf-lib'
import sharp, { type Metadata } from 'sharp'
import type { Material, Project, ValidationMessage } from '../../shared/schemas/project-schema.js'
import type { ValidatedSource } from '../../shared/types/import.js'

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp'])
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

export const calculateFileHash = async (filePath: string): Promise<string> =>
  await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk)
    })
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })

const createValidationMessage = (
  code: string,
  severity: 'error' | 'warning' | 'info',
  message: string,
  suggestion?: string,
): ValidationMessage => ({
  code,
  severity,
  message,
  ...(suggestion ? { suggestion } : {}),
})

export const validateSourceFile = async (filePath: string): Promise<ValidatedSource> => {
  const fileName = basename(filePath)
  const extension = extname(fileName).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`文件《${fileName}》的扩展名不受支持。`)
  }
  await access(filePath, fsConstants.R_OK)
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) {
    throw new Error(`《${fileName}》不是可导入的普通文件。`)
  }
  if (fileStat.size === 0) {
    throw new Error(`文件《${fileName}》为空，无法导入。`)
  }

  const detected = await fileTypeFromFile(filePath)
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new Error(`文件《${fileName}》的真实格式无法识别或不受支持。`)
  }
  const extensionMatches =
    detected.ext === 'pdf'
      ? extension === '.pdf'
      : detected.ext === 'jpg'
        ? extension === '.jpg' || extension === '.jpeg'
        : extension === `.${detected.ext}`
  if (!extensionMatches) {
    throw new Error(`文件《${fileName}》的扩展名与真实格式不一致（检测为 ${detected.mime}）。`)
  }

  const [fileHash] = await Promise.all([calculateFileHash(filePath)])
  if (detected.mime === 'application/pdf') {
    const bytes = await import('node:fs/promises').then(
      async ({ readFile }) => await readFile(filePath),
    )
    let document: PDFDocument
    try {
      document = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        throwOnInvalidObject: true,
        updateMetadata: false,
      })
    } catch (error) {
      throw new Error(
        `文件《${fileName}》无法解析，可能已损坏或使用了当前版本不支持的 PDF 特性。`,
        { cause: error },
      )
    }
    if (document.isEncrypted) {
      return {
        sourceType: 'pdf',
        source: {
          originalFileName: fileName,
          fileHash,
          fileSize: fileStat.size,
          modifiedTime: Math.round(fileStat.mtimeMs),
          mimeType: detected.mime,
          pageCount: Math.max(1, document.getPageCount()),
        },
        validationStatus: 'encrypted',
        validationMessages: [
          createValidationMessage(
            'pdf-encrypted',
            'error',
            `文件《${fileName}》已加密，当前版本无法处理。`,
            '请先使用其他工具移除密码保护，再重新导入。',
          ),
        ],
      }
    }
    const pageCount = document.getPageCount()
    if (pageCount <= 0) {
      throw new Error(`文件《${fileName}》没有可用页面。`)
    }
    return {
      sourceType: 'pdf',
      source: {
        originalFileName: fileName,
        fileHash,
        fileSize: fileStat.size,
        modifiedTime: Math.round(fileStat.mtimeMs),
        mimeType: detected.mime,
        pageCount,
      },
      validationStatus: 'valid',
      validationMessages: [],
    }
  }

  let metadata: Metadata
  try {
    metadata = await sharp(filePath, { failOn: 'error' }).metadata()
  } catch (error) {
    throw new Error(`图片《${fileName}》无法读取，文件可能已损坏。`, { cause: error })
  }
  if (!metadata.width || !metadata.height) {
    throw new Error(`图片《${fileName}》缺少有效的尺寸或格式信息。`)
  }
  const messages: ValidationMessage[] = []
  const shortestEdge = Math.min(metadata.width, metadata.height)
  if (shortestEdge < 900) {
    messages.push(
      createValidationMessage(
        'image-low-resolution',
        'warning',
        `图片《${fileName}》分辨率较低（${metadata.width}×${metadata.height}），打印时可能不够清晰。`,
        '如有条件，请替换为更高分辨率图片。',
      ),
    )
  }
  return {
    sourceType: 'image',
    source: {
      originalFileName: fileName,
      fileHash,
      fileSize: fileStat.size,
      modifiedTime: Math.round(fileStat.mtimeMs),
      mimeType: detected.mime,
      pageCount: 1,
      width: metadata.width,
      height: metadata.height,
      ...(metadata.orientation ? { exifOrientation: metadata.orientation } : {}),
    },
    validationStatus: messages.length > 0 ? 'warning' : 'valid',
    validationMessages: messages,
  }
}

export type MaterialFileCheck = {
  materialId: string
  materialTitle: string
  status: Material['validationStatus']
  messages: ValidationMessage[]
}

export const validateProjectFiles = async (
  projectDirectory: string,
  project: Project,
): Promise<MaterialFileCheck[]> => {
  const checks: MaterialFileCheck[] = []
  const materials = project.outlineNodes.flatMap((node) =>
    node.children.flatMap((child) => child.materials),
  )
  for (const material of materials) {
    const messages: ValidationMessage[] = []
    let status: Material['validationStatus'] = 'valid'
    for (const source of material.sourceItems) {
      const path = source.storedPath ? join(projectDirectory, source.storedPath) : source.sourcePath
      if (!source.storedPath && !isAbsolute(path)) {
        status = 'error'
        messages.push(
          createValidationMessage(
            'invalid-reference-path',
            'error',
            `材料《${material.title}》的外部引用路径无效。`,
            '请重新定位来源文件。',
          ),
        )
        continue
      }
      try {
        const fileStat = await stat(path)
        if (!fileStat.isFile()) throw new Error('不是普通文件')
        if (
          fileStat.size !== source.fileSize ||
          Math.round(fileStat.mtimeMs) !== source.modifiedTime
        ) {
          status = status === 'error' ? 'error' : 'warning'
          messages.push(
            createValidationMessage(
              'source-changed',
              'warning',
              `文件《${source.originalFileName}》自导入后已发生变化。`,
              '请重新校验材料，确认页面范围和顺序仍然有效。',
            ),
          )
        }
      } catch {
        status = 'missing'
        messages.push(
          createValidationMessage(
            'source-missing',
            'error',
            `文件《${source.originalFileName}》不存在或无法读取。`,
            source.storedPath ? '请恢复项目 assets 目录中的文件。' : '请重新定位外部文件。',
          ),
        )
      }
    }
    checks.push({
      materialId: material.id,
      materialTitle: material.title,
      status,
      messages,
    })
  }
  return checks
}
