// Codex 运行时包装契约（票 #3）：createCodexMermaidApi 包装真实 mermaid
// （包装体打进独立 esm 产物，本测试注入 mock 验证协议）：
// - 图内显式配置优先：源码逐字节透传给 mermaid.render——frontmatter
//   （init 配置）、classDef、style 全部由 mermaid 自身解析并覆盖站点
//   配置，包装层不做任何改写/剥离（对齐内核 mermaidEntry 口径「预设
//   不改写源码」）；
// - 每图先恢复站点 baseConfig，再按 detectType 结果叠加 Codex 预设；
//   白名单外类型只恢复、不叠加；
// - 明暗由调用方传入（页面 themeEnvironment 的事实），不依赖推断。
import { describe, expect, it, vi } from 'vitest'
import { createCodexMermaidApi, type CodexMermaidLike } from '../src/codex/runtime'

function mockMermaid(detectTypeResult: string): CodexMermaidLike {
  return {
    initialize: vi.fn(),
    detectType: vi.fn(() => detectTypeResult),
    render: vi.fn(async (id: string, _code: string) => ({ svg: `<svg id="${id}"></svg>` })),
  }
}

const BASE = { securityLevel: 'strict', startOnLoad: false, theme: 'default' }

describe('createCodexMermaidApi：图内显式配置优先（源码透传）', () => {
  it('含 frontmatter / classDef / style 的源码逐字节透传给 mermaid.render', async () => {
    const mermaid = mockMermaid('flowchart')
    const api = createCodexMermaidApi(mermaid)
    api.initialize(BASE)
    const code = [
      '---',
      'config:',
      '  layout: dagre',
      '  theme: forest',
      '---',
      'flowchart TD',
      '  A["节点"]:::cls --> B',
      '  classDef cls fill:#f96,stroke:#333',
      '  style A fill:#12459e',
    ].join('\n')
    await api.render('id-1', code, false)
    expect(mermaid.render).toHaveBeenCalledWith('id-1', code)
  })

  it('预设叠加走 initialize，不改写源码：detectType 命中流程图时叠加 Codex 配置', async () => {
    const mermaid = mockMermaid('flowchart')
    const api = createCodexMermaidApi(mermaid)
    api.initialize(BASE)
    await api.render('id-2', 'flowchart TD\nA-->B', true)
    const calls = (mermaid.initialize as ReturnType<typeof vi.fn>).mock.calls
    // 序列：先恢复站点配置（+ 错误渲染抑制基线），再叠加 Codex 预设
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[0][0]).toEqual(BASE)
    const merged = calls[calls.length - 1][0] as Record<string, unknown>
    expect(merged.securityLevel).toBe('strict')
    expect(merged.theme).toBe('base')
    expect(merged.layout).toBe('elk')
    expect((merged.themeVariables as Record<string, unknown>).darkMode).toBe(true)
    // PR #5 审查 P2：错误渲染抑制是包装层强制基线（mermaid 失败默认向
    // body 插错误图临时根再 reject——组件错误口径是自处理降级）
    expect(merged.suppressErrorRendering).toBe(true)
  })

  it('六类图型：detectType 返回 sequence 时叠加六类配置（无 ELK 布局）', async () => {
    const mermaid = mockMermaid('sequence')
    const api = createCodexMermaidApi(mermaid)
    api.initialize(BASE)
    await api.render('id-3', 'sequenceDiagram\nA->>B: hi', false)
    const calls = (mermaid.initialize as ReturnType<typeof vi.fn>).mock.calls
    const merged = calls[calls.length - 1][0] as Record<string, unknown>
    expect(merged.theme).toBe('base')
    expect(merged.layout).toBeUndefined()
    expect((merged.themeVariables as Record<string, unknown>).background).toBe('#ffffff')
    expect(merged.suppressErrorRendering).toBe(true)
  })

  it('白名单外类型：只恢复站点配置，不叠加 Codex 预设', async () => {
    const mermaid = mockMermaid('mindmap')
    const api = createCodexMermaidApi(mermaid)
    api.initialize(BASE)
    await api.render('id-4', 'mindmap\n  root((r))', false)
    const calls = (mermaid.initialize as ReturnType<typeof vi.fn>).mock.calls
    // setup 一次 + render 恢复一次，共两次——无第三次叠加调用
    expect(calls.length).toBe(2)
    expect(calls[1][0]).toEqual({ ...BASE, suppressErrorRendering: true })
  })

  it('initialize 更新站点配置基线：后续 render 恢复的是最新基线', async () => {
    const mermaid = mockMermaid('flowchart')
    const api = createCodexMermaidApi(mermaid)
    api.initialize(BASE)
    const next = { ...BASE, theme: 'dark' }
    api.initialize(next)
    await api.render('id-5', 'flowchart TD\nA-->B', false)
    const calls = (mermaid.initialize as ReturnType<typeof vi.fn>).mock.calls
    // render 恢复的是最新基线 + 错误渲染抑制（calls[0]/[1] 是两次 setup）
    expect(calls[2][0]).toEqual({ ...next, suppressErrorRendering: true })
  })

  it('render 返回 mermaid 的 svg 产物', async () => {
    const mermaid: CodexMermaidLike = {
      initialize: vi.fn(),
      detectType: vi.fn(() => 'pie'),
      render: vi.fn(async () => ({ svg: '<svg data-x="1"></svg>' })),
    }
    const api = createCodexMermaidApi(mermaid)
    await expect(api.render('id-6', 'pie', false)).resolves.toEqual({ svg: '<svg data-x="1"></svg>' })
  })
})

