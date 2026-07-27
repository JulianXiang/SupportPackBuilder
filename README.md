# 个人支撑材料编排器

SupportPack Builder 是一款完全本地运行的 Electron 桌面软件，用于把论文、专利、项目、证书、获奖材料和图片整理成带正式封面、自动目录、分类标题页、统一页码的 A4 PDF。

项目不是静态原型：本地文件选择、项目持久化、PDF/图片检查、缩略图缓存、页面计划、后台 PDF 导出、输出重读校验和便携项目包均由真实服务完成。Renderer 不读取任意本地文件，也不执行 PDF 合并。

## 主要功能

- 新建、打开、保存、另存为、复制和自动保存项目
- 两级目录、材料排序、启用/禁用和标题编辑
- 导入 PDF、JPG、JPEG、PNG、WebP；多张图片可合并为一项材料
- copy 与 reference 两种资产模式、重复文件检查、丢失和损坏文件检查
- PDF 页码范围、材料内页面重排、旋转、删除和恢复
- 虚拟化最终页面预览与按需 WebP 缩略图
- 共享 PagePlan 驱动预览、目录页码和最终导出
- HTML/CSS 封面、目录和标题页；目录页数最多迭代 5 次
- 参考既有 DOCX 的正式版式：封面背面空白页、同页分级标题和 `— 1 —` 页码
- 所有输出物理页统一为 A4，来源内容等比缩放且默认不裁切
- 统一逻辑页码、中文页码字体、PDF 元数据与页面顺序标记
- Electron utilityProcess 后台导出、结构化进度、取消与临时文件清理
- 输出后重读 PDF，校验页数、A4、顺序、页码、目录映射和材料覆盖
- `.spack` 便携项目包导入/导出，不包含缓存、临时文件和输出结果
- 最近项目、缓存清理、来源文件重新定位和中文错误提示

## 技术栈

Electron 43、TypeScript 5.9、React 19、Vite 7、Ant Design 6、Zustand、dnd-kit、Zod、pdf-lib、pdfjs-dist、Sharp、electron-store、electron-log、electron-builder、Vitest 和 Playwright。

## 环境要求

- 建议 Node.js 24 LTS；当前工程允许 Node.js 24–26
- npm 11 或更高版本
- macOS 或 Windows 桌面环境
- 首次执行 `npm install` 需要联网下载依赖；应用运行时不需要网络

## 安装与开发

```bash
npm install
npm run dev
```

`npm run dev` 启动 Electron、Vite 热更新和 React 开发界面。

## 命令

| 命令                       | 用途                                                    |
| -------------------------- | ------------------------------------------------------- |
| `npm run dev`              | 启动开发模式                                            |
| `npm run typecheck`        | 对 Main、Preload、Renderer 执行严格 TypeScript 检查     |
| `npm run lint`             | 执行 ESLint                                             |
| `npm run format`           | 使用 Prettier 写入格式化结果                            |
| `npm run format:check`     | 检查格式但不修改文件                                    |
| `npm run test`             | 运行全部 Vitest 测试                                    |
| `npm run test:unit`        | 运行纯函数和数据模型单元测试                            |
| `npm run test:integration` | 运行项目 I/O、便携包和真实 PDF 导出集成测试             |
| `npm run test:e2e`         | 构建后运行 Playwright Electron 端到端测试               |
| `npm run fixtures`         | 在 `fixtures/generated` 生成无版权风险的测试 PDF 与图片 |
| `npm run smoke:prepare`    | 生成打包后导入/导出回归项目（仅用于本地发布验证）       |
| `npm run smoke:verify`     | 独立重读并校验打包应用已导出的固定回归 PDF 与报告       |
| `npm run icons`            | 重新生成应用 PNG、ICNS 和 ICO 图标                      |
| `npm run build`            | 类型检查并生成生产构建                                  |
| `npm run dist`             | 构建并按当前平台生成安装包                              |
| `npm run dist:mac`         | 生成 macOS 应用与 DMG                                   |
| `npm run dist:win`         | 生成 Windows NSIS 安装包                                |

## 基本使用

1. 点击“新建项目”，填写项目名称、姓名和单位，选择目录模板和保存位置。
2. 在左侧建立一级、二级目录；材料只能导入到二级目录。
3. 点击“导入文件”或拖入真实文件，在检查窗口处理重复项并选择图片组合方式。
4. 在右侧设置 PDF 页码范围、材料标题页、备注和文件状态。项目属性中可控制封面背面空白页、同页标题模式、目录标题和页码格式。
5. 在中间选择内容页，进行旋转、删除、恢复和材料内重排。
6. 点击“导出 PDF”，先查看错误、警告和预计页数，再选择输出位置。
7. 导出完成后可打开文件、所在目录或 JSON 校验报告。

