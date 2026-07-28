import {
  DeleteOutlined,
  EyeOutlined,
  HolderOutlined,
  ReloadOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useVirtualizer } from '@tanstack/react-virtual'
import { App, Badge, Button, Empty, Modal, Slider, Space, Spin, Tag, Tooltip } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PagePlan, PlannedPage } from '../../../../shared/schemas/page-plan-schema.js'
import type { Project, Rotation } from '../../../../shared/schemas/project-schema.js'
import type { Selection } from '../../stores/project-store.js'
import { findMaterial } from '../../utils/project.js'

const PAGE_TYPE_LABELS: Record<PlannedPage['pageType'], string> = {
  cover: '封面',
  blank: '空白页',
  toc: '目录',
  divider: '分类标题页',
  materialTitle: '材料标题页',
  pdfContent: 'PDF 页面',
  imageContent: '图片页面',
}

const rotate = (value: Rotation, delta: 90 | -90): Rotation =>
  ((value + delta + 360) % 360) as Rotation

const withoutRotation = (
  values: Record<string, Rotation>,
  sourcePageId: string,
): Record<string, Rotation> =>
  Object.fromEntries(Object.entries(values).filter(([id]) => id !== sourcePageId))

type PageCardProps = {
  page: PlannedPage
  planFingerprint: string
  width: number
  selected: boolean
  onSelect: (event: React.MouseEvent) => void
  onOpen: (url: string | null) => void
}

