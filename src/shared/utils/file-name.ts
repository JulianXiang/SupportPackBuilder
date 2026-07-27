const INVALID_FILE_NAME_CHARACTERS = '<>:"/\\|?*'
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export const sanitizeFileName = (name: string, fallback = '支撑材料'): string => {
  const cleaned = Array.from(name)
    .map((character) =>
      character.charCodeAt(0) <= 31 || INVALID_FILE_NAME_CHARACTERS.includes(character)
        ? '_'
        : character,
    )
    .join('')
    .replace(/[.\s]+$/g, '')
    .trim()
  if (!cleaned || WINDOWS_RESERVED_NAME.test(cleaned)) return fallback
  return cleaned.slice(0, 180)
}

export const ensurePdfExtension = (name: string): string =>
  name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`
