import { describe, expect, it } from 'vitest'
import { ProjectSchema } from '../../src/shared/schemas/project-schema.js'
import { createProjectFixture } from '../helpers/project-fixture.js'

describe('ProjectSchema', () => {
  it('完整校验有效项目', () => {
    expect(ProjectSchema.parse(createProjectFixture()).schemaVersion).toBe(1)
  })

  it('为旧版 schemaVersion 1 项目补充同页标题默认设置', () => {
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
})
