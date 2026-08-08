import type { Project } from '../../../shared/schemas/project-schema.js'
import { flattenLayoutSlots, repairLayoutSheetOrder } from '../../../shared/utils/layout-tree.js'
import { normalizePageRange } from '../../../shared/utils/page-range.js'
import { getSelectedSourcePages } from '../../../shared/utils/page-plan.js'
import { findMaterial } from './project.js'
import type { IssueView } from './issues.js'

export type SafeIssueFixKind =
  'normalize-page-range' | 'enable-collage' | 'remove-empty-layout-sheets' | 'repair-layout-order'

export const safeIssueFixKind = (issue: IssueView): SafeIssueFixKind | null => {
  if (issue.code === 'page-range-extra-whitespace' || issue.code === 'page-range-duplicate-page') {
    return 'normalize-page-range'
  }
  if (issue.code === 'layout-disabled') return 'enable-collage'
  if (issue.code === 'layout-sheet-empty') return 'remove-empty-layout-sheets'
  if (issue.code === 'layout-anchor-conflict' || issue.code === 'layout-section-order-conflict') {
    return 'repair-layout-order'
  }
  return null
}

export const safeIssueFixLabel = (kind: SafeIssueFixKind): string => {
  switch (kind) {
    case 'normalize-page-range':
      return '规范页码范围'
    case 'enable-collage':
      return '启用多图拼版'
    case 'remove-empty-layout-sheets':
      return '删除空拼版页'
    case 'repair-layout-order':
      return '按目录修复顺序'
  }
}

export const applySafeIssueFix = (
  project: Project,
  issue: IssueView,
): { changed: boolean; message: string } => {
  const kind = safeIssueFixKind(issue)
  if (!kind) return { changed: false, message: '该问题需要人工检查。' }
  if (kind === 'normalize-page-range') {
    if (!issue.materialId) return { changed: false, message: '未找到需要修复的材料。' }
    const material = findMaterial(project, issue.materialId)?.material
    if (!material) return { changed: false, message: '未找到需要修复的材料。' }
    let changed = false
    const normalized = normalizePageRange(material.selectedPageRanges, material.pageCount)
    if (normalized && normalized !== material.selectedPageRanges) {
      material.selectedPageRanges = normalized
      changed = true
    }
    material.sourceItems.forEach((source) => {
      if (source.sourceType === 'image') return
      const pageCount = source.conversion?.pageCount ?? source.pageCount
      const sourceNormalized = normalizePageRange(source.selectedPageRanges, pageCount)
      if (sourceNormalized && sourceNormalized !== source.selectedPageRanges) {
        source.selectedPageRanges = sourceNormalized
        changed = true
      }
    })
    return { changed, message: changed ? '页码范围已规范化。' : '页码范围已经是规范格式。' }
  }
  if (kind === 'enable-collage') {
    const changed = !project.collageSettings.enabled
    project.collageSettings.enabled = true
    return { changed, message: changed ? '已启用多图拼版。' : '多图拼版已经启用。' }
  }
  if (kind === 'remove-empty-layout-sheets') {
    const before = project.layoutSheets.length
    project.layoutSheets = project.layoutSheets
      .filter((sheet) =>
        sheet.sections.some((section) =>
          flattenLayoutSlots(section.layout).some((slot) => slot.sourcePageId !== null),
        ),
      )
      .map((sheet, index) => ({ ...sheet, order: index }))
    const removed = before - project.layoutSheets.length
    return {
      changed: removed > 0,
      message: removed > 0 ? `已删除 ${removed} 个空拼版页。` : '没有可删除的空拼版页。',
    }
  }
  const canonicalSourcePageIds = [...project.outlineNodes]
    .sort((left, right) => left.order - right.order)
    .flatMap((root) =>
      [...root.children]
        .sort((left, right) => left.order - right.order)
        .flatMap((child) =>
          [...child.materials]
            .sort((left, right) => left.order - right.order)
            .flatMap((material) => getSelectedSourcePages(material).pages),
        ),
    )
    .map((page) => page.sourcePageId)
  const repaired = repairLayoutSheetOrder(project.layoutSheets, canonicalSourcePageIds)
  const changed = JSON.stringify(repaired) !== JSON.stringify(project.layoutSheets)
  project.layoutSheets = repaired
  return {
    changed,
    message: changed ? '已按目录顺序修复拼版页、区段和锚点。' : '拼版顺序已经正确。',
  }
}
