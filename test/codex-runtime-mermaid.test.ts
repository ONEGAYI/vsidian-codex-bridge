// @vitest-environment jsdom
// 真实 mermaid 运行时回归（PR #5 审查 P1/P2）：不 mock mermaid 内部逻辑，
// 直接 import 本仓锁定的 mermaid@11.12.2 与 @mermaid-js/layout-elk@0.2.0
// （devDependencies 与产物同版本线），jsdom 仅补 SVG 几何测量——无布局
// 引擎下 getBBox 等返回固定值，渲染管线即可走通（对齐审查复现验证方式）。
//
// 覆盖两组审查实证的回归形态：
// - P1 并发配置串扰：一屏多图并发 mount（sequence→flowchart→pie）时后图
//   initialize 覆盖前图尚未消费的全局配置——中间流程图丢失 Codex 圆角/
//   边框；并发同图型异明暗（pie dark/dark/light）时第二张输出白背景。
// - P2 错误 SVG 遗留：mermaid 解析失败时向 document.body 插入错误图
//   临时根（d<id>）再 reject，组件不清理则 mount+refresh 后 body 残留。
import { beforeAll, describe, expect, it } from 'vitest'
import mermaid from 'mermaid'
import elkLayouts from '@mermaid-js/layout-elk'
import { createCodexMermaidApi } from '../src/codex/runtime'
import { createCodexRenderer } from '../src/codex/renderer'

const SITE_CONFIG: Record<string, unknown> = {
  securityLevel: 'strict',
  startOnLoad: false,
  theme: 'default',
}

const CODE_FLOWCHART = 'flowchart TD\n  A[开始] --> B{判断}\n  B -->|是| C[处理]\n  B -->|否| D[结束]'
const CODE_SEQUENCE = 'sequenceDiagram\n  participant U as 用户\n  participant S as 服务\n  U->>S: 请求\n  S-->>U: 响应'
const CODE_PIE = 'pie showData\n  "A 类" : 45\n  "B 类" : 55'

beforeAll(() => {
  // flowchart 的 Codex 预设 layout:'elk'——与产物入口（mermaid-entry.ts）
  // 同款注册，否则 ELK 布局器缺失渲染失败
  mermaid.registerLayoutLoaders(elkLayouts)
  // jsdom 无布局引擎：补 SVG 测量 API（mermaid 文本测量依赖 getBBox /
  // getComputedTextLength / getTotalLength，返回固定值即可走通管线）
  const proto = SVGElement.prototype as SVGElement & {
    getBBox?: () => DOMRectInit
    getComputedTextLength?: () => number
    getTotalLength?: () => number
  }
  proto.getBBox = function getBBox() {
    return { x: 0, y: 0, width: 120, height: 36 }
  }
  proto.getComputedTextLength = function getComputedTextLength() {
    return 96
  }
  proto.getTotalLength = function getTotalLength() {
    return 64
  }
})

/** body 中 mermaid 渲染临时根（d<id> 容器）残留检测 */
function leftoverTempRoots(): string[] {
  return [...document.body.children]
    .map((el) => el.id)
    .filter((id) => id.startsWith('d'))
}

