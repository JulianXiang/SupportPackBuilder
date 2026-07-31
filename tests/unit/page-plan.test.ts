import { describe, expect, it } from 'vitest'
import { PagePlanSchema } from '../../src/shared/schemas/page-plan-schema.js'
import {
  createLayoutSection,
  createLayoutSheet,
  mapLayoutNode,
} from '../../src/shared/utils/layout-tree.js'
import { buildPagePlan } from '../../src/shared/utils/page-plan.js'
import {
  createMaterialFixture,
  createOutlineFixture,
  createProjectFixture,
  IDS,
} from '../helpers/project-fixture.js'

describe('PagePlan', () => {
  it('把同一成果的多个来源页替换为一张权威拼版物理页', () => {
    const project = createProjectFixture()
    const section = createLayoutSection(
      IDS.material,
      [`${IDS.source}:0`, `${IDS.source}:1`],
      'two-up',
    )
    section.layout = mapLayoutNode(section.layout, (node) =>
      node.kind === 'slot' ? { ...node, clarityRiskAcknowledged: true } : node,
    )
    project.layoutSheets = [
      createLayoutSheet({
        anchorSourcePageId: `${IDS.source}:0`,
        sections: [section],
        order: 0,
        templateId: 'two-up',
        project,
      }),
    ]

    const plan = PagePlanSchema.parse(buildPagePlan(project))
    const composite = plan.pages.find((page) => page.pageType === 'compositeContent')
    expect(composite?.materialIds).toEqual([IDS.material])
    expect(composite?.composite?.contentItems.map((item) => item.sourcePageId)).toEqual([
      `${IDS.source}:0`,
      `${IDS.source}:1`,
    ])
    expect(plan.pages.filter((page) => page.pageType === 'pdfContent')).toHaveLength(1)
    expect(plan.totalPageCount).toBe(6)
    expect(plan.materialStartPages[IDS.material]).toBe(2)
    expect(plan.errors).toEqual([])
  })

  it('未确认的低清晰度拼版会阻止导出，手工确认后降级为警告', () => {
    const project = createProjectFixture()
    const section = createLayoutSection(
      IDS.material,
      [`${IDS.source}:0`, `${IDS.source}:1`],
      'two-up',
    )
    project.layoutSheets = [
      createLayoutSheet({
        anchorSourcePageId: `${IDS.source}:0`,
        sections: [section],
        order: 0,
        templateId: 'two-up',
        project,
      }),
    ]
    const blocked = buildPagePlan(project)
    expect(blocked.errors.map((error) => error.code)).toContain('layout-clarity-blocked')

    const configuredSection = project.layoutSheets[0]?.sections[0]
    if (!configuredSection) throw new Error('缺少拼版测试区段。')
    configuredSection.layout = mapLayoutNode(configuredSection.layout, (node) =>
      node.kind === 'slot' ? { ...node, clarityRiskAcknowledged: true } : node,
    )
    const acknowledged = buildPagePlan(project)
    expect(acknowledged.errors.map((error) => error.code)).not.toContain('layout-clarity-blocked')
    expect(acknowledged.warnings.map((warning) => warning.code)).toContain(
      'layout-clarity-acknowledged',
    )
  })

  it('拒绝不连续页面拼版，避免静默改变原材料顺序', () => {
    const project = createProjectFixture()
    const section = createLayoutSection(
      IDS.material,
      [`${IDS.source}:0`, `${IDS.source}:2`],
      'two-up',
    )
    project.layoutSheets = [
      createLayoutSheet({
        anchorSourcePageId: `${IDS.source}:0`,
        sections: [section],
        order: 0,
        templateId: 'two-up',
        project,
      }),
    ]

    const plan = buildPagePlan(project)
    expect(plan.errors.map((error) => error.code)).toContain('layout-order-conflict')
    expect(plan.pages.filter((page) => page.pageType === 'compositeContent')).toHaveLength(1)
    expect(plan.pages.filter((page) => page.pageType === 'pdfContent')).toHaveLength(1)
  })

  it('来源页删除后保留原拼版槽位并阻止导出，不静默移动其他页面', () => {
    const material = createMaterialFixture({ removedPages: [`${IDS.source}:1`] })
    const project = createProjectFixture({ outlineNodes: createOutlineFixture(material) })
    const section = createLayoutSection(
      IDS.material,
      [`${IDS.source}:0`, `${IDS.source}:1`],
      'two-up',
    )
    project.layoutSheets = [
      createLayoutSheet({
        anchorSourcePageId: `${IDS.source}:0`,
        sections: [section],
        order: 0,
        templateId: 'two-up',
        project,
      }),
    ]

    const plan = buildPagePlan(project)
    const composite = plan.pages.find((page) => page.pageType === 'compositeContent')
    expect(plan.errors.map((error) => error.code)).toContain('layout-source-page-missing')
    expect(composite?.composite?.sections[0]?.layout).toEqual(section.layout)
    expect(composite?.composite?.contentItems.map((item) => item.sourcePageId)).toEqual([
      `${IDS.source}:0`,
    ])
  })

  it('让预览、目录和导出共享完整稳定顺序', () => {
    const project = createProjectFixture()
    const plan = buildPagePlan(project, { tocPageCount: 1, revision: 7 })

    expect(plan.pages.map((page) => page.pageType)).toEqual([
      'cover',
      'blank',
      'toc',
      'divider',
      'pdfContent',
      'pdfContent',
      'pdfContent',
    ])
    expect(plan.pages.map((page) => page.physicalIndex)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(plan.pages.map((page) => page.logicalPageNumber?.value ?? null)).toEqual([
      null,
      null,
      null,
      1,
      2,
      3,
      4,
    ])
    expect(plan.materialStartPages[IDS.material]).toBe(2)
    expect(
      plan.tocEntries.find((entry) => entry.materialId === IDS.material)?.logicalPageNumber,
    ).toBe(2)
    expect(plan.revision).toBe(7)
  })

  it('使用页码范围、重排、旋转和删除配置', () => {
    const material = createMaterialFixture({
      selectedPageRanges: '1-3',
      pageOrder: [`${IDS.source}:2`, `${IDS.source}:0`, `${IDS.source}:1`],
      rotationByPage: { [`${IDS.source}:2`]: 90 },
      removedPages: [`${IDS.source}:1`],
    })
    const project = createProjectFixture({ outlineNodes: createOutlineFixture(material) })
    const contentPages = buildPagePlan(project).pages.filter((page) => page.materialId)

    expect(contentPages.map((page) => page.sourcePageIndex)).toEqual([2, 0])
    expect(contentPages.map((page) => page.rotation)).toEqual([90, 0])
  })

  it('材料标题页作为材料起始页', () => {
    const material = createMaterialFixture({ insertTitlePage: true })
    const project = createProjectFixture({ outlineNodes: createOutlineFixture(material) })
    const plan = buildPagePlan(project)

    expect(plan.pages.find((page) => page.materialId === IDS.material)?.pageType).toBe(
      'materialTitle',
    )
    expect(plan.materialStartPages[IDS.material]).toBe(2)
  })

  it('按照参考模板把分级标题放到首张材料内容页', () => {
    const base = createProjectFixture()
    const outlineNodes = structuredClone(base.outlineNodes)
    const parent = outlineNodes[0]
    if (!parent) throw new Error('测试目录结构无效。')
    parent.insertDividerPage = false
    const plan = buildPagePlan(createProjectFixture({ outlineNodes }))
    const contentPages = plan.pages.filter((page) => page.pageType === 'pdfContent')

    expect(contentPages[0]?.inlineHeadings).toEqual([
      { level: 1, title: '论文成果', sequenceLabel: '一、', text: '一、论文成果' },
      { level: 2, title: '第一作者论文', sequenceLabel: '（一）', text: '（一） 第一作者论文' },
      { level: 3, title: '测试材料', sequenceLabel: '1.', text: '1. 测试材料' },
    ])
    expect(contentPages.slice(1).every((page) => page.inlineHeadings.length === 0)).toBe(true)
    expect(plan.outlineStartPages[IDS.level1]).toBe(1)
    expect(plan.tocEntries.map((entry) => entry.kind)).toEqual(['level1', 'level2', 'material'])
  })

  it('独立分类页不重复同级标题，并支持关闭同页标题', () => {
    const withDivider = buildPagePlan(createProjectFixture())
    const firstContent = withDivider.pages.find((page) => page.pageType === 'pdfContent')
    expect(firstContent?.inlineHeadings.map((heading) => heading.level)).toEqual([2, 3])

    const base = createProjectFixture()
    const withoutInline = createProjectFixture({
      exportSettings: {
        ...base.exportSettings,
        contentHeadingMode: 'none',
      },
    })
    expect(
      buildPagePlan(withoutInline).pages.every((page) => page.inlineHeadings.length === 0),
    ).toBe(true)
  })

  it('生成参考模板的破折号页码', () => {
    const base = createProjectFixture()
    const project = createProjectFixture({
      pageNumberSettings: {
        ...base.pageNumberSettings,
        format: 'dash',
      },
    })
    const firstBodyPage = buildPagePlan(project).pages.find(
      (page) => page.logicalPageNumber !== null,
    )
    expect(firstBodyPage?.printedPageLabel).toBe('— 1 —')
  })

  it('禁用目录或材料后从计划和目录中排除', () => {
    const disabledMaterial = createMaterialFixture({ enabled: false })
    const project = createProjectFixture({ outlineNodes: createOutlineFixture(disabledMaterial) })
    const plan = buildPagePlan(project)

    expect(plan.pages.some((page) => page.materialId === IDS.material)).toBe(false)
    expect(plan.tocEntries.some((entry) => entry.materialId === IDS.material)).toBe(false)
  })

  it('只为实际输出的目录编号，并在拖拽顺序变化后重新编号', () => {
    const firstRoot = createOutlineFixture()[0]
    const secondRoot = structuredClone(firstRoot)
    if (!firstRoot || !secondRoot?.children[0]) {
      throw new Error('测试目录结构无效。')
    }
    firstRoot.title = '论文成果'
    firstRoot.order = 1
    secondRoot.id = '00000000-0000-4000-8000-000000000012'
    secondRoot.title = '知识产权'
    secondRoot.order = 0
    secondRoot.children[0].id = '00000000-0000-4000-8000-000000000013'
    secondRoot.children[0].parentId = secondRoot.id
    secondRoot.children[0].materials[0] = createMaterialFixture({
      id: '00000000-0000-4000-8000-000000000014',
      outlineNodeId: secondRoot.children[0].id,
      title: '发明专利',
    })
    const emptyRoot = structuredClone(firstRoot)
    emptyRoot.id = '00000000-0000-4000-8000-000000000015'
    emptyRoot.title = '空目录'
    emptyRoot.order = -1
    emptyRoot.children = []

    const plan = buildPagePlan(
      createProjectFixture({ outlineNodes: [firstRoot, emptyRoot, secondRoot] }),
    )

    expect(plan.outlineSequenceLabels[emptyRoot.id]).toBeUndefined()
    expect(plan.outputOutlineNodeIds).not.toContain(emptyRoot.id)
    expect(plan.outlineSequenceLabels[secondRoot.id]).toBe('一、')
    expect(plan.outlineSequenceLabels[firstRoot.id]).toBe('二、')
    expect(
      plan.tocEntries.filter((entry) => entry.kind === 'level1').map((entry) => entry.title),
    ).toEqual(['知识产权', '论文成果'])
  })

  it('封面和目录计入页码时从正文起始值向前编号', () => {
    const base = createProjectFixture()
    const project = createProjectFixture({
      coverSettings: { ...base.coverSettings, countInLogicalNumber: true },
      tocSettings: { ...base.tocSettings, countInLogicalNumber: true },
      pageNumberSettings: { ...base.pageNumberSettings, bodyStartNumber: 3 },
    })
    const plan = buildPagePlan(project)

    expect(
      plan.pages
        .filter((page) => page.pageType !== 'blank')
        .slice(0, 3)
        .map((page) => page.logicalPageNumber?.value),
    ).toEqual([1, 2, 3])
    expect(plan.pages.find((page) => page.pageType === 'blank')?.logicalPageNumber).toBeNull()
    expect(plan.errors).toHaveLength(0)
  })

  it('阻止前置页面产生 0 或负数页码', () => {
    const base = createProjectFixture()
    const project = createProjectFixture({
      coverSettings: { ...base.coverSettings, countInLogicalNumber: true },
      tocSettings: { ...base.tocSettings, countInLogicalNumber: true },
      pageNumberSettings: { ...base.pageNumberSettings, bodyStartNumber: 1 },
    })
    const plan = buildPagePlan(project)
    expect(plan.errors.map((issue) => issue.code)).toContain('invalid-front-matter-numbering')
  })
})
