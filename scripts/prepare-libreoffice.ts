import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  lstat,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  LIBREOFFICE_RUNTIME_DEFINITIONS,
  LIBREOFFICE_VERSION,
  type LibreOfficeRuntimeDefinition,
  type LibreOfficeRuntimeTarget,
} from './libreoffice-runtime-config.js'

const workspaceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeDirectory = join(workspaceDirectory, 'vendor', 'libreoffice-runtime')
const manifestPath = join(runtimeDirectory, 'runtime-manifest.json')

type RuntimeManifest = {
  product: string
  version: string
  target: LibreOfficeRuntimeTarget
  platform: string
  arch: string
  archiveName: string
  archiveSha256: string
  sourceUrl: string
  preparedAt: string
}

const command = async (executable: string, arguments_: string[]): Promise<string> =>
  await new Promise<string>((resolveCommand, reject) => {
    const child = spawn(executable, arguments_, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolveCommand(stdout.trim() || stderr.trim())
      else
        reject(new Error(`${basename(executable)} 执行失败（退出码 ${String(code)}）：${stderr}`))
    })
  })

const calculateSha256 = async (filePath: string): Promise<string> =>
  await new Promise<string>((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk)
    })
    stream.once('error', reject)
    stream.once('end', () => resolveHash(hash.digest('hex')))
  })

const executablePath = (definition: LibreOfficeRuntimeDefinition): string =>
  definition.platform === 'darwin'
    ? join(runtimeDirectory, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
    : join(runtimeDirectory, 'program', 'soffice.exe')

const hasBrokenSymbolicLink = async (directory: string): Promise<boolean> => {
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) {
        try {
          await access(path)
          await lstat(path)
        } catch {
          return true
        }
      } else if (entry.isDirectory()) {
        pending.push(path)
      }
    }
  }
  return false
}

const currentRuntimeIsValid = async (
  definition: LibreOfficeRuntimeDefinition,
): Promise<boolean> => {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RuntimeManifest
    if (
      manifest.product !== 'LibreOffice' ||
      manifest.version !== LIBREOFFICE_VERSION ||
      manifest.target !== definition.target ||
      manifest.archiveSha256 !== definition.sha256 ||
      manifest.sourceUrl !== definition.url
    ) {
      return false
    }
    await access(executablePath(definition))
    if (await hasBrokenSymbolicLink(runtimeDirectory)) return false
    const versionOutput = await command(executablePath(definition), ['--version'])
    return versionOutput.includes(LIBREOFFICE_VERSION)
  } catch {
    return false
  }
}

const downloadArchive = async (
  definition: LibreOfficeRuntimeDefinition,
  destination: string,
): Promise<void> => {
  process.stdout.write(`正在下载 LibreOffice ${LIBREOFFICE_VERSION}：${definition.url}\n`)
  const response = await fetch(definition.url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`LibreOffice 下载失败：HTTP ${response.status} ${response.statusText}`)
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  let received = 0
  const source = Readable.from(response.body as unknown as AsyncIterable<Uint8Array>)
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (contentLength > 0 && received % (16 * 1024 * 1024) < chunk.length) {
      process.stdout.write(`下载进度：${Math.round((received / contentLength) * 100)}%\n`)
    }
  })
  await pipeline(source, createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
  const actualHash = await calculateSha256(destination)
  if (actualHash !== definition.sha256) {
    throw new Error(
      `LibreOffice 安装包 SHA-256 不匹配。期望 ${definition.sha256}，实际 ${actualHash}。`,
    )
  }
}

