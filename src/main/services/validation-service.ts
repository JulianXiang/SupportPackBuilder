import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileTypeFromFile } from 'file-type'
import { PDFDocument } from 'pdf-lib'
import sharp, { type Metadata } from 'sharp'
import type { Material, Project, ValidationMessage } from '../../shared/schemas/project-schema.js'
import type { ValidatedSource } from '../../shared/types/import.js'
import {
  inspectOoxmlPackage,
  isExplicitlyUnsupportedOfficePath,
  officeFormatFromPath,
} from './ooxml-validation-service.js'

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.docx',
  '.pptx',
  '.xlsx',
])
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
])

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
  const officeFormat = officeFormatFromPath(filePath)
  if (isExplicitlyUnsupportedOfficePath(filePath)) {
    throw new Error(
      `文件《${fileName}》属于旧版或宏启用 Office 格式，当前仅支持 DOCX、PPTX、XLSX。`,
    )
  }
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
  if ((!detected && !officeFormat) || (detected && !ALLOWED_MIME_TYPES.has(detected.mime))) {
    throw new Error(`文件《${fileName}》的真实格式无法识别或不受支持。`)
  }
  const extensionMatches =
    officeFormat !== null
      ? !detected ||
        detected.mime === 'application/zip' ||
        detected.ext === officeFormat ||
        detected.mime.includes('openxmlformats')
      : detected?.ext === 'pdf'
        ? extension === '.pdf'
        : detected?.ext === 'jpg'
          ? extension === '.jpg' || extension === '.jpeg'
          : extension === `.${detected?.ext}`
  if (!extensionMatches) {
    throw new Error(
      `文件《${fileName}》的扩展名与真实格式不一致（检测为 ${detected?.mime ?? '未知'}）。`,
    )
  }

  const [fileHash] = await Promise.all([calculateFileHash(filePath)])
  if (officeFormat) {
    const inspection = await inspectOoxmlPackage(filePath, officeFormat)
    const messages = inspection.warnings.map((message, index) =>
      createValidationMessage(
        `office-inspection-${index + 1}`,
        'warning',
        `文件《${fileName}》：${message}`,
        '请在导入后检查转换快照的页面与排版。',
      ),
    )
    return {
      sourceType: 'office',
      officeFormat,
      officeHasPrintSettings: inspection.hasPrintSettings,
      source: {
        sourceType: 'office',
        originalFileName: fileName,
        fileHash,
        fileSize: fileStat.size,
        modifiedTime: Math.round(fileStat.mtimeMs),
        mimeType: inspection.mimeType,
        pageCount: 1,
        selectedPageRanges: 'all',
      },
      validationStatus: messages.length > 0 ? 'warning' : 'valid',
      validationMessages: messages,
    }
  }
  if (!detected) {
    throw new Error(`文件《${fileName}》的真实格式无法识别或不受支持。`)
  }
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
          sourceType: 'pdf',
          originalFileName: fileName,
          fileHash,
          fileSize: fileStat.size,
          modifiedTime: Math.round(fileStat.mtimeMs),
          mimeType: detected.mime,
          pageCount: Math.max(1, document.getPageCount()),
          selectedPageRanges: 'all',
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
        sourceType: 'pdf',
        originalFileName: fileName,
        fileHash,
        fileSize: fileStat.size,
        modifiedTime: Math.round(fileStat.mtimeMs),
        mimeType: detected.mime,
        pageCount,
        selectedPageRanges: 'all',
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
      sourceType: 'image',
      originalFileName: fileName,
      fileHash,
      fileSize: fileStat.size,
      modifiedTime: Math.round(fileStat.mtimeMs),
      mimeType: detected.mime,
      pageCount: 1,
      selectedPageRanges: 'all',
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
  officeSnapshotStatus?: 'ready' | 'stale' | 'error'
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
    let officeSnapshotStatus: MaterialFileCheck['officeSnapshotStatus']
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
        const metadataChanged =
          fileStat.size !== source.fileSize || Math.round(fileStat.mtimeMs) !== source.modifiedTime
        if (source.sourceType === 'office' && source.conversion) {
          const currentHash = await calculateFileHash(path)
          if (currentHash !== source.conversion.sourceFileHash) {
            officeSnapshotStatus = 'stale'
            status = status === 'error' ? 'error' : 'warning'
            messages.push(
              createValidationMessage(
                'office-snapshot-stale',
                'warning',
                `Office 原件《${source.originalFileName}》自上次转换后已发生变化，当前预览和导出仍使用旧 PDF 快照。`,
                '请检查原件后点击“重新转换 Office 快照”。',
              ),
            )
          } else {
            officeSnapshotStatus = 'ready'
          }
        } else if (metadataChanged) {
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
      if (source.sourceType === 'office') {
        const snapshot = source.conversion
        if (!snapshot) {
          officeSnapshotStatus = 'error'
          status = 'error'
          messages.push(
            createValidationMessage(
              'office-snapshot-missing',
              'error',
              `Office 材料《${material.title}》缺少 PDF 转换快照。`,
              '请重新转换 Office 文件。',
            ),
          )
          continue
        }
        const snapshotPath = resolve(projectDirectory, snapshot.pdfStoredPath)
        const snapshotRelative = relative(projectDirectory, snapshotPath)
        if (snapshotRelative.startsWith('..') || isAbsolute(snapshotRelative)) {
          officeSnapshotStatus = 'error'
          status = 'error'
          messages.push(
            createValidationMessage(
              'office-snapshot-path-invalid',
              'error',
              `Office 材料《${material.title}》的转换快照路径越界。`,
              '请重新导入或修复项目配置。',
            ),
          )
          continue
        }
        try {
          const snapshotStat = await stat(snapshotPath)
          if (!snapshotStat.isFile() || snapshotStat.size !== snapshot.fileSize) {
            throw new Error('快照大小不一致')
          }
        } catch {
          officeSnapshotStatus = 'error'
          status = 'error'
          messages.push(
            createValidationMessage(
              'office-snapshot-invalid',
              'error',
              `Office 材料《${material.title}》的 PDF 转换快照不存在或已损坏。`,
              '请点击“重新转换 Office 快照”。',
            ),
          )
        }
      }
    }
    checks.push({
      materialId: material.id,
      materialTitle: material.title,
      status,
      messages,
      ...(officeSnapshotStatus ? { officeSnapshotStatus } : {}),
    })
  }
  return checks
}

