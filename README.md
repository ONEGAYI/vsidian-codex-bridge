# vsidian-codex-bridge

[Vsidian](https://github.com/ONEGAYI/vsidian)（VSCode 里的类 Obsidian Markdown 编辑体验）的附加组件：**桥接 Codex 生态**。

## 能力规划

| 能力 | 说明 | 上游依赖 |
| --- | --- | --- |
| 粘贴还原 | Codex 聊天剪贴板里的 `data-prompt-link-*` span 还原为标准 Markdown 链接，修复「保留格式粘贴把链接改写为 `\[...\](...)` 字面文本」 | [vsidian#530](https://github.com/ONEGAYI/vsidian/issues/530) 粘贴转换扩展点 API |
| Mermaid Codex 主题 | 以渲染提供者提供 Codex 预设（亮暗色板、ELK 布局、六类图型），替代内核内置实现 | [vsidian#533](https://github.com/ONEGAYI/vsidian/issues/533) 主题预设注册与明暗状态 API、[vsidian#535](https://github.com/ONEGAYI/vsidian/issues/535) 内核退役 |

普通链接尾部 `:行号` 的解析（md 与非 md 目标）已定案进 Vsidian 本体（[vsidian#534](https://github.com/ONEGAYI/vsidian/issues/534)），不在本组件范围。

## 状态

**规划期**——上游 API 票未落地，本仓库暂只有骨架与决策票（`pending-decision` 标签）。组件不在场时 Vsidian 完全可用（回落内置转换与 default 主题）。

## 开发

待脚手架决策票落定后补充构建与测试说明。

## License

MIT
