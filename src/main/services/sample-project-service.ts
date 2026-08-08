import fontkit from '@pdf-lib/fontkit'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, rgb } from 'pdf-lib'
import { A4_SIZE_POINTS } from '../../shared/constants/document.js'
import { createDefaultProject, type Project } from '../../shared/schemas/project-schema.js'
import { createOutlineFromTemplate } from '../../shared/templates/index.js'
import { suggestCollage } from '../../shared/utils/collage-suggestion.js'
import type { ImportCommitInput } from '../../shared/types/import.js'
import type { ImportService } from './import-service.js'
import {
  createProjectDirectory,
  type ProjectSession,
  writeProjectAtomically,
} from './project-service.js'

type SampleSourceGroup = {
  paths: string[]
  outlineTitle: string
  materialTitle: string
  imageGrouping: ImportCommitInput['imageGrouping']
}

const findOutlineTarget = (project: Project, title: string): string => {
  const target = project.outlineNodes
    .flatMap((node) => node.children)
    .find((node) => node.title === title)
  if (!target) throw new Error(`示例项目缺少目录“${title}”。`)
  return target.id
}

const createSamplePdf = async (input: {
  path: string
  title: string
  subtitle: string
  pageCount: number
  fontPath: string
  boldFontPath: string
}): Promise<void> => {
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const regular = await document.embedFont(await readFile(input.fontPath), { subset: true })
  const bold = await document.embedFont(await readFile(input.boldFontPath), { subset: true })
  for (let index = 0; index < input.pageCount; index += 1) {
    const page = document.addPage([A4_SIZE_POINTS.width, A4_SIZE_POINTS.height])
    page.drawRectangle({
      x: 36,
      y: 36,
      width: A4_SIZE_POINTS.width - 72,
      height: A4_SIZE_POINTS.height - 72,
      borderColor: rgb(0.14, 0.31, 0.45),
      borderWidth: 1.5,
      color: rgb(0.975, 0.982, 0.989),
    })
    page.drawText(input.title, {
      x: 64,
      y: A4_SIZE_POINTS.height - 112,
      font: bold,
      size: 24,
      color: rgb(0.08, 0.22, 0.34),
    })
    page.drawText(`${input.subtitle} · 第 ${index + 1} 页`, {
      x: 64,
      y: A4_SIZE_POINTS.height - 148,
      font: regular,
      size: 13,
      color: rgb(0.25, 0.34, 0.41),
    })
    const paragraphs = [
      '本页为应用在本机生成的示例内容，用于体验材料导入、排序、拼版与导出。',
      '所有文字和图形均为虚构信息，不包含真实个人资料，也不会上传到任何服务器。',
      '你可以修改材料标题、页码范围和目录位置，并通过撤销恢复项目配置。',
      '完成检查后，请使用“导出 PDF”查看最终 A4 编排结果。',
    ]
    paragraphs.forEach((text, paragraphIndex) => {
      const y = A4_SIZE_POINTS.height - 220 - paragraphIndex * 96
      page.drawText(text, {
        x: 72,
        y,
        font: regular,
        size: 12,
        maxWidth: A4_SIZE_POINTS.width - 144,
        lineHeight: 20,
        color: rgb(0.17, 0.2, 0.23),
      })
      page.drawLine({
        start: { x: 72, y: y - 24 },
        end: { x: A4_SIZE_POINTS.width - 72, y: y - 24 },
        thickness: 0.6,
        color: rgb(0.75, 0.8, 0.84),
      })
    })
  }
  document.setTitle(input.title)
  document.setCreator('个人支撑材料编排器')
  document.setProducer('SupportPackBuilder')
  await writeFile(input.path, await document.save())
}

const createSampleImage = async (input: { path: string; index: number }): Promise<void> => {
  const canvas = createCanvas(1600, 1100)
  const context = canvas.getContext('2d')
  const palette = ['#dce9f3', '#e8e2f1', '#e4eee4', '#f1e8dc']
  context.fillStyle = palette[(input.index - 1) % palette.length] ?? '#e6edf3'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#ffffff'
  context.strokeStyle = '#315b7d'
  context.lineWidth = 8
  context.fillRect(80, 80, canvas.width - 160, canvas.height - 160)
  context.strokeRect(80, 80, canvas.width - 160, canvas.height - 160)
  context.fillStyle = '#173b59'
  context.textAlign = 'center'
  context.font = '72px SupportPackSampleBold'
  context.fillText(`教学活动照片示例 ${input.index}`, canvas.width / 2, 480)
  context.fillStyle = '#536779'
  context.font = '36px SupportPackSample'
  context.fillText('本图片由应用在本机生成，可用于体验 2×2 多图拼版', canvas.width / 2, 570)
  context.font = '28px SupportPackSample'
  context.fillText('虚构内容 · 不包含真实个人信息', canvas.width / 2, 640)
  await writeFile(input.path, canvas.toBuffer('image/png'))
}

