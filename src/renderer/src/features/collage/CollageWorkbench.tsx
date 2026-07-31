import {
  BorderInnerOutlined,
  ColumnWidthOutlined,
  DeleteOutlined,
  RotateRightOutlined,
  ScissorOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Checkbox,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Slider,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import {
  LayoutSheetSchema,
  type LayoutAlignment,
  type LayoutNode,
  type LayoutSheet,
  type LayoutSlot,
  type LayoutTemplateId,
  type Project,
} from '../../../../shared/schemas/project-schema.js'
import {
  assessLayoutClarity,
  calculateCompositeSlotBounds,
} from '../../../../shared/utils/collage-metrics.js'
import {
  createLayoutFromTemplate,
  duplicateLayoutSlotAsDetail,
  flattenLayoutSlots,
  mapLayoutNode,
  normalizeLayoutWeights,
  removeEmptyLayoutSlot,
  resizeLayoutSplit,
  rotateLayoutSlot,
  splitLayoutSlot,
  swapLayoutSlotSources,
  updateLayoutSlot,
} from '../../../../shared/utils/layout-tree.js'

export type CollageWorkbenchSource = {
  sourcePageId: string
  sourceId: string
  materialId: string
  outlineNodeId: string
  materialTitle: string
  label: string
  sourceKind: 'pdf' | 'image'
  width: number
  height: number
  canonicalOrder: number
}

type CollageWorkbenchProps = {
  open: boolean
  project: Project
  planFingerprint: string
  sources: CollageWorkbenchSource[]
  initialSheets: LayoutSheet[]
  editingSheetIds: string[]
  onCancel: () => void
  onApply: (sheets: LayoutSheet[], editingSheetIds: string[]) => void
  onRemove: (editingSheetIds: string[]) => void
}

const TEMPLATE_OPTIONS: { value: LayoutTemplateId; label: string; capacity: number }[] = [
  { value: 'two-up', label: '上下两页', capacity: 2 },
  { value: 'four-up', label: '四宫格', capacity: 4 },
  { value: 'certificate-2x2', label: '证书 2×2', capacity: 4 },
  { value: 'certificate-2x3', label: '证书 2×3', capacity: 6 },
  { value: 'front-back', label: '正反面', capacity: 2 },
  { value: 'primary-with-attachments', label: '主体＋附件', capacity: 4 },
  { value: 'contact-sheet', label: '联系表', capacity: 6 },
  { value: 'vertical-strips', label: '纵向长条', capacity: 4 },
  { value: 'original-with-detail', label: '原图＋细节', capacity: 2 },
]

const ALIGNMENT_OPTIONS: { value: LayoutAlignment; label: string }[] = [
  { value: 'topLeft', label: '左上' },
  { value: 'topCenter', label: '上中' },
  { value: 'topRight', label: '右上' },
  { value: 'centerLeft', label: '左中' },
  { value: 'center', label: '居中' },
  { value: 'centerRight', label: '右中' },
  { value: 'bottomLeft', label: '左下' },
  { value: 'bottomCenter', label: '下中' },
  { value: 'bottomRight', label: '右下' },
]

const ALIGNMENT_CSS: Record<LayoutAlignment, string> = {
  topLeft: 'left top',
  topCenter: 'center top',
  topRight: 'right top',
  centerLeft: 'left center',
  center: 'center center',
  centerRight: 'right center',
  bottomLeft: 'left bottom',
  bottomCenter: 'center bottom',
  bottomRight: 'right bottom',
}

type SlotParent = {
  splitId: string
  weights: number[]
  childIndex: number
}

const findSlotParent = (
  node: LayoutNode,
  slotId: string,
  parent: SlotParent | null = null,
): SlotParent | null => {
  if (node.kind === 'slot') return node.id === slotId ? parent : null
  for (const [childIndex, child] of node.children.entries()) {
    const found = findSlotParent(child, slotId, {
      splitId: node.id,
      weights: node.weights,
      childIndex,
    })
    if (found) return found
  }
  return null
}

const SourceThumbnail = (props: {
  source: CollageWorkbenchSource
  planFingerprint: string
  slot?: LayoutSlot
}): React.JSX.Element => {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void window.supportPack.preview
      .sourceThumbnail({
        sourcePageId: props.source.sourcePageId,
        planFingerprint: props.planFingerprint,
        width: 260,
      })
      .then((result) => {
        if (active && result.ok) setUrl(result.value.url)
      })
    return () => {
      active = false
    }
  }, [props.planFingerprint, props.source.sourcePageId])
  return url ? (
    <img
      src={url}
      alt={props.source.label}
      draggable={false}
      className={props.slot ? 'collage-cropped-source' : undefined}
      style={
        props.slot
          ? {
              width: `${1000000 / props.slot.cropRect.width}%`,
              height: `${1000000 / props.slot.cropRect.height}%`,
              left: `${(-props.slot.cropRect.x * 100) / props.slot.cropRect.width}%`,
              top: `${(-props.slot.cropRect.y * 100) / props.slot.cropRect.height}%`,
              objectFit: props.slot.fit === 'cover' ? 'cover' : 'contain',
              objectPosition: ALIGNMENT_CSS[props.slot.alignment],
              transform: `rotate(${props.slot.rotation}deg)`,
            }
          : undefined
      }
    />
  ) : (
    <div className="collage-source-placeholder">正在生成</div>
  )
}