### 打包成品回归

`npm run smoke:prepare` 会重新生成固定项目并清空它原有的输出。随后在打包后的 `.app` 中打开终端输出的 `project.json`，导出为该项目 `output/打包成品导出.pdf`，最后运行：

```bash
npm run smoke:verify
```

验证器会独立重读 PDF 与 JSON 报告，检查封面、空白背页、目录顺序、A4 尺寸、页面唯一标记、三级同页标题、`— N —` 页码、项目资产哈希及临时目录清理。生产 Fuses 会关闭调试参数，因此成品回归不通过打开远程调试接口来伪装自动化。

## 项目目录

```text
src/main       Electron 主进程、IPC、项目服务、打印窗口与后台任务
src/preload    白名单 contextBridge API
src/renderer   React 桌面界面和打印页面
src/shared     Zod 模型、常量、类型、模板和纯函数
tests          单元、集成与 Electron E2E
fixtures       本地生成的测试夹具
scripts        夹具、图标与打包后 Fuse 脚本
docs           架构、PDF、项目格式、安全和测试文档
resources      字体、许可证和图标
```

一个项目保存在独立目录中：

```text
项目名称/
├── project.json
├── assets/
├── cache/
│   ├── thumbnails/
│   └── previews/
├── temp/
└── output/
```

## 隐私与离线说明

应用不接入 AI、云服务、遥测、登录或远程后端。材料文件、缓存、日志和导出结果均保存在本机。日志只记录处理阶段和脱敏后的错误，不记录 PDF 正文或图片内容。

## 打包与签名

electron-builder 配置了 macOS Apple Silicon DMG 和 Windows x64 NSIS。打包时会关闭 RunAsNode、NODE_OPTIONS 和 Node 调试参数，并限制应用只从 ASAR 加载。Intel macOS 应在 x64 构建机或 CI 重新安装对应原生依赖后另行构建。Windows 安装包也必须在 Windows 或对应 CI 中重新安装并校验 Sharp、Canvas 等平台原生依赖，不能把 macOS 上生成的交叉构建文件直接视为可发布产物。

首版未配置发布证书：

- macOS 对外分发前应使用 Developer ID Application 签名，并提交 Apple 公证。
- Windows 对外分发前应使用可信代码签名证书签署 EXE/安装包。
- 未签名应用会触发 Gatekeeper 或 SmartScreen 提示，这是当前开发包的已知行为。

## 常见问题

### 为什么加密 PDF 不能导入？

首版不接收密码，也不绕过 PDF 保护。请先使用有权限的工具移除密码保护，再重新导入。

### 为什么目录页码会在导出前变化？

目录使用最终 PagePlan 迭代排版。长标题导致目录增页时，正文起始页随之重算，直到目录页数稳定。

### 为什么重新定位要求文件哈希一致？

“重新定位”用于找回同一文件，以免旧的页码范围、旋转和删除设置错误套用到不同文件。更换内容应重新导入。

### 清理缓存会删除材料吗？

不会。清理范围仅为 `cache`，原始资产、`project.json` 和输出 PDF 不受影响。

## 已知限制

- 不支持 DOCX、PPTX、XLSX、OCR、PDF 正文编辑、批注、签章和云同步。
- 扫描件在没有 OCR 的情况下无法可靠判断原 PDF 是否已经印有页码。
- 首版不提供一页多图拼版，每张图片占一个 A4 页面。
- 为避免 CJK 字体子集造成漏字，中文同页标题和页码使用完整 TTF 嵌入；含中文标题的输出会有数 MB 的固定字体体积。
- Windows 配置需要 Windows 实机或 CI 才能完成最终 NSIS 运行验证；macOS 上的交叉构建尝试因原生模块仍为 Darwin arm64 而判定无效，未作为交付物保留。
- Intel macOS 构建未在 x64 环境验证，当前发布物仅为 Apple Silicon。
- 已完成 300 页生成型真实导出烟测；500 MB 输入尚未验证。实际范围见 [docs/TESTING.md](docs/TESTING.md)。

更多细节见 [参考 DOCX 版式](docs/TEMPLATE_STYLE.md)、[架构](docs/ARCHITECTURE.md)、[PDF 流水线](docs/PDF_PIPELINE.md)、[项目格式](docs/PROJECT_FORMAT.md)、[安全](docs/SECURITY.md)和[测试](docs/TESTING.md)。
