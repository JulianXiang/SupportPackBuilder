import { describe, expect, it } from 'vitest'
import { wrapTextByWidth } from '../../src/shared/utils/text-layout.js'

describe('中文标题换行', () => {
  it('按实际测量宽度换行且不丢失字符', () => {
    const lines = wrapTextByWidth('遥感变化描述论文支撑材料', 5, (text) => Array.from(text).length)
    expect(lines).toEqual(['遥感变化描', '述论文支撑', '材料'])
    expect(lines.join('')).toBe('遥感变化描述论文支撑材料')
  })

  it('处理空白、Unicode 字符和无效宽度', () => {
    expect(wrapTextByWidth('  A😀B  ', 2, (text) => Array.from(text).length)).toEqual(['A😀', 'B'])
    expect(wrapTextByWidth('   ', 2, (text) => text.length)).toEqual([])
    expect(() => wrapTextByWidth('标题', 0, (text) => text.length)).toThrow(
      '文本排版宽度必须大于 0',
    )
  })
})
