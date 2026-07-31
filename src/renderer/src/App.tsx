import {
  App as AntApp,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecentProjectView } from '../../preload/api-types.js'
import type { ExportPreflight, ExportProgress, ExportResult } from '../../shared/types/export.js'
import type {
  ImportAnalysis,
  ImportAnalysisProgress,
  ImportCommitInput,
} from '../../shared/types/import.js'
import { PROJECT_TEMPLATES } from '../../shared/templates/index.js'
import { TopToolbar } from './components/TopToolbar.js'
import { StatusBar } from './components/StatusBar.js'
import { ExportDialog } from './features/export/ExportDialog.js'
import { ImportDialog } from './features/materials/ImportDialog.js'
import { OutlinePanel } from './features/outline/OutlinePanel.js'
import { PreviewPanel } from './features/preview/PreviewPanel.js'
import { WelcomeView } from './features/project/WelcomeView.js'
import { InspectorPanel } from './features/settings/InspectorPanel.js'
import { useProjectStore } from './stores/project-store.js'
import { findMaterial, findOutlineNode, removeMaterialsFromLayoutSheets } from './utils/project.js'

type NewProjectValues = {
  title: string
  ownerName: string
  organization: string
  purpose: string
  compiledDate: dayjs.Dayjs
  templateId: string
}

const isEditingText = (): boolean => {
  const active = document.activeElement
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active?.getAttribute('contenteditable') === 'true'
  )
}

