export const POINTS_PER_INCH = 72
export const MILLIMETERS_PER_INCH = 25.4
export const POINTS_PER_MILLIMETER = POINTS_PER_INCH / MILLIMETERS_PER_INCH

export const A4_SIZE_MM = {
  width: 210,
  height: 297,
} as const

export const A4_SIZE_POINTS = {
  width: A4_SIZE_MM.width * POINTS_PER_MILLIMETER,
  height: A4_SIZE_MM.height * POINTS_PER_MILLIMETER,
} as const

export const DEFAULT_PAGE_MARGINS_POINTS = {
  top: 36,
  right: 36,
  bottom: 36,
  left: 36,
} as const

export const DEFAULT_PAGE_NUMBER_BOTTOM_OFFSET_POINTS = 28
export const A4_SIZE_TOLERANCE_POINTS = 0.5

export const TEMPLATE_INLINE_HEADING_STYLES = {
  1: {
    fontSize: 22,
    lineHeight: 30,
    gapAfter: 9,
  },
  2: {
    fontSize: 13,
    lineHeight: 19,
    gapAfter: 5,
  },
  3: {
    fontSize: 11.5,
    lineHeight: 17,
    gapAfter: 7,
  },
} as const

export const IMAGE_QUALITY_PRESETS = {
  screen: {
    label: '适合屏幕',
    dpi: 120,
    jpegQuality: 78,
    description: '文件较小，适合电子查阅；不会主动放大低分辨率图片。',
  },
  standard: {
    label: '标准',
    dpi: 180,
    jpegQuality: 88,
    description: '兼顾打印清晰度与文件大小，建议用于日常申报材料。',
  },
  high: {
    label: '高质量',
    dpi: 300,
    jpegQuality: 94,
    description: '适合精细打印，文件更大且导出耗时更长。',
  },
} as const

export const THUMBNAIL_CACHE_VERSION = 1
export const PREVIEW_CACHE_VERSION = 1
export const MAX_PAGE_RANGE_EXPRESSION_LENGTH = 4096
export const MAX_TOC_ITERATIONS = 5

export const OFFICE_CONVERSION_TIMEOUT_MILLISECONDS = 180_000
export const OOXML_MAX_ENTRY_COUNT = 10_000
export const OOXML_MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
export const OOXML_MAX_COMPRESSION_RATIO = 200