/** 微任务 flush：真实 mermaid 渲染链多级 await，轮询直至谓词成立 */
async function flushUntil(predicate: () => boolean, rounds = 200): Promise<void> {
  for (let i = 0; i < rounds && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(predicate(), 'flushUntil 谓词未在限定轮数内成立').toBe(true)
}

describe('真实 mermaid：并发配置隔离（P1——串行队列保护配置与渲染）', () => {
  it('并发多图型（sequence→flowchart→pie）：中间流程图保留 Codex 圆角/边框配置', async () => {
    const api = createCodexMermaidApi(mermaid)
    api.initialize(SITE_CONFIG)
    // 用户复现形态：三图并发 render（不 await 前一张），断言中间的
    // flowchart 产物仍带 Codex themeCSS（rx:16px 圆角矩形）——修复前
    // 后图 initialize 会覆盖前图尚未消费的全局配置
    const [seq, flow, pie] = await Promise.all([
      api.render('concave-seq', CODE_SEQUENCE, false),
      api.render('concave-flow', CODE_FLOWCHART, false),
      api.render('concave-pie', CODE_PIE, false),
    ])
    expect(seq.svg).toContain('<svg')
    expect(pie.svg).toContain('<svg')
    expect(flow.svg, '中间流程图丢失 Codex 圆角配置（themeCSS rx:16px）').toContain('rx:16px')
  })

  it('并发同图型异明暗（pie dark/dark/light）：第二张暗色图背景不被明色图串扰', async () => {
    const api = createCodexMermaidApi(mermaid)
    api.initialize(SITE_CONFIG)
    // 用户复现形态：顺序 dark/dark/light 并发，修复前第二张 dark 输出
    // 白背景 #ffffff（应为 #181818）
    const [a, b, c] = await Promise.all([
      api.render('pie-d1', CODE_PIE, true),
      api.render('pie-d2', CODE_PIE, true),
      api.render('pie-l1', CODE_PIE, false),
    ])
    expect(a.svg, '第一张暗色 pie 背景应为 #181818').toContain('background-color:#181818')
    expect(b.svg, '第二张暗色 pie 背景被明色图串扰为 #ffffff').toContain('background-color:#181818')
    expect(c.svg, '第三张明色 pie 背景应为 #ffffff').toContain('background-color:#ffffff')
  })

  it('串行队列不牺牲正确性：同一段落内顺序 render 的配置逐图独立', async () => {
    const api = createCodexMermaidApi(mermaid)
    api.initialize(SITE_CONFIG)
    const dark = await api.render('seq-flow-dark', CODE_FLOWCHART, true)
    const light = await api.render('seq-flow-light', CODE_FLOWCHART, false)
    expect(dark.svg).toContain('background-color:#181818')
    expect(light.svg).toContain('background-color:#ffffff')
  })
})

describe('真实 mermaid：语法错误不遗留临时根（P2——结果只进本容器）', () => {
  it('坏源码 render reject 且 body 无 d<id> 临时根残留', async () => {
    const api = createCodexMermaidApi(mermaid)
    api.initialize(SITE_CONFIG)
    // 用户复现源码：flowchart 语句未闭合（A--> 后无目标节点）
    const badCode = 'flowchart TD\n A-->'
    await expect(api.render('bad-1', badCode, false)).rejects.toThrow()
    expect(leftoverTempRoots(), 'mermaid 错误 SVG 临时根遗留 body').toEqual([])
  })

  it('多次失败渲染（mount+refresh 形态）后 body 仍无残留', async () => {
    const api = createCodexMermaidApi(mermaid)
    api.initialize(SITE_CONFIG)
    const badCode = 'flowchart TD\n A-->'
    for (let i = 0; i < 3; i++) {
      await expect(api.render(`bad-r${i}`, badCode, false)).rejects.toThrow()
    }
    expect(leftoverTempRoots(), '重复失败渲染后 body 累积临时根').toEqual([])
  })

  it('失败后成功渲染不受影响（错误路径不污染后续管线）', async () => {
    const api = createCodexMermaidApi(mermaid)
    api.initialize(SITE_CONFIG)
    await expect(api.render('bad-then-ok-1', 'flowchart TD\n A-->', false)).rejects.toThrow()
    const { svg } = await api.render('bad-then-ok-2', CODE_PIE, true)
    expect(svg).toContain('background-color:#181818')
    expect(leftoverTempRoots()).toEqual([])
  })
})

describe('真实 mermaid × 渲染提供者端到端（mount / 主题重绘 / exportSvg）', () => {
  function makeRenderer() {
    const api = createCodexMermaidApi(mermaid)
    api.initialize(SITE_CONFIG)
    return createCodexRenderer({
      loadApi: async () => api,
      getEnv: () => ({ dark: false, highContrast: false }),
    })
  }

  function mountAll(renderer: ReturnType<typeof makeRenderer>, codes: string[]): HTMLElement[] {
    const containers = codes.map((code) => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      renderer.mount(el, code, { language: 'mermaid', mode: 'reading' })
      return el
    })
    return containers
  }

  it('一屏三图并发 mount：各容器拿到各自的 Codex 配置，中间流程图圆角在场', async () => {
    const renderer = makeRenderer()
    const [seqEl, flowEl, pieEl] = mountAll(renderer, [CODE_SEQUENCE, CODE_FLOWCHART, CODE_PIE])
    await flushUntil(() =>
      [seqEl, flowEl, pieEl].every((el) => el.getAttribute('data-vscx-state') === 'rendered'),
    )
    expect(seqEl.querySelector('svg')).not.toBeNull()
    expect(pieEl.querySelector('svg')).not.toBeNull()
    expect(flowEl.innerHTML, '中间流程图丢失 Codex 圆角配置').toContain('rx:16px')
    expect(leftoverTempRoots()).toEqual([])
  })

  it('主题重绘（onThemeChange）走同一队列：并发重渲染暗色背景逐图正确', async () => {
    const renderer = makeRenderer()
    const containers = mountAll(renderer, [CODE_PIE, CODE_PIE, CODE_FLOWCHART])
    await flushUntil(() => containers.every((el) => el.getAttribute('data-vscx-state') === 'rendered'))
    renderer.onThemeChange({ dark: true, highContrast: false })
    await flushUntil(() =>
      containers.every((el) => el.getAttribute('data-vscx-state') === 'rendered' && el.innerHTML.includes('#181818')),
    )
    expect(leftoverTempRoots()).toEqual([])
  })

  it('exportSvg 与 mount 并发：导出产物带本图明暗背景', async () => {
    const renderer = makeRenderer()
    const [flowEl] = mountAll(renderer, [CODE_FLOWCHART])
    const exported = renderer.exportSvg!(CODE_PIE, 'mermaid')
    await flushUntil(() => flowEl.getAttribute('data-vscx-state') === 'rendered')
    const svg = await exported
    expect(svg).toContain('background-color:#ffffff')
    expect(flowEl.innerHTML).toContain('rx:16px')
    expect(leftoverTempRoots()).toEqual([])
  })
})
