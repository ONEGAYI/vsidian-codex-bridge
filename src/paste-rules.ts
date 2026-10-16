// Codex 粘贴还原规则声明（票 #2）：识别 Codex 聊天剪贴板里的
// data-prompt-link-* span，还原为标准 `[label](href)` Markdown 链接。
//
// 声明式约束：本模块只产出**纯数据**（可序列化、无函数）——宿主在
// 富文本粘贴的 HTML→Markdown 遍历中消费规则（vsidian#530/#541），
// 组件不参与转换执行。href 产出口径（零预加工，编码/白名单归宿主
// safeUrl，明文冒号透传供 `:行号` 锚点解析）与旧属性形态兼容的调研
// 结论见 docs/adr/0002。
//
// 两条规则按宿主确定性排序（优先级缺省 0、规则 ID 升序）先后尝试：
// 票面当前形态先行——两形态属性共存时以 label/href 属性重建为准。
import type { AddonPasteRulesContextApi } from '../types/vendor/host/addons/addonRegistry'
import type {
  AddonPasteRuleDeclaration,
  AddonPasteRulesRegisterResult,
} from '../types/vendor/shared/addonPasteRules'

/**
 * Codex 粘贴还原规则集（enable 生命周期注册）。
 *
 * - `codex-prompt-link`（票面当前形态）：span 同时携带
 *   `data-prompt-link-label` + `data-prompt-link-href` 属性；label 从
 *   属性取——span 文本是 Markdown 源码原文（含 `[label](href)` 完整
 *   语法），作 label 会被内置转义打成 `\[...\](...)` 字面文本（本票
 *   要修的症状），故不取 text。
 * - `codex-prompt-link-legacy-url`（上游历史变体形态）：单
 *   `data-prompt-link-url` 属性、label 取 span 文本——与上游集成夹具
 *   （test/integration/addonFixtures/addon-paste-rules）及浏览器契约
 *   套件快照（test/browser/addonPasteRules.mjs snapshotV1）的已验证
 *   声明逐字段等价，识别面向后兼容。
 *
 * 链接语法字符（`[]()`）全部在模板字面：宿主对模板字面零转义（作者
 * 声明的静态 Markdown 结构），span 自身文本被整体丢弃——内置转义
 * 路径（`\[`、行首 `2\.` 类列表标记转义）不再作用于该片段。
 */
export const CODEX_PASTE_RULES: readonly AddonPasteRuleDeclaration[] = [
  {
    id: 'codex-prompt-link',
    match: {
      tag: 'SPAN',
      attributes: [
        { name: 'data-prompt-link-label' },
        { name: 'data-prompt-link-href' },
      ],
    },
    output: {
      kind: 'template',
      template: '[{{label}}]({{url}})',
      slots: {
        label: { source: { kind: 'attribute', name: 'data-prompt-link-label' } },
        url: { source: { kind: 'attribute', name: 'data-prompt-link-href' }, url: true },
      },
    },
  },
  {
    id: 'codex-prompt-link-legacy-url',
    match: {
      tag: 'SPAN',
      attributes: [{ name: 'data-prompt-link-url' }],
    },
    output: {
      kind: 'template',
      template: '[{{label}}]({{url}})',
      slots: {
        label: { source: { kind: 'text' } },
        url: { source: { kind: 'attribute', name: 'data-prompt-link-url' }, url: true },
      },
    },
  },
]

/**
 * 注册 Codex 粘贴还原规则（enable 生命周期；页面侧无需代码）。
 *
 * 降级底线：普通 API 拒绝（invalid-declaration / duplicate-id /
 * too-many / released）不算组件故障（规格 §4.3-4.4）——只记录开发者
 * 诊断信息、不抛异常，宿主回落内置转换；注册成功后不提前 dispose，
 * 停用/故障/代次结束由平台撤回相应规则（对齐上游集成夹具形态）。
 */
export function registerCodexPasteRules(paste: AddonPasteRulesContextApi): AddonPasteRulesRegisterResult {
  const result = paste.registerRules(CODEX_PASTE_RULES)
  if (!result.ok) {
    console.warn(
      `vsidian-codex-bridge: paste rules rejected (${result.reason}${result.detail === undefined ? '' : `: ${result.detail}`}) — falling back to built-in conversion`,
    )
  }
  return result
}
