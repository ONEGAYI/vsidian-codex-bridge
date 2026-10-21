// Codex 宿主侧 enable 装配（票 #3）：enable 生命周期的运行功能装配，
// 从 src/extension.ts 提出为独立模块——不依赖 vscode 运行时（仅 vendor
// type-only），登记契约测试可直驱。extension.ts 的 enable 回调调用本函数。
import type { AddonEnableContext } from '../../types/vendor/host/addons/addonRegistry'
import { ADDON_ID, CODEX_THEME_DECLARATION } from './meta'

/** enable 装配：编辑器页入口 + Codex 主题元数据登记 */
export function codexEnable(enableCtx: AddonEnableContext): void {
  // 编辑器页入口：dist/editor.js（IIFE）装载 Codex 渲染提供者
  // （sdk.renderers.register + themeEnvironment 订阅，见 page-editor.ts）。
  // resources 以安装目录根为 resourceUri 基址——loader 请求带 dist/ 前缀的
  // 相对路径（MERMAID_BUNDLE_PATH），缺此登记则 sdk.resourceUri 恒 null，
  // mermaid 独立产物无法装载、渲染恒降级「Mermaid 运行时不可用」（issue #7）
  enableCtx.pages.registerEditor({ entry: 'dist/editor.js', resources: ['.'] })
  // Codex 主题元数据登记（enable 注册按 addonId 整组替换；目录只增
  // 候选不自动切换——用户在「外观 → 主题」显式选择后生效）。普通 API
  // 拒绝（invalid-theme/duplicate-theme）不算组件故障：开发者日志留痕
  const themeResult = enableCtx.themes.register([CODEX_THEME_DECLARATION])
  if (!themeResult.ok) {
    console.warn(`[${ADDON_ID}] Codex 主题登记被拒绝（${themeResult.reason}）`)
  }
  enableCtx.onDispose(() => {
    // 运行释放回调：页面/主题登记随 enable 代次由平台回收，
    // 组件自有运行期资源在此注销
  })
}
