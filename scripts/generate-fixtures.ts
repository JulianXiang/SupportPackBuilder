import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import sharp from 'sharp'
import { A4_SIZE_POINTS } from '../src/shared/constants/document.js'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))

const createPdf = async (input: {
  outputPath: string
  sizes: { width: number; height: number }[]
  label: string
  rotations?: number[]
}): Promise<void> => {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  input.sizes.forEach((size, index) => {
    const page = document.addPage([size.width, size.height])
    const rotation = input.rotations?.[index] ?? 0
    if (rotation) page.setRotation(degrees(rotation))
    page.drawRectangle({
      x: 24,
      y: 24,
      width: size.width - 48,
      height: size.height - 48,
      borderColor: rgb(0.2, 0.35, 0.5),
      borderWidth: 2,
      color: rgb(0.97, 0.98, 0.99),
    })
    page.drawText(input.label, {
      x: 48,
      y: size.height - 92,
      font: bold,
      size: Math.min(24, size.width / 18),
      color: rgb(0.12, 0.25, 0.38),
    })
    page.drawText(`Fixture page ${index + 1} / ${input.sizes.length}`, {
      x: 48,
      y: size.height - 126,
      font: regular,
      size: 14,
      color: rgb(0.2, 0.25, 0.3),
    })
    for (let line = 0; line < 12; line += 1) {
      const y = size.height - 175 - line * 32
      if (y < 55) break
      page.drawText(`Generated verification content line ${line + 1}`, {
        x: 52,
        y,
        font: regular,
        size: 10,
        color: rgb(0.35, 0.39, 0.43),
      })
      page.drawLine({
        start: { x: 52, y: y - 7 },
        end: { x: size.width - 52, y: y - 7 },
        thickness: 0.5,
        color: rgb(0.78, 0.81, 0.84),
      })
    }
  })
  document.setTitle(input.label)
  document.setCreator('SupportPack Builder 测试夹具生成器')
  document.setProducer('pdf-lib')
  await writeFile(input.outputPath, await document.save())
}

const createImage = async (input: {
  outputPath: string
  width: number
  height: number
  background: string
  label: string
  format: 'jpeg' | 'png' | 'webp'
}): Promise<void> => {
  const svg = Buffer.from(`
    <svg width="${input.width}" height="${input.height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${input.background}"/>
      <rect x="40" y="40" width="${input.width - 80}" height="${input.height - 80}" fill="white" stroke="#315b7d" stroke-width="5"/>
      <text x="50%" y="46%" text-anchor="middle" font-size="${Math.max(30, Math.round(input.width / 18))}" font-family="Arial, sans-serif" font-weight="700" fill="#173b59">${input.label}</text>
      <text x="50%" y="54%" text-anchor="middle" font-size="${Math.max(20, Math.round(input.width / 34))}" font-family="Arial, sans-serif" fill="#536779">Generated locally for automated tests</text>
    </svg>
  `)
  const pipeline = sharp(svg).withMetadata({ orientation: 1 })
  if (input.format === 'jpeg') await pipeline.jpeg({ quality: 92 }).toFile(input.outputPath)
  else if (input.format === 'png') await pipeline.png().toFile(input.outputPath)
  else await pipeline.webp({ quality: 90 }).toFile(input.outputPath)
}

export type FixtureManifest = {
  tenPagePdf: string
  landscapePdf: string
  nonStandardPdf: string
  rotatedPdf: string
  longTitlePdf: string
  jpgImages: string[]
  pngImage: string
  webpImage: string
}

export const generateFixtures = async (outputDirectory: string): Promise<FixtureManifest> => {
  await mkdir(outputDirectory, { recursive: true })
  const tenPagePdf = join(outputDirectory, 'ten-pages-a4.pdf')
  const landscapePdf = join(outputDirectory, 'three-pages-landscape.pdf')
  const nonStandardPdf = join(outputDirectory, 'non-standard-scan.pdf')
  const rotatedPdf = join(outputDirectory, 'rotated-source-page.pdf')
  const longTitlePdf = join(outputDirectory, 'long-title.pdf')
  await createPdf({
    outputPath: tenPagePdf,
    sizes: Array.from({ length: 10 }, () => A4_SIZE_POINTS),
    label: 'Ten-page A4 source material',
  })
  await createPdf({
    outputPath: landscapePdf,
    sizes: Array.from({ length: 3 }, () => ({
      width: A4_SIZE_POINTS.height,
      height: A4_SIZE_POINTS.width,
    })),
    label: 'Landscape source material',
  })
  await createPdf({
    outputPath: nonStandardPdf,
    sizes: [
      { width: 980, height: 310 },
      { width: 310, height: 1_120 },
      { width: 420, height: 300 },
    ],
    label: 'Non-standard scan sizes',
  })
  await createPdf({
    outputPath: rotatedPdf,
    sizes: [A4_SIZE_POINTS],
    rotations: [90],
    label: 'Source Rotate 90 degrees',
  })
  await createPdf({
    outputPath: longTitlePdf,
    sizes: [A4_SIZE_POINTS],
    label:
      'A deliberately long title used to verify wrapping and multi-page table-of-contents layout',
  })
  const jpgImages = [1, 2, 3].map((index) => join(outputDirectory, `collection-${index}.jpg`))
  for (const [index, outputPath] of jpgImages.entries()) {
    await createImage({
      outputPath,
      width: index === 1 ? 2_200 : 1_600,
      height: index === 2 ? 1_100 : 2_200,
      background: ['#dce8f1', '#e7e2d5', '#dde9df'][index] ?? '#ffffff',
      label: `Image collection ${index + 1}`,
      format: 'jpeg',
    })
  }
  const pngImage = join(outputDirectory, 'certificate.png')
  await createImage({
    outputPath: pngImage,
    width: 1_800,
    height: 1_200,
    background: '#ece7d9',
    label: 'PNG certificate',
    format: 'png',
  })
  const webpImage = join(outputDirectory, 'scan.webp')
  await createImage({
    outputPath: webpImage,
    width: 1_400,
    height: 2_000,
    background: '#dfe7e8',
    label: 'WebP scan',
    format: 'webp',
  })
  const manifest = {
    tenPagePdf,
    landscapePdf,
    nonStandardPdf,
    rotatedPdf,
    longTitlePdf,
    jpgImages,
    pngImage,
    webpImage,
  }
  await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

const directOutput = resolve(scriptDirectory, '../fixtures/generated')
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateFixtures(directOutput)
  process.stdout.write(`测试夹具已生成：${directOutput}\n`)
}
