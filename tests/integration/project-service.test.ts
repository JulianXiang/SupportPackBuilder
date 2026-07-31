import { mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyAssetIntoProject,
  createProjectDirectory,
  loadProject,
  migrateProjectData,
  writeProjectAtomically,
} from '../../src/main/services/project-service.js'
import { validateProjectFiles } from '../../src/main/services/validation-service.js'
import { ProjectSchema } from '../../src/shared/schemas/project-schema.js'
import { createLayoutSection, createLayoutSheet } from '../../src/shared/utils/layout-tree.js'
import {
  createMaterialFixture,
  createOutlineFixture,
  createProjectFixture,
  createSourceFixture,
  IDS,
} from '../helpers/project-fixture.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('项目安全持久化', () => {
  it('新建项目目录、保存并重新打开', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'spack-project-'))
    temporaryDirectories.push(parent)
    const project = createProjectFixture()

    const created = await createProjectDirectory(parent, project)
    const loaded = await loadProject(created.projectDirectory)

    expect(loaded.project.title).toBe(project.title)
    expect(loaded.project.projectDirectory).toBe('.')
    await expect(stat(join(created.projectDirectory, 'assets'))).resolves.toBeDefined()
    await expect(stat(join(created.projectDirectory, 'cache', 'thumbnails'))).resolves.toBeDefined()
  })

  it('原子写入后保留上一代备份且主文件可通过 Zod 校验', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spack-atomic-'))
    temporaryDirectories.push(directory)
    const first = await writeProjectAtomically(directory, createProjectFixture())
    const second = await writeProjectAtomically(directory, {
      ...first,
      title: '修改后的项目',
    })

    const mainRaw = await readFile(join(directory, 'project.json'), 'utf8')
    const backupRaw = await readFile(join(directory, 'project.json.bak'), 'utf8')
    expect(ProjectSchema.parse(JSON.parse(mainRaw) as unknown).title).toBe('修改后的项目')
    expect(ProjectSchema.parse(JSON.parse(backupRaw) as unknown).title).toBe(first.title)
    expect(second.title).toBe('修改后的项目')
  })

  it('把 v1 手工序号迁移为 v3 纯标题与默认无拼版配置，并保留原始备份', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spack-migrate-v1-'))
    temporaryDirectories.push(directory)
    const legacy = structuredClone(createProjectFixture()) as unknown as Record<string, unknown>
    legacy.schemaVersion = 1
    const roots = legacy.outlineNodes as Record<string, unknown>[]
    const firstRoot = roots[0]
    if (!firstRoot) throw new Error('测试目录结构无效。')
    firstRoot.title = '一、论文成果'
    const children = firstRoot.children as Record<string, unknown>[]
    const firstChild = children[0]
    if (!firstChild) throw new Error('测试二级目录结构无效。')
    firstChild.title = '（一） 第一作者论文'
    const materials = firstChild.materials as Record<string, unknown>[]
    const firstMaterial = materials[0]
    if (!firstMaterial) throw new Error('测试材料结构无效。')
    firstMaterial.title = '1. 测试材料'
    await writeFile(join(directory, 'project.json'), `${JSON.stringify(legacy, null, 2)}\n`)

    const loaded = await loadProject(directory)
    expect(loaded.project.schemaVersion).toBe(3)
    expect(loaded.project.outlineNodes[0]?.title).toBe('论文成果')
    expect(loaded.project.outlineNodes[0]?.children[0]?.title).toBe('第一作者论文')
    expect(loaded.project.outlineNodes[0]?.children[0]?.materials[0]?.title).toBe('测试材料')

    await writeProjectAtomically(directory, loaded.project)
    const backup = JSON.parse(
      await readFile(join(directory, 'project.json.bak'), 'utf8'),
    ) as Record<string, unknown>
    expect(backup.schemaVersion).toBe(1)
    expect(migrateProjectData(backup).schemaVersion).toBe(3)
  })

  it('把 v2 材料迁移为带逐来源选页和起页策略的 v3 数据', () => {
    const legacy = structuredClone(createProjectFixture()) as unknown as Record<string, unknown>
    legacy.schemaVersion = 2
    delete legacy.collageSettings
    delete legacy.layoutSheets
    const roots = legacy.outlineNodes as Record<string, unknown>[]
    const child = (roots[0]?.children as Record<string, unknown>[] | undefined)?.[0]
    const material = (child?.materials as Record<string, unknown>[] | undefined)?.[0]
    if (!material) throw new Error('测试材料结构无效。')
    delete material.startPolicy
    material.startOnNewPage = false
    const source = (material.sourceItems as Record<string, unknown>[] | undefined)?.[0]
    if (!source) throw new Error('测试来源结构无效。')
    delete source.sourceType
    delete source.selectedPageRanges

    const migrated = migrateProjectData(legacy)
    const migratedMaterial = migrated.outlineNodes[0]?.children[0]?.materials[0]
    if (!migratedMaterial) throw new Error('迁移后缺少测试材料。')
    expect(migrated.schemaVersion).toBe(3)
    expect(migratedMaterial.startPolicy).toBe('allowSharedSheet')
    expect(migratedMaterial.sourceItems[0]).toMatchObject({
      sourceType: 'pdf',
      selectedPageRanges: migratedMaterial.selectedPageRanges,
    })
    expect(migrated.collageSettings.enabled).toBe(true)
    expect(migrated.layoutSheets).toEqual([])
  })

  it('拼版布局经原子保存后可以完整重新打开', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'spack-project-layout-'))
    temporaryDirectories.push(parent)
    const project = createProjectFixture()
    const section = createLayoutSection(
      IDS.material,
      [`${IDS.source}:0`, `${IDS.source}:1`],
      'two-up',
    )
    project.layoutSheets = [
      createLayoutSheet({
        anchorSourcePageId: `${IDS.source}:0`,
        sections: [section],
        order: 0,
        orientation: 'landscape',
        templateId: 'two-up',
        project,
      }),
    ]

    const created = await createProjectDirectory(parent, project)
    const reopened = await loadProject(created.projectDirectory)
    expect(reopened.project.layoutSheets).toEqual(project.layoutSheets)
    expect(ProjectSchema.parse(reopened.project).layoutSheets[0]?.orientation).toBe('landscape')
  })

  it('复制资产时保留来源时间戳，避免导入后立即误报文件变化', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spack-copy-asset-'))
    temporaryDirectories.push(directory)
    const projectDirectory = join(directory, 'project')
    const sourcePath = join(directory, 'source.pdf')
    await writeFile(sourcePath, Buffer.from('%PDF-1.4\n% local fixture\n', 'utf8'))
    const sourceTime = new Date('2026-01-02T03:04:05.000Z')
    await utimes(sourcePath, sourceTime, sourceTime)
    await writeProjectAtomically(projectDirectory, createProjectFixture())

    const relativePath = await copyAssetIntoProject(
      projectDirectory,
      sourcePath,
      '00000000-0000-4000-8000-000000000099',
    )
    const [sourceStat, copiedStat] = await Promise.all([
      stat(sourcePath),
      stat(join(projectDirectory, relativePath)),
    ])

    expect(Math.round(copiedStat.mtimeMs)).toBe(Math.round(sourceStat.mtimeMs))
    await expect(readFile(join(projectDirectory, relativePath))).resolves.toEqual(
      await readFile(sourcePath),
    )

    const copiedSource = createSourceFixture({
      sourcePath: relativePath,
      storedPath: relativePath,
      fileSize: copiedStat.size,
      modifiedTime: Math.round(sourceStat.mtimeMs),
    })
    const material = createMaterialFixture({
      sourcePath: relativePath,
      storedPath: relativePath,
      fileSize: copiedStat.size,
      modifiedTime: copiedSource.modifiedTime,
      sourceItems: [copiedSource],
    })
    const checks = await validateProjectFiles(
      projectDirectory,
      createProjectFixture({ outlineNodes: createOutlineFixture(material) }),
    )
    expect(checks).toHaveLength(1)
    expect(checks[0]?.status).toBe('valid')
    expect(checks[0]?.messages).toEqual([])
  })
})
