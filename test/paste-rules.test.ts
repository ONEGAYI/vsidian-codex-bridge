// Codex 粘贴还原规则契约（票 #2，TDD 先行）。断言对象是**组件产出的
// 声明数据与注册行为**，不是宿主转换器——HTML→Markdown 的命中/回退/
// 转义语义归 vsidian 侧测试（test/unit/htmlToMarkdownPasteRules.test.ts
// 与 test/browser/addonPasteRules.mjs，Codex 形态回放已在其内验证），
// 本文件钉住组件侧四组事实：
// 1) 声明式约束——规则是纯数据（JSON 可序列化、无任何函数属性）；
// 2) 识别面——票面当前属性形态（data-prompt-link-label +
//    data-prompt-link-href）与上游规格/测试中的历史变体形态
//    （data-prompt-link-url，单属性、label 取 span 文本）并存，变体
//    规则与上游已验证声明结构逐字段等价；
// 3) 产出形态——链接语法字符全部在模板字面（作者声明静态结构，不经
//    内置 escapeText——span 自身文本被丢弃，源码原文里的 `\[`、行首
//    `2\.` 类转义伤不再发生）；label 槽取属性（span 文本是 Markdown
//    源码原文，不能作 label）；url 槽 url:true 直取属性（空格/圆括号
//    编码与协议白名单归宿主 safeUrl，明文冒号透传供 `:行号` 锚点解
//    析——完整调研口径见 docs/adr/0002）；
// 4) 注册行为——enable 生命周期以本组件规则集为载荷注册；普通拒绝
//    （ok:false）不抛异常（降级底线：回落内置转换由宿主语义保证）；
//    成功后不提前 dispose（代次结束由平台撤回）。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { CODEX_PASTE_RULES, registerCodexPasteRules } from '../src/paste-rules'
import type { AddonPasteRulesContextApi } from '../types/vendor/host/addons/addonRegistry'
import type { AddonPasteRuleOutput } from '../types/vendor/shared/addonPasteRules'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 票面当前形态规则的稳定 ID（与变体形态共同排序：id 升序下本形态先行） */
const CURRENT_ID = 'codex-prompt-link'
/** 上游历史变体形态规则的稳定 ID */
const LEGACY_ID = 'codex-prompt-link-legacy-url'

// ---- 测试基建：递归无函数检查与 mock 注册面 ----

/** 递归断言 value 及全部后代不含函数（声明式规则的硬约束） */
function expectNoFunctions(value: unknown, where = 'root'): void {
  if (typeof value === 'function') {
    throw new Error(`${where} 是函数——声明式规则必须是纯数据`)
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectNoFunctions(item, `${where}[${index}]`))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      expectNoFunctions(child, `${where}.${key}`)
    }
  }
}

interface FacetCall {
  declarations: readonly unknown[]
}

/** mock 粘贴注册面：记录 registerRules 调用，返回既定结果 */
function mockPasteFacet(result: ReturnType<AddonPasteRulesContextApi['registerRules']>): {
  facet: AddonPasteRulesContextApi
  calls: FacetCall[]
  disposeCount: () => number
} {
  const calls: FacetCall[] = []
  let disposed = 0
  const ok = result.ok
  const facet: AddonPasteRulesContextApi = {
    registerRules(declarations) {
      calls.push({ declarations })
      if (ok) return { ok: true, dispose: () => { disposed += 1 } }
      return { ok: false, reason: result.reason, detail: 'detail' in result ? result.detail : undefined }
    },
  }
  return { facet, calls, disposeCount: () => disposed }
}

/** 便捷取输出槽类型收窄 */
function asTemplateOutput(output: AddonPasteRuleOutput): Extract<AddonPasteRuleOutput, { kind: 'template' }> {
  if (output.kind !== 'template') throw new Error(`期望 template 产出，实际 ${output.kind}`)
  return output
}

// ---- 1. 声明式约束：纯数据 ----

describe('Codex 粘贴还原规则：声明式约束（纯数据）', () => {
  it('规则集可 JSON 序列化且 round-trip 深等值（无函数/动态求值回调）', () => {
    const roundTrip = JSON.parse(JSON.stringify(CODEX_PASTE_RULES))
    expect(roundTrip).toEqual(CODEX_PASTE_RULES)
  })

  it('声明树内无任何函数属性（递归检查）', () => {
    expectNoFunctions(CODEX_PASTE_RULES)
  })
})

// ---- 2. 识别面：票面形态 + 上游历史变体 ----

