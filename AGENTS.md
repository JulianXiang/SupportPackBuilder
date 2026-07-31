# SupportPackBuilder 开发约束

## 工程结构

- `src/main`：Electron 主进程、IPC、服务和后台任务。
- `src/preload`：最小化、白名单化的 contextBridge API。
- `src/renderer`：React 用户界面，不得导入 Node.js 模块。
- `src/shared`：Zod schema、跨进程类型、常量和纯函数。
- `tests`：单元、集成与 Electron 端到端测试。

## 编码规范

- TypeScript 必须保持严格模式，禁止通过 `any` 或关闭类型检查规避问题。
- 用户界面、错误提示、日志消息和文档使用简体中文；代码标识符使用英文。
- A4 尺寸、页边距、缓存版本等常量只能在 shared 中定义。
- Zustand 只保存结构化配置和界面状态，不保存 PDF 或图片二进制。

## Electron 安全

- 所有 BrowserWindow 必须启用 contextIsolation、sandbox、webSecurity，并禁用 nodeIntegration。
- preload 不得暴露完整 Electron 或 Node.js 模块。
- IPC 使用固定通道、Zod 校验和调用来源校验。
- Renderer 不得直接读取本地文件或执行 PDF 合并。
- 禁止远程页面、`eval`、任意协议打开和未经转义的 HTML。

## PDF 约束

- PagePlan 是预览、目录和导出的唯一排序数据源。
- `layoutSheets` 是用户拼版意图的持久化配置，最终拼版页面、目录页码、缩略图和导出顺序必须由同一个 PagePlan 派生，禁止在 Renderer 另建一套排序逻辑。
- 拼版来源使用稳定 `sourcePageId`；同一来源只能有一个主槽，只有带 `detailOf` 的细节槽可以有意重复。
- 自动拼版不得为了模板容量静默截断、跳过或重复来源页。跨成果必须保留独立区段和归属，跨目录必须由用户明确确认。
- 低于清晰度下限且未确认的槽位必须作为 PagePlan 错误阻止导出；预览和最终 PDF 必须使用共享的裁切、旋转、适配和对齐参数。
- 自动去白边只能返回归一化裁切配置，必须保留安全余量，不得修改来源文件或 Office 快照。
- 原始材料永不修改；旋转、删除和重排只更新项目配置。
- 最终每个物理页面必须为 A4，并在导出后重新校验。
- 临时文件在成功、失败和取消后都应清理；清理失败必须记录警告。

## 测试要求

- 不得删除失败测试或弱化断言绕过错误。
- 新增纯函数必须有单元测试；项目 I/O 和 PDF 流程必须有集成测试。
- 界面核心流程必须使用 Playwright Electron 验证。

## 完成任务前

依次执行：

1. `npm run typecheck`
2. `npm run lint`
3. `npm run format:check`
4. `npm run test:unit`
5. `npm run test:integration`
6. `npm run build`

涉及桌面交互时还需运行 `npm run test:e2e`；涉及发布时运行当前平台打包命令。
