# vsidian-codex-bridge

[Vsidian](https://github.com/ONEGAYI/vsidian)（VSCode 里的类 Obsidian Markdown 编辑体验）的附加组件：**桥接 Codex 生态**。

## 能力规划

| 能力 | 说明 | 上游依赖 |
| --- | --- | --- |
| 粘贴还原（**已实现**，票 #2） | Codex 聊天剪贴板里的 `data-prompt-link-*` span 还原为标准 Markdown 链接，修复「保留格式粘贴把链接改写为 `\[...\](...)` 字面文本」；识别票面当前形态（label + href 双属性）与上游历史变体（单 url 属性），href 口径随宿主（空格 `%20` / 明文 `:行号` 透传，见 [ADR-0002](docs/adr/0002-粘贴还原href产出口径与属性形态兼容.md)） | [vsidian#530](https://github.com/ONEGAYI/vsidian/issues/530) 粘贴转换扩展点 API（**已落地**） |
| Mermaid Codex 主题（**已实现**，票 #3） | 以渲染提供者提供 Codex 预设（亮暗色板、ELK 布局、六类图型），替代内核内置实现；真宿主安装验证随 #4 落地（下界宿主四层断言） | [vsidian#533](https://github.com/ONEGAYI/vsidian/issues/533) 主题预设注册与明暗状态 API（**已落地**）、[vsidian#535](https://github.com/ONEGAYI/vsidian/issues/535) 内核退役（反向等待本组件） |

普通链接尾部 `:行号` 的解析（md 与非 md 目标）已定案进 Vsidian 本体（[vsidian#534](https://github.com/ONEGAYI/vsidian/issues/534)），不在本组件范围。

## 状态

**实施期**——上游 API 已落地：粘贴转换（#530）与主题注册（#533 / T07）已完成，2026-10-16 batch-2 PR #564 合入 vsidian main@`301d2c16`（T01–T07 全部在内，T08/`#535` 内核退役未实施）；T01–T07 虽已合入 main，仍待用户整体验收，API 处候选期、形状可能调整。实施顺序：#1 脚手架（完成）→ #2 粘贴还原（**已实现，待验收**，决策见 [ADR-0002](docs/adr/0002-粘贴还原href产出口径与属性形态兼容.md)）→ #3 Mermaid Codex 主题（**已实现**：色板逐值迁移自内核 + mermaid esm 分块产物，单元/浏览器层验证全绿）→ #4 发布与分发（**已实施**：VSIX 打包链与内容红线、CI 工作流、真宿主安装验证、安装升级文档，决策见 [ADR-0004](docs/adr/0004-发布与分发形态.md)）；发布链路已升级为双通道自动发布（GitHub Release + Marketplace 双开关，用户决策见 ADR-0004 决策一变更）。#3 被 vsidian#535 反向等待（其交付后内核才退役内置 Codex 主题）。组件不在场时 Vsidian 完全可用（回落内置转换与 default 主题）。

## 实施决策（已按推荐先行，待追认）

脚手架票 #1 三项、主题票 #3 两项与发布票 #4 四项按推荐方案先行实施，**待用户追认**；详情与理由见 [docs/adr/0001](docs/adr/0001-脚手架构建与vendor快照.md)、[docs/adr/0003](docs/adr/0003-mermaid-codex主题迁移.md) 与 [docs/adr/0004](docs/adr/0004-发布与分发形态.md)：

1. **构建链**：TypeScript + esbuild，宿主 CJS（node18 / external vscode）+ 页面 IIFE（chrome114 / SDK 构建桥）+ **Mermaid 独立 esm 分块产物**（chrome114 + splitting，ELK 与图类型按需分块）三入口；机制照搬参照仓 [vsidian-easy-typing](https://github.com/ONEGAYI/vsidian-easy-typing) 的构建桥复制链（源头是 vsidian `test/examples/` 官方蓝本）；类型检查独立 `tsc --noEmit`。
2. **测试**：vitest 单元层 + 结构契约测试（`test/scaffold.test.ts` 钉住 manifest 清单、vendor 快照纪律、导入纪律与产物形态）；浏览器层冒烟 `test/browser/smoke-mermaid.mjs`（真实 Chromium 装载 dist 产物，七类图型 × 亮暗渲染，借 vsidian 主仓 Playwright）；宿主层归 #4/后续票。
3. **API 基线**：vendor SDK 类型快照锚定 vsidian@`301d2c16`（含 batch-1 #548 + batch-2 #564）；入口表在参照仓 11 个公开 API 面之上补入 `addonPasteRules`（粘贴还原）与 `addonThemes`（主题）两个 batch 新面；首期**不声明任何 experimental 入口**（两块能力均在稳定候选面）。
4. **Mermaid 运行时**（票 #3）：组件自带打包，版本对齐上游本体版本线（mermaid `11.12.2` + `@mermaid-js/layout-elk` `0.2.0`，devDependencies——产物 bundle 自包含）；Codex 色板与配置从内核 `src/webview/mermaidTheme.ts` **逐值拷贝迁移**（函数体 diff 对拍一致，契约测试独立抄写期望值对拍）。
5. **ELK 加载形态**（票 #3）：分块懒加载（esm + splitting 独立产物，约 2.7MB 核心不进页面主产物），不做全量内联；页面经 `sdk.resourceUri` + `<script type="module">` 装载，私有全局名 `__vsidianCodexMermaid` 与内置管线互不污染。

## 安装与升级

### 安装

前置：已安装 [Vsidian](https://github.com/ONEGAYI/vsidian) 本体（本组件声明 `extensionDependencies: ["onegayi.vsidian"]`，宿主缺席时组件不激活且无副作用）。

两个渠道任选其一（同一份 VSIX 字节）：

1. **VSCode Marketplace**（仓库配置双开关后可用）：扩展面板搜索 `vsidian-codex-bridge`（publisher `ONEGAYI`）安装，或命令行 `code --install-extension ONEGAYI.vsidian-codex-bridge`；
2. **GitHub Release 侧载**：从本仓库 [Releases](https://github.com/ONEGAYI/vsidian-codex-bridge/releases) 下载 VSIX（如 `vsidian-codex-bridge-0.1.0.vsix`），扩展面板「… → 从 VSIX 安装」，或 `code --install-extension vsidian-codex-bridge-0.1.0.vsix`。

装好后即生效：粘贴 Codex 聊天内容自动还原链接；「设置 → 外观 → 主题」出现 **Codex** 候选（安装只新增候选不自动切换，选择归用户）。

发布形态与双通道自动发布的说明（决策与机制见 [ADR-0004](docs/adr/0004-发布与分发形态.md)）：推 `v*` 标签自动创建 GitHub Release 附 VSIX；Marketplace 自动发布需仓库双开关——**Settings → Secrets and variables → Actions** 下配置 Secrets 的 `VSCE_PAT`（Azure DevOps PAT：Organization 选 All accessible organizations，Scope 选 Marketplace → Manage）与 Variables 的 `MARKETPLACE_PUBLISH = true`，两道开关都配置才执行（从 Release 下载同一份 VSIX 发布）；未配置时推 tag 只产出 GitHub Release。Marketplace 页面首版使用默认图标占位（本仓暂无图标资产，接受性见 ADR-0004）。

### 版本兼容表

| 组件版本 | vendor 类型锚（vsidian 提交） | API 声明 | 备注 |
| --- | --- | --- | --- |
| 0.1.0 | `301d2c16`（batch-2 PR #564，含 #530 粘贴 + T07 主题 API） | `^1.0.0`，零 experimental | API 1.0.0 在上游发行台账为 candidate，形状可能调整 |

兼容判定口径（事实源：vsidian 主仓库 docs/addons/developer-guide.md）：宿主提供的稳定 API 版本必须落在组件 `vsidianAddon.api` 范围内；vendor 锚是编译期类型面（re-vendor 随版本发布联动，不 chasing main）。

### 升级

Marketplace 渠道安装的组件随发布自动更新；GitHub Release 渠道下载新版 VSIX 后覆盖安装即可（`code --install-extension` 直接指定新文件）。升级说明随各 Release 附发布说明（取自 [CHANGELOG](CHANGELOG.md) 对应版本段）；若新版跟随上游 re-vendor，Release 说明会标注「需 vsidian ≥ 对应提交构建」。

### 降级与卸载

组件停用、故障或卸载时 **Vsidian 完全可用**（降级底线）：粘贴回落内置转换、Mermaid 回落内置 default 主题；已选择的 Codex 主题在组件缺席时保留首选设置并回落内置渲染，组件恢复后自动回到组件渲染。

## 开发

```bash
npm install          # 安装 devDependencies（无运行时依赖）
npm run compile      # 三产物构建（extension.js + editor.js + mermaid.js 及分块）+ 类型检查
npm test             # 先构建再跑 vitest（162 用例：结构契约 + 粘贴还原 + Codex 主题 + 发布红线 + CI/Release 工作流与宿主基建契约）
npm run vendor:check # 校验 types/vendor/ 快照与生成器无漂移
npm run vendor:sdk   # 重新生成类型快照（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）
npm run package      # compile + VSIX 打包 + 内容/体积红线 + manifest 冒烟（只产本地 VSIX）
npm run release      # 发布链路：package 全链 + gh release create 附 VSIX（须 v<version> 标签命中 + GH_TOKEN，CI 推 tag 触发）
npm run test:host    # 宿主层验证（静默通道：独立桌面起 VSCode 1.82.3，需 --host 指向 vsidian 构建产物仓）
node test/browser/smoke-mermaid.mjs   # 浏览器层冒烟（需 vsidian 主仓 node_modules 的 Playwright）
```

测试三层：vitest 单元层（`npm test`，秒级零外部依赖）、浏览器层冒烟、宿主层静默验证——三层独立入口，`npm test` 不级联宿主层。`npm run test:host -- --host <vsidian仓根>`（或环境变量 `VSIDIAN_HOST_OUT`）：宿主仓须含 `out/extension.js`（vendor 锚定提交 301d2c16 或更新构建——脚本自检 batch-2 主题 API 面在场）；**静默通道**经上游 vsidian 的 hiddenDesktop 机制（独立窗口站+桌面，见 [ADR-0004](docs/adr/0004-发布与分发形态.md)）——宿主窗口不出现在用户桌面、剪贴板隔离、启动器退出自动清理，报告落盘 `.vscode-test/host-check.log`（末尾「可见窗口峰值/前台 PID」行为静默性证据）。VSCode 1.82.3 优先复用本仓或 vsidian 源仓（`VSIDIAN_SOURCE_REPO`）的 `.vscode-test/` 缓存，无缓存时自动下载。

vendor 快照的源仓定位：`--source` 参数 > `VSIDIAN_SOURCE_REPO` 环境变量 > 同级目录 `../vscode-obsidian-like-editor`。API 语义与发行台账以 [vsidian 主仓库](https://github.com/ONEGAYI/vsidian) 的 docs/addons/developer-guide.md 与 api-reference.md 为事实源，本仓库只引用、不复制。

## 宿主安装手动验证（用户验收参考）

自动化宿主验证（`npm run test:host`）覆盖激活、主题候选、组件渲染选路与停用回落四层断言；以下清单补充自动化拿不到的两处人工证据点（暗色填充、私有全局名），并作为用户真实环境下的验收参考：

1. 前置：VSCode ≥ 1.82.3 + Vsidian（vendor 锚 `301d2c16` 或更新构建）已安装；
2. 侧载 VSIX：`code --install-extension vsidian-codex-bridge-<版本>.vsix`，重载窗口；
3. 组件激活：扩展面板中本组件已启用、无激活错误；粘贴 Codex 聊天内容，链接还原为 Markdown 链接；
4. 主题候选：Vsidian 设置「外观 → 主题」下拉出现 **Codex** 候选；
5. 选择 Codex 后打开含 ` ```mermaid ` 图的笔记，检查两处证据：
   - 画布底色随明暗切换（暗色 `#181818` / 亮色 `#ffffff`——Codex 色板特征，内置 default 无此暗色填充）；
   - 命令面板执行 `Developer: Open Webview Developer Tools`，Console 执行 `window.__vsidianCodexMermaid` 应非空（组件私有全局名，内置管线不占用）；
6. 停用组件（扩展面板「禁用」或 Vsidian 组件开关）：图回落内置 default 渲染（暗色填充消失）、Vsidian 其余功能不受影响；重新启用后 Codex 主题恢复。

## License

MIT
