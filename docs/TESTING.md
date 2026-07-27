# 测试说明

## 1. 测试分层

### 单元测试

Vitest 覆盖页码范围、A4 几何、旋转矩阵、PagePlan、逻辑页码、项目 schema 和 Renderer 文件引用保护。

### 集成测试

使用临时目录和本地生成夹具验证：

- 项目创建、原子保存、备份和重新打开
- copy/reference 文件处理与复制时间戳保留
- 便携包导出、导入、资产改写和条目白名单
- PDF 指定页与图片合并
- 所有输出页 A4
- 页面标记、顺序、页码和目录映射
- 输出文件重读
- 取消导出后不产生目标文件

### Electron E2E

Playwright 启动生产构建。只有系统对话框在 `SPACK_E2E=1` 且应用未打包时由测试适配器提供确定路径；文件校验、复制、PDF.js 缩略图、隐藏打印、utilityProcess、pdf-lib 合并和输出校验全部使用生产服务。

核心流程覆盖新建、两级目录、一级/二级/材料拖拽排序、4 个 PDF（含横向、非标准和 Rotate 属性）、三张 JPG 图片集合、PNG、WebP、页码范围、旋转、删除、保存、重开和真实 A4 PDF 导出。测试会比较 UI PagePlan、输出页标记、目录映射、校验报告和原始文件哈希。

### 打包后回归

发布验证另用 `npm run smoke:prepare` 生成固定项目，再通过 macOS 原生文件对话框由 arm64 `.app` 打开并导出。`npm run smoke:verify` 随后独立重读成品、校验报告、资产哈希和临时目录。该流程实际验证打包后的自定义协议、ASAR、PDF.js、Sharp、原生 Canvas、隐藏打印窗口和 utilityProcess；不会为测试放宽生产 Fuse。

## 2. 测试夹具

`npm run fixtures` 在 `fixtures/generated` 本地生成：

- 10 页 A4 纵向 PDF
- 3 页 A4 横向 PDF
- 非标准尺寸 PDF
- 带 Rotate 属性的 PDF
- 长标题 PDF
- 三张 JPG
- PNG
- WebP

夹具不包含第三方作品或来源不明材料。

## 3. 当前验证环境

- macOS 26.5.2，Apple Silicon
- Apple M5 Max，64 GB
- Node.js 26.0.0
- npm 11.12.1

截至 2026-07-27 已观察到：

- `npm run typecheck`：通过
- `npm run lint`：通过
- `npm run format:check`：通过
- `npm run test:unit`：48 项通过
- `npm run test:integration`：8 项通过
- Playwright Electron 核心 E2E：1 项通过，单项测试本轮 15.0 秒，含构建的命令总耗时 17.2 秒
- `npm run build`：通过
- `npm run dist:mac`：通过，生成 Apple Silicon `.app` 与 DMG
- macOS arm64 打包后回归：打开 2 项真实材料，导出前检查为 0 错误、0 警告；生成并重读 9 页 A4 PDF（13,071,093 字节，SHA-256 `34a831263b3998273f2e16739c114f16253b00675f4ca74500f5cb53ec3ed9e6`），前置页面为封面、空白背页和目录，6 个 `— N —` 打印页码和 9 个唯一页面标记均正确，首张材料页具有三级同页标题，输出报告 10 项检查全部通过，导出临时目录为空，项目资产哈希保持不变
- macOS arm64 DMG：196,952,081 字节；`hdiutil verify` 通过，SHA-256 为 `c28ea32a475f846f65f3a4ac2eeb8bfdd20edf9260c9bbbe5130450fcb61f9a6`；应用主程序、Sharp 与 Canvas 原生模块均为 arm64，Electron Fuses 与深度代码签名结构检查通过
- 打包字体与源文件哈希一致：Regular `24c0c97248e028945bb61b6444af1680c98758c44c05231b1bc086f797ca7d9a`，Bold `b77cac28cd91942a58f93102286246a49e60091dd0ceab1170b88bbab6d965dc`
- `npm audit --omit=dev`：0 个生产依赖漏洞
- macOS Intel x64：未交付；在 arm64 主机交叉生成时发现原生依赖仍为 arm64，因此配置已限制为当前实际验证的 arm64，x64 需在对应 CI 安装依赖后测试
- Windows x64：已在 macOS arm64 主机尝试 `electron-builder --win --x64`。NSIS 和 PE 文件能够生成，但解包检查发现 Sharp、Canvas 原生模块仍为 Darwin arm64，无法视为 Windows 可运行产物；无效产物已移入废纸篓，不纳入交付。Windows 必须在 Windows 实机或 CI 重新安装依赖、打包并执行启动与导出回归

本文数字以最近一次实际命令输出为准；若后续重新执行导致耗时或内存数字变化，应同步更新本文和最终汇报。

## 4. 性能范围

生成型 300 页烟测会创建一个真实 300 页 PDF，经相同 A4 导出服务转换、写入、重读并逐页检查。2026-07-27 最终门禁的一轮观测结果（同机重复运行会有小幅波动）：

- 输入 74,020 字节，输出 6,816,054 字节
- 导出服务阶段耗时 677 毫秒
- 测试进程观测到的峰值 RSS 342,196,224 字节
- 300 个输出页面均可重读且为 A4

输出体积增加主要来自完整嵌入中文 TTF，以避免 CJK 子集漏字。该夹具页面内容仍较轻，结果只证明 300 页页面数量路径可工作，不代表复杂扫描件具有相同耗时。500 MB 输入尚未执行，不得从上述结果推断已经通过。

## 5. 运行

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run smoke:prepare
# 使用打包后的 .app 打开固定项目并导出
npm run smoke:verify
```

失败时保留 `test-results`、Playwright trace、截图和本地脱敏日志，不允许删除测试或弱化断言绕过问题。