describe('Codex 粘贴还原规则：识别面（票面形态 + 上游历史变体）', () => {
  it('票面形态：label + href 双属性存在性匹配（缺任一属性回内置）', () => {
    const rule = CODEX_PASTE_RULES.find((item) => item.id === CURRENT_ID)
    expect(rule, `规则 ${CURRENT_ID} 缺失`).toBeDefined()
    expect(rule!.match.tag).toBe('SPAN')
    const names = (rule!.match.attributes ?? []).map((condition) => condition.name)
    // 存在性条件（不带 value）：两属性都在场才命中——Codex 剪贴板同一
    // span 同时携带二者
    expect(names).toContain('data-prompt-link-label')
    expect(names).toContain('data-prompt-link-href')
    for (const condition of rule!.match.attributes ?? []) {
      expect(condition.value, '识别条件用存在性（不带值相等）').toBeUndefined()
    }
  })

  it('上游变体形态：与上游已验证声明逐字段等价（仅 id 不同）', () => {
    // 对照样本摘自 vsidian 浏览器契约套件 test/browser/addonPasteRules.mjs
    // 的 snapshotV1（fixture.paste-demo/prompt-link）——该声明在真实
    // Codex 形态回放（链接恢复、strong/code/pre 保持、分步撤销）中已
    // 被生产转换链验证。本组件变体规则必须与其结构等价，保证「宿主
    // 已验证可命中的形态」不被改写。
    const upstreamVerified = {
      match: { tag: 'SPAN', attributes: [{ name: 'data-prompt-link-url' }] },
      output: {
        kind: 'template',
        template: '[{{label}}]({{url}})',
        slots: {
          label: { source: { kind: 'text' } },
          url: { source: { kind: 'attribute', name: 'data-prompt-link-url' }, url: true },
        },
      },
    } as const
    const rule = CODEX_PASTE_RULES.find((item) => item.id === LEGACY_ID)
    expect(rule, `规则 ${LEGACY_ID} 缺失`).toBeDefined()
    expect(rule!.match).toEqual(upstreamVerified.match)
    expect(rule!.output).toEqual(upstreamVerified.output)
  })

  it('规则 ID 批内唯一、禁点号；同优先级下票面形态先行（id 升序）', () => {
    const ids = CODEX_PASTE_RULES.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).not.toContain('.')
    // 排序语义（宿主 orderAddonPasteRules：优先级降序、规则 ID 升序）
    // 下票面形态先于变体被尝试——两形态属性共存时以属性重建为准
    expect(CODEX_PASTE_RULES.every((rule) => rule.priority === undefined)).toBe(true)
    expect(ids.indexOf(CURRENT_ID)).toBeLessThan(ids.indexOf(LEGACY_ID))
    expect(CURRENT_ID < LEGACY_ID).toBe(true)
  })
})

// ---- 3. 产出形态：href 口径随宿主 ----

describe('Codex 粘贴还原规则：产出形态（链接结构零转义、href 口径随宿主）', () => {
  it('模板为 [{{label}}]({{url}})：链接语法字符全在模板字面（不经内置转义）', () => {
    for (const rule of CODEX_PASTE_RULES) {
      const output = asTemplateOutput(rule.output)
      expect(output.template).toBe('[{{label}}]({{url}})')
      // 方括号/圆括号是作者声明的静态 Markdown 结构（宿主对模板字面
      // 零转义）；span 自身文本（Markdown 源码原文）被整体丢弃——内置
      // 转义路径（\[、\]、行首 2\. 类列表标记转义）不再作用于该片段
      expect(output.template.startsWith('[')).toBe(true)
      expect(output.template).not.toContain('\\')
    }
  })

  it('label 槽取属性而非 span 文本（票面形态）——span 文本是源码原文不能作 label', () => {
    const rule = CODEX_PASTE_RULES.find((item) => item.id === CURRENT_ID)!
    const output = asTemplateOutput(rule.output)
    // 票面形态的 span 文本是 Markdown 源码原文（含 [label](href) 完整
    // 语法）；label 必须取 Codex 抽好的纯显示文本属性，取 text 会被
    // 内置 escapeText 打成 \[...\](...) 字面文本（本票要修的症状）
    expect(output.slots.label!.source).toEqual({ kind: 'attribute', name: 'data-prompt-link-label' })
    expect(output.slots.label!.url).toBeUndefined()
  })

  it('url 槽 url:true 且为 attribute 直取（零预加工——编码/白名单归宿主 safeUrl）', () => {
    for (const rule of CODEX_PASTE_RULES) {
      const output = asTemplateOutput(rule.output)
      const urlSlot = output.slots.url!
      // 直取属性（source 是 attribute 而非 attribute-regex）：含空格与
      // `:行号` 的 href 不做任何预编码——空格→%20、圆括号→%28/%29、
      // 协议白名单全部由宿主 safeUrl 统一处理，明文冒号透传（行号锚
      // 点解析只认明文冒号，%3A 不剥——vsidian#534 口径）
      expect(urlSlot.source.kind).toBe('attribute')
      expect(urlSlot.url).toBe(true)
    }
    const current = asTemplateOutput(CODEX_PASTE_RULES.find((item) => item.id === CURRENT_ID)!.output)
    expect((current.slots.url!.source as { name: string }).name).toBe('data-prompt-link-href')
    const legacy = asTemplateOutput(CODEX_PASTE_RULES.find((item) => item.id === LEGACY_ID)!.output)
    expect((legacy.slots.url!.source as { name: string }).name).toBe('data-prompt-link-url')
  })
})

