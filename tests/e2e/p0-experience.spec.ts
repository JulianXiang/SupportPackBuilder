import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ProjectSchema } from '../../src/shared/schemas/project-schema.js'

let temporaryDirectory = ''
let sampleParent = ''
let electronApp: ElectronApplication | null = null
let page: Page | null = null

test.beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'spack-p0-e2e-'))
  sampleParent = join(temporaryDirectory, 'samples')
  await mkdir(sampleParent, { recursive: true })
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  electronApp = await electron.launch({
    args: [`--user-data-dir=${join(temporaryDirectory, 'electron-user-data')}`, resolve('.')],
    env: {
      ...environment,
      SPACK_E2E: '1',
      SPACK_E2E_DIALOGS: JSON.stringify({ sampleProjectParent: sampleParent }),
    },
  })
  page = await electronApp.firstWindow()
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1400, 820)
  })
})

test.afterAll(async () => {
  await electronApp?.close()
  if (process.env.SPACK_KEEP_E2E_ARTIFACTS !== '1') {
    await rm(temporaryDirectory, { recursive: true, force: true })
  } else {
    process.stdout.write(`\nP0_E2E_ARTIFACT_DIRECTORY=${temporaryDirectory}\n`)
  }
})

const currentPage = (): Page => {
  if (!page) throw new Error('Electron 页面尚未启动。')
  return page
}

test('基础模式、真实示例、偏好持久化和统一警告修复形成闭环', async () => {
  const window = currentPage()
  await expect(window.getByRole('radio', { name: '基础' })).toBeChecked()
  await expect(window.getByText('四步完成支撑材料编排')).toBeVisible()
  await window.getByRole('button', { name: '体验示例项目' }).click()

  const inspector = window.locator('.inspector-panel')
  await expect(inspector.getByLabel('项目名称')).toHaveValue('示例：个人成果支撑材料', {
    timeout: 45_000,
  })
  await expect(window.getByText('四步完成支撑材料编排')).toBeVisible()
  await expect(window.getByRole('button', { name: '继续导入材料' })).toBeVisible()
  await window.getByRole('button', { name: '关闭新手引导' }).click()
  await expect(window.locator('.page-card').filter({ hasText: '多图拼版页' })).toHaveCount(1, {
    timeout: 30_000,
  })
  await expect(window.getByText('项目路径', { exact: true })).toBeHidden()
  await expect(window.getByText('图片清晰度（推荐 / 最低 DPI）', { exact: true })).toBeHidden()

  await window.locator('.top-toolbar').getByText('高级', { exact: true }).click()
  await expect(window.getByRole('radio', { name: '高级' })).toBeChecked()
  await expect(window.getByText('项目路径', { exact: true })).toBeVisible()
  await expect(window.getByText('图片清晰度（推荐 / 最低 DPI）', { exact: true })).toBeVisible()
  await inspector.getByLabel('项目名称').fill('示例：已编辑的个人成果支撑材料')
  await inspector.getByLabel('项目名称').blur()
  await window.locator('.top-toolbar').getByRole('button', { name: '保存' }).click()
  await expect(window.locator('.status-bar')).toContainText('已保存')

  await window.reload()
  await expect(window.getByRole('radio', { name: '高级' })).toBeChecked({ timeout: 15_000 })
  await expect(window.getByText('示例：已编辑的个人成果支撑材料', { exact: true })).toBeVisible()
  await window.getByText('示例：已编辑的个人成果支撑材料', { exact: true }).click()
  await expect(inspector.getByLabel('项目名称')).toHaveValue('示例：已编辑的个人成果支撑材料')
  await window.locator('.top-toolbar').getByText('基础', { exact: true }).click()
  await expect(window.getByText('项目路径', { exact: true })).toBeHidden()

  const outline = window.locator('.outline-panel')
  await outline.getByTitle('年度工作总结示例', { exact: true }).click()
  await window.getByLabel('参与编排的页面').click()
  await window.getByText('指定页码范围', { exact: true }).click()
  const pageRange = window.getByLabel('PDF 页码范围')
  await pageRange.fill(' 1 - 3, 2 ')
  await pageRange.blur()

  const warningButton = window.locator('.status-bar .status-issue-button').filter({
    hasText: '警告',
  })
  await expect
    .poll(async () => Number((await warningButton.textContent())?.match(/\d+/)?.[0] ?? '0'))
    .toBeGreaterThan(0)
  await warningButton.click()
  let issueCard = window.locator('.issue-card').filter({ hasText: 'page-range-extra-whitespace' })
  await expect(issueCard).toBeVisible()
  await issueCard.getByRole('button', { name: '定位' }).click()
  await expect(pageRange).toBeVisible()
  await expect(pageRange).toHaveValue(' 1 - 3, 2 ')

  await warningButton.click()
  issueCard = window.locator('.issue-card').filter({ hasText: 'page-range-extra-whitespace' })
  await issueCard.getByRole('button', { name: '规范页码范围' }).click()
  const confirm = window.getByRole('dialog', { name: '确认规范页码范围？' })
  await confirm.getByRole('button', { name: '确认修复' }).click()
  await expect(issueCard).toBeHidden({ timeout: 15_000 })
  await expect(window.getByText('页码范围已规范化。')).toBeVisible()
  await window.locator('.ant-drawer .ant-drawer-close').click()

  if (!electronApp) throw new Error('Electron 应用尚未启动。')
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((candidate) => candidate.isVisible())
      ?.webContents.send('app:command', 'undo')
  })
  await expect
    .poll(async () => Number((await warningButton.textContent())?.match(/\d+/)?.[0] ?? '0'))
    .toBeGreaterThan(0)
  await warningButton.click()
  issueCard = window.locator('.issue-card').filter({ hasText: 'page-range-extra-whitespace' })
  await expect(issueCard).toBeVisible()
  await issueCard.getByRole('button', { name: '规范页码范围' }).click()
  await window
    .getByRole('dialog', { name: '确认规范页码范围？' })
    .getByRole('button', { name: '确认修复' })
    .click()
  await expect(issueCard).toBeHidden({ timeout: 15_000 })
  await window.locator('.ant-drawer .ant-drawer-close').click()

  await window.locator('.top-toolbar').getByRole('button', { name: '保存' }).click()
  await expect(window.locator('.status-bar')).toContainText('已保存')
  await window.locator('.top-toolbar').getByRole('button', { name: '导出 PDF' }).click()
  const exportDialog = window.getByRole('dialog', { name: '导出前检查' })
  await expect(exportDialog.getByText('没有阻止导出的错误')).toBeVisible({ timeout: 45_000 })
  await exportDialog.getByRole('button', { name: /取\s*消/ }).click()

  const projectDirectories = await import('node:fs/promises').then(
    async ({ readdir }) => await readdir(sampleParent),
  )
  expect(projectDirectories).toHaveLength(1)
  const project = ProjectSchema.parse(
    JSON.parse(
      await readFile(join(sampleParent, projectDirectories[0] ?? '', 'project.json'), 'utf8'),
    ),
  )
  expect(project.title).toBe('示例：已编辑的个人成果支撑材料')
  expect(project.layoutSheets).toHaveLength(1)
})
