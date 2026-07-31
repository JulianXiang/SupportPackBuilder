# 安全设计

## 1. BrowserWindow

主窗口和打印窗口使用：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
```

应用使用 `spack-app://` 加载打包内页面，禁止远程页面、任意导航、新窗口和 webview。所有权限请求默认拒绝。

## 2. CSP

生产页面配置严格 Content-Security-Policy：

- 默认只允许 self
- 禁止 object、frame、插件和远程连接
- 不使用 eval
- 图片只允许 self、data 和 opaque cache 协议
- 样式只用于本地 Ant Design 和打印页面

## 3. Preload 与 IPC

Preload 只暴露任务级方法，不暴露 Electron 或 Node.js 模块。IPC 使用固定通道、Zod 输入、主 frame URL 和 webContents ID 校验。

Renderer 不能提供任意读取路径。文件和目录通过系统 dialog 选择；真实拖放路径只由 sandboxed preload 使用 `webUtils.getPathForFile` 获取后立即交给固定导入通道。

拼版工作台请求来源缩略图或自动裁边时只能提交当前 PagePlan 中的 `sourcePageId`、`planFingerprint` 和有界参数。Main 在项目会话中反查来源路径，并拒绝旧 fingerprint、未知页面、越界尺寸或非法安全边距。返回值只有 opaque cache URL 或归一化裁切矩形，不包含路径和二进制。

## 4. 自定义协议

- `spack-app://renderer/...` 只映射到生产 renderer 根目录，并检查路径不越界。
- `spack-cache://cache/<opaque-id>` 只接受 Main 注册的随机缓存 ID。
- URL 不包含本地完整路径。

## 5. 文件与压缩包

- 检查扩展名与真实 MIME。
- Office 只接受 DOCX、PPTX、XLSX；拒绝旧版二进制格式、宏格式和密码文件。
- OOXML 检查 ZIP 入口数量、解压总量、压缩比、路径穿越、绝对路径、加密标记、Content Types、主文档入口和外部关系。
- 项目内相对路径解析后必须仍在根目录。
- `.spack` 拒绝目录穿越、符号链接、未知条目、ZIP 炸弹和不兼容版本。
- 原始材料不修改；复制先写临时文件再改名。
- 输出和项目保存均采用临时文件、重读校验和原子替换。
- 自动裁边只分析缩放后的临时渲染，保留安全边缘并在完成、失败或取消后清理；它不能改写来源 PDF、图片或 Office 快照。
- 拼版输出标记只包含随机实体 ID、来源页 ID 和布局摘要，不写文件名、完整路径或正文。

## 6. LibreOffice 边界

- 应用只解析 `Contents/Resources/libreoffice`（macOS）或 `resources/libreoffice`（Windows）中的固定可执行文件；Renderer 无法获知或覆盖该路径。
- 构建准备脚本固定 LibreOffice 26.2.5 的下载 URL 与 SHA-256，并校验版本和目标架构；运行时不下载组件。
- `spawn` 接收固定程序路径和参数数组，`shell: false`，用户文件名不会拼入命令字符串。
- 转换并发为 1，每个任务使用独立临时用户配置目录；宏安全级别设为最高并关闭首次启动向导，转换命令不请求外部数据更新。
- 单文件超时 180 秒，用户可取消；失败、超时和取消都会终止进程并清理用户配置、临时副本和输出。
- 转换 PDF 必须重新读取并通过非空、未加密和正页数检查，之后才允许原子写入项目。
- 外部关系会产生警告，离线配置不会主动更新外部数据。Office 兼容性并非安全沙箱替代；公开发布仍应持续跟踪 LibreOffice 安全更新并重新固定版本与哈希。

## 7. 外部链接和系统打开

外部链接只接受显式用户操作产生的 `http:` 或 `https:`。打开文件/目录只接受当前项目根目录或本次成功导出后由 Main 注册的结果路径。

## 8. 日志

日志不记录 PDF 正文、图片内容或二进制。完整 home 路径和长路径片段会脱敏；详细堆栈仅写本地日志，UI 显示中文可操作信息。

## 9. Electron Fuses

打包后脚本关闭：

- RunAsNode
- NODE_OPTIONS
- `--inspect` 与 `--inspect-brk`
- 非 ASAR 应用加载
- file 协议额外权限

macOS 开启嵌入 ASAR 完整性校验；同时启用 Cookie 加密和 Wasm trap handlers。浏览器进程专用 V8 snapshot Fuse 保持关闭，因为当前 Electron 成品不包含该专用 snapshot；误开启会导致应用在启动阶段中止。

## 10. 已知边界

当前版本不接收或运行 Office 宏，不支持密码文件、不运行用户脚本、不执行 OCR。自动去白边是像素边缘分析，不是文档语义识别，用户必须复核浅色印章、底纹和扫描噪声页面。LibreOffice 增加了较大的第三方运行时和安全更新责任；版本变更必须重新执行 OOXML、转换、打包成品和许可证回归。未签名开发包仍受操作系统警告；公开发布必须签名和公证。
