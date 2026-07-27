import {
  app,
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
} from 'electron'

type TestDialogKey =
  | 'projectParent'
  | 'projectOpen'
  | 'saveAsParent'
  | 'duplicateParent'
  | 'importFiles'
  | 'importFolder'
  | 'portableImport'
  | 'portableImportParent'
  | 'relocateFile'

type TestDialogConfig = Partial<
  Record<Exclude<TestDialogKey, 'importFiles'>, string | string[]>
> & {
  importFiles?: string[] | string[][]
  exportPath?: string
  portableExportPath?: string
  confirmOverwrite?: boolean
}

let lastTestConfigRaw = ''
let importFilesSequenceIndex = 0

const testConfig = (): TestDialogConfig | null => {
  if (app.isPackaged || process.env.SPACK_E2E !== '1') return null
  const raw = process.env.SPACK_E2E_DIALOGS
  if (!raw) return null
  if (raw !== lastTestConfigRaw) {
    lastTestConfigRaw = raw
    importFilesSequenceIndex = 0
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    throw new Error('端到端测试对话框配置不是有效 JSON。')
  }
}

export const showOpenDialog = async (
  window: BrowserWindow,
  key: TestDialogKey,
  options: OpenDialogOptions,
): Promise<OpenDialogReturnValue> => {
  const configured = testConfig()?.[key]
  if (configured !== undefined) {
    if (
      key === 'importFiles' &&
      Array.isArray(configured) &&
      configured.every((entry) => Array.isArray(entry))
    ) {
      const filePaths = configured[importFilesSequenceIndex] ?? []
      importFilesSequenceIndex += 1
      return { canceled: filePaths.length === 0, filePaths }
    }
    const filePaths = Array.isArray(configured) ? configured : [configured]
    return { canceled: filePaths.length === 0, filePaths: filePaths as string[] }
  }
  return await dialog.showOpenDialog(window, options)
}

export const showSaveDialog = async (
  window: BrowserWindow,
  options: SaveDialogOptions,
  key: 'exportPath' | 'portableExportPath' = 'exportPath',
): Promise<SaveDialogReturnValue> => {
  const configured = testConfig()?.[key]
  if (configured !== undefined) return { canceled: configured.length === 0, filePath: configured }
  return await dialog.showSaveDialog(window, options)
}

export const confirmOverwrite = async (window: BrowserWindow): Promise<boolean> => {
  const configured = testConfig()?.confirmOverwrite
  if (configured !== undefined) return configured
  const confirmation = await dialog.showMessageBox(window, {
    type: 'warning',
    title: '确认覆盖文件',
    message: '目标 PDF 已存在，是否覆盖？',
    detail: '覆盖会替换现有文件；导出失败时应用会尝试恢复旧文件。',
    buttons: ['取消', '覆盖'],
    defaultId: 0,
    cancelId: 0,
  })
  return confirmation.response === 1
}
