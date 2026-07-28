const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const

const formatBelowOneHundred = (value: number): string => {
  if (value < 10) return CHINESE_DIGITS[value] ?? String(value)
  const tens = Math.floor(value / 10)
  const ones = value % 10
  return `${tens === 1 ? '' : CHINESE_DIGITS[tens]}十${ones === 0 ? '' : CHINESE_DIGITS[ones]}`
}

export const formatChineseSequenceNumber = (value: number): string => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('中文序号必须是正整数。')
  }
  if (value < 100) return formatBelowOneHundred(value)
  if (value < 1_000) {
    const hundreds = Math.floor(value / 100)
    const remainder = value % 100
    if (remainder === 0) return `${CHINESE_DIGITS[hundreds]}百`
    if (remainder < 10) return `${CHINESE_DIGITS[hundreds]}百零${CHINESE_DIGITS[remainder]}`
    return `${CHINESE_DIGITS[hundreds]}百${formatBelowOneHundred(remainder)}`
  }
  return String(value)
}

export type SequenceLevel = 1 | 2 | 3

export const formatSequenceLabel = (level: SequenceLevel, index: number): string => {
  const position = index + 1
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('目录序号索引必须是非负整数。')
  }
  if (level === 1) return `${formatChineseSequenceNumber(position)}、`
  if (level === 2) return `（${formatChineseSequenceNumber(position)}）`
  return `${position}.`
}

const LEVEL_ONE_PREFIX = /^\s*(?:[一二三四五六七八九十百零〇]{1,8}|[0-9]{1,4})\s*[、.．]\s*/
const LEVEL_TWO_PREFIX =
  /^\s*(?:（|\()\s*(?:[一二三四五六七八九十百零〇]{1,8}|[0-9]{1,4})\s*(?:）|\))\s*[、.．]?\s*/
const MATERIAL_PREFIX = /^\s*[0-9]{1,5}\s*[.．、]\s*/

export const stripSequencePrefix = (title: string, level: SequenceLevel): string => {
  const pattern = level === 1 ? LEVEL_ONE_PREFIX : level === 2 ? LEVEL_TWO_PREFIX : MATERIAL_PREFIX
  const stripped = title.replace(pattern, '').trim()
  return stripped || title.trim()
}

export const formatSequencedTitle = (sequenceLabel: string, title: string): string =>
  sequenceLabel.endsWith('、') ? `${sequenceLabel}${title}` : `${sequenceLabel} ${title}`
