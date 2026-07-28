import { access } from 'node:fs/promises'
import { join } from 'node:path'

const executableCandidates = (input: {
  appPath: string
  resourcesPath: string
  packaged: boolean
}): string[] => {
  const names =
    process.platform === 'darwin'
      ? ['LibreOffice.app/Contents/MacOS/soffice']
      : process.platform === 'win32'
        ? ['program/soffice.exe', 'LibreOffice/program/soffice.exe']
        : ['program/soffice', 'LibreOffice/program/soffice']
  const roots = input.packaged
    ? [join(input.resourcesPath, 'libreoffice')]
    : [
        join(input.appPath, 'vendor', 'libreoffice-runtime'),
        join(input.resourcesPath, 'libreoffice'),
      ]
  return roots.flatMap((root) => names.map((name) => join(root, name)))
}

export const resolveLibreOfficeExecutable = async (input: {
  appPath: string
  resourcesPath: string
  packaged: boolean
}): Promise<string | null> => {
  const explicit = input.packaged ? undefined : process.env.SPACK_LIBREOFFICE_PATH
  const candidates = [...(explicit ? [explicit] : []), ...executableCandidates(input)]
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return null
}
