# vsidian-codex-bridge

[Vsidian](https://github.com/ONEGAYI/vsidian) 附加组件：桥接 Codex 生态——把 Codex 侧产物接进 Vsidian，首期规划两块能力：

1. **粘贴还原**：识别 Codex 聊天剪贴板里的 `data-prompt-link-*` span，还原为标准 Markdown 链接（上游粘贴转换扩展点 API，宿主侧 `enableCtx.paste.registerRules`）；
2. **Mermaid Codex 主题**：以渲染提供者身份重新提供 Codex 预设（亮暗色板、ELK 布局、六类图型），宿主侧 `enableCtx.themes.register` 登记元数据 + 页面侧 `sdk.renderers.register` 执行渲染。

> 状态：**实施期**。上游 API 已落地——粘贴转换（[vsidian#530](https://github.com/ONEGAYI/vsidian/issues/530)）与主题注册（[vsidian#533](https://github.com/ONEGAYI/vsidian/issues/533) / T07）已完成，2026-10-16 batch-2 PR #564 合入 vsidian main@`301d2c16`（T01–T07 已合入但待用户整体验收，API 处候选期形状可能调整）；vendor 类型快照锚定该提交。实施顺序：**#1（脚手架）→ #2（粘贴还原）→ #3（Mermaid Codex 主题）**，#4（CI/发布）穿插——#2 依赖已就绪、#3 依赖已就绪且被 [vsidian#535](https://github.com/ONEGAYI/vsidian/issues/535)（T08 内核 Codex 退役）反向等待。脚手架三项选型按推荐先行、待用户追认（清单见 README「实施决策（待追认）」与 docs/adr/0001）。

## 约定

- **提交语言**：提交信息、issue、PR 默认使用中文，格式 `类型: 简述`（feat / fix / refactor / docs / chore / style / perf / test），正文必需（做了什么、为什么做）。
- **平台契约**：目标平台是 Vsidian 附加组件公开 API。API 语义清单、发行台账与开发者文档以 vsidian 主仓库为事实源（docs/addons/developer-guide.md、ADR-0012），本仓库**不复制语义清单，只引用**；清单声明用 package.json 顶层 `vsidianAddon` 私有字段，experimental 入口按需声明并在兼容范围内核对。
- **降级底线**：组件停止工作（停用/故障/未安装）时 Vsidian 必须完全可用——粘贴回落内置转换、Mermaid 回落内置 default 主题。功能设计不得引入「组件不在场则宿主受损」的依赖。
- **TDD**：可执行行为先契约测试后实现（对齐 Vsidian 侧测试层次：单元 + 浏览器 + 宿主）；脚手架已落 vitest 单元层（`npm test`），浏览器/宿主层基建随能力票扩展。
- **任务跟踪**：本仓库 GitHub Issues；带 `pending-decision` 标签的票是待用户决策项，agent 不得擅自替用户决策后实施。

## 目录结构

```
vsidian-codex-bridge/
├── AGENTS.md                  # 本文件：项目级 agent 规则单一事实源
├── CLAUDE.md                  # @AGENTS.md 导入 + Claude 专属补充
├── LICENSE                    # MIT
├── README.md                  # 项目门面：状态、能力规划、实施决策
├── build.mjs                  # 双产物构建入口（调 tools/buildLib.mjs）
├── package.json               # 含 vsidianAddon 清单声明（manifestVersion 1 / api ^1.0.0，零 experimental）
├── tsconfig.json              # tsc --noEmit 类型检查（esbuild 不查类型）
├── vitest.config.ts           # 单元层测试配置（node 环境）
├── docs/adr/                  # 架构决策记录（0001：脚手架构建与 vendor 快照）
├── scripts/
│   └── vendorSdkTypes.mjs     # SDK 类型快照生成/校验（锚定 vsidian@301d2c16；npm run vendor:sdk / vendor:check）
├── src/
│   ├── extension.ts           # 宿主入口：registerAddon 两段生命周期（bridge#2/#3 在此扩展）
│   ├── page-editor.ts         # 编辑器页 IIFE 占位入口（bridge#3 渲染提供者在此扩展）
│   ├── host-api.ts            # 宿主导出 API 最小声明（registerAddon 面）
│   └── vsidian-addon-sdk.d.ts # 虚拟模块 vsidian-addon-sdk 的 ambient 类型声明
├── test/
│   └── scaffold.test.ts       # 脚手架结构契约（manifest / vendor 纪律 / 目录 / 导入纪律 / 产物形态）
├── tools/
│   ├── buildLib.mjs           # 构建库：页面 IIFE + 宿主 CJS + 产物静态扫描
│   ├── sdkBridge.mjs          # SDK 构建桥（虚拟模块注入 + CM6 值导入拒绝）
│   └── cm6Markers.mjs         # CM6 运行时标记表（产物扫描第二道防线）
└── types/vendor/              # vendor SDK 类型快照（勿手改；re-vendor 见 scripts）
```

产物 `dist/`（extension.js + editor.js）不入库；`node_modules/`、`dist/` 均在 .gitignore。
