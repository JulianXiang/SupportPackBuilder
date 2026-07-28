import { describe, expect, it } from 'vitest'
import {
  PREVIEW_SCROLLBAR_MIN_THUMB_HEIGHT,
  calculatePreviewScrollbarMetrics,
  calculatePreviewScrollbarThumbTop,
  calculatePreviewScrollTopFromDrag,
} from '../../src/renderer/src/features/preview/preview-scrollbar.js'

describe('页面预览滚动条', () => {
  it('内容未超出可视区时隐藏', () => {
    expect(
      calculatePreviewScrollbarMetrics({
        clientHeight: 600,
        scrollHeight: 600,
        trackHeight: 580,
      }),
    ).toEqual({
      visible: false,
      maxScrollTop: 0,
      thumbHeight: 580,
      maxThumbTop: 0,
    })
  })

  it('按照可视区域和内容高度计算滑块比例', () => {
    expect(
      calculatePreviewScrollbarMetrics({
        clientHeight: 500,
        scrollHeight: 2000,
        trackHeight: 480,
      }),
    ).toEqual({
      visible: true,
      maxScrollTop: 1500,
      thumbHeight: 120,
      maxThumbTop: 360,
    })
  })

  it('大量页面时保持 36 像素最小滑块高度', () => {
    const metrics = calculatePreviewScrollbarMetrics({
      clientHeight: 100,
      scrollHeight: 10_000,
      trackHeight: 400,
    })

    expect(metrics.thumbHeight).toBe(PREVIEW_SCROLLBAR_MIN_THUMB_HEIGHT)
    expect(metrics.maxThumbTop).toBe(400 - PREVIEW_SCROLLBAR_MIN_THUMB_HEIGHT)
  })

  it('把滚动位置映射为轨道中的滑块位置并限制边界', () => {
    const metrics = calculatePreviewScrollbarMetrics({
      clientHeight: 500,
      scrollHeight: 2000,
      trackHeight: 480,
    })

    expect(calculatePreviewScrollbarThumbTop({ ...metrics, scrollTop: 750 })).toBe(180)
    expect(calculatePreviewScrollbarThumbTop({ ...metrics, scrollTop: -100 })).toBe(0)
    expect(calculatePreviewScrollbarThumbTop({ ...metrics, scrollTop: 5000 })).toBe(360)
  })

  it('把滑块拖动距离映射为滚动位置并限制首尾', () => {
    const metrics = calculatePreviewScrollbarMetrics({
      clientHeight: 500,
      scrollHeight: 2000,
      trackHeight: 480,
    })

    expect(
      calculatePreviewScrollTopFromDrag({
        ...metrics,
        startScrollTop: 500,
        deltaY: 180,
      }),
    ).toBe(1250)
    expect(
      calculatePreviewScrollTopFromDrag({
        ...metrics,
        startScrollTop: 500,
        deltaY: -240,
      }),
    ).toBe(0)
    expect(
      calculatePreviewScrollTopFromDrag({
        ...metrics,
        startScrollTop: 1400,
        deltaY: 180,
      }),
    ).toBe(1500)
  })
})
