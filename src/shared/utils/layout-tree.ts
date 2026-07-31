import type {
  LayoutNode,
  LayoutSection,
  LayoutSheet,
  LayoutSlot,
  LayoutSplit,
  LayoutSplitDirection,
  LayoutTemplateId,
  NormalizedCropRect,
  Project,
  Rotation,
  TargetOrientation,
} from '../schemas/project-schema.js'

export const LAYOUT_RATIO_TOTAL = 10000
export const FULL_CROP_RECT: NormalizedCropRect = {
  x: 0,
  y: 0,
  width: LAYOUT_RATIO_TOTAL,
  height: LAYOUT_RATIO_TOTAL,
}

export type LayoutBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type LayoutSlotBounds = LayoutBounds & {
  slotId: string
}

const distributeRemainder = (weights: number[]): number[] => {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total === LAYOUT_RATIO_TOTAL) return weights
  const result = [...weights]
  let remainder = LAYOUT_RATIO_TOTAL - total
  let index = 0
  while (remainder !== 0 && result.length > 0) {
    const step = remainder > 0 ? 1 : -1
    const current = result[index]
    if (current === undefined) break
    if (current + step > 0) {
      result[index] = current + step
      remainder -= step
    }
    index = (index + 1) % result.length
  }
  return result
}

export const normalizeLayoutWeights = (
  count: number,
  preferredWeights?: readonly number[],
): number[] => {
  if (!Number.isInteger(count) || count < 1 || count > 24) {
    throw new Error('布局区域数量必须是 1 到 24 之间的整数。')
  }
  const candidates =
    preferredWeights?.length === count && preferredWeights.every((weight) => weight > 0)
      ? [...preferredWeights]
      : Array.from({ length: count }, () => 1)
  const total = candidates.reduce((sum, weight) => sum + weight, 0)
  const normalized = candidates.map((weight) =>
    Math.max(1, Math.floor((weight / total) * LAYOUT_RATIO_TOTAL)),
  )
  return distributeRemainder(normalized)
}

export const createLayoutSlot = (
  sourcePageId: string | null = null,
  options: Partial<
    Pick<
      LayoutSlot,
      'cropRect' | 'fit' | 'alignment' | 'rotation' | 'detailOf' | 'clarityRiskAcknowledged'
    >
  > = {},
): LayoutSlot => ({
  kind: 'slot',
  id: crypto.randomUUID(),
  sourcePageId,
  cropRect: options.cropRect ?? { ...FULL_CROP_RECT },
  fit: options.fit ?? 'contain',
  alignment: options.alignment ?? 'center',
  rotation: options.rotation ?? 0,
  detailOf: options.detailOf ?? null,
  clarityRiskAcknowledged: options.clarityRiskAcknowledged ?? false,
})

export const createLayoutSplit = (
  direction: LayoutSplitDirection,
  children: LayoutNode[],
  weights?: readonly number[],
): LayoutSplit => {
  if (children.length < 2 || children.length > 24) {
    throw new Error('一个分割区域必须包含 2 到 24 个子区域。')
  }
  return {
    kind: 'split',
    id: crypto.randomUUID(),
    direction,
    weights: normalizeLayoutWeights(children.length, weights),
    children,
  }
}

const chunk = <T>(values: readonly T[], size: number): T[][] => {
  const groups: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size))
  }
  return groups
}

export const createGridLayout = (
  sourcePageIds: readonly (string | null)[],
  columns: number,
): LayoutNode => {
  if (sourcePageIds.length === 0) return createLayoutSlot()
  if (sourcePageIds.length === 1) return createLayoutSlot(sourcePageIds[0] ?? null)
  const safeColumns = Math.max(1, Math.min(columns, sourcePageIds.length))
  const rows = chunk(sourcePageIds, safeColumns).map((row) => {
    const slots = row.map((sourcePageId) => createLayoutSlot(sourcePageId))
    const firstSlot = slots[0]
    if (!firstSlot) return createLayoutSlot()
    return slots.length === 1 ? firstSlot : createLayoutSplit('row', slots)
  })
  const firstRow = rows[0]
  if (!firstRow) return createLayoutSlot()
  return rows.length === 1 ? firstRow : createLayoutSplit('column', rows)
}

const createPrimaryWithAttachmentsLayout = (
  sourcePageIds: readonly (string | null)[],
): LayoutNode => {
  const [primary = null, ...attachments] = sourcePageIds
  if (attachments.length === 0) return createLayoutSlot(primary)
  const secondary = createGridLayout(attachments, Math.min(2, attachments.length))
  return createLayoutSplit('row', [createLayoutSlot(primary), secondary], [6200, 3800])
}

const createOriginalWithDetailLayout = (sourcePageIds: readonly (string | null)[]): LayoutNode => {
  const original = sourcePageIds[0] ?? null
  const detail = createLayoutSlot(original, {
    detailOf: original,
    fit: 'cover',
    cropRect: { x: 2500, y: 2500, width: 5000, height: 5000 },
  })
  return createLayoutSplit('row', [createLayoutSlot(original), detail], [6000, 4000])
}

