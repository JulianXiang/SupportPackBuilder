export const LIBREOFFICE_VERSION = '26.2.5'

export type LibreOfficeRuntimeTarget = 'darwin-arm64' | 'win32-x64'

export type LibreOfficeRuntimeDefinition = {
  target: LibreOfficeRuntimeTarget
  platform: 'darwin' | 'win32'
  arch: 'arm64' | 'x64'
  archiveName: string
  url: string
  sha256: string
}

export const LIBREOFFICE_RUNTIME_DEFINITIONS: Record<
  LibreOfficeRuntimeTarget,
  LibreOfficeRuntimeDefinition
> = {
  'darwin-arm64': {
    target: 'darwin-arm64',
    platform: 'darwin',
    arch: 'arm64',
    archiveName: `LibreOffice_${LIBREOFFICE_VERSION}_MacOS_aarch64.dmg`,
    url: `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/mac/aarch64/LibreOffice_${LIBREOFFICE_VERSION}_MacOS_aarch64.dmg`,
    sha256: 'c99fb4fe574437fc4cb820a4ca15271bca325920861f7139858b36d7f9df78ad',
  },
  'win32-x64': {
    target: 'win32-x64',
    platform: 'win32',
    arch: 'x64',
    archiveName: `LibreOffice_${LIBREOFFICE_VERSION}_Win_x86-64.msi`,
    url: `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/win/x86_64/LibreOffice_${LIBREOFFICE_VERSION}_Win_x86-64.msi`,
    sha256: 'f15ba07bfcb0186986cf3171063506f5d207c11f8cc051ba0d135209e9e915f9',
  },
}
