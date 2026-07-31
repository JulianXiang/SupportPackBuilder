import { spawn } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { env } from 'node:process'

const VERSION = '26.2.5'

const run = async (executable, arguments_) =>
  await new Promise((resolveCommand, reject) => {
    const child = spawn(executable, arguments_, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolveCommand(output.trim())
      else reject(new Error(`${basename(executable)} 校验失败（退出码 ${String(code)}）。`))
    })
  })

const containsLicenseFiles = async (directory) => {
  const pending = [directory]
  let visited = 0
  let hasLicense = false
  let hasNotice = false
  while (pending.length > 0 && visited < 50_000) {
    const current = pending.pop()
    if (!current) break
    for (const entry of await readdir(current, { withFileTypes: true })) {
      visited += 1
      if (entry.isDirectory()) pending.push(join(current, entry.name))
      else if (entry.isFile()) {
        const lower = entry.name.toLowerCase()
        if (lower === 'license' || lower.startsWith('license.')) hasLicense = true
        if (lower === 'notice' || lower.startsWith('notice.')) hasNotice = true
      }
    }
    if (hasLicense && hasNotice) return true
  }
  return false
}

const containsBrokenSymbolicLink = async (directory) => {
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isSymbolicLink()) {
        try {
          await access(path)
        } catch {
          return true
        }
      }
    }
  }
  return false
}

export default async function beforePack(context) {
  const runtimeRoot = resolve('vendor', 'libreoffice-runtime')
  const manifestPath = join(runtimeRoot, 'runtime-manifest.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `打包已中止：缺少经过校验的 LibreOffice ${VERSION} 运行时。请先运行 npm run prepare:libreoffice。`,
      { cause: error },
    )
  }
  const expectedPlatform = context.electronPlatformName
  const expectedArch =
    context.arch === 3 || context.arch === 'arm64'
      ? 'arm64'
      : context.arch === 1 || context.arch === 'x64'
        ? 'x64'
        : String(context.arch)
  if (
    manifest.version !== VERSION ||
    manifest.platform !== expectedPlatform ||
    manifest.arch !== expectedArch
  ) {
    throw new Error(
      `打包已中止：LibreOffice 运行时为 ${manifest.platform}-${manifest.arch} ${manifest.version}，目标为 ${expectedPlatform}-${expectedArch} ${VERSION}。`,
    )
  }
  const executable =
    expectedPlatform === 'darwin'
      ? join(runtimeRoot, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
      : join(runtimeRoot, 'program', 'soffice.exe')
  await access(executable)
  const versionOutput = await run(executable, ['--version'])
  if (!versionOutput.includes(VERSION)) {
    throw new Error(`打包已中止：LibreOffice 可执行文件版本不符：${versionOutput}`)
  }
  if (expectedPlatform === 'darwin') {
    const architecture = await run('/usr/bin/file', [executable])
    if (!architecture.includes(expectedArch)) {
      throw new Error(`打包已中止：LibreOffice 可执行文件架构不符：${architecture}`)
    }
  }
  if (!(await containsLicenseFiles(runtimeRoot))) {
    throw new Error('打包已中止：LibreOffice 运行时缺少完整 LICENSE 或 NOTICE 文件。')
  }
  if (await containsBrokenSymbolicLink(runtimeRoot)) {
    throw new Error('打包已中止：LibreOffice 运行时存在断开的符号链接。')
  }
}
