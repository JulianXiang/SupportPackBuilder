import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const executeFile = promisify(execFile)
const outputDirectory = resolve('resources/icons')
const iconsetDirectory = join(outputDirectory, 'generated', 'app.iconset')

const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" rx="196" fill="#173f63"/>
  <rect x="232" y="250" width="476" height="570" rx="52" fill="#dce8f1" opacity="0.42"/>
  <rect x="286" y="196" width="476" height="570" rx="52" fill="#ffffff"/>
  <path d="M598 196v154h164" fill="#d9e7f2"/>
  <path d="M598 196l164 154H630c-18 0-32-14-32-32V196z" fill="#c5d8e8"/>
  <rect x="370" y="410" width="308" height="26" rx="13" fill="#7f9bb1"/>
  <rect x="370" y="474" width="244" height="26" rx="13" fill="#7f9bb1"/>
  <rect x="370" y="538" width="280" height="26" rx="13" fill="#7f9bb1"/>
  <text x="512" y="694" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="126" font-weight="700" letter-spacing="4" fill="#173f63">SP</text>
</svg>
`

const renderPng = async (size: number, outputPath: string): Promise<void> => {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outputPath)
}

const generate = async (): Promise<void> => {
  await rm(join(outputDirectory, 'generated'), { recursive: true, force: true })
  await mkdir(iconsetDirectory, { recursive: true })
  await renderPng(1024, join(outputDirectory, 'app.png'))
  const iconsetEntries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ] as const
  await Promise.all(
    iconsetEntries.map(async ([fileName, size]) => {
      await renderPng(size, join(iconsetDirectory, fileName))
    }),
  )
  await executeFile('iconutil', [
    '-c',
    'icns',
    iconsetDirectory,
    '-o',
    join(outputDirectory, 'app.icns'),
  ])
  const windowsPng = join(outputDirectory, 'generated', 'app-windows.png')
  await renderPng(256, windowsPng)
  await executeFile('sips', [
    '-s',
    'format',
    'ico',
    windowsPng,
    '--out',
    join(outputDirectory, 'app.ico'),
  ])
  console.log('已生成 resources/icons/app.png、app.icns 和 app.ico。')
}

await generate()
