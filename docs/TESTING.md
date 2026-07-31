# 测试说明

## 1. 测试分层

### 单元测试

Vitest 覆盖页码范围、A4 几何、旋转矩阵、PagePlan、逻辑页码、三级中文编号、十以上序号、空目录排除、拖拽重排、项目 schema v1→v2→v3 迁移、封面字段独立性、页面预览滚动条几何和 LibreOffice 运行时解析。

多图拼版单元测试覆盖：

- 递归横向/纵向拆分、权重归一化、槽位尺寸和 A4 边界。
- 模板容量、同一成果建议、跨成果全宽区段、跨目录确认和超过 6/12 页时不丢页。
- 同一来源主槽去重与显式“原图＋细节”。
- 裁切、旋转逆映射、适配方式和清晰度警告/阻止门禁。
- 禁用拼版、缺失来源、删除材料/目录后的布局清理和 canonical 顺序修复。

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
- 同一材料多来源、跨材料区段和混合 PDF/图片拼版真实导出
- 拼版来源页 ID 数组、布局摘要、材料/目录数组及原图＋细节输出
- 项目保存重开和 `.spack` 往返后 `layoutSheets` 无损保留
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
- 选择图片集合中的两个来源页，打开拼版工作台，执行安全自动裁边并保存拼版
- 保存重开后验证拼版仍为一个 `compositeContent` 页面，输出来源页标记与 UI PagePlan 一致
- 验证页面预览常驻滚动条、轨道翻页、拖动、键盘定位、缩放重算和虚拟渲染
- 保存并重新打开 schema v3 项目
- 比较 UI PagePlan、输出页面 ID、材料 ID、目录映射和校验报告
- 验证最终每页 A4、原始文件未修改且 Renderer 无控制台错误

### 打包运行时回归

`npm run smoke:libreoffice` 直接调用最终 `.app/Contents/Resources/libreoffice` 中的固定运行时，转换三种 Office 夹具并重新读取 PDF。它验证打包路径、架构、可执行权限、依赖和真实转换结果，不使用源码目录中的 LibreOffice。

完整打包 GUI 回归另用 `npm run smoke:prepare` 生成固定 schema v3 项目，其中包含 PDF、图片、三种 Office 材料和一张跨成果多图拼版。通过 macOS 原生文件对话框由 arm64 `.app` 打开并导出，再运行 `npm run smoke:verify`。验证器会独立重读成品、校验报告、原件和 Office 快照哈希、页面/材料/来源标记、拼版布局摘要及临时目录。该流程不通过调试端口或放宽 Electron Fuses 实现。

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

2026-07-31 自主可控多图拼版版本最终门禁的实际结果：

- `npm run typecheck`：通过
- `npm run lint`：通过
- `npm run format:check`：通过
- `npm run test:unit`：11 个文件、78 项测试全部通过
- `npm run test:integration`：5 个文件、19 项测试全部通过
- `npm run test`：16 个文件、97 项测试全部通过
- `npm run test:e2e`：1 项核心流程通过，耗时约 2.4 分钟；真实导入、Office 转换、拼版工作台、安全自动裁边、保存重开、常驻滚动条和 A4 PDF 导出均通过
- `npm run build`：通过
- `npm run dist:mac`：通过，生成 Apple Silicon `.app` 与 DMG
- `npm audit --omit=dev`：0 个生产依赖漏洞
- `npm run smoke:prepare`：通过；生成 schema v3 固定项目，包含 3 项 Office 材料和 1 张跨成果拼版；独立构建 PagePlan 得到 1 张 `compositeContent` 且无错误
- `npm run smoke:libreoffice`：通过；打包内 LibreOffice 将 DOCX、PPTX、XLSX 分别转换为 2、2、3 页可重读 PDF，PPTX 隐藏幻灯片未输出
- Office 成品回归前后分别执行 `codesign --verify --deep --strict` 均通过。测试中发现并修复了 LibreOffice Python 回写 `__pycache__` 破坏资源封印的问题；现在所有调用均设置 `PYTHONDONTWRITEBYTECODE=1`
- 最终 `.app` 启动烟测：通过；主进程、GPU、网络服务和带 `--enable-sandbox` 的 Renderer 正常启动，独立临时用户目录产生预期缓存和最近项目存储，退出后已清理
- 最终应用主程序、Sharp 和 Canvas 原生模块均经 `file` 确认为 arm64
- 打包内 LibreOffice 目录未发现断裂符号链接，`soffice --version` 返回预期固定版本
- Electron Fuses 检查通过：RunAsNode、NODE_OPTIONS、Node 调试参数和额外 file 权限关闭，ASAR 完整性与 OnlyLoadAppFromAsar 开启
- `codesign --verify --deep --strict` 通过开发阶段的临时签名结构检查；这不等于 Developer ID 正式签名
- `SupportPackBuilder-0.2.0-arm64.dmg` 共 493,517,185 字节，SHA-256 为 `91a2bb8dd03180931c3d9ed00ed439b1f3d6267d82892b94797f7a9dab63cf14`，`hdiutil verify` 通过
- `.app` 目录约 1.4 GB，其中 LibreOffice 约 884 MB

本轮没有执行新 `.app` 的原生对话框点击与 `npm run smoke:verify`：当前会话未提供 computer-use 技能所要求的 `node_repl` 控制接口，而生产 Fuses 又有意关闭 Playwright 所需的调试入口。没有为测试放宽 Fuses，也没有沿用 2026-07-28 旧安装包的 GUI 结果冒充当前拼版版本。源码生产构建的 Playwright E2E、打包成品启动、打包内 Office 转换及签名结构分别完成了真实验证。

Windows x64 尚未在 Windows 实机或 CI 中重新安装平台原生依赖、打包并启动，因此未验证。macOS Intel x64 同样未验证。

本文数字以最近一次实际命令输出为准；若重新构建安装包，应重新执行打包 GUI 回归并同步更新哈希、体积和结果。

## 4. 性能范围

生成型 300 页烟测会创建一个真实 300 页 PDF，经相同 A4 导出服务转换、写入、重读并逐页检查。2026-07-31 最终门禁的一轮结果：

- 输入 74,020 字节，输出 6,821,185 字节
- 导出服务阶段耗时 674 毫秒
- 测试进程观测到的峰值 RSS 342,327,296 字节
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