const LayoutNodeView = (props: {
  node: LayoutNode
  gap: number
  sources: Map<string, CollageWorkbenchSource>
  planFingerprint: string
  selectedSlotId: string | null
  swapFromSlotId: string | null
  onSelectSlot: (slotId: string) => void
}): React.JSX.Element => {
  if (props.node.kind === 'slot') {
    const source = props.node.sourcePageId ? props.sources.get(props.node.sourcePageId) : undefined
    return (
      <button
        type="button"
        className={`collage-layout-slot ${
          props.selectedSlotId === props.node.id ? 'selected' : ''
        } ${props.swapFromSlotId === props.node.id ? 'swap-source' : ''}`}
        onClick={() => props.onSelectSlot(props.node.id)}
      >
        {source ? (
          <>
            <SourceThumbnail
              source={source}
              planFingerprint={props.planFingerprint}
              slot={props.node}
            />
            <span>{source.label}</span>
          </>
        ) : (
          <span className="collage-empty-slot">空内容槽</span>
        )}
      </button>
    )
  }
  const split = props.node
  return (
    <div className={`collage-layout-split ${split.direction}`} style={{ gap: props.gap }}>
      {split.children.map((child, index) => (
        <div
          key={child.id}
          className="collage-layout-child"
          style={{ flexGrow: split.weights[index], flexBasis: 0 }}
        >
          <LayoutNodeView {...props} node={child} />
        </div>
      ))}
    </div>
  )
}

const nowIso = (): string => new Date().toISOString()

const firstSheetSlotId = (sheet: LayoutSheet | undefined): string | null => {
  const firstSection = sheet?.sections[0]
  return firstSection ? (flattenLayoutSlots(firstSection.layout)[0]?.id ?? null) : null
}

const croppedSourceSize = (
  source: CollageWorkbenchSource,
  slot: LayoutSlot,
): { width: number; height: number } => {
  const width = source.width * (slot.cropRect.width / 10000)
  const height = source.height * (slot.cropRect.height / 10000)
  return slot.rotation === 90 || slot.rotation === 270
    ? { width: height, height: width }
    : { width, height }
}