const isLiveFileMessage = (message: ValidationMessage): boolean =>
  message.code === 'source-changed' ||
  message.code === 'source-missing' ||
  message.code === 'invalid-reference-path' ||
  message.code.startsWith('office-snapshot-')

export const synchronizeProjectFileStatuses = async (
  projectDirectory: string,
  project: Project,
): Promise<Project> => {
  const updated = structuredClone(project)
  const checks = await validateProjectFiles(projectDirectory, updated)
  const materials = updated.outlineNodes.flatMap((node) =>
    node.children.flatMap((child) => child.materials),
  )
  for (const check of checks) {
    const material = materials.find((candidate) => candidate.id === check.materialId)
    if (!material) continue
    const persistentMessages = material.validationMessages.filter(
      (message) => !isLiveFileMessage(message),
    )
    const messages = [...persistentMessages, ...check.messages]
    material.validationMessages = messages
    material.validationStatus =
      check.status === 'valid' && messages.some((message) => message.severity === 'warning')
        ? 'warning'
        : check.status
    if (check.officeSnapshotStatus) {
      const snapshotStatus = check.officeSnapshotStatus
      material.sourceItems.forEach((source) => {
        if (source.sourceType === 'office' && source.conversion) {
          source.conversion.snapshotStatus = snapshotStatus
        }
      })
    }
  }
  return updated
}
