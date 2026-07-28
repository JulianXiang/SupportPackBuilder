# 测试说明

## 1. 测试分层

### 单元测试

Vitest 覆盖页码范围、A4 几何、旋转矩阵、PagePlan、逻辑页码、三级中文编号、十以上序号、空目录排除、拖拽重排、项目 schema v1→v2 迁移、封面字段独立性、页面预览滚动条几何和 LibreOffice 运行时解析。

### 集成测试

使用临时目录和本地生成夹具验证：

- 项目创建、原子保存、备份、迁移和重新打开
- copy/reference 文件处理与复制时间戳保留
- 便携包导出、导入、资产改写和条目白名单
- OOXML 真实格式检查和损坏文件拒绝
- DOCX、PPTX、XLSX 通过 LibreOffice 26.2.5 真实转换
- Office 原件与 PDF 快照同时保存、重新转换和便携包包含关系
- PDF 指定页、图片和 Office 快照合并
- 所有输出页 A4
- 页面标记、材料标记、顺序、页码和目录映射
- 输出文件重读
- 取消、超时及导出失败后的临时文件清理

### Electron E2E

Playwright 启动生产构建，并为每次运行使用独立的临时 Electron 用户数据目录，避免已安装应用的单实例锁和最近项目记录干扰。只有系统对话框在 `SPACK_E2E=1` 且应用未打包时由测试适配器提供确定路径；文件校验、复制、OOXML 分析、LibreOffice 转换、PDF.js 缩略图、隐藏打印、utilityProcess、pdf-lib 合并和输出校验全部使用生产服务。

核心流程覆盖：

- 新建项目并验证项目属性与封面内容相互独立
- 创建、拖拽一级和二级目录，验证有效节点自动编号
- 验证空目录显示“未输出”、不占编号且不进入目录
- 导入 4 个 PDF、JPG 图片集合、PNG、WebP、DOCX、PPTX 和 XLSX
- 设置 PDF 页码范围、旋转和删除内容页
- 验证页面预览常驻滚动条、轨道翻页、拖动、键盘定位、缩放重算和虚拟渲染
- 保存并重新打开 schema v2 项目
- 比较 UI PagePlan、输出页面 ID、材料 ID、目录映射和校验报告
- 验证最终每页 A4、原始文件未修改且 Renderer 无控制台错误

### 打包运行时回归

`npm run smoke:libreoffice` 直接调用最终 `.app/Contents/Resources/libreoffice` 中的固定运行时，转换三种 Office 夹具并重新读取 PDF。它验证打包路径、架构、可执行权限、依赖和真实转换结果，不使用源码目录中的 LibreOffice。

完整打包 GUI 回归另用 `npm run smoke:prepare` 生成固定项目，通过 macOS 原生文件对话框由 arm64 `.app` 打开并导出，再运行 `npm run smoke:verify`。验证器会独立重读成品、校验报告、原件和 Office 快照哈希、页面/材料标记及临时目录。该流程不通过调试端口或放宽 Electron Fuses 实现。

## 2. 测试夹具

`npm run fixtures` 在 `fixtures/generated` 本地生成：

- 10 页 A4 纵向 PDF
- 3 页 A4 横向 PDF
- 非标准尺寸 PDF
- 带 Rotate 属性的 PDF
- 长标题 PDF
- 三张 JPG、PNG 和 WebP
- 含中文、表格、图片和多页内容的 DOCX
- 含可见与隐藏幻灯片的 PPTX
- 含打印区域、分页和多个工作表的 XLSX
- 未设置打印规则的 XLSX
- 损坏或伪装的 OOXML

夹具由代码生成，不包含第三方作品或来源不明材料。

## 3. 当前验证环境与结果

- macOS 26.5.2（Build 25F84），Apple Silicon arm64
- Apple M5 Max，64 GB
- Node.js 26.0.0
- npm 11.12.1
- Electron 43.2.0
- LibreOffice 26.2.5.2，构建标识 `cd7284b4cbbfeb507e630c1aac019f4157393acb`

2026-07-27 至 2026-07-28 最终门禁的实际结果：

