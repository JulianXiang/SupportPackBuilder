import {
  ClearOutlined,
  DeleteOutlined,
  ExportOutlined,
  FileSearchOutlined,
  ImportOutlined,
  RollbackOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Collapse,
  DatePicker,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import type { PagePlan, PlannedPage } from '../../../../shared/schemas/page-plan-schema.js'
import type { ExperienceMode } from '../../../../shared/schemas/preferences-schema.js'
import type {
  Material,
  MaterialSource,
  OutlineNode,
  Project,
  Rotation,
} from '../../../../shared/schemas/project-schema.js'
import { parsePageRange } from '../../../../shared/utils/page-range.js'
import { stripSequencePrefix } from '../../../../shared/utils/sequence-label.js'
import type { Selection } from '../../stores/project-store.js'
import {
  findMaterial,
  findOutlineNode,
  removeMaterialsFromLayoutSheets,
} from '../../utils/project.js'

type CommitInputProps = {
  id?: string
  value: string
  multiline?: boolean
  maxLength?: number
  onCommit: (value: string) => void
}

const CommitInput = (props: CommitInputProps): React.JSX.Element => {
  const [value, setValue] = useState(props.value)
  useEffect(() => setValue(props.value), [props.value])
  const common = {
    id: props.id,
    value,
    maxLength: props.maxLength,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue(event.target.value),
    onBlur: () => {
      if (value !== props.value) props.onCommit(value.trim())
    },
  }
  return props.multiline ? <Input.TextArea {...common} rows={4} /> : <Input {...common} />
}

type InspectorPanelProps = {
  project: Project
  projectDirectory: string
  plan: PagePlan | null
  selection: Selection | null
  onMutate: (mutator: (draft: Project) => void, selection?: Selection) => void
  onSelect: (selection: Selection) => void
  onExportPortable: () => void
  onImportPortable: () => void
  onClearCache: () => void
  onRelocate: (materialId: string, sourceId: string) => void
  onReconvertOffice: (materialId: string, sourceId?: string) => void
  experienceMode: ExperienceMode
  maintenanceRequest: {
    token: number
    materialId: string
  } | null
}

const PanelTitle = ({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}): React.JSX.Element => (
  <div className="panel-heading inspector-heading">
    <div>
      <strong>{title}</strong>
      <span className="panel-subtitle">{subtitle}</span>
    </div>
  </div>
)

const withoutRotation = (
  values: Record<string, Rotation>,
  sourcePageId: string,
): Record<string, Rotation> =>
  Object.fromEntries(Object.entries(values).filter(([id]) => id !== sourcePageId))

const VALIDATION_STATUS_LABELS: Record<Material['validationStatus'], string> = {
  valid: '正常',
  warning: '需要检查',
  error: '错误',
  missing: '文件缺失',
  encrypted: '文件已加密',
  unsupported: '格式不支持',
}

const ProjectInspector = ({
  project,
  projectDirectory,
  onMutate,
  onExportPortable,
  onImportPortable,
  onClearCache,
  experienceMode,
}: Pick<
  InspectorPanelProps,
  | 'project'
  | 'projectDirectory'
  | 'onMutate'
  | 'onExportPortable'
  | 'onImportPortable'
  | 'onClearCache'
  | 'experienceMode'
>): React.JSX.Element => (
  <>
    <PanelTitle title="项目属性" subtitle="封面基础信息与存储方式" />
    <div className="inspector-scroll">
      <Form layout="vertical" size="small">
        <Form.Item label="项目名称" htmlFor="project-title">
          <CommitInput
            id="project-title"
            value={project.title}
            maxLength={300}
            onCommit={(value) =>
              value &&
              onMutate((draft) => {
                draft.title = value
                draft.exportSettings.metadata.title = value
              })
            }
          />
        </Form.Item>
        <Form.Item label="姓名" htmlFor="project-owner-name">
          <CommitInput
            id="project-owner-name"
            value={project.ownerName}
            maxLength={100}
            onCommit={(value) =>
              onMutate((draft) => {
                draft.ownerName = value
                draft.exportSettings.metadata.author = value
              })
            }
          />
        </Form.Item>
        <Form.Item label="单位" htmlFor="project-organization">
          <CommitInput
            id="project-organization"
            value={project.organization}
            maxLength={200}
            onCommit={(value) =>
              onMutate((draft) => {
                draft.organization = value
              })
            }
          />
        </Form.Item>
        <Form.Item label="用途" htmlFor="project-purpose">
          <CommitInput
            id="project-purpose"
            value={project.purpose}
            multiline
            maxLength={500}
            onCommit={(value) =>
              onMutate((draft) => {
                draft.purpose = value
                draft.exportSettings.metadata.subject = value
              })
            }
          />
        </Form.Item>
        <Form.Item label="编制日期">
          <DatePicker
            value={dayjs(project.compiledDate)}
            style={{ width: '100%' }}
            onChange={(date) =>
              date &&
              onMutate((draft) => {
                draft.compiledDate = date.format('YYYY-MM-DD')
              })
            }
          />
        </Form.Item>
        <Form.Item
          label="文件存储方式"
          extra={
            project.assetStorageMode === 'copy'
              ? '导入文件复制到项目 assets 目录，便于迁移。'
              : '只引用外部绝对路径，文件移动后需要重新定位。'
          }
        >
          <Select
            value={project.assetStorageMode}
            options={[
              { value: 'copy', label: '复制到项目（推荐）' },
              { value: 'reference', label: '引用原文件' },
            ]}
            onChange={(value) =>
              onMutate((draft) => {
                draft.assetStorageMode = value
              })
            }
          />
        </Form.Item>
      </Form>
      {experienceMode === 'advanced' && (
        <Descriptions
          size="small"
          column={1}
          bordered
          items={[
            {
              key: 'path',
              label: '项目路径',
              children: <span className="path-value">{projectDirectory}</span>,
            },
            {
              key: 'schema',
              label: '格式版本',
              children: `schemaVersion ${project.schemaVersion}`,
            },
          ]}
        />
      )}
      <Divider />
      <Typography.Text strong>封面与目录</Typography.Text>
      <Alert
        className="validation-alert"
        type="info"
        showIcon
        title="当前默认采用参考材料的正式编排样式：分级标题与该项首张材料同页，正文页码使用“— 1 —”。"
      />
      <div className="switch-row">
        <span>生成封面</span>
        <Switch
          checked={project.coverSettings.enabled && project.exportSettings.includeCover}
          onChange={(checked) =>
            onMutate((draft) => {
              draft.coverSettings.enabled = checked
              draft.exportSettings.includeCover = checked
            })
          }
        />
      </div>
      <Form layout="vertical" size="small">
        <Form.Item label="封面标题" htmlFor="cover-title" required>
          <CommitInput
            id="cover-title"
            value={project.coverSettings.title}
            maxLength={300}
            onCommit={(value) =>
              value &&
              onMutate((draft) => {
                draft.coverSettings.title = value
              })
            }
          />
        </Form.Item>
        <Form.Item label="封面姓名" htmlFor="cover-owner-name">
          <CommitInput
            id="cover-owner-name"
            value={project.coverSettings.ownerName}
            maxLength={100}
            onCommit={(value) =>
              onMutate((draft) => {
                draft.coverSettings.ownerName = value
              })
            }
          />
        </Form.Item>
        <Form.Item label="封面单位" htmlFor="cover-organization">
          <CommitInput
            id="cover-organization"
            value={project.coverSettings.organization}
            maxLength={200}
            onCommit={(value) =>
              onMutate((draft) => {
                draft.coverSettings.organization = value
              })
            }
          />
        </Form.Item>
        <Form.Item label="封面用途" htmlFor="cover-purpose">
          <CommitInput
            id="cover-purpose"
            value={project.coverSettings.purpose}
            multiline
            maxLength={500}
            onCommit={(value) =>
              onMutate((draft) => {
                draft.coverSettings.purpose = value
              })
            }
          />
        </Form.Item>
        <Form.Item label="封面日期">
          <DatePicker
            value={dayjs(project.coverSettings.compiledDate)}
            style={{ width: '100%' }}
            onChange={(date) =>
              date &&
              onMutate((draft) => {
                draft.coverSettings.compiledDate = date.format('YYYY-MM-DD')
              })
            }
          />
        </Form.Item>
      </Form>
      <div className="switch-row">
        <span>生成目录</span>
        <Switch
          checked={project.tocSettings.enabled && project.exportSettings.includeToc}
          onChange={(checked) =>
            onMutate((draft) => {
              draft.tocSettings.enabled = checked
              draft.exportSettings.includeToc = checked
            })
          }
        />
      </div>
      <div className="switch-row">
        <span>封面后插入空白页（双面打印）</span>
        <Switch
          disabled={!project.coverSettings.enabled || !project.exportSettings.includeCover}
          checked={project.coverSettings.insertBlankBackPage}
          onChange={(checked) =>
            onMutate((draft) => {
              draft.coverSettings.insertBlankBackPage = checked
            })
          }
        />
      </div>
      <div className="switch-row">
        <span>统一页码</span>
        <Switch
          checked={project.pageNumberSettings.enabled && project.exportSettings.addPageNumbers}
          onChange={(checked) =>
            onMutate((draft) => {
              draft.pageNumberSettings.enabled = checked
              draft.exportSettings.addPageNumbers = checked
            })
          }
        />
      </div>
      <Form layout="vertical" size="small">
        <Form.Item label="目录标题">
          <CommitInput
            value={project.tocSettings.title}
            maxLength={100}
            onCommit={(value) =>
              value &&
              onMutate((draft) => {
                draft.tocSettings.title = value
              })
            }
          />
        </Form.Item>
        <Form.Item
          label="正文标题排版"
          extra="“与材料同页”会在分类、分组或材料第一次出现时，在证据页上方插入黑色分级标题。"
        >
          <Select
            value={project.exportSettings.contentHeadingMode}
            options={[
              { value: 'firstPage', label: '与材料首页同页（参考模板）' },
              { value: 'none', label: '不生成同页标题' },
            ]}
            onChange={(value) =>
              onMutate((draft) => {
                draft.exportSettings.contentHeadingMode = value
              })
            }
          />
        </Form.Item>
        <Form.Item label="正文起始页码">
          <InputNumber
            min={1}
            precision={0}
            value={project.pageNumberSettings.bodyStartNumber}
            onChange={(value) =>
              value &&
              onMutate((draft) => {
                draft.pageNumberSettings.bodyStartNumber = value
              })
            }
          />
        </Form.Item>
        <Form.Item label="页码格式">
          <Select
            value={project.pageNumberSettings.format}
            options={[
              { value: 'number', label: '1' },
              { value: 'dash', label: '— 1 —（参考模板）' },
              { value: 'chinese', label: '第 1 页' },
              { value: 'fraction', label: '1 / 50' },
            ]}
            onChange={(value) =>
              onMutate((draft) => {
                draft.pageNumberSettings.format = value
              })
            }
          />
        </Form.Item>
      </Form>
      <Divider />
      <Typography.Text strong>多图拼版默认设置</Typography.Text>
      <Typography.Paragraph type="secondary" className="maintenance-help">
        自动建议只创建可继续调整的草稿；最终清晰度仍以每个内容槽的检查结果为准。
      </Typography.Paragraph>
      <div className="switch-row">
        <span>启用多图拼版</span>
        <Switch
          checked={project.collageSettings.enabled}
          onChange={(checked) =>
            onMutate((draft) => {
              draft.collageSettings.enabled = checked
            })
          }
        />
      </div>
      <div className="switch-row">
        <span>允许保守自动去白边</span>
        <Switch
          checked={project.collageSettings.autoCropEnabled}
          onChange={(checked) =>
            onMutate((draft) => {
              draft.collageSettings.autoCropEnabled = checked
            })
          }
        />
      </div>
      <Form layout="vertical" size="small">
        <Form.Item label="新拼版页默认方向">
          <Select
            value={project.collageSettings.defaultOrientation}
            options={[
              { value: 'portrait', label: 'A4 纵向' },
              { value: 'landscape', label: 'A4 横向' },
            ]}
            onChange={(value) =>
              onMutate((draft) => {
                draft.collageSettings.defaultOrientation = value
              })
            }
          />
        </Form.Item>
        {experienceMode === 'advanced' && (
          <Form.Item label="自动去白边安全边（mm）">
            <InputNumber
              min={0}
              max={20}
              step={0.5}
              value={project.collageSettings.autoCropSafetyMillimeters}
              onChange={(value) =>
                value !== null &&
                onMutate((draft) => {
                  draft.collageSettings.autoCropSafetyMillimeters = value
                })
              }
            />
          </Form.Item>
        )}
        {experienceMode === 'advanced' && (
          <Form.Item
            label="图片清晰度（推荐 / 最低 DPI）"
            extra="低于最低值的自动拼版会被阻止；手动拼版必须逐槽确认风险。"
          >
            <Space.Compact>
              <InputNumber
                min={72}
                max={600}
                precision={0}
                value={project.collageSettings.rasterPreferredDpi}
                onChange={(value) =>
                  value !== null &&
                  value >= project.collageSettings.rasterMinimumAutoDpi &&
                  onMutate((draft) => {
                    draft.collageSettings.rasterPreferredDpi = value
                  })
                }
              />
              <InputNumber
                min={72}
                max={project.collageSettings.rasterPreferredDpi}
                precision={0}
                value={project.collageSettings.rasterMinimumAutoDpi}
                onChange={(value) =>
                  value !== null &&
                  value <= project.collageSettings.rasterPreferredDpi &&
                  onMutate((draft) => {
                    draft.collageSettings.rasterMinimumAutoDpi = value
                  })
                }
              />
            </Space.Compact>
          </Form.Item>
        )}
        {experienceMode === 'advanced' && (
          <Form.Item
            label="PDF 缩放（警告 / 最低）"
            extra="例如 0.50 表示来源页按 50% 线性比例输出。"
          >
            <Space.Compact>
              <InputNumber
                min={0.1}
                max={1}
                step={0.05}
                value={project.collageSettings.pdfWarningScale}
                onChange={(value) =>
                  value !== null &&
                  value >= project.collageSettings.pdfMinimumAutoScale &&
                  onMutate((draft) => {
                    draft.collageSettings.pdfWarningScale = value
                  })
                }
              />
              <InputNumber
                min={0.1}
                max={project.collageSettings.pdfWarningScale}
                step={0.05}
                value={project.collageSettings.pdfMinimumAutoScale}
                onChange={(value) =>
                  value !== null &&
                  value <= project.collageSettings.pdfWarningScale &&
                  onMutate((draft) => {
                    draft.collageSettings.pdfMinimumAutoScale = value
                  })
                }
              />
            </Space.Compact>
          </Form.Item>
        )}
      </Form>
      {experienceMode === 'advanced' && (
        <>
          <Divider />
          <Typography.Text strong>项目维护</Typography.Text>
          <Space wrap className="project-maintenance-actions">
            <Button icon={<ExportOutlined />} onClick={onExportPortable}>
              导出便携包
            </Button>
            <Button icon={<ImportOutlined />} onClick={onImportPortable}>
              导入便携包
            </Button>
            <Button icon={<ClearOutlined />} onClick={onClearCache}>
              清理缓存
            </Button>
          </Space>
          <Typography.Paragraph type="secondary" className="maintenance-help">
            便携包仅包含 project.json、assets 和版本信息，不包含缓存、临时文件与导出结果。
          </Typography.Paragraph>
        </>
      )}
    </div>
  </>
)

const OutlineInspector = ({
  node,
  onMutate,
}: {
  node: OutlineNode
  onMutate: InspectorPanelProps['onMutate']
}): React.JSX.Element => (
  <>
    <PanelTitle title="目录属性" subtitle={node.level === 1 ? '一级分类' : '二级材料分组'} />
    <div className="inspector-scroll">
      <Form layout="vertical" size="small">
        <Form.Item label="目录标题">
          <CommitInput
            value={node.title}
            maxLength={200}
            onCommit={(value) =>
              value &&
              onMutate((draft) => {
                const found = findOutlineNode(draft, node.id)
                if (found) found.node.title = stripSequencePrefix(value, node.level)
              })
            }
          />
        </Form.Item>
        <Form.Item label="目录层级">
          <Input value={node.level === 1 ? '一级目录' : '二级目录'} disabled />
        </Form.Item>
        <Form.Item label="排序">
          <InputNumber value={node.order + 1} disabled />
        </Form.Item>
      </Form>
      <div className="switch-row">
        <span>启用此目录</span>
        <Switch
          checked={node.enabled}
          onChange={(checked) =>
            onMutate((draft) => {
              const found = findOutlineNode(draft, node.id)
              if (found) found.node.enabled = checked
            })
          }
        />
      </div>
      <div className="switch-row">
        <span>插入分类标题页</span>
        <Switch
          checked={node.insertDividerPage}
          onChange={(checked) =>
            onMutate((draft) => {
              const found = findOutlineNode(draft, node.id)
              if (found) found.node.insertDividerPage = checked
            })
          }
        />
      </div>
      <Alert
        type="info"
        showIcon
        title={
          node.level === 1
            ? `包含 ${node.children.length} 个二级目录。禁用后，其下全部材料不会导出。`
            : `包含 ${node.materials.length} 项材料。材料只能导入到二级目录。`
        }
      />
      <Divider />
      <Typography.Text type="secondary">
        拖拽左侧目录行可在同级内排序。跨级移动不被允许。
      </Typography.Text>
    </div>
  </>
)

const MaterialSourceEditor = ({
  material,
  source,
  onMutate,
  onRelocate,
  onReconvertOffice,
}: {
  material: Material
  source: MaterialSource
  onMutate: InspectorPanelProps['onMutate']
  onRelocate: InspectorPanelProps['onRelocate']
  onReconvertOffice: InspectorPanelProps['onReconvertOffice']
}): React.JSX.Element => {
  const [rangeValue, setRangeValue] = useState(source.selectedPageRanges)
  useEffect(() => setRangeValue(source.selectedPageRanges), [source.id, source.selectedPageRanges])
  const pageCount = source.conversion?.pageCount ?? source.pageCount
  const parsedRange = source.sourceType === 'image' ? null : parsePageRange(rangeValue, pageCount)
  return (
    <div className="material-source-editor">
      <div className="material-source-editor-heading">
        <div>
          <strong>{source.originalFileName}</strong>
          <small>
            {source.sourceType === 'pdf'
              ? `PDF · ${pageCount} 页`
              : source.sourceType === 'office'
                ? `${source.conversion?.officeFormat.toUpperCase() ?? 'OFFICE'} 快照 · ${pageCount} 页`
                : `图片 · ${source.width ?? '?'}×${source.height ?? '?'}`}
          </small>
        </div>
        <Tag>{source.sourceType === 'office' ? 'Office' : source.sourceType.toUpperCase()}</Tag>
      </div>
      {source.sourceType !== 'image' && material.sourceItems.length > 1 && (
        <div>
          <label className="source-range-label">此来源使用页码</label>
          <Input
            size="small"
            value={rangeValue}
            status={parsedRange?.success === false ? 'error' : ''}
            placeholder="例如 1-3,6 或 all"
            onChange={(event) => setRangeValue(event.target.value)}
            onBlur={() => {
              if (!parsedRange?.success || rangeValue === source.selectedPageRanges) return
              onMutate((draft) => {
                const found = findMaterial(draft, material.id)
                const targetSource = found?.material.sourceItems.find(
                  (candidate) => candidate.id === source.id,
                )
                if (targetSource) targetSource.selectedPageRanges = rangeValue
              })
            }}
          />
          {parsedRange?.success === false && (
            <Typography.Text type="danger">{parsedRange.errors[0]?.message}</Typography.Text>
          )}
        </div>
      )}
      <Space wrap>
        <Button
          size="small"
          icon={<FileSearchOutlined />}
          onClick={() => onRelocate(material.id, source.id)}
        >
          重新定位
        </Button>
        {source.sourceType === 'office' && (
          <Button
            size="small"
            icon={<RollbackOutlined />}
            onClick={() => onReconvertOffice(material.id, source.id)}
          >
            重新转换快照
          </Button>
        )}
      </Space>
    </div>
  )
}

const MaterialInspector = ({
  project,
  material,
  onMutate,
  onSelect,
  onRelocate,
  onReconvertOffice,
  experienceMode,
  maintenanceRequest,
}: {
  project: Project
  material: Material
  onMutate: InspectorPanelProps['onMutate']
  onSelect: InspectorPanelProps['onSelect']
  onRelocate: InspectorPanelProps['onRelocate']
  onReconvertOffice: InspectorPanelProps['onReconvertOffice']
  experienceMode: ExperienceMode
  maintenanceRequest: InspectorPanelProps['maintenanceRequest']
}): React.JSX.Element => {
  const { modal } = App.useApp()
  const [rangeValue, setRangeValue] = useState(material.selectedPageRanges)
  useEffect(
    () => setRangeValue(material.selectedPageRanges),
    [material.id, material.selectedPageRanges],
  )
  const parsedRange =
    material.sourceType === 'pdf' || material.sourceType === 'office'
      ? parsePageRange(rangeValue, material.pageCount)
      : null
  const deleteMaterial = (): void => {
    modal.confirm({
      title: `删除材料“${material.title}”？`,
      content: '项目内复制的原始资产不会立即删除，可通过撤销恢复材料配置。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () =>
        onMutate(
          (draft) => {
            draft.outlineNodes.forEach((node) =>
              node.children.forEach((child) => {
                child.materials = child.materials.filter((item) => item.id !== material.id)
              }),
            )
            removeMaterialsFromLayoutSheets(draft, [material.id])
          },
          { kind: 'project', id: project.id },
        ),
    })
  }
  const directoryOptions = project.outlineNodes.flatMap((node) =>
    node.children.map((child) => ({ value: child.id, label: `${node.title} / ${child.title}` })),
  )
  const sourceTypeLabel =
    material.sourceType === 'pdf'
      ? 'PDF'
      : material.sourceType === 'office'
        ? `Office（${material.sourceItems[0]?.conversion?.officeFormat.toUpperCase() ?? '未知'}）`
        : material.sourceType === 'mixed'
          ? `混合来源（${material.sourceItems.length} 个文件）`
          : material.sourceType === 'imageCollection'
            ? '图片集合'
            : '图片'
  const hasMaintenanceIssue = material.validationMessages.some(
    (item) => item.code.startsWith('source-') || item.code.startsWith('office-snapshot-'),
  )
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(
    hasMaintenanceIssue || maintenanceRequest?.materialId === material.id,
  )
  useEffect(() => {
    setTechnicalDetailsOpen(hasMaintenanceIssue || maintenanceRequest?.materialId === material.id)
  }, [hasMaintenanceIssue, maintenanceRequest?.token, material.id])
  const technicalDetails = (
    <>
      <Descriptions
        size="small"
        column={1}
        bordered
        items={[
          {
            key: 'conversion',
            label: '转换快照',
            children:
              material.sourceType === 'office'
                ? `${material.sourceItems[0]?.conversion?.engineVersion ?? '不可用'} · ${
                    material.sourceItems[0]?.conversion?.pageCount ?? 0
                  } 页 · ${material.sourceItems[0]?.conversion?.snapshotStatus ?? 'error'}`
                : '不适用',
          },
          {
            key: 'path',
            label: '来源路径',
            children: (
              <span className="path-value">{material.storedPath ?? material.sourcePath}</span>
            ),
          },
        ]}
      />
      <Divider />
      <Typography.Text strong>来源文件维护</Typography.Text>
      <Space orientation="vertical" className="source-maintenance-list">
        {material.sourceItems.map((source) => (
          <MaterialSourceEditor
            key={source.id}
            material={material}
            source={source}
            onMutate={onMutate}
            onRelocate={onRelocate}
            onReconvertOffice={onReconvertOffice}
          />
        ))}
      </Space>
    </>
  )
  return (
    <>
      <PanelTitle title="材料属性" subtitle={material.originalFileName} />
      <div className="inspector-scroll">
        <Form layout="vertical" size="small">
          <Form.Item label="材料标题">
            <CommitInput
              value={material.title}
              maxLength={300}
              onCommit={(value) =>
                value &&
                onMutate((draft) => {
                  const found = findMaterial(draft, material.id)
                  if (found) found.material.title = stripSequencePrefix(value, 3)
                })
              }
            />
          </Form.Item>
          <Form.Item label="材料类型">
            <Select
              value={material.category}
              options={[
                { value: '论文', label: '论文' },
                { value: '专利', label: '专利' },
                { value: '软件著作权', label: '软件著作权' },
                { value: '科研项目', label: '科研项目' },
                { value: '获奖证书', label: '获奖证书' },
                { value: '教学成果', label: '教学成果' },
                { value: '资格证书', label: '资格证书' },
                { value: '其他材料', label: '其他材料' },
              ]}
              onChange={(value) =>
                onMutate((draft) => {
                  const found = findMaterial(draft, material.id)
                  if (found) found.material.category = value
                })
              }
            />
          </Form.Item>
          <Form.Item label="所属目录">
            <Select
              value={material.outlineNodeId}
              options={directoryOptions}
              onChange={(targetId) =>
                onMutate((draft) => {
                  const moving = findMaterial(draft, material.id)?.material ?? null
                  draft.outlineNodes.forEach((node) =>
                    node.children.forEach((child) => {
                      child.materials = child.materials.filter(
                        (candidate) => candidate.id !== material.id,
                      )
                    }),
                  )
                  const target = draft.outlineNodes
                    .flatMap((node) => node.children)
                    .find((node) => node.id === targetId)
                  if (moving && target) {
                    moving.outlineNodeId = target.id
                    moving.order = target.materials.length
                    target.materials.push(moving)
                  }
                })
              }
            />
          </Form.Item>
          {(material.sourceType === 'pdf' || material.sourceType === 'office') &&
            experienceMode === 'basic' && (
              <Form.Item label="参与编排的页面">
                <Select
                  aria-label="参与编排的页面"
                  value={rangeValue.toLowerCase() === 'all' ? 'all' : 'custom'}
                  options={[
                    { value: 'all', label: '全部页面' },
                    { value: 'custom', label: '指定页码范围' },
                  ]}
                  onChange={(value) => {
                    const next = value === 'all' ? 'all' : `1-${material.pageCount}`
                    setRangeValue(next)
                    onMutate((draft) => {
                      const found = findMaterial(draft, material.id)
                      if (found) found.material.selectedPageRanges = next
                    })
                  }}
                />
                {rangeValue.toLowerCase() !== 'all' && (
                  <Input
                    className="page-range-detail-input"
                    aria-label="PDF 页码范围"
                    value={rangeValue}
                    status={parsedRange?.success === false ? 'error' : ''}
                    onChange={(event) => setRangeValue(event.target.value)}
                    onBlur={() => {
                      if (parsedRange?.success && rangeValue !== material.selectedPageRanges)
                        onMutate((draft) => {
                          const found = findMaterial(draft, material.id)
                          if (found) found.material.selectedPageRanges = rangeValue
                        })
                    }}
                    placeholder="例如 1-3,6,8-10"
                  />
                )}
                {parsedRange?.success === false && (
                  <Typography.Text type="danger">{parsedRange.errors[0]?.message}</Typography.Text>
                )}
              </Form.Item>
            )}
          {(material.sourceType === 'pdf' || material.sourceType === 'office') &&
            experienceMode === 'advanced' && (
              <Form.Item
                label="PDF 页码范围"
                validateStatus={
                  parsedRange?.success === false
                    ? 'error'
                    : parsedRange?.warnings.length
                      ? 'warning'
                      : ''
                }
                help={
                  parsedRange?.success === false
                    ? parsedRange.errors[0]?.message
                    : parsedRange?.warnings.map((warning) => warning.message).join(' ')
                }
              >
                <Input
                  aria-label="PDF 页码范围"
                  value={rangeValue}
                  onChange={(event) => setRangeValue(event.target.value)}
                  onBlur={() => {
                    if (parsedRange?.success && rangeValue !== material.selectedPageRanges)
                      onMutate((draft) => {
                        const found = findMaterial(draft, material.id)
                        if (found) found.material.selectedPageRanges = rangeValue
                      })
                  }}
                  placeholder="例如 1-3,6,8-10 或 all"
                />
              </Form.Item>
            )}
          <Form.Item label="备注">
            <CommitInput
              value={material.notes}
              multiline
              maxLength={5000}
              onCommit={(value) =>
                onMutate((draft) => {
                  const found = findMaterial(draft, material.id)
                  if (found) found.material.notes = value
                })
              }
            />
          </Form.Item>
        </Form>
        <div className="switch-row">
          <span>启用此材料</span>
          <Switch
            checked={material.enabled}
            onChange={(checked) =>
              onMutate((draft) => {
                const found = findMaterial(draft, material.id)
                if (found) found.material.enabled = checked
              })
            }
          />
        </div>
        <div className="switch-row">
          <span>插入材料标题页</span>
          <Switch
            checked={material.insertTitlePage}
            onChange={(checked) =>
              onMutate((draft) => {
                const found = findMaterial(draft, material.id)
                if (found) found.material.insertTitlePage = checked
              })
            }
          />
        </div>
        <Descriptions
          size="small"
          column={1}
          bordered
          items={[
            {
              key: 'type',
              label: '来源类型',
              children: sourceTypeLabel,
            },
            { key: 'name', label: '原始文件', children: material.originalFileName },
            { key: 'pages', label: '原始页数', children: material.pageCount },
            {
              key: 'size',
              label: '文件大小',
              children: `${(material.fileSize / 1024 / 1024).toFixed(2)} MB`,
            },
            {
              key: 'status',
              label: '文件状态',
              children: (
                <Tag
                  color={
                    material.validationStatus === 'valid'
                      ? 'green'
                      : material.validationStatus === 'warning'
                        ? 'orange'
                        : 'red'
                  }
                >
                  {VALIDATION_STATUS_LABELS[material.validationStatus]}
                </Tag>
              ),
            },
          ]}
        />
        {material.validationMessages.map((item) => (
          <Alert
            key={item.code + item.message}
            className="validation-alert"
            type={
              item.severity === 'error' ? 'error' : item.severity === 'warning' ? 'warning' : 'info'
            }
            showIcon
            icon={<WarningOutlined />}
            title={item.message}
            description={item.suggestion}
          />
        ))}
        {experienceMode === 'advanced' ? (
          technicalDetails
        ) : (
          <Collapse
            className="technical-details-collapse"
            activeKey={technicalDetailsOpen ? ['technical'] : []}
            onChange={(keys) => setTechnicalDetailsOpen(keys.includes('technical'))}
            items={[
              {
                key: 'technical',
                label: hasMaintenanceIssue
                  ? '技术详情与来源维护（需要处理）'
                  : '技术详情与来源维护',
                children: technicalDetails,
              },
            ]}
          />
        )}
        {material.removedPages.length > 0 && (
          <Alert
            className="validation-alert"
            type="warning"
            showIcon
            title={`已删除 ${material.removedPages.length} 个页面`}
            action={
              <Button
                size="small"
                icon={<RollbackOutlined />}
                onClick={() =>
                  onMutate((draft) => {
                    const found = findMaterial(draft, material.id)
                    if (found) found.material.removedPages = []
                  })
                }
              >
                全部恢复
              </Button>
            }
          />
        )}
        <Divider />
        <Space>
          <Button danger icon={<DeleteOutlined />} onClick={deleteMaterial}>
            删除材料
          </Button>
          {material.sourceItems.length > 1 && (
            <Button onClick={() => onSelect({ kind: 'material', id: material.id })}>
              管理 {material.sourceItems.length} 张图片
            </Button>
          )}
        </Space>
      </div>
    </>
  )
}

const PageInspector = ({
  project,
  page,
  onMutate,
  experienceMode,
}: {
  project: Project
  page: PlannedPage
  onMutate: InspectorPanelProps['onMutate']
  experienceMode: ExperienceMode
}): React.JSX.Element => {
  const material = page.materialId ? findMaterial(project, page.materialId)?.material : null
  return (
    <>
      <PanelTitle title="页面属性" subtitle={`物理页 ${page.physicalIndex + 1}`} />
      <div className="inspector-scroll">
        <Descriptions
          size="small"
          column={1}
          bordered
          items={[
            { key: 'title', label: '页面标题', children: page.displayTitle },
            {
              key: 'logical',
              label: '逻辑页码',
              children: page.logicalPageNumber?.label ?? '不计入',
            },
            {
              key: 'orientation',
              label: '目标方向',
              children: page.targetOrientation === 'portrait' ? 'A4 纵向' : 'A4 横向',
            },
            ...(experienceMode === 'advanced'
              ? [
                  { key: 'type', label: '页面类型', children: page.pageType },
                  { key: 'rotation', label: '附加旋转', children: `${page.rotation}°` },
                  {
                    key: 'source',
                    label: '来源页',
                    children:
                      page.sourcePageIndex === null
                        ? '生成页'
                        : `第 ${page.sourcePageIndex + 1} 页`,
                  },
                ]
              : []),
          ]}
        />
        {material && page.sourcePageId ? (
          <>
            <Divider />
            <Typography.Text strong>页面编辑</Typography.Text>
            <div className="page-edit-buttons">
              <Button
                onClick={() =>
                  onMutate((draft) => {
                    const found = findMaterial(draft, material.id)
                    if (found && page.sourcePageId)
                      found.material.rotationByPage[page.sourcePageId] = ((page.rotation + 90) %
                        360) as 0 | 90 | 180 | 270
                  })
                }
              >
                顺时针旋转
              </Button>
              <Button
                onClick={() =>
                  onMutate((draft) => {
                    const found = findMaterial(draft, material.id)
                    if (found && page.sourcePageId)
                      found.material.rotationByPage = withoutRotation(
                        found.material.rotationByPage,
                        page.sourcePageId,
                      )
                  })
                }
              >
                恢复方向
              </Button>
              <Button
                danger
                onClick={() =>
                  onMutate((draft) => {
                    const found = findMaterial(draft, material.id)
                    if (
                      found &&
                      page.sourcePageId &&
                      !found.material.removedPages.includes(page.sourcePageId)
                    )
                      found.material.removedPages.push(page.sourcePageId)
                  })
                }
              >
                删除页面
              </Button>
            </div>
            <Alert type="info" showIcon title="页面编辑只修改项目配置，不会修改原始 PDF 或图片。" />
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            title="封面、目录和标题页由对应设置控制，不能直接删除或拖拽。"
          />
        )}
      </div>
    </>
  )
}

export const InspectorPanel = (props: InspectorPanelProps): React.JSX.Element => {
  const selection = props.selection ?? { kind: 'project' as const, id: props.project.id }
  if (selection.kind === 'outline') {
    const node = findOutlineNode(props.project, selection.id)?.node
    if (node)
      return (
        <aside className="inspector-panel">
          <OutlineInspector node={node} onMutate={props.onMutate} />
        </aside>
      )
  }
  if (selection.kind === 'material') {
    const material = findMaterial(props.project, selection.id)?.material
    if (material)
      return (
        <aside className="inspector-panel">
          <MaterialInspector
            project={props.project}
            material={material}
            onMutate={props.onMutate}
            onSelect={props.onSelect}
            onRelocate={props.onRelocate}
            onReconvertOffice={props.onReconvertOffice}
            experienceMode={props.experienceMode}
            maintenanceRequest={props.maintenanceRequest}
          />
        </aside>
      )
  }
  if (selection.kind === 'page') {
    const page = props.plan?.pages.find((candidate) => candidate.id === selection.id)
    if (page)
      return (
        <aside className="inspector-panel">
          <PageInspector
            project={props.project}
            page={page}
            onMutate={props.onMutate}
            experienceMode={props.experienceMode}
          />
        </aside>
      )
  }
  if (selection.kind !== 'project')
    return (
      <aside className="inspector-panel">
        <PanelTitle title="属性" subtitle="当前对象不可用" />
        <Empty description="请选择项目、目录、材料或页面" />
      </aside>
    )
  return (
    <aside className="inspector-panel">
      <ProjectInspector
        project={props.project}
        projectDirectory={props.projectDirectory}
        onMutate={props.onMutate}
        onExportPortable={props.onExportPortable}
        onImportPortable={props.onImportPortable}
        onClearCache={props.onClearCache}
        experienceMode={props.experienceMode}
      />
    </aside>
  )
}
