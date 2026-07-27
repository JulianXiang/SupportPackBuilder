import type { OutlineNode } from '../schemas/project-schema.js'
import { annualReviewTemplate } from './annual-review.js'
import { emptyTemplate } from './empty.js'
import { researchProjectTemplate } from './research-project.js'
import type { ProjectTemplateDefinition } from './template-types.js'
import { teacherPortfolioTemplate } from './teacher-portfolio.js'
import { teachingAwardTemplate } from './teaching-award.js'
import { titleApplicationTemplate } from './title-application.js'

export const PROJECT_TEMPLATES: ProjectTemplateDefinition[] = [
  titleApplicationTemplate,
  researchProjectTemplate,
  teachingAwardTemplate,
  annualReviewTemplate,
  teacherPortfolioTemplate,
  emptyTemplate,
]

export const createOutlineFromTemplate = (templateId: string): OutlineNode[] => {
  const template =
    PROJECT_TEMPLATES.find((candidate) => candidate.id === templateId) ?? emptyTemplate
  return template.nodes.map((node, nodeIndex) => {
    const parentId = crypto.randomUUID()
    return {
      id: parentId,
      parentId: null,
      level: 1,
      title: node.title,
      order: nodeIndex,
      enabled: true,
      insertDividerPage: false,
      children: node.children.map((childTitle, childIndex) => ({
        id: crypto.randomUUID(),
        parentId,
        level: 2,
        title: childTitle,
        order: childIndex,
        enabled: true,
        insertDividerPage: false,
        children: [],
        materials: [],
      })),
      materials: [],
    }
  })
}
