import type { PagePlan, ValidationIssue } from '../../../shared/schemas/page-plan-schema.js'
import type { Project } from '../../../shared/schemas/project-schema.js'
import type { ExportIssue } from '../../../shared/types/export.js'

export type IssueSource = 'material' | 'pagePlan' | 'exportFile'
export type IssueCategory = 'missing' | 'error' | 'warning'

export type IssueView = {
  id: string
  code: string
  severity: 'error' | 'warning'
  category: IssueCategory
  source: IssueSource
  message: string
  suggestion?: string
  outlineNodeId: string | null
  materialId: string | null
  pageId: string | null
  locationLabel: string
  order: number
}

export type IssueSummary = {
  missing: number
  errors: number
  warnings: number
}

const defaultSuggestion = (code: string): string | undefined => {
  if (code.startsWith('page-range-')) return '打开材料属性检查参与编排的页码范围。'
  if (code === 'layout-disabled') return '启用多图拼版，或删除不再需要的拼版配置。'
  if (code === 'layout-sheet-empty') return '删除没有任何内容的空拼版页。'
  if (code.includes('order') || code.includes('anchor')) return '按左侧目录顺序修复拼版页。'
  if (code.startsWith('layout-clarity-')) return '打开对应拼版页，减少槽位或调整页面方向。'
  if (code.startsWith('layout-')) return '打开对应拼版页检查来源、区段和页面顺序。'
  return undefined
}

const issuePageId = (
  plan: PagePlan | null,
  code: string,
  outlineNodeId: string | null,
  materialId: string | null,
): string | null => {
  if (!plan) return null
  const candidates = plan.pages.filter((page) => {
    if (materialId && (page.materialId === materialId || page.materialIds.includes(materialId))) {
      return true
    }
    return Boolean(outlineNodeId && page.outlineNodeIds.includes(outlineNodeId))
  })
  if (code.startsWith('layout-')) {
    return (
      candidates.find((page) => page.pageType === 'compositeContent')?.id ??
      plan.pages.find((page) => page.pageType === 'compositeContent')?.id ??
      candidates[0]?.id ??
      null
    )
  }
  return candidates[0]?.id ?? null
}

const projectOrder = (
  project: Project,
): {
  outline: Map<string, number>
  material: Map<string, number>
  labels: Map<string, string>
} => {
  const outline = new Map<string, number>()
  const material = new Map<string, number>()
  const labels = new Map<string, string>()
  let outlineOrder = 0
  let materialOrder = 0
  ;[...project.outlineNodes]
    .sort((left, right) => left.order - right.order)
    .forEach((root) => {
      outline.set(root.id, outlineOrder++)
      labels.set(root.id, root.title)
      ;[...root.children]
        .sort((left, right) => left.order - right.order)
        .forEach((child) => {
          outline.set(child.id, outlineOrder++)
          labels.set(child.id, `${root.title} / ${child.title}`)
          ;[...child.materials]
            .sort((left, right) => left.order - right.order)
            .forEach((item) => {
              material.set(item.id, materialOrder++)
              labels.set(item.id, `${root.title} / ${child.title} / ${item.title}`)
            })
        })
    })
  return { outline, material, labels }
}

const dedupePriority = (issue: IssueView): number => {
  if (issue.code.startsWith('source-') || issue.code.startsWith('office-snapshot-')) {
    return issue.source === 'material' || issue.source === 'exportFile' ? 3 : 1
  }
  if (issue.code.startsWith('page-range-') || issue.code.startsWith('layout-')) {
    return issue.source === 'pagePlan' ? 3 : 1
  }
  return issue.source === 'material' || issue.source === 'exportFile' ? 2 : 1
}

const finalizeIssues = (issues: IssueView[]): IssueView[] => {
  const deduped = new Map<string, IssueView>()
  issues.forEach((issue) => {
    const key = `${issue.code}:${issue.outlineNodeId ?? ''}:${issue.materialId ?? ''}`
    const existing = deduped.get(key)
    if (!existing || dedupePriority(issue) > dedupePriority(existing)) deduped.set(key, issue)
  })
  return [...deduped.values()].sort(
    (left, right) =>
      (left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1) ||
      left.order - right.order ||
      left.code.localeCompare(right.code),
  )
}

