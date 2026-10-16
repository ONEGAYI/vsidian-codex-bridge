# ADR-0003：Mermaid Codex 主题迁移——运行时自带打包与 ELK 分块懒加载

- 状态：**已按推荐先行实施，待用户追认**（票 #3 两项 `pending-decision`，2026-10-16）
- 背景：以主题关联的渲染提供者（mermaid 语言）重新提供 Codex 主题，能力对齐内核退役前行为（亮暗色板、ELK 布局、六类图型、导出背景、图内显式配置优先）。迁移源是 vsidian 内核 `src/webview/mermaidTheme.ts` / `mermaidEntry.ts` / `mermaidRender.ts`（origin/main@`301d2c16`）。
- 关联：[ADR-0001](0001-脚手架构建与vendor快照.md)（构建桥与 vendor 快照）；上游规格 docs/specs/addon-themes.md 与 ADR-0017（以 T07 实现为准）。

## 决策一：Mermaid 运行时组件自带打包，版本对齐上游本体版本线

**采纳**：devDependencies 加 `mermaid@11.12.2` 与 `@mermaid-js/layout-elk@0.2.0`（elkjs 0.9.3 为其传递依赖）——版本**逐字对齐 vsidian 主仓 lockfile 的实际版本线**，不自行管理升级（跟随上游升级 = 重新对齐，色板契约测试同步验证）。

**与上游的差异**：vsidian 主仓把两者放 `dependencies`；本仓放 `devDependencies`——产物经 esbuild bundle 自包含（dist/mermaid.js + 分块），运行时不读 node_modules；参照仓 vsidian-easy-typing 的「无运行时依赖」红线使 VSIX 不携带约 30MB 的 mermaid 依赖树（.vscodeignore 的取舍留给发布票 #4）。

## 决策二：ELK 分块懒加载，不做全量内联

**采纳**：mermaid 运行时独立成 **esm + splitting 产物**（`dist/mermaid.js` 入口约 29KB + `dist/mermaid-chunks/` 76 个动态分块约 4.1MB，ELK 引擎与各图类型按需加载）——形态对齐上游 `out/webview/mermaid.js` 独立产物（esbuild.mjs:152-164）。IIFE 不支持 code splitting，且约 2.7MB 的 mermaid 核心进主 bundle 会让每次编辑器页面装载都付解析成本（上游 #60 决策原文）。

装载链路：页面 IIFE（dist/editor.js，2.6KB）经 `sdk.resourceUri('dist/mermaid.js')` 取本页地址后注入 `<script type="module">`，装载完成从全局 `__vsidianCodexMermaid` 取包装 API。**全局名是本组件私有通道**——不占用内置管线的 `globalThis.mermaid`，组件停用回落内置 default 时两套 mermaid 实例互不污染（降级底线）。单例装载承诺 + 失败终态口径对齐内核 `ensureMermaidApi`（资源 URI 固定，重注入只会堆积失败 script）。

## 迁移与实现要点

1. **色板迁移即拷贝**：`src/codex/theme.ts` 的 `buildCodexMermaidConfig` 从内核 `mermaidTheme.ts` 迁移，**函数体 70 行逐字节一致**（`diff` 对拍验证）；期望值契约 `test/codex-theme.test.ts` 27 用例独立抄写上游取值对拍（亮暗 × 流程图 ELK 分支 / 六类图型分支全量 themeVariables）。上游白名单 `['sequence','class','classDiagram','state','stateDiagram','er','gantt','pie']` 与 mermaid 11.12.2 `detectType` 实际返回的 diagram id 对齐（主仓 mermaid.core.mjs 源码核对 + 浏览器冒烟间接验证：未命中白名单则回退基底主题，暗色填充 #1a283d 不会生效）。
2. **图内显式配置优先**：实现位置在运行时包装（`src/codex/runtime.ts`，形态迁移自内核 mermaidEntry）——每张图先恢复站点配置基线，再按 `detectType` 结果叠加 Codex 预设；**源码逐字节透传给 `mermaid.render`**，frontmatter（init 配置）、classDef、style 由 mermaid 自身解析并覆盖站点配置（上游「预设不改写源码」口径）。差异：明暗由调用方显式传入（页面持有 `themeEnvironment` 事实），不像上游从 `baseConfig.theme` 推断。**配置与渲染共享串行队列**（PR #5 审查 P1 修复，形态对齐内核 mermaidRender 的外层 renderQueue）：mermaid 站点配置是全局单例、render 在内部异步阶段消费它——initialize 与 render 若各自立即执行，并发多图时后图的叠加配置会覆盖前图尚未消费的配置（正确性回归，非仅性能问题；真实 mermaid 回归测试钉住并发多图型与并发同图型异明暗两形态）。mount、主题重绘与 exportSvg 全部路径共用包装 API，均被队列覆盖。
3. **导出背景与快照**：Codex 预设的 `themeCSS` 首行 `& { background-color:... }` 把画布底色烘焙进 SVG 内嵌 style——`exportSvg` 返回渲染原文即带背景，弹窗快照与 SVG/PNG 导出走平台既有链路（PNG 由平台从 SVG 光栅化，`exportFormats: ['svg']` 声明即可）。浏览器冒烟直接断言暗 #181818 / 亮 #ffffff 在 SVG 内嵌 style 中。
4. **明暗联动**：`sdk.themeEnvironment.onChange`（VSCode 实际生效主题四态两轴投影）直连 `renderer.onThemeChange`——重渲染全部已挂载容器（等值跳过、脱离文档顺带清理）；图表弹窗沿平台既有快照/刷新语义，不经组件。
5. **平台口径落位**：安装只增候选不自动切换（themes.register 目录登记，选择归用户单选）；组件主题身份 `ONEGAYI.vsidian-codex-bridge/codex`（组合形态，不占用内置保留值 `codex`）；显示名 `Codex` 对齐内核 i18n 文案；停用回落内置 default 且保留首选（平台语义，组件侧靠私有全局名与自处理降级保证不拖累宿主）。
6. **降级口径**：装载失败 / 渲染失败是**自处理降级**（错误信息 + 源码占位，不向平台抛——渲染 bug 不伪造组件故障停用，对齐平台 ADR-0012 Q30）；迟到结果不回插（容器已 release / 脱离文档时在途结果丢弃）。

