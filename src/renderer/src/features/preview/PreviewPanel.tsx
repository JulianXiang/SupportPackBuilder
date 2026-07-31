import {
  AppstoreAddOutlined,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PagePlan, PlannedPage } from '../../../../shared/schemas/page-plan-schema.js'
import type { Project, Rotation } from '../../../../shared/schemas/project-schema.js'
import { A4_SIZE_POINTS } from '../../../../shared/constants/document.js'
import { suggestCollage } from '../../../../shared/utils/collage-suggestion.js'
import { getSelectedSourcePages } from '../../../../shared/utils/page-plan.js'
import type { Selection } from '../../stores/project-store.js'
import { findMaterial } from '../../utils/project.js'
import { CollageWorkbench, type CollageWorkbenchSource } from '../collage/CollageWorkbench.js'
import {
  calculatePreviewScrollbarMetrics,
  calculatePreviewScrollbarThumbTop,
  calculatePreviewScrollTopFromDrag,
  type PreviewScrollbarMetrics,
} from './preview-scrollbar.js'

const PAGE_TYPE_LABELS: Record<PlannedPage['pageType'], string> = {
  cover: '封面',
  blank: '空白页',
  toc: '目录',
  divider: '分类标题页',
  materialTitle: '材料标题页',
  pdfContent: 'PDF 页面',
  imageContent: '图片页面',
  compositeContent: '多图拼版页',
}

const rotate = (value: Rotation, delta: 90 | -90): Rotation =>
  ((value + delta + 360) % 360) as Rotation

const withoutRotation = (
  values: Record<string, Rotation>,
  sourcePageId: string,
): Record<string, Rotation> =>
  Object.fromEntries(Object.entries(values).filter(([id]) => id !== sourcePageId))

const EMPTY_SCROLLBAR_METRICS: PreviewScrollbarMetrics = {
  visible: false,
  maxScrollTop: 0,
  thumbHeight: 0,
  maxThumbTop: 0,
}

const equalScrollbarMetrics = (
  first: PreviewScrollbarMetrics,
  second: PreviewScrollbarMetrics,
): boolean =>
  first.visible === second.visible &&
  first.maxScrollTop === second.maxScrollTop &&
  first.thumbHeight === second.thumbHeight &&
  first.maxThumbTop === second.maxThumbTop

type ScrollbarDragState = {
  pointerId: number
  startClientY: number
  startScrollTop: number
}

type PageCardProps = {
  page: PlannedPage
  planFingerprint: string
  width: number
  selected: boolean
  onSelect: (event: React.MouseEvent) => void
  onOpen: (url: string | null) => void
}

