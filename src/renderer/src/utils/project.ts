import type { PlannedPage } from '../../../shared/schemas/page-plan-schema.js'
import type { Material, OutlineNode, Project } from '../../../shared/schemas/project-schema.js'
import { flattenLayoutSlots, normalizeLayoutWeights } from '../../../shared/utils/layout-tree.js'

export const findOutlineNode = (
  project: Project,
  id: string,
): { node: OutlineNode; parent: OutlineNode | null } | null => {
  for (const node of project.outlineNodes) {
    if (node.id === id) return { node, parent: null }
    const child = node.children.find((candidate) => candidate.id === id)
    if (child) return { node: child, parent: node }
  }
  return null
}

export const findMaterial = (
  project: Project,
  id: string,
): { material: Material; node: OutlineNode; parent: OutlineNode } | null => {
  for (const parent of project.outlineNodes) {
    for (const node of parent.children) {
      const material = node.materials.find((candidate) => candidate.id === id)
      if (material) return { material, node, parent }
    }
  }
  return null
}

export const findMaterialForPage = (project: Project, page: PlannedPage): Material | null =>
  page.materialId ? (findMaterial(project, page.materialId)?.material ?? null) : null

export const countMaterials = (project: Project): number =>
  project.outlineNodes.reduce(
    (total, node) =>
      total + node.children.reduce((childTotal, child) => childTotal + child.materials.length, 0),
    0,
  )

export const countEnabledMaterials = (project: Project): number =>
  project.outlineNodes
    .filter((node) => node.enabled)
    .flatMap((node) => node.children.filter((child) => child.enabled))
    .flatMap((child) => child.materials)
    .filter((material) => material.enabled).length

/**
 * 删除成果时同步清理它占用的拼版区段，避免项目中留下无法解析的孤立引用。
 * 删除单个来源页面时不会调用此函数，已有槽位会保留并由 PagePlan 明确报错。
 */
export const removeMaterialsFromLayoutSheets = (
  project: Project,
  materialIds: Iterable<string>,
): void => {
  const removedIds = new Set(materialIds)
  if (removedIds.size === 0) return
  const now = new Date().toISOString()

  project.layoutSheets = project.layoutSheets
    .sort((first, second) => first.order - second.order)
    .flatMap((sheet) => {
      const remainingSections = sheet.sections.filter(
        (section) => !removedIds.has(section.materialId),
      )
      if (remainingSections.length === 0) return []

      const populatedSourceIds = remainingSections.flatMap((section) =>
        flattenLayoutSlots(section.layout)
          .map((slot) => slot.sourcePageId)
          .filter((sourcePageId): sourcePageId is string => sourcePageId !== null),
      )
      if (populatedSourceIds.length === 0) return []

      const weights = normalizeLayoutWeights(
        remainingSections.length,
        remainingSections.map((section) => section.heightWeight),
      )
      return [
        {
          ...sheet,
          anchorSourcePageId: populatedSourceIds[0] ?? sheet.anchorSourcePageId,
          sections: remainingSections.map((section, index) => ({
            ...section,
            heightWeight: weights[index] ?? section.heightWeight,
          })),
          updatedAt: now,
        },
      ]
    })
    .map((sheet, order) => ({ ...sheet, order }))
}
