import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPromise } from 'yauzl'
import { ZipFile } from 'yazl'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  exportPortableProject,
  importPortableProject,
} from '../../src/main/services/portable-project-service.js'
import {
  createProjectDirectory,
  writeProjectAtomically,
} from '../../src/main/services/project-service.js'
import { createProjectFixture } from '../helpers/project-fixture.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('便携项目包', () => {
  it('将外部引用转换为项目内资产，并可安全导入为独立项目', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'spack-portable-'))
    temporaryDirectories.push(parent)
    const externalPath = join(parent, 'external-source.pdf')
    const sourceBytes = Buffer.from('%PDF-1.4\n% portable fixture\n', 'utf8')
    await writeFile(externalPath, sourceBytes)
    const project = createProjectFixture({ assetStorageMode: 'reference' })
    const material = project.outlineNodes[0]?.children[0]?.materials[0]
    const source = material?.sourceItems[0]
    if (!material || !source) throw new Error('测试材料结构无效。')
    source.sourcePath = externalPath
    source.storedPath = null
    source.fileSize = sourceBytes.length
    material.sourcePath = externalPath
    material.storedPath = null
    material.fileSize = sourceBytes.length

    const session = await createProjectDirectory(parent, project)
    session.project = await writeProjectAtomically(session.projectDirectory, project)
    const archivePath = join(parent, 'portable.spack')
    const exported = await exportPortableProject(session, archivePath)
    const imported = await importPortableProject(archivePath, parent)

    expect(exported.assetCount).toBe(1)
    expect(imported.project.assetStorageMode).toBe('copy')
    const importedMaterial = imported.project.outlineNodes[0]?.children[0]?.materials[0]
    const importedSource = importedMaterial?.sourceItems[0]
    expect(importedSource?.storedPath).toMatch(/^assets\//)
    if (!importedSource?.storedPath) throw new Error('便携项目缺少资产路径。')
    await expect(
      readFile(join(imported.projectDirectory, importedSource.storedPath)),
    ).resolves.toEqual(sourceBytes)

    const zip = await openPromise(archivePath, { lazyEntries: true })
    const names: string[] = []
    for await (const entry of zip.eachEntry()) names.push(entry.fileName)
    zip.close()
    expect(names).toContain('project.json')
    expect(names).toContain('version.json')
    expect(names.some((name) => name.startsWith('assets/'))).toBe(true)
    expect(names.some((name) => name.startsWith('cache/'))).toBe(false)
    expect(names.some((name) => name.startsWith('temp/'))).toBe(false)
  })

  it('拒绝包含非白名单目录的压缩包并清理临时目录', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'spack-portable-invalid-'))
    temporaryDirectories.push(parent)
    const archivePath = join(parent, 'invalid.spack')
    const zip = new ZipFile()
    zip.addBuffer(Buffer.from('{}'), 'project.json')
    zip.addBuffer(Buffer.from('{}'), 'version.json')
    zip.addBuffer(Buffer.from('sensitive'), 'cache/forbidden.txt')
    const completed = pipeline(zip.outputStream, createWriteStream(archivePath))
    zip.end()
    await completed

    await expect(importPortableProject(archivePath, parent)).rejects.toThrow('不允许的条目')
    const { readdir } = await import('node:fs/promises')
    expect((await readdir(parent)).some((name) => name.startsWith('.spack-import-'))).toBe(false)
  })
})
