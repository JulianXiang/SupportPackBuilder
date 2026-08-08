import { describe, expect, it } from 'vitest'
import type { PagePlan } from '../../src/shared/schemas/page-plan-schema.js'
import {
  createLayoutSection,
  createLayoutSheet,
  flattenLayoutSlots,
  mapLayoutNode,
} from '../../src/shared/utils/layout-tree.js'
import { buildPagePlan, getSelectedSourcePages } from '../../src/shared/utils/page-plan.js'
import { applySafeIssueFix } from '../../src/renderer/src/utils/issue-fixes.js'
import {
  collectIssueViews,
  summarizeIssues,
  type IssueView,
} from '../../src/renderer/src/utils/issues.js'
import {
  createMaterialFixture,
  createProjectFixture,
  createSourceFixture,
  IDS,
} from '../helpers/project-fixture.js'

const issue = (
  code: string,
  severity: IssueView['severity'] = 'warning',
  materialId: string | null = null,
): IssueView => ({
  id: `test:${code}`,
  code,
  severity,
  category: severity,
  source: 'pagePlan',
  message: code,
  outlineNodeId: materialId ? IDS.level2 : null,
  materialId,
  pageId: null,
  locationLabel: '测试位置',
  order: 0,
})

describe('统一问题中心', () => {
  it('按实时文件和 PagePlan 优先级去重、排序并产生同源计数', () => {
    const project = createProjectFixture()
    const material = project.outlineNodes[0]?.children[0]?.materials[0]
    if (!material) throw new Error('测试材料不存在。')
    const base = buildPagePlan(project)
    material.validationStatus = 'missing'
    material.validationMessages = [
      {
        code: 'source-missing',
        severity: 'error',
        message: '实时校验：来源文件缺失。',
        suggestion: '重新定位文件。',
      },
    ]
    const plan: PagePlan = {
      ...base,
      errors: [
        ...base.errors,
        {
          code: 'source-missing',
          severity: 'error',
          message: '页面计划中的旧缺失消息。',
          outlineNodeId: IDS.level2,
          materialId: IDS.material,
        },
      ],
      warnings: [
        ...base.warnings,
        {
          code: 'page-range-extra-whitespace',
          severity: 'warning',
          message: '页码范围包含空格。',
          outlineNodeId: IDS.level2,
          materialId: IDS.material,
        },
        {
          code: 'layout-disabled',
          severity: 'warning',
          message: '拼版未启用。',
          outlineNodeId: null,
          materialId: null,
        },
      ],
    }

    const issues = collectIssueViews(project, plan)
    const missing = issues.filter((item) => item.code === 'source-missing')
    const pageRange = issues.find((item) => item.code === 'page-range-extra-whitespace')

    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({ source: 'material', category: 'missing' })
    expect(missing[0]?.message).toContain('实时校验')
    expect(pageRange).toMatchObject({ source: 'pagePlan', materialId: IDS.material })
    expect(issues[0]?.severity).toBe('error')
    expect(summarizeIssues(issues)).toEqual({ missing: 1, errors: 0, warnings: 2 })
  })

  it('规范页码范围但保持有效来源页面集合不变', () => {
    const project = createProjectFixture()
    const material = project.outlineNodes[0]?.children[0]?.materials[0]
    if (!material) throw new Error('测试材料不存在。')
    const source = material.sourceItems[0]
    if (!source) throw new Error('测试来源不存在。')
    material.selectedPageRanges = ' 1 - 3, 2 '
    source.selectedPageRanges = ' 1 - 3, 2 '
    const before = getSelectedSourcePages(material).pages.map((page) => page.sourcePageId)

    const result = applySafeIssueFix(
      project,
      issue('page-range-extra-whitespace', 'warning', material.id),
    )
    const after = getSelectedSourcePages(material).pages.map((page) => page.sourcePageId)

    expect(result.changed).toBe(true)
    expect(material.selectedPageRanges).toBe('all')
    expect(material.sourceItems[0]?.selectedPageRanges).toBe('all')
    expect(after).toEqual(before)
  })

  it('可确认启用已有拼版配置并删除完全空白的拼版页', () => {
    const project = createProjectFixture()
    project.collageSettings.enabled = false
    expect(applySafeIssueFix(project, issue('layout-disabled')).changed).toBe(true)
    expect(project.collageSettings.enabled).toBe(true)

    const section = createLayoutSection(IDS.material, [`${IDS.source}:0`], 'two-up')
    section.layout = mapLayoutNode(section.layout, (node) =>
      node.kind === 'slot' ? { ...node, sourcePageId: null, detailOf: null } : node,
    )
    project.layoutSheets = [
      createLayoutSheet({
        anchorSourcePageId: `${IDS.source}:0`,
        sections: [section],
        order: 0,
        project,
      }),
    ]

    expect(applySafeIssueFix(project, issue('layout-sheet-empty')).changed).toBe(true)
    expect(project.layoutSheets).toEqual([])
  })

  it.each(['layout-anchor-conflict', 'layout-section-order-conflict'])(
    '按目录修复 %s 且保持每个来源只有一个主槽',
    (code) => {
      const project = createProjectFixture()
      const firstMaterial = project.outlineNodes[0]?.children[0]?.materials[0]
      const child = project.outlineNodes[0]?.children[0]
      const root = project.outlineNodes[0]
      if (!firstMaterial || !child || !root) throw new Error('测试目录结构无效。')
      const firstSource = firstMaterial.sourceItems[0]
      if (!firstSource) throw new Error('第一项测试来源不存在。')
      firstMaterial.pageCount = 1
      firstSource.pageCount = 1
      root.insertDividerPage = false
      project.exportSettings.includeDividerPages = false
      project.exportSettings.includeMaterialTitlePages = false
      const secondSourceId = '00000000-0000-4000-8000-000000000202'
      const secondMaterialId = '00000000-0000-4000-8000-000000000201'
      const secondSource = createSourceFixture({
        id: secondSourceId,
        sourcePath: '/tmp/second.pdf',
        storedPath: 'assets/second.pdf',
        originalFileName: 'second.pdf',
        pageCount: 1,
      })
      const secondMaterial = createMaterialFixture({
        id: secondMaterialId,
        title: '第二项材料',
        order: 1,
        sourcePath: secondSource.sourcePath,
        storedPath: secondSource.storedPath,
        originalFileName: secondSource.originalFileName,
        pageCount: 1,
        sourceItems: [secondSource],
      })
      child.materials.push(secondMaterial)
      const firstPageId = `${IDS.source}:0`
      const secondPageId = `${secondSourceId}:0`
      const acknowledge = (materialId: string, sourcePageId: string) => {
        const section = createLayoutSection(materialId, [sourcePageId], 'two-up')
        section.layout = mapLayoutNode(section.layout, (node) =>
          node.kind === 'slot' ? { ...node, clarityRiskAcknowledged: true } : node,
        )
        return section
      }
      project.layoutSheets = [
        createLayoutSheet({
          anchorSourcePageId: secondPageId,
          sections: [
            acknowledge(secondMaterial.id, secondPageId),
            acknowledge(firstMaterial.id, firstPageId),
          ],
          order: 4,
          project,
        }),
      ]

      const before = buildPagePlan(project)
      expect(before.errors.map((item) => item.code)).toEqual(
        expect.arrayContaining(['layout-anchor-conflict', 'layout-section-order-conflict']),
      )
      expect(applySafeIssueFix(project, issue(code, 'error')).changed).toBe(true)

      const repairedSheet = project.layoutSheets[0]
      expect(repairedSheet?.anchorSourcePageId).toBe(firstPageId)
      expect(repairedSheet?.sections.map((section) => section.materialId)).toEqual([
        firstMaterial.id,
        secondMaterial.id,
      ])
      const mainSources = repairedSheet?.sections.flatMap((section) =>
        flattenLayoutSlots(section.layout)
          .filter((slot) => slot.detailOf === null)
          .map((slot) => slot.sourcePageId),
      )
      expect(new Set(mainSources).size).toBe(mainSources?.length)
      const after = buildPagePlan(project)
      expect(after.errors.map((item) => item.code)).not.toContain('layout-anchor-conflict')
      expect(after.errors.map((item) => item.code)).not.toContain('layout-section-order-conflict')
    },
  )
})
