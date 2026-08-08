import { utilityProcess, type BrowserWindow, type UtilityProcess } from 'electron'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { PagePlan } from '../shared/schemas/page-plan-schema.js'
import type { Project } from '../shared/schemas/project-schema.js'
import type { ExportIssue, ExportPreflight, ExportResult } from '../shared/types/export.js'
import type {
  PdfExportWorkerMessage,
  PdfExportWorkerStart,
} from '../shared/types/worker-protocol.js'
import { ImportService } from './services/import-service.js'
import { PagePlanService, type PreparedPagePlan } from './services/page-plan-service.js'
import { assertProjectFileReferencesUnchanged } from './services/project-edit-guard.js'
import type { ProjectSession } from './services/project-service.js'
import { writeProjectAtomically } from './services/project-service.js'
import { RecentProjectService } from './services/recent-project-service.js'
import { AppPreferencesService } from './services/app-preferences-service.js'
import { createSampleProject } from './services/sample-project-service.js'
import { ThumbnailService } from './services/thumbnail-service.js'
import {
  synchronizeProjectFileStatuses,
  validateProjectFiles,
} from './services/validation-service.js'
import { appLog } from './services/log-service.js'
import type { PrintWindowService } from './windows/print-window.js'
import { ConversionManager } from './services/conversion-manager.js'
import { LibreOfficeConversionAdapter } from './services/libreoffice-conversion-adapter.js'

type PreparedExport = {
  project: Project
  prepared: PreparedPagePlan | null
  preflight: ExportPreflight
}

type RunningExport = {
  process: UtilityProcess
  temporaryDirectory: string
}

export class AppRuntime {
  readonly importService: ImportService
  readonly recentProjects = new RecentProjectService()
  readonly preferences = new AppPreferencesService()
  readonly #pagePlanService: PagePlanService
  readonly #workerDirectory: string
  readonly #fontPath: string
  readonly #boldFontPath: string
  readonly #mainWindow: BrowserWindow
  readonly #preparedExports = new Map<string, PreparedExport>()
  readonly #runningExports = new Map<string, RunningExport>()
  #preparedPreview: PreparedPagePlan | null = null
  readonly allowedSystemPaths = new Set<string>()
  session: ProjectSession | null = null
  thumbnailService: ThumbnailService | null = null
  dirty = false

  constructor(input: {
    mainWindow: BrowserWindow
    printWindow: PrintWindowService
    workerDirectory: string
    fontPath: string
    boldFontPath: string
    libreOfficeExecutable: string | null
  }) {
    this.#mainWindow = input.mainWindow
    this.#pagePlanService = new PagePlanService(input.printWindow)
    this.#workerDirectory = input.workerDirectory
    this.#fontPath = input.fontPath
    this.#boldFontPath = input.boldFontPath
    this.importService = new ImportService(
      new ConversionManager(new LibreOfficeConversionAdapter(input.libreOfficeExecutable)),
    )
  }

  requireSession(): ProjectSession {
    if (!this.session) throw new Error('请先新建或打开一个项目。')
    return this.session
  }