- `npm run typecheck`：通过
- `npm run lint`：通过
- `npm run format:check`：通过
- `npm run test:unit`：9 个文件、62 项测试全部通过
- `npm run test:integration`：5 个文件、14 项测试全部通过
- `npm test`：13 个文件、71 项测试全部通过
- `npm run test:e2e`：1 项核心流程通过，耗时约 1.9 分钟；常驻滚动条的显示、轨道翻页、鼠标拖动、键盘定位、缩放重算和虚拟渲染均通过
- `npm run build`：通过
- `npm run dist:mac`：通过，生成 Apple Silicon `.app` 与 DMG
- `npm audit --omit=dev`：0 个生产依赖漏洞
- `npm run smoke:libreoffice`：通过；打包内 LibreOffice 将 DOCX、PPTX、XLSX 分别转换为 2、2、3 页可重读 PDF，PPTX 隐藏幻灯片未输出
- 最终 Apple Silicon `.app` 原生 GUI 回归：通过 macOS 原生文件对话框打开固定项目，经正式导出界面生成 16 页 PDF；应用内 11 项输出校验全部通过
- `npm run smoke:verify`：通过，状态为 `PACKAGED_SMOKE_OK`；成品 13,302,515 字节，包含 3 项 Office 材料、13 个打印页码，前三页依次为封面、空白背页、目录，SHA-256 为 `89548a4c2a7eac99a3d6f4c1f4135fe0ff5bc2d0ce5d45ba249ebb875c007291`
- `template/1.向军毅支撑材料（2025年11月12日）v3-业绩类.docx`：通过 OOXML 导入识别，并由最终 `.app` 内 LibreOffice 转换为 278 页、98,547,361 字节的可重读 PDF；278 页均为约 595.30×841.89 pt，模板原件仍与 Git 基线一致
- 最终应用主程序、Sharp 和 Canvas 原生模块均经 `file` 确认为 arm64
- 打包内 LibreOffice 目录未发现断裂符号链接，`soffice --version` 返回预期固定版本
- Electron Fuses 检查通过：RunAsNode、NODE_OPTIONS、Node 调试参数和额外 file 权限关闭，ASAR 完整性与 OnlyLoadAppFromAsar 开启
- `codesign --verify --deep --strict` 通过开发阶段的临时签名结构检查；这不等于 Developer ID 正式签名
- DMG 共 493,463,823 字节，SHA-256 为 `36dd518654e4c698746f79da52447db53ccbc254cb0fabd042622ddba205f499`，`hdiutil verify` 通过
- `.app` 目录约 1.4 GB，其中 LibreOffice 约 884 MB

最终 `.app` 的完整原生对话框打开/导出回归已实际完成。导出文件位于 `fixtures/generated/package-smoke/打包成品导入导出回归/output/打包成品导出.pdf`；该回归未启用测试对话框、远程调试端口或放宽 Electron Fuses。

Windows x64 尚未在 Windows 实机或 CI 中重新安装平台原生依赖、打包并启动，因此未验证。macOS Intel x64 同样未验证。

本文数字以最近一次实际命令输出为准；若重新构建安装包，应重新执行打包 GUI 回归并同步更新哈希、体积和结果。

## 4. 性能范围

生成型 300 页烟测会创建一个真实 300 页 PDF，经相同 A4 导出服务转换、写入、重读并逐页检查。2026-07-27 最终门禁的一轮结果：

- 输入 74,020 字节，输出 6,818,233 字节
- 导出服务阶段耗时 651 毫秒
- 测试进程观测到的峰值 RSS 326,025,216 字节
- 300 个输出页面均可重读且为 A4

该夹具页面内容较轻，只证明 300 页页面数量路径可工作。500 MB 输入尚未执行，不得从上述结果推断已通过大体积扫描件验证。

## 5. 运行

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run smoke:libreoffice
npm run smoke:prepare
# 使用打包后的 .app 打开固定项目并导出
npm run smoke:verify
```

失败时保留 `test-results`、Playwright trace、截图和本地脱敏日志，不允许删除测试或弱化断言绕过问题。
