import {
  CheckCircleOutlined,
  CloseOutlined,
  FileAddOutlined,
  FilePdfOutlined,
  FolderOpenOutlined,
  OrderedListOutlined,
} from '@ant-design/icons'
import { Button, Card, Space, Steps, Typography } from 'antd'

type GettingStartedCardProps =
  | {
      context: 'welcome'
      onNew: () => void
      onSample: () => void
      sampleCreating: boolean
    }
  | {
      context: 'project'
      materialCount: number
      planReady: boolean
      onImport: () => void
      onExport: () => void
      onDismiss: () => void
    }

const stepItems = [
  { title: '创建项目', description: '选择目录模板和保存位置', icon: <FolderOpenOutlined /> },
  { title: '导入材料', description: '检查 PDF、图片或 Office 文件', icon: <FileAddOutlined /> },
  { title: '检查编排', description: '确认目录、页面顺序和拼版', icon: <OrderedListOutlined /> },
  { title: '导出 PDF', description: '通过预检后生成统一 A4 文档', icon: <FilePdfOutlined /> },
]

export const GettingStartedCard = (props: GettingStartedCardProps): React.JSX.Element => {
  const projectContext = props.context === 'project'
  const current = projectContext ? (props.materialCount > 0 ? (props.planReady ? 3 : 2) : 1) : 0
  return (
    <Card
      size="small"
      className={`getting-started-card ${projectContext ? 'project-guide' : 'welcome-guide'}`}
      title={
        <Space>
          <CheckCircleOutlined />
          <span>四步完成支撑材料编排</span>
        </Space>
      }
      extra={
        projectContext ? (
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            aria-label="关闭新手引导"
            onClick={props.onDismiss}
          />
        ) : null
      }
    >
      <Steps size="small" current={current} items={stepItems} responsive={false} />
      <Typography.Paragraph type="secondary" className="getting-started-note">
        所有文件仅在本机处理；旋转、删除和重排只修改项目配置，不会改动原始材料。
      </Typography.Paragraph>
      {props.context === 'welcome' ? (
        <Space wrap>
          <Button type="primary" icon={<FileAddOutlined />} onClick={props.onNew}>
            创建自己的项目
          </Button>
          <Button
            icon={<FolderOpenOutlined />}
            loading={props.sampleCreating}
            onClick={props.onSample}
          >
            体验示例项目
          </Button>
        </Space>
      ) : (
        <Space wrap>
          <Button type="primary" icon={<FileAddOutlined />} onClick={props.onImport}>
            {props.materialCount > 0 ? '继续导入材料' : '导入第一份材料'}
          </Button>
          <Button
            icon={<FilePdfOutlined />}
            disabled={props.materialCount === 0 || !props.planReady}
            onClick={props.onExport}
          >
            运行导出前检查
          </Button>
        </Space>
      )}
    </Card>
  )
}
