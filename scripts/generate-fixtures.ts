import { createWriteStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import pptxgen from 'pptxgenjs'
import sharp from 'sharp'
import { openPromise, type Entry } from 'yauzl'
import { ZipFile } from 'yazl'
import { A4_SIZE_POINTS } from '../src/shared/constants/document.js'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))

type FixtureSlide = {
  background: { color: string }
  hidden: boolean
  addText(text: string, options: Record<string, unknown>): void
  addShape(shape: string, options: Record<string, unknown>): void
}

type FixturePresentation = {
  layout: string
  author: string
  subject: string
  title: string
  company: string
  lang: string
  ShapeType: { rect: string }
  addSlide(): FixtureSlide
  writeFile(input: { fileName: string }): Promise<string>
}

const importedPptxGen: unknown = pptxgen
const PptxGen = (
  typeof importedPptxGen === 'function'
    ? importedPptxGen
    : (importedPptxGen as { default: unknown }).default
) as new () => FixturePresentation

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
  document.setCreator('SupportPackBuilder 测试夹具生成器')
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
  docxDocument: string
  pptxPresentation: string
  xlsxWorkbook: string
  xlsxWithoutPrintSettings: string
  corruptedDocx: string
}

const createDocxFixture = async (outputPath: string): Promise<void> => {
  const image = await sharp({
    create: {
      width: 640,
      height: 300,
      channels: 4,
      background: '#e8eef4',
    },
  })
    .composite([
      {
        input: Buffer.from(`
          <svg width="640" height="300" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="20" width="600" height="260" fill="#ffffff" stroke="#315b7d" stroke-width="4"/>
            <text x="320" y="130" text-anchor="middle" font-size="36" font-family="sans-serif" fill="#173b59">测试图片</text>
            <text x="320" y="180" text-anchor="middle" font-size="24" font-family="sans-serif" fill="#536779">DOCX 本地夹具</text>
          </svg>
        `),
      },
    ])
    .png()
    .toBuffer()
  const document = new Document({
    creator: 'SupportPackBuilder 测试夹具生成器',
    title: 'DOCX 多页中文支撑材料夹具',
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1_134,
              right: 1_134,
              bottom: 1_134,
              left: 1_134,
            },
          },
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            children: [new TextRun('DOCX 多页中文支撑材料')],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: '本文件由测试脚本本地生成，用于验证中文、表格、图片与多页 Word 转 PDF。',
                size: 24,
              }),
            ],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('项目')] }),
                  new TableCell({ children: [new Paragraph('内容')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('姓名')] }),
                  new TableCell({ children: [new Paragraph('张老师')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('单位')] }),
                  new TableCell({ children: [new Paragraph('示例大学')] }),
                ],
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: image,
                transformation: { width: 480, height: 225 },
                type: 'png',
              }),
            ],
          }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun('第二页：成果说明')],
          }),
          ...Array.from(
            { length: 18 },
            (_, index) =>
              new Paragraph(
                `第 ${index + 1} 条测试内容：用于检查 DOCX 转换后的分页、中文字体与正文行距。`,
              ),
          ),
        ],
      },
    ],
  })
  await writeFile(outputPath, await Packer.toBuffer(document))
}

const createPptxFixture = async (outputPath: string): Promise<void> => {
  const presentation = new PptxGen()
  presentation.layout = 'LAYOUT_WIDE'
  presentation.author = 'SupportPackBuilder 测试夹具生成器'
  presentation.subject = 'PPTX 可见与隐藏幻灯片转换测试'
  presentation.title = 'PPTX 支撑材料夹具'
  presentation.company = 'SupportPackBuilder'
  presentation.lang = 'zh-CN'
  const colors = ['DCE8F1', 'E7E2D5']
  for (let index = 0; index < 2; index += 1) {
    const slide = presentation.addSlide()
    slide.background = { color: colors[index] ?? 'FFFFFF' }
    slide.addText(`可见幻灯片 ${index + 1}`, {
      x: 0.7,
      y: 0.65,
      w: 8.8,
      h: 0.6,
      fontFace: 'Microsoft YaHei',
      fontSize: 26,
      bold: true,
      color: '173B59',
    })
    slide.addText('用于验证 PPTX 离线转换、页面顺序以及 A4 输出。', {
      x: 0.7,
      y: 1.55,
      w: 8.8,
      h: 0.5,
      fontFace: 'Microsoft YaHei',
      fontSize: 16,
      color: '34495E',
    })
    slide.addShape(presentation.ShapeType.rect, {
      x: 0.8,
      y: 2.35,
      w: 7.7,
      h: 3,
      fill: { color: 'FFFFFF' },
      line: { color: '315B7D', width: 2 },
    })
  }
  const hiddenSlide = presentation.addSlide()
  hiddenSlide.hidden = true
  hiddenSlide.addText('隐藏幻灯片：不应进入转换 PDF', {
    x: 1,
    y: 2,
    w: 8,
    h: 1,
    fontFace: 'Microsoft YaHei',
    fontSize: 24,
    bold: true,
  })
  await presentation.writeFile({ fileName: outputPath })
}

