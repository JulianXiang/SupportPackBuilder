import { describe, expect, it } from 'vitest'
import { assertProjectFileReferencesUnchanged } from '../../src/main/services/project-edit-guard.js'
import { createProjectFixture } from '../helpers/project-fixture.js'

describe('Renderer 项目修改安全边界', () => {
  it('允许编辑项目文字、页面范围和旋转', () => {
    const current = createProjectFixture()
    const incoming = structuredClone(current)
    incoming.title = '修改后的标题'
    const material = incoming.outlineNodes[0]?.children[0]?.materials[0]
    expect(material).toBeDefined()
    if (!material) return
    material.selectedPageRanges = '1,3'
    material.rotationByPage[`${material.sourceItems[0]?.id}:0`] = 90
    expect(() => assertProjectFileReferencesUnchanged(current, incoming)).not.toThrow()
  })

  it('拒绝 Renderer 替换来源路径', () => {
    const current = createProjectFixture()
    const incoming = structuredClone(current)
    const source = incoming.outlineNodes[0]?.children[0]?.materials[0]?.sourceItems[0]
    expect(source).toBeDefined()
    if (!source) return
    source.sourcePath = '/etc/passwd'
    expect(() => assertProjectFileReferencesUnchanged(current, incoming)).toThrow(
      '来源文件元数据不得由界面直接修改',
    )
  })

  it('拒绝 Renderer 注入新的材料来源', () => {
    const current = createProjectFixture()
    const incoming = structuredClone(current)
    const material = incoming.outlineNodes[0]?.children[0]?.materials[0]
    expect(material).toBeDefined()
    if (!material) return
    const firstSource = material.sourceItems[0]
    expect(firstSource).toBeDefined()
    if (!firstSource) return
    material.sourceItems.push({ ...firstSource, id: crypto.randomUUID() })
    expect(() => assertProjectFileReferencesUnchanged(current, incoming)).toThrow(
      '来源文件元数据不得由界面直接修改',
    )
  })
})