export const createLayoutFromTemplate = (
  templateId: LayoutTemplateId,
  sourcePageIds: readonly (string | null)[],
): LayoutNode => {
  const maximum = templateId === 'certificate-2x3' || templateId === 'contact-sheet' ? 6 : 4
  const ids = sourcePageIds.slice(0, maximum)
  switch (templateId) {
    case 'two-up':
    case 'front-back':
      return createGridLayout(ids.slice(0, 2), 1)
    case 'four-up':
    case 'certificate-2x2':
      return createGridLayout(ids.slice(0, 4), 2)
    case 'certificate-2x3':
    case 'contact-sheet':
      return createGridLayout(ids.slice(0, 6), 2)
    case 'primary-with-attachments':
      return createPrimaryWithAttachmentsLayout(ids)
    case 'vertical-strips':
      return createGridLayout(ids, ids.length)
    case 'original-with-detail':
      return createOriginalWithDetailLayout(ids)
    case 'multi-material-sections':
      return createGridLayout(ids, Math.min(2, ids.length))
  }
}

export const flattenLayoutSlots = (node: LayoutNode): LayoutSlot[] =>
  node.kind === 'slot' ? [node] : node.children.flatMap(flattenLayoutSlots)

export const countLayoutSlots = (node: LayoutNode): number => flattenLayoutSlots(node).length

export const mapLayoutNode = (
  node: LayoutNode,
  mapper: (candidate: LayoutNode) => LayoutNode,
): LayoutNode => {
  const mapped =
    node.kind === 'split'
      ? {
          ...node,
          children: node.children.map((child) => mapLayoutNode(child, mapper)),
        }
      : node
  return mapper(mapped)
}

export const updateLayoutSlot = (
  node: LayoutNode,
  slotId: string,
  updater: (slot: LayoutSlot) => LayoutSlot,
): LayoutNode =>
  mapLayoutNode(node, (candidate) =>
    candidate.kind === 'slot' && candidate.id === slotId ? updater(candidate) : candidate,
  )

export const splitLayoutSlot = (
  node: LayoutNode,
  slotId: string,
  direction: LayoutSplitDirection,
): LayoutNode =>
  mapLayoutNode(node, (candidate) => {
    if (candidate.kind !== 'slot' || candidate.id !== slotId) return candidate
    return createLayoutSplit(direction, [candidate, createLayoutSlot()])
  })

export const duplicateLayoutSlotAsDetail = (
  node: LayoutNode,
  slotId: string,
  direction: LayoutSplitDirection = 'row',
): LayoutNode =>
  mapLayoutNode(node, (candidate) => {
    if (candidate.kind !== 'slot' || candidate.id !== slotId || candidate.sourcePageId === null) {
      return candidate
    }
    return createLayoutSplit(
      direction,
      [
        candidate,
        createLayoutSlot(candidate.sourcePageId, {
          detailOf: candidate.sourcePageId,
          fit: 'cover',
          cropRect: { x: 2500, y: 2500, width: 5000, height: 5000 },
          rotation: candidate.rotation,
        }),
      ],
      [6000, 4000],
    )
  })

export const swapLayoutSlotSources = (
  node: LayoutNode,
  firstSlotId: string,
  secondSlotId: string,
): LayoutNode => {
  const slots = flattenLayoutSlots(node)
  const first = slots.find((slot) => slot.id === firstSlotId)
  const second = slots.find((slot) => slot.id === secondSlotId)
  if (!first || !second) return node
  return mapLayoutNode(node, (candidate) => {
    if (candidate.kind !== 'slot') return candidate
    if (candidate.id === firstSlotId) {
      return {
        ...candidate,
        sourcePageId: second.sourcePageId,
        detailOf: second.detailOf,
      }
    }
    if (candidate.id === secondSlotId) {
      return {
        ...candidate,
        sourcePageId: first.sourcePageId,
        detailOf: first.detailOf,
      }
    }
    return candidate
  })
}

export const removeEmptyLayoutSlot = (node: LayoutNode, slotId: string): LayoutNode => {
  if (node.kind === 'slot') return node
  const candidateIndex = node.children.findIndex(
    (child) => child.kind === 'slot' && child.id === slotId && child.sourcePageId === null,
  )
  if (candidateIndex >= 0) {
    const children = node.children.filter((_, index) => index !== candidateIndex)
    const onlyChild = children[0]
    if (children.length === 1 && onlyChild) return onlyChild
    return {
      ...node,
      children,
      weights: normalizeLayoutWeights(
        children.length,
        node.weights.filter((_, index) => index !== candidateIndex),
      ),
    }
  }
  return {
    ...node,
    children: node.children.map((child) => removeEmptyLayoutSlot(child, slotId)),
  }
}

