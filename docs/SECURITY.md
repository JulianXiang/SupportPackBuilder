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

## 4. 自定义协议

- `spack-app://renderer/...` 只映射到生产 renderer 根目录，并检查路径不越界。
- `spack-cache://cache/<opaque-id>` 只接受 Main 注册的随机缓存 ID。
- URL 不包含本地完整路径。

## 5. 文件与压缩包

- 检查扩展名与真实 MIME。
- 项目内相对路径解析后必须仍在根目录。
- `.spack` 拒绝目录穿越、符号链接、未知条目、ZIP 炸弹和不兼容版本。
- 原始材料不修改；复制先写临时文件再改名。
- 输出和项目保存均采用临时文件、重读校验和原子替换。

## 6. 外部链接和系统打开

外部链接只接受显式用户操作产生的 `http:` 或 `https:`。打开文件/目录只接受当前项目根目录或本次成功导出后由 Main 注册的结果路径。

## 7. 日志

日志不记录 PDF 正文、图片内容或二进制。完整 home 路径和长路径片段会脱敏；详细堆栈仅写本地日志，UI 显示中文可操作信息。

## 8. Electron Fuses

打包后脚本关闭：

- RunAsNode
- NODE_OPTIONS
- `--inspect` 与 `--inspect-brk`
- 非 ASAR 应用加载
- file 协议额外权限

macOS 开启嵌入 ASAR 完整性校验；同时启用 Cookie 加密和 Wasm trap handlers。浏览器进程专用 V8 snapshot Fuse 保持关闭，因为当前 Electron 成品不包含该专用 snapshot；误开启会导致应用在启动阶段中止。

## 9. 已知边界

首版不解析不可信 Office 宏、不运行用户脚本、不执行 OCR。未签名开发包仍受操作系统警告；公开发布必须签名和公证。
