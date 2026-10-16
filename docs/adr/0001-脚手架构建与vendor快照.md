# ADR-0001：脚手架选型——构建桥复制与 vendor 类型快照

- 状态：**已按推荐先行实施，待用户追认**（票 #1，2026-10-16）
- 背景：本仓是 Vsidian 附加组件（桥接 Codex 生态：粘贴还原 + Mermaid Codex 主题）。脚手架票 #1 带 `pending-decision` 标签，实施按推荐方案先行，三项决策（构建链 / 测试 / API 基线锚定）待用户追认；追认或改选时以本 ADR 为对照基线。
- 参照：[vsidian-easy-typing ADR-0001](https://github.com/ONEGAYI/vsidian-easy-typing/blob/main/docs/adr/0001-scaffold-build-bridge-and-vendor.md)（首个真实附加组件仓，同时是 Vsidian Plugins 范例模板）；蓝本源头是 vsidian `test/examples/` 官方样例（docs/addons/example-repo-plan.md 的独立仓库复制清单）。

## 决策一：双产物构建直接复制 vsidian 构建桥模式

**采纳**：复制构建桥三件套（`tools/sdkBridge.mjs` 原样、`tools/cm6Markers.mjs` 摘出单源、`tools/buildLib.mjs` 收敛为单工程形态），双防线不变：

1. **构建期**——SDK 构建桥拒绝 `@codemirror/*` 值导入（type-only 导入被 esbuild 剥离，不受影响）；
2. **产物期**——逐产物静态扫描：CM6 运行时标记、vsidian 内部路径标记（含 `types/vendor`）、裸 require（页面零 require；宿主仅 `vscode`）。

产物目标：宿主 `dist/extension.js`（node18 CJS / external vscode，`activate`/`deactivate` 经 `module.exports` 显式赋值——esbuild 会消除无消费者的 ESM 导出，蓝本实测坑）；页面 `dist/editor.js`（chrome114 IIFE / SDK 构建桥，对齐下界宿主 1.82.3 = Electron 25 / Chromium 114，**不是** vsidian 本体的 chrome118）。首期仅宿主入口有实现代码（registerAddon 两段生命周期接入，`setup` 空实现、`enable` 登记编辑器页入口占位），页面入口留空工厂占位——bridge#3 的渲染提供者在此扩展。类型检查独立 `tsc --noEmit`（esbuild 只做转译打包，tsconfig 对齐参照仓：ES2022 / Bundler / strict 全开）。

**与 easy-typing 的差异**：本仓无设置页，双产物（页面仅编辑器页一个）而非三产物；Mermaid 独立 esm 分块产物（上游 mermaid.js 的 splitting 形态）留给 bridge#3 按需评估，本票不预建。

**否决**：自写构建或引入打包框架——蓝本即生产验证过的路径，与平台样例一致是首要品质。

## 决策二：vendor 类型快照锚定 batch-2 合入点，入口表补本仓消费面

**采纳**：`scripts/vendorSdkTypes.mjs`（TS 编译器 API 驱动，机制照搬 easy-typing 同名脚本）从 vsidian 仓 `git show <commit>:<path>` 读取源文件，生成 `types/vendor/` 类型快照：

- **锚定提交 `301d2c16`**（2026-10-16 batch-2 PR #564 合入 main）：T01–T07 全部在内——含 #530 粘贴转换（#541/#542）与 #533 主题注册（#546/T07）API 面；T08（#535 内核退役）未实施，不影响 API 消费。easy-typing 的锚定（`9cd04d1c`）早于 batch-2，不含这两面，故**入口表独立维护**：其 11 个公开 API 面之上补入 `src/shared/addonPasteRules.ts`（bridge#2 直接消费）与 `src/shared/addonThemes.ts`（bridge#3 直接消费），共 13 个入口；
- **入口文件完整面 + 内部依赖最小闭包**：addonPage 引用的 batch 新面（addonNavApi / addonRefViews / addonHostSettingsApi / addonSyntaxApi / addonSettingsContextApi 等）经闭包自动带出被引用名字，不显式进入口表（本仓不消费其完整面）；导航/引用视图等不在本仓能力范围；
- **值级导出一律剥离**；每文件头标注 `vendored from ONEGAYI/vsidian@<commit>`；`npm run vendor:check` 校验快照与生成器无漂移（CI 入口，#4 票接线；锚定不可达必须失败）；升级快照 = 改 `DEFAULT_COMMIT` → `npm run vendor:sdk` → 评审 diff → 提交。

**对参照脚本的必要修复**（301d2c16 依赖拓扑实证）：闭包迭代存在「在途请求丢失」缺陷——同一轮内，先处理的模块请求某依赖时，从 pending（轮首已清空）与 rooted（尚未处理）都取不到该依赖在队列尾部的更大请求集合，会以更小集合入队并在下一轮 `rooted.set` 覆盖已保留名字（实证：`SerChange` 与 `HoverPreviewFailReason` 分轮到达 protocol.ts，最终快照丢 `SerChange` → tsc TS2305）。修复：请求合并计入在途集合（queue 快照内的请求参与「已请求」判定）、rooted 更新取并集。easy-typing 锚定的旧提交拓扑恰好未触发该缺陷；re-vendor 到新提交时会需要此修复。

## 决策三：清单声明与依赖锁定

- `vsidianAddon: { manifestVersion: 1, api: "^1.0.0" }`——api 范围必须 `^`（宿主兼容判定要求声明范围包含宿主版本）；**首期零 experimental**：粘贴与主题全在稳定候选面，experimental 声明宿主未提供的入口名会使整个组件判不兼容（`experimental-unsupported`）。后续票确需实验入口时扩充并保持 `^`（红线由 `test/scaffold.test.ts` 钉死）；
- `extensionDependencies: ["onegayi.vsidian"]`、`engines.vscode ^1.82.3`、`extensionKind ["workspace"]`、`activationEvents []`（由依赖链激活）、`main: "./dist/extension.js"`——对齐 developer-guide §2.1 与所有示例工程实证；
- devDependencies 全部精确版本对齐参照仓（typescript 6.0.3 / esbuild 0.28.2 / vitest 5.0.1 / @types/vscode 1.82.0 / @types/node 22.20.4，另加 @codemirror/state、view、language 三个**仅类型消费**的 devDep——vendor 快照的 `typeof import(...)` 需要）；无运行时依赖。

## 决策四：测试形态——vitest 单元层 + 结构契约起步

**采纳**：`npm test` = 构建后跑 vitest（node 环境）。`test/scaffold.test.ts` 钉住五组契约：manifest 清单（含零 experimental 红线）、vendor 快照纪律（头注哈希 / 锚定一致 / 默认源仓路径）、目录结构、源码导入纪律（vendor 仅 type-only、动态代码禁令）、构建产物形态（双产物在场 + require 边界——test 内置先构建保证断言稳定）。

**浏览器层与真宿主层基建不在本票**：对齐 Vsidian 侧「单元 + 浏览器 + 宿主」三层的最终形态，但按能力票实际需要再建（bridge#3 的主题渲染断言天然落在浏览器层；宿主集成复用「自己的 dist 产物 + @vscode/test-electron 下界宿主」模式）。

## 后果

- 能力票实施者从 `src/extension.ts`（宿主：`enableCtx.paste.registerRules` / `enableCtx.themes.register`）与 `src/page-editor.ts`（页面：`sdk.renderers.register` / `sdk.themeEnvironment`）两个入口扩展；SDK 类型一律 `import type` 自 `types/vendor/`；
- 升级快照流程：改脚本 `DEFAULT_COMMIT` → `npm run vendor:sdk` → 评审 diff → 提交（快照与脚本同 PR）；候选期内接口仍可能调整，按自身节奏 re-vendor；
- 待追认项由用户裁决；若改选（如换测试框架、调整产物形态），影响面以本 ADR 各节为对照。

## 已知边界与未尽事项

- 保留的类型若引用函数/类（跨文件值 `typeof` 同理），生成器显式报错而非静默产出坏快照——出现时人工改写为结构类型；
- CI（#4 票）将接线 `vendor:check` 的「partial clone vsidian + 指锚」链路，本票不建 CI；
- VSIX 打包与 `.vscodeignore` 留给发布票（#4）；本仓首期无用户可见文字，i18n 字典实体随需要用户可见文案的票落地。
