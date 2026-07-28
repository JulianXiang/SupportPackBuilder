import type {
  PagePlan,
  PlannedPage,
  PlannedSection,
  TocEntry,
  ValidationIssue,
} from '../schemas/page-plan-schema.js'
import type { Material, OutlineNode, Project, Rotation } from '../schemas/project-schema.js'
import { parsePageRange } from './page-range.js'
import { formatSequenceLabel, formatSequencedTitle } from './sequence-label.js'

const sortByOrder = <T extends { order: number; id: string }>(values: T[]): T[] =>
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

type SelectedSourcePage = {
  sourceId: string
  sourceFile: string
  pageIndex: number
  sourcePageId: string
  rotation: Rotation
  pageType: 'pdfContent' | 'imageContent'
}

type SelectedSourcePages = {
  pages: SelectedSourcePage[]
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

const getSelectedSourcePages = (material: Material): SelectedSourcePages => {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const candidates: SelectedSourcePage[] = []

  if (material.sourceType === 'pdf' || material.sourceType === 'office') {
    const source = material.sourceItems[0]
    if (!source) {
      errors.push(
        issue(material, 'missing-source', 'error', `材料“${material.title}”缺少来源文件记录。`),
      )
      return { pages: [], errors, warnings }
    }
    const conversion = material.sourceType === 'office' ? source.conversion : undefined
    if (material.sourceType === 'office' && !conversion) {
      errors.push(
        issue(
          material,
          'office-snapshot-missing',
          'error',
          `Office 材料“${material.title}”缺少 PDF 转换快照，请重新转换后再导出。`,
        ),
      )
      return { pages: [], errors, warnings }
    }
    if (conversion?.snapshotStatus === 'error') {
      errors.push(
        issue(
          material,
          'office-snapshot-error',
          'error',
          `Office 材料“${material.title}”的转换快照不可用，请重新转换。`,
        ),
      )
    } else if (conversion?.snapshotStatus === 'stale') {
      warnings.push(
        issue(
          material,
          'office-snapshot-stale',
          'warning',
          `Office 材料“${material.title}”的原件已变化，当前仍使用上一次转换快照。`,
        ),
      )
    }
    const pageCount = conversion?.pageCount ?? source.pageCount
    const parsed = parsePageRange(material.selectedPageRanges, pageCount)
    if (!parsed.success) {
      errors.push(
        ...parsed.errors.map((error) =>
          issue(
            material,
            `page-range-${error.code}`,
            'error',
            `材料“${material.title}”：${error.message}`,
          ),
        ),
      )
      return { pages: [], errors, warnings }
    }
    warnings.push(
      ...parsed.warnings.map((warning) =>
        issue(
          material,
          `page-range-${warning.code}`,
          'warning',
          `材料“${material.title}”：${warning.message}`,
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
      })
    })
  } else {
    material.sourceItems.forEach((source) => {
      const id = sourcePageId(source.id, 0)
      candidates.push({
        sourceId: source.id,
        sourceFile: source.storedPath ?? source.sourcePath,
        pageIndex: 0,
        sourcePageId: id,
        rotation: material.rotationByPage[id] ?? 0,
        pageType: 'imageContent',
      })
    })
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
  const outputMaterialIds = new Set<string>()
  const outputOutlineNodeIds = new Set<string>()
  const outlineSequenceLabels: Record<string, string> = {}
  const materialSequenceLabels: Record<string, string> = {}
  const renderedInlineNodeHeadings = new Set<string>()

  const sortedRoots = sortByOrder(project.outlineNodes)

  for (const root of sortedRoots) {
    if (!root.enabled) continue
    for (const child of sortByOrder(root.children)) {
      if (!child.enabled) continue
      for (const material of sortByOrder(child.materials)) {
        if (!material.enabled) continue
        const selected = getSelectedSourcePages(material)
        selectedPagesByMaterial.set(material.id, selected)
        errors.push(...selected.errors)
        warnings.push(...selected.warnings)
        const hasTitlePage =
          material.insertTitlePage && project.exportSettings.includeMaterialTitlePages
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

  const pushGeneratedPage = (
    page: Omit<PlannedPage, 'physicalIndex' | 'logicalPageNumber' | 'printedPageLabel'>,
  ): void => {
    pages.push({
      ...page,
      physicalIndex: pages.length,
      logicalPageNumber: null,
      printedPageLabel: null,
    })
  }

  if (project.coverSettings.enabled && project.exportSettings.includeCover) {
    pushGeneratedPage({
      id: 'cover:0',
      pageType: 'cover',
      outlineNodeId: null,
      materialId: null,
      sourceId: null,
      sourceFile: null,
      sourcePageIndex: null,
      sourcePageId: null,
      displayTitle: project.coverSettings.title,
      sequenceLabel: null,
      inlineHeadings: [],
      showPageNumber:
        project.pageNumberSettings.enabled &&
        project.exportSettings.addPageNumbers &&
        project.coverSettings.countInLogicalNumber &&
        project.coverSettings.showPageNumber,
      rotation: 0,
      targetOrientation: project.exportSettings.targetOrientation,
      validationStatus: 'valid',
    })
    if (project.coverSettings.insertBlankBackPage) {
      pushGeneratedPage({
        id: 'blank:cover-back',
        pageType: 'blank',
        outlineNodeId: null,
        materialId: null,
        sourceId: null,
        sourceFile: null,
        sourcePageIndex: null,
        sourcePageId: null,
        displayTitle: '封面背面空白页',
        sequenceLabel: null,
        inlineHeadings: [],
        showPageNumber: false,
        rotation: 0,
        targetOrientation: project.exportSettings.targetOrientation,
        validationStatus: 'valid',
      })
    }
  }

  for (let index = 0; index < tocPageCount; index += 1) {
    pushGeneratedPage({
      id: `toc:${index}`,
      pageType: 'toc',
      outlineNodeId: null,
      materialId: null,
      sourceId: null,
      sourceFile: null,
      sourcePageIndex: null,
      sourcePageId: null,
      displayTitle: `${project.tocSettings.title}${tocPageCount > 1 ? `（${index + 1}）` : ''}`,
      sequenceLabel: null,
      inlineHeadings: [],
      showPageNumber:
        project.pageNumberSettings.enabled &&
        project.exportSettings.addPageNumbers &&
        project.tocSettings.countInLogicalNumber &&
        project.tocSettings.showPageNumber,
      rotation: 0,
      targetOrientation: project.exportSettings.targetOrientation,
      validationStatus: 'valid',
    })
  }

  const pushDivider = (node: OutlineNode): void => {
    if (!node.insertDividerPage || !project.exportSettings.includeDividerPages) return
    pushGeneratedPage({
      id: `divider:${node.id}`,
      pageType: 'divider',
      outlineNodeId: node.id,
      materialId: null,
      sourceId: null,
      sourceFile: null,
      sourcePageIndex: null,
      sourcePageId: null,
      displayTitle: node.title,
      sequenceLabel: outlineSequenceLabels[node.id] ?? null,
      inlineHeadings: [],
      showPageNumber:
        project.pageNumberSettings.enabled &&
        project.exportSettings.addPageNumbers &&
        project.pageNumberSettings.showOnDivider,
      rotation: 0,
      targetOrientation: project.exportSettings.targetOrientation,
      validationStatus: 'valid',
    })
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
          pushGeneratedPage({
            id: `material-title:${material.id}`,
            pageType: 'materialTitle',
            outlineNodeId: child.id,
            materialId: material.id,
            sourceId: null,
            sourceFile: null,
            sourcePageIndex: null,
            sourcePageId: null,
            displayTitle: material.title,
            sequenceLabel: materialSequence || null,
            inlineHeadings: [],
            showPageNumber:
              project.pageNumberSettings.enabled &&
              project.exportSettings.addPageNumbers &&
              project.pageNumberSettings.showOnMaterialTitle,
            rotation: 0,
            targetOrientation: project.exportSettings.targetOrientation,
            validationStatus: material.validationStatus,
          })
        }

        const selected = selectedPagesByMaterial.get(material.id)
        selected?.pages.forEach((sourcePage, pageIndex) => {
          const inlineHeadings: PlannedPage['inlineHeadings'] = []
          if (pageIndex === 0 && project.exportSettings.contentHeadingMode === 'firstPage') {
            for (const headingNode of [root, child]) {
              const hasStandaloneDivider =
                headingNode.insertDividerPage && project.exportSettings.includeDividerPages
              if (!hasStandaloneDivider && !renderedInlineNodeHeadings.has(headingNode.id)) {
                const sequenceLabel = outlineSequenceLabels[headingNode.id] ?? ''
                inlineHeadings.push({
                  level: headingNode.level,
                  title: headingNode.title,
                  sequenceLabel,
                  text: formatSequencedTitle(sequenceLabel, headingNode.title),
                })
                renderedInlineNodeHeadings.add(headingNode.id)
              }
            }
            const hasStandaloneMaterialTitle =
              material.insertTitlePage && project.exportSettings.includeMaterialTitlePages
            if (!hasStandaloneMaterialTitle) {
              inlineHeadings.push({
                level: 3,
                title: material.title,
                sequenceLabel: materialSequence,
                text: formatSequencedTitle(materialSequence, material.title),
              })
            }
          }
          pushGeneratedPage({
            id: `content:${material.id}:${sourcePage.sourcePageId}`,
            pageType: sourcePage.pageType,
            outlineNodeId: child.id,
            materialId: material.id,
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
    errors.push({
      code: 'invalid-front-matter-numbering',
      severity: 'error',
      message:
        '封面或目录计入逻辑页码后会产生 0 或负数页码。请提高正文起始页码，或关闭前置页面计数。',
      outlineNodeId: null,
      materialId: null,
    })
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
    if (page.outlineNodeId && outlineStartPages[page.outlineNodeId] === undefined) {
      outlineStartPages[page.outlineNodeId] = logical
    }
    if (page.materialId) {
      materialStartPages[page.materialId] ??= logical
      materialEndPages[page.materialId] = logical
    }
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
    const sectionPages = numberedPages.filter((page) => page.materialId === materialId)
    const first = sectionPages[0]
    const last = sectionPages.at(-1)
    if (first && last) {
      sections.push({
        id: `material:${materialId}`,
        outlineNodeId: first.outlineNodeId,
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
      page.inlineHeadings.map((heading) => [heading.level, heading.sequenceLabel, heading.title]),
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
