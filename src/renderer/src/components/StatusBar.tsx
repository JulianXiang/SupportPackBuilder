import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import type { PagePlan } from '../../../shared/schemas/page-plan-schema.js'
import type { Project } from '../../../shared/schemas/project-schema.js'
import { calculatePaperSavings } from '../../../shared/utils/collage-metrics.js'
import type { SaveStatus } from '../stores/project-store.js'
import type { IssueSummary } from '../utils/issues.js'
import { countEnabledMaterials, countMaterials } from '../utils/project.js'

type StatusBarProps = {
  project: Project
  projectDirectory: string
  pagePlan: PagePlan | null
  saveStatus: SaveStatus
  saveError: string | null
  issueSummary: IssueSummary
  onOpenIssues: (filter: 'missing' | 'error' | 'warning') => void
}

const saveLabel = (status: SaveStatus): React.ReactNode => {
  switch (status) {
    case 'saving':
      return (
        <>
          <LoadingOutlined /> 正在保存
        </>
      )
    case 'saved':
      return (
        <>
          <CheckCircleOutlined /> 已保存
        </>
      )
    case 'error':
      return (
        <>
          <CloseCircleOutlined /> 保存失败
        </>
      )
    case 'dirty':
      return (
        <>
          <WarningOutlined /> 有未保存修改
        </>
      )
    case 'idle':
      return '尚未保存'
  }
}

export const StatusBar = (props: StatusBarProps): React.JSX.Element => {
  const ordinaryContentPages =
    props.pagePlan?.pages.filter(
      (page) => page.pageType === 'pdfContent' || page.pageType === 'imageContent',
    ).length ?? 0
  const compositePages =
    props.pagePlan?.pages.filter((page) => page.pageType === 'compositeContent') ?? []
  const uniqueCompositeSourcePages = new Set(
    compositePages.flatMap(
      (page) => page.composite?.contentItems.map((item) => item.sourcePageId) ?? [],
    ),
  ).size
  const savedByCollage = Math.max(0, uniqueCompositeSourcePages - compositePages.length)
  const totalPages = props.pagePlan?.totalPageCount ?? 0
  const paperSavings = calculatePaperSavings(totalPages + savedByCollage, totalPages)
  return (
    <footer className="status-bar">
      <span>材料 {countMaterials(props.project)} 项</span>
      <span>启用 {countEnabledMaterials(props.project)} 项</span>
      <span>预计 {props.pagePlan?.totalPageCount ?? 0} 页</span>
      {compositePages.length > 0 && (
        <span title={`普通内容页 ${ordinaryContentPages} 页，拼版页 ${compositePages.length} 页`}>
          拼版节省 {paperSavings.savedPages} 页 · 双面约 {paperSavings.composedSheetsDuplex} 张
        </span>
      )}
      <button
        type="button"
        className={`status-issue-button ${props.issueSummary.missing ? 'status-danger' : ''}`}
        onClick={() => props.onOpenIssues('missing')}
      >
        缺失文件 {props.issueSummary.missing}
      </button>
      <button
        type="button"
        className={`status-issue-button ${props.issueSummary.errors ? 'status-danger' : ''}`}
        onClick={() => props.onOpenIssues('error')}
      >
        其他错误 {props.issueSummary.errors}
      </button>
      <button
        type="button"
        className={`status-issue-button ${props.issueSummary.warnings ? 'status-warning' : ''}`}
        onClick={() => props.onOpenIssues('warning')}
      >
        警告 {props.issueSummary.warnings}
      </button>
      <span
        className={`save-status ${props.saveStatus === 'error' ? 'status-danger' : ''}`}
        title={props.saveError ?? undefined}
      >
        {saveLabel(props.saveStatus)}
      </span>
      <span className="status-path" title={props.projectDirectory}>
        {props.projectDirectory}
      </span>
    </footer>
  )
}
