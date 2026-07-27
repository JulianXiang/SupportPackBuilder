import { dialog, type BrowserWindow } from 'electron'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { IPC_CHANNELS } from '../../shared/constants/ipc.js'
import {
  EmptyInputSchema,
  ProjectCreateInputSchema,
  ProjectDuplicateInputSchema,
  ProjectRelocateMissingInputSchema,
  ProjectSaveAsInputSchema,
  ProjectSaveInputSchema,
  RecentProjectOpenInputSchema,
  RecentProjectRemoveInputSchema,
} from '../../shared/schemas/ipc-schema.js'
import { createDefaultProject } from '../../shared/schemas/project-schema.js'
import { createOutlineFromTemplate } from '../../shared/templates/index.js'
import type { ProjectSessionView } from '../../preload/api-types.js'
import type { AppRuntime } from '../app-runtime.js'
import { showOpenDialog } from '../services/dialog-service.js'
import { showSaveDialog } from '../services/dialog-service.js'
import {
  exportPortableProject,
  importPortableProject,
} from '../services/portable-project-service.js'
import {
  clearProjectCache,
  copyAssetIntoProject,
  createProjectDirectory,
  duplicateProject,
  loadProject,
  writeProjectAtomically,
} from '../services/project-service.js'
import { validateSourceFile } from '../services/validation-service.js'
import { registerValidatedHandler } from './ipc-helpers.js'

const toView = (session: {
  project: ProjectSessionView['project']
  projectDirectory: string
  revision: number
}): ProjectSessionView => ({
  project: session.project,
  projectDirectory: session.projectDirectory,
  revision: session.revision,
})

