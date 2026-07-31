import { describe, expect, it } from 'vitest'
import {
  LayoutSheetSchema,
  createDefaultCollageSettings,
} from '../../src/shared/schemas/project-schema.js'
import {
  LAYOUT_RATIO_TOTAL,
  calculateLayoutSlotBounds,
  createLayoutFromTemplate,
  createLayoutSection,
  createLayoutSheet,
  createLayoutSlot,
  duplicateLayoutSlotAsDetail,
  flattenLayoutSlots,
  normalizeLayoutWeights,
  removeEmptyLayoutSlot,
  resizeLayoutSplit,
  splitLayoutSlot,
  swapLayoutSlotSources,
  unrotateCropRect,
} from '../../src/shared/utils/layout-tree.js'
import { removeMaterialsFromLayoutSheets } from '../../src/renderer/src/utils/project.js'
import {
  createMaterialFixture,
  createProjectFixture,
  createSourceFixture,
  IDS,
} from '../helpers/project-fixture.js'

const SOURCE_A = '00000000-0000-4000-8000-000000000101:0'
const SOURCE_B = '00000000-0000-4000-8000-000000000102:0'

describe('拼版布局树', () => {
  it('始终把整数比例规范到 10000 且不会出现零宽区域', () => {
    const weights = normalizeLayoutWeights(3)
    expect(weights).toHaveLength(3)
    expect(weights.reduce((sum, value) => sum + value, 0)).toBe(LAYOUT_RATIO_TOTAL)
    expect(weights.every((value) => value > 0)).toBe(true)
  })

  it('四宫格覆盖完整页面且槽位互不重叠', () => {
    const layout = createLayoutFromTemplate('four-up', [SOURCE_A, SOURCE_B, 'c:0', 'd:0'])
    const bounds = calculateLayoutSlotBounds(layout)

    expect(bounds).toHaveLength(4)
    expect(bounds.reduce((sum, item) => sum + item.width * item.height, 0)).toBeCloseTo(1)
    expect(bounds.every((item) => item.width > 0 && item.height > 0)).toBe(true)
  })

  it('支持分割、拖动比例、交换内容和移除空槽', () => {
    const original = createLayoutFromTemplate('two-up', [SOURCE_A, SOURCE_B])
    const firstSlot = flattenLayoutSlots(original)[0]
    if (!firstSlot || original.kind !== 'split') throw new Error('测试布局无效。')
    const split = splitLayoutSlot(original, firstSlot.id, 'row')
    const nested = flattenLayoutSlots(split)
    expect(nested).toHaveLength(3)

    const resized = resizeLayoutSplit(split, original.id, 0, 1_000)
    expect(resized.kind).toBe('split')
    if (resized.kind !== 'split') return
    expect(resized.weights).toEqual([6_000, 4_000])

    const firstNested = nested[0]
    const lastNested = nested[2]
    if (!firstNested || !lastNested) throw new Error('测试槽位数量无效。')
    const swapped = swapLayoutSlotSources(resized, firstNested.id, lastNested.id)
    expect(flattenLayoutSlots(swapped).map((slot) => slot.sourcePageId)).toEqual([
      SOURCE_B,
      null,
      SOURCE_A,
    ])
    const emptySlot = flattenLayoutSlots(swapped).find((slot) => slot.sourcePageId === null)
    expect(emptySlot).toBeDefined()
    if (!emptySlot) return
    expect(flattenLayoutSlots(removeEmptyLayoutSlot(swapped, emptySlot.id))).toHaveLength(2)
  })

  it('可以从原图槽创建可独立裁切的细节副本', () => {
    const original = createLayoutSlot(SOURCE_A)
    const layout = duplicateLayoutSlotAsDetail(original, original.id)
    const slots = flattenLayoutSlots(layout)
    expect(slots).toHaveLength(2)
    expect(slots[0]?.sourcePageId).toBe(SOURCE_A)
    expect(slots[1]).toMatchObject({
      sourcePageId: SOURCE_A,
      detailOf: SOURCE_A,
      fit: 'cover',
      cropRect: { x: 2500, y: 2500, width: 5000, height: 5000 },
    })
  })

  it('把旋转预览中的裁切框准确还原为来源坐标', () => {
    const crop = { x: 1_000, y: 2_000, width: 3_000, height: 4_000 }
    expect(unrotateCropRect(crop, 0)).toEqual(crop)
    expect(unrotateCropRect(crop, 90)).toEqual({
      x: 2_000,
      y: 6_000,
      width: 4_000,
      height: 3_000,
    })
    expect(unrotateCropRect(crop, 180)).toEqual({
      x: 6_000,
      y: 4_000,
      width: 3_000,
      height: 4_000,
    })
    expect(unrotateCropRect(crop, 270)).toEqual({
      x: 4_000,
      y: 1_000,
      width: 4_000,
      height: 3_000,
    })
  })

  it('完整拼版页可通过 Zod 校验并保存内部槽间距', () => {
    const section = createLayoutSection(
      '00000000-0000-4000-8000-000000000004',
      [SOURCE_A, SOURCE_B],
      'two-up',
    )
    const sheet = createLayoutSheet({
      anchorSourcePageId: SOURCE_A,
      sections: [section],
      order: 0,
      templateId: 'two-up',
      project: { collageSettings: createDefaultCollageSettings() },
    })

    expect(LayoutSheetSchema.parse(sheet).slotGapPoints).toBe(6)
  })

  it('删除成果时清理对应区段并重算剩余锚点和高度比例', () => {
    const project = createProjectFixture()
    const secondMaterialId = '00000000-0000-4000-8000-000000000106'
    const secondSourceId = '00000000-0000-4000-8000-000000000105'
    const secondMaterial = createMaterialFixture({
      id: secondMaterialId,
      title: '第二项成果',
      order: 1,
      sourcePath: '/tmp/second.pdf',
      storedPath: 'assets/second.pdf',
      originalFileName: 'second.pdf',
      sourceItems: [
        createSourceFixture({
          id: secondSourceId,
          sourcePath: '/tmp/second.pdf',
          storedPath: 'assets/second.pdf',
          originalFileName: 'second.pdf',
        }),
      ],
    })
    project.outlineNodes[0]?.children[0]?.materials.push(secondMaterial)
    const sections = [
      createLayoutSection(IDS.material, [`${IDS.source}:0`], 'two-up'),
      createLayoutSection(secondMaterialId, [`${secondSourceId}:0`], 'two-up'),
    ]
    project.layoutSheets = [
      createLayoutSheet({
        anchorSourcePageId: `${IDS.source}:0`,
        sections,
        order: 3,
        templateId: 'multi-material-sections',
        project,
      }),
    ]

    removeMaterialsFromLayoutSheets(project, [IDS.material])

    expect(project.layoutSheets).toHaveLength(1)
    expect(project.layoutSheets[0]).toMatchObject({
      order: 0,
      anchorSourcePageId: `${secondSourceId}:0`,
      sections: [{ materialId: secondMaterialId, heightWeight: 10000 }],
    })
  })
})
