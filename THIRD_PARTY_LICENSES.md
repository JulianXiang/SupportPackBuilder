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

## LibreOffice

- 分发版本：LibreOffice 26.2.5.2（构建标识 `cd7284b4cbbfeb507e630c1aac019f4157393acb`）
- 用途：在完全离线环境中把 DOCX、PPTX、XLSX 转换为项目内 PDF 快照
- 官方发布目录：https://download.documentfoundation.org/libreoffice/stable/26.2.5/
- 对应源代码目录：https://download.documentfoundation.org/libreoffice/src/26.2.5/
- 项目许可证说明：https://www.libreoffice.org/about-us/licenses/
- 主要许可：Mozilla Public License 2.0；LibreOffice 分发物所含部分组件同时或另行适用 LGPL 及其各自许可证，精确文本以分发物内文件为准
- macOS arm64 安装镜像：`LibreOffice_26.2.5_MacOS_aarch64.dmg`
- macOS arm64 SHA-256：`c99fb4fe574437fc4cb820a4ca15271bca325920861f7139858b36d7f9df78ad`
- Windows x64 安装包：`LibreOffice_26.2.5_Win_x86-64.msi`
- Windows x64 SHA-256：`f15ba07bfcb0186986cf3171063506f5d207c11f8cc051ba0d135209e9e915f9`

源码仓库中的 `vendor/libreoffice-runtime/` 是构建生成物，不提交 Git。发布准备脚本按平台下载固定安装介质、校验 SHA-256、版本和架构，再由 electron-builder 复制到 `Resources/libreoffice`。运行时不会下载 LibreOffice。

macOS 分发物的完整许可证和声明会原样保留在：

```text
LibreOffice.app/Contents/Resources/LICENSE
LibreOffice.app/Contents/Resources/LICENSE.html
LibreOffice.app/Contents/Resources/NOTICE
```

Windows 发布物也必须保留上游安装目录中的许可证文件。任何版本升级都必须同步更新固定 URL、SHA-256、源代码获取地址、许可证清单和三平台转换回归结果。

## JavaScript 与原生依赖

应用依赖的 Electron、React、Ant Design、pdf-lib、PDF.js、Sharp 等软件包分别遵循其上游许可证。精确版本记录在 `package-lock.json`；发布前应按组织合规流程生成完整依赖许可证清单。