const PageCard = (props: PageCardProps): React.JSX.Element => {
  const generated = !['pdfContent', 'imageContent'].includes(props.page.pageType)
  const previewable = props.page.pageType !== 'blank'
  const sortable = useSortable({ id: props.page.id, disabled: generated })
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(previewable)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    if (!previewable) {
      setLoading(false)
      setThumbnailUrl(null)
      return () => {
        active = false
      }
    }
    setLoading(true)
    setFailed(false)
    void window.supportPack.preview
      .thumbnail({
        pageId: props.page.id,
        planFingerprint: props.planFingerprint,
        width: Math.round(props.width * 1.6),
      })
      .then((result) => {
        if (!active) return
        if (result.ok) setThumbnailUrl(result.value.url)
        else setFailed(true)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [previewable, props.page.id, props.page.rotation, props.planFingerprint, props.width])

  return (
    <article
      ref={sortable.setNodeRef}
      className={`page-card ${props.selected ? 'selected' : ''}`}
      style={{
        width: props.width,
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.55 : 1,
      }}
      onClick={props.onSelect}
      onDoubleClick={() => props.onOpen(thumbnailUrl)}
    >
      <div className="page-card-toolbar">
        <span>物理页 {props.page.physicalIndex + 1}</span>
        {!generated && (
          <button
            type="button"
            className="page-drag-handle"
            aria-label="拖拽页面排序"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <HolderOutlined />
          </button>
        )}
      </div>
      <div
        className="page-sheet"
        style={{
          aspectRatio: props.page.targetOrientation === 'portrait' ? '210 / 297' : '297 / 210',
        }}
      >
        {thumbnailUrl ? (
          <div className="content-thumbnail-preview">
            <img src={thumbnailUrl} alt={`${props.page.displayTitle}缩略图`} draggable={false} />
          </div>
        ) : props.page.pageType === 'blank' ? (
          <div className="generated-preview blank" aria-label="封面背面空白页" />
        ) : generated ? (
          <div className={`generated-preview ${props.page.pageType}`}>
            <span>{PAGE_TYPE_LABELS[props.page.pageType]}</span>
            <strong>{props.page.displayTitle}</strong>
          </div>
        ) : loading ? (
          <Spin size="small" />
        ) : (
          <div className="thumbnail-error">{failed ? '缩略图生成失败' : '无预览'}</div>
        )}
        {props.page.rotation !== 0 && (
          <Tag className="rotation-tag">旋转 {props.page.rotation}°</Tag>
        )}
        {props.page.validationStatus !== 'valid' && (
          <Badge
            className="page-error-badge"
            status={props.page.validationStatus === 'warning' ? 'warning' : 'error'}
          />
        )}
      </div>
      <div className="page-card-meta">
        <span className="page-type">{PAGE_TYPE_LABELS[props.page.pageType]}</span>
        <span className="logical-page">逻辑页 {props.page.logicalPageNumber?.value ?? '—'}</span>
      </div>
      <div className="page-card-title" title={props.page.displayTitle}>
        {props.page.displayTitle}
      </div>
      {props.page.inlineHeadings.length > 0 && (
        <div className="page-card-heading-note">含同页分级标题</div>
      )}
    </article>
  )
}

type PreviewPanelProps = {
  project: Project
  plan: PagePlan | null
  loading: boolean
  selection: Selection | null
  selectedPageIds: string[]
  onSelectionChange: (ids: string[], primary: string | null) => void
  onMutate: (mutator: (draft: Project) => void, selection?: Selection) => void
  onRefresh: () => void
}

export const PreviewPanel = (props: PreviewPanelProps): React.JSX.Element => {
  const { message } = App.useApp()
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastSelectedIndex = useRef<number | null>(null)
  const [thumbnailWidth, setThumbnailWidth] = useState(190)
  const [largeImage, setLargeImage] = useState<string | null>(null)
  const columns = thumbnailWidth <= 170 ? 4 : thumbnailWidth <= 230 ? 3 : 2
  const pages = props.plan?.pages ?? []
  const rows = Math.ceil(pages.length / columns)
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => thumbnailWidth * 1.58 + 92,
    overscan: 2,
  })
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const selected = useMemo(() => new Set(props.selectedPageIds), [props.selectedPageIds])

  const selectPage = (page: PlannedPage, index: number, event: React.MouseEvent): void => {
    let next: string[]
    if (event.shiftKey && lastSelectedIndex.current !== null) {
      const start = Math.min(lastSelectedIndex.current, index)
      const end = Math.max(lastSelectedIndex.current, index)
      next = pages.slice(start, end + 1).map((item) => item.id)
    } else if (event.metaKey || event.ctrlKey) {
      next = selected.has(page.id)
        ? props.selectedPageIds.filter((id) => id !== page.id)
        : [...props.selectedPageIds, page.id]
    } else {
      next = [page.id]
    }
    lastSelectedIndex.current = index
    props.onSelectionChange(next, page.id)
  }

  const selectedContentPages = pages.filter(
    (page) => selected.has(page.id) && page.sourcePageId && page.materialId,
  )

  const mutateSelectedPages = (
    operation: 'left' | 'right' | 'delete' | 'restoreRotation',
  ): void => {
    if (selectedContentPages.length === 0) {
      void message.info('请选择材料内容页；封面、目录和标题页不能直接编辑。')
      return
    }
    props.onMutate((draft) => {
      for (const page of selectedContentPages) {
        const found = page.materialId ? findMaterial(draft, page.materialId) : null
        if (!found || !page.sourcePageId) continue
        if (operation === 'delete') {
          if (!found.material.removedPages.includes(page.sourcePageId))
            found.material.removedPages.push(page.sourcePageId)
        } else if (operation === 'restoreRotation') {
          found.material.rotationByPage = withoutRotation(
            found.material.rotationByPage,
            page.sourcePageId,
          )
        } else {
          const current = found.material.rotationByPage[page.sourcePageId] ?? 0
          found.material.rotationByPage[page.sourcePageId] = rotate(
            current,
            operation === 'right' ? 90 : -90,
          )
        }
        found.material.updatedAt = new Date().toISOString()
      }
    })
    if (operation === 'delete') props.onSelectionChange([], null)
  }

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return
    const activePage = pages.find((page) => page.id === active.id)
    const overPage = pages.find((page) => page.id === over.id)
    if (
      !activePage?.materialId ||
      !overPage?.materialId ||
      activePage.materialId !== overPage.materialId ||
      !activePage.sourcePageId ||
      !overPage.sourcePageId
    ) {
      void message.info('页面只能在同一项材料内部拖拽排序。')
      return
    }
    const materialId = activePage.materialId
    const activeSourcePageId = activePage.sourcePageId
    const overSourcePageId = overPage.sourcePageId
    props.onMutate((draft) => {
      const found = findMaterial(draft, materialId)
      if (!found) return
      const visibleOrder = pages
        .filter(
          (page): page is PlannedPage & { sourcePageId: string } =>
            page.materialId === materialId && page.sourcePageId !== null,
        )
        .map((page) => page.sourcePageId)
      const oldIndex = visibleOrder.indexOf(activeSourcePageId)
      const newIndex = visibleOrder.indexOf(overSourcePageId)
      const [moved] = visibleOrder.splice(oldIndex, 1)
      if (moved) visibleOrder.splice(newIndex, 0, moved)
      const remaining = found.material.pageOrder.filter((id) => !visibleOrder.includes(id))
      found.material.pageOrder = [...visibleOrder, ...remaining]
      found.material.updatedAt = new Date().toISOString()
    })
  }

  return (
    <section className="preview-panel">
      <div className="preview-toolbar">
        <Space size={3}>
          <Tooltip title="逆时针旋转 90 度">
            <Button
              size="small"
              icon={<RotateLeftOutlined />}
              onClick={() => mutateSelectedPages('left')}
            />
          </Tooltip>
          <Tooltip title="顺时针旋转 90 度">
            <Button
              size="small"
              icon={<RotateRightOutlined />}
              onClick={() => mutateSelectedPages('right')}
            />
          </Tooltip>
          <Tooltip title="恢复原始方向">
            <Button
              size="small"
              icon={<UndoOutlined />}
              onClick={() => mutateSelectedPages('restoreRotation')}
            />
          </Tooltip>
          <Tooltip title="删除所选页面（不修改原始文件）">
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => mutateSelectedPages('delete')}
            />
          </Tooltip>
          <Tooltip title="查看大图">
            <Button
              size="small"
              icon={<EyeOutlined />}
              disabled={props.selectedPageIds.length !== 1}
              onClick={() => {
                const selectedPage = pages.find((page) => page.id === props.selectedPageIds[0])
                if (selectedPage)
                  void window.supportPack.preview
                    .thumbnail({
                      pageId: selectedPage.id,
                      planFingerprint: props.plan?.planFingerprint ?? '',
                      width: 900,
                    })
                    .then((result) => {
                      if (result.ok && result.value.url) setLargeImage(result.value.url)
                    })
              }}
            />
          </Tooltip>
          <Tooltip title="重新计算页面计划">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={props.loading}
              onClick={props.onRefresh}
            />
          </Tooltip>
        </Space>
        <div className="preview-summary">
          {props.plan ? `共 ${props.plan.totalPageCount} 个物理页面` : '尚未生成页面计划'}
        </div>
        <div className="zoom-control">
          <span>缩略图</span>
          <Slider min={145} max={290} value={thumbnailWidth} onChange={setThumbnailWidth} />
        </div>
      </div>
      <div ref={scrollRef} className="preview-scroll">
        {props.loading && pages.length === 0 ? (
          <div className="preview-center">
            <Spin description="正在计算页面计划" />
          </div>
        ) : pages.length === 0 ? (
          <div className="preview-center">
            <Empty description="导入材料后，最终页面会显示在这里" />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={pages.map((page) => page.id)} strategy={rectSortingStrategy}>
              <div className="virtual-page-canvas" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const rowPages = pages.slice(
                    virtualRow.index * columns,
                    (virtualRow.index + 1) * columns,
                  )
                  return (
                    <div
                      key={virtualRow.key}
                      className="virtual-page-row"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {rowPages.map((page, columnIndex) => {
                        const pageIndex = virtualRow.index * columns + columnIndex
                        return (
                          <PageCard
                            key={page.id}
                            page={page}
                            planFingerprint={props.plan?.planFingerprint ?? ''}
                            width={thumbnailWidth}
                            selected={selected.has(page.id)}
                            onSelect={(event) => selectPage(page, pageIndex, event)}
                            onOpen={setLargeImage}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <Modal
        open={Boolean(largeImage)}
        footer={null}
        width="min(92vw, 1100px)"
        title="页面大图"
        onCancel={() => setLargeImage(null)}
      >
        {largeImage && <img className="large-preview-image" src={largeImage} alt="页面大图" />}
      </Modal>
    </section>
  )
}
