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
import { countEnabledMaterials, countMaterials } from '../utils/project.js'

type StatusBarProps = {
  project: Project
  projectDirectory: string
  pagePlan: PagePlan | null
  saveStatus: SaveStatus
  saveError: string | null
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
  const materials = props.project.outlineNodes
    .flatMap((node) => node.children)
    .flatMap((node) => node.materials)
  const missing = materials.filter((material) => material.validationStatus === 'missing').length
  const errors =
    materials.filter((material) =>
      ['error', 'encrypted', 'unsupported'].includes(material.validationStatus),
    ).length + (props.pagePlan?.errors.length ?? 0)
  const warnings =
    materials.filter((material) => material.validationStatus === 'warning').length +
    (props.pagePlan?.warnings.length ?? 0)
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
      <span className={missing ? 'status-danger' : ''}>缺失 {missing}</span>
      <span className={errors ? 'status-danger' : ''}>错误 {errors}</span>
      <span className={warnings ? 'status-warning' : ''}>警告 {warnings}</span>
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
