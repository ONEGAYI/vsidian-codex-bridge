// vendored from ONEGAYI/vsidian@301d2c162a25f1e34c90cb54f74a26cdc2fbee7e — src/shared/addonThemes.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

import type { LocalizedText } from './localizedText'

/** 组件侧多语言文本形态（与设置定义/行为名同构——直值或语言映射） */
export type AddonThemeLocalizedText = LocalizedText

/** 组件声明的一个主题（enable 注册载荷的可序列化形状） */
export interface AddonThemeDeclaration {
  /** 组件内稳定主题 ID（非空；与组件 ID 组成持久主题身份 themeRef） */
  themeId: string
  /** 多语言显示名（直值或语言映射，全链路透传不预解析——渲染时按页面语言选值） */
  label: AddonThemeLocalizedText
  /** 关联的本组件渲染提供者（局部 rendererId；平台组合 providerId，不能跨组件） */
  rendererId: string
  /** 主题对该提供者生效的语言（trim 后全等口径，与 RENDERED_FENCE_LABELS 同源） */
  languages: readonly string[]
}

/** 宿主目录条目（声明 + 归属组件注入） */
export interface AddonThemeCandidate {
  addonId: string
  themeId: string
  /** 稳定主题身份：`${addonId}/${themeId}`（持久首选与目录寻址键） */
  themeRef: string
  label: AddonThemeLocalizedText
  rendererId: string
  /** 稳定提供者 ID：`${addonId}/${rendererId}` */
  providerId: string
  languages: readonly string[]
}

/** 主题选择解析输入 */
export interface AddonThemeSelectionInput {
  /** 宿主目录全集 */
  themes: readonly AddonThemeCandidate[]
  /** 用户唯一首选（resolveThemePreferred 的产物：default / codex / themeRef） */
  preferred: string
  /** 目录条目可用性（组件 enabled 且未故障；候选是否已上报由渲染选择层另行判定） */
  isThemeAvailable: (theme: AddonThemeCandidate) => boolean
}

/** 主题选择解析结果 */
export interface AddonThemeSelection {
  /** 原样保留的首选（不可用不清除——恢复后按原选择继续） */
  preferred: string
  /** 首选组件主题当前是否可用（default/codex 恒 true） */
  available: boolean
  /** 实际生效主题（回落后）：default / codex / themeRef */
  effective: string
  /** 生效主题关联的提供者 ID（仅组件主题生效时在场；渲染选择层注入） */
  activeProviderId?: string
  /** 选中主题声明的语言；提供者支持的额外语言不会随主题一并接管 */
  activeLanguages?: readonly string[]
}

// ---- 页面明暗环境（编辑器页 SDK 只读面） ----

/**
 * VSCode 实际生效主题四态（vscode.ColorThemeKind 的可序列化投影）。
 * 状态来源是实际生效主题——手动固定暗色时系统变亮仍为暗；跟随系统时
 * 随系统变化（由宿主事件驱动）。
 */
export type AddonThemeEnvironmentKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light'

/** 明暗快照（四态两轴投影；亮色高对比 ≠ 暗） */
export interface AddonThemeEnvironment {
  /** 暗色：dark 与暗色高对比为 true；亮色与亮色高对比为 false */
  readonly dark: boolean
  /** 高对比：两种高对比形态为 true */
  readonly highContrast: boolean
}

/** SDK 只读面（仅编辑器页提供）：同步快照 + 变化订阅（重复值不通知；
 *  代次释放自动退订；通知在页面缓存更新后送达——回调中 get 拿新值） */
export interface AddonThemeEnvironmentFacet {
  get(): AddonThemeEnvironment
  onChange(listener: (env: AddonThemeEnvironment) => void): () => void
}

// ---- 目录载荷（宿主 → 设置页） ----

/** 目录条目可用性标注（设置页呈现「不可用/回落」状态的判据） */
export interface AddonThemeEntryState extends AddonThemeCandidate {
  /** 归属组件当前可用（enabled 且未故障） */
  available: boolean
}

/** 宿主 → 设置页的主题目录状态载荷 */
export interface AddonThemesStatePayload {
  /** 目录代次（内容变化才递增；设置页等值跳过） */
  version: number
  /** 组件主题目录（含不可用条目——呈现不可用状态而非隐藏） */
  themes: readonly AddonThemeEntryState[]
  /** 当前唯一首选（resolveThemePreferred 产物；不可用时保留） */
  preferred: string
  /** 首选组件主题当前可用（default/codex 恒 true） */
  preferredAvailable: boolean
}

// ---- enable 生命周期注册面 ----

/** 主题注册结果：ok=false 时 dispose 为 no-op（登记校验与批内重复拒绝属普通 API 结果，不算组件故障） */
export type AddonThemeRegisterOutcome =
  | { ok: true; dispose(): void }
  | { ok: false; reason: 'invalid-theme' | 'duplicate-theme'; dispose(): void }

/** enable 上下文的主题注册面（组件宿主代码声明主题元数据——目录与
 *  选择归平台，实际渲染执行仍归页面 renderers 注册） */
export interface AddonThemesRegistrationFacet {
  register(declarations: readonly unknown[]): AddonThemeRegisterOutcome
}
