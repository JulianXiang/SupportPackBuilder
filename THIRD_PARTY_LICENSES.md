# 第三方许可证

## SupportPack Sans SC（源自 Noto Sans SC）

- 分发名称：SupportPack Sans SC Regular、SupportPack Sans SC Bold
- 项目来源：https://github.com/notofonts/noto-cjk
- 固定来源版本：`f8d157532fbfaeda587e826d4cd5b21a49186f7c`
- 原始文件：`Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf`
- 生成方式：使用 fonttools 4.59.0 分别固定 `wght=400` 与 `wght=700`，并将衍生字体主名称改为 SupportPack Sans SC
- 用途：Chromium 打印生成中文封面、目录和标题页；pdf-lib 绘制中文同页标题与页码
- 许可证：SIL Open Font License 1.1
- 本地许可证副本：`resources/public/fonts/LICENSE.txt`
- 字体文件 SHA-256：
  - `SupportPackSansSC-Regular.ttf`：`24c0c97248e028945bb61b6444af1680c98758c44c05231b1bc086f797ca7d9a`
  - `SupportPackSansSC-Bold.ttf`：`b77cac28cd91942a58f93102286246a49e60091dd0ceab1170b88bbab6d965dc`

该字体允许在符合 SIL OFL 1.1 条款的前提下随软件分发和嵌入。静态实例使用新的主字体名称，避免把衍生文件误称为上游原始字体。

## JavaScript 与原生依赖

应用依赖的 Electron、React、Ant Design、pdf-lib、PDF.js、Sharp 等软件包分别遵循其上游许可证。精确版本记录在 `package-lock.json`；发布前应按组织合规流程生成完整依赖许可证清单。
