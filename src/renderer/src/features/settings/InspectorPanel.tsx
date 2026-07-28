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
import type {
  Material,
  OutlineNode,
  Project,
  Rotation,
} from '../../../../shared/schemas/project-schema.js'
import { parsePageRange } from '../../../../shared/utils/page-range.js'
import { stripSequencePrefix } from '../../../../shared/utils/sequence-label.js'
import type { Selection } from '../../stores/project-store.js'
import { findMaterial, findOutlineNode } from '../../utils/project.js'

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
  onReconvertOffice: (materialId: string) => void
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

const ProjectInspector = ({
  project,
  projectDirectory,
  onMutate,
  onExportPortable,
  onImportPortable,
  onClearCache,
}: Pick<
  InspectorPanelProps,
  | 'project'
  | 'projectDirectory'
  | 'onMutate'
  | 'onExportPortable'
  | 'onImportPortable'
  | 'onClearCache'
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
          { key: 'schema', label: '格式版本', children: `schemaVersion ${project.schemaVersion}` },
        ]}
      />
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

const MaterialInspector = ({
  project,
  material,
  onMutate,
  onSelect,
  onRelocate,
  onReconvertOffice,
}: {
  project: Project
  material: Material
  onMutate: InspectorPanelProps['onMutate']
  onSelect: InspectorPanelProps['onSelect']
  onRelocate: InspectorPanelProps['onRelocate']
  onReconvertOffice: InspectorPanelProps['onReconvertOffice']
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
          },
          { kind: 'project', id: project.id },
        ),
    })
  }
  const directoryOptions = project.outlineNodes.flatMap((node) =>
    node.children.map((child) => ({ value: child.id, label: `${node.title} / ${child.title}` })),
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
          {(material.sourceType === 'pdf' || material.sourceType === 'office') && (
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
              children:
                material.sourceType === 'pdf'
                  ? 'PDF'
                  : material.sourceType === 'office'
                    ? `Office（${material.sourceItems[0]?.conversion?.officeFormat.toUpperCase() ?? '未知'}）`
                    : material.sourceType === 'imageCollection'
                      ? '图片集合'
                      : '图片',
            },
            { key: 'name', label: '原始文件', children: material.originalFileName },
            { key: 'pages', label: '原始页数', children: material.pageCount },
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
                  {material.validationStatus}
                </Tag>
              ),
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
        <Divider />
        <Typography.Text strong>来源文件维护</Typography.Text>
        <Space orientation="vertical" className="source-maintenance-list">
          {material.sourceItems.map((source) => (
            <Button
              key={source.id}
              icon={<FileSearchOutlined />}
              onClick={() => onRelocate(material.id, source.id)}
            >
              重新定位：{source.originalFileName}
            </Button>
          ))}
        </Space>
        {material.sourceType === 'office' ? (
          <Button icon={<RollbackOutlined />} onClick={() => onReconvertOffice(material.id)}>
            重新转换 Office 快照
          </Button>
        ) : null}
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
}: {
  project: Project
  page: PlannedPage
  onMutate: InspectorPanelProps['onMutate']
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
            { key: 'type', label: '页面类型', children: page.pageType },
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
            { key: 'rotation', label: '附加旋转', children: `${page.rotation}°` },
            {
              key: 'source',
              label: '来源页',
              children:
                page.sourcePageIndex === null ? '生成页' : `第 ${page.sourcePageIndex + 1} 页`,
            },
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
          />
        </aside>
      )
  }
  if (selection.kind === 'page') {
    const page = props.plan?.pages.find((candidate) => candidate.id === selection.id)
    if (page)
      return (
        <aside className="inspector-panel">
          <PageInspector project={props.project} page={page} onMutate={props.onMutate} />
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
      />
    </aside>
  )
}
