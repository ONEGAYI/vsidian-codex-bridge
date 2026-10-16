# vsidian-codex-bridge

[Vsidian](https://github.com/ONEGAYI/vsidian)（VSCode 里的类 Obsidian Markdown 编辑体验）的附加组件：**桥接 Codex 生态**。

## 能力规划

| 能力 | 说明 | 上游依赖 |
| --- | --- | --- |
| 粘贴还原（**已实现**，票 #2） | Codex 聊天剪贴板里的 `data-prompt-link-*` span 还原为标准 Markdown 链接，修复「保留格式粘贴把链接改写为 `\[...\](...)` 字面文本」；识别票面当前形态（label + href 双属性）与上游历史变体（单 url 属性），href 口径随宿主（空格 `%20` / 明文 `:行号` 透传，见 [ADR-0002](docs/adr/0002-粘贴还原href产出口径与属性形态兼容.md)） | [vsidian#530](https://github.com/ONEGAYI/vsidian/issues/530) 粘贴转换扩展点 API（**已落地**） |
| Mermaid Codex 主题 | 以渲染提供者提供 Codex 预设（亮暗色板、ELK 布局、六类图型），替代内核内置实现 | [vsidian#533](https://github.com/ONEGAYI/vsidian/issues/533) 主题预设注册与明暗状态 API（**已落地**）、[vsidian#535](https://github.com/ONEGAYI/vsidian/issues/535) 内核退役（反向等待本组件） |

普通链接尾部 `:行号` 的解析（md 与非 md 目标）已定案进 Vsidian 本体（[vsidian#534](https://github.com/ONEGAYI/vsidian/issues/534)），不在本组件范围。

## 状态

**实施期**——上游 API 已落地：粘贴转换（#530）与主题注册（#533 / T07）已完成，2026-10-16 batch-2 PR #564 合入 vsidian main@`301d2c16`（T01–T07 全部在内，T08/`#535` 内核退役未实施）；T01–T07 虽已合入 main，仍待用户整体验收，API 处候选期、形状可能调整。实施顺序：#1 脚手架（完成）→ #2 粘贴还原（**已实现，待验收**，决策见 [ADR-0002](docs/adr/0002-粘贴还原href产出口径与属性形态兼容.md)）→ #3 Mermaid Codex 主题（**主体已实施**：色板逐值迁移自内核 + mermaid esm 分块产物，单元/浏览器层验证全绿，真宿主安装验证待 #4 的可安装 VSIX），#4 CI/发布穿插；#3 被 vsidian#535 反向等待（其交付后内核才退役内置 Codex 主题）。组件不在场时 Vsidian 完全可用（回落内置转换与 default 主题）。

## 实施决策（已按推荐先行，待追认）

脚手架票 #1 三项与主题票 #3 两项按推荐方案先行实施，**待用户追认**；详情与理由见 [docs/adr/0001](docs/adr/0001-脚手架构建与vendor快照.md) 与 [docs/adr/0003](docs/adr/0003-mermaid-codex主题迁移.md)：

1. **构建链**：TypeScript + esbuild，宿主 CJS（node18 / external vscode）+ 页面 IIFE（chrome114 / SDK 构建桥）+ **Mermaid 独立 esm 分块产物**（chrome114 + splitting，ELK 与图类型按需分块）三入口；机制照搬参照仓 [vsidian-easy-typing](https://github.com/ONEGAYI/vsidian-easy-typing) 的构建桥复制链（源头是 vsidian `test/examples/` 官方蓝本）；类型检查独立 `tsc --noEmit`。
2. **测试**：vitest 单元层 + 结构契约测试（`test/scaffold.test.ts` 钉住 manifest 清单、vendor 快照纪律、导入纪律与产物形态）；浏览器层冒烟 `test/browser/smoke-mermaid.mjs`（真实 Chromium 装载 dist 产物，七类图型 × 亮暗渲染，借 vsidian 主仓 Playwright）；宿主层归 #4/后续票。
3. **API 基线**：vendor SDK 类型快照锚定 vsidian@`301d2c16`（含 batch-1 #548 + batch-2 #564）；入口表在参照仓 11 个公开 API 面之上补入 `addonPasteRules`（粘贴还原）与 `addonThemes`（主题）两个 batch 新面；首期**不声明任何 experimental 入口**（两块能力均在稳定候选面）。
4. **Mermaid 运行时**（票 #3）：组件自带打包，版本对齐上游本体版本线（mermaid `11.12.2` + `@mermaid-js/layout-elk` `0.2.0`，devDependencies——产物 bundle 自包含）；Codex 色板与配置从内核 `src/webview/mermaidTheme.ts` **逐值拷贝迁移**（函数体 diff 对拍一致，契约测试独立抄写期望值对拍）。
5. **ELK 加载形态**（票 #3）：分块懒加载（esm + splitting 独立产物，约 2.7MB 核心不进页面主产物），不做全量内联；页面经 `sdk.resourceUri` + `<script type="module">` 装载，私有全局名 `__vsidianCodexMermaid` 与内置管线互不污染。

## 开发

```bash
npm install          # 安装 devDependencies（无运行时依赖）
npm run compile      # 三产物构建（extension.js + editor.js + mermaid.js 及分块）+ 类型检查
npm test             # 先构建再跑 vitest（71 用例：结构契约 + 粘贴还原契约 + Codex 主题契约）
npm run vendor:check # 校验 types/vendor/ 快照与生成器无漂移
npm run vendor:sdk   # 重新生成类型快照（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）
node test/browser/smoke-mermaid.mjs   # 浏览器层冒烟（需 vsidian 主仓 node_modules 的 Playwright）
```

vendor 快照的源仓定位：`--source` 参数 > `VSIDIAN_SOURCE_REPO` 环境变量 > 同级目录 `../vscode-obsidian-like-editor`。API 语义与发行台账以 [vsidian 主仓库](https://github.com/ONEGAYI/vsidian) 的 docs/addons/developer-guide.md 与 api-reference.md 为事实源，本仓库只引用、不复制。

## License

MIT
