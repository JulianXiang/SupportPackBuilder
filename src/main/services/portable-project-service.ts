import { createWriteStream } from 'node:fs'
import { access, cp, lstat, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { openPromise, type Entry } from 'yauzl'
import { ZipFile } from 'yazl'
import { z } from 'zod'
import {
  ProjectSchema,
  type MaterialSource,
  type Project,
} from '../../shared/schemas/project-schema.js'
import { sanitizeFileName } from '../../shared/utils/file-name.js'
import {
  createProjectDirectory,
  migrateProjectData,
  resolveMaterialSourcePath,
  writeProjectAtomically,
  type ProjectSession,
} from './project-service.js'

const PORTABLE_FORMAT_NAME = 'support-pack-builder-portable'
const MAX_PORTABLE_ENTRIES = 10_000
const MAX_PORTABLE_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
const MAX_COMPRESSION_RATIO = 200

const PortableVersionSchema = z.object({
  format: z.literal(PORTABLE_FORMAT_NAME),
  schemaVersion: z.literal(1),
  createdAt: z.iso.datetime(),
})

export type PortableExportResult = {
  outputPath: string
  assetCount: number
}

const allMaterials = (project: Project) =>
  project.outlineNodes.flatMap((node) => node.children.flatMap((child) => child.materials))

const portableAssetPath = (source: MaterialSource): string => {
  const extension = extname(source.originalFileName).toLowerCase()
  const base = sanitizeFileName(basename(source.originalFileName, extension), 'material')
  return posix.join('assets', `${source.id}-${base}${extension}`)
}

const portableConversionPath = (source: MaterialSource): string =>
  posix.join('assets', 'conversions', `${source.id}-converted.pdf`)

const normalizePortableProject = (
  session: ProjectSession,
): { project: Project; assets: Map<string, string> } => {
  const project = structuredClone(session.project)
  const assets = new Map<string, string>()
  project.assetStorageMode = 'copy'
  project.projectDirectory = '.'

  for (const material of allMaterials(project)) {
    for (const source of material.sourceItems) {
      const sourcePath = resolveMaterialSourcePath(session.projectDirectory, material, source.id)
      const archivePath = portableAssetPath(source)
      assets.set(archivePath, sourcePath)
      source.sourcePath = archivePath
      source.storedPath = archivePath
      if (source.conversion) {
        const snapshotPath = resolve(session.projectDirectory, source.conversion.pdfStoredPath)
        const snapshotRelative = relative(session.projectDirectory, snapshotPath)
        if (snapshotRelative.startsWith('..') || isAbsolute(snapshotRelative)) {
          throw new Error(`材料《${material.title}》的 Office 转换快照路径越界。`)
        }
        const conversionArchivePath = portableConversionPath(source)
        assets.set(conversionArchivePath, snapshotPath)
        source.conversion.pdfStoredPath = conversionArchivePath
      }
    }
    const primary = material.sourceItems[0]
    if (primary) {
      material.sourcePath = primary.sourcePath
      material.storedPath = primary.storedPath
      material.originalFileName = primary.originalFileName
      material.fileHash = primary.fileHash
      material.fileSize = material.sourceItems.reduce((total, source) => total + source.fileSize, 0)
      material.modifiedTime = Math.max(...material.sourceItems.map((source) => source.modifiedTime))
    }
  }

  return { project: ProjectSchema.parse(project), assets }
}

const replaceFileAtomically = async (temporaryPath: string, outputPath: string): Promise<void> => {
  const backupPath = `${outputPath}.spack-backup`
  const hasOriginal = await access(outputPath, fsConstants.F_OK).then(
    () => true,
    () => false,
  )
  if (hasOriginal) {
    await rm(backupPath, { force: true })
    await rename(outputPath, backupPath)
  }
  try {
    await rename(temporaryPath, outputPath)
    await rm(backupPath, { force: true })
  } catch (error) {
    if (hasOriginal) {
      await rename(backupPath, outputPath).catch(() => undefined)
    }
    throw error
  }
}

export const exportPortableProject = async (
  session: ProjectSession,
  requestedOutputPath: string,
): Promise<PortableExportResult> => {
  const outputPath = requestedOutputPath.toLowerCase().endsWith('.spack')
    ? requestedOutputPath
    : `${requestedOutputPath}.spack`
  await mkdir(dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.${crypto.randomUUID()}.tmp`
  const { project, assets } = normalizePortableProject(session)
  const zip = new ZipFile()

  try {
    for (const [archivePath, sourcePath] of assets) {
      const sourceStat = await lstat(sourcePath)
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        throw new Error(`文件《${basename(sourcePath)}》不是可打包的普通文件。`)
      }
      zip.addFile(sourcePath, archivePath, { mode: 0o100600 })
    }
    if (assets.size === 0) zip.addEmptyDirectory('assets/', { mode: 0o40700 })
    zip.addBuffer(Buffer.from(`${JSON.stringify(project, null, 2)}\n`, 'utf8'), 'project.json', {
      mode: 0o100600,
    })
    zip.addBuffer(
      Buffer.from(
        `${JSON.stringify(
          {
            format: PORTABLE_FORMAT_NAME,
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        'utf8',
      ),
      'version.json',
      { mode: 0o100600 },
    )

    const output = createWriteStream(temporaryPath, {
      flags: 'wx',
      mode: 0o600,
    })
    const completed = pipeline(zip.outputStream, output)
    zip.end()
    await completed
    const archiveStat = await stat(temporaryPath)
    if (archiveStat.size <= 0) throw new Error('生成的便携项目包为空。')
    await replaceFileAtomically(temporaryPath, outputPath)
    return { outputPath, assetCount: assets.size }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

const validateArchivePath = (fileName: string): string => {
  if (
    fileName.includes('\\') ||
    fileName.includes('\0') ||
    fileName.startsWith('/') ||
    /^[A-Za-z]:/.test(fileName)
  ) {
    throw new Error(`便携包包含不安全路径“${fileName}”。`)
  }
  const normalized = posix.normalize(fileName)
  if (
    normalized !== fileName ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    isAbsolute(normalized)
  ) {
    throw new Error(`便携包包含目录穿越路径“${fileName}”。`)
  }
  const allowed =
    normalized === 'project.json' ||
    normalized === 'version.json' ||
    normalized === 'assets/' ||
    normalized.startsWith('assets/')
  if (!allowed) throw new Error(`便携包包含不允许的条目“${fileName}”。`)
  return normalized
}

const assertSafeEntry = (entry: Entry): string => {
  const fileName = validateArchivePath(entry.fileName)
  if (entry.isEncrypted()) throw new Error(`便携包条目“${fileName}”已加密，无法导入。`)
  if (!entry.canDecodeFileData()) {
    throw new Error(`便携包条目“${fileName}”使用了不支持的压缩方式。`)
  }
  const unixMode = entry.externalFileAttributes >>> 16
  const fileType = unixMode & 0o170000
  if (fileType === 0o120000) {
    throw new Error(`便携包条目“${fileName}”是符号链接，已拒绝导入。`)
  }
  if (
    entry.uncompressedSize > 0 &&
    (entry.compressedSize === 0 ||
      entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)
  ) {
    throw new Error(`便携包条目“${fileName}”的压缩比异常，可能是 ZIP 炸弹。`)
  }
  return fileName
}

const assertExtractedProjectIsPortable = async (
  temporaryDirectory: string,
  project: Project,
): Promise<void> => {
  if (project.assetStorageMode !== 'copy') {
    throw new Error('便携项目包必须使用复制存储模式。')
  }
  for (const material of allMaterials(project)) {
    for (const source of material.sourceItems) {
      if (!source.storedPath?.startsWith('assets/')) {
        throw new Error(`材料《${material.title}》包含外部文件引用，便携包不完整。`)
      }
      const absolutePath = resolve(temporaryDirectory, source.storedPath)
      const relativePath = relative(temporaryDirectory, absolutePath)
      if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error(`材料《${material.title}》的资产路径越界。`)
      }
      const sourceStat = await stat(absolutePath)
      if (!sourceStat.isFile()) {
        throw new Error(`材料《${material.title}》的资产文件不存在。`)
      }
      if (source.conversion) {
        if (!source.conversion.pdfStoredPath.startsWith('assets/conversions/')) {
          throw new Error(`材料《${material.title}》的 Office 转换快照不在便携包中。`)
        }
        const snapshotPath = resolve(temporaryDirectory, source.conversion.pdfStoredPath)
        const snapshotRelative = relative(temporaryDirectory, snapshotPath)
        if (snapshotRelative.startsWith('..') || isAbsolute(snapshotRelative)) {
          throw new Error(`材料《${material.title}》的 Office 转换快照路径越界。`)
        }
        const snapshotStat = await stat(snapshotPath)
        if (!snapshotStat.isFile() || snapshotStat.size <= 0) {
          throw new Error(`材料《${material.title}》的 Office 转换快照不存在。`)
        }
      }
    }
  }
}

export const importPortableProject = async (
  archivePath: string,
  destinationParent: string,
): Promise<ProjectSession> => {
  const temporaryDirectory = join(destinationParent, `.spack-import-${crypto.randomUUID()}`)
  await mkdir(temporaryDirectory, { recursive: false })
  let zip: Awaited<ReturnType<typeof openPromise>> | null = null

  try {
    zip = await openPromise(archivePath, {
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    })
    if (zip.entryCount > MAX_PORTABLE_ENTRIES) {
      throw new Error(`便携包条目过多（${zip.entryCount}），已拒绝导入。`)
    }
    let totalUncompressedBytes = 0
    let entryCount = 0
    for await (const entry of zip.eachEntry()) {
      entryCount += 1
      if (entryCount > MAX_PORTABLE_ENTRIES) {
        throw new Error('便携包条目数量超过安全限制。')
      }
      const fileName = assertSafeEntry(entry)
      totalUncompressedBytes += entry.uncompressedSize
      if (totalUncompressedBytes > MAX_PORTABLE_UNCOMPRESSED_BYTES) {
        throw new Error('便携包解压后的大小超过 2 GB 安全限制。')
      }
      const destination = resolve(temporaryDirectory, fileName)
      const destinationRelative = relative(temporaryDirectory, destination)
      if (destinationRelative.startsWith('..') || isAbsolute(destinationRelative)) {
        throw new Error(`便携包条目“${fileName}”的目标路径越界。`)
      }
      if (fileName.endsWith('/')) {
        await mkdir(destination, { recursive: true })
        continue
      }
      await mkdir(dirname(destination), { recursive: true })
      const sourceStream = await zip.openReadStreamPromise(entry)
      await pipeline(sourceStream, createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
    }

    PortableVersionSchema.parse(
      JSON.parse(await readFile(join(temporaryDirectory, 'version.json'), 'utf8')) as unknown,
    )
    const project = migrateProjectData(
      JSON.parse(await readFile(join(temporaryDirectory, 'project.json'), 'utf8')) as unknown,
    )
    await assertExtractedProjectIsPortable(temporaryDirectory, project)
    const session = await createProjectDirectory(destinationParent, project)
    await cp(join(temporaryDirectory, 'assets'), join(session.projectDirectory, 'assets'), {
      recursive: true,
      force: false,
      errorOnExist: false,
    })
    session.project = await writeProjectAtomically(session.projectDirectory, project)
    return session
  } finally {
    zip?.close()
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}
