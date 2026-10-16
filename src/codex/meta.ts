// Codex 主题元数据单一事实源（票 #3）：宿主 themes.register 声明与页面
// renderers.register 的 rendererId 同源于此——两侧身份不一致时主题目录
// 关联不到提供者（themeRef = `${addonId}/${themeId}`、providerId =
// `${addonId}/${rendererId}`，平台按 rendererId 组合关联）。
//
// 显示名对齐内核内置 Codex 主题的 i18n 文案（'Codex'，中英同名——
// vsidian src/shared/locales/{zh-cn,en}.ts 的 setting.mermaidTheme.codex）：
// 内核退役（vsidian#535）后用户在「外观 → 主题」看到同名组件主题，认知
// 连续。label 为直值（两语言同名，无需多语言映射）。
import type { AddonThemeDeclaration } from '../../types/vendor/shared/addonThemes'

/** 本组件声明的扩展 ID（宿主入口与页面入口同值，装载器按此核对身份） */
export const ADDON_ID = 'ONEGAYI.vsidian-codex-bridge'

/** Codex 主题关联的渲染提供者局部 ID（平台组合 providerId） */
export const CODEX_RENDERER_ID = 'codex-mermaid'

/** 渲染提供者显示名（AddonRendererProviderInfo.label 必填） */
export const CODEX_RENDERER_LABEL = 'Codex'

/** 宿主登记的 Codex 主题声明（enable 生命周期整批一条） */
export const CODEX_THEME_DECLARATION: AddonThemeDeclaration = {
  themeId: 'codex',
  label: 'Codex',
  rendererId: CODEX_RENDERER_ID,
  languages: ['mermaid'],
}
