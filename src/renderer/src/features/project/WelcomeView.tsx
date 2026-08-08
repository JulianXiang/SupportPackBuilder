import { FileAddOutlined, FolderOpenOutlined, HistoryOutlined } from '@ant-design/icons'
import { Button, Empty, List, Space, Typography } from 'antd'
import type { RecentProjectView } from '../../../../preload/api-types.js'
import { GettingStartedCard } from './GettingStartedCard.js'

type WelcomeViewProps = {
  recentProjects: RecentProjectView[]
  onNew: () => void
  onOpen: () => void
  onOpenRecent: (project: RecentProjectView) => void
  onRemoveRecent: (project: RecentProjectView) => void
  onSample: () => void
  sampleCreating: boolean
  showOnboarding: boolean
}

export const WelcomeView = (props: WelcomeViewProps): React.JSX.Element => (
  <main className="welcome-view">
    <section className="welcome-panel">
      <div className="welcome-heading">
        <div className="welcome-icon">SP</div>
        <div>
          <Typography.Title level={2}>整理个人支撑材料</Typography.Title>
          <Typography.Paragraph type="secondary">
            所有文件仅在本机处理。新建项目后，可以建立两级目录、导入 PDF、图片与 Office
            文档，并导出统一 A4 文档。
          </Typography.Paragraph>
        </div>
      </div>
      <Space size={12}>
        <Button type="primary" size="large" icon={<FileAddOutlined />} onClick={props.onNew}>
          新建项目
        </Button>
        <Button size="large" icon={<FolderOpenOutlined />} onClick={props.onOpen}>
          打开 project.json
        </Button>
        {!props.showOnboarding && (
          <Button size="large" loading={props.sampleCreating} onClick={props.onSample}>
            体验示例项目
          </Button>
        )}
      </Space>
      {props.showOnboarding && (
        <GettingStartedCard
          context="welcome"
          onNew={props.onNew}
          onSample={props.onSample}
          sampleCreating={props.sampleCreating}
        />
      )}
      <div className="recent-section">
        <Typography.Title level={5}>
          <HistoryOutlined /> 最近项目
        </Typography.Title>
        {props.recentProjects.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无最近项目" />
        ) : (
          <List
            size="small"
            bordered
            dataSource={props.recentProjects}
            renderItem={(project) => (
              <List.Item
                actions={[
                  <Button
                    type="link"
                    size="small"
                    key="remove"
                    onClick={() => props.onRemoveRecent(project)}
                  >
                    移除记录
                  </Button>,
                ]}
                onDoubleClick={() => props.onOpenRecent(project)}
              >
                <List.Item.Meta
                  title={
                    <button
                      type="button"
                      className="recent-project-link"
                      onClick={() => props.onOpenRecent(project)}
                    >
                      {project.title}
                    </button>
                  }
                  description={`${project.projectDirectory} · ${new Date(project.lastOpenedAt).toLocaleString('zh-CN')}`}
                />
              </List.Item>
            )}
          />
        )}
      </div>
    </section>
  </main>
)
