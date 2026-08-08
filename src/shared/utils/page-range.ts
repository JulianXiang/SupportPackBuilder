import { MAX_PAGE_RANGE_EXPRESSION_LENGTH } from '../constants/document.js'

export type PageRangeWarning = {
  code: 'extra-whitespace' | 'duplicate-page'
  message: string
}

export type PageRangeError = {
  code:
    | 'empty'
    | 'too-long'
    | 'chinese-comma'
    | 'invalid-character'
    | 'empty-segment'
    | 'negative'
    | 'zero'
    | 'incomplete-range'
    | 'reverse-range'
    | 'out-of-range'
    | 'not-integer'
  message: string
}

export type PageRangeParseResult =
  | {
      success: true
      pages: number[]
      warnings: PageRangeWarning[]
      errors: []
    }
  | {
      success: false
      pages: []
      warnings: PageRangeWarning[]
      errors: PageRangeError[]
    }

const errorResult = (
  error: PageRangeError,
  warnings: PageRangeWarning[] = [],
): PageRangeParseResult => ({
  success: false,
  pages: [],
  warnings,
  errors: [error],
})

export const parsePageRange = (expression: string, totalPages: number): PageRangeParseResult => {
  const warnings: PageRangeWarning[] = []
  if (expression.length > MAX_PAGE_RANGE_EXPRESSION_LENGTH) {
    return errorResult({
      code: 'too-long',
      message: `页码表达式不能超过 ${MAX_PAGE_RANGE_EXPRESSION_LENGTH} 个字符。`,
    })
  }

  if (expression.includes('，')) {
    return errorResult({
      code: 'chinese-comma',
      message: '页码表达式不能使用中文逗号，请改用英文逗号“,”。',
    })
  }

  if (/\s/.test(expression)) {
    warnings.push({
      code: 'extra-whitespace',
      message: '页码表达式中的多余空格已自动移除。',
    })
  }

  const normalized = expression.replace(/\s/g, '')
  if (normalized.length === 0) {
    return errorResult(
      {
        code: 'empty',
        message: '页码表达式不能为空。',
      },
      warnings,
    )
  }

  if (!Number.isInteger(totalPages) || totalPages <= 0) {
    return errorResult(
      {
        code: 'out-of-range',
        message: '材料页数无效，无法解析页码范围。',
      },
      warnings,
    )
  }

  if (normalized.toLowerCase() === 'all') {
    return {
      success: true,
      pages: Array.from({ length: totalPages }, (_, index) => index + 1),
      warnings,
      errors: [],
    }
  }

  if (/^-|,-|--/.test(normalized)) {
    return errorResult(
      {
        code: 'negative',
        message: '页码不能为负数。',
      },
      warnings,
    )
  }

  if (/[^0-9,-]/.test(normalized)) {
    return errorResult(
      {
        code: 'invalid-character',
        message: '页码表达式包含非法字符，只允许数字、英文逗号和连字符。',
      },
      warnings,
    )
  }

  const segments = normalized.split(',')
  if (segments.some((segment) => segment.length === 0)) {
    return errorResult(
      {
        code: 'empty-segment',
        message: '页码表达式中存在连续逗号或缺少页码。',
      },
      warnings,
    )
  }

  const pages: number[] = []
  const seen = new Set<number>()
  const parseState = { hasDuplicate: false }

  const addPage = (page: number): PageRangeError | null => {
    if (!Number.isInteger(page)) {
      return {
        code: 'not-integer',
        message: '页码必须是整数。',
      }
    }
    if (page === 0) {
      return {
        code: 'zero',
        message: '页码从 1 开始，不能为 0。',
      }
    }
    if (page > totalPages) {
      return {
        code: 'out-of-range',
        message: `页码 ${page} 超出材料总页数 ${totalPages}。`,
      }
    }
    if (seen.has(page)) {
      parseState.hasDuplicate = true
    } else {
      seen.add(page)
      pages.push(page)
    }
    return null
  }

  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      const pageError = addPage(Number(segment))
      if (pageError) return errorResult(pageError, warnings)
      continue
    }

    const rangeMatch = /^(\d+)-(\d+)$/.exec(segment)
    if (!rangeMatch) {
      return errorResult(
        {
          code: 'incomplete-range',
          message: `区间“${segment}”不完整，应写成“起始页-结束页”。`,
        },
        warnings,
      )
    }

    const start = Number(rangeMatch[1])
    const end = Number(rangeMatch[2])
    if (start === 0 || end === 0) {
      return errorResult(
        {
          code: 'zero',
          message: '页码从 1 开始，不能为 0。',
        },
        warnings,
      )
    }
    if (start > end) {
      return errorResult(
        {
          code: 'reverse-range',
          message: `区间“${segment}”为倒序区间，请确认后重新输入。`,
        },
        warnings,
      )
    }
    if (end > totalPages) {
      return errorResult(
        {
          code: 'out-of-range',
          message: `页码 ${end} 超出材料总页数 ${totalPages}。`,
        },
        warnings,
      )
    }
    for (let page = start; page <= end; page += 1) {
      const pageError = addPage(page)
      if (pageError) return errorResult(pageError, warnings)
    }
  }

  if (parseState.hasDuplicate) {
    warnings.push({
      code: 'duplicate-page',
      message: '重复页码已自动去重。',
    })
  }

  pages.sort((left, right) => left - right)
  return {
    success: true,
    pages,
    warnings,
    errors: [],
  }
}

export const formatPageRange = (pages: readonly number[], totalPages: number): string => {
  const normalized = [...new Set(pages)].sort((left, right) => left - right)
  if (
    totalPages > 0 &&
    normalized.length === totalPages &&
    normalized.every((page, index) => page === index + 1)
  ) {
    return 'all'
  }
  const segments: string[] = []
  let start: number | undefined
  let previous: number | undefined
  const flush = (): void => {
    if (start === undefined || previous === undefined) return
    segments.push(start === previous ? String(start) : `${start}-${previous}`)
  }
  normalized.forEach((page) => {
    if (start === undefined) {
      start = page
      previous = page
      return
    }
    if (previous !== undefined && page === previous + 1) {
      previous = page
      return
    }
    flush()
    start = page
    previous = page
  })
  flush()
  return segments.join(',')
}

export const normalizePageRange = (expression: string, totalPages: number): string | null => {
  const parsed = parsePageRange(expression, totalPages)
  return parsed.success ? formatPageRange(parsed.pages, totalPages) : null
}
