import { mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyAssetIntoProject,
  createProjectDirectory,
  loadProject,
  writeProjectAtomically,
} from '../../src/main/services/project-service.js'
import { validateProjectFiles } from '../../src/main/services/validation-service.js'
import { ProjectSchema } from '../../src/shared/schemas/project-schema.js'
import {
  createMaterialFixture,
  createOutlineFixture,
  createProjectFixture,
  createSourceFixture,
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
