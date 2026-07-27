import {
  access,
  copyFile,
  cp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  utimes,
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { ProjectSchema, type Material, type Project } from '../../shared/schemas/project-schema.js'
import { sanitizeFileName } from '../../shared/utils/file-name.js'
import { appLog } from './log-service.js'

export const PROJECT_FILE_NAME = 'project.json'
const PROJECT_BACKUP_FILE_NAME = 'project.json.bak'
const PROJECT_TEMP_FILE_NAME = 'project.json.tmp'

export type ProjectSession = {
  project: Project
  projectDirectory: string
  revision: number
}

const normalizeOrders = (project: Project): Project => {
  const outlineNodes = [...project.outlineNodes]
    .sort((left, right) => left.order - right.order)
    .map((node, nodeIndex) => ({
      ...node,
      order: nodeIndex,
      children: [...node.children]
        .sort((left, right) => left.order - right.order)
        .map((child, childIndex) => ({
          ...child,
          order: childIndex,
          materials: [...child.materials]
            .sort((left, right) => left.order - right.order)
            .map((material, materialIndex) => ({
              ...material,
              order: materialIndex,
            })),
        })),
    }))
  return {
    ...project,
    outlineNodes,
  }
}

const ensureProjectDirectories = async (projectDirectory: string): Promise<void> => {
  await Promise.all([
    mkdir(join(projectDirectory, 'assets'), { recursive: true }),
    mkdir(join(projectDirectory, 'cache', 'thumbnails'), { recursive: true }),
    mkdir(join(projectDirectory, 'cache', 'previews'), { recursive: true }),
    mkdir(join(projectDirectory, 'temp'), { recursive: true }),
    mkdir(join(projectDirectory, 'output'), { recursive: true }),
  ])
}

export const migrateProjectData = (data: unknown): Project => {
  if (!data || typeof data !== 'object') {
    throw new Error('项目配置不是有效的 JSON 对象。')
  }
  const schemaVersion = (data as { schemaVersion?: unknown }).schemaVersion
  if (schemaVersion === 1) return ProjectSchema.parse(data)
  if (schemaVersion === undefined || schemaVersion === 0) {
    const legacy = data as Record<string, unknown>
    return ProjectSchema.parse({
      ...legacy,
      schemaVersion: 1,
      projectDirectory: '.',
    })
  }
  const versionLabel =
    typeof schemaVersion === 'string' || typeof schemaVersion === 'number'
      ? String(schemaVersion)
      : '未知'
  throw new Error(`项目版本 ${versionLabel} 暂不受支持。`)
}

const validateTemporaryProject = async (tempPath: string): Promise<Project> => {
  const content = await readFile(tempPath, 'utf8')
  return migrateProjectData(JSON.parse(content) as unknown)
}

export const writeProjectAtomically = async (
  projectDirectory: string,
  projectInput: Project,
): Promise<Project> => {
  await ensureProjectDirectories(projectDirectory)
  const project = ProjectSchema.parse(
    normalizeOrders({
      ...projectInput,
      updatedAt: new Date().toISOString(),
      projectDirectory: '.',
    }),
  )
  const projectPath = join(projectDirectory, PROJECT_FILE_NAME)
  const tempPath = join(projectDirectory, PROJECT_TEMP_FILE_NAME)
  const backupPath = join(projectDirectory, PROJECT_BACKUP_FILE_NAME)
  const payload = `${JSON.stringify(project, null, 2)}\n`
  const handle = await open(tempPath, 'w', 0o600)
  try {
    await handle.writeFile(payload, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await validateTemporaryProject(tempPath)

  const hasOriginal = await access(projectPath, fsConstants.F_OK).then(
    () => true,
    () => false,
  )

  if (hasOriginal) {
    await rm(backupPath, { force: true })
    await rename(projectPath, backupPath)
  }
  try {
    await rename(tempPath, projectPath)
  } catch (error) {
    if (hasOriginal) {
      await rename(backupPath, projectPath).catch((restoreError: unknown) => {
        appLog.error('恢复项目备份失败', restoreError)
      })
    }
    throw error
  }
  return project
}

export const loadProject = async (projectPathOrDirectory: string): Promise<ProjectSession> => {
  const targetStat = await stat(projectPathOrDirectory)
  const projectDirectory = targetStat.isDirectory()
    ? projectPathOrDirectory
    : dirname(projectPathOrDirectory)
  const projectPath = join(projectDirectory, PROJECT_FILE_NAME)
  const backupPath = join(projectDirectory, PROJECT_BACKUP_FILE_NAME)
  let raw: string
  try {
    raw = await readFile(projectPath, 'utf8')
  } catch (error) {
    try {
      raw = await readFile(backupPath, 'utf8')
      appLog.warn('主项目文件无法读取，已使用备份恢复', projectPath)
    } catch {
      throw error
    }
  }
  const project = migrateProjectData(JSON.parse(raw) as unknown)
  await ensureProjectDirectories(projectDirectory)
  return {
    project,
    projectDirectory,
    revision: 0,
  }
}

export const createProjectDirectory = async (
  parentDirectory: string,
  project: Project,
): Promise<ProjectSession> => {
  const safeName = sanitizeFileName(project.title, '新建支撑材料项目')
  let projectDirectory = join(parentDirectory, safeName)
  let suffix = 2
  let directoryAvailable = false
  while (!directoryAvailable) {
    try {
      await access(projectDirectory, fsConstants.F_OK)
      projectDirectory = join(parentDirectory, `${safeName} ${suffix}`)
      suffix += 1
    } catch {
      directoryAvailable = true
    }
  }
  await mkdir(projectDirectory, { recursive: false })
  const saved = await writeProjectAtomically(projectDirectory, project)
  return {
    project: saved,
    projectDirectory,
    revision: 0,
  }
}

export const duplicateProject = async (
  session: ProjectSession,
  destinationParent: string,
  newTitle: string,
): Promise<ProjectSession> => {
  const clonedProject: Project = {
    ...structuredClone(session.project),
    id: crypto.randomUUID(),
    title: newTitle,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    coverSettings: {
      ...session.project.coverSettings,
      title: newTitle,
    },
    exportSettings: {
      ...session.project.exportSettings,
      outputFileName: `${sanitizeFileName(newTitle)}.pdf`,
      metadata: {
        ...session.project.exportSettings.metadata,
        title: newTitle,
      },
    },
  }
  const destination = await createProjectDirectory(destinationParent, clonedProject)
  await cp(join(session.projectDirectory, 'assets'), join(destination.projectDirectory, 'assets'), {
    recursive: true,
    force: false,
    errorOnExist: false,
  })
  destination.project = await writeProjectAtomically(destination.projectDirectory, clonedProject)
  return destination
}

export const resolveMaterialSourcePath = (
  projectDirectory: string,
  material: Material,
  sourceId: string,
): string => {
  const source = material.sourceItems.find((candidate) => candidate.id === sourceId)
  if (!source) throw new Error(`材料“${material.title}”缺少来源文件。`)
  const storedOrSource = source.storedPath ?? source.sourcePath
  if (source.storedPath) {
    const resolved = resolve(projectDirectory, storedOrSource)
    const relativePath = relative(projectDirectory, resolved)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`材料“${material.title}”的项目内路径越界。`)
    }
    return resolved
  }
  if (!isAbsolute(source.sourcePath)) {
    throw new Error(`材料“${material.title}”的外部引用路径不是绝对路径。`)
  }
  return source.sourcePath
}

export const clearProjectCache = async (projectDirectory: string): Promise<void> => {
  const cacheDirectory = join(projectDirectory, 'cache')
  await rm(cacheDirectory, { recursive: true, force: true })
  await ensureProjectDirectories(projectDirectory)
}

export const copyAssetIntoProject = async (
  projectDirectory: string,
  sourcePath: string,
  sourceId: string,
): Promise<string> => {
  const extension = extname(sourcePath).toLowerCase()
  const safeBase = sanitizeFileName(basename(sourcePath, extension), 'material')
  const relativePath = join('assets', `${sourceId}-${safeBase}${extension}`)
  const finalPath = join(projectDirectory, relativePath)
  const tempPath = `${finalPath}.tmp`
  const sourceStat = await stat(sourcePath)
  await copyFile(sourcePath, tempPath, fsConstants.COPYFILE_EXCL)
  await utimes(tempPath, sourceStat.atime, sourceStat.mtime)
  await rename(tempPath, finalPath)
  return relativePath
}

export const checkProjectWriteAccess = async (projectDirectory: string): Promise<void> => {
  await access(projectDirectory, fsConstants.R_OK | fsConstants.W_OK)
}
