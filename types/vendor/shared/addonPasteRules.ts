// vendored from ONEGAYI/vsidian@301d2c162a25f1e34c90cb54f74a26cdc2fbee7e — src/shared/addonPasteRules.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** 属性匹配条件：缺 value = 存在性要求；value = 值相等（空串合法） */
export interface AddonPasteRuleAttributeCondition {
  readonly name: string
  readonly value?: string
}

/** 正则声明：数据形态 pattern 与受限 flags（注册时编译校验，不执行字符串代码） */
export interface AddonPasteRegex {
  readonly pattern: string
  readonly flags?: string
}

/** 条件叶子谓词：属性存在/相等（基础谓词）或正则谓词（属性值/元素文本） */
export type AddonPastePredicate =
  | { readonly kind: 'attribute'; readonly name: string; readonly value?: string }
  | { readonly kind: 'attribute-regex'; readonly name: string; readonly regex: AddonPasteRegex }
  | { readonly kind: 'text-regex'; readonly regex: AddonPasteRegex }

/** 条件组合节点：all/any/not（空组合与非法节点在注册时拒绝） */
export type AddonPasteCondition =
  | { readonly all: readonly AddonPasteConditionNode[] }
  | { readonly any: readonly AddonPasteConditionNode[] }
  | { readonly not: AddonPasteConditionNode }

/** 条件树节点：叶子谓词或组合节点 */
export type AddonPasteConditionNode = AddonPastePredicate | AddonPasteCondition

/** 匹配：标签名相等 + 属性条件全与 + 可选条件树（三处同时满足才匹配） */
export interface AddonPasteRuleMatch {
  /** 标签名（大写形态与 DOM tagName 对齐；校验时规整） */
  readonly tag: string
  /** 属性条件列表（全部满足才匹配；至多 8 条） */
  readonly attributes?: readonly AddonPasteRuleAttributeCondition[]
  /** 条件树（#542 T02；根可为组合节点或叶子谓词，与 attributes 全与组合） */
  readonly condition?: AddonPasteConditionNode
}

/**
 * 嵌套规则（children 槽子规则集成员；与顶层规则同一声明语言，id 为槽内
 * 局部）。作者声明形态：priority 可选（缺省 0，排序语义同顶层规则）。
 */
export interface AddonPasteNestedRule {
  /** 槽内局部规则 ID（同集合内唯一；不与顶层或其他集合冲突） */
  readonly id: string
  /** 可选整数优先级（缺省 0；子集内按优先级降序、ID 升序） */
  readonly priority?: number
  readonly match: AddonPasteRuleMatch
  readonly output: AddonPasteRuleOutput
}

/** 槽取值来源：元素文本 / 指定属性 / 子内容转换结果 / 正则捕获组 */
export type AddonPasteSlotSource =
  | { readonly kind: 'text' }
  | { readonly kind: 'attribute'; readonly name: string }
  | {
    /** 子内容转换结果；rules 声明嵌套子规则集（先子规则后内置，仅沿子节点下降） */
    readonly kind: 'children'
    readonly rules?: readonly AddonPasteNestedRule[]
  }
  | { readonly kind: 'text-regex'; readonly regex: AddonPasteRegex; readonly group: number | string }
  | { readonly kind: 'attribute-regex'; readonly name: string; readonly regex: AddonPasteRegex; readonly group: number | string }

/** 模板槽：url=true 经现有 safeUrl 策略（children 来源无 URL 语义，拒绝） */
export interface AddonPasteSlot {
  readonly source: AddonPasteSlotSource
  readonly url?: boolean
}

/** 产出：Markdown 结构模板或显式丢弃（空产出只有显式丢弃才算成功） */
export type AddonPasteRuleOutput =
  | {
    readonly kind: 'template'
    /** 模板中的 {{name}} 引用槽；字面部分是作者声明的静态 Markdown 结构 */
    readonly template: string
    readonly slots: Readonly<Record<string, AddonPasteSlot>>
  }
  | { readonly kind: 'discard' }

/** 作者提交的规则声明（来源组件与代次由平台注入，声明不带身份字段） */
export interface AddonPasteRuleDeclaration {
  /** 组件内稳定规则 ID（禁点号——不伪造跨组件身份） */
  readonly id: string
  /** 可选整数优先级（缺省 0；排序见 orderAddonPasteRules） */
  readonly priority?: number
  readonly match: AddonPasteRuleMatch
  readonly output: AddonPasteRuleOutput
}

/** 校验通过的基础规则（addonId 由宿主注入） */
export interface AddonPasteRule {
  readonly addonId: string
  readonly id: string
  readonly priority: number
  readonly match: AddonPasteRuleMatch
  readonly output: AddonPasteRuleOutput
}

/** 注册结果（普通 API 拒绝不算组件故障；dispose 重复调用无害） */
export type AddonPasteRulesRegisterResult =
  | { ok: true; dispose(): void }
  | { ok: false; reason: 'invalid-declaration' | 'duplicate-id' | 'too-many' | 'released'; detail?: string }

/** 校验上下文：现有递归声明总数与已占用 ID（重复与超预算判定用） */
export interface AddonPasteRuleValidationContext {
  existingIds?: ReadonlySet<string>
  /** 既有规则的递归声明总数（顶层 + 嵌套子规则合计；宿主按此口径传入） */
  currentCount?: number
}

export type AddonPasteRuleValidationResult =
  | { ok: true; rules: readonly Omit<AddonPasteRule, 'addonId'>[] }
  | { ok: false; reason: 'invalid-declaration' | 'duplicate-id' | 'too-many'; detail?: string }

/** 模板切片：字面量或槽引用 */
export type AddonPasteTemplatePart = { literal: string } | { slot: string }

/** 广播到编辑器页面的有效规则快照（version 单调递增，内容等值不递增） */
export interface AddonPasteRulesSnapshot {
  readonly version: number
  readonly rules: readonly AddonPasteRule[]
}
