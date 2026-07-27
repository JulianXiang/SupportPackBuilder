import { A4_SIZE_POINTS, DEFAULT_PAGE_MARGINS_POINTS } from '../constants/document.js'
import type { Rotation, TargetOrientation } from '../schemas/project-schema.js'

export type PageMargins = {
  top: number
  right: number
  bottom: number
  left: number
}

export type A4Placement = {
  targetWidth: number
  targetHeight: number
  availableWidth: number
  availableHeight: number
  effectiveSourceWidth: number
  effectiveSourceHeight: number
  scale: number
  drawX: number
  drawY: number
  drawWidth: number
  drawHeight: number
  rotation: Rotation
  matrix: [number, number, number, number, number, number]
}

export const normalizeRotation = (value: number): Rotation => {
  const normalized = ((value % 360) + 360) % 360
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized
  }
  throw new Error(`旋转角度必须是 0、90、180 或 270 度，收到：${value}`)
}

export const combineRotations = (sourceRotation: number, userRotation: number): Rotation =>
  normalizeRotation(sourceRotation + userRotation)

export const calculateA4Placement = (input: {
  sourceWidth: number
  sourceHeight: number
  rotation: Rotation
  orientation?: TargetOrientation
  margins?: PageMargins
}): A4Placement => {
  if (input.sourceWidth <= 0 || input.sourceHeight <= 0) {
    throw new Error('来源页面尺寸必须大于 0。')
  }

  const orientation = input.orientation ?? 'portrait'
  const margins = input.margins ?? DEFAULT_PAGE_MARGINS_POINTS
  const targetWidth = orientation === 'portrait' ? A4_SIZE_POINTS.width : A4_SIZE_POINTS.height
  const targetHeight = orientation === 'portrait' ? A4_SIZE_POINTS.height : A4_SIZE_POINTS.width
  const availableWidth = targetWidth - margins.left - margins.right
  const availableHeight = targetHeight - margins.top - margins.bottom

  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new Error('页边距过大，A4 页面没有可用内容区域。')
  }

  const quarterTurn = input.rotation === 90 || input.rotation === 270
  const effectiveSourceWidth = quarterTurn ? input.sourceHeight : input.sourceWidth
  const effectiveSourceHeight = quarterTurn ? input.sourceWidth : input.sourceHeight
  const scale = Math.min(
    availableWidth / effectiveSourceWidth,
    availableHeight / effectiveSourceHeight,
  )
  const drawWidth = effectiveSourceWidth * scale
  const drawHeight = effectiveSourceHeight * scale
  const drawX = margins.left + (availableWidth - drawWidth) / 2
  const drawY = margins.bottom + (availableHeight - drawHeight) / 2

  let matrix: A4Placement['matrix']
  switch (input.rotation) {
    case 0:
      matrix = [scale, 0, 0, scale, drawX, drawY]
      break
    case 90:
      matrix = [0, scale, -scale, 0, drawX + input.sourceHeight * scale, drawY]
      break
    case 180:
      matrix = [
        -scale,
        0,
        0,
        -scale,
        drawX + input.sourceWidth * scale,
        drawY + input.sourceHeight * scale,
      ]
      break
    case 270:
      matrix = [0, -scale, scale, 0, drawX, drawY + input.sourceWidth * scale]
      break
  }

  return {
    targetWidth,
    targetHeight,
    availableWidth,
    availableHeight,
    effectiveSourceWidth,
    effectiveSourceHeight,
    scale,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
    rotation: input.rotation,
    matrix,
  }
}

export const isWithinA4ContentBounds = (placement: A4Placement, tolerance = 0.001): boolean =>
  placement.drawX >= -tolerance &&
  placement.drawY >= -tolerance &&
  placement.drawX + placement.drawWidth <= placement.targetWidth + tolerance &&
  placement.drawY + placement.drawHeight <= placement.targetHeight + tolerance
