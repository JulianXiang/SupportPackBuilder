import type { PlannedPage } from '../../../shared/schemas/page-plan-schema.js'
import type { Material, OutlineNode, Project } from '../../../shared/schemas/project-schema.js'

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
