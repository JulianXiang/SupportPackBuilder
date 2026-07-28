import {
  AppstoreAddOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  FolderAddOutlined,
  HolderOutlined,
  ImportOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { App, Badge, Button, Checkbox, Dropdown, Input, Tag, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import type { PagePlan } from '../../../../shared/schemas/page-plan-schema.js'
import type { Material, OutlineNode, Project } from '../../../../shared/schemas/project-schema.js'
import { stripSequencePrefix } from '../../../../shared/utils/sequence-label.js'
import type { Selection } from '../../stores/project-store.js'
import { findOutlineNode } from '../../utils/project.js'

type OutlinePanelProps = {
  project: Project
  plan: PagePlan | null
  selection: Selection | null
  onSelect: (selection: Selection) => void
  onMutate: (mutator: (draft: Project) => void, selection?: Selection) => void
  onImport: () => void
}

type SortableRowProps = {
  id: string
  selected: boolean
  depth: number
  className?: string
  children: React.ReactNode
  onClick: () => void
}

const SortableRow = (props: SortableRowProps): React.JSX.Element => {
  const sortable = useSortable({ id: props.id })
  return (
    <div
      ref={sortable.setNodeRef}
      className={`outline-row ${props.selected ? 'selected' : ''} ${props.className ?? ''}`}
      style={{
        paddingLeft: 8 + props.depth * 18,
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.55 : 1,
      }}
      onClick={props.onClick}
    >
      <button
        type="button"
        className="drag-handle"
        aria-label="拖拽排序"
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <HolderOutlined />
      </button>
      {props.children}
    </div>
  )
}

const materialCount = (node: OutlineNode): number =>
  node.materials.length + node.children.reduce((total, child) => total + child.materials.length, 0)

const findContainer = (
  project: Project,
  id: string,
): { kind: 'root' | 'children' | 'materials'; ids: string[] } | null => {
  if (project.outlineNodes.some((node) => node.id === id)) {
    return { kind: 'root', ids: project.outlineNodes.map((node) => node.id) }
  }
  for (const node of project.outlineNodes) {
    if (node.children.some((child) => child.id === id)) {
      return { kind: 'children', ids: node.children.map((child) => child.id) }
    }
    for (const child of node.children) {
      if (child.materials.some((material) => material.id === id)) {
        return { kind: 'materials', ids: child.materials.map((material) => material.id) }
      }
    }
  }
  return null
}

export const OutlinePanel = (props: OutlinePanelProps): React.JSX.Element => {
  const { modal, message } = App.useApp()
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(
        props.project.outlineNodes.flatMap((node) => [
          node.id,
          ...node.children.map((child) => child.id),
        ]),
      ),
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const allIds = useMemo(
    () =>
      props.project.outlineNodes.flatMap((node) => [
        node.id,
        ...node.children.flatMap((child) => [
          child.id,
          ...child.materials.map((material) => material.id),
        ]),
      ]),
    [props.project],
  )

  const requestTitle = (
    title: string,
    initialValue: string,
    onConfirm: (value: string) => void,
  ): void => {
    let value = initialValue
    modal.confirm({
      title,
      content: (
        <Input
          autoFocus
          defaultValue={initialValue}
          maxLength={200}
          onChange={(event) => {
            value = event.target.value
          }}
        />
      ),
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        const normalized = value.trim()
        if (!normalized) throw new Error('标题不能为空。')
        onConfirm(normalized)
      },
    })
  }

  const addLevelOne = (): void => {
    requestTitle('新增一级目录', `新建分类 ${props.project.outlineNodes.length + 1}`, (title) => {
      const id = crypto.randomUUID()
      const pureTitle = stripSequencePrefix(title, 1)
      props.onMutate(
        (draft) => {
          draft.outlineNodes.push({
            id,
            parentId: null,
            level: 1,
            title: pureTitle,
            order: draft.outlineNodes.length,
            enabled: true,
            insertDividerPage: false,
            children: [],
            materials: [],
          })
        },
        { kind: 'outline', id },
      )
      setExpanded((current) => new Set(current).add(id))
    })
  }

  const addLevelTwo = (): void => {
    const selectedId = props.selection?.kind === 'outline' ? props.selection.id : null
    const selected = selectedId ? findOutlineNode(props.project, selectedId) : null
    const parent = selected?.node.level === 1 ? selected.node : selected?.parent
    if (!parent) {
      void message.warning('请先选择一个一级目录。')
      return
    }
    requestTitle('新增二级目录', '新建材料分组', (title) => {
      const id = crypto.randomUUID()
      const pureTitle = stripSequencePrefix(title, 2)
      props.onMutate(
        (draft) => {
          const target = draft.outlineNodes.find((node) => node.id === parent.id)
          if (!target) return
          target.children.push({
            id,
            parentId: target.id,
            level: 2,
            title: pureTitle,
            order: target.children.length,
            enabled: true,
            insertDividerPage: false,
            children: [],
            materials: [],
          })
        },
        { kind: 'outline', id },
      )
      setExpanded((current) => new Set(current).add(parent.id))
    })
  }

  const deleteNode = (node: OutlineNode): void => {
    const count = materialCount(node)
    modal.confirm({
      title: `删除目录“${node.title}”？`,
      content:
        count > 0 ? `该目录包含 ${count} 项材料。删除后可通过撤销恢复。` : '此操作可通过撤销恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () =>
        props.onMutate(
          (draft) => {
            if (node.level === 1)
              draft.outlineNodes = draft.outlineNodes.filter((item) => item.id !== node.id)
            else
              draft.outlineNodes.forEach((parent) => {
                parent.children = parent.children.filter((item) => item.id !== node.id)
              })
          },
          { kind: 'project', id: props.project.id },
        ),
    })
  }

  const duplicateNode = (node: OutlineNode): void => {
    props.onMutate((draft) => {
      if (node.level === 1) {
        const id = crypto.randomUUID()
        draft.outlineNodes.push({
          ...structuredClone(node),
          id,
          title: `${node.title}（副本）`,
          order: draft.outlineNodes.length,
          materials: [],
          children: node.children.map((child, index) => ({
            ...structuredClone(child),
            id: crypto.randomUUID(),
            parentId: id,
            order: index,
            materials: [],
          })),
        })
      } else {
        const parent = draft.outlineNodes.find((item) => item.id === node.parentId)
        parent?.children.push({
          ...structuredClone(node),
          id: crypto.randomUUID(),
          title: `${node.title}（副本）`,
          order: parent.children.length,
          materials: [],
        })
      }
    })
  }

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return
    const activeContainer = findContainer(props.project, String(active.id))
    const overContainer = findContainer(props.project, String(over.id))
    if (!activeContainer || activeContainer.kind !== overContainer?.kind) return
    if (activeContainer.ids.join('|') !== overContainer.ids.join('|')) {
      void message.info('跨目录移动请使用材料属性中的“所属目录”。')
      return
    }
    const oldIndex = activeContainer.ids.indexOf(String(active.id))
    const newIndex = activeContainer.ids.indexOf(String(over.id))
    props.onMutate((draft) => {
      if (activeContainer.kind === 'root') {
        draft.outlineNodes = arrayMove(draft.outlineNodes, oldIndex, newIndex).map(
          (node, index) => ({ ...node, order: index }),
        )
        return
      }
      for (const parent of draft.outlineNodes) {
        if (
          activeContainer.kind === 'children' &&
          parent.children.some((child) => child.id === active.id)
        ) {
          parent.children = arrayMove(parent.children, oldIndex, newIndex).map((node, index) => ({
            ...node,
            order: index,
          }))
          return
        }
        for (const child of parent.children) {
          if (
            activeContainer.kind === 'materials' &&
            child.materials.some((material) => material.id === active.id)
          ) {
            child.materials = arrayMove(child.materials, oldIndex, newIndex).map(
              (material, index) => ({ ...material, order: index }),
            )
            return
          }
        }
      }
    })
  }

  const toggleExpanded = (id: string): void =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const nodeMenu = (node: OutlineNode) => ({
    items: [
      { key: 'duplicate', label: '复制目录结构', icon: <CopyOutlined /> },
      { key: 'delete', label: '删除目录', icon: <DeleteOutlined />, danger: true },
    ],
    onClick: ({ key }: { key: string }) =>
      key === 'delete' ? deleteNode(node) : duplicateNode(node),
  })

  const renderMaterial = (material: Material): React.JSX.Element => (
    <SortableRow
      id={material.id}
      key={material.id}
      depth={2}
      className="material-row"
      selected={props.selection?.kind === 'material' && props.selection.id === material.id}
      onClick={() => props.onSelect({ kind: 'material', id: material.id })}
    >
      <FilePdfOutlined className="outline-icon" />
      <span className="outline-title" title={material.title}>
        {props.plan?.materialSequenceLabels[material.id] ? (
          <span className="outline-sequence">{props.plan.materialSequenceLabels[material.id]}</span>
        ) : null}
        {material.title}
      </span>
      {props.plan && !props.plan.outputMaterialIds.includes(material.id) ? (
        <Tag className="outline-output-tag" variant="filled">
          未输出
        </Tag>
      ) : null}
      <Badge
        status={
          material.validationStatus === 'valid'
            ? 'success'
            : material.validationStatus === 'warning'
              ? 'warning'
              : 'error'
        }
      />
    </SortableRow>
  )

  const renderNode = (node: OutlineNode, depth: number): React.JSX.Element => {
    const isExpanded = expanded.has(node.id)
    return (
      <div key={node.id}>
        <Dropdown menu={nodeMenu(node)} trigger={['contextMenu']}>
          <div>
            <SortableRow
              id={node.id}
              depth={depth}
              selected={props.selection?.kind === 'outline' && props.selection.id === node.id}
              onClick={() => props.onSelect({ kind: 'outline', id: node.id })}
            >
              <button
                type="button"
                className="expand-button"
                onClick={(event) => {
                  event.stopPropagation()
                  toggleExpanded(node.id)
                }}
              >
                {isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
              </button>
              <Checkbox
                checked={node.enabled}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) =>
                  props.onMutate((draft) => {
                    const found = findOutlineNode(draft, node.id)
                    if (found) found.node.enabled = event.target.checked
                  })
                }
              />
              <span className="outline-title" title={node.title}>
                {props.plan?.outlineSequenceLabels[node.id] ? (
                  <span className="outline-sequence">
                    {props.plan.outlineSequenceLabels[node.id]}
                  </span>
                ) : null}
                {node.title}
              </span>
              {props.plan && !props.plan.outputOutlineNodeIds.includes(node.id) ? (
                <Tag className="outline-output-tag" variant="filled">
                  未输出
                </Tag>
              ) : null}
              <span className="outline-count">{materialCount(node)}</span>
            </SortableRow>
          </div>
        </Dropdown>
        {isExpanded && node.level === 1 && (
          <SortableContext
            items={node.children.map((child) => child.id)}
            strategy={verticalListSortingStrategy}
          >
            {node.children.map((child) => renderNode(child, depth + 1))}
          </SortableContext>
        )}
        {isExpanded && node.level === 2 && (
          <SortableContext
            items={node.materials.map((material) => material.id)}
            strategy={verticalListSortingStrategy}
          >
            {node.materials.map(renderMaterial)}
          </SortableContext>
        )}
      </div>
    )
  }

  return (
    <aside className="outline-panel">
      <div className="panel-heading">
        <div>
          <strong>项目目录</strong>
          <span className="panel-subtitle">两级目录与材料</span>
        </div>
        <Tooltip title="导入到当前二级目录">
          <Button type="text" size="small" icon={<ImportOutlined />} onClick={props.onImport} />
        </Tooltip>
      </div>
      <div className="outline-actions">
        <Button size="small" icon={<PlusOutlined />} onClick={addLevelOne}>
          一级
        </Button>
        <Button size="small" icon={<FolderAddOutlined />} onClick={addLevelTwo}>
          二级
        </Button>
        <Button
          size="small"
          icon={<AppstoreAddOutlined />}
          onClick={() =>
            props.onMutate((draft) => {
              draft.outlineNodes.forEach((node) => {
                node.enabled = true
                node.children.forEach((child) => {
                  child.enabled = true
                })
              })
            })
          }
        >
          全部启用
        </Button>
      </div>
      <div className="outline-scroll">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
            {props.project.outlineNodes.length === 0 ? (
              <div className="outline-empty">尚未建立目录。请新增一级目录。</div>
            ) : (
              props.project.outlineNodes.map((node) => renderNode(node, 0))
            )}
          </SortableContext>
        </DndContext>
      </div>
    </aside>
  )
}
