import { join } from 'node:path'
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses'

export default async function afterPack(context) {
  const productFileName = context.packager.appInfo.productFilename
  const executablePath =
    context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, `${productFileName}.app`, 'Contents', 'MacOS', productFileName)
      : join(
          context.appOutDir,
          context.electronPlatformName === 'win32' ? `${productFileName}.exe` : productFileName,
        )

  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
      context.electronPlatformName === 'darwin',
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  })
}
