# 项目格式

## 1. 目录结构

```text
项目名称/
├── project.json
├── project.json.bak
├── assets/
│   └── conversions/
├── cache/
│   ├── thumbnails/
│   └── previews/
├── temp/
└── output/
```

`project.json` 不保存 PDF、图片或 Office 二进制。Office 原件按资产模式存储，转换 PDF 固定保存在 `assets/conversions/`。cache 和 temp 可删除，assets 与 project.json 是项目核心数据。

## 2. schemaVersion

当前版本为 `3`。读取流程先解析原始 JSON，再根据 schemaVersion 逐级迁移，最后通过完整 Zod schema。未知高版本会被拒绝。

v1、缺少版本或版本 0 的旧项目会先迁移到 v2：

- 一级、二级和材料标题中可识别的 `一、`、`（一）`、`1.` 前缀被清理，保留纯标题。
- 缺少的新字段使用严格 schema 默认值补全。
- 项目在内存中先校验为 v2，下一次保存仍走原子写入；旧 v1 文件会成为 `project.json.bak`，不会被直接覆盖。

v2 不在 `title` 中保存序号。编号是 PagePlan 根据当前有效输出顺序派生的数据。

v2 项目随后迁移到 v3：

- 每个 `MaterialSource` 补充来源类型、独立页码范围和页数信息。
- 材料根据来源项推导 `pdf`、`image`、`imageCollection`、`office` 或 `mixed`。
- 旧 `startOnNewPage` 转换为明确的 `startPolicy`。
- 补充项目级 `collageSettings` 和空的 `layoutSheets`，保持旧项目原有的独占页面输出。

迁移在内存中完成，下一次保存仍走原子写入并把旧文件保留为 `project.json.bak`。

## 3. 路径规则

- `projectDirectory` 在 JSON 中固定为 `"."`。
- copy 模式的 `sourcePath`、`storedPath` 使用 `assets/` 相对路径。
- reference 模式允许 `storedPath: null` 和外部绝对 `sourcePath`。
- Office 转换快照的 `conversion.pdfStoredPath` 始终为 `assets/conversions/` 下的项目相对路径，即使原件使用 reference。
- Main 解析相对路径后验证它仍在项目根目录内。
- 完整本地路径不放入缩略图 URL、PDF 标记或日志正文。

## 4. 主要字段

Project 保存基础信息、资产模式、封面、目录、页码、导出设置和 outlineNodes。

参考版式相关字段：

- `coverSettings.insertBlankBackPage`：是否在封面后插入不计页码的双面打印空白页。
- `exportSettings.contentHeadingMode`：`firstPage` 表示把分级标题放在材料首张内容页上，`none` 表示关闭。
- `pageNumberSettings.format: "dash"`：打印为 `— 1 —`。

OutlineNode 保存稳定 ID、父 ID、层级、标题、顺序、启用状态、标题页设置、children 和 materials。

Material 保存兼容的单值文件摘要和完整 `sourceItems`。图片集合和混合材料可包含多个 MaterialSource；每个来源项保存自己的来源类型、页数和页码范围，页面编辑以 sourcePageId 引用来源页。

Office 材料使用 `sourceType: "office"`，`MaterialSource.conversion` 包含：

- `adapterId: "libreoffice"`
- `engineVersion`
- `officeFormat: "docx" | "pptx" | "xlsx"`
- `pdfStoredPath`
- 原件 `sourceFileHash`
- 快照哈希、大小、页数与转换时间
- `snapshotStatus: "ready" | "stale" | "error"`
- 兼容性警告

重复判断仍以 Office 原件的哈希、大小和原始文件名为准。页面顺序和编辑引用快照页，但 PDF 页面标记继续保存原材料 ID，不暴露路径。

封面字段完整保存在 `coverSettings`。创建项目时它们从项目属性复制一次；之后 `title`、`ownerName`、`organization`、`purpose`、`compiledDate` 与封面字段互不覆盖。

### 拼版配置

Project 的 `collageSettings` 保存：

- 是否启用拼版。
- 默认 A4 方向、页边距、成果区段间距和槽位间距。
- 自动建议每张纸的最大槽位数。
- 清晰度警告阈值、阻止阈值和自动裁边安全余量。

`layoutSheets` 保存用户确认的拼版布局。每张纸包含稳定 ID、锚点来源页、顺序、A4 方向、模板来源、自动/手动标志、跨目录确认、更新时间和一个或多个 `sections`。

每个 section 对应一项成果，保存材料 ID、高度权重、标题显示规则和递归布局树。布局树只有两类节点：

- `split`：`row` 或 `column`，至少两个子节点，权重总和归一化为 10000。
- `slot`：稳定来源页 ID、0–10000 的归一化裁切矩形、`contain | cover | fitWidth | fitHeight`、九宫格对齐、0/90/180/270 度旋转、可选 `detailOf` 和清晰度风险确认。

普通来源页只能有一个主槽；`detailOf` 用于有意保留“原图＋细节”的第二视图。页面计划保存布局摘要，但不把本地路径写入 PDF 标记。删除来源页时槽位可以暂时保留为缺失状态供用户修复；删除整项材料或目录时对应区段会从 `layoutSheets` 中清理。

## 5. 安全写入

保存队列执行：

1. 规范化顺序和更新时间。
2. 写 `project.json.tmp`。
3. 刷新文件句柄。
4. 重读临时 JSON 并迁移/Zod 校验。
5. 把旧文件改名为 `project.json.bak`。
6. 原子改名临时文件。
7. 失败时恢复备份。

## 6. `.spack` 便携包

`.spack` 是 ZIP 格式，仅允许：

```text
project.json
version.json
assets/
```

导出时外部 reference 来源会复制进 assets，包内项目改写为 copy 模式。Office 原件和 `assets/conversions/` 快照都会进入包。cache、temp、output、日志和项目备份不进入包。

导入防护包括条目白名单、路径规范化、目录穿越、绝对路径、符号链接、加密条目、未知压缩方式、异常压缩比、10,000 条目上限和 2 GB 解压上限。先解压到隔离临时目录，通过版本、Zod 和资产完整性检查后才创建正式项目。