export default function App(): React.JSX.Element {
  const { message, modal } = AntApp.useApp()
  const store = useProjectStore()
  const [recentProjects, setRecentProjects] = useState<RecentProjectView[]>([])
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectSaving, setNewProjectSaving] = useState(false)
  const [newProjectForm] = Form.useForm<NewProjectValues>()
  const [importAnalysis, setImportAnalysis] = useState<ImportAnalysis | null>(null)
  const [importProgress, setImportProgress] = useState<ImportAnalysisProgress | null>(null)
  const [importCommitting, setImportCommitting] = useState(false)
  const [exportChecking, setExportChecking] = useState(false)
  const [exportStarting, setExportStarting] = useState(false)
  const [exportPreflight, setExportPreflight] = useState<ExportPreflight | null>(null)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const previewRequestId = useRef(0)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showError = useCallback(
    (title: string, detail: string): void => {
      modal.error({ title, content: detail, okText: '知道了' })
    },
    [modal],
  )

  const refreshRecent = useCallback(async (): Promise<void> => {
    const result = await window.supportPack.project.recent()
    if (result.ok) setRecentProjects(result.value)
  }, [])

  useEffect(() => {
    void refreshRecent()
  }, [refreshRecent])

  const applySession = useCallback(
    (session: Parameters<typeof store.setSession>[0]): void => {
      store.setSession(session)
      void refreshRecent()
    },
    [refreshRecent, store],
  )

  const saveProject = useCallback(async (): Promise<boolean> => {
    const current = useProjectStore.getState()
    if (!current.project) return false
    current.setSaveStatus('saving')
    const result = await window.supportPack.project.save({
      project: current.project,
      expectedRevision: current.revision,
    })
    if (!result.ok) {
      current.setSaveStatus('error', result.error.message)
      void message.error(`保存失败：${result.error.message}`)
      return false
    }
    useProjectStore.getState().applySavedSession(result.value)
    return true
  }, [message])

  const saveAsProject = useCallback(async (): Promise<void> => {
    const current = useProjectStore.getState()
    if (!current.project) return
    current.setSaveStatus('saving')
    const result = await window.supportPack.project.saveAs({
      project: current.project,
      expectedRevision: current.revision,
    })
    if (!result.ok) {
      current.setSaveStatus('error', result.error.message)
      showError('另存为失败', result.error.message)
      return
    }
    if (result.value) applySession(result.value)
    else current.setSaveStatus(current.dirty ? 'dirty' : 'saved')
  }, [applySession, showError])

  const openProject = useCallback(async (): Promise<void> => {
    const execute = async (): Promise<void> => {
      const result = await window.supportPack.project.open()
      if (!result.ok) showError('打开项目失败', result.error.message)
      else if (result.value) applySession(result.value)
    }
    if (useProjectStore.getState().dirty) {
      modal.confirm({
        title: '当前项目有未保存修改',
        content: '打开其他项目会丢弃尚未保存的修改。',
        okText: '丢弃并打开',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: execute,
      })
    } else await execute()
  }, [applySession, modal, showError])

  const openRecent = useCallback(
    async (recent: RecentProjectView): Promise<void> => {
      const result = await window.supportPack.project.openRecent(recent.projectDirectory)
      if (!result.ok) showError('打开最近项目失败', result.error.message)
      else applySession(result.value)
    },
    [applySession, showError],
  )

  const requestNewProject = useCallback((): void => {
    const open = (): void => {
      newProjectForm.setFieldsValue({
        title: '2026 年度个人成果支撑材料',
        ownerName: '',
        organization: '',
        purpose: '个人成果汇编',
        compiledDate: dayjs(),
        templateId: 'title-application',
      })
      setNewProjectOpen(true)
    }
    if (useProjectStore.getState().dirty) {
      modal.confirm({
        title: '当前项目有未保存修改',
        content: '新建项目会丢弃尚未保存的修改。',
        okText: '丢弃并新建',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: open,
      })
    } else open()
  }, [modal, newProjectForm])

  const createProject = async (): Promise<void> => {
    const values = await newProjectForm.validateFields()
    setNewProjectSaving(true)
    const result = await window.supportPack.project.create({
      title: values.title,
      ownerName: values.ownerName,
      organization: values.organization,
      purpose: values.purpose,
      compiledDate: values.compiledDate.format('YYYY-MM-DD'),
      templateId: values.templateId,
    })
    setNewProjectSaving(false)
    if (!result.ok) showError('新建项目失败', result.error.message)
    else if (result.value) {
      applySession(result.value)
      setNewProjectOpen(false)
    }
  }

  useEffect(() => {
    window.supportPack.app.setDirty(store.dirty)
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    if (store.project && store.dirty && store.saveStatus !== 'saving') {
      autoSaveTimer.current = setTimeout(() => {
        void saveProject()
      }, 1_500)
    }
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [saveProject, store.dirty, store.project, store.revision, store.saveStatus])

  useEffect(() => {
    if (!store.project) return
    const requestId = ++previewRequestId.current
    store.setPlanLoading(true)
    const timer = setTimeout(() => {
      const current = useProjectStore.getState()
      if (!current.project) return
      void window.supportPack.preview
        .plan({ project: current.project, expectedRevision: current.revision })
        .then((result) => {
          if (requestId !== previewRequestId.current) return
          if (result.ok) current.setPagePlan(result.value)
          else if (!result.error.message.includes('版本已过期')) {
            current.setPlanLoading(false)
            void message.warning(`页面计划计算失败：${result.error.message}`)
          }
        })
    }, 350)
    return () => clearTimeout(timer)
  }, [message, store.project, store.revision])

  const targetOutlineNodeId = useMemo(() => {
    if (!store.project) return null
    if (store.selection?.kind === 'outline') {
      const found = findOutlineNode(store.project, store.selection.id)
      if (found?.node.level === 2) return found.node.id
      if (found?.node.level === 1) return found.node.children[0]?.id ?? null
    }
    if (store.selection?.kind === 'material')
      return findMaterial(store.project, store.selection.id)?.node.id ?? null
    if (store.selection?.kind === 'page') {
      const page = store.pagePlan?.pages.find((item) => item.id === store.selection?.id)
      if (page?.materialId) return findMaterial(store.project, page.materialId)?.node.id ?? null
      if (page?.outlineNodeId) {
        const found = findOutlineNode(store.project, page.outlineNodeId)
        return found?.node.level === 2 ? found.node.id : (found?.node.children[0]?.id ?? null)
      }
    }
    return store.project.outlineNodes[0]?.children[0]?.id ?? null
  }, [store.pagePlan, store.project, store.selection])

  const analyzeImport = useCallback(
    async (kind: 'files' | 'folder'): Promise<void> => {
      if (!useProjectStore.getState().project) return
      setImportProgress(null)
      const result =
        kind === 'files'
          ? await window.supportPack.import.selectFiles()
          : await window.supportPack.import.selectFolder()
      setImportProgress(null)
      if (!result.ok) {
        if (!result.error.message.includes('取消'))
          showError('文件导入检查失败', result.error.message)
      } else if (result.value) setImportAnalysis(result.value)
    },
    [showError],
  )

  const commitImport = async (input: ImportCommitInput): Promise<void> => {
    setImportCommitting(true)
    const result = await window.supportPack.import.commit(input)
    setImportCommitting(false)
    if (!result.ok) {
      showError('导入材料失败', result.error.message)
      return
    }
    const current = useProjectStore.getState()
    current.replaceProjectFromMain(result.value.project, current.revision + 1, true)
    setImportAnalysis(null)
    setImportProgress(null)
    void message.success(
      `已导入 ${result.value.importedMaterialIds.length} 项材料，替换 ${result.value.replacedMaterialIds.length} 项，跳过 ${result.value.skippedCount} 个文件。`,
    )
  }

  useEffect(
    () =>
      window.supportPack.import.onDropped((result) => {
        if (result.ok) setImportAnalysis(result.value)
        else showError('拖入文件失败', result.error.message)
      }),
    [showError],
  )

  useEffect(
    () =>
      window.supportPack.import.onAnalysisProgress((progress) => {
        setImportProgress(progress)
      }),
    [],
  )

  const checkExport = useCallback(async (): Promise<void> => {
    const current = useProjectStore.getState()
    if (!current.project) return
    setExportChecking(true)
    setExportPreflight(null)
    setExportProgress(null)
    setExportResult(null)
    const result = await window.supportPack.export.preflight({
      project: current.project,
      expectedRevision: current.revision,
    })
    setExportChecking(false)
    if (!result.ok) showError('导出前检查失败', result.error.message)
    else setExportPreflight(result.value)
  }, [showError])

  const startExport = async (taskId: string): Promise<void> => {
    setExportStarting(true)
    const result = await window.supportPack.export.start(taskId)
    setExportStarting(false)
    if (!result.ok) showError('启动导出失败', result.error.message)
    else if (result.value)
      setExportProgress({
        taskId,
        stage: 'planning',
        stageLabel: '正在启动后台导出',
        processedPages: 0,
        totalPages: exportPreflight?.plan.totalPageCount ?? 0,
        percentage: 1,
        elapsedMilliseconds: 0,
      })
  }

  useEffect(() => {
    const removeProgress = window.supportPack.export.onProgress((progress) =>
      setExportProgress(progress),
    )
    const removeFinished = window.supportPack.export.onFinished((result) => {
      setExportResult(result)
      setExportProgress(null)
    })
    return () => {
      removeProgress()
      removeFinished()
    }
  }, [])

  const deleteSelection = useCallback((): void => {
    const current = useProjectStore.getState()
    if (!current.project || !current.selection || isEditingText()) return
    if (current.selection.kind === 'page') {
      const page = current.pagePlan?.pages.find((item) => item.id === current.selection?.id)
      const materialId = page?.materialId
      const sourcePageId = page?.sourcePageId
      if (materialId && sourcePageId)
        current.mutateProject((draft) => {
          const found = findMaterial(draft, materialId)
          if (found && !found.material.removedPages.includes(sourcePageId))
            found.material.removedPages.push(sourcePageId)
        })
      return
    }
    if (current.selection.kind === 'material') {
      const material = findMaterial(current.project, current.selection.id)?.material
      if (!material) return
      const projectId = current.project.id
      modal.confirm({
        title: `删除材料“${material.title}”？`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () =>
          current.mutateProject(
            (draft) => {
              draft.outlineNodes.forEach((node) =>
                node.children.forEach((child) => {
                  child.materials = child.materials.filter((item) => item.id !== material.id)
                }),
              )
              removeMaterialsFromLayoutSheets(draft, [material.id])
            },
            { kind: 'project', id: projectId },
          ),
      })
    }
  }, [modal])

  useEffect(
    () =>
      window.supportPack.app.onCommand((command) => {
        if (isEditingText() && ['undo', 'redo', 'delete-selection'].includes(command)) return
        switch (command) {
          case 'new-project':
            requestNewProject()
            break
          case 'open-project':
            void openProject()
            break
          case 'save-project':
            void saveProject()
            break
          case 'save-as-project':
            void saveAsProject()
            break
          case 'import-files':
            void analyzeImport('files')
            break
          case 'export-pdf':
            void checkExport()
            break
          case 'undo':
            useProjectStore.getState().undo()
            break
          case 'redo':
            useProjectStore.getState().redo()
            break
          case 'delete-selection':
            deleteSelection()
            break
        }
      }),
    [
      analyzeImport,
      checkExport,
      deleteSelection,
      openProject,
      requestNewProject,
      saveAsProject,
      saveProject,
    ],
  )

  useEffect(() => window.supportPack.app.onBeforeClose(() => setClosePromptOpen(true)), [])

  const refreshPlan = async (): Promise<void> => {
    store.setPlanLoading(true)
    const result = await window.supportPack.preview.refresh()
    if (result.ok) store.setPagePlan(result.value)
    else {
      store.setPlanLoading(false)
      showError('刷新预览失败', result.error.message)
    }
  }

  const exportPortable = async (): Promise<void> => {
    if (!(await saveProject())) return
    const current = useProjectStore.getState()
    if (!current.project) return
    const result = await window.supportPack.project.exportPortable({
      project: current.project,
      expectedRevision: current.revision,
    })
    if (!result.ok) {
      showError('导出便携项目包失败', result.error.message)
      return
    }
    if (result.value) {
      void message.success(`便携项目包已导出，共包含 ${result.value.assetCount} 个资产文件。`)
    }
  }

  const importPortable = async (): Promise<void> => {
    const execute = async (): Promise<void> => {
      const result = await window.supportPack.project.importPortable()
      if (!result.ok) showError('导入便携项目包失败', result.error.message)
      else if (result.value) applySession(result.value)
    }
    if (useProjectStore.getState().dirty) {
      modal.confirm({
        title: '当前项目有未保存修改',
        content: '导入便携项目包会切换到新项目，当前未保存修改将被丢弃。',
        okText: '丢弃并导入',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: execute,
      })
    } else await execute()
  }

  const clearCache = (): void => {
    modal.confirm({
      title: '清理全部预览缓存？',
      content: '此操作不会删除原始材料、项目配置或已经导出的 PDF。',
      okText: '清理缓存',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await window.supportPack.project.clearCache()
        if (!result.ok) showError('清理缓存失败', result.error.message)
        else {
          void message.success('预览缓存已清理。')
          await refreshPlan()
        }
      },
    })
  }

  const relocateSource = async (materialId: string, sourceId: string): Promise<void> => {
    const result = await window.supportPack.project.relocateMissing({
      materialId,
      sourceId,
    })
    if (!result.ok) {
      showError('重新定位文件失败', result.error.message)
      return
    }
    if (result.value) {
      applySession(result.value)
      void message.success('来源文件已重新定位并重新校验。')
    }
  }

  const reconvertOffice = async (
    materialId: string,
    sourceId: string | undefined,
    confirmPageReset = false,
  ): Promise<void> => {
    const result = await window.supportPack.import.reconvertOffice({
      materialId,
      ...(sourceId ? { sourceId } : {}),
      confirmPageReset,
    })
    if (!result.ok) {
      showError('重新转换 Office 文件失败', result.error.message)
      return
    }
    if (result.value.status === 'confirmation-required') {
      modal.confirm({
        title: '转换后的页数发生变化',
        content: `原快照为 ${result.value.previousPageCount} 页，新快照为 ${result.value.pageCount} 页。继续后将重置页码范围、页面顺序、旋转和删除配置。`,
        okText: '重新转换并重置页面编辑',
        okButtonProps: { danger: true },
        cancelText: '保留旧快照',
        onOk: async () => await reconvertOffice(materialId, sourceId, true),
      })
      return
    }
    const current = useProjectStore.getState()
    current.replaceProjectFromMain(result.value.project, current.revision + 1, true)
    void message.success(
      result.value.pageCountChanged
        ? `Office 快照已更新为 ${result.value.pageCount} 页，页面编辑配置已重置。`
        : `Office 快照已更新，共 ${result.value.pageCount} 页，原页面编辑配置已保留。`,
    )
  }

  return (
    <div className="app-shell">
      <TopToolbar
        hasProject={Boolean(store.project)}
        saving={store.saveStatus === 'saving'}
        onNew={requestNewProject}
        onOpen={() => void openProject()}
        onSave={() => void saveProject()}
        onSaveAs={() => void saveAsProject()}
        onImportFiles={() => void analyzeImport('files')}
        onImportFolder={() => void analyzeImport('folder')}
        onExport={() => void checkExport()}
        onProjectSettings={() =>
          store.project && store.setSelection({ kind: 'project', id: store.project.id })
        }
        onHelp={() => setHelpOpen(true)}
      />
      {store.project && store.projectDirectory ? (
        <>
          <div className="workspace-grid">
            <OutlinePanel
              project={store.project}
              plan={store.pagePlan}
              selection={store.selection}
              onSelect={store.setSelection}
              onMutate={store.mutateProject}
              onImport={() => void analyzeImport('files')}
            />
            <PreviewPanel
              project={store.project}
              plan={store.pagePlan}
              loading={store.planLoading}
              selection={store.selection}
              selectedPageIds={store.selectedPageIds}
              onSelectionChange={(ids, primary) => {
                store.setSelectedPageIds(ids)
                if (primary) store.setSelection({ kind: 'page', id: primary })
              }}
              onMutate={store.mutateProject}
              onRefresh={() => void refreshPlan()}
            />
            <InspectorPanel
              project={store.project}
              projectDirectory={store.projectDirectory}
              plan={store.pagePlan}
              selection={store.selection}
              onMutate={store.mutateProject}
              onSelect={store.setSelection}
              onExportPortable={() => void exportPortable()}
              onImportPortable={() => void importPortable()}
              onClearCache={clearCache}
              onRelocate={(materialId, sourceId) => void relocateSource(materialId, sourceId)}
              onReconvertOffice={(materialId, sourceId) =>
                void reconvertOffice(materialId, sourceId)
              }
            />
          </div>
          <StatusBar
            project={store.project}
            projectDirectory={store.projectDirectory}
            pagePlan={store.pagePlan}
            saveStatus={store.saveStatus}
            saveError={store.saveError}
          />
        </>
      ) : (
        <WelcomeView
          recentProjects={recentProjects}
          onNew={requestNewProject}
          onOpen={() => void openProject()}
          onOpenRecent={(recent) => void openRecent(recent)}
          onRemoveRecent={(recent) =>
            void window.supportPack.project
              .removeRecent(recent.projectDirectory)
              .then(() => refreshRecent())
          }
        />
      )}

      <Modal
        open={newProjectOpen}
        title="新建支撑材料项目"
        okText="选择位置并创建"
        cancelText="取消"
        confirmLoading={newProjectSaving}
        onCancel={() => setNewProjectOpen(false)}
        onOk={() => void createProject()}
        width={620}
      >
        <Form form={newProjectForm} layout="vertical" requiredMark="optional">
          <Form.Item
            name="title"
            label="项目名称"
            rules={[{ required: true, message: '请输入项目名称' }]}
          >
            <Input maxLength={300} />
          </Form.Item>
          <div className="form-grid-two">
            <Form.Item name="ownerName" label="姓名">
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="organization" label="单位">
              <Input maxLength={200} />
            </Form.Item>
          </div>
          <Form.Item name="purpose" label="材料用途">
            <Input maxLength={500} />
          </Form.Item>
          <div className="form-grid-two">
            <Form.Item name="compiledDate" label="编制日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="templateId" label="目录模板" rules={[{ required: true }]}>
              <Select
                options={PROJECT_TEMPLATES.map((template) => ({
                  value: template.id,
                  label: template.name,
                }))}
              />
            </Form.Item>
          </div>
          <Typography.Paragraph type="secondary">
            默认采用复制存储模式。应用将在所选位置创建 project.json、assets、cache、temp 和 output
            目录。
          </Typography.Paragraph>
        </Form>
      </Modal>

      <Modal
        open={Boolean(importProgress && !importAnalysis && importProgress.percentage < 100)}
        title="正在检查并转换导入文件"
        footer={
          importProgress?.cancellable ? (
            <Button
              danger
              onClick={() => {
                void window.supportPack.import.cancelAnalysis(importProgress.taskId)
              }}
            >
              取消
            </Button>
          ) : null
        }
        closable={false}
        mask={{ closable: false }}
      >
        <Typography.Paragraph>{importProgress?.stageLabel}</Typography.Paragraph>
        <Typography.Text type="secondary">{importProgress?.currentFile}</Typography.Text>
        <Progress percent={importProgress?.percentage ?? 0} />
        <Typography.Text type="secondary">
          已处理 {importProgress?.processedFiles ?? 0} / {importProgress?.totalFiles ?? 0} 个文件
        </Typography.Text>
      </Modal>

      {store.project && (
        <ImportDialog
          analysis={importAnalysis}
          project={store.project}
          targetOutlineNodeId={targetOutlineNodeId}
          committing={importCommitting}
          onCancel={() => {
            if (importAnalysis) void window.supportPack.import.cancelAnalysis(importAnalysis.token)
            setImportAnalysis(null)
            setImportProgress(null)
          }}
          onCommit={(input) => void commitImport(input)}
        />
      )}
      <ExportDialog
        checking={exportChecking}
        preflight={exportPreflight}
        progress={exportProgress}
        result={exportResult}
        starting={exportStarting}
        onClose={() => {
          if (!exportProgress) {
            setExportPreflight(null)
            setExportResult(null)
          }
        }}
        onStart={(taskId) => void startExport(taskId)}
        onCancelTask={(taskId) => void window.supportPack.export.cancel(taskId)}
        onOpenResult={(path) => void window.supportPack.system.openPath(path)}
        onRevealResult={(path) => void window.supportPack.system.revealPath(path)}
      />

      <Modal
        open={helpOpen}
        title="帮助与隐私说明"
        footer={
          <Button type="primary" onClick={() => setHelpOpen(false)}>
            知道了
          </Button>
        }
        onCancel={() => setHelpOpen(false)}
      >
        <Space orientation="vertical" size={12}>
          <Typography.Paragraph>
            个人支撑材料编排器完全在本机运行，不上传项目、PDF 或图片，也不接入
            AI、账户或远程服务器。
          </Typography.Paragraph>
          <Typography.Paragraph>
            建议使用“复制到项目”模式，以便移动和备份项目。导出前应用会检查来源文件、目录页码和页面计划；导出后会验证页数、A4
            尺寸、顺序与页码标记。
          </Typography.Paragraph>
          <Typography.Paragraph>
            支持 PDF、JPG、JPEG、PNG、WebP，以及通过应用内置 LibreOffice 离线转换的
            DOCX、PPTX、XLSX。暂不支持旧版 Office、宏文件、密码文件、OCR、正文编辑、签章和云同步。
          </Typography.Paragraph>
        </Space>
      </Modal>

      <Modal
        open={closePromptOpen}
        title="项目有未保存修改"
        closable={false}
        mask={{ closable: false }}
        footer={
          <Space>
            <Button
              onClick={() => {
                setClosePromptOpen(false)
                window.supportPack.app.respondToClose('cancel')
              }}
            >
              取消
            </Button>
            <Button
              danger
              onClick={() => {
                setClosePromptOpen(false)
                window.supportPack.app.respondToClose('discard')
              }}
            >
              不保存退出
            </Button>
            <Button
              type="primary"
              onClick={() =>
                void saveProject().then((saved) => {
                  if (saved) {
                    setClosePromptOpen(false)
                    window.supportPack.app.respondToClose('discard')
                  }
                })
              }
            >
              保存并退出
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph>
          请选择保存项目、放弃修改或取消退出。自动保存失败时，未保存状态不会被清除。
        </Typography.Paragraph>
      </Modal>
    </div>
  )
}
