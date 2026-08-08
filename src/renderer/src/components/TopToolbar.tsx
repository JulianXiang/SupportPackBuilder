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
import { Button, Divider, Segmented, Space, Tooltip } from 'antd'
import type { ExperienceMode } from '../../../shared/schemas/preferences-schema.js'

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
  experienceMode: ExperienceMode
  onExperienceModeChange: (mode: ExperienceMode) => void
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
    <Segmented
      size="small"
      aria-label="界面模式"
      value={props.experienceMode}
      options={[
        { label: '基础', value: 'basic' },
        { label: '高级', value: 'advanced' },
      ]}
      onChange={(value) => props.onExperienceModeChange(value as ExperienceMode)}
    />
    <Space size={2}>
      <Tooltip title="项目设置">
        <Button
          type="text"
          icon={<SettingOutlined />}
          aria-label="项目设置"
          disabled={!props.hasProject}
          onClick={props.onProjectSettings}
        />
      </Tooltip>
      <Tooltip title="帮助与隐私说明">
        <Button
          type="text"
          icon={<QuestionCircleOutlined />}
          aria-label="帮助与隐私说明"
          onClick={props.onHelp}
        />
      </Tooltip>
    </Space>
  </header>
)
