import {
  CloseCircleOutlined,
  FileSearchOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Button, Drawer, Empty, Segmented, Space, Tag, Typography } from 'antd'
import { safeIssueFixKind, safeIssueFixLabel } from '../../utils/issue-fixes.js'
import type { IssueCategory, IssueView } from '../../utils/issues.js'

export type IssueFilter = 'all' | IssueCategory

type IssueCenterProps = {
  open: boolean
  issues: IssueView[]
  filter: IssueFilter
  onFilterChange: (filter: IssueFilter) => void
  onClose: () => void
  onLocate: (issue: IssueView) => void
  onFix: (issue: IssueView) => void
}

const IssueCard = (props: {
  issue: IssueView
  onLocate: (issue: IssueView) => void
  onFix: (issue: IssueView) => void
}): React.JSX.Element => {
  const fixKind = safeIssueFixKind(props.issue)
  return (
    <article className={`issue-card issue-${props.issue.severity}`} role="listitem">
      <div className="issue-card-heading">
        <Space size={6}>
          {props.issue.severity === 'error' ? (
            <CloseCircleOutlined className="status-danger" />
          ) : (
            <WarningOutlined className="status-warning" />
          )}
          <Tag color={props.issue.severity === 'error' ? 'red' : 'orange'}>
            {props.issue.category === 'missing'
              ? '文件缺失'
              : props.issue.severity === 'error'
                ? '错误'
                : '警告'}
          </Tag>
          <Tag>{props.issue.source === 'pagePlan' ? '页面与拼版' : '材料文件'}</Tag>
        </Space>
        <Typography.Text type="secondary" className="issue-code">
          {props.issue.code}
        </Typography.Text>
      </div>
      <Typography.Text strong>{props.issue.message}</Typography.Text>
      {props.issue.suggestion && (
        <Typography.Paragraph type="secondary">{props.issue.suggestion}</Typography.Paragraph>
      )}
      <Typography.Text type="secondary" className="issue-location">
        位置：{props.issue.locationLabel}
      </Typography.Text>
      <Space wrap className="issue-actions">
        <Button
          size="small"
          icon={<FileSearchOutlined />}
          onClick={() => props.onLocate(props.issue)}
        >
          定位
        </Button>
        {fixKind && (
          <Button
            size="small"
            type="primary"
            icon={<ToolOutlined />}
            onClick={() => props.onFix(props.issue)}
          >
            {safeIssueFixLabel(fixKind)}
          </Button>
        )}
      </Space>
    </article>
  )
}

export const IssueCenter = (props: IssueCenterProps): React.JSX.Element => {
  const filtered = props.issues.filter((issue) => {
    if (props.filter === 'all') return true
    return issue.category === props.filter
  })
  const groups = [
    {
      key: 'material',
      title: '材料文件',
      issues: filtered.filter((issue) => issue.source !== 'pagePlan'),
    },
    {
      key: 'pagePlan',
      title: '页面与拼版',
      issues: filtered.filter((issue) => issue.source === 'pagePlan'),
    },
  ].filter((group) => group.issues.length > 0)
  return (
    <Drawer
      open={props.open}
      size={520}
      title="问题与警告中心"
      onClose={props.onClose}
      extra={<Tag color={props.issues.length ? 'orange' : 'green'}>{props.issues.length} 项</Tag>}
    >
      <Segmented
        block
        aria-label="问题筛选"
        value={props.filter}
        options={[
          { value: 'all', label: `全部 ${props.issues.length}` },
          {
            value: 'missing',
            label: `缺失 ${props.issues.filter((issue) => issue.category === 'missing').length}`,
          },
          {
            value: 'error',
            label: `错误 ${props.issues.filter((issue) => issue.category === 'error').length}`,
          },
          {
            value: 'warning',
            label: `警告 ${props.issues.filter((issue) => issue.category === 'warning').length}`,
          },
        ]}
        onChange={(value) => props.onFilterChange(value as IssueFilter)}
      />
      {groups.length === 0 ? (
        <Empty className="issue-empty" description="当前筛选下没有问题" />
      ) : (
        groups.map((group) => (
          <section key={group.key} className="issue-group">
            <Typography.Title level={5}>
              {group.title}（{group.issues.length}）
            </Typography.Title>
            <div className="issue-list" role="list">
              {group.issues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onLocate={props.onLocate}
                  onFix={props.onFix}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </Drawer>
  )
}
