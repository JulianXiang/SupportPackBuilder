# 项目格式

## 1. 目录结构

```text
项目名称/
├── project.json
├── project.json.bak
├── assets/
├── cache/
│   ├── thumbnails/
│   └── previews/
├── temp/
└── output/
```

`project.json` 不保存 PDF 或图片二进制。cache 和 temp 可删除，assets 与 project.json 是项目核心数据。

## 2. schemaVersion

当前版本为 `1`。读取流程先解析原始 JSON，再根据 schemaVersion 迁移，最后通过完整 Zod schema。缺少版本或版本 0 的早期数据会补为版本 1；未知高版本会被拒绝。

## 3. 路径规则

- `projectDirectory` 在 JSON 中固定为 `"."`。
- copy 模式的 `sourcePath`、`storedPath` 使用 `assets/` 相对路径。
- reference 模式允许 `storedPath: null` 和外部绝对 `sourcePath`。
- Main 解析相对路径后验证它仍在项目根目录内。
- 完整本地路径不放入缩略图 URL、PDF 标记或日志正文。

## 4. 主要字段

Project 保存基础信息、资产模式、封面、目录、页码、导出设置和 outlineNodes。

参考版式相关字段：

- `coverSettings.insertBlankBackPage`：是否在封面后插入不计页码的双面打印空白页。
- `exportSettings.contentHeadingMode`：`firstPage` 表示把分级标题放在材料首张内容页上，`none` 表示关闭。
- `pageNumberSettings.format: "dash"`：打印为 `— 1 —`。

同一 `schemaVersion: 1` 的旧项目缺少前两个新增字段时，Zod 会补入参考版式默认值，不信任其他未经校验的数据。

OutlineNode 保存稳定 ID、父 ID、层级、标题、顺序、启用状态、标题页设置、children 和 materials。

Material 保存兼容的单值文件摘要和完整 `sourceItems`。图片集合使用多个 MaterialSource；页面编辑以 sourcePageId 引用来源页。

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

导出时外部 reference 来源会复制进 assets，包内项目改写为 copy 模式。cache、temp、output、日志和项目备份不进入包。

导入防护包括条目白名单、路径规范化、目录穿越、绝对路径、符号链接、加密条目、未知压缩方式、异常压缩比、10,000 条目上限和 2 GB 解压上限。先解压到隔离临时目录，通过版本、Zod 和资产完整性检查后才创建正式项目。