describe('createCodexMermaidApi：共享串行队列（PR #5 审查 P1）', () => {
  it('并发 render 不交错：A 渲染完成前 B 的配置段不执行，逐段完整串行', async () => {
    const events: string[] = []
    let releaseA!: () => void
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const mermaid: CodexMermaidLike = {
      initialize: vi.fn(() => {
        events.push('initialize')
      }),
      detectType: vi.fn(() => 'flowchart'),
      render: vi.fn(async (id: string) => {
        events.push(`render-start:${id}`)
        if (id === 'a') {
          await gateA // 模拟 A 渲染耗时（真实 mermaid 内部异步消费全局配置）
        }
        events.push(`render-end:${id}`)
        return { svg: `<svg id="${id}"></svg>` }
      }),
    }
    const api = createCodexMermaidApi(mermaid)
    api.initialize(BASE)
    const a = api.render('a', 'flowchart TD\nA-->B', true)
    const b = api.render('b', 'flowchart TD\nC-->D', false)
    // 多轮微任务 flush（then 链逐轮出队）直到 A 进入渲染段；gate 未放行
    // 前 A 不会完成——B 的任务永远排在 A 之后，不可能先执行
    for (let i = 0; i < 50 && !events.includes('render-start:a'); i++) {
      await Promise.resolve()
    }
    // A 的配置段（恢复+叠加）已执行且渲染未完成：B 的任何 initialize
    // 都不得执行——配置消费与渲染整段串行
    expect(events).toEqual(['initialize', 'initialize', 'initialize', 'render-start:a'])
    expect(events.some((e) => e.startsWith('render-start:b') || e === 'render-end:b')).toBe(false)
    releaseA()
    const [ra, rb] = await Promise.all([a, b])
    // B 的配置段在 A 渲染完成之后才开始，A 的叠加配置未被 B 覆盖
    expect(events).toEqual([
      'initialize', 'initialize', 'initialize',
      'render-start:a', 'render-end:a',
      'initialize', 'initialize', 'render-start:b', 'render-end:b',
    ])
    expect(ra.svg).toBe('<svg id="a"></svg>')
    expect(rb.svg).toBe('<svg id="b"></svg>')
  })

  it('initialize 与 render 同队列：setup 在队首、后续 render 依序消费', async () => {
    const events: string[] = []
    const mermaid: CodexMermaidLike = {
      initialize: vi.fn((config: Record<string, unknown>) => {
        events.push(`init:${String(config.theme)}`)
      }),
      detectType: vi.fn(() => 'mindmap'),
      render: vi.fn(async (id: string) => {
        events.push(`render:${id}`)
        return { svg: `<svg id="${id}"></svg>` }
      }),
    }
    const api = createCodexMermaidApi(mermaid)
    api.initialize({ ...BASE, theme: 'site-a' })
    const r = api.render('x', 'mindmap\n  root((r))', false)
    await r
    expect(events).toEqual(['init:site-a', 'init:site-a', 'render:x'])
  })

  it('单任务失败不阻断队列：失败 render 之后排队者仍执行', async () => {
    let renderCount = 0
    const mermaid: CodexMermaidLike = {
      initialize: vi.fn(),
      detectType: vi.fn(() => 'pie'),
      render: vi.fn(async (id: string) => {
        renderCount += 1
        if (renderCount === 1) {
          throw new Error('boom')
        }
        return { svg: `<svg id="${id}"></svg>` }
      }),
    }
    const api = createCodexMermaidApi(mermaid)
    api.initialize(BASE)
    const first = api.render('f1', 'pie', false)
    const second = api.render('f2', 'pie', false)
    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toEqual({ svg: '<svg id="f2"></svg>' })
  })
})