const validationIssueView = (input: {
  issue: ValidationIssue
  project: Project
  plan: PagePlan | null
  order: ReturnType<typeof projectOrder>
}): IssueView => {
  const { issue, order } = input
  const locationLabel = issue.materialId
    ? (order.labels.get(issue.materialId) ?? '材料')
    : issue.outlineNodeId
      ? (order.labels.get(issue.outlineNodeId) ?? '目录')
      : '项目设置'
  const numericOrder = issue.materialId
    ? (order.material.get(issue.materialId) ?? Number.MAX_SAFE_INTEGER)
    : (order.outline.get(issue.outlineNodeId ?? '') ?? Number.MAX_SAFE_INTEGER)
  const suggestion = defaultSuggestion(issue.code)
  const missing = issue.code === 'source-missing' || issue.code === 'material-status-missing'
  return {
    id: `pagePlan:${issue.code}:${issue.outlineNodeId ?? ''}:${issue.materialId ?? ''}`,
    code: issue.code,
    severity: issue.severity === 'error' ? 'error' : 'warning',
    category: missing ? 'missing' : issue.severity === 'error' ? 'error' : 'warning',
    source: 'pagePlan',
    message: issue.message,
    ...(suggestion ? { suggestion } : {}),
    outlineNodeId: issue.outlineNodeId,
    materialId: issue.materialId,
    pageId: issuePageId(input.plan, issue.code, issue.outlineNodeId, issue.materialId),
    locationLabel,
    order: numericOrder,
  }
}

export const collectIssueViews = (project: Project, plan: PagePlan | null): IssueView[] => {
  const order = projectOrder(project)
  const materialIssues: IssueView[] = []
  project.outlineNodes.forEach((root) =>
    root.children.forEach((child) =>
      child.materials.forEach((material) => {
        material.validationMessages.forEach((message) => {
          const missing =
            message.code === 'source-missing' || material.validationStatus === 'missing'
          materialIssues.push({
            id: `material:${message.code}:${child.id}:${material.id}`,
            code: message.code,
            severity: message.severity === 'error' ? 'error' : 'warning',
            category: missing ? 'missing' : message.severity === 'error' ? 'error' : 'warning',
            source: 'material',
            message: message.message,
            ...(message.suggestion ? { suggestion: message.suggestion } : {}),
            outlineNodeId: child.id,
            materialId: material.id,
            pageId: issuePageId(plan, message.code, child.id, material.id),
            locationLabel: order.labels.get(material.id) ?? material.title,
            order: order.material.get(material.id) ?? Number.MAX_SAFE_INTEGER,
          })
        })
        if (
          material.validationMessages.length === 0 &&
          ['error', 'missing', 'encrypted', 'unsupported'].includes(material.validationStatus)
        ) {
          const missing = material.validationStatus === 'missing'
          materialIssues.push({
            id: `material:status:${child.id}:${material.id}`,
            code: `material-status-${material.validationStatus}`,
            severity: 'error',
            category: missing ? 'missing' : 'error',
            source: 'material',
            message: `材料“${material.title}”的文件状态异常。`,
            suggestion: '打开材料属性检查来源文件。',
            outlineNodeId: child.id,
            materialId: material.id,
            pageId: issuePageId(plan, 'material-status', child.id, material.id),
            locationLabel: order.labels.get(material.id) ?? material.title,
            order: order.material.get(material.id) ?? Number.MAX_SAFE_INTEGER,
          })
        }
      }),
    ),
  )
  const pagePlanIssues = plan
    ? [...plan.errors, ...plan.warnings].map((issue) =>
        validationIssueView({ issue, project, plan, order }),
      )
    : []
  return finalizeIssues([...materialIssues, ...pagePlanIssues])
}

export const exportIssueViews = (
  project: Project,
  plan: PagePlan,
  issues: readonly ExportIssue[],
): IssueView[] => {
  const order = projectOrder(project)
  return finalizeIssues(
    issues.map((issue) => {
      const asValidation: ValidationIssue = {
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        outlineNodeId: issue.outlineNodeId,
        materialId: issue.materialId,
      }
      const view = validationIssueView({ issue: asValidation, project, plan, order })
      return {
        ...view,
        id: `export:${issue.source}:${view.id}`,
        source: issue.source === 'file' ? 'exportFile' : 'pagePlan',
        suggestion: issue.suggestion,
      }
    }),
  )
}

export const summarizeIssues = (issues: readonly IssueView[]): IssueSummary => ({
  missing: issues.filter((issue) => issue.category === 'missing').length,
  errors: issues.filter((issue) => issue.category === 'error').length,
  warnings: issues.filter((issue) => issue.category === 'warning').length,
})