  async setSession(session: ProjectSession): Promise<void> {
    if (this.#preparedPreview) {
      await rm(this.#preparedPreview.temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      )
      this.#preparedPreview = null
    }
    session.project = await synchronizeProjectFileStatuses(
      session.projectDirectory,
      session.project,
    )
    this.session = session
    this.dirty = false
    this.thumbnailService = new ThumbnailService(
      session.projectDirectory,
      this.#workerDirectory,
      this.#fontPath,
      this.#boldFontPath,
    )
    await this.thumbnailService.initialize()
    this.allowedSystemPaths.clear()
    this.allowedSystemPaths.add(session.projectDirectory)
    this.recentProjects.add({
      projectDirectory: session.projectDirectory,
      title: session.project.title,
      lastOpenedAt: new Date().toISOString(),
    })
  }

  async createSample(parentDirectory: string): Promise<ProjectSession> {
    const session = await createSampleProject({
      parentDirectory,
      fontPath: this.#fontPath,
      boldFontPath: this.#boldFontPath,
      importService: this.importService,
    })
    await this.setSession(session)
    return session
  }

  acceptRendererProject(project: Project, revision: number): ProjectSession {
    const session = this.requireSession()
    if (revision < session.revision) {
      throw new Error('项目配置版本已过期，请刷新后重试。')
    }
    assertProjectFileReferencesUnchanged(session.project, project)
    const changed = JSON.stringify(session.project) !== JSON.stringify(project)
    session.project = project
    session.revision = revision
    this.dirty = this.dirty || changed
    return session
  }

  preview(project?: Project, revision?: number, tocPageCount = 1): PagePlan {
    const session =
      project && revision !== undefined
        ? this.acceptRendererProject(project, revision)
        : this.requireSession()
    return this.#pagePlanService.preview(session.project, session.revision, tocPageCount)
  }

  async preparePreview(project?: Project, revision?: number): Promise<PagePlan> {
    const session =
      project && revision !== undefined
        ? this.acceptRendererProject(project, revision)
        : this.requireSession()
    const expectedRevision = session.revision
    const prepared = await this.#pagePlanService.prepareForPreview(
      structuredClone(session.project),
      expectedRevision,
      session.projectDirectory,
    )
    if (this.requireSession().revision !== expectedRevision) {
      await rm(prepared.temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw new Error('项目配置版本已过期，请刷新后重试。')
    }
    const previous = this.#preparedPreview
    this.#preparedPreview = prepared
    if (previous) {
      await rm(previous.temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
    return prepared.plan
  }

  getPreparedPreview(planFingerprint: string): PreparedPagePlan {
    const prepared = this.#preparedPreview
    if (prepared?.plan.planFingerprint !== planFingerprint) {
      throw new Error('页面计划已变化，请刷新预览。')
    }
    return prepared
  }

  async save(project: Project, revision: number): Promise<ProjectSession> {
    const session = this.acceptRendererProject(project, revision)
    session.project = await writeProjectAtomically(session.projectDirectory, session.project)
    this.dirty = false
    this.recentProjects.add({
      projectDirectory: session.projectDirectory,
      title: session.project.title,
      lastOpenedAt: new Date().toISOString(),
    })
    return session
  }

  async preflight(project: Project, revision: number): Promise<ExportPreflight> {
    const session = await this.save(project, revision)
    const taskId = crypto.randomUUID()
    const fileChecks = await validateProjectFiles(session.projectDirectory, session.project)
    const quickPlan = this.#pagePlanService.preview(session.project, session.revision)
    const materialOutlineIds = new Map(
      session.project.outlineNodes.flatMap((root) =>
        root.children.flatMap((child) =>
          child.materials.map((material) => [material.id, child.id] as const),
        ),
      ),
    )
    const planSuggestion = (code: string): string => {
      if (code.startsWith('page-range-')) return '打开对应材料，检查并修正参与编排的页码范围。'
      if (code === 'layout-disabled') return '启用多图拼版，或删除不再需要的拼版配置。'
      if (code === 'layout-sheet-empty') return '删除没有任何内容的空拼版页。'
      if (code.includes('order') || code.includes('anchor')) {
        return '打开对应拼版页，按左侧目录顺序修复区段和锚点。'
      }
      if (code.startsWith('layout-clarity-')) return '打开对应拼版页检查清晰度并人工调整。'
      if (code.startsWith('layout-')) return '打开对应拼版页检查来源、区段和页面顺序。'
      return '打开对应项目、目录或材料属性进行检查。'
    }
    const toPlanIssue = (issue: (typeof quickPlan.errors)[number]): ExportIssue => ({
      code: issue.code,
      severity: issue.severity === 'error' ? 'error' : 'warning',
      source: 'pagePlan',
      message: issue.message,
      suggestion: planSuggestion(issue.code),
      outlineNodeId: issue.outlineNodeId,
      materialId: issue.materialId,
    })
    const fileIssues = fileChecks.flatMap((check): ExportIssue[] =>
      check.messages.map((message) => ({
        code: message.code,
        severity: message.severity === 'error' ? 'error' : 'warning',
        source: 'file',
        message: message.message,
        suggestion: message.suggestion ?? '打开对应材料的来源文件维护区进行检查。',
        outlineNodeId: materialOutlineIds.get(check.materialId) ?? null,
        materialId: check.materialId,
      })),
    )
    const dedupeIssues = (issues: ExportIssue[]): ExportIssue[] => {
      const byTarget = new Map<string, ExportIssue>()
      issues.forEach((issue) => {
        const key = `${issue.code}:${issue.outlineNodeId ?? ''}:${issue.materialId ?? ''}`
        const current = byTarget.get(key)
        if (!current || issue.source === 'file') byTarget.set(key, issue)
      })
      return [...byTarget.values()]
    }
    const issues = dedupeIssues([
      ...quickPlan.errors.map(toPlanIssue),
      ...quickPlan.warnings.map(toPlanIssue),
      ...fileIssues,
    ])
    const errors = issues.filter((issue) => issue.severity === 'error')
    const warnings = issues.filter((issue) => issue.severity === 'warning')
    let prepared: PreparedPagePlan | null = null
    let plan = quickPlan
    if (errors.length === 0) {
      prepared = await this.#pagePlanService.prepareForExport(
        session.project,
        session.revision,
        session.projectDirectory,
        taskId,
      )
      plan = prepared.plan
    }
    const materialCount = session.project.outlineNodes
      .filter((node) => node.enabled)
      .flatMap((node) => node.children.filter((node) => node.enabled))
      .flatMap((node) => node.materials.filter((material) => material.enabled)).length
    const estimatedSourceBytes = session.project.outlineNodes
      .flatMap((node) => node.children)
      .flatMap((node) => node.materials)
      .filter((material) => material.enabled)
      .reduce((total, material) => total + material.fileSize, 0)
    const preflight: ExportPreflight = {
      taskId,
      plan,
      errors,
      warnings,
      information: {
        materialCount,
        totalPages: plan.totalPageCount,
        tocPages: plan.tocPageCount,
        estimatedFileSize: Math.max(32_768, Math.round(estimatedSourceBytes * 0.85)),
        includesCover: plan.pages.some((page) => page.pageType === 'cover'),
        bodyStartNumber: session.project.pageNumberSettings.bodyStartNumber,
      },
    }
    this.#preparedExports.set(taskId, {
      project: structuredClone(session.project),
      prepared,
      preflight,
    })
    return preflight
  }

