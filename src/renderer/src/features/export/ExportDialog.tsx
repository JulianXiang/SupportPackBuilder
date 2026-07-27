import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Descriptions,
  List,
  Modal,
  Progress,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import type {
  ExportPreflight,
  ExportProgress,
  ExportResult,
} from '../../../../shared/types/export.js'

type ExportDialogProps = {
  checking: boolean
  preflight: ExportPreflight | null
  progress: ExportProgress | null
  result: ExportResult | null
  starting: boolean
  onClose: () => void
  onStart: (taskId: string) => void
  onCancelTask: (taskId: string) => void
  onOpenResult: (path: string) => void
  onRevealResult: (path: string) => void
}

export const ExportDialog = (props: ExportDialogProps): React.JSX.Element => {
  const running = Boolean(props.progress && !props.result)
  const resultPath = props.result?.outputPath
  return (
    <Modal
      open={props.checking || Boolean(props.preflight) || running || Boolean(props.result)}
      width={760}
      title={running ? '正在导出 PDF' : props.result ? '导出结果' : '导出前检查'}
      closable={!running}
      mask={{ closable: false }}
      onCancel={props.onClose}
      footer={
        running ? (
          <Button
            danger
            onClick={() => props.progress && props.onCancelTask(props.progress.taskId)}
          >
            取消导出
          </Button>
        ) : props.result ? (
          <Space>
            {resultPath && (
              <Button type="primary" onClick={() => props.onOpenResult(resultPath)}>
                打开文件
              </Button>
            )}
            {resultPath && (
              <Button onClick={() => props.onRevealResult(resultPath)}>打开所在文件夹</Button>
            )}
            <Button onClick={props.onClose}>继续编辑</Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={props.onClose}>取消</Button>
            <Button
              type="primary"
              loading={props.starting || props.checking}
              disabled={!props.preflight || props.preflight.errors.length > 0}
              onClick={() => props.preflight && props.onStart(props.preflight.taskId)}
            >
              选择位置并导出
            </Button>
          </Space>
        )
      }
    >
      {props.checking && !props.preflight ? (
        <div className="export-checking">
          <Progress type="circle" percent={65} status="active" />
          <Typography.Text>正在校验材料并计算实际目录页数……</Typography.Text>
        </div>
      ) : running && props.progress ? (
        <Space orientation="vertical" size={18} style={{ width: '100%' }}>
          <Progress percent={props.progress.percentage} status="active" />
          <Descriptions
            bordered
            size="small"
            column={1}
            items={[
              { key: 'stage', label: '当前阶段', children: props.progress.stageLabel },
              {
                key: 'material',
                label: '当前材料',
                children: props.progress.currentMaterial ?? '—',
              },
              { key: 'file', label: '当前文件', children: props.progress.currentFile ?? '—' },
              {
                key: 'pages',
                label: '处理页数',
                children: `${props.progress.processedPages} / ${props.progress.totalPages}`,
              },
              {
                key: 'elapsed',
                label: '已用时间',
                children: `${(props.progress.elapsedMilliseconds / 1000).toFixed(1)} 秒`,
              },
            ]}
          />
          <Alert
            type="info"
            showIcon
            title="PDF 处理在独立后台进程中运行，界面仍可响应。取消后不会留下不完整目标文件。"
          />
        </Space>
      ) : props.result ? (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type={
              props.result.status === 'success'
                ? 'success'
                : props.result.status === 'cancelled'
                  ? 'warning'
                  : 'error'
            }
            showIcon
            title={
              props.result.status === 'success'
                ? '导出完成并通过自动校验'
                : props.result.status === 'cancelled'
                  ? '导出已取消'
                  : '导出失败'
            }
            description={props.result.message}
          />
          {props.result.report && (
            <Tabs
              items={[
                {
                  key: 'checks',
                  label: '输出校验报告',
                  children: (
                    <List
                      size="small"
                      bordered
                      dataSource={props.result.report.checks}
                      renderItem={(check) => (
                        <List.Item>
                          <Space>
                            {check.passed ? (
                              <CheckCircleOutlined className="check-pass" />
                            ) : (
                              <CloseCircleOutlined className="check-fail" />
                            )}
                            <div>
                              <strong>{check.label}</strong>
                              <div className="table-subtext">{check.detail}</div>
                            </div>
                          </Space>
                        </List.Item>
                      )}
                    />
                  ),
                },
                {
                  key: 'warnings',
                  label: `警告 (${props.result.report.warnings.length})`,
                  children: props.result.report.warnings.length ? (
                    <List
                      dataSource={props.result.report.warnings}
                      renderItem={(item) => (
                        <List.Item>
                          <WarningOutlined /> {item}
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Alert type="success" title="没有导出警告" />
                  ),
                },
              ]}
            />
          )}
        </Space>
      ) : props.preflight ? (
        <Space orientation="vertical" size={14} style={{ width: '100%' }}>
          <Descriptions
            bordered
            size="small"
            column={2}
            items={[
              {
                key: 'materials',
                label: '启用材料',
                children: `${props.preflight.information.materialCount} 项`,
              },
              {
                key: 'pages',
                label: '预计总页数',
                children: `${props.preflight.information.totalPages} 页`,
              },
              {
                key: 'toc',
                label: '实际目录页数',
                children: `${props.preflight.information.tocPages} 页`,
              },
              {
                key: 'cover',
                label: '封面',
                children: props.preflight.information.includesCover ? '包含' : '不包含',
              },
              {
                key: 'start',
                label: '正文起始页码',
                children: props.preflight.information.bodyStartNumber,
              },
              {
                key: 'size',
                label: '预计文件大小',
                children: `约 ${(props.preflight.information.estimatedFileSize / 1024 / 1024).toFixed(1)} MB`,
              },
            ]}
          />
          <Tabs
            items={[
              {
                key: 'errors',
                label: (
                  <span>
                    <CloseCircleOutlined /> 错误{' '}
                    <Tag color={props.preflight.errors.length ? 'red' : 'default'}>
                      {props.preflight.errors.length}
                    </Tag>
                  </span>
                ),
                children: props.preflight.errors.length ? (
                  <List
                    size="small"
                    dataSource={props.preflight.errors}
                    renderItem={(item) => (
                      <List.Item>
                        <Alert type="error" showIcon title={item} />
                      </List.Item>
                    )}
                  />
                ) : (
                  <Alert type="success" showIcon title="没有阻止导出的错误" />
                ),
              },
              {
                key: 'warnings',
                label: (
                  <span>
                    <WarningOutlined /> 警告{' '}
                    <Tag color={props.preflight.warnings.length ? 'orange' : 'default'}>
                      {props.preflight.warnings.length}
                    </Tag>
                  </span>
                ),
                children: props.preflight.warnings.length ? (
                  <List
                    size="small"
                    dataSource={props.preflight.warnings}
                    renderItem={(item) => (
                      <List.Item>
                        <Alert type="warning" showIcon title={item} />
                      </List.Item>
                    )}
                  />
                ) : (
                  <Alert type="success" showIcon title="没有需要确认的警告" />
                ),
              },
              {
                key: 'info',
                label: (
                  <span>
                    <InfoCircleOutlined /> 提示
                  </span>
                ),
                children: (
                  <Alert
                    type="info"
                    showIcon
                    title="目录页码来自最终 PagePlan；选择导出位置后，后台会逐页转换为 A4、添加统一页码并重新打开输出进行校验。"
                  />
                ),
              },
            ]}
          />
        </Space>
      ) : null}
    </Modal>
  )
}
