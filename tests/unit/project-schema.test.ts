import { describe, expect, it } from 'vitest'
import { createDefaultProject, ProjectSchema } from '../../src/shared/schemas/project-schema.js'
import {
  createMaterialFixture,
  createOutlineFixture,
  createProjectFixture,
  createSourceFixture,
} from '../helpers/project-fixture.js'

describe('ProjectSchema', () => {
  it('完整校验有效项目', () => {
    expect(ProjectSchema.parse(createProjectFixture()).schemaVersion).toBe(3)
  })

  it('为缺少新增可选设置的项目补充默认值', () => {
    const legacy = structuredClone(createProjectFixture()) as Record<string, unknown>
    const exportSettings = legacy.exportSettings as Record<string, unknown>
    const coverSettings = legacy.coverSettings as Record<string, unknown>
    delete exportSettings.contentHeadingMode
    delete coverSettings.insertBlankBackPage
    const migrated = ProjectSchema.parse(legacy)
    expect(migrated.exportSettings.contentHeadingMode).toBe('firstPage')
    expect(migrated.coverSettings.insertBlankBackPage).toBe(true)
  })

  it('拒绝错误的父子层级', () => {
    const project = createProjectFixture()
    const child = project.outlineNodes[0]?.children[0]
    expect(child).toBeDefined()
    if (!child) return
    child.parentId = null
    expect(() => ProjectSchema.parse(project)).toThrow('层级或父节点配置无效')
  })

  it('拒绝项目内材料引用错误目录', () => {
    const project = createProjectFixture()
    const material = project.outlineNodes[0]?.children[0]?.materials[0]
    expect(material).toBeDefined()
    if (!material) return
    material.outlineNodeId = project.outlineNodes[0]?.id ?? material.outlineNodeId
    expect(() => ProjectSchema.parse(project)).toThrow('引用了错误的目录节点')
  })

  it('新建时复制封面字段一次，后续修改项目属性不会覆盖封面', () => {
    const project = createDefaultProject({
      title: '原项目名称',
      ownerName: '原姓名',
      organization: '原单位',
      purpose: '原用途',
      compiledDate: '2026-01-01',
    })
    project.title = '修改后的项目名称'
    project.ownerName = '修改后的姓名'
    project.organization = '修改后的单位'
    project.purpose = '修改后的用途'

    expect(project.coverSettings).toMatchObject({
      title: '原项目名称',
      ownerName: '原姓名',
      organization: '原单位',
      purpose: '原用途',
      compiledDate: '2026-01-01',
    })
  })

  it('完整校验包含 LibreOffice PDF 快照的 Office 材料', () => {
    const officeSource = createSourceFixture({
      sourceType: 'office',
      sourcePath: 'assets/source.docx',
      storedPath: 'assets/source.docx',
      originalFileName: 'source.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pageCount: 2,
      conversion: {
        adapterId: 'libreoffice',
        engineVersion: 'LibreOffice 26.2.5',
        officeFormat: 'docx',
        pdfStoredPath: 'assets/conversions/source.pdf',
        sourceFileHash: 'a'.repeat(64),
        fileHash: 'b'.repeat(64),
        fileSize: 2_048,
        pageCount: 2,
        convertedAt: '2026-01-01T00:00:00.000Z',
        snapshotStatus: 'ready',
        warnings: [],
      },
    })
    const officeMaterial = createMaterialFixture({
      sourceType: 'office',
      sourcePath: officeSource.sourcePath,
      storedPath: officeSource.storedPath,
      originalFileName: officeSource.originalFileName,
      pageCount: 2,
      sourceItems: [officeSource],
    })
    const project = createProjectFixture({
      outlineNodes: createOutlineFixture(officeMaterial),
    })

    expect(
      ProjectSchema.parse(project).outlineNodes[0]?.children[0]?.materials[0]?.sourceType,
    ).toBe('office')
  })
})
