// 编辑器页入口（票 #1 脚手架占位）：经 SDK 构建桥打成 chrome114 IIFE
// （dist/editor.js）。消费形态参照 vsidian test/examples 独立样例。
// bridge#3 在此扩展：sdk.renderers.register 注册 Mermaid 渲染提供者
// （Codex 亮暗色板 + ELK 布局），sdk.themeEnvironment 订阅明暗切换；
// bridge#2 的粘贴规则在宿主侧声明（enableCtx.paste.registerRules），
// 不经页面。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'ONEGAYI.vsidian-codex-bridge'

defineAddonPage(ADDON_ID, (_sdk: VsidianAddonPageSdk) => {
  // 脚手架空工厂：注册编辑器页入口即到此为止，无任何行为注册——
  // bridge#3 的渲染提供者与明暗订阅在此扩展
})
