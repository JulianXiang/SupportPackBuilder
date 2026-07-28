import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, utimes } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { generateFixtures } from './generate-fixtures.js'
import { ConversionManager } from '../src/main/services/conversion-manager.js'
import { ImportService } from '../src/main/services/import-service.js'
import { LibreOfficeConversionAdapter } from '../src/main/services/libreoffice-conversion-adapter.js'
import { resolveLibreOfficeExecutable } from '../src/main/services/libreoffice-runtime.js'
import { writeProjectAtomically } from '../src/main/services/project-service.js'
import {
  createDefaultProject,
  ProjectSchema,
  type Material,
  type MaterialSource,
  type OutlineNode,
} from '../src/shared/schemas/project-schema.js'

const rootDirectory = resolve('fixtures/generated/package-smoke')
const projectDirectory = join(rootDirectory, '打包成品导入导出回归')
await rm(rootDirectory, { recursive: true, force: true })
await Promise.all([
  mkdir(join(projectDirectory, 'assets'), { recursive: true }),
  mkdir(join(projectDirectory, 'cache', 'thumbnails'), { recursive: true }),
  mkdir(join(projectDirectory, 'cache', 'previews'), { recursive: true }),
  mkdir(join(projectDirectory, 'temp'), { recursive: true }),
  mkdir(join(projectDirectory, 'output'), { recursive: true }),
])
const fixtures = await generateFixtures(join(rootDirectory, 'sources'))

const createSource = async (input: {
  sourcePath: string
  originalFileName: string
  mimeType: string
  pageCount: number
  width?: number
  height?: number
}): Promise<MaterialSource> => {
  const id = randomUUID()
  const extension = input.originalFileName.slice(input.originalFileName.lastIndexOf('.'))
  const storedPath = join('assets', `${id}${extension}`)
  const bytes = await readFile(input.sourcePath)
  const sourceStat = await stat(input.sourcePath)
  const storedAbsolutePath = join(projectDirectory, storedPath)
  await copyFile(input.sourcePath, storedAbsolutePath)
  await utimes(storedAbsolutePath, sourceStat.atime, sourceStat.mtime)
  return {
    id,
    sourcePath: storedPath,
    storedPath,
    originalFileName: input.originalFileName,
    fileHash: createHash('sha256').update(bytes).digest('hex'),
    fileSize: sourceStat.size,
    modifiedTime: Math.round(sourceStat.mtimeMs),
    mimeType: input.mimeType,
    pageCount: input.pageCount,
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
  }
}

const pdfBytes = await readFile(fixtures.tenPagePdf)
const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false })
const pdfSource = await createSource({
  sourcePath: fixtures.tenPagePdf,
  originalFileName: 'ten-pages-a4.pdf',
  mimeType: 'application/pdf',
  pageCount: pdfDocument.getPageCount(),
})
const imageMetadata = await sharp(fixtures.pngImage).metadata()
const imageSource = await createSource({
  sourcePath: fixtures.pngImage,
  originalFileName: 'certificate.png',
  mimeType: 'image/png',
  pageCount: 1,
  ...(imageMetadata.width ? { width: imageMetadata.width } : {}),
  ...(imageMetadata.height ? { height: imageMetadata.height } : {}),
})
const levelOneId = randomUUID()
const levelTwoId = randomUUID()
const now = new Date().toISOString()

const createMaterial = (
  source: MaterialSource,
  input: {
    title: string
    sourceType: 'pdf' | 'image'
    selectedPageRanges: string
  },
): Material => ({
  id: randomUUID(),
  outlineNodeId: levelTwoId,
  title: input.title,
  category: '真实 PDF 与图片',
  sourceType: input.sourceType,
  sourcePath: source.sourcePath,
  storedPath: source.storedPath,
  originalFileName: source.originalFileName,
  fileHash: source.fileHash,
  fileSize: source.fileSize,
  modifiedTime: source.modifiedTime,
  pageCount: source.pageCount,
  selectedPageRanges: input.selectedPageRanges,
  pageOrder: Array.from(
    { length: source.pageCount },
    (_, pageIndex) => `${source.id}:${pageIndex}`,
  ),
  rotationByPage: {},
  removedPages: [],
  enabled: true,
  startOnNewPage: true,
  insertTitlePage: false,
  notes: '',
  validationStatus: 'valid',
  validationMessages: [],
  order: input.sourceType === 'pdf' ? 0 : 1,
  createdAt: now,
  updatedAt: now,
  sourceItems: [source],
})

const outlineNodes: OutlineNode[] = [
  {
    id: levelOneId,
    parentId: null,
    level: 1,
    title: '打包成品回归材料',
    order: 0,
    enabled: true,
    insertDividerPage: false,
    children: [
      {
        id: levelTwoId,
        parentId: levelOneId,
        level: 2,
        title: '真实 PDF 与图片',
        order: 0,
        enabled: true,
        insertDividerPage: false,
        children: [],
        materials: [
          createMaterial(pdfSource, {
            title: '十页 PDF 选页材料',
            sourceType: 'pdf',
            selectedPageRanges: '1,3,5-7',
          }),
          createMaterial(imageSource, {
            title: 'PNG 证书',
            sourceType: 'image',
            selectedPageRanges: 'all',
          }),
        ],
      },
    ],
    materials: [],
  },
]
const project = ProjectSchema.parse(
  createDefaultProject({
    title: '打包成品导入导出回归',
    ownerName: '测试用户',
    organization: '本地验证环境',
    purpose: '验证打包后原生模块与 utilityProcess',
    outlineNodes,
  }),
)
const libreOfficeExecutable = await resolveLibreOfficeExecutable({
  appPath: process.cwd(),
  resourcesPath: process.cwd(),
  packaged: false,
})
if (!libreOfficeExecutable) {
  throw new Error('打包成品回归准备需要 LibreOffice 运行时，请先运行 npm run prepare:libreoffice。')
}
const importService = new ImportService(
  new ConversionManager(new LibreOfficeConversionAdapter(libreOfficeExecutable)),
)
const officeAnalysis = await importService.analyze(
  project,
  [fixtures.docxDocument, fixtures.pptxPresentation, fixtures.xlsxWorkbook],
  { projectDirectory },
)
if (officeAnalysis.candidates.some((candidate) => candidate.validationStatus === 'error')) {
  throw new Error('打包成品回归 Office 夹具转换失败。')
}
const officeImport = await importService.commit(projectDirectory, project, {
  token: officeAnalysis.token,
  targetOutlineNodeId: levelTwoId,
  imageGrouping: 'separate',
  resolutions: officeAnalysis.candidates.map((candidate) => ({
    candidateId: candidate.id,
    action: 'import' as const,
  })),
})
await writeProjectAtomically(projectDirectory, officeImport.project)
const projectPath = join(projectDirectory, 'project.json')
process.stdout.write(
  `${JSON.stringify({
    projectPath,
    outputPath: join(projectDirectory, 'output', '打包成品导出.pdf'),
    officeMaterialCount: officeImport.importedMaterialIds.length,
  })}\n`,
)
