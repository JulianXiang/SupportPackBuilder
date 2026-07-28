import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveLibreOfficeExecutable } from '../../src/main/services/libreoffice-runtime.js'

const previousOverride = process.env.SPACK_LIBREOFFICE_PATH
const temporaryDirectories: string[] = []

afterEach(async () => {
  if (previousOverride === undefined) delete process.env.SPACK_LIBREOFFICE_PATH
  else process.env.SPACK_LIBREOFFICE_PATH = previousOverride
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }),
  )
})

describe('LibreOffice 运行时解析', () => {
  it('开发环境可使用测试覆盖路径，打包环境忽略外部覆盖路径', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supportpack-lo-runtime-'))
    temporaryDirectories.push(root)
    const override = join(root, 'custom-soffice')
    await writeFile(override, '')
    process.env.SPACK_LIBREOFFICE_PATH = override

    await expect(
      resolveLibreOfficeExecutable({
        appPath: join(root, 'app'),
        resourcesPath: join(root, 'resources'),
        packaged: false,
      }),
    ).resolves.toBe(override)

    await mkdir(join(root, 'packaged-resources'), { recursive: true })
    await expect(
      resolveLibreOfficeExecutable({
        appPath: join(root, 'app'),
        resourcesPath: join(root, 'packaged-resources'),
        packaged: true,
      }),
    ).resolves.toBeNull()
  })
})