const importSampleGroup = async (input: {
  session: ProjectSession
  importService: ImportService
  group: SampleSourceGroup
}): Promise<ProjectSession> => {
  const targetOutlineNodeId = findOutlineTarget(input.session.project, input.group.outlineTitle)
  const analysis = await input.importService.analyze(input.session.project, input.group.paths, {
    projectDirectory: input.session.projectDirectory,
  })
  const committed = await input.importService.commit(
    input.session.projectDirectory,
    input.session.project,
    {
      token: analysis.token,
      targetOutlineNodeId,
      materialGrouping: 'separate',
      imageGrouping: input.group.imageGrouping,
      resolutions: analysis.candidates.map((candidate) => ({
        candidateId: candidate.id,
        action: 'import' as const,
      })),
    },
  )
  const importedIds = new Set(committed.importedMaterialIds)
  committed.project.outlineNodes.forEach((root) =>
    root.children.forEach((child) =>
      child.materials.forEach((material) => {
        if (importedIds.has(material.id)) material.title = input.group.materialTitle
      }),
    ),
  )
  return { ...input.session, project: committed.project }
}

const configureSampleCollage = (project: Project): void => {
  const imageMaterial = project.outlineNodes
    .flatMap((node) => node.children)
    .flatMap((node) => node.materials)
    .find((material) => material.title === '教学活动照片示例')
  if (!imageMaterial) throw new Error('示例图片材料创建失败。')
  const pages = imageMaterial.sourceItems.flatMap((source) =>
    Array.from({ length: source.pageCount }, (_, pageIndex) => ({
      sourcePageId: `${source.id}:${pageIndex}`,
      materialId: imageMaterial.id,
      outlineNodeId: imageMaterial.outlineNodeId,
      sourceKind: 'image' as const,
      aspectRatio:
        source.width && source.height && source.height > 0 ? source.width / source.height : 1.45,
    })),
  )
  const suggestion = suggestCollage({
    pages,
    project,
    existingSheetCount: 0,
    allowCrossMaterial: false,
    crossDirectoryConfirmed: false,
  })
  project.layoutSheets = suggestion.sheets
  imageMaterial.startPolicy = 'allowSharedSheet'
}

export const createSampleProject = async (input: {
  parentDirectory: string
  fontPath: string
  boldFontPath: string
  importService: ImportService
}): Promise<ProjectSession> => {
  const sourceDirectory = await mkdtemp(join(tmpdir(), 'supportpack-sample-'))
  let createdProjectDirectory: string | null = null
  try {
    const annualPdf = join(sourceDirectory, '年度工作总结示例.pdf')
    const paperPdf = join(sourceDirectory, '代表性论文示例.pdf')
    const imagePaths = Array.from({ length: 4 }, (_, index) =>
      join(sourceDirectory, `教学活动照片示例-${index + 1}.png`),
    )
    if (!GlobalFonts.has('SupportPackSample')) {
      GlobalFonts.registerFromPath(input.fontPath, 'SupportPackSample')
    }
    if (!GlobalFonts.has('SupportPackSampleBold')) {
      GlobalFonts.registerFromPath(input.boldFontPath, 'SupportPackSampleBold')
    }
    await Promise.all([
      createSamplePdf({
        path: annualPdf,
        title: '年度工作总结示例',
        subtitle: '岗位履职材料',
        pageCount: 3,
        fontPath: input.fontPath,
        boldFontPath: input.boldFontPath,
      }),
      createSamplePdf({
        path: paperPdf,
        title: '代表性论文示例',
        subtitle: '科研成果材料',
        pageCount: 2,
        fontPath: input.fontPath,
        boldFontPath: input.boldFontPath,
      }),
      ...imagePaths.map(
        async (path, index) =>
          await createSampleImage({
            path,
            index: index + 1,
          }),
      ),
    ])

    const project = createDefaultProject({
      title: '示例：个人成果支撑材料',
      ownerName: '示例用户',
      organization: '示例单位',
      purpose: '功能体验',
      outlineNodes: createOutlineFromTemplate('annual-review'),
    })
    let session = await createProjectDirectory(input.parentDirectory, project)
    createdProjectDirectory = session.projectDirectory
    const groups: SampleSourceGroup[] = [
      {
        paths: [annualPdf],
        outlineTitle: '年度工作',
        materialTitle: '年度工作总结示例',
        imageGrouping: 'separate',
      },
      {
        paths: [paperPdf],
        outlineTitle: '论文与著作',
        materialTitle: '代表性论文示例',
        imageGrouping: 'separate',
      },
      {
        paths: imagePaths,
        outlineTitle: '教学成效',
        materialTitle: '教学活动照片示例',
        imageGrouping: 'collection',
      },
    ]
    for (const group of groups) {
      session = await importSampleGroup({ session, importService: input.importService, group })
    }
    configureSampleCollage(session.project)
    session.project.updatedAt = new Date().toISOString()
    session.project = await writeProjectAtomically(session.projectDirectory, session.project)
    return session
  } catch (error) {
    if (createdProjectDirectory) {
      await rm(createdProjectDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
    throw error
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}