export const resizeLayoutSplit = (
  node: LayoutNode,
  splitId: string,
  dividerIndex: number,
  deltaRatio: number,
): LayoutNode =>
  mapLayoutNode(node, (candidate) => {
    if (
      candidate.kind !== 'split' ||
      candidate.id !== splitId ||
      dividerIndex < 0 ||
      dividerIndex >= candidate.weights.length - 1
    ) {
      return candidate
    }
    const weights = [...candidate.weights]
    const left = weights[dividerIndex]
    const right = weights[dividerIndex + 1]
    if (left === undefined || right === undefined) return candidate
    const boundedDelta = Math.max(-(left - 1), Math.min(right - 1, Math.round(deltaRatio)))
    weights[dividerIndex] = left + boundedDelta
    weights[dividerIndex + 1] = right - boundedDelta
    return { ...candidate, weights }
  })

export const calculateLayoutSlotBounds = (
  node: LayoutNode,
  bounds: LayoutBounds = { x: 0, y: 0, width: 1, height: 1 },
): LayoutSlotBounds[] => {
  if (node.kind === 'slot') return [{ ...bounds, slotId: node.id }]
  const total = node.weights.reduce((sum, weight) => sum + weight, 0)
  let offset = 0
  return node.children.flatMap((child, index) => {
    const ratio = (node.weights[index] ?? 0) / total
    const childBounds =
      node.direction === 'row'
        ? {
            x: bounds.x + bounds.width * offset,
            y: bounds.y,
            width: bounds.width * ratio,
            height: bounds.height,
          }
        : {
            x: bounds.x,
            y: bounds.y + bounds.height * offset,
            width: bounds.width,
            height: bounds.height * ratio,
          }
    offset += ratio
    return calculateLayoutSlotBounds(child, childBounds)
  })
}

export const createLayoutSection = (
  materialId: string,
  sourcePageIds: readonly (string | null)[],
  templateId: LayoutTemplateId,
  heightWeight = LAYOUT_RATIO_TOTAL,
): LayoutSection => ({
  id: crypto.randomUUID(),
  materialId,
  heightWeight,
  showContinuationTitle: true,
  layout: createLayoutFromTemplate(templateId, sourcePageIds),
})

export const createLayoutSheet = (input: {
  anchorSourcePageId: string
  sections: LayoutSection[]
  order: number
  orientation?: TargetOrientation
  templateId?: LayoutTemplateId | null
  project: Pick<Project, 'collageSettings'>
  crossDirectoryConfirmed?: boolean
  autoGenerated?: boolean
}): LayoutSheet => {
  const sectionWeights = normalizeLayoutWeights(input.sections.length)
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    order: input.order,
    anchorSourcePageId: input.anchorSourcePageId,
    orientation: input.orientation ?? input.project.collageSettings.defaultOrientation,
    margins: { ...input.project.collageSettings.defaultMargins },
    sectionGapPoints: input.project.collageSettings.defaultSectionGapPoints,
    slotGapPoints: input.project.collageSettings.defaultSlotGapPoints,
    locked: false,
    autoGenerated: input.autoGenerated ?? false,
    templateId: input.templateId ?? null,
    crossDirectoryConfirmed: input.crossDirectoryConfirmed ?? false,
    sections: input.sections.map((section, index) => ({
      ...section,
      heightWeight: sectionWeights[index] ?? 1,
    })),
    createdAt: now,
    updatedAt: now,
  }
}

export const layoutDigest = (sheet: LayoutSheet): string => {
  const serialized = JSON.stringify({
    orientation: sheet.orientation,
    margins: sheet.margins,
    sectionGapPoints: sheet.sectionGapPoints,
    slotGapPoints: sheet.slotGapPoints,
    sections: sheet.sections,
  })
  let hash = 2166136261
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export const rotateLayoutSlot = (
  node: LayoutNode,
  slotId: string,
  rotation: Rotation,
): LayoutNode => updateLayoutSlot(node, slotId, (slot) => ({ ...slot, rotation }))

/**
 * 将旋转后预览坐标中的裁切框还原到来源页面坐标。
 * 坐标均以左上角为原点，取值范围为 0..10000。
 */
export const unrotateCropRect = (
  cropRect: NormalizedCropRect,
  rotation: Rotation,
): NormalizedCropRect => {
  switch (rotation) {
    case 0:
      return { ...cropRect }
    case 90:
      return {
        x: cropRect.y,
        y: LAYOUT_RATIO_TOTAL - cropRect.x - cropRect.width,
        width: cropRect.height,
        height: cropRect.width,
      }
    case 180:
      return {
        x: LAYOUT_RATIO_TOTAL - cropRect.x - cropRect.width,
        y: LAYOUT_RATIO_TOTAL - cropRect.y - cropRect.height,
        width: cropRect.width,
        height: cropRect.height,
      }
    case 270:
      return {
        x: LAYOUT_RATIO_TOTAL - cropRect.y - cropRect.height,
        y: cropRect.x,
        width: cropRect.height,
        height: cropRect.width,
      }
  }
}
