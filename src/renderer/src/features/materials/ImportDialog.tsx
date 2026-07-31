import { Alert, Input, Modal, Radio, Select, Space, Table, Tag, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../../../../shared/schemas/project-schema.js'
import type {
  DuplicateResolution,
  ImportAnalysis,
  ImportCommitInput,
} from '../../../../shared/types/import.js'

type ImportDialogProps = {
  analysis: ImportAnalysis | null
  project: Project
  targetOutlineNodeId: string | null
  committing: boolean
  onCancel: () => void
  onCommit: (input: ImportCommitInput) => void
}

export const ImportDialog = (props: ImportDialogProps): React.JSX.Element => {
  const [targetId, setTargetId] = useState(props.targetOutlineNodeId ?? '')
  const [imageGrouping, setImageGrouping] = useState<'separate' | 'collection'>('separate')
  const [materialGrouping, setMaterialGrouping] = useState<'separate' | 'singleResult'>('separate')
  const [groupedMaterialTitle, setGroupedMaterialTitle] = useState('')
  const [actions, setActions] = useState<Record<string, 'import' | 'skip' | 'replace'>>({})
  useEffect(() => {
    if (!props.analysis) return
    setTargetId(props.targetOutlineNodeId ?? props.project.outlineNodes[0]?.children[0]?.id ?? '')
    setImageGrouping('separate')
    setMaterialGrouping('separate')
    setGroupedMaterialTitle('')
    setActions(
      Object.fromEntries(
        props.analysis.candidates.map((candidate) => [
          candidate.id,
          candidate.validationStatus === 'error' || candidate.validationStatus === 'encrypted'
            ? 'skip'
            : candidate.duplicateMaterialIds.length > 0
              ? 'skip'
              : 'import',
        ]),
      ),
    )
  }, [props.analysis, props.project, props.targetOutlineNodeId])
  const directoryOptions = props.project.outlineNodes.flatMap((node) =>
    node.children.map((child) => ({ value: child.id, label: `${node.title} / ${child.title}` })),
  )
  const imageCount =
    props.analysis?.candidates.filter(
      (candidate) => candidate.sourceType === 'image' && candidate.validationStatus !== 'error',
    ).length ?? 0
  const importableCount =
    props.analysis?.candidates.filter(
      (candidate) =>
        candidate.validationStatus !== 'error' && candidate.validationStatus !== 'encrypted',
    ).length ?? 0
  const resolutions = useMemo<DuplicateResolution[]>(
    () =>
      props.analysis?.candidates.map((candidate) => {
        const action = actions[candidate.id] ?? 'skip'
        if (action === 'replace') {
          const materialId = candidate.duplicateMaterialIds[0]
          return materialId
            ? { candidateId: candidate.id, action, materialId }
            : { candidateId: candidate.id, action: 'skip' }
        }
        return { candidateId: candidate.id, action }
      }) ?? [],
    [actions, props.analysis],
  )
  return (
    <Modal
      open={Boolean(props.analysis)}
      width={900}
      title="导入材料检查"
      okText="确认导入"
      cancelText="取消"
      confirmLoading={props.committing}
      okButtonProps={{
        disabled:
          !targetId ||
          resolutions.every((resolution) => resolution.action === 'skip') ||
          (materialGrouping === 'singleResult' && groupedMaterialTitle.trim().length === 0),
      }}
      onCancel={props.onCancel}
      onOk={() =>
        props.analysis &&
        props.onCommit({
          token: props.analysis.token,
          targetOutlineNodeId: targetId,
          materialGrouping,
          ...(materialGrouping === 'singleResult'
            ? { groupedMaterialTitle: groupedMaterialTitle.trim() }
            : {}),
          imageGrouping,
          resolutions,
        })
      }
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <div className="import-options">
          <label>
            <span>导入到</span>
            <Select
              value={targetId || null}
              placeholder="选择二级目录"
              options={directoryOptions}
              style={{ width: 390 }}
              onChange={setTargetId}
            />
          </label>
          {importableCount > 1 && (
            <label>
              <span>成果归组</span>
              <Radio.Group
                className="material-grouping-options"
                aria-label="成果归组"
                value={materialGrouping}
                onChange={(event) =>
                  setMaterialGrouping(event.target.value as 'separate' | 'singleResult')
                }
              >
                <Radio value="separate">分别创建成果</Radio>
                <Radio value="singleResult">合并为同一项成果</Radio>
              </Radio.Group>
            </label>
          )}
          {materialGrouping === 'singleResult' && (
            <label>
              <span>成果名称</span>
              <Input
                value={groupedMaterialTitle}
                maxLength={300}
                placeholder="例如：学生竞赛获奖（证书、名单与现场照片）"
                style={{ width: 390 }}
                onChange={(event) => setGroupedMaterialTitle(event.target.value)}
              />
            </label>
          )}
          {materialGrouping === 'separate' && imageCount > 1 && (
            <label>
              <span>多张图片</span>
              <Radio.Group
                className="image-grouping-options"
                aria-label="多张图片归组"
                value={imageGrouping}
                onChange={(event) =>
                  setImageGrouping(event.target.value as 'separate' | 'collection')
                }
              >
                <Radio value="separate">分别作为材料</Radio>
                <Radio value="collection">合并为同一材料</Radio>
              </Radio.Group>
            </label>
          )}
        </div>
        <Alert
          type="info"
          showIcon
          title="文件已经过真实格式、读取权限、哈希、页数/尺寸和加密状态检查。复制模式将在确认后写入项目 assets 目录。"
        />
        <Table
          size="small"
          pagination={false}
          rowKey="id"
          scroll={{ y: 360 }}
          dataSource={props.analysis?.candidates ?? []}
          columns={[
            {
              title: '文件',
              dataIndex: 'originalFileName',
              ellipsis: true,
              render: (value: string, row) => (
                <div>
                  <Typography.Text>{value}</Typography.Text>
                  <div className="table-subtext">
                    {row.sourceType === 'pdf'
                      ? `${row.pageCount} 页 PDF`
                      : row.sourceType === 'office'
                        ? `${row.pageCount} 页 ${row.officeFormat?.toUpperCase() ?? 'OFFICE'} 转换快照`
                        : `${row.width ?? '?'}×${row.height ?? '?'} 图片`}{' '}
                    · {(row.fileSize / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
              ),
            },
            {
              title: '状态',
              width: 110,
              render: (_, row) => (
                <Tag
                  color={
                    row.validationStatus === 'valid'
                      ? 'green'
                      : row.validationStatus === 'warning'
                        ? 'orange'
                        : 'red'
                  }
                >
                  {row.validationStatus === 'valid'
                    ? '可导入'
                    : row.validationStatus === 'warning'
                      ? '有警告'
                      : row.validationStatus === 'encrypted'
                        ? '已加密'
                        : '错误'}
                </Tag>
              ),
            },
            {
              title: '检查信息',
              width: 260,
              render: (_, row) => (
                <span className="validation-summary">
                  {row.duplicateMaterialIds.length > 0
                    ? `检测到 ${row.duplicateMaterialIds.length} 项重复材料。`
                    : (row.validationMessages[0]?.message ?? '检查通过。')}
                </span>
              ),
            },
            {
              title: '处理方式',
              width: 150,
              render: (_, row) => (
                <Select
                  size="small"
                  value={actions[row.id] ?? 'skip'}
                  style={{ width: 130 }}
                  disabled={
                    row.validationStatus === 'error' || row.validationStatus === 'encrypted'
                  }
                  onChange={(action) => setActions((current) => ({ ...current, [row.id]: action }))}
                  options={[
                    { value: 'import', label: '仍然导入' },
                    { value: 'skip', label: '跳过' },
                    ...(row.duplicateMaterialIds.length > 0
                      ? [{ value: 'replace', label: '替换现有材料' }]
                      : []),
                  ]}
                />
              ),
            },
          ]}
        />
      </Space>
    </Modal>
  )
}