  getPreparedExport(taskId: string): PreparedExport {
    const prepared = this.#preparedExports.get(taskId)
    if (!prepared) throw new Error('导出检查结果已失效，请重新检查。')
    if (prepared.preflight.errors.length > 0 || !prepared.prepared) {
      throw new Error('导出检查存在错误，不能开始导出。')
    }
    return prepared
  }

  startExport(input: { taskId: string; outputPath: string; overwriteExisting: boolean }): void {
    const item = this.getPreparedExport(input.taskId)
    const session = this.requireSession()
    const prepared = item.prepared
    if (!prepared) throw new Error('导出页面尚未准备完成。')
    const project = structuredClone(item.project)
    project.exportSettings.overwriteExisting = input.overwriteExisting
    const reportPath = join(
      session.projectDirectory,
      'output',
      `${basename(input.outputPath, '.pdf')}-${input.taskId}-report.json`,
    )
    const workerPath = join(this.#workerDirectory, 'workers', 'pdf-export-worker.cjs')
    const child = utilityProcess.fork(workerPath, [], {
      serviceName: `SupportPack PDF 导出 ${input.taskId}`,
      stdio: 'pipe',
    })
    child.stdout?.on('data', (chunk: Buffer | string) => {
      appLog.info('PDF 导出后台输出', chunk.toString())
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      appLog.error('PDF 导出后台错误', chunk.toString())
    })
    const request: PdfExportWorkerStart = {
      type: 'start',
      taskId: input.taskId,
      projectDirectory: session.projectDirectory,
      outputPath: input.outputPath,
      reportPath,
      project,
      plan: prepared.plan,
      generatedPages: prepared.generatedPages,
      ...(existsSync(this.#fontPath) ? { fontPath: this.#fontPath } : {}),
      ...(existsSync(this.#boldFontPath) ? { boldFontPath: this.#boldFontPath } : {}),
    }
    this.#runningExports.set(input.taskId, {
      process: child,
      temporaryDirectory: prepared.temporaryDirectory,
    })
    child.on('message', (message: PdfExportWorkerMessage) => {
      if (message.type === 'ready') {
        child.postMessage(request)
        return
      }
      if (message.type === 'progress') {
        this.#mainWindow.webContents.send('export:progress', message.progress)
        return
      }
      if (message.result.outputPath) this.allowedSystemPaths.add(message.result.outputPath)
      if (message.result.reportPath) this.allowedSystemPaths.add(message.result.reportPath)
      this.#mainWindow.webContents.send('export:finished', message.result)
      void this.#finishExport(input.taskId, message.result)
    })
    child.once('exit', (code) => {
      if (this.#runningExports.has(input.taskId)) {
        const result: ExportResult = {
          status: 'failed',
          message: `导出后台进程异常退出（退出码 ${String(code)}）。`,
        }
        this.#mainWindow.webContents.send('export:finished', result)
        void this.#finishExport(input.taskId, result)
      }
    })
  }

  async cancelExport(taskId: string): Promise<void> {
    const running = this.#runningExports.get(taskId)
    if (running) {
      running.process.postMessage({ type: 'cancel', taskId })
      const process = running.process
      setTimeout(() => {
        if (this.#runningExports.has(taskId)) process.kill()
      }, 2_500).unref()
      return
    }
    const prepared = this.#preparedExports.get(taskId)
    this.#preparedExports.delete(taskId)
    if (prepared?.prepared) {
      await rm(prepared.prepared.temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      )
    }
  }

  async cleanup(): Promise<void> {
    if (this.#preparedPreview) {
      await rm(this.#preparedPreview.temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      )
      this.#preparedPreview = null
    }
    for (const [taskId, task] of this.#runningExports) {
      task.process.kill()
      await rm(task.temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      this.#runningExports.delete(taskId)
    }
    for (const item of this.#preparedExports.values()) {
      if (item.prepared) {
        await rm(item.prepared.temporaryDirectory, { recursive: true, force: true }).catch(
          () => undefined,
        )
      }
    }
  }

  async #finishExport(taskId: string, result: ExportResult): Promise<void> {
    const running = this.#runningExports.get(taskId)
    this.#runningExports.delete(taskId)
    this.#preparedExports.delete(taskId)
    if (running) {
      await rm(running.temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      if (result.status !== 'failed') running.process.kill()
    }
  }
}
