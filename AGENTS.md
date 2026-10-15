# vsidian-codex-bridge

[Vsidian](https://github.com/ONEGAYI/vsidian) 附加组件：桥接 Codex 生态——把 Codex 侧产物接进 Vsidian，首期规划两块能力：

1. **粘贴还原**：识别 Codex 聊天剪贴板里的 `data-prompt-link-*` span，还原为标准 Markdown 链接（依赖上游粘贴转换扩展点 API）；
2. **Mermaid Codex 主题**：以渲染提供者身份重新提供 Codex 预设（亮暗色板、ELK 布局、六类图型），依赖内核退役迁移通道。

> 状态：**规划期（待决策 + 待上游 API）**。核心能力依赖 Vsidian 尚未落地的附加组件 API——粘贴转换扩展点（[vsidian#530](https://github.com/ONEGAYI/vsidian/issues/530)）、主题预设注册与宿主明暗状态（[vsidian#533](https://github.com/ONEGAYI/vsidian/issues/533)）、Mermaid Codex 预设退役（[vsidian#535](https://github.com/ONEGAYI/vsidian/issues/535)）。上游票落地前本仓库只维护骨架与决策票，不实施功能代码。

## 约定

- **提交语言**：提交信息、issue、PR 默认使用中文，格式 `类型: 简述`（feat / fix / refactor / docs / chore / style / perf / test），正文必需（做了什么、为什么做）。
- **平台契约**：目标平台是 Vsidian 附加组件公开 API。API 语义清单、发行台账与开发者文档以 vsidian 主仓库为事实源（docs/addons/developer-guide.md、ADR-0012），本仓库**不复制语义清单，只引用**；清单声明用 package.json 顶层 `vsidianAddon` 私有字段，experimental 入口按需声明并在兼容范围内核对。
- **降级底线**：组件停止工作（停用/故障/未安装）时 Vsidian 必须完全可用——粘贴回落内置转换、Mermaid 回落内置 default 主题。功能设计不得引入「组件不在场则宿主受损」的依赖。
- **TDD**：可执行行为先契约测试后实现（对齐 Vsidian 侧测试层次：单元 + 浏览器 + 宿主，具体框架见脚手架决策票）。
- **任务跟踪**：本仓库 GitHub Issues；带 `pending-decision` 标签的票是待用户决策项，agent 不得擅自替用户决策后实施。

## 目录规划（骨架期）

```
vsidian-codex-bridge/
├── AGENTS.md    # 本文件：项目级 agent 规则单一事实源
├── CLAUDE.md    # @AGENTS.md 导入 + Claude 专属补充
├── LICENSE      # MIT
└── README.md    # 项目门面：状态、能力规划、上游依赖
```

实施启动后按脚手架决策票落 `src/`、`test/`、构建脚本与清单；届时本节同步更新。
