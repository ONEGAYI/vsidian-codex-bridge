// Mermaid 独立模块入口（票 #3）：产出 dist/mermaid.js 与动态分块
// dist/mermaid-chunks/（esbuild browser/esm/splitting，见 build.mjs——
// 形态对齐内核 src/webview/mermaidEntry.ts：mermaid 不进主 bundle）。
//
// 为什么需要本入口而不是直接打包官方 UMD（dist/mermaid.min.js）：UMD 尾部
// 以 `globalThis.__esbuild_esm_mermaid_nm.mermaid.default` 完成全局自赋值，
// 该内部命名空间在独立脚本里是全局 var、被 esbuild 模块包裹后变成模块
// 作用域局部变量——globalThis 引用落空抛 TypeError，全局永远挂不上。经
// ESM 源打包并由本入口显式挂全局即可，且 minify 后图类型、ELK 引擎分别
// 成按需加载的动态分块。（上游原注释，机制同款）
//
// 全局名 __vsidianCodexMermaid 是本组件私有通道（不占用内置管线的
// globalThis.mermaid——组件停用回落内置时互不污染）；页面装载层经
// loader.ts 注入本产物后读取。
import mermaid from 'mermaid'
import elkLayouts from '@mermaid-js/layout-elk'
import { createCodexMermaidApi } from './runtime'

mermaid.registerLayoutLoaders(elkLayouts)

const api = createCodexMermaidApi(mermaid)
;(globalThis as typeof globalThis & { __vsidianCodexMermaid?: unknown }).__vsidianCodexMermaid = api
