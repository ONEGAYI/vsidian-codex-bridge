// 三产物构建入口：node build.mjs（= npm run build）。
// - dist/editor.js    编辑器页面 IIFE（chrome114，经 SDK 构建桥）——Codex
//                     渲染提供者装配（renderers.register + 明暗订阅）
// - dist/extension.js 宿主 CJS（node18，external vscode）——两段生命周期
//                     接入：编辑器页入口 + Codex 主题元数据登记
//                     （bridge#2 粘贴规则 ctx.paste.registerRules 随该票扩展）
// - dist/mermaid.js   Mermaid 运行时独立 esm 产物（chrome114 + splitting：
//                     dist/mermaid-chunks/ 动态分块，图类型与 ELK 引擎按需
//                     加载）——页面经 resourceUri + <script type="module">
//                     懒装载，不进 editor.js 主产物（约 2.7MB 的启动成本）
// 每个产物构建完成即静态扫描（CM6 运行时标记 / vsidian 内部路径 /
// 裸 require）——构建通过即双防线通过。逻辑在 tools/buildLib.mjs。
import { buildAddon } from './tools/buildLib.mjs'

await buildAddon({
  pages: [{ entry: 'src/page-editor.ts', out: 'dist/editor.js' }],
  host: 'src/extension.ts',
  esmModules: [{ entry: 'src/codex/mermaid-entry.ts', name: 'mermaid' }],
})
console.log('[build] 三产物构建完成：dist/editor.js + dist/extension.js + dist/mermaid.js(+chunks)')
