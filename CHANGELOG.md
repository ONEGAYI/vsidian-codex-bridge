# Changelog

本文件记录面向用户的版本变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)：每个版本一个 `## [<版本号>] - <日期>` 段落，条目按「新功能 / 改进 / 修复 / 已知限制」归类；能为版本代言的大主题以**粗体主题组**呈现——主题行括注影响范围与编号，下挂多条短条目（一条只讲一件事），发布前的验收轮修复并入所属主题组、不单列。开发中的新条目先记入顶部 `## Unreleased - 开发中` 段（本仓无自动转正工具，发版提交人工把它转正为版本段并补日期）。`scripts/release.mjs` 的 release 子命令提取最新版本段作为 GitHub Release 的发布说明，并校验其版本号与 `package.json` 的 `version` 一致；已有发布标签的版本段落随 tag 定案，不得回填或删改。

## Unreleased - 开发中

（暂无）

## [0.1.0] - 2026-10-16

首个版本：为 [Vsidian](https://github.com/ONEGAYI/vsidian) 桥接 Codex 生态——粘贴时还原 Codex 聊天链接，并以渲染提供者重新提供 Mermaid Codex 主题（亮暗色板 + ELK 布局）。发布形态为 GitHub Release VSIX 与 VSCode Marketplace 双通道；组件停用或卸载时 Vsidian 完全可用（回落内置转换与 default 主题）。

### 新功能

**粘贴还原：Codex 聊天链接（#2 / PR #5）**

- 保留格式粘贴 Codex 聊天内容时，剪贴板里的 `data-prompt-link-*` span（label + href 双属性）还原为标准 Markdown 链接，修复「链接被改写为 `\[...\](...)` 字面文本」的问题。
- href 口径与宿主一致：空格以 `%20` 编码、`:行号` 后缀明文透传——普通链接点击可落到目标行（宿主 #534 行号锚点解析）。
- 兼容宿主历史变体形态（单 `data-prompt-link-url` 属性）。

**Mermaid Codex 主题（#3 / PR #5）**

- 以渲染提供者身份重新提供 Codex 预设：亮暗双套色板 + 流程图 ELK 布局（elk.layered），覆盖流程、时序、类、状态、ER、甘特六类图型；色板与配置自内核逐值迁移（独立契约测试对拍）。
- 亮暗随宿主明暗状态联动；快照、导出背景与图内显式配置优先于主题默认。
- Mermaid 运行时自带打包（版本对齐上游本体版本线 mermaid 11.12.2），以 esm 分块产物按需装载——ELK 等重依赖独立分块懒加载，不进页面主产物。
- 安装只新增主题候选（Vsidian 设置「外观 → 主题」出现 **Codex**），不自动切换，选择归用户。

**工程与发布基建（#1 / #4 / PR #5）**

- 发布形态：推 `v*` 标签自动创建 GitHub Release 附 VSIX；Marketplace 发布为可选双开关（`VSCE_PAT` 密钥 + `MARKETPLACE_PUBLISH` 变量），从 Release 下载同一份 VSIX 发布——两渠道同一份字节。
- VSIX 打包带内容红线：必需清单（dist 三产物 + mermaid 分块非空）、禁止模式与白名单双保险、体积双线阈值、解包 manifest 冒烟。
- CI（push / PR）：构建 + 类型检查 + 单元契约测试 + vendor 类型快照防漂移 + VSIX 打包上传。
- vendor SDK 类型快照锚定 vsidian@`80dfc285`（附加组件 API 1.1.0 发行提交）——首次发布即对齐发行版 API 1.1.0（api 声明 `^1.1.0`，candidate 1.0.0 面全量转正无破坏性变更），升级走显式 re-vendor（不追逐 main）。
- 真宿主安装验证走静默通道：独立桌面内起 VSCode 1.82.3（engines 下界），四层断言（激活 / 主题候选 / 组件渲染选路 / 停用回落），宿主窗口不出现在用户桌面。

### 已知限制

- VSIX 安装态（`--install-extension`）的自动化回归未覆盖（开发装载路径已覆盖；安装态差异由 README 手动验证清单承载）。
- Mermaid 渲染缓存（LRU + SVG 克隆改写）未迁移，首版从简（决策见 ADR-0003）。
- Marketplace 图标未设置：本仓暂无图标资产，Marketplace 页面使用默认占位（决策见 ADR-0004）。

<!-- 变更链接
0.1.0: https://github.com/ONEGAYI/vsidian-codex-bridge/commits/v0.1.0
-->