const populateWorksheet = (worksheet: ExcelJS.Worksheet, rows: number): void => {
  worksheet.columns = [
    { header: '序号', key: 'index', width: 10 },
    { header: '成果名称', key: 'title', width: 35 },
    { header: '成果类型', key: 'category', width: 18 },
    { header: '年度', key: 'year', width: 12 },
  ]
  for (let index = 1; index <= rows; index += 1) {
    worksheet.addRow({
      index,
      title: `本地生成的测试成果 ${index}`,
      category: index % 2 === 0 ? '论文' : '项目',
      year: 2026,
    })
  }
  worksheet.getRow(1).font = { bold: true }
}

const readZipEntry = async (
  archive: Awaited<ReturnType<typeof openPromise>>,
  entry: Entry,
): Promise<Buffer> => {
  const stream = await archive.openReadStreamPromise(entry)
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) {
    chunks.push(new Uint8Array(Buffer.from(chunk as Uint8Array)))
  }
  return Buffer.concat(chunks)
}

const removeXlsxPrintSettings = async (sourcePath: string, outputPath: string): Promise<void> => {
  const archive = await openPromise(sourcePath, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  })
  const output = new ZipFile()
  try {
    for await (const entry of archive.eachEntry()) {
      if (entry.fileName.endsWith('/')) {
        output.addEmptyDirectory(entry.fileName)
        continue
      }
      let data = await readZipEntry(archive, entry)
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.fileName)) {
        const xml = data
          .toString('utf8')
          .replace(/<pageMargins\b[^>]*\/>/g, '')
          .replace(/<pageSetup\b[^>]*\/>/g, '')
          .replace(/<printOptions\b[^>]*\/>/g, '')
          .replace(/<pageSetUpPr\b[^>]*\/>/g, '')
        data = Buffer.from(xml, 'utf8')
      }
      output.addBuffer(data, entry.fileName, {
        mode: 0o100600,
        mtime: entry.getLastModDate(),
      })
    }
    const completed = pipeline(
      output.outputStream,
      createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
    )
    output.end()
    await completed
  } finally {
    archive.close()
  }
}

const createXlsxFixture = async (outputPath: string, withPrintSettings: boolean): Promise<void> => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SupportPackBuilder 测试夹具生成器'
  workbook.title = withPrintSettings ? '带打印区域的 XLSX 夹具' : '无打印设置的 XLSX 夹具'
  const first = workbook.addWorksheet('成果清单')
  populateWorksheet(first, 42)
  if (withPrintSettings) {
    first.pageSetup = {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printArea: 'A1:D30',
    }
  }
  const second = workbook.addWorksheet('补充材料')
  populateWorksheet(second, 16)
  const hidden = workbook.addWorksheet('隐藏工作表')
  hidden.state = 'hidden'
  populateWorksheet(hidden, 8)
  if (withPrintSettings) {
    await workbook.xlsx.writeFile(outputPath)
  } else {
    const rawPath = `${outputPath}.raw.xlsx`
    try {
      await workbook.xlsx.writeFile(rawPath)
      await removeXlsxPrintSettings(rawPath, outputPath)
    } finally {
      await rm(rawPath, { force: true })
    }
  }
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
  const docxDocument = join(outputDirectory, 'office-document.docx')
  await createDocxFixture(docxDocument)
  const pptxPresentation = join(outputDirectory, 'office-presentation.pptx')
  await createPptxFixture(pptxPresentation)
  const xlsxWorkbook = join(outputDirectory, 'office-workbook-print-area.xlsx')
  await createXlsxFixture(xlsxWorkbook, true)
  const xlsxWithoutPrintSettings = join(outputDirectory, 'office-workbook-auto-print.xlsx')
  await createXlsxFixture(xlsxWithoutPrintSettings, false)
  const corruptedDocx = join(outputDirectory, 'corrupted-office.docx')
  await writeFile(corruptedDocx, Buffer.from('这不是有效的 OOXML ZIP 文件。', 'utf8'))
  const manifest = {
    tenPagePdf,
    landscapePdf,
    nonStandardPdf,
    rotatedPdf,
    longTitlePdf,
    jpgImages,
    pngImage,
    webpImage,
    docxDocument,
    pptxPresentation,
    xlsxWorkbook,
    xlsxWithoutPrintSettings,
    corruptedDocx,
  }
  await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

const directOutput = resolve(scriptDirectory, '../fixtures/generated')
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateFixtures(directOutput)
  process.stdout.write(`测试夹具已生成：${directOutput}\n`)
}
