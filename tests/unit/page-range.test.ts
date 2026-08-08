import { describe, expect, it } from 'vitest'
import { MAX_PAGE_RANGE_EXPRESSION_LENGTH } from '../../src/shared/constants/document.js'
import {
  formatPageRange,
  normalizePageRange,
  parsePageRange,
} from '../../src/shared/utils/page-range.js'

describe('parsePageRange', () => {
  it.each([
    ['1', 10, [1]],
    ['1-3', 10, [1, 2, 3]],
    ['1,3,5', 10, [1, 3, 5]],
    ['1-3,6,8-10', 10, [1, 2, 3, 6, 8, 9, 10]],
    ['all', 4, [1, 2, 3, 4]],
    ['ALL', 2, [1, 2]],
  ])('解析有效表达式 %s', (expression, totalPages, expected) => {
    expect(parsePageRange(expression, totalPages)).toMatchObject({
      success: true,
      pages: expected,
    })
  })

  it('移除多余空格并产生警告', () => {
    const result = parsePageRange(' 1 - 3 , 5 ', 5)
    expect(result).toMatchObject({ success: true, pages: [1, 2, 3, 5] })
    expect(result.warnings.map((warning) => warning.code)).toContain('extra-whitespace')
  })

  it('对重复页码去重并产生警告', () => {
    const result = parsePageRange('1-3,2,3', 3)
    expect(result).toMatchObject({ success: true, pages: [1, 2, 3] })
    expect(result.warnings.map((warning) => warning.code)).toContain('duplicate-page')
  })

  it.each([
    ['', 'empty'],
    ['1，2', 'chinese-comma'],
    ['1,,2', 'empty-segment'],
    ['0', 'zero'],
    ['-1', 'negative'],
    ['10-8', 'reverse-range'],
    ['11', 'out-of-range'],
    ['abc', 'invalid-character'],
    ['1-', 'incomplete-range'],
    ['1.5', 'invalid-character'],
  ])('拒绝无效表达式 %s', (expression, code) => {
    const result = parsePageRange(expression, 10)
    expect(result.success).toBe(false)
    expect(result.errors[0]?.code).toBe(code)
  })

  it('拒绝超长表达式', () => {
    const result = parsePageRange('1'.repeat(MAX_PAGE_RANGE_EXPRESSION_LENGTH + 1), 10)
    expect(result.success).toBe(false)
    expect(result.errors[0]?.code).toBe('too-long')
  })

  it('把等价页码集合规范为紧凑表达式且不改变有效页面', () => {
    const expression = ' 1 - 3, 2, 5, 7 - 9, 8 '
    const before = parsePageRange(expression, 10)
    const normalized = normalizePageRange(expression, 10)
    const after = normalized ? parsePageRange(normalized, 10) : null

    expect(normalized).toBe('1-3,5,7-9')
    expect(after?.pages).toEqual(before.pages)
    expect(formatPageRange([3, 2, 1, 2], 3)).toBe('all')
  })

  it('无效页码表达式不会被自动改写', () => {
    expect(normalizePageRange('3-1', 3)).toBeNull()
  })
})