export const registerProjectIpc = (input: {
  mainWindow: BrowserWindow
  runtime: AppRuntime
}): void => {
  const { mainWindow, runtime } = input
  registerValidatedHandler({
    channel: IPC_CHANNELS.projectCreate,
    schema: ProjectCreateInputSchema,
    stage: '新建项目',
    mainWindow,
    handler: async (value) => {
      const selection = await showOpenDialog(mainWindow, 'projectParent', {
        title: '选择项目保存位置',
        buttonLabel: '在此创建项目',
        properties: ['openDirectory', 'createDirectory'],
      })
      const parentDirectory = selection.filePaths[0]
      if (selection.canceled || !parentDirectory) return null
      const project = createDefaultProject({
        title: value.title,
        ownerName: value.ownerName,
        organization: value.organization,
        purpose: value.purpose,
        compiledDate: value.compiledDate,
        outlineNodes: createOutlineFromTemplate(value.templateId),
      })
      const session = await createProjectDirectory(parentDirectory, project)
      await runtime.setSession(session)
      return toView(session)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectOpen,
    schema: EmptyInputSchema,
    stage: '打开项目',
    mainWindow,
    handler: async () => {
      const selection = await showOpenDialog(mainWindow, 'projectOpen', {
        title: '打开支撑材料项目',
        buttonLabel: '打开',
        properties: ['openFile'],
        filters: [{ name: '支撑材料项目', extensions: ['json'] }],
      })
      const projectPath = selection.filePaths[0]
      if (selection.canceled || !projectPath) return null
      const session = await loadProject(projectPath)
      await runtime.setSession(session)
      return toView(session)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectOpenRecent,
    schema: RecentProjectOpenInputSchema,
    stage: '打开最近项目',
    mainWindow,
    handler: async ({ projectDirectory }) => {
      const allowed = runtime.recentProjects
        .list()
        .some((item) => item.projectDirectory === projectDirectory)
      if (!allowed) throw new Error('该项目不在最近项目列表中。')
      const session = await loadProject(projectDirectory)
      await runtime.setSession(session)
      return toView(session)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectSave,
    schema: ProjectSaveInputSchema,
    stage: '保存项目',
    mainWindow,
    handler: async ({ project, expectedRevision }) =>
      toView(await runtime.save(project, expectedRevision)),
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectSaveAs,
    schema: ProjectSaveAsInputSchema,
    stage: '项目另存为',
    mainWindow,
    handler: async ({ project, expectedRevision }) => {
      const session = runtime.acceptRendererProject(project, expectedRevision)
      const selection = await showOpenDialog(mainWindow, 'saveAsParent', {
        title: '选择另存为位置',
        buttonLabel: '保存到此处',
        properties: ['openDirectory', 'createDirectory'],
      })
      const parentDirectory = selection.filePaths[0]
      if (selection.canceled || !parentDirectory) return null
      const duplicated = await duplicateProject(session, parentDirectory, project.title)
      await runtime.setSession(duplicated)
      return toView(duplicated)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectDuplicate,
    schema: ProjectDuplicateInputSchema,
    stage: '复制项目',
    mainWindow,
    handler: async ({ newTitle }) => {
      const selection = await showOpenDialog(mainWindow, 'duplicateParent', {
        title: '选择复制项目的位置',
        buttonLabel: '复制到此处',
        properties: ['openDirectory', 'createDirectory'],
      })
      const destinationParent = selection.filePaths[0]
      if (selection.canceled || !destinationParent) return null
      const duplicated = await duplicateProject(
        runtime.requireSession(),
        destinationParent,
        newTitle,
      )
      await runtime.setSession(duplicated)
      return toView(duplicated)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectExportPortable,
    schema: ProjectSaveInputSchema,
    stage: '导出便携项目包',
    mainWindow,
    handler: async ({ project, expectedRevision }) => {
      const session = await runtime.save(project, expectedRevision)
      const selection = await showSaveDialog(
        mainWindow,
        {
          title: '导出便携项目包',
          buttonLabel: '导出',
          defaultPath: `${project.title}.spack`,
          filters: [{ name: 'SupportPack 便携项目', extensions: ['spack'] }],
        },
        'portableExportPath',
      )
      const outputPath = selection.filePath
      if (selection.canceled || !outputPath) return null
      const exists = await access(outputPath, fsConstants.F_OK).then(
        () => true,
        () => false,
      )
      if (exists) {
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '确认覆盖便携项目包',
          message: '目标文件已存在，是否覆盖？',
          detail: '覆盖会替换现有 .spack 文件。',
          buttons: ['取消', '覆盖'],
          defaultId: 0,
          cancelId: 0,
        })
        if (confirmation.response !== 1) return null
      }
      const result = await exportPortableProject(session, outputPath)
      runtime.allowedSystemPaths.add(result.outputPath)
      return result
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectImportPortable,
    schema: EmptyInputSchema,
    stage: '导入便携项目包',
    mainWindow,
    handler: async () => {
      const archiveSelection = await showOpenDialog(mainWindow, 'portableImport', {
        title: '选择便携项目包',
        buttonLabel: '选择',
        properties: ['openFile'],
        filters: [{ name: 'SupportPack 便携项目', extensions: ['spack'] }],
      })
      const archivePath = archiveSelection.filePaths[0]
      if (archiveSelection.canceled || !archivePath) return null
      const parentSelection = await showOpenDialog(mainWindow, 'portableImportParent', {
        title: '选择项目导入位置',
        buttonLabel: '导入到此处',
        properties: ['openDirectory', 'createDirectory'],
      })
      const destinationParent = parentSelection.filePaths[0]
      if (parentSelection.canceled || !destinationParent) return null
      const session = await importPortableProject(archivePath, destinationParent)
      await runtime.setSession(session)
      return toView(session)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectRelocateMissing,
    schema: ProjectRelocateMissingInputSchema,
    stage: '重新定位材料文件',
    mainWindow,
    handler: async ({ materialId, sourceId }) => {
      const session = runtime.requireSession()
      const project = structuredClone(session.project)
      const material = project.outlineNodes
        .flatMap((node) => node.children)
        .flatMap((node) => node.materials)
        .find((candidate) => candidate.id === materialId)
      const source = material?.sourceItems.find((candidate) => candidate.id === sourceId)
      if (!material || !source) throw new Error('找不到需要重新定位的材料来源。')
      const selection = await showOpenDialog(mainWindow, 'relocateFile', {
        title: `重新定位《${source.originalFileName}》`,
        buttonLabel: '使用此文件',
        properties: ['openFile'],
        filters: [{ name: '支持的材料文件', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'] }],
      })
      const selectedPath = selection.filePaths[0]
      if (selection.canceled || !selectedPath) return null
      const validated = await validateSourceFile(selectedPath)
      const expectedType = material.sourceType === 'pdf' ? 'pdf' : 'image'
      if (validated.sourceType !== expectedType) {
        throw new Error(
          `所选文件类型与原材料不一致。需要 ${expectedType === 'pdf' ? 'PDF' : '图片'}文件。`,
        )
      }
      if (validated.source.fileHash !== source.fileHash) {
        throw new Error(
          `所选文件《${validated.source.originalFileName}》与原文件哈希不一致。重新定位只接受同一文件；如需替换材料，请重新导入。`,
        )
      }
      const storedPath =
        project.assetStorageMode === 'copy'
          ? await copyAssetIntoProject(session.projectDirectory, selectedPath, source.id)
          : null
      Object.assign(source, validated.source, {
        id: source.id,
        sourcePath: storedPath ?? selectedPath,
        storedPath,
      })
      const primary = material.sourceItems[0]
      if (primary) {
        material.sourcePath = primary.sourcePath
        material.storedPath = primary.storedPath
        material.originalFileName = primary.originalFileName
        material.fileHash = primary.fileHash
      }
      material.fileSize = material.sourceItems.reduce((total, item) => total + item.fileSize, 0)
      material.modifiedTime = Math.max(...material.sourceItems.map((item) => item.modifiedTime))
      material.pageCount = material.sourceItems.reduce((total, item) => total + item.pageCount, 0)
      material.validationStatus = validated.validationStatus
      material.validationMessages = validated.validationMessages
      material.updatedAt = new Date().toISOString()
      const updated = {
        project: await writeProjectAtomically(session.projectDirectory, project),
        projectDirectory: session.projectDirectory,
        revision: session.revision + 1,
      }
      await runtime.setSession(updated)
      return toView(updated)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectRecentList,
    schema: EmptyInputSchema,
    stage: '读取最近项目',
    mainWindow,
    handler: () => runtime.recentProjects.list(),
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectRecentRemove,
    schema: RecentProjectRemoveInputSchema,
    stage: '移除最近项目',
    mainWindow,
    handler: ({ projectDirectory }) => {
      runtime.recentProjects.remove(projectDirectory)
    },
  })

  registerValidatedHandler({
    channel: IPC_CHANNELS.projectClearCache,
    schema: EmptyInputSchema,
    stage: '清理缓存',
    mainWindow,
    handler: async () => {
      const session = runtime.requireSession()
      await clearProjectCache(session.projectDirectory)
      await runtime.thumbnailService?.initialize()
    },
  })
}
