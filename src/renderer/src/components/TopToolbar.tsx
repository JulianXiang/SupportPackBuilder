import {
  ExportOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  ImportOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { Button, Divider, Space, Tooltip } from 'antd'

type TopToolbarProps = {
  hasProject: boolean
  saving: boolean
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
  onImportFiles: () => void
  onImportFolder: () => void
  onExport: () => void
  onProjectSettings: () => void
  onHelp: () => void
}

export const TopToolbar = (props: TopToolbarProps): React.JSX.Element => (
  <header className="top-toolbar">
    <div className="brand-block">
      <div className="brand-mark">SP</div>
      <div>
        <div className="brand-title">个人支撑材料编排器</div>
        <div className="brand-subtitle">SupportPackBuilder</div>
      </div>
    </div>
    <Divider orientation="vertical" className="toolbar-divider" />
    <Space size={4} wrap={false}>
      <Button icon={<FileAddOutlined />} onClick={props.onNew}>
        新建项目
      </Button>
      <Button icon={<FolderOpenOutlined />} onClick={props.onOpen}>
        打开项目
      </Button>
      <Button
        icon={<SaveOutlined />}
        disabled={!props.hasProject}
        loading={props.saving}
        onClick={props.onSave}
      >
        保存
      </Button>
      <Button disabled={!props.hasProject} onClick={props.onSaveAs}>
        另存为
      </Button>
      <Divider orientation="vertical" className="toolbar-divider compact" />
      <Button icon={<ImportOutlined />} disabled={!props.hasProject} onClick={props.onImportFiles}>
        导入文件
      </Button>
      <Tooltip title="递归扫描 PDF 和图片，忽略符号链接">
        <Button
          icon={<FolderOutlined />}
          disabled={!props.hasProject}
          onClick={props.onImportFolder}
        >
          导入文件夹
        </Button>
      </Tooltip>
      <Button
        type="primary"
        icon={<ExportOutlined />}
        disabled={!props.hasProject}
        onClick={props.onExport}
      >
        导出 PDF
      </Button>
    </Space>
    <div className="toolbar-spacer" />
    <Space size={2}>
      <Tooltip title="项目设置">
        <Button
          type="text"
          icon={<SettingOutlined />}
          disabled={!props.hasProject}
          onClick={props.onProjectSettings}
        />
      </Tooltip>
      <Tooltip title="帮助与隐私说明">
        <Button type="text" icon={<QuestionCircleOutlined />} onClick={props.onHelp} />
      </Tooltip>
    </Space>
  </header>
)