// ---- 4. 真实样本回放核对（声明侧）----

describe('Codex 粘贴还原规则：真实剪贴板样本回放核对（声明侧）', () => {
  /**
   * 声明侧回放核对：对上游规格/测试中的真实 Codex 剪贴板样本，逐条
   * 核对「命中条件的属性都在场 + 槽取值的来源可满足」。转换产出（含
   * safeUrl 编码与格式保留）归宿主测试，此处不复制宿主语义——期望
   * Markdown 仅为上游浏览器套件已验证的对照串（无空格 URL 下模板
   * 渲染与宿主产出逐字符一致）。
   */
  const samples: Array<{
    name: string
    spanHtml: string
    expectHit: string
    expectedMarkdown: string
  }> = [
    {
      // 上游浏览器套件双载荷样本（test/browser/addonPasteRules.mjs）：
      // 链接恢复 + 邻接 strong/code/pre 保持原格式（P-U03）
      name: '上游双载荷样本（链接 + strong/code/pre 混排）',
      spanHtml: '<span data-prompt-link-url="https://example.com/doc">文档链接</span>',
      expectHit: LEGACY_ID,
      expectedMarkdown: '[文档链接](https://example.com/doc)',
    },
    {
      name: '票面形态样本（label + href 属性，span 文本为源码原文）',
      spanHtml:
        '<span data-prompt-link-label="修复清单" data-prompt-link-href="notes/fixes.md">[修复清单](notes/fixes.md)</span>',
      expectHit: CURRENT_ID,
      expectedMarkdown: '[修复清单](notes/fixes.md)',
    },
  ]

  it('样本命中核对：命中规则的全部识别条件与槽来源在样本属性集中可满足', () => {
    for (const sample of samples) {
      const rule = CODEX_PASTE_RULES.find((item) => item.id === sample.expectHit)
      expect(rule, `${sample.name}：规则 ${sample.expectHit} 缺失`).toBeDefined()
      // 抽取样本 span 的 data-* 属性名集合（最小核对，不建通用匹配器）
      const attributeNames = new Set([...sample.spanHtml.matchAll(/data-[a-z-]+=/g)].map((m) => m[0].slice(0, -1)))
      for (const condition of rule!.match.attributes ?? []) {
        expect(attributeNames.has(condition.name), `${sample.name}：缺识别属性 ${condition.name}`).toBe(true)
      }
      const output = asTemplateOutput(rule!.output)
      for (const slot of Object.values(output.slots)) {
        if (slot.source.kind === 'attribute') {
          expect(attributeNames.has(slot.source.name), `${sample.name}：label/url 槽来源属性 ${slot.source.name} 缺失`).toBe(true)
        } else if (slot.source.kind === 'text') {
          const text = sample.spanHtml.replace(/<[^>]+>/g, '')
          expect(text.length, `${sample.name}：text 槽来源为空（必需取值缺失会回内置）`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('无空格 URL 的模板渲染与上游已验证产出逐字符一致（链接还原正确）', () => {
    for (const sample of samples) {
      const rule = CODEX_PASTE_RULES.find((item) => item.id === sample.expectHit)!
      const output = asTemplateOutput(rule.output)
      // 按声明语义手工渲染模板（样本 URL 无空格/圆括号，宿主 safeUrl
      // 为恒等——上游浏览器套件 waitBoth 已验证同一字符串）
      const text = sample.spanHtml.replace(/<[^>]+>/g, '')
      const attributes = new Map(
        [...sample.spanHtml.matchAll(/(data-[a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]] as const),
      )
      const rendered = output.template
        .replace('{{label}}', () => {
          const source = output.slots.label!.source
          return source.kind === 'attribute' ? attributes.get(source.name)! : text
        })
        .replace('{{url}}', () => {
          const source = output.slots.url!.source as { kind: string; name?: string }
          return source.kind === 'attribute' ? attributes.get(source.name!)! : ''
        })
      expect(rendered).toBe(sample.expectedMarkdown)
    }
  })
})

// ---- 5. 预算合规 ----

describe('Codex 粘贴还原规则：预算字段合规', () => {
  it('规则数 ≤256、零嵌套子规则、零条件树、零正则（求值开销最小面）', () => {
    // 宿主预算：每组件至多 256 条（含嵌套合计）、条件与嵌套各至多 16
    // 层、正则 pattern ≤1024 字符。本组件两条顶层规则、无高级节点——
    // 距离一切预算上限最远，且注册校验（invalid-declaration）无由触发
    expect(CODEX_PASTE_RULES.length).toBeLessThanOrEqual(256)
    expect(CODEX_PASTE_RULES.length).toBe(2)
    for (const rule of CODEX_PASTE_RULES) {
      expect(rule.match.condition).toBeUndefined()
      expect((rule.match.attributes ?? []).length).toBeLessThanOrEqual(8)
      const output = asTemplateOutput(rule.output)
      for (const slot of Object.values(output.slots)) {
        expect(slot.source.kind === 'children' || slot.source.kind === 'text-regex' || slot.source.kind === 'attribute-regex')
          .toBe(false)
      }
    }
  })
})

// ---- 6. 注册行为（enable 生命周期 + 降级底线）----

describe('Codex 粘贴还原规则：注册行为', () => {
  it('以本组件规则集为载荷注册（声明数据原样透传）', () => {
    const { facet, calls } = mockPasteFacet({ ok: true, dispose: () => {} })
    const result = registerCodexPasteRules(facet)
    expect(calls.length).toBe(1)
    expect(calls[0]!.declarations).toEqual(CODEX_PASTE_RULES)
    expect(result.ok).toBe(true)
  })

  it('普通拒绝（ok:false）不抛异常——降级底线：回落内置转换由宿主语义保证', () => {
    // 拒绝枚举覆盖：invalid-declaration / duplicate-id / too-many /
    // released。普通 API 拒绝不算组件故障（规格 §4.3-4.4），组件侧
    // 不得把拒绝升级为异常破坏宿主 enable 生命周期
    for (const reason of ['invalid-declaration', 'duplicate-id', 'too-many', 'released'] as const) {
      const { facet } = mockPasteFacet({ ok: false, reason })
      expect(() => registerCodexPasteRules(facet), `拒绝 ${reason} 不得抛异常`).not.toThrow()
      expect(registerCodexPasteRules(facet)).toEqual({ ok: false, reason })
    }
  })

  it('注册成功后不提前 dispose——代次结束由平台撤回', () => {
    // 宿主语义：停用/故障/单组释放/代次结束均由平台撤回相应规则；上游
    // 集成夹具（addon-paste-rules/extension.js）同样不在 onDispose 里
    // 主动 dispose——组件不复制平台生命周期职责
    const { facet, disposeCount } = mockPasteFacet({ ok: true, dispose: () => {} })
    registerCodexPasteRules(facet)
    expect(disposeCount()).toBe(0)
  })
})

// ---- 7. 宿主入口接线 ----

describe('Codex 粘贴还原规则：宿主入口接线', () => {
  it('extension.ts 的 enable 生命周期内调用注册（源码契约）', () => {
    const text = readFileSync(path.join(repoRoot, 'src/extension.ts'), 'utf8')
    // enable（运行装配）阶段注册——对齐规格「规则在扩展宿主运行功能
    // 阶段登记」；setup（常驻设置）不注册（停用后不留有效规则）
    expect(text).toContain('registerCodexPasteRules(enableCtx.paste)')
  })

  it('页面入口不因粘贴规则启用——声明式规则无需页面代码', () => {
    // 规则在宿主登记、广播到页面、在既有 HTML→Markdown 遍历中消费，
    // 组件无需提供任何页面脚本逻辑；dist/editor.js 空工厂占位（bridge#3
    // 渲染提供者才需要页面入口）。断言工厂体内无任何 sdk 注册调用。
    const text = readFileSync(path.join(repoRoot, 'src/page-editor.ts'), 'utf8')
    const factoryBody = text.slice(text.indexOf('defineAddonPage('))
    expect(factoryBody).not.toMatch(/\b_sdk?\.[a-zA-Z]+/)
    expect(factoryBody).not.toContain('registerRules')
  })
})
