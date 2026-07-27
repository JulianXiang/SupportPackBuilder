import type {
  PagePlan,
  PlannedPage,
  PlannedSection,
  TocEntry,
  ValidationIssue,
} from '../schemas/page-plan-schema.js'
import type { Material, OutlineNode, Project, Rotation } from '../schemas/project-schema.js'
import { parsePageRange } from './page-range.js'

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

const getSelectedSourcePages = (
  material: Material,
): {
  pages: {
    sourceId: string
    sourceFile: string
    pageIndex: number
    sourcePageId: string
    rotation: Rotation
    pageType: 'pdfContent' | 'imageContent'
  }[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
} => {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const candidates: {
    sourceId: string
    sourceFile: string
    pageIndex: number
    sourcePageId: string
    rotation: Rotation
    pageType: 'pdfContent' | 'imageContent'
  }[] = []

  if (material.sourceType === 'pdf') {
    const source = material.sourceItems[0]
    if (!source) {
      errors.push({
        code: 'missing-source',
        severity: 'error',
        message: `材料“${material.title}”缺少来源文件记录。`,
        outlineNodeId: material.outlineNodeId,
        materialId: material.id,
      })
      return { pages: [], errors, warnings }
    }
    const parsed = parsePageRange(material.selectedPageRanges, source.pageCount)
    if (!parsed.success) {
      errors.push(
        ...parsed.errors.map((error) => ({
          code: `page-range-${error.code}`,
          severity: 'error' as const,
          message: `材料“${material.title}”：${error.message}`,
          outlineNodeId: material.outlineNodeId,
          materialId: material.id,
        })),
      )
      return { pages: [], errors, warnings }
    }
    warnings.push(
      ...parsed.warnings.map((warning) => ({
        code: `page-range-${warning.code}`,
        severity: 'warning' as const,
        message: `材料“${material.title}”：${warning.message}`,
        outlineNodeId: material.outlineNodeId,
        materialId: material.id,
      })),
    )
    parsed.pages.forEach((page) => {
      const pageIndex = page - 1
      const id = sourcePageId(source.id, pageIndex)
      candidates.push({
        sourceId: source.id,
        sourceFile: source.storedPath ?? source.sourcePath,
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
  const ordered: typeof candidates = []
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
  const renderedInlineNodeHeadings = new Set<string>()

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

  const addNode = (
    node: OutlineNode,
    parentEnabled: boolean,
    ancestors: OutlineNode[] = [],
  ): void => {
    if (!parentEnabled || !node.enabled) return
    if (node.insertDividerPage && project.exportSettings.includeDividerPages) {
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

    sortByOrder(node.materials).forEach((material) => {
      if (!material.enabled) return
      if (material.insertTitlePage && project.exportSettings.includeMaterialTitlePages) {
        pushGeneratedPage({
          id: `material-title:${material.id}`,
          pageType: 'materialTitle',
          outlineNodeId: node.id,
          materialId: material.id,
          sourceId: null,
          sourceFile: null,
          sourcePageIndex: null,
          sourcePageId: null,
          displayTitle: material.title,
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
      const selected = getSelectedSourcePages(material)
      errors.push(...selected.errors)
      warnings.push(...selected.warnings)
      selected.pages.forEach((sourcePage, sourcePageIndex) => {
        const inlineHeadings: PlannedPage['inlineHeadings'] = []
        if (sourcePageIndex === 0 && project.exportSettings.contentHeadingMode === 'firstPage') {
          for (const headingNode of [...ancestors, node]) {
            const hasStandaloneDivider =
              headingNode.insertDividerPage && project.exportSettings.includeDividerPages
            if (!hasStandaloneDivider && !renderedInlineNodeHeadings.has(headingNode.id)) {
              inlineHeadings.push({
                level: headingNode.level,
                text: headingNode.title,
              })
              renderedInlineNodeHeadings.add(headingNode.id)
            }
          }
          const hasStandaloneMaterialTitle =
            material.insertTitlePage && project.exportSettings.includeMaterialTitlePages
          if (!hasStandaloneMaterialTitle) {
            inlineHeadings.push({
              level: 3,
              text: material.title,
            })
          }
        }
        pushGeneratedPage({
          id: `content:${material.id}:${sourcePage.sourcePageId}`,
          pageType: sourcePage.pageType,
          outlineNodeId: node.id,
          materialId: material.id,
          sourceId: sourcePage.sourceId,
          sourceFile: sourcePage.sourceFile,
          sourcePageIndex: sourcePage.pageIndex,
          sourcePageId: sourcePage.sourcePageId,
          displayTitle: material.title,
          inlineHeadings,
          showPageNumber:
            project.pageNumberSettings.enabled && project.exportSettings.addPageNumbers,
          rotation: sourcePage.rotation,
          targetOrientation: project.exportSettings.targetOrientation,
          validationStatus: material.validationStatus,
        })
      })
    })

    sortByOrder(node.children).forEach((child) => {
      addNode(child, true, [...ancestors, node])
    })
  }

  sortByOrder(project.outlineNodes).forEach((node) => {
    addNode(node, true)
  })

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
  sortByOrder(project.outlineNodes).forEach(propagateOutlineStartPage)

  const tocEntries: TocEntry[] = []
  const collectTocEntries = (node: OutlineNode): void => {
    const start = outlineStartPages[node.id]
    if (node.enabled && start !== undefined) {
      tocEntries.push({
        id: `toc-node:${node.id}`,
        kind: node.level === 1 ? 'level1' : 'level2',
        level: node.level,
        title: node.title,
        outlineNodeId: node.id,
        materialId: null,
        logicalPageNumber: start,
      })
      sortByOrder(node.materials).forEach((material) => {
        const materialStart = materialStartPages[material.id]
        if (material.enabled && materialStart !== undefined) {
          tocEntries.push({
            id: `toc-material:${material.id}`,
            kind: 'material',
            level: 3,
            title: material.title,
            outlineNodeId: node.id,
            materialId: material.id,
            logicalPageNumber: materialStart,
          })
        }
      })
      sortByOrder(node.children).forEach(collectTocEntries)
    }
  }
  sortByOrder(project.outlineNodes).forEach(collectTocEntries)

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
    pages: numberedPages.map((page) => [
      page.id,
      page.logicalPageNumber?.value,
      page.rotation,
      page.showPageNumber,
      page.inlineHeadings.map((heading) => [heading.level, heading.text]),
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
    tocEntries,
    errors,
    warnings,
  }
}
