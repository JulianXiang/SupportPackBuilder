import { describe, expect, it } from 'vitest'
import { A4_SIZE_POINTS, DEFAULT_PAGE_MARGINS_POINTS } from '../../src/shared/constants/document.js'
import {
  calculateA4Placement,
  combineRotations,
  isWithinA4ContentBounds,
} from '../../src/shared/utils/a4-layout.js'

describe('A4 页面布局', () => {
  it.each([
    ['A4 纵向', A4_SIZE_POINTS.width, A4_SIZE_POINTS.height, 0],
    ['A4 横向', A4_SIZE_POINTS.height, A4_SIZE_POINTS.width, 0],
    ['超宽页面', 2000, 300, 0],
    ['超高页面', 300, 2000, 0],
    ['小尺寸证书', 240, 180, 0],
    ['90 度旋转', 595, 842, 90],
    ['180 度旋转', 595, 842, 180],
    ['270 度旋转', 595, 842, 270],
  ] as const)('%s 保持比例且不超出 A4', (_name, width, height, rotation) => {
    const placement = calculateA4Placement({
      sourceWidth: width,
      sourceHeight: height,
      rotation,
    })
    expect(placement.scale).toBeGreaterThan(0)
    expect(isWithinA4ContentBounds(placement)).toBe(true)
    expect(placement.drawX).toBeGreaterThanOrEqual(DEFAULT_PAGE_MARGINS_POINTS.left)
    expect(placement.drawY).toBeGreaterThanOrEqual(DEFAULT_PAGE_MARGINS_POINTS.bottom)
    expect(placement.drawX + placement.drawWidth).toBeLessThanOrEqual(
      A4_SIZE_POINTS.width - DEFAULT_PAGE_MARGINS_POINTS.right + 0.001,
    )
    expect(placement.drawY + placement.drawHeight).toBeLessThanOrEqual(
      A4_SIZE_POINTS.height - DEFAULT_PAGE_MARGINS_POINTS.top + 0.001,
    )
  })

  it('页边距为正文和底部页码预留空间', () => {
    const placement = calculateA4Placement({
      sourceWidth: A4_SIZE_POINTS.width,
      sourceHeight: A4_SIZE_POINTS.height,
      rotation: 0,
    })
    expect(placement.availableWidth).toBeCloseTo(
      A4_SIZE_POINTS.width - DEFAULT_PAGE_MARGINS_POINTS.left - DEFAULT_PAGE_MARGINS_POINTS.right,
      4,
    )
    expect(placement.availableHeight).toBeCloseTo(
      A4_SIZE_POINTS.height - DEFAULT_PAGE_MARGINS_POINTS.top - DEFAULT_PAGE_MARGINS_POINTS.bottom,
      4,
    )
  })

  it('正确合并来源旋转和用户旋转', () => {
    expect(combineRotations(90, 270)).toBe(0)
    expect(combineRotations(270, 180)).toBe(90)
  })

  it('拒绝无效尺寸和过大页边距', () => {
    expect(() => calculateA4Placement({ sourceWidth: 0, sourceHeight: 100, rotation: 0 })).toThrow(
      '来源页面尺寸必须大于 0',
    )
    expect(() =>
      calculateA4Placement({
        sourceWidth: 100,
        sourceHeight: 100,
        rotation: 0,
        margins: { top: 500, right: 500, bottom: 500, left: 500 },
      }),
    ).toThrow('页边距过大')
  })
})