export const CollageWorkbench = (props: CollageWorkbenchProps): React.JSX.Element => {
  const { message } = App.useApp()
  const [sheets, setSheets] = useState<LayoutSheet[]>([])
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [swapFromSlotId, setSwapFromSlotId] = useState<string | null>(null)
  const [detectingCropSlotId, setDetectingCropSlotId] = useState<string | null>(null)

  useEffect(() => {
    if (!props.open) return
    setSheets(structuredClone(props.initialSheets))
    setActiveSheetIndex(0)
    setSelectedSlotId(firstSheetSlotId(props.initialSheets[0]))
    setSwapFromSlotId(null)
    setDetectingCropSlotId(null)
  }, [props.initialSheets, props.open])

  const activeSheet = sheets[activeSheetIndex]
  const sourceByPageId = useMemo(
    () => new Map(props.sources.map((source) => [source.sourcePageId, source])),
    [props.sources],
  )
  const selectedEntry = useMemo(() => {
    if (!activeSheet || !selectedSlotId) return null
    for (const section of activeSheet.sections) {
      const slot = flattenLayoutSlots(section.layout).find(
        (candidate) => candidate.id === selectedSlotId,
      )
      if (slot) return { section, slot }
    }
    return null
  }, [activeSheet, selectedSlotId])

  const updateActiveSheet = (updater: (sheet: LayoutSheet) => LayoutSheet): void => {
    setSheets((current) =>
      current.map((sheet, index) =>
        index === activeSheetIndex
          ? { ...updater(sheet), autoGenerated: false, updatedAt: nowIso() }
          : sheet,
      ),
    )
  }

  const updateSelectedSectionLayout = (updater: (layout: LayoutNode) => LayoutNode): void => {
    if (!selectedEntry) return
    updateActiveSheet((sheet) => ({
      ...sheet,
      sections: sheet.sections.map((section) =>
        section.id === selectedEntry.section.id
          ? { ...section, layout: updater(section.layout) }
          : section,
      ),
    }))
  }

  const assignSourceToSelectedSlot = (source: CollageWorkbenchSource): void => {
    if (!activeSheet || !selectedEntry) return
    if (selectedEntry.section.materialId !== source.materialId) {
      void message.warning('来源页面不能放入其他成果的区段。')
      return
    }
    const existedOnAnotherSheet = sheets.some(
      (sheet, sheetIndex) =>
        sheetIndex !== activeSheetIndex &&
        sheet.sections.some((section) =>
          flattenLayoutSlots(section.layout).some(
            (slot) => slot.sourcePageId === source.sourcePageId,
          ),
        ),
    )
    setSheets((current) =>
      current.map((sheet, sheetIndex) => ({
        ...sheet,
        autoGenerated: false,
        updatedAt: nowIso(),
        sections: sheet.sections.map((section) => ({
          ...section,
          layout:
            sheetIndex === activeSheetIndex && section.id === selectedEntry.section.id
              ? updateLayoutSlot(section.layout, selectedEntry.slot.id, (slot) => ({
                  ...slot,
                  sourcePageId: source.sourcePageId,
                  detailOf: flattenLayoutSlots(section.layout).some(
                    (candidate) =>
                      candidate.id !== slot.id && candidate.sourcePageId === source.sourcePageId,
                  )
                    ? source.sourcePageId
                    : null,
                  clarityRiskAcknowledged: false,
                }))
              : sheetIndex !== activeSheetIndex
                ? mapLayoutNode(section.layout, (node) =>
                    node.kind === 'slot' && node.sourcePageId === source.sourcePageId
                      ? {
                          ...node,
                          sourcePageId: null,
                          detailOf: null,
                          clarityRiskAcknowledged: false,
                        }
                      : node,
                  )
                : section.layout,
        })),
      })),
    )
    if (existedOnAnotherSheet) {
      void message.info('该来源页已从原拼版页移到当前内容槽。')
    }
  }

  const selectedClarity = useMemo(() => {
    if (!activeSheet || !selectedEntry?.slot.sourcePageId) return null
    const source = sourceByPageId.get(selectedEntry.slot.sourcePageId)
    if (!source) return null
    const sectionIndex = activeSheet.sections.findIndex(
      (section) => section.id === selectedEntry.section.id,
    )
    const slotIndex = flattenLayoutSlots(selectedEntry.section.layout).findIndex(
      (candidate) => candidate.id === selectedEntry.slot.id,
    )
    const bound = calculateCompositeSlotBounds(activeSheet, sectionIndex, true)[slotIndex]
    if (!bound) return null
    const sourceSize = croppedSourceSize(source, selectedEntry.slot)
    return assessLayoutClarity({
      sourceKind: source.sourceKind,
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      bounds: bound,
      orientation: activeSheet.orientation,
      fit: selectedEntry.slot.fit,
      rasterPreferredDpi: props.project.collageSettings.rasterPreferredDpi,
      rasterMinimumAutoDpi: props.project.collageSettings.rasterMinimumAutoDpi,
      pdfWarningScale: props.project.collageSettings.pdfWarningScale,
      pdfMinimumAutoScale: props.project.collageSettings.pdfMinimumAutoScale,
    })
  }, [activeSheet, props.project.collageSettings, selectedEntry, sourceByPageId])

  const detectSelectedCrop = async (): Promise<void> => {
    const sourcePageId = selectedEntry?.slot.sourcePageId
    if (!selectedEntry || !sourcePageId) return
    setDetectingCropSlotId(selectedEntry.slot.id)
    const result = await window.supportPack.preview.detectCrop({
      sourcePageId,
      planFingerprint: props.planFingerprint,
    })
    setDetectingCropSlotId(null)
    if (!result.ok) {
      void message.error(`自动去白边失败：${result.error.message}`)
      return
    }
    updateSelectedSectionLayout((layout) =>
      updateLayoutSlot(layout, selectedEntry.slot.id, (slot) => ({
        ...slot,
        cropRect: result.value.cropRect,
        clarityRiskAcknowledged: false,
      })),
    )
    void message.success(result.value.message)
  }

  const selectSlot = (slotId: string): void => {
    if (swapFromSlotId && swapFromSlotId !== slotId && activeSheet) {
      const sourceSection = activeSheet.sections.find((section) =>
        flattenLayoutSlots(section.layout).some((slot) => slot.id === swapFromSlotId),
      )
      const targetSection = activeSheet.sections.find((section) =>
        flattenLayoutSlots(section.layout).some((slot) => slot.id === slotId),
      )
      if (sourceSection?.id !== targetSection?.id) {
        void message.warning('跨成果区段不能交换内容；请保持每项成果的归属清晰。')
      } else if (sourceSection) {
        updateActiveSheet((sheet) => ({
          ...sheet,
          sections: sheet.sections.map((section) =>
            section.id === sourceSection.id
              ? {
                  ...section,
                  layout: swapLayoutSlotSources(section.layout, swapFromSlotId, slotId),
                }
              : section,
          ),
        }))
      }
      setSwapFromSlotId(null)
    }
    setSelectedSlotId(slotId)
  }

  const applyTemplate = (templateId: LayoutTemplateId): void => {
    if (!activeSheet) return
    const capacity = TEMPLATE_OPTIONS.find((option) => option.value === templateId)?.capacity ?? 4
    const overflow = activeSheet.sections.some(
      (section) =>
        flattenLayoutSlots(section.layout).filter((slot) => slot.sourcePageId !== null).length >
        capacity,
    )
    if (overflow) {
      void message.error(`该模板每个成果区段最多容纳 ${capacity} 个页面，未执行以避免遗漏。`)
      return
    }
    updateActiveSheet((sheet) => ({
      ...sheet,
      templateId,
      sections: sheet.sections.map((section) => ({
        ...section,
        layout: createLayoutFromTemplate(
          templateId,
          flattenLayoutSlots(section.layout)
            .map((slot) => slot.sourcePageId)
            .filter((id): id is string => id !== null),
        ),
      })),
    }))
    setSelectedSlotId(null)
  }

  const repairConfiguredOrder = (): void => {
    const rankBySourcePageId = new Map(
      props.sources.map((source) => [source.sourcePageId, source.canonicalOrder]),
    )
    const sourceRank = (sourcePageId: string | null): number =>
      sourcePageId
        ? (rankBySourcePageId.get(sourcePageId) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER
    const sectionRank = (section: LayoutSheet['sections'][number]): number =>
      Math.min(...flattenLayoutSlots(section.layout).map((slot) => sourceRank(slot.sourcePageId)))
    const baseOrder =
      sheets.length > 0 ? Math.min(...sheets.map((candidate) => candidate.order)) : 0
    const repaired = sheets
      .map((sheet) => {
        const sections = [...sheet.sections].sort(
          (left, right) => sectionRank(left) - sectionRank(right),
        )
        const anchorSourcePageId = sections
          .flatMap((section) => flattenLayoutSlots(section.layout))
          .map((slot) => slot.sourcePageId)
          .filter((sourcePageId): sourcePageId is string => sourcePageId !== null)
          .sort((left, right) => sourceRank(left) - sourceRank(right))[0]
        return {
          ...sheet,
          sections,
          anchorSourcePageId: anchorSourcePageId ?? sheet.anchorSourcePageId,
          autoGenerated: false,
          updatedAt: nowIso(),
        }
      })
      .sort(
        (left, right) => sourceRank(left.anchorSourcePageId) - sourceRank(right.anchorSourcePageId),
      )
      .map((sheet, index) => ({
        ...sheet,
        order: baseOrder + index,
      }))
    setSheets(repaired)
    setActiveSheetIndex(0)
    setSelectedSlotId(firstSheetSlotId(repaired[0]))
    void message.success('已按左侧目录与材料页面顺序修复拼版页、成果区段和锚点顺序。')
  }

  const updateSectionWeight = (sectionIndex: number, percentage: number): void => {
    if (!activeSheet) return
    const preferred = activeSheet.sections.map((section) => section.heightWeight)
    preferred[sectionIndex] = Math.max(1, Math.round(percentage * 100))
    const weights = normalizeLayoutWeights(preferred.length, preferred)
    updateActiveSheet((sheet) => ({
      ...sheet,
      sections: sheet.sections.map((section, index) => ({
        ...section,
        heightWeight: weights[index] ?? section.heightWeight,
      })),
    }))
  }

  const allClarityRisks = (): { source: CollageWorkbenchSource; slot: LayoutSlot }[] => {
    const risks: { source: CollageWorkbenchSource; slot: LayoutSlot }[] = []
    sheets.forEach((sheet) => {
      sheet.sections.forEach((section, sectionIndex) => {
        const sectionSlots = flattenLayoutSlots(section.layout)
        const calculatedBounds = calculateCompositeSlotBounds(sheet, sectionIndex, true)
        const bounds = new Map(
          sectionSlots.map((slot, slotIndex) => [slot.id, calculatedBounds[slotIndex]]),
        )
        flattenLayoutSlots(section.layout).forEach((slot) => {
          if (!slot.sourcePageId || slot.clarityRiskAcknowledged) return
          const source = sourceByPageId.get(slot.sourcePageId)
          const bound = bounds.get(slot.id)
          if (!source || !bound) return
          const sourceSize = croppedSourceSize(source, slot)
          const assessment = assessLayoutClarity({
            sourceKind: source.sourceKind,
            sourceWidth: sourceSize.width,
            sourceHeight: sourceSize.height,
            bounds: bound,
            orientation: sheet.orientation,
            fit: slot.fit,
            rasterPreferredDpi: props.project.collageSettings.rasterPreferredDpi,
            rasterMinimumAutoDpi: props.project.collageSettings.rasterMinimumAutoDpi,
            pdfWarningScale: props.project.collageSettings.pdfWarningScale,
            pdfMinimumAutoScale: props.project.collageSettings.pdfMinimumAutoScale,
          })
          if (assessment.level === 'blocked') risks.push({ source, slot })
        })
      })
    })
    return risks
  }

  const submit = (): void => {
    const parsed = LayoutSheetSchema.array().safeParse(sheets)
    if (!parsed.success) {
      void message.error(parsed.error.issues[0]?.message ?? '拼版配置无效。')
      return
    }
    const risks = allClarityRisks()
    if (risks.length > 0) {
      void message.error(
        `仍有 ${risks.length} 个内容槽低于清晰度下限。请减少槽位、改为横向页面，或逐一勾选风险确认。`,
      )
      return
    }
    props.onApply(parsed.data, props.editingSheetIds)
  }

  const selectedParent =
    selectedEntry && selectedSlotId
      ? findSlotParent(selectedEntry.section.layout, selectedSlotId)
      : null
  const selectedSplitPair = (() => {
    if (selectedParent?.weights.length !== 2) return null
    const first = selectedParent.weights[0]
    const second = selectedParent.weights[1]
    return first === undefined || second === undefined ? null : { first, second }
  })()

  return (
    <Modal
      open={props.open}
      title="自主可控多图拼版"
      width="min(1480px, 96vw)"
      className="collage-workbench-modal"
      okText="应用拼版并重算预览"
      cancelText="取消"
      onOk={submit}
      onCancel={props.onCancel}
      footer={(_, { OkBtn, CancelBtn }) => (
        <div className="collage-workbench-footer">
          <Typography.Text type="secondary">
            修改只写入项目配置，不会改动 PDF、图片或 Office 原件。
          </Typography.Text>
          <Space>
            {props.editingSheetIds.length > 0 && (
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => props.onRemove(props.editingSheetIds)}
              >
                取消这些拼版页
              </Button>
            )}
            <CancelBtn />
            <OkBtn />
          </Space>
        </div>
      )}
    >
      <div className="collage-sheet-tabs">
        {sheets.map((sheet, index) => (
          <Button
            key={sheet.id}
            type={index === activeSheetIndex ? 'primary' : 'default'}
            size="small"
            onClick={() => {
              setActiveSheetIndex(index)
              setSelectedSlotId(firstSheetSlotId(sheet))
            }}
          >
            拼版页 {index + 1}
          </Button>
        ))}
        {sheets.length > 0 && (
          <Button size="small" onClick={repairConfiguredOrder}>
            按目录修复顺序
          </Button>
        )}
      </div>
      {activeSheet ? (
        <div className="collage-workbench-grid">
          <aside className="collage-source-panel">
            <div className="collage-panel-title">来源页面</div>
            <Typography.Paragraph type="secondary">
              来源仅用于本次拼版。跨成果时，每项成果始终占独立全宽区段。
            </Typography.Paragraph>
            <div className="collage-source-list">
              {props.sources.map((source) => (
                <button
                  type="button"
                  key={source.sourcePageId}
                  className={`collage-source-card ${
                    selectedEntry?.slot.sourcePageId === source.sourcePageId ? 'active' : ''
                  }`}
                  onClick={() => assignSourceToSelectedSlot(source)}
                >
                  <SourceThumbnail source={source} planFingerprint={props.planFingerprint} />
                  <span>{source.label}</span>
                  <small>{source.materialTitle}</small>
                </button>
              ))}
            </div>
          </aside>

          <main className="collage-canvas-panel">
            <div
              className={`collage-a4-sheet ${activeSheet.orientation}`}
              style={{
                padding: `${Math.max(8, activeSheet.margins.top / 3)}px ${Math.max(
                  8,
                  activeSheet.margins.right / 3,
                )}px ${Math.max(8, activeSheet.margins.bottom / 3)}px ${Math.max(
                  8,
                  activeSheet.margins.left / 3,
                )}px`,
                gap: activeSheet.sectionGapPoints / 2,
              }}
            >
              {activeSheet.sections.map((section) => (
                <section
                  key={section.id}
                  className="collage-material-section"
                  style={{ flexGrow: section.heightWeight, flexBasis: 0 }}
                >
                  <header>
                    {props.project.outlineNodes
                      .flatMap((root) => root.children)
                      .flatMap((node) => node.materials)
                      .find((material) => material.id === section.materialId)?.title ?? '未知成果'}
                    {section.showContinuationTitle ? <Tag>续页显示标题</Tag> : null}
                  </header>
                  <div className="collage-section-layout">
                    <LayoutNodeView
                      node={section.layout}
                      gap={Math.max(2, activeSheet.slotGapPoints / 2)}
                      sources={sourceByPageId}
                      planFingerprint={props.planFingerprint}
                      selectedSlotId={selectedSlotId}
                      swapFromSlotId={swapFromSlotId}
                      onSelectSlot={selectSlot}
                    />
                  </div>
                </section>
              ))}
            </div>
            <div className="collage-canvas-caption">
              A4 {activeSheet.orientation === 'portrait' ? '纵向' : '横向'} ·
              {activeSheet.sections.length} 个成果区段 ·
              {activeSheet.sections.reduce(
                (count, section) => count + flattenLayoutSlots(section.layout).length,
                0,
              )}{' '}
              个内容槽
            </div>
          </main>

          <aside className="collage-control-panel">
            <div className="collage-panel-title">页面与槽位设置</div>
            <label className="collage-control-label">快速模板</label>
            <Select
              value={activeSheet.templateId}
              placeholder="选择模板"
              options={TEMPLATE_OPTIONS}
              onChange={applyTemplate}
            />
            <label className="collage-control-label">A4 页面方向</label>
            <Segmented
              block
              value={activeSheet.orientation}
              options={[
                { value: 'portrait', label: '纵向' },
                { value: 'landscape', label: '横向' },
              ]}
              onChange={(orientation) =>
                updateActiveSheet((sheet) => ({
                  ...sheet,
                  orientation: orientation as 'portrait' | 'landscape',
                }))
              }
            />
            <div className="collage-number-grid">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <label key={side}>
                  {
                    ({ top: '上边距', right: '右边距', bottom: '下边距', left: '左边距' } as const)[
                      side
                    ]
                  }
                  <InputNumber
                    min={0}
                    max={144}
                    value={activeSheet.margins[side]}
                    onChange={(value) =>
                      updateActiveSheet((sheet) => ({
                        ...sheet,
                        margins: { ...sheet.margins, [side]: value ?? 0 },
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <label className="collage-control-label">槽间距 {activeSheet.slotGapPoints} pt</label>
            <Slider
              min={0}
              max={24}
              value={activeSheet.slotGapPoints}
              onChange={(slotGapPoints) =>
                updateActiveSheet((sheet) => ({ ...sheet, slotGapPoints }))
              }
            />
            {activeSheet.sections.length > 1 && (
              <>
                <label className="collage-control-label">
                  成果区段间距 {activeSheet.sectionGapPoints} pt
                </label>
                <Slider
                  min={0}
                  max={36}
                  value={activeSheet.sectionGapPoints}
                  onChange={(sectionGapPoints) =>
                    updateActiveSheet((sheet) => ({ ...sheet, sectionGapPoints }))
                  }
                />
                <label className="collage-control-label">成果区段高度比例</label>
                {activeSheet.sections.map((section, index) => {
                  const materialTitle =
                    props.project.outlineNodes
                      .flatMap((root) => root.children)
                      .flatMap((node) => node.materials)
                      .find((material) => material.id === section.materialId)?.title ?? '未知成果'
                  return (
                    <div key={section.id} className="collage-section-weight">
                      <span title={materialTitle}>{materialTitle}</span>
                      <Space.Compact>
                        <InputNumber
                          min={5}
                          max={95}
                          value={Math.round(section.heightWeight / 100)}
                          onChange={(value) => updateSectionWeight(index, value ?? 5)}
                        />
                        <Button disabled>%</Button>
                      </Space.Compact>
                    </div>
                  )
                })}
              </>
            )}
            <Checkbox
              checked={activeSheet.locked}
              onChange={(event) =>
                updateActiveSheet((sheet) => ({ ...sheet, locked: event.target.checked }))
              }
            >
              锁定此拼版页，避免自动建议覆盖
            </Checkbox>

            {selectedEntry ? (
              <div className="collage-slot-controls">
                <Typography.Title level={5}>选中内容槽</Typography.Title>
                <Space wrap>
                  <Tooltip title="横向拆分当前槽">
                    <Button
                      icon={<ColumnWidthOutlined />}
                      onClick={() =>
                        updateSelectedSectionLayout((layout) =>
                          splitLayoutSlot(layout, selectedEntry.slot.id, 'row'),
                        )
                      }
                    >
                      左右拆分
                    </Button>
                  </Tooltip>
                  <Tooltip title="纵向拆分当前槽">
                    <Button
                      icon={<BorderInnerOutlined />}
                      onClick={() =>
                        updateSelectedSectionLayout((layout) =>
                          splitLayoutSlot(layout, selectedEntry.slot.id, 'column'),
                        )
                      }
                    >
                      上下拆分
                    </Button>
                  </Tooltip>
                  <Button
                    icon={<SwapOutlined />}
                    type={swapFromSlotId === selectedEntry.slot.id ? 'primary' : 'default'}
                    onClick={() =>
                      setSwapFromSlotId(
                        swapFromSlotId === selectedEntry.slot.id ? null : selectedEntry.slot.id,
                      )
                    }
                  >
                    {swapFromSlotId ? '再点目标槽交换' : '交换内容'}
                  </Button>
                  <Button
                    icon={<DeleteOutlined />}
                    disabled={selectedEntry.slot.sourcePageId !== null}
                    onClick={() =>
                      updateSelectedSectionLayout((layout) =>
                        removeEmptyLayoutSlot(layout, selectedEntry.slot.id),
                      )
                    }
                  >
                    合并空槽
                  </Button>
                  <Button
                    danger
                    disabled={selectedEntry.slot.sourcePageId === null}
                    onClick={() =>
                      updateSelectedSectionLayout((layout) =>
                        updateLayoutSlot(layout, selectedEntry.slot.id, (slot) => ({
                          ...slot,
                          sourcePageId: null,
                          detailOf: null,
                          clarityRiskAcknowledged: false,
                        })),
                      )
                    }
                  >
                    移出当前槽
                  </Button>
                </Space>

                {selectedEntry.slot.sourcePageId && (
                  <>
                    <label className="collage-control-label">适配方式</label>
                    <Select
                      value={selectedEntry.slot.fit}
                      options={[
                        { value: 'contain', label: '完整显示，不裁切' },
                        { value: 'cover', label: '铺满内容槽' },
                        { value: 'fitWidth', label: '适合宽度' },
                        { value: 'fitHeight', label: '适合高度' },
                      ]}
                      onChange={(fit) =>
                        updateSelectedSectionLayout((layout) =>
                          updateLayoutSlot(layout, selectedEntry.slot.id, (slot) => ({
                            ...slot,
                            fit,
                          })),
                        )
                      }
                    />
                    <label className="collage-control-label">对齐</label>
                    <Select
                      value={selectedEntry.slot.alignment}
                      options={ALIGNMENT_OPTIONS}
                      onChange={(alignment) =>
                        updateSelectedSectionLayout((layout) =>
                          updateLayoutSlot(layout, selectedEntry.slot.id, (slot) => ({
                            ...slot,
                            alignment,
                          })),
                        )
                      }
                    />
                    <Space wrap>
                      <Button
                        icon={<RotateRightOutlined />}
                        onClick={() =>
                          updateSelectedSectionLayout((layout) =>
                            rotateLayoutSlot(
                              layout,
                              selectedEntry.slot.id,
                              ((selectedEntry.slot.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                            ),
                          )
                        }
                      >
                        旋转 90°
                      </Button>
                      <Button
                        icon={<ScissorOutlined />}
                        onClick={() =>
                          updateSelectedSectionLayout((layout) =>
                            updateLayoutSlot(layout, selectedEntry.slot.id, (slot) => ({
                              ...slot,
                              cropRect: { x: 0, y: 0, width: 10000, height: 10000 },
                            })),
                          )
                        }
                      >
                        重置裁切
                      </Button>
                      <Button
                        icon={<ScissorOutlined />}
                        loading={detectingCropSlotId === selectedEntry.slot.id}
                        disabled={!props.project.collageSettings.autoCropEnabled}
                        onClick={() => void detectSelectedCrop()}
                      >
                        自动去白边
                      </Button>
                      <Button
                        onClick={() =>
                          updateSelectedSectionLayout((layout) =>
                            duplicateLayoutSlotAsDetail(layout, selectedEntry.slot.id, 'row'),
                          )
                        }
                      >
                        原图＋细节
                      </Button>
                    </Space>
                    <label className="collage-control-label">
                      水平裁切起点 {Math.round(selectedEntry.slot.cropRect.x / 100)}%
                    </label>
                    <Slider
                      min={0}
                      max={10000 - selectedEntry.slot.cropRect.width}
                      value={selectedEntry.slot.cropRect.x}
                      onChange={(x) =>
                        updateSelectedSectionLayout((layout) =>
                          updateLayoutSlot(layout, selectedEntry.slot.id, (slot) => ({
                            ...slot,
                            cropRect: { ...slot.cropRect, x },
                          })),
                        )
                      }
                    />
                    <label className="collage-control-label">
                      垂直裁切起点 {Math.round(selectedEntry.slot.cropRect.y / 100)}%
                    </label>
                    <Slider
                      min={0}
                      max={10000 - selectedEntry.slot.cropRect.height}
                      value={selectedEntry.slot.cropRect.y}
                      onChange={(y) =>
                        updateSelectedSectionLayout((layout) =>
                          updateLayoutSlot(layout, selectedEntry.slot.id, (slot) => ({
                            ...slot,
                            cropRect: { ...slot.cropRect, y },
                          })),
                        )
                      }
                    />
                    <label className="collage-control-label">
                      保留宽度 {Math.round(selectedEntry.slot.cropRect.width / 100)}%
                    </label>
                    <Slider
                      min={500}
                      max={10000 - selectedEntry.slot.cropRect.x}
                      value={selectedEntry.slot.cropRect.width}
                      onChange={(width) =>
                        updateSelectedSectionLayout((layout) =>
                          updateLayoutSlot(layout, selectedEntry.slot.id, (slot) => ({
                            ...slot,
                            cropRect: { ...slot.cropRect, width },
                          })),
                        )
                      }
                    />
                    <label className="collage-control-label">
                      保留高度 {Math.round(selectedEntry.slot.cropRect.height / 100)}%
                    </label>
                    <Slider
                      min={500}
                      max={10000 - selectedEntry.slot.cropRect.y}
                      value={selectedEntry.slot.cropRect.height}
                      onChange={(height) =>
                        updateSelectedSectionLayout((layout) =>
                          updateLayoutSlot(layout, selectedEntry.slot.id, (slot) => ({
                            ...slot,
                            cropRect: { ...slot.cropRect, height },
                          })),
                        )
                      }
                    />
                    {selectedParent && selectedSplitPair ? (
                      <>
                        <label className="collage-control-label">
                          分割比例 {Math.round(selectedSplitPair.first / 100)}% /{' '}
                          {Math.round(selectedSplitPair.second / 100)}%
                        </label>
                        <Slider
                          min={10}
                          max={90}
                          value={selectedSplitPair.first / 100}
                          onChange={(percentage) =>
                            updateSelectedSectionLayout((layout) =>
                              resizeLayoutSplit(
                                layout,
                                selectedParent.splitId,
                                0,
                                percentage * 100 - selectedSplitPair.first,
                              ),
                            )
                          }
                        />
                      </>
                    ) : null}
                    {selectedClarity && (
                      <Alert
                        type={
                          selectedClarity.level === 'good'
                            ? 'success'
                            : selectedClarity.level === 'warning'
                              ? 'warning'
                              : 'error'
                        }
                        showIcon
                        title={`预计清晰度：${selectedClarity.metricLabel}`}
                        description={selectedClarity.message}
                      />
                    )}
                    {selectedClarity?.level === 'blocked' && (
                      <Checkbox
                        checked={selectedEntry.slot.clarityRiskAcknowledged}
                        onChange={(event) =>
                          updateSelectedSectionLayout((layout) =>
                            updateLayoutSlot(layout, selectedEntry.slot.id, (slot) => ({
                              ...slot,
                              clarityRiskAcknowledged: event.target.checked,
                            })),
                          )
                        }
                      >
                        我已检查该内容，确认专家仍可清晰阅读
                      </Checkbox>
                    )}
                  </>
                )}
              </div>
            ) : (
              <Alert type="info" showIcon title="请在 A4 画布中选择一个内容槽。" />
            )}
          </aside>
        </div>
      ) : (
        <Alert type="error" showIcon title="没有可编辑的拼版页。" />
      )}
    </Modal>
  )
}
