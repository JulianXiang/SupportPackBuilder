export const wrapTextByWidth = (
  value: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] => {
  const text = value.trim()
  if (!text) return []
  if (maxWidth <= 0) throw new Error('文本排版宽度必须大于 0。')

  const lines: string[] = []
  let current = ''
  for (const character of Array.from(text)) {
    const candidate = `${current}${character}`
    if (current && measure(candidate) > maxWidth) {
      lines.push(current.trimEnd())
      current = character.trimStart()
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current.trimEnd())
  return lines
}