const PageCard = (props: PageCardProps): React.JSX.Element => {
  const sortableContent = ['pdfContent', 'imageContent'].includes(props.page.pageType)
  const generated = !['pdfContent', 'imageContent', 'compositeContent'].includes(
    props.page.pageType,
  )
  const previewable = props.page.pageType !== 'blank'
  const sortable = useSortable({ id: props.page.id, disabled: !sortableContent })
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
        {sortableContent && (
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

type CollageWorkbenchState = {
  sources: CollageWorkbenchSource[]
  sheets: Project['layoutSheets']
  editingSheetIds: string[]
}

export const PreviewPanel = (props: PreviewPanelProps): React.JSX.Element => {
  const { message, modal } = App.useApp()
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollbarTrackRef = useRef<HTMLDivElement>(null)
  const scrollbarThumbRef = useRef<HTMLDivElement>(null)
  const scrollbarMetricsRef = useRef<PreviewScrollbarMetrics>(EMPTY_SCROLLBAR_METRICS)
  const scrollbarDragRef = useRef<ScrollbarDragState | null>(null)
  const scrollbarFrameRef = useRef<number | null>(null)
  const scrollTopRef = useRef(0)
  const lastSelectedIndex = useRef<number | null>(null)
  const [thumbnailWidth, setThumbnailWidth] = useState(190)
  const [largeImage, setLargeImage] = useState<string | null>(null)
  const [collageWorkbench, setCollageWorkbench] = useState<CollageWorkbenchState | null>(null)
  const [scrollbarMetrics, setScrollbarMetrics] =
    useState<PreviewScrollbarMetrics>(EMPTY_SCROLLBAR_METRICS)
  const columns = thumbnailWidth <= 170 ? 4 : thumbnailWidth <= 230 ? 3 : 2
  const pages = props.plan?.pages ?? []
  const rows = Math.ceil(pages.length / columns)
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => thumbnailWidth * 1.58 + 92,
    overscan: 2,
  })
  const virtualPageHeight = virtualizer.getTotalSize()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const selected = useMemo(() => new Set(props.selectedPageIds), [props.selectedPageIds])
  const canonicalSourceOrder = useMemo(() => {
    const sourceIds = [...props.project.outlineNodes]
      .sort((left, right) => left.order - right.order)
      .flatMap((root) =>
        [...root.children]
          .sort((left, right) => left.order - right.order)
          .flatMap((child) =>
            [...child.materials]
              .sort((left, right) => left.order - right.order)
              .flatMap((material) =>
                getSelectedSourcePages(material).pages.map((page) => page.sourcePageId),
              ),
          ),
      )
    return new Map(sourceIds.map((sourcePageId, index) => [sourcePageId, index]))
  }, [props.project])

  const updateScrollbarThumb = useCallback((): void => {
    const scrollElement = scrollRef.current
    const trackElement = scrollbarTrackRef.current
    const thumbElement = scrollbarThumbRef.current
    if (!scrollElement || !trackElement || !thumbElement) return
    const metrics = scrollbarMetricsRef.current
    const scrollTop = Math.min(Math.max(0, scrollElement.scrollTop), metrics.maxScrollTop)
    const thumbTop = calculatePreviewScrollbarThumbTop({ ...metrics, scrollTop })
    scrollTopRef.current = scrollTop
    thumbElement.style.transform = `translateY(${thumbTop}px)`
    trackElement.setAttribute('aria-valuenow', String(Math.round(scrollTop)))
  }, [])

  const scheduleScrollbarThumbUpdate = useCallback((): void => {
    if (scrollbarFrameRef.current !== null) return
    scrollbarFrameRef.current = window.requestAnimationFrame(() => {
      scrollbarFrameRef.current = null
      updateScrollbarThumb()
    })
  }, [updateScrollbarThumb])

  const measureScrollbar = useCallback((): void => {
    const scrollElement = scrollRef.current
    const trackElement = scrollbarTrackRef.current
    if (!scrollElement || !trackElement) return
    const metrics = calculatePreviewScrollbarMetrics({
      clientHeight: scrollElement.clientHeight,
      scrollHeight: scrollElement.scrollHeight,
      trackHeight: trackElement.clientHeight,
    })
    scrollbarMetricsRef.current = metrics
    setScrollbarMetrics((current) => (equalScrollbarMetrics(current, metrics) ? current : metrics))
    scheduleScrollbarThumbUpdate()
  }, [scheduleScrollbarThumbUpdate])

  useEffect(() => {
    const scrollElement = scrollRef.current
    const trackElement = scrollbarTrackRef.current
    if (!scrollElement || !trackElement) return
    const resizeObserver = new ResizeObserver(measureScrollbar)
    const canvasElement = scrollElement.querySelector<HTMLElement>('.virtual-page-canvas')
    resizeObserver.observe(scrollElement)
    resizeObserver.observe(trackElement)
    if (canvasElement) resizeObserver.observe(canvasElement)
    scrollElement.addEventListener('scroll', scheduleScrollbarThumbUpdate, { passive: true })
    measureScrollbar()
    return () => {
      resizeObserver.disconnect()
      scrollElement.removeEventListener('scroll', scheduleScrollbarThumbUpdate)
      if (scrollbarFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollbarFrameRef.current)
        scrollbarFrameRef.current = null
      }
    }
  }, [measureScrollbar, pages.length > 0, scheduleScrollbarThumbUpdate])

  useEffect(() => {
    const frame = window.requestAnimationFrame(measureScrollbar)
    return () => window.cancelAnimationFrame(frame)
  }, [columns, measureScrollbar, pages.length, thumbnailWidth, virtualPageHeight])

  const scrollByKeyboard = useCallback(
    (event: React.KeyboardEvent<HTMLElement>): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const scrollElement = scrollRef.current
      if (!scrollElement) return
      const pageStep = Math.max(1, Math.round(scrollElement.clientHeight * 0.9))
      let nextScrollTop: number | null = null
      if (event.key === 'PageDown') nextScrollTop = scrollElement.scrollTop + pageStep
      else if (event.key === 'PageUp') nextScrollTop = scrollElement.scrollTop - pageStep
      else if (event.key === 'Home') nextScrollTop = 0
      else if (event.key === 'End') nextScrollTop = scrollbarMetricsRef.current.maxScrollTop
      if (nextScrollTop === null) return
      event.preventDefault()
      scrollElement.scrollTop = Math.min(
        Math.max(0, nextScrollTop),
        scrollbarMetricsRef.current.maxScrollTop,
      )
      scheduleScrollbarThumbUpdate()
    },
    [scheduleScrollbarThumbUpdate],
  )

  const handleScrollbarTrackPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0 || event.target === scrollbarThumbRef.current) return
      const scrollElement = scrollRef.current
      if (!scrollElement) return
      const metrics = scrollbarMetricsRef.current
      const trackBounds = event.currentTarget.getBoundingClientRect()
      const currentThumbTop = calculatePreviewScrollbarThumbTop({
        ...metrics,
        scrollTop: scrollElement.scrollTop,
      })
      const pointerTop = event.clientY - trackBounds.top
      const direction = pointerTop < currentThumbTop ? -1 : 1
      event.currentTarget.focus({ preventScroll: true })
      scrollElement.scrollTop = Math.min(
        Math.max(0, scrollElement.scrollTop + direction * scrollElement.clientHeight),
        metrics.maxScrollTop,
      )
      scheduleScrollbarThumbUpdate()
    },
    [scheduleScrollbarThumbUpdate],
  )

  const handleScrollbarThumbPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      const scrollElement = scrollRef.current
      if (!scrollElement) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.classList.add('dragging')
      scrollbarTrackRef.current?.focus({ preventScroll: true })
      scrollbarDragRef.current = {
        pointerId: event.pointerId,
        startClientY: event.clientY,
        startScrollTop: scrollElement.scrollTop,
      }
    },
    [],
  )

  const handleScrollbarThumbPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const drag = scrollbarDragRef.current
      const scrollElement = scrollRef.current
      if (drag?.pointerId !== event.pointerId || !scrollElement) return
      scrollElement.scrollTop = calculatePreviewScrollTopFromDrag({
        ...scrollbarMetricsRef.current,
        startScrollTop: drag.startScrollTop,
        deltaY: event.clientY - drag.startClientY,
      })
      scheduleScrollbarThumbUpdate()
    },
    [scheduleScrollbarThumbUpdate],
  )

  const finishScrollbarThumbDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const drag = scrollbarDragRef.current
      if (drag?.pointerId !== event.pointerId) return
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      event.currentTarget.classList.remove('dragging')
      scrollbarDragRef.current = null
      scheduleScrollbarThumbUpdate()
    },
    [scheduleScrollbarThumbUpdate],
  )

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
    (page) =>
      selected.has(page.id) &&
      page.sourcePageId &&
      page.materialId &&
      (page.pageType === 'pdfContent' || page.pageType === 'imageContent'),
  )

  const createWorkbenchSource = (input: {
    sourcePageId: string
    sourceId: string
    materialId: string
    outlineNodeId: string
    sourceKind: 'pdf' | 'image'
    sourcePageIndex: number
  }): CollageWorkbenchSource | null => {
    const found = findMaterial(props.project, input.materialId)
    const source = found?.material.sourceItems.find((candidate) => candidate.id === input.sourceId)
    if (!found || !source) return null
    return {
      ...input,
      materialTitle: found.material.title,
      label: `${found.material.title} · 第 ${input.sourcePageIndex + 1} 页`,
      width:
        input.sourceKind === 'image'
          ? (source.width ?? A4_SIZE_POINTS.width)
          : A4_SIZE_POINTS.width,
      height:
        input.sourceKind === 'image'
          ? (source.height ?? A4_SIZE_POINTS.height)
          : A4_SIZE_POINTS.height,
      canonicalOrder: canonicalSourceOrder.get(input.sourcePageId) ?? Number.MAX_SAFE_INTEGER,
    }
  }

  const openCollageWorkbench = (): void => {
    if (!props.plan) return
    const selectedPages = pages.filter((page) => selected.has(page.id))
    const selectedComposite = selectedPages.filter(
      (page) => page.pageType === 'compositeContent' && page.composite,
    )
    if (selectedComposite.length === 1 && selectedPages.length === 1) {
      const page = selectedComposite[0]
      if (!page) return
      const sheet = props.project.layoutSheets.find(
        (candidate) => candidate.id === page.composite?.layoutSheetId,
      )
      if (!sheet || !page.composite) {
        void message.error('找不到该拼版页的项目配置，请刷新预览。')
        return
      }
      const sources = [
        ...new Map(
          page.composite.contentItems.map((item) => [
            item.sourcePageId,
            createWorkbenchSource({
              sourcePageId: item.sourcePageId,
              sourceId: item.sourceId,
              materialId: item.materialId,
              outlineNodeId: item.outlineNodeId,
              sourceKind: item.sourceKind,
              sourcePageIndex: item.sourcePageIndex,
            }),
          ]),
        ).values(),
      ].filter((source): source is CollageWorkbenchSource => source !== null)
      setCollageWorkbench({
        sources,
        sheets: [structuredClone(sheet)],
        editingSheetIds: [sheet.id],
      })
      return
    }
    const contentPages = selectedPages.filter(
      (
        page,
      ): page is PlannedPage & {
        sourcePageId: string
        sourceId: string
        materialId: string
        outlineNodeId: string
        sourcePageIndex: number
        pageType: 'pdfContent' | 'imageContent'
      } =>
        (page.pageType === 'pdfContent' || page.pageType === 'imageContent') &&
        page.sourcePageId !== null &&
        page.sourceId !== null &&
        page.materialId !== null &&
        page.outlineNodeId !== null &&
        page.sourcePageIndex !== null,
    )
    if (contentPages.length < 2) {
      void message.info('请至少选择两个普通 PDF 或图片内容页；已有拼版页可单独选中后编辑。')
      return
    }
    const sources = contentPages
      .map((page) =>
        createWorkbenchSource({
          sourcePageId: page.sourcePageId,
          sourceId: page.sourceId,
          materialId: page.materialId,
          outlineNodeId: page.outlineNodeId,
          sourceKind: page.pageType === 'pdfContent' ? 'pdf' : 'image',
          sourcePageIndex: page.sourcePageIndex,
        }),
      )
      .filter((source): source is CollageWorkbenchSource => source !== null)
    const selectedRanks = sources
      .map((source) => source.canonicalOrder)
      .sort((left, right) => left - right)
    const selectedPagesAreContiguous = selectedRanks.every(
      (rank, index) => index === 0 || rank === (selectedRanks[index - 1] ?? rank) + 1,
    )
    if (!selectedPagesAreContiguous) {
      void message.error(
        '所选页面在最终材料顺序中不连续。请连续选择页面，避免拼版改变专家阅读顺序。',
      )
      return
    }
    const materialCount = new Set(sources.map((source) => source.materialId)).size
    const outlineCount = new Set(sources.map((source) => source.outlineNodeId)).size
    const buildSuggestion = (crossDirectoryConfirmed: boolean): void => {
      try {
        const suggestion = suggestCollage({
          pages: sources.map((source) => ({
            sourcePageId: source.sourcePageId,
            materialId: source.materialId,
            outlineNodeId: source.outlineNodeId,
            sourceKind: source.sourceKind,
            aspectRatio: source.width / source.height,
          })),
          project: props.project,
          existingSheetCount: props.project.layoutSheets.length,
          allowCrossMaterial: materialCount > 1,
          crossDirectoryConfirmed,
        })
        setCollageWorkbench({
          sources,
          sheets: suggestion.sheets,
          editingSheetIds: [],
        })
      } catch (error) {
        void message.error(error instanceof Error ? error.message : '无法创建拼版建议。')
      }
    }
    if (materialCount > 1) {
      modal.confirm({
        title: outlineCount > 1 ? '确认跨目录、跨成果拼版' : '确认跨成果拼版',
        content:
          outlineCount > 1
            ? '所选页面来自不同目录和成果。每项成果会保留独立全宽区段与小标题，但多个目录条目可能指向同一逻辑页。请确认这符合提交材料要求。'
            : '所选页面来自多项成果。系统会按目录顺序上下排列，每项成果保留独立全宽区段和小标题。',
        okText: '确认归属并进入拼版',
        cancelText: '取消',
        onOk: () => buildSuggestion(outlineCount > 1),
      })
    } else {
      buildSuggestion(false)
    }
  }

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
          <Tooltip title="将所选页面进行自主可控多图拼版；单选已有拼版页可继续编辑">
            <Button
              size="small"
              icon={<AppstoreAddOutlined />}
              disabled={props.selectedPageIds.length === 0}
              onClick={openCollageWorkbench}
            >
              多图拼版
            </Button>
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
      <div className="preview-viewport">
        <div
          id="preview-scroll-region"
          ref={scrollRef}
          className="preview-scroll"
          tabIndex={0}
          aria-label="页面缩略图预览"
          onKeyDown={scrollByKeyboard}
        >
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
                <div className="virtual-page-canvas" style={{ height: virtualPageHeight }}>
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
        <div
          ref={scrollbarTrackRef}
          className={`preview-scrollbar ${scrollbarMetrics.visible ? '' : 'hidden'}`}
          role="scrollbar"
          aria-label="页面预览滚动条"
          aria-controls="preview-scroll-region"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={Math.round(scrollbarMetrics.maxScrollTop)}
          aria-valuenow={Math.round(Math.min(scrollTopRef.current, scrollbarMetrics.maxScrollTop))}
          aria-hidden={!scrollbarMetrics.visible}
          tabIndex={scrollbarMetrics.visible ? 0 : -1}
          onKeyDown={scrollByKeyboard}
          onPointerDown={handleScrollbarTrackPointerDown}
        >
          <div
            ref={scrollbarThumbRef}
            className="preview-scrollbar-thumb"
            style={{ height: scrollbarMetrics.thumbHeight }}
            onPointerDown={handleScrollbarThumbPointerDown}
            onPointerMove={handleScrollbarThumbPointerMove}
            onPointerUp={finishScrollbarThumbDrag}
            onPointerCancel={finishScrollbarThumbDrag}
          />
        </div>
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
      {collageWorkbench && props.plan && (
        <CollageWorkbench
          open
          project={props.project}
          planFingerprint={props.plan.planFingerprint}
          sources={collageWorkbench.sources}
          initialSheets={collageWorkbench.sheets}
          editingSheetIds={collageWorkbench.editingSheetIds}
          onCancel={() => setCollageWorkbench(null)}
          onApply={(sheetsToApply, editingSheetIds) => {
            const involvedMaterialIds = new Set(
              sheetsToApply.flatMap((sheet) => sheet.sections.map((section) => section.materialId)),
            )
            props.onMutate((draft) => {
              draft.layoutSheets = [
                ...draft.layoutSheets.filter((sheet) => !editingSheetIds.includes(sheet.id)),
                ...sheetsToApply,
              ]
                .sort((left, right) => left.order - right.order)
                .map((sheet, index) => ({ ...sheet, order: index }))
              draft.outlineNodes.forEach((root) =>
                root.children.forEach((child) =>
                  child.materials.forEach((material) => {
                    if (involvedMaterialIds.has(material.id)) {
                      material.startPolicy = 'allowSharedSheet'
                    }
                  }),
                ),
              )
            })
            props.onSelectionChange([], null)
            setCollageWorkbench(null)
            void message.success('拼版配置已应用，正在按同一 PagePlan 重算预览。')
          }}
          onRemove={(editingSheetIds) => {
            props.onMutate((draft) => {
              draft.layoutSheets = draft.layoutSheets
                .filter((sheet) => !editingSheetIds.includes(sheet.id))
                .map((sheet, index) => ({ ...sheet, order: index }))
            })
            props.onSelectionChange([], null)
            setCollageWorkbench(null)
            void message.success('已取消拼版，来源页面恢复为独立 A4 页面。')
          }}
        />
      )}
    </section>
  )
}
