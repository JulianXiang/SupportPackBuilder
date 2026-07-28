export const PREVIEW_SCROLLBAR_MIN_THUMB_HEIGHT = 36

export type PreviewScrollbarMetrics = {
  visible: boolean
  maxScrollTop: number
  thumbHeight: number
  maxThumbTop: number
}

type PreviewScrollbarMetricsInput = {
  clientHeight: number
  scrollHeight: number
  trackHeight: number
  minThumbHeight?: number
}

type PreviewScrollbarPositionInput = PreviewScrollbarMetrics & {
  scrollTop: number
}

type PreviewScrollbarDragInput = PreviewScrollbarMetrics & {
  startScrollTop: number
  deltaY: number
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum)

const finiteNonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0

export const calculatePreviewScrollbarMetrics = (
  input: PreviewScrollbarMetricsInput,
): PreviewScrollbarMetrics => {
  const clientHeight = finiteNonNegative(input.clientHeight)
  const scrollHeight = finiteNonNegative(input.scrollHeight)
  const trackHeight = finiteNonNegative(input.trackHeight)
  const minimumThumbHeight = finiteNonNegative(
    input.minThumbHeight ?? PREVIEW_SCROLLBAR_MIN_THUMB_HEIGHT,
  )
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)

  if (clientHeight === 0 || trackHeight === 0 || maxScrollTop <= 1) {
    return {
      visible: false,
      maxScrollTop,
      thumbHeight: trackHeight,
      maxThumbTop: 0,
    }
  }

  const proportionalHeight = trackHeight * (clientHeight / scrollHeight)
  const thumbHeight = clamp(Math.max(minimumThumbHeight, proportionalHeight), 0, trackHeight)

  return {
    visible: true,
    maxScrollTop,
    thumbHeight,
    maxThumbTop: Math.max(0, trackHeight - thumbHeight),
  }
}

export const calculatePreviewScrollbarThumbTop = (input: PreviewScrollbarPositionInput): number => {
  if (!input.visible || input.maxScrollTop <= 0 || input.maxThumbTop <= 0) return 0
  const scrollTop = clamp(finiteNonNegative(input.scrollTop), 0, input.maxScrollTop)
  return (scrollTop / input.maxScrollTop) * input.maxThumbTop
}

export const calculatePreviewScrollTopFromDrag = (input: PreviewScrollbarDragInput): number => {
  if (!input.visible || input.maxScrollTop <= 0 || input.maxThumbTop <= 0) return 0
  const startScrollTop = clamp(finiteNonNegative(input.startScrollTop), 0, input.maxScrollTop)
  const deltaY = Number.isFinite(input.deltaY) ? input.deltaY : 0
  return clamp(
    startScrollTop + (deltaY / input.maxThumbTop) * input.maxScrollTop,
    0,
    input.maxScrollTop,
  )
}
