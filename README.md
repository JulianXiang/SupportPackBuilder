# 个人支撑材料编排器

**SupportPackBuilder** 是一款完全本地运行的跨平台桌面软件，用于把论文、专利、项目、证书、获奖材料和图片整理成带正式封面、自动目录、分类标题页及统一页码的 A4 PDF。

> 文件始终保存在本机。应用不接入 AI、云服务、用户账户、遥测或远程后端。

[主要功能](#主要功能) · [快速开始](#快速开始) · [基本使用](#基本使用) · [测试与构建](#测试与构建) · [隐私说明](#隐私与离线说明) · [已知限制](#已知限制)

项目不是静态原型：本地文件选择、项目持久化、PDF/图片/Office 检查、Office 离线转换、缩略图缓存、页面计划、后台 PDF 导出、输出重读校验和便携项目包均由真实服务完成。Renderer 不读取任意本地文件，也不执行文件转换或 PDF 合并。

## 适用场景

- 高校教师职称申报、年度考核和教学成果材料
- 科研人员项目申报、论文、专利和软件著作权汇编
- 专业技术人员资格评审、获奖与能力证明材料
- 行政人员需要统一封面、目录、页码和 A4 版式的材料归档

## 当前状态

当前版本为 `0.2.0`，处于功能验证阶段。macOS Apple Silicon 已完成开发构建和自动化回归；Windows x64 已提供 NSIS 构建配置，但仍需在 Windows 实机或 CI 中完成安装包运行验证。当前版本未做 Developer ID 正式签名和 Apple 公证，公开下载时可能触发 Gatekeeper 提示。

## 主要功能

- 新建、打开、保存、另存为、复制和自动保存项目
- 两级目录、材料排序、启用/禁用和纯标题编辑；拖拽后自动重排 `一、`、`（一）`、`1.`
- 空目录显示“未输出”，不占序号、不进入 PDF 目录
- 导入 PDF、JPG、JPEG、PNG、WebP；多张图片可合并为一项材料
- 导入 DOCX、PPTX、XLSX，由随应用分发的 LibreOffice 在本机转换为 PDF 快照
- Office 原件与 PDF 快照同时保存，转换后复用 PDF 页码范围、旋转、删除、预览和导出流水线
- copy 与 reference 两种资产模式、重复文件检查、丢失和损坏文件检查
- PDF 页码范围、材料内页面重排、旋转、删除和恢复
- 自主可控多图拼版：支持同一 PDF 多页、同一成果的多个来源、跨成果和经确认的跨目录页面共同排入一张 A4
- 内置上下两页、四宫格、证书 2×2/2×3、正反面、主体＋附件、联系表、纵向长条和原图＋细节模板
- 拼版槽位可继续拆分、合并、交换、移动、旋转、裁切、对齐和调节比例；自动去白边始终保留安全余量且不修改原件
- 清晰度门禁会阻止未经确认的过小内容；跨成果页面使用独立全宽区段和标题，兼顾节纸与专家查阅
- 虚拟化最终页面预览与按需 WebP 缩略图；常驻垂直滚动条支持拖动、轨道翻页和键盘定位
- 共享 PagePlan 驱动预览、目录页码、自动编号和最终导出
- HTML/CSS 封面、目录和标题页；目录页数最多迭代 5 次
- 封面字段在新建时从项目属性复制一次，之后独立编辑；空白字段不会输出空行
- 参考既有 DOCX 的正式版式：封面背面空白页、同页分级标题和 `— 1 —` 页码
- 所有输出物理页统一为 A4，来源内容等比缩放且默认不裁切
- 统一逻辑页码、中文页码字体、PDF 元数据与页面顺序标记
- Electron utilityProcess 后台导出、结构化进度、取消与临时文件清理
- 输出后重读 PDF，校验页数、A4、顺序、页码、目录映射和材料覆盖
- `.spack` 便携项目包导入/导出，不包含缓存、临时文件和输出结果
- 最近项目、缓存清理、来源文件重新定位和中文错误提示

## 支持的文件格式

| 类型       | 支持格式                         | 处理方式                                      |
| ---------- | -------------------------------- | --------------------------------------------- |
| PDF        | `.pdf`                           | 读取所选页面并统一转换到 A4                   |
| 图片       | `.jpg`、`.jpeg`、`.png`、`.webp` | 自动纠正方向，等比缩放后置于 A4 白色页面      |
| Word       | `.docx`                          | 使用内置 LibreOffice 离线转换为 PDF 快照      |
| PowerPoint | `.pptx`                          | 将可见幻灯片离线转换为 PDF 快照               |
| Excel      | `.xlsx`                          | 按打印区域、纸张方向和分页离线转换为 PDF 快照 |

## 技术栈

Electron 43、TypeScript 5.9、React 19、Vite 7、Ant Design 6、Zustand、dnd-kit、Zod、pdf-lib、pdfjs-dist、Sharp、electron-store、electron-log、electron-builder、Vitest 和 Playwright。

## 环境要求

- 建议 Node.js 24 LTS；当前工程允许 Node.js 24–26
- npm 11 或更高版本
- macOS 或 Windows 桌面环境
- 首次执行 `npm install` 需要联网下载依赖
- 从源码打包前需准备对应平台的 LibreOffice 26.2.5 运行时；准备脚本会固定校验版本、架构和 SHA-256
- 已打包应用运行、Office 转换、预览和导出均不需要网络

## 快速开始

```bash
npm install
npm run dev
```

`npm run dev` 启动 Electron、Vite 热更新和 React 开发界面。

## 测试与构建

| 命令                              | 用途                                                 |
| --------------------------------- | ---------------------------------------------------- |
| `npm run dev`                     | 启动开发模式                                         |
| `npm run typecheck`               | 对 Main、Preload、Renderer 执行严格 TypeScript 检查  |
| `npm run lint`                    | 执行 ESLint                                          |
| `npm run format`                  | 使用 Prettier 写入格式化结果                         |
| `npm run format:check`            | 检查格式但不修改文件                                 |
| `npm run test`                    | 运行全部 Vitest 测试                                 |
| `npm run test:unit`               | 运行纯函数和数据模型单元测试                         |
| `npm run test:integration`        | 运行项目 I/O、便携包和真实 PDF 导出集成测试          |
| `npm run test:e2e`                | 构建后运行 Playwright Electron 端到端测试            |
| `npm run fixtures`                | 生成无版权风险的 PDF、图片和 DOCX/PPTX/XLSX 测试夹具 |
| `npm run prepare:libreoffice`     | 准备当前平台固定版本 LibreOffice 运行时              |
| `npm run prepare:libreoffice:mac` | 准备 macOS arm64 LibreOffice 运行时                  |
| `npm run prepare:libreoffice:win` | 在 Windows x64 准备 LibreOffice 运行时               |
| `npm run smoke:prepare`           | 生成打包后导入/导出回归项目（仅用于本地发布验证）    |
| `npm run smoke:verify`            | 独立重读并校验打包应用已导出的固定回归 PDF 与报告    |
| `npm run smoke:libreoffice`       | 使用 `.app` 内 LibreOffice 转换三种真实 Office 夹具  |
| `npm run icons`                   | 重新生成应用 PNG、ICNS 和 ICO 图标                   |
| `npm run build`                   | 类型检查并生成生产构建                               |
| `npm run dist`                    | 构建并按当前平台生成安装包                           |
| `npm run dist:mac`                | 生成 macOS 应用与 DMG                                |
| `npm run dist:win`                | 生成 Windows NSIS 安装包                             |

## 基本使用

1. 点击“新建项目”，填写项目名称、姓名和单位，选择目录模板和保存位置。
2. 在左侧建立一级、二级目录；材料只能导入到二级目录。
3. 点击“导入文件”或拖入真实文件，在检查窗口处理重复项并选择图片组合方式；Office 文件会在此阶段离线转换并显示进度。
4. 在右侧设置页码范围、材料标题页、备注和文件状态。项目属性与“封面内容”分别编辑，修改项目名称不会覆盖已经定稿的封面。
5. 在中间选择内容页，进行旋转、删除、恢复和材料内重排。
6. 需要节省纸张时，选择至少两个连续内容页并点击“多图拼版”。可先套用模板，再调整纸张方向、区段高度、槽位拆分、裁切、对齐和旋转；跨成果或跨目录拼版必须显式确认。
7. 查看工作台中的清晰度和节纸估算。过小内容默认阻止应用；确实可读时可逐槽确认风险。拼版只修改项目配置，原始 PDF、图片和 Office 文件不变。
8. 点击“导出 PDF”，先查看错误、警告和预计页数，再选择输出位置。
9. 导出完成后可打开文件、所在目录或 JSON 校验报告。

### 打包成品回归

`npm run smoke:prepare` 会重新生成固定项目并清空它原有的输出。随后在打包后的 `.app` 中打开终端输出的 `project.json`，导出为该项目 `output/打包成品导出.pdf`，最后运行：

```bash
npm run smoke:verify
```

验证器会独立重读 PDF 与 JSON 报告，检查封面、空白背页、内容驱动目录、A4 尺寸、页面唯一标记、跨成果多图拼版及其来源/布局摘要、三级同页标题、`— N —` 页码、项目资产哈希及临时目录清理。Office 成品回归还需在 `.app` 中导入 DOCX、PPTX、XLSX，并确认 `Contents/Resources/libreoffice` 中的固定运行时能够启动。生产 Fuses 会关闭调试参数，因此成品回归不通过打开远程调试接口来伪装自动化。

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
│   └── conversions/   # Office PDF 快照
├── cache/
│   ├── thumbnails/
│   └── previews/
├── temp/
└── output/
```

## 隐私与离线说明

应用不接入 AI、云服务、遥测、登录或远程后端。材料文件、Office 转换快照、缓存、日志和导出结果均保存在本机。LibreOffice 随安装包分发，运行时不会下载组件。日志只记录处理阶段和脱敏后的错误，不记录文档正文或图片内容。

仓库还会忽略 `.env`、私钥、签名证书、本地项目目录、`.spack` 包、导出结果和 `template/` 私有参考材料。请把真实用户材料放在仓库之外，或放入已忽略的 `local-materials/`、`local-projects/` 目录；不要通过 `git add -f` 绕过这些保护。

## 打包与签名

electron-builder 配置了 macOS Apple Silicon DMG 和 Windows x64 NSIS。打包时会先校验 LibreOffice 运行时，再关闭 RunAsNode、NODE_OPTIONS 和 Node 调试参数，并限制应用只从 ASAR 加载。当前 macOS arm64 LibreOffice 目录实测解压体积约 884 MB，因此应用目录和安装包会明显增大，不能继续按早期约 400 MB 估算。Intel macOS 应在 x64 构建机或 CI 重新安装对应原生依赖后另行构建。Windows 安装包也必须在 Windows 或对应 CI 中准备 Windows 版 LibreOffice、重新安装并校验 Sharp、Canvas 等平台原生依赖，不能把 macOS 上生成的交叉构建文件直接视为可发布产物。

首版未配置发布证书：

- macOS 对外分发前应使用 Developer ID Application 签名，并提交 Apple 公证。
- Windows 对外分发前应使用可信代码签名证书签署 EXE/安装包。
- 未签名应用会触发 Gatekeeper 或 SmartScreen 提示，这是当前开发包的已知行为。

## 常见问题

### 为什么加密 PDF 不能导入？

首版不接收密码，也不绕过 PDF 保护。请先使用有权限的工具移除密码保护，再重新导入。

### 为什么目录页码会在导出前变化？

目录使用最终 PagePlan 迭代排版。长标题导致目录增页时，正文起始页随之重算，直到目录页数稳定。

### 为什么空目录没有序号？

编号和 PDF 目录只包含实际产生输出页面的节点。空目录或所有后代都被禁用的目录在左侧显示“未输出”，拖拽、启停、删除或导入材料后会立即按当前有效顺序重新编号。

### Office 转换为什么与 Microsoft Office 的排版可能不同？

DOCX、PPTX、XLSX 由内置 LibreOffice 26.2.5 转换。缺失字体、复杂 SmartArt、修订、动画、媒体或外部数据可能造成差异。PPTX 只输出可见幻灯片，不输出动画、视频和演讲者备注；XLSX 优先使用既有打印区域和分页，没有打印设置时仅在临时副本中设置“一页宽、纵向不限页”。导入后应在真实缩略图中核对结果。

### 为什么重新定位要求文件哈希一致？

“重新定位”用于找回同一文件，以免旧的页码范围、旋转和删除设置错误套用到不同文件。更换内容应重新导入。

### 多图拼版可以跨成果吗？

可以。同一材料内部可直接拼版；跨成果时，每项成果默认使用独立的全宽区段并显示归属标题，避免专家误把页面看成同一成果。跨二级目录还需要再次确认。系统按 PagePlan 的正式顺序校验页面连续性，不会为了凑满模板而静默跳页或截断页面。

### 自动去白边会不会修改原文件？

不会。应用只分析当前来源页的缩略渲染结果，把归一化裁切框写入 `project.json`。默认保留约 3 mm 安全边缘，原件和 Office 转换快照都不被改写；用户仍可在工作台中继续微调或恢复完整画面。

### 清理缓存会删除材料吗？

不会。清理范围仅为 `cache`，原始资产、`project.json` 和输出 PDF 不受影响。

## 已知限制

- 不支持 DOC/PPT/XLS 旧格式、DOCM/PPTM/XLSM 宏文件、密码 Office 文件、OCR、PDF/Office 正文编辑、批注、签章和云同步。
- Office 转换保真度受本机字体和 LibreOffice 兼容性影响；转换快照是导出依据，原件发生变化后需手动重新转换。
- PPTX 动画、视频、演讲者备注不输出；XLSX 隐藏工作表不输出。
- 扫描件在没有 OCR 的情况下无法可靠判断原 PDF 是否已经印有页码。
- 多图拼版首版采用矩形槽位、递归横向/纵向拆分和整页 A4 合成，不提供任意角度自由旋转画布、内容遮叠、异形蒙版或跨页连续画布。
- 自动裁边基于页面渲染后的近白色边缘分析，不使用 OCR 或语义识别；印章、浅色底纹或扫描噪声较多的页面应由用户在真实缩略图中复核。
- 为保证专家可读性，自动建议最多按项目设置放置有限槽位；内容低于清晰度阈值时必须调整版式或显式确认风险，不能仅以节纸页数作为成功标准。
- 为避免 CJK 字体子集造成漏字，中文同页标题和页码使用完整 TTF 嵌入；含中文标题的输出会有数 MB 的固定字体体积。
- Windows 配置需要 Windows 实机或 CI 才能完成最终 NSIS 运行验证；macOS 上的交叉构建尝试因原生模块仍为 Darwin arm64 而判定无效，未作为交付物保留。
- Intel macOS 构建未在 x64 环境验证，当前发布物仅为 Apple Silicon。
- 已完成 300 页生成型真实导出烟测；500 MB 输入尚未验证。实际范围见 [docs/TESTING.md](docs/TESTING.md)。

更多细节见 [参考 DOCX 版式](docs/TEMPLATE_STYLE.md)、[架构](docs/ARCHITECTURE.md)、[PDF 流水线](docs/PDF_PIPELINE.md)、[项目格式](docs/PROJECT_FORMAT.md)、[安全](docs/SECURITY.md)和[测试](docs/TESTING.md)。
