import type {
  CompositePagePlan,
  PagePlan,
  PlannedContentItem,
  PlannedPage,
  PlannedSection,
  TocEntry,
  ValidationIssue,
} from '../schemas/page-plan-schema.js'
import type {
  LayoutSheet,
  Material,
  MaterialSource,
  OutlineNode,
  Project,
  Rotation,
  ValidationStatus,
} from '../schemas/project-schema.js'
import { A4_SIZE_POINTS } from '../constants/document.js'
import { assessLayoutClarity, calculateCompositeSlotBounds } from './collage-metrics.js'
import { flattenLayoutSlots, layoutDigest } from './layout-tree.js'
import { parsePageRange } from './page-range.js'
import { formatSequenceLabel, formatSequencedTitle } from './sequence-label.js'

const sortByOrder = <T extends { order: number; id: string }>(values: readonly T[]): T[] =>
  [...values].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))

const stableHash = (input: string): string => {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const sourcePageId = (sourceId: string, pageIndex: number): string => `${sourceId}:${pageIndex}`

const pageNumberLabel = (
  value: number,
  finalLogicalPage: number,
  format: Project['pageNumberSettings']['format'],
): string => {
  switch (format) {
    case 'number':
      return String(value)
    case 'dash':
      return `— ${value} —`
    case 'chinese':
      return `第 ${value} 页`
    case 'fraction':
      return `${value} / ${finalLogicalPage}`
  }
}

export type SelectedSourcePage = {
  sourceId: string
  sourceFile: string
  pageIndex: number
  sourcePageId: string
  rotation: Rotation
  pageType: 'pdfContent' | 'imageContent'
  sourceKind: 'pdf' | 'image'
}

type SelectedSourcePages = {
  pages: SelectedSourcePage[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

type MaterialContext = {
  root: OutlineNode
  child: OutlineNode
  material: Material
  selected: SelectedSourcePages
}

type LayoutResolution = {
  sheetByAnchorPageId: Map<string, LayoutSheet>
  consumedPageIds: Set<string>
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

const issue = (
  material: Material,
  code: string,
  severity: ValidationIssue['severity'],
  message: string,
): ValidationIssue => ({
  code,
  severity,
  message,
  outlineNodeId: material.outlineNodeId,
  materialId: material.id,
})

const projectIssue = (
  code: string,
  severity: ValidationIssue['severity'],
  message: string,
  outlineNodeId: string | null = null,
  materialId: string | null = null,
): ValidationIssue => ({
  code,
  severity,
  message,
  outlineNodeId,
  materialId,
})

const sourcePageRange = (material: Material, source: MaterialSource): string =>
  material.sourceItems.length === 1 ? material.selectedPageRanges : source.selectedPageRanges

/**
 * 返回材料实际参与输出的来源页面。该函数是普通页面、拼版建议、PagePlan 与导出的共同选页入口。
 */
export const getSelectedSourcePages = (material: Material): SelectedSourcePages => {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const candidates: SelectedSourcePage[] = []

  for (const source of material.sourceItems) {
    if (source.sourceType === 'image') {
      const id = sourcePageId(source.id, 0)
      candidates.push({
        sourceId: source.id,
        sourceFile: source.storedPath ?? source.sourcePath,
        pageIndex: 0,
        sourcePageId: id,
        rotation: material.rotationByPage[id] ?? 0,
        pageType: 'imageContent',
        sourceKind: 'image',
      })
      continue
    }

    const conversion = source.sourceType === 'office' ? source.conversion : undefined
    if (source.sourceType === 'office' && !conversion) {
      errors.push(
        issue(
          material,
          'office-snapshot-missing',
          'error',
          `Office 来源《${source.originalFileName}》缺少 PDF 转换快照，请重新转换后再导出。`,
        ),
      )
      continue
    }
    if (conversion?.snapshotStatus === 'error') {
      errors.push(
        issue(
          material,
          'office-snapshot-error',
          'error',
          `Office 来源《${source.originalFileName}》的转换快照不可用，请重新转换。`,
        ),
      )
    } else if (conversion?.snapshotStatus === 'stale') {
      warnings.push(
        issue(
          material,
          'office-snapshot-stale',
          'warning',
          `Office 来源《${source.originalFileName}》的原件已变化，当前仍使用上一次转换快照。`,
        ),
      )
    }

    const pageCount = conversion?.pageCount ?? source.pageCount
    const parsed = parsePageRange(sourcePageRange(material, source), pageCount)
    if (!parsed.success) {
      errors.push(
        ...parsed.errors.map((error) =>
          issue(
            material,
            `page-range-${error.code}`,
            'error',
            `来源《${source.originalFileName}》：${error.message}`,
          ),
        ),
      )
      continue
    }
    warnings.push(
      ...parsed.warnings.map((warning) =>
        issue(
          material,
          `page-range-${warning.code}`,
          'warning',
          `来源《${source.originalFileName}》：${warning.message}`,
        ),
      ),
    )
    parsed.pages.forEach((page) => {
      const pageIndex = page - 1
      const id = sourcePageId(source.id, pageIndex)
      candidates.push({
        sourceId: source.id,
        sourceFile: conversion?.pdfStoredPath ?? source.storedPath ?? source.sourcePath,
        pageIndex,
        sourcePageId: id,
        rotation: material.rotationByPage[id] ?? 0,
        pageType: 'pdfContent',
        sourceKind: 'pdf',
      })
    })
  }

  if (material.sourceItems.length === 0) {
    errors.push(
      issue(material, 'missing-source', 'error', `材料“${material.title}”缺少来源文件记录。`),
    )
  }

  const byId = new Map(candidates.map((candidate) => [candidate.sourcePageId, candidate]))
  const ordered: SelectedSourcePage[] = []
  const used = new Set<string>()
  material.pageOrder.forEach((id) => {
    const candidate = byId.get(id)
    if (candidate && !used.has(id)) {
      ordered.push(candidate)
      used.add(id)
    }
  })
  candidates.forEach((candidate) => {
    if (!used.has(candidate.sourcePageId)) ordered.push(candidate)
  })
  const removed = new Set(material.removedPages)
  return {
    pages: ordered.filter((candidate) => !removed.has(candidate.sourcePageId)),
    errors,
    warnings,
  }
}

const statusRank: Record<ValidationStatus, number> = {
  valid: 0,
  warning: 1,
  unsupported: 2,
  encrypted: 3,
  missing: 4,
  error: 5,
}

const worstStatus = (statuses: readonly ValidationStatus[]): ValidationStatus =>
  statuses.reduce<ValidationStatus>(
    (worst, candidate) => (statusRank[candidate] > statusRank[worst] ? candidate : worst),
    'valid',
  )

const resolveLayoutSheets = (
  project: Project,
  contexts: readonly MaterialContext[],
): LayoutResolution => {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  if (!project.collageSettings.enabled) {
    if (project.layoutSheets.length > 0) {
      warnings.push(
        projectIssue(
          'layout-disabled',
          'warning',
          '项目已关闭多图拼版，现有拼版配置暂不参与预览和导出。',
        ),
      )
    }
    return {
      sheetByAnchorPageId: new Map(),
      consumedPageIds: new Set(),
      errors,
      warnings,
    }
  }
  const pageOwner = new Map<
    string,
    { context: MaterialContext; page: SelectedSourcePage; canonicalIndex: number }
  >()
  let canonicalIndex = 0
  contexts.forEach((context) => {
    context.selected.pages.forEach((page) => {
      pageOwner.set(page.sourcePageId, { context, page, canonicalIndex })
      canonicalIndex += 1
    })
  })

  const consumedPageIds = new Set<string>()
  const sheetByAnchorPageId = new Map<string, LayoutSheet>()
  for (const sheet of sortByOrder(project.layoutSheets)) {
    const missingMaterialSections = sheet.sections.filter(
      (section) => !contexts.some((context) => context.material.id === section.materialId),
    )
    if (missingMaterialSections.length > 0) {
      errors.push(
        projectIssue(
          'layout-section-material-missing',
          'error',
          `拼版页引用了 ${missingMaterialSections.length} 项已删除、禁用或不再输出的成果，请删除对应区段或恢复成果。`,
        ),
      )
    }
    const slots = sheet.sections.flatMap((section) => flattenLayoutSlots(section.layout))
    const populatedSlots = slots.filter(
      (slot): slot is typeof slot & { sourcePageId: string } => slot.sourcePageId !== null,
    )
    if (populatedSlots.length === 0) {
      warnings.push(
        projectIssue(
          'layout-sheet-empty',
          'warning',
          `拼版页“${sheet.id.slice(0, 8)}”没有放入任何来源页面，不会参与输出。`,
        ),
      )
      continue
    }
    if (slots.length > project.collageSettings.maxManualSlotsPerSheet) {
      errors.push(
        projectIssue(
          'layout-slot-limit',
          'error',
          `拼版页包含 ${slots.length} 个内容槽，超过手动拼版上限 ${project.collageSettings.maxManualSlotsPerSheet}。`,
        ),
      )
    }
    if (slots.some((slot) => slot.sourcePageId === null)) {
      warnings.push(
        projectIssue('layout-empty-slot', 'warning', '拼版页包含空内容槽；空槽会保留为空白区域。'),
      )
    }

    const owners = populatedSlots.map((slot) => ({
      slot,
      owner: pageOwner.get(slot.sourcePageId),
    }))
    const missing = owners.filter((entry) => !entry.owner)
    if (missing.length > 0) {
      errors.push(
        projectIssue(
          'layout-source-page-missing',
          'error',
          `拼版页引用了 ${missing.length} 个已删除、禁用或不存在的来源页面，请修复后再导出。`,
        ),
      )
    }

    const slotsBySourceId = new Map<string, typeof populatedSlots>()
    populatedSlots.forEach((slot) => {
      const group = slotsBySourceId.get(slot.sourcePageId) ?? []
      group.push(slot)
      slotsBySourceId.set(slot.sourcePageId, group)
    })
    const hasInvalidDuplicate = [...slotsBySourceId.entries()].some(
      ([id, group]) =>
        group.length > 1 &&
        (group.filter((slot) => slot.detailOf === null).length !== 1 ||
          group.some((slot) => slot.detailOf !== null && slot.detailOf !== id)),
    )
    if (hasInvalidDuplicate) {
      errors.push(
        projectIssue(
          'layout-source-duplicate',
          'error',
          '同一来源页面只能通过“原图与细节”副本重复出现，普通内容槽不得重复。',
        ),
      )
    }

    const validOwners = owners.filter(
      (
        entry,
      ): entry is {
        slot: (typeof populatedSlots)[number]
        owner: NonNullable<(typeof entry)['owner']>
      } => entry.owner !== undefined,
    )
    for (const [sectionIndex, section] of sheet.sections.entries()) {
      const sectionContext = contexts.find((context) => context.material.id === section.materialId)
      if (!sectionContext) continue
      const sectionSlots = flattenLayoutSlots(section.layout)
      const bounds = calculateCompositeSlotBounds(sheet, sectionIndex, true)
      sectionSlots.forEach((slot, slotIndex) => {
        if (!slot.sourcePageId) return
        const owner = pageOwner.get(slot.sourcePageId)
        const bound = bounds[slotIndex]
        if (!owner || !bound) return
        const source = owner.context.material.sourceItems.find(
          (candidate) => candidate.id === owner.page.sourceId,
        )
        const sourceWidth =
          owner.page.sourceKind === 'image'
            ? (source?.width ?? A4_SIZE_POINTS.width)
            : A4_SIZE_POINTS.width
        const sourceHeight =
          owner.page.sourceKind === 'image'
            ? (source?.height ?? A4_SIZE_POINTS.height)
            : A4_SIZE_POINTS.height
        const combinedRotation = (owner.page.rotation + slot.rotation) % 360
        const cropWidth = sourceWidth * (slot.cropRect.width / 10000)
        const cropHeight = sourceHeight * (slot.cropRect.height / 10000)
        const quarterTurn = combinedRotation === 90 || combinedRotation === 270
        const assessment = assessLayoutClarity({
          sourceKind: owner.page.sourceKind,
          sourceWidth: quarterTurn ? cropHeight : cropWidth,
          sourceHeight: quarterTurn ? cropWidth : cropHeight,
          bounds: bound,
          orientation: sheet.orientation,
          fit: slot.fit,
          rasterPreferredDpi: project.collageSettings.rasterPreferredDpi,
          rasterMinimumAutoDpi: project.collageSettings.rasterMinimumAutoDpi,
          pdfWarningScale: project.collageSettings.pdfWarningScale,
          pdfMinimumAutoScale: project.collageSettings.pdfMinimumAutoScale,
        })
        if (assessment.level === 'blocked') {
          if (sheet.autoGenerated || !slot.clarityRiskAcknowledged) {
            errors.push(
              issue(
                owner.context.material,
                'layout-clarity-blocked',
                'error',
                `拼版内容“${owner.context.material.title}”预计仅为 ${assessment.metricLabel}，低于清晰度下限。请减少槽位、调整为横向，或在手动检查后明确确认风险。`,
              ),
            )
          } else {
            warnings.push(
              issue(
                owner.context.material,
                'layout-clarity-acknowledged',
                'warning',
                `拼版内容“${owner.context.material.title}”预计仅为 ${assessment.metricLabel}，已由用户确认清晰度风险。`,
              ),
            )
          }
        } else if (assessment.level === 'warning') {
          warnings.push(
            issue(
              owner.context.material,
              'layout-clarity-warning',
              'warning',
              `拼版内容“${owner.context.material.title}”预计为 ${assessment.metricLabel}，建议在导出前放大检查可读性。`,
            ),
          )
        }
      })
    }
    const uniqueOwners = [
      ...new Map(validOwners.map((entry) => [entry.slot.sourcePageId, entry.owner])).values(),
    ].sort((left, right) => left.canonicalIndex - right.canonicalIndex)
    const canonicalIndexes = uniqueOwners.map((entry) => entry.canonicalIndex)
    const contiguous = canonicalIndexes.every((index, position, values) => {
      const previous = values[position - 1]
      return position === 0 || (previous !== undefined && index === previous + 1)
    })
    if (!contiguous) {
      errors.push(
        projectIssue(
          'layout-order-conflict',
          'error',
          '拼版页选择的页面在目录顺序中不连续。为避免静默改变材料顺序，请拆分拼版页或先调整材料页面顺序。',
        ),
      )
    }
    const placementOwners = uniqueOwners.filter(
      (entry) => !consumedPageIds.has(entry.page.sourcePageId),
    )
    if (placementOwners.length !== uniqueOwners.length) {
      errors.push(
        projectIssue(
          'layout-page-used-by-multiple-sheets',
          'error',
          '同一来源页面被多个拼版页引用，请保留其中一个位置。',
        ),
      )
    }

    const materialOrder = [...new Set(uniqueOwners.map((entry) => entry.context.material.id))]
    const sectionOrder = sheet.sections.map((section) => section.materialId)
    if (
      materialOrder.length !== sectionOrder.length ||
      materialOrder.some((materialId, index) => materialId !== sectionOrder[index])
    ) {
      errors.push(
        projectIssue(
          'layout-section-order-conflict',
          'error',
          '跨成果拼版区段顺序与左侧目录顺序不一致。系统不会静默重排，请在拼版工作台中修复。',
        ),
      )
    }

    const outlineIds = new Set(uniqueOwners.map((entry) => entry.context.child.id))
    if (outlineIds.size > 1 && !sheet.crossDirectoryConfirmed) {
      errors.push(
        projectIssue(
          'layout-cross-directory-unconfirmed',
          'error',
          '该拼版页跨越多个二级目录，必须明确确认成果归属后才能导出。',
        ),
      )
    }
    const laterContexts = uniqueOwners
      .map((entry) => entry.context)
      .filter(
        (context, index, values) =>
          index > 0 &&
          values.findIndex((candidate) => candidate.material.id === context.material.id) === index,
      )
    if (
      laterContexts.some(
        ({ material }) =>
          material.insertTitlePage && project.exportSettings.includeMaterialTitlePages,
      )
    ) {
      errors.push(
        projectIssue(
          'layout-material-title-conflict',
          'error',
          '跨成果拼版与后续成果的独立材料标题页发生顺序冲突。请关闭该标题页，或将成果拆到不同物理页。',
        ),
      )
    }
    if (
      laterContexts.some(
        ({ root, child }) =>
          (root.insertDividerPage || child.insertDividerPage) &&
          project.exportSettings.includeDividerPages,
      )
    ) {
      errors.push(
        projectIssue(
          'layout-divider-conflict',
          'error',
          '跨目录拼版与后续分类标题页发生顺序冲突。请关闭冲突标题页，或将成果拆到不同物理页。',
        ),
      )
    }

    const earliest = placementOwners[0]
    if (!earliest) continue
    if (sheet.anchorSourcePageId !== earliest.page.sourcePageId) {
      errors.push(
        projectIssue(
          'layout-anchor-conflict',
          'error',
          '拼版页锚点不再是目录顺序中的第一个来源页面，请在拼版工作台中执行“修复顺序”。',
        ),
      )
    }
    if (sheetByAnchorPageId.has(earliest.page.sourcePageId)) {
      errors.push(
        projectIssue(
          'layout-anchor-used-by-multiple-sheets',
          'error',
          '多个拼版页试图占用同一目录位置，请调整来源页面。',
        ),
      )
      continue
    }
    placementOwners.forEach((entry) => consumedPageIds.add(entry.page.sourcePageId))
    sheetByAnchorPageId.set(earliest.page.sourcePageId, sheet)
  }

  return { sheetByAnchorPageId, consumedPageIds, errors, warnings }
}

type PlanBuildOptions = {
  tocPageCount?: number
  revision?: number
}

export const buildPagePlan = (project: Project, options: PlanBuildOptions = {}): PagePlan => {
  const tocPageCount =
    project.tocSettings.enabled && project.exportSettings.includeToc
      ? Math.max(1, options.tocPageCount ?? 1)
      : 0
  const revision = options.revision ?? 0
  const pages: PlannedPage[] = []
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const selectedPagesByMaterial = new Map<string, SelectedSourcePages>()
  const contextByMaterialId = new Map<string, MaterialContext>()
  const contextBySourcePageId = new Map<
    string,
    { context: MaterialContext; page: SelectedSourcePage }
  >()
  const outputMaterialIds = new Set<string>()
  const outputOutlineNodeIds = new Set<string>()
  const outlineSequenceLabels: Record<string, string> = {}
  const materialSequenceLabels: Record<string, string> = {}
  const renderedInlineNodeHeadings = new Set<string>()
  const renderedMaterialContent = new Set<string>()
  const sortedRoots = sortByOrder(project.outlineNodes)
  const contexts: MaterialContext[] = []

  for (const root of sortedRoots) {
    if (!root.enabled) continue
    for (const child of sortByOrder(root.children)) {
      if (!child.enabled) continue
      for (const material of sortByOrder(child.materials)) {
        if (!material.enabled) continue
        const selected = getSelectedSourcePages(material)
        const context = { root, child, material, selected }
        contexts.push(context)
        contextByMaterialId.set(material.id, context)
        selected.pages.forEach((page) =>
          contextBySourcePageId.set(page.sourcePageId, { context, page }),
        )
        selectedPagesByMaterial.set(material.id, selected)
        errors.push(...selected.errors)
        warnings.push(...selected.warnings)
        const hasTitlePage =
          material.insertTitlePage && project.exportSettings.includeMaterialTitlePages
        if (selected.pages.length === 0 && !hasTitlePage) {
          errors.push(
            issue(
              material,
              'material-no-output-pages',
              'error',
              `启用材料“${material.title}”没有可输出页面。请恢复页面、修复来源文件，或禁用该材料。`,
            ),
          )
        }
        if (selected.pages.length > 0 || hasTitlePage) {
          outputMaterialIds.add(material.id)
          outputOutlineNodeIds.add(child.id)
          outputOutlineNodeIds.add(root.id)
        }
      }
    }
  }

  let rootSequenceIndex = 0
  for (const root of sortedRoots) {
    if (!outputOutlineNodeIds.has(root.id)) continue
    outlineSequenceLabels[root.id] = formatSequenceLabel(1, rootSequenceIndex)
    rootSequenceIndex += 1
    let childSequenceIndex = 0
    for (const child of sortByOrder(root.children)) {
      if (!outputOutlineNodeIds.has(child.id)) continue
      outlineSequenceLabels[child.id] = formatSequenceLabel(2, childSequenceIndex)
      childSequenceIndex += 1
      let materialSequenceIndex = 0
      for (const material of sortByOrder(child.materials)) {
        if (!outputMaterialIds.has(material.id)) continue
        materialSequenceLabels[material.id] = formatSequenceLabel(3, materialSequenceIndex)
        materialSequenceIndex += 1
      }
    }
  }

  const layoutResolution = resolveLayoutSheets(project, contexts)
  errors.push(...layoutResolution.errors)
  warnings.push(...layoutResolution.warnings)

  const pushPage = (
    page: Omit<PlannedPage, 'physicalIndex' | 'logicalPageNumber' | 'printedPageLabel'>,
  ): void => {
    pages.push({
      ...page,
      physicalIndex: pages.length,
      logicalPageNumber: null,
      printedPageLabel: null,
    })
  }

  const generatedPageBase = {
    outlineNodeIds: [] as string[],
    materialIds: [] as string[],
    sourceId: null,
    sourceFile: null,
    sourcePageIndex: null,
    sourcePageId: null,
    inlineHeadings: [],
    rotation: 0 as const,
    composite: null,
  }

  if (project.coverSettings.enabled && project.exportSettings.includeCover) {
    pushPage({
      ...generatedPageBase,
      id: 'cover:0',
      pageType: 'cover',
      outlineNodeId: null,
      materialId: null,
      displayTitle: project.coverSettings.title,
      sequenceLabel: null,
      showPageNumber:
        project.pageNumberSettings.enabled &&
        project.exportSettings.addPageNumbers &&
        project.coverSettings.countInLogicalNumber &&
        project.coverSettings.showPageNumber,
      targetOrientation: project.exportSettings.targetOrientation,
      validationStatus: 'valid',
    })
    if (project.coverSettings.insertBlankBackPage) {
      pushPage({
        ...generatedPageBase,
        id: 'blank:cover-back',
        pageType: 'blank',
        outlineNodeId: null,
        materialId: null,
        displayTitle: '封面背面空白页',
        sequenceLabel: null,
        showPageNumber: false,
        targetOrientation: project.exportSettings.targetOrientation,
        validationStatus: 'valid',
      })
    }
  }

  for (let index = 0; index < tocPageCount; index += 1) {
    pushPage({
      ...generatedPageBase,
      id: `toc:${index}`,
      pageType: 'toc',
      outlineNodeId: null,
      materialId: null,
      displayTitle: `${project.tocSettings.title}${tocPageCount > 1 ? `（${index + 1}）` : ''}`,
      sequenceLabel: null,
      showPageNumber:
        project.pageNumberSettings.enabled &&
        project.exportSettings.addPageNumbers &&
        project.tocSettings.countInLogicalNumber &&
        project.tocSettings.showPageNumber,
      targetOrientation: project.exportSettings.targetOrientation,
      validationStatus: 'valid',
    })
  }

  const pushDivider = (node: OutlineNode): void => {
    if (!node.insertDividerPage || !project.exportSettings.includeDividerPages) return
    pushPage({
      ...generatedPageBase,
      id: `divider:${node.id}`,
      pageType: 'divider',
      outlineNodeId: node.id,
      outlineNodeIds: [node.id],
      materialId: null,
      displayTitle: node.title,
      sequenceLabel: outlineSequenceLabels[node.id] ?? null,
      showPageNumber:
        project.pageNumberSettings.enabled &&
        project.exportSettings.addPageNumbers &&
        project.pageNumberSettings.showOnDivider,
      targetOrientation: project.exportSettings.targetOrientation,
      validationStatus: 'valid',
    })
  }

  const createSectionHeading = (
    context: MaterialContext,
    sourcePageIdValue: string,
  ): PlannedPage['inlineHeadings'] => {
    if (project.exportSettings.contentHeadingMode !== 'firstPage') return []
    const headings: PlannedPage['inlineHeadings'] = []
    for (const headingNode of [context.root, context.child]) {
      const hasStandaloneDivider =
        headingNode.insertDividerPage && project.exportSettings.includeDividerPages
      if (!hasStandaloneDivider && !renderedInlineNodeHeadings.has(headingNode.id)) {
        const sequenceLabel = outlineSequenceLabels[headingNode.id] ?? ''
        headings.push({
          level: headingNode.level,
          title: headingNode.title,
          sequenceLabel,
          text: formatSequencedTitle(sequenceLabel, headingNode.title),
        })
        renderedInlineNodeHeadings.add(headingNode.id)
      }
    }
    const hasStandaloneMaterialTitle =
      context.material.insertTitlePage && project.exportSettings.includeMaterialTitlePages
    if (!hasStandaloneMaterialTitle && !renderedMaterialContent.has(context.material.id)) {
      const sequenceLabel = materialSequenceLabels[context.material.id] ?? ''
      headings.push({
        level: 3,
        title: context.material.title,
        sequenceLabel,
        text: formatSequencedTitle(sequenceLabel, context.material.title),
      })
    }
    renderedMaterialContent.add(context.material.id)
    void sourcePageIdValue
    return headings
  }

  const createCompositePlan = (sheet: LayoutSheet): CompositePagePlan => {
    const contentItems: PlannedContentItem[] = []
    const sections = sheet.sections.flatMap((section) => {
      const context = contextByMaterialId.get(section.materialId)
      if (!context) return []
      const slots = flattenLayoutSlots(section.layout)
      slots.forEach((slot) => {
        if (!slot.sourcePageId) return
        const entry = contextBySourcePageId.get(slot.sourcePageId)
        if (!entry) return
        contentItems.push({
          slotId: slot.id,
          materialId: entry.context.material.id,
          outlineNodeId: entry.context.child.id,
          sourceId: entry.page.sourceId,
          sourceFile: entry.page.sourceFile,
          sourcePageIndex: entry.page.pageIndex,
          sourcePageId: entry.page.sourcePageId,
          sourceKind: entry.page.sourceKind,
          sourceRotation: entry.page.rotation,
          slotRotation: slot.rotation,
          cropRect: slot.cropRect,
          fit: slot.fit,
          alignment: slot.alignment,
          detailOf: slot.detailOf,
          clarityRiskAcknowledged: slot.clarityRiskAcknowledged,
        })
      })
      const alreadyRendered = renderedMaterialContent.has(context.material.id)
      return [
        {
          id: section.id,
          materialId: section.materialId,
          outlineNodeId: context.child.id,
          materialTitle: context.material.title,
          sequenceLabel: materialSequenceLabels[context.material.id] ?? '',
          heightWeight: section.heightWeight,
          showContinuationTitle: section.showContinuationTitle,
          isContinuation: alreadyRendered,
          layout: section.layout,
        },
      ]
    })
    return {
      layoutSheetId: sheet.id,
      layoutDigest: layoutDigest(sheet),
      margins: sheet.margins,
      sectionGapPoints: sheet.sectionGapPoints,
      slotGapPoints: sheet.slotGapPoints,
      locked: sheet.locked,
      autoGenerated: sheet.autoGenerated,
      sections,
      contentItems,
    }
  }

  const pushCompositePage = (sheet: LayoutSheet): void => {
    const composite = createCompositePlan(sheet)
    const materialIds = composite.sections.map((section) => section.materialId)
    const outlineNodeIds = [...new Set(composite.sections.map((section) => section.outlineNodeId))]
    const firstMaterialId = materialIds[0]
    if (!firstMaterialId) return
    const firstContext = contextByMaterialId.get(firstMaterialId)
    if (!firstContext) return
    const inlineHeadings = composite.sections.flatMap((section) => {
      const context = contextByMaterialId.get(section.materialId)
      return context
        ? createSectionHeading(context, sheet.anchorSourcePageId).filter(
            (heading) => heading.level < 3,
          )
        : []
    })
    pushPage({
      id: `composite:${sheet.id}`,
      pageType: 'compositeContent',
      outlineNodeId: outlineNodeIds.length === 1 ? (outlineNodeIds[0] ?? null) : null,
      materialId: materialIds.length === 1 ? firstMaterialId : null,
      outlineNodeIds,
      materialIds,
      sourceId: null,
      sourceFile: null,
      sourcePageIndex: null,
      sourcePageId: sheet.anchorSourcePageId,
      displayTitle:
        materialIds.length === 1
          ? firstContext.material.title
          : `多成果拼版（${materialIds.length} 项成果）`,
      sequenceLabel:
        materialIds.length === 1 ? (materialSequenceLabels[firstMaterialId] ?? null) : null,
      inlineHeadings,
      showPageNumber: project.pageNumberSettings.enabled && project.exportSettings.addPageNumbers,
      rotation: 0,
      targetOrientation: sheet.orientation,
      validationStatus: worstStatus(
        materialIds.map(
          (materialId) => contextByMaterialId.get(materialId)?.material.validationStatus ?? 'error',
        ),
      ),
      composite,
    })
    materialIds.forEach((materialId) => renderedMaterialContent.add(materialId))
  }

  for (const root of sortedRoots) {
    if (!outputOutlineNodeIds.has(root.id)) continue
    pushDivider(root)
    for (const child of sortByOrder(root.children)) {
      if (!outputOutlineNodeIds.has(child.id)) continue
      pushDivider(child)
      for (const material of sortByOrder(child.materials)) {
        if (!outputMaterialIds.has(material.id)) continue
        const materialSequence = materialSequenceLabels[material.id] ?? ''
        if (material.insertTitlePage && project.exportSettings.includeMaterialTitlePages) {
          pushPage({
            ...generatedPageBase,
            id: `material-title:${material.id}`,
            pageType: 'materialTitle',
            outlineNodeId: child.id,
            outlineNodeIds: [child.id],
            materialId: material.id,
            materialIds: [material.id],
            displayTitle: material.title,
            sequenceLabel: materialSequence || null,
            showPageNumber:
              project.pageNumberSettings.enabled &&
              project.exportSettings.addPageNumbers &&
              project.pageNumberSettings.showOnMaterialTitle,
            targetOrientation: project.exportSettings.targetOrientation,
            validationStatus: material.validationStatus,
          })
        }

        const selected = selectedPagesByMaterial.get(material.id)
        const materialContext = contextByMaterialId.get(material.id)
        if (!materialContext) continue
        selected?.pages.forEach((sourcePage) => {
          const sheet = layoutResolution.sheetByAnchorPageId.get(sourcePage.sourcePageId)
          if (sheet) {
            pushCompositePage(sheet)
            return
          }
          if (layoutResolution.consumedPageIds.has(sourcePage.sourcePageId)) return
          const inlineHeadings = createSectionHeading(materialContext, sourcePage.sourcePageId)
          pushPage({
            id: `content:${material.id}:${sourcePage.sourcePageId}`,
            pageType: sourcePage.pageType,
            outlineNodeId: child.id,
            materialId: material.id,
            outlineNodeIds: [child.id],
            materialIds: [material.id],
            sourceId: sourcePage.sourceId,
            sourceFile: sourcePage.sourceFile,
            sourcePageIndex: sourcePage.pageIndex,
            sourcePageId: sourcePage.sourcePageId,
            displayTitle: material.title,
            sequenceLabel: materialSequence || null,
            inlineHeadings,
            showPageNumber:
              project.pageNumberSettings.enabled && project.exportSettings.addPageNumbers,
            rotation: sourcePage.rotation,
            targetOrientation: project.exportSettings.targetOrientation,
            validationStatus: material.validationStatus,
            composite: null,
          })
        })
      }
    }
  }

  const frontMatterCount = pages.filter((page) => {
    if (page.pageType === 'cover') return project.coverSettings.countInLogicalNumber
    if (page.pageType === 'blank') return false
    if (page.pageType === 'toc') return project.tocSettings.countInLogicalNumber
    return false
  }).length
  const firstFrontMatterNumber = project.pageNumberSettings.bodyStartNumber - frontMatterCount
  if (frontMatterCount > 0 && firstFrontMatterNumber <= 0) {
    errors.push(
      projectIssue(
        'invalid-front-matter-numbering',
        'error',
        '封面或目录计入逻辑页码后会产生 0 或负数页码。请提高正文起始页码，或关闭前置页面计数。',
      ),
    )
  }

  let frontLogical = Math.max(1, firstFrontMatterNumber)
  let bodyLogical = project.pageNumberSettings.bodyStartNumber
  const numberedPages = pages.map((page): PlannedPage => {
    let logicalValue: number | null = null
    if (page.pageType === 'cover') {
      if (project.coverSettings.countInLogicalNumber) {
        logicalValue = frontLogical
        frontLogical += 1
      }
    } else if (page.pageType === 'blank') {
      logicalValue = null
    } else if (page.pageType === 'toc') {
      if (project.tocSettings.countInLogicalNumber) {
        logicalValue = frontLogical
        frontLogical += 1
      }
    } else {
      logicalValue = bodyLogical
      bodyLogical += 1
    }
    return {
      ...page,
      logicalPageNumber: logicalValue
        ? {
            value: logicalValue,
            label: String(logicalValue),
          }
        : null,
    }
  })

  const finalLogicalPage = Math.max(
    0,
    ...numberedPages.map((page) => page.logicalPageNumber?.value ?? 0),
  )
  numberedPages.forEach((page, index) => {
    const logicalValue = page.logicalPageNumber?.value
    numberedPages[index] = {
      ...page,
      printedPageLabel:
        page.showPageNumber && logicalValue
          ? pageNumberLabel(logicalValue, finalLogicalPage, project.pageNumberSettings.format)
          : null,
      logicalPageNumber: logicalValue
        ? {
            value: logicalValue,
            label: pageNumberLabel(
              logicalValue,
              finalLogicalPage,
              project.pageNumberSettings.format,
            ),
          }
        : null,
    }
  })

  const outlineStartPages: Record<string, number> = {}
  const materialStartPages: Record<string, number> = {}
  const materialEndPages: Record<string, number> = {}
  numberedPages.forEach((page) => {
    const logical = page.logicalPageNumber?.value
    if (!logical) return
    page.outlineNodeIds.forEach((outlineNodeId) => {
      outlineStartPages[outlineNodeId] ??= logical
    })
    page.materialIds.forEach((materialId) => {
      materialStartPages[materialId] ??= logical
      materialEndPages[materialId] = logical
    })
  })

  const propagateOutlineStartPage = (node: OutlineNode): number | undefined => {
    const candidateStarts = [
      outlineStartPages[node.id],
      ...node.materials.map((material) => materialStartPages[material.id]),
      ...node.children.map(propagateOutlineStartPage),
    ].filter((value): value is number => value !== undefined)
    const start = candidateStarts.length > 0 ? Math.min(...candidateStarts) : undefined
    if (start !== undefined) outlineStartPages[node.id] = start
    return start
  }
  sortedRoots.forEach(propagateOutlineStartPage)

  const tocEntries: TocEntry[] = []
  for (const root of sortedRoots) {
    if (!outputOutlineNodeIds.has(root.id)) continue
    const rootStart = outlineStartPages[root.id]
    const rootSequence = outlineSequenceLabels[root.id]
    if (rootStart === undefined || !rootSequence) continue
    tocEntries.push({
      id: `toc-node:${root.id}`,
      kind: 'level1',
      level: 1,
      title: root.title,
      sequenceLabel: rootSequence,
      displayText: formatSequencedTitle(rootSequence, root.title),
      outlineNodeId: root.id,
      materialId: null,
      logicalPageNumber: rootStart,
    })
    for (const child of sortByOrder(root.children)) {
      if (!outputOutlineNodeIds.has(child.id)) continue
      const childStart = outlineStartPages[child.id]
      const childSequence = outlineSequenceLabels[child.id]
      if (childStart === undefined || !childSequence) continue
      tocEntries.push({
        id: `toc-node:${child.id}`,
        kind: 'level2',
        level: 2,
        title: child.title,
        sequenceLabel: childSequence,
        displayText: formatSequencedTitle(childSequence, child.title),
        outlineNodeId: child.id,
        materialId: null,
        logicalPageNumber: childStart,
      })
      for (const material of sortByOrder(child.materials)) {
        if (!outputMaterialIds.has(material.id)) continue
        const materialStart = materialStartPages[material.id]
        const materialSequence = materialSequenceLabels[material.id]
        if (materialStart === undefined || !materialSequence) continue
        tocEntries.push({
          id: `toc-material:${material.id}`,
          kind: 'material',
          level: 3,
          title: material.title,
          sequenceLabel: materialSequence,
          displayText: formatSequencedTitle(materialSequence, material.title),
          outlineNodeId: child.id,
          materialId: material.id,
          logicalPageNumber: materialStart,
        })
      }
    }
  }

  const sections: PlannedSection[] = []
  Object.entries(materialStartPages).forEach(([materialId, startLogicalPage]) => {
    const sectionPages = numberedPages.filter((page) => page.materialIds.includes(materialId))
    const first = sectionPages[0]
    const last = sectionPages.at(-1)
    if (first && last) {
      sections.push({
        id: `material:${materialId}`,
        outlineNodeId: contextByMaterialId.get(materialId)?.child.id ?? null,
        materialId,
        startPhysicalIndex: first.physicalIndex,
        endPhysicalIndex: last.physicalIndex,
        startLogicalPage,
        endLogicalPage: materialEndPages[materialId] ?? null,
      })
    }
  })

  const fingerprintInput = JSON.stringify({
    projectId: project.id,
    revision,
    tocPageCount,
    coverSettings: project.coverSettings,
    tocSettings: project.tocSettings,
    collageSettings: project.collageSettings,
    outlineSequenceLabels,
    materialSequenceLabels,
    tocEntries: tocEntries.map((entry) => [entry.id, entry.displayText, entry.logicalPageNumber]),
    pages: numberedPages.map((page) => [
      page.id,
      page.displayTitle,
      page.sequenceLabel,
      page.logicalPageNumber?.value,
      page.rotation,
      page.showPageNumber,
      page.materialIds,
      page.inlineHeadings.map((heading) => [heading.level, heading.sequenceLabel, heading.title]),
      page.composite?.layoutDigest,
      page.composite?.contentItems.map((item) => [
        item.slotId,
        item.sourcePageId,
        item.cropRect,
        item.fit,
        item.alignment,
        item.sourceRotation,
        item.slotRotation,
      ]),
    ]),
  })

  return {
    planFingerprint: `${project.id}:${stableHash(fingerprintInput)}`,
    projectId: project.id,
    revision,
    totalPageCount: numberedPages.length,
    logicalPageCount: numberedPages.filter((page) => page.logicalPageNumber !== null).length,
    tocPageCount,
    pages: numberedPages,
    sections,
    outlineStartPages,
    materialStartPages,
    materialEndPages,
    outlineSequenceLabels,
    materialSequenceLabels,
    outputOutlineNodeIds: [...outputOutlineNodeIds],
    outputMaterialIds: [...outputMaterialIds],
    tocEntries,
    errors,
    warnings,
  }
}