## 验证证据（2026-10-16）

- `npm install && npm run compile && npm test`：71 用例全绿（色板 27 + 运行时 6 + 渲染器 12 + 登记 7 + 加载器 4 + 脚手架 15）；`npm run vendor:check` 快照一致（26 文件，锚定 301d2c16）。日志：`D:\CODE\Project\_ForExplore\vsidian-codex-bridge-scaffold\mermaid-logs\full-pipeline.log`。
- 浏览器层冒烟（真实 Chromium 装载 dist 产物，17 项全过）：esm 分块装载、流程图 + 六类图型 × 亮暗渲染、暗色填充生效、frontmatter 覆盖、导出背景烘焙。日志：同目录 `browser-smoke.log`。Playwright 借用 vsidian 主仓 node_modules 与浏览器缓存（本仓不引重依赖，`VSIDIAN_SOURCE_REPO` 可指路）。
- PR #5 审查修复轮（2026-10-16）：全量 137 用例（新增真实 mermaid 回归 9 + 队列时序 3 + ESM 防线 4 + 并发隔离契约 1 + 静默宿主行为契约扩充）、vendor 并发夹具红→绿、浏览器冒烟 17 项、宿主四层经静默通道复验——日志 `release-logs/prfix-*.log`。

## 已知边界与未尽事项

- **真宿主安装验证未做**（票面验收项）：`@vscode/test-electron` 下界宿主装载 dist 产物、CSP 下 `dist/mermaid-chunks/` 动态分块放行、设置页「外观 → 主题」出现候选与单选生效——这些需要可安装 VSIX（票 #4 打包）或复用上游宿主集成基建，留给后续票；供 vsidian#535 检查的前置证据尚缺此项。
- **重复渲染无缓存**：同一图滚动往返（容器回收重挂载）会重渲染。内核按源文本 LRU 缓存 + SVG 克隆 id 改写；组件首版从简（容器挂载由平台管理，重渲染正确性不受影响），闪烁优化留待实测有诉求再议。
- **渲染串行队列已迁移（PR #5 审查 P1 修复）**：首版误判此队列「仅性能优化」未迁移——实际它是正确性保证（mermaid 全局配置单例 + render 异步消费，并发下后图配置覆盖前图在途渲染，实测丢 Codex 预设/明暗串扰）。现已在运行时包装层落地共享串行队列，真实 mermaid 回归（`test/codex-runtime-mermaid.test.ts`）钉住。附带决策：恢复基线时强制 `suppressErrorRendering: true`（包装层私有标志）——mermaid 失败默认向 `document.body` 插错误图临时根再 reject（PR #5 审查 P2），组件错误口径是自处理降级，错误图是残留物。
- **宿主侧失败日志**：themes.register 普通拒绝仅 `console.warn`（开发者输出通道可见），无用户可见提示——候选期内 API 形状调整时便于诊断。
- **版本线对齐承诺**：mermaid 11.12.2 升级须重新对齐上游版本线并重跑全部验证（色板对拍 + 浏览器冒烟），不自行抢跑。