const installMacRuntime = async (
  definition: LibreOfficeRuntimeDefinition,
  archivePath: string,
  temporaryDirectory: string,
): Promise<void> => {
  const mountDirectory = join(temporaryDirectory, 'mount')
  await mkdir(mountDirectory)
  let mounted = false
  try {
    await command('/usr/bin/hdiutil', [
      'attach',
      archivePath,
      '-nobrowse',
      '-readonly',
      '-mountpoint',
      mountDirectory,
    ])
    mounted = true
    const sourceApp = join(mountDirectory, 'LibreOffice.app')
    const sourceStat = await stat(sourceApp)
    if (!sourceStat.isDirectory()) throw new Error('LibreOffice DMG 中未找到 LibreOffice.app。')
    await rm(runtimeDirectory, { recursive: true, force: true })
    await mkdir(runtimeDirectory, { recursive: true })
    await cp(sourceApp, join(runtimeDirectory, 'LibreOffice.app'), {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
  } finally {
    if (mounted) {
      await command('/usr/bin/hdiutil', ['detach', mountDirectory, '-force']).catch(
        (error: unknown) => {
          process.stderr.write(`警告：卸载 LibreOffice 安装镜像失败：${String(error)}\n`)
        },
      )
    }
  }
  await access(executablePath(definition))
  if (await hasBrokenSymbolicLink(runtimeDirectory)) {
    throw new Error('LibreOffice 运行时复制后存在断开的符号链接。')
  }
}

const findWindowsRuntimeRoot = async (directory: string): Promise<string | null> => {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === 'program') {
        try {
          await access(join(path, 'soffice.exe'))
          return dirname(path)
        } catch {
          // 继续递归查找。
        }
      }
      const nested = await findWindowsRuntimeRoot(path)
      if (nested) return nested
    }
  }
  return null
}

const installWindowsRuntime = async (
  definition: LibreOfficeRuntimeDefinition,
  archivePath: string,
  temporaryDirectory: string,
): Promise<void> => {
  const extractionDirectory = join(temporaryDirectory, 'msi-extracted')
  await mkdir(extractionDirectory)
  await command('msiexec.exe', ['/a', archivePath, '/qn', `TARGETDIR=${extractionDirectory}`])
  const sourceRoot = await findWindowsRuntimeRoot(extractionDirectory)
  if (!sourceRoot) throw new Error('LibreOffice MSI 中未找到 program/soffice.exe。')
  await rm(runtimeDirectory, { recursive: true, force: true })
  await mkdir(dirname(runtimeDirectory), { recursive: true })
  await cp(sourceRoot, runtimeDirectory, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  })
  await access(executablePath(definition))
}

const selectedTarget = (): LibreOfficeRuntimeTarget => {
  const argument = process.argv.find((value) => value.startsWith('--target='))
  const explicit = argument?.slice('--target='.length)
  const fallback = `${process.platform}-${process.arch}`
  const target = explicit ?? fallback
  if (target !== 'darwin-arm64' && target !== 'win32-x64') {
    throw new Error(
      `当前仅提供 macOS arm64 和 Windows x64 LibreOffice 运行时，收到目标：${target}。`,
    )
  }
  return target
}

const prepare = async (): Promise<void> => {
  const definition = LIBREOFFICE_RUNTIME_DEFINITIONS[selectedTarget()]
  if (process.platform !== definition.platform || process.arch !== definition.arch) {
    throw new Error(
      `LibreOffice ${definition.target} 运行时必须在对应平台上提取；当前为 ${process.platform}-${process.arch}。`,
    )
  }
  if (await currentRuntimeIsValid(definition)) {
    process.stdout.write(
      `LibreOffice ${LIBREOFFICE_VERSION} ${definition.target} 运行时已通过校验。\n`,
    )
    return
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'supportpack-libreoffice-'))
  try {
    const archivePath = join(temporaryDirectory, definition.archiveName)
    await downloadArchive(definition, archivePath)
    if (definition.platform === 'darwin') {
      await installMacRuntime(definition, archivePath, temporaryDirectory)
    } else {
      await installWindowsRuntime(definition, archivePath, temporaryDirectory)
    }
    const versionOutput = await command(executablePath(definition), ['--version'])
    if (!versionOutput.includes(LIBREOFFICE_VERSION)) {
      throw new Error(`LibreOffice 运行时版本校验失败：${versionOutput}`)
    }
    const manifest: RuntimeManifest = {
      product: 'LibreOffice',
      version: LIBREOFFICE_VERSION,
      target: definition.target,
      platform: definition.platform,
      arch: definition.arch,
      archiveName: definition.archiveName,
      archiveSha256: definition.sha256,
      sourceUrl: definition.url,
      preparedAt: new Date().toISOString(),
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    process.stdout.write(`LibreOffice 离线运行时已准备：${runtimeDirectory}\n`)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

await prepare()
