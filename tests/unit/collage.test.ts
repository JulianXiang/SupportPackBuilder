import { describe, expect, it } from 'vitest'
import {
  assessLayoutClarity,
  calculatePaperSavings,
} from '../../src/shared/utils/collage-metrics.js'
import { suggestCollage } from '../../src/shared/utils/collage-suggestion.js'
import { flattenLayoutSlots } from '../../src/shared/utils/layout-tree.js'
import { createProjectFixture, IDS } from '../helpers/project-fixture.js'

describe('拼版建议与清晰度', () => {
  it('按实际物理尺寸计算图片有效 DPI 和警告', () => {
    const assessment = assessLayoutClarity({
      sourceKind: 'image',
      sourceWidth: 2_480,
      sourceHeight: 3_508,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      orientation: 'portrait',
      rasterPreferredDpi: 180,
      rasterMinimumAutoDpi: 150,
      pdfWarningScale: 0.6,
      pdfMinimumAutoScale: 0.5,
    })

    expect(assessment.metric).toBeGreaterThan(290)
    expect(assessment.level).toBe('good')
  })

  it('低于自动阈值时阻止自动建议，但允许用户明确确认', () => {
    const assessment = assessLayoutClarity({
      sourceKind: 'pdf',
      sourceWidth: 595,
      sourceHeight: 842,
      bounds: { x: 0, y: 0, width: 0.36, height: 0.36 },
      orientation: 'portrait',
      rasterPreferredDpi: 180,
      rasterMinimumAutoDpi: 150,
      pdfWarningScale: 0.6,
      pdfMinimumAutoScale: 0.5,
    })

    expect(assessment.level).toBe('blocked')
  })

  it('自动建议默认不跨成果，显式确认后采用全宽成果区段', () => {
    const project = createProjectFixture()
    const pages = [
      {
        sourcePageId: `${IDS.source}:0`,
        materialId: IDS.material,
        outlineNodeId: IDS.level2,
        sourceKind: 'pdf' as const,
      },
      {
        sourcePageId: '00000000-0000-4000-8000-000000000105:0',
        materialId: '00000000-0000-4000-8000-000000000106',
        outlineNodeId: IDS.level2,
        sourceKind: 'image' as const,
      },
    ]

    expect(() =>
      suggestCollage({
        pages,
        project,
        existingSheetCount: 0,
        allowCrossMaterial: false,
        crossDirectoryConfirmed: false,
      }),
    ).toThrow('默认不跨成果')
    const suggestion = suggestCollage({
      pages,
      project,
      existingSheetCount: 0,
      allowCrossMaterial: true,
      crossDirectoryConfirmed: false,
    })
    expect(suggestion.sheets[0]?.sections).toHaveLength(2)
    expect(suggestion.sheets[0]?.templateId).toBe('multi-material-sections')
  })

  it('报告节省的物理页与纸张比例', () => {
    expect(calculatePaperSavings(10, 4)).toEqual({
      savedPages: 6,
      savedPercent: 60,
      originalSheetsDuplex: 5,
      composedSheetsDuplex: 2,
    })
  })

  it('跨成果超过单区段容量时自动分页且不静默遗漏来源页', () => {
    const project = createProjectFixture()
    const secondMaterialId = '00000000-0000-4000-8000-000000000106'
    const pages = [
      ...Array.from({ length: 10 }, (_, index) => ({
        sourcePageId: `${IDS.source}:${index}`,
        materialId: IDS.material,
        outlineNodeId: IDS.level2,
        sourceKind: 'pdf' as const,
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        sourcePageId: `00000000-0000-4000-8000-000000000105:${index}`,
        materialId: secondMaterialId,
        outlineNodeId: IDS.level2,
        sourceKind: 'image' as const,
      })),
    ]
    const suggestion = suggestCollage({
      pages,
      project,
      existingSheetCount: 0,
      allowCrossMaterial: true,
      crossDirectoryConfirmed: false,
    })
    const plannedSourceIds = suggestion.sheets.flatMap((sheet) =>
      sheet.sections.flatMap((section) =>
        flattenLayoutSlots(section.layout)
          .map((slot) => slot.sourcePageId)
          .filter((sourcePageId): sourcePageId is string => sourcePageId !== null),
      ),
    )
    expect(plannedSourceIds).toEqual(pages.map((page) => page.sourcePageId))
    expect(suggestion.sheets.length).toBeGreaterThan(1)
    expect(
      suggestion.sheets.every((sheet) =>
        sheet.sections.every((section) => flattenLayoutSlots(section.layout).length <= 6),
      ),
    ).toBe(true)
  })
})
