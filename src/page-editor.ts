// 编辑器页入口（票 #3）：经 SDK 构建桥打成 chrome114 IIFE
// （dist/editor.js）。装配 Codex Mermaid 主题渲染提供者：
// - sdk.renderers.register 登记 mermaid 语言提供者（live+reading 双模式、
//   SVG 导出）——宿主目录经 enableCtx.themes.register 关联本提供者
//   （themeId 'codex' ↔ rendererId 'codex-mermaid'，单一事实源 meta.ts）；
// - sdk.themeEnvironment 订阅 VSCode 实际生效主题的明暗变化（四态两轴
//   投影），回调直连 renderer.onThemeChange 重渲染已挂载图形；
// - mermaid 运行时不进本 IIFE：dist/mermaid.js 独立 esm 产物经
//   sdk.resourceUri + loader.ts 按需装载（ADR-0003）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { ADDON_ID } from './codex/meta'
import { loadCodexMermaidApi } from './codex/loader'
import { createCodexRenderer } from './codex/renderer'

/** 页面工厂（导出供装配契约测试直驱；defineAddonPage 登记同一函数） */
export function codexPageFactory(sdk: VsidianAddonPageSdk): void {
  const renderers = sdk.renderers
  const themeEnvironment = sdk.themeEnvironment
  if (!renderers) {
    throw new Error('编辑器页 SDK 缺少 renderers 面')
  }
  if (!themeEnvironment) {
    throw new Error('编辑器页 SDK 缺少 themeEnvironment 面')
  }

  const renderer = createCodexRenderer({
    loadApi: () => loadCodexMermaidApi((relativePath) => sdk.resourceUri(relativePath)),
    getEnv: () => themeEnvironment.get(),
  })
  renderers.register(renderer)

  const unsubscribe = themeEnvironment.onChange((env) => renderer.onThemeChange(env))
  sdk.onDispose(() => {
    unsubscribe()
  })
}

defineAddonPage(ADDON_ID, codexPageFactory)
