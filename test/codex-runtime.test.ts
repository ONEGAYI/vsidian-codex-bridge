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
    // 序列：先恢复站点配置，再叠加 Codex 预设（至少两次 initialize）
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[0][0]).toEqual(BASE)
    const merged = calls[calls.length - 1][0] as Record<string, unknown>
    expect(merged.securityLevel).toBe('strict')
    expect(merged.theme).toBe('base')
    expect(merged.layout).toBe('elk')
    expect((merged.themeVariables as Record<string, unknown>).darkMode).toBe(true)
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
  })

  it('白名单外类型：只恢复站点配置，不叠加 Codex 预设', async () => {
    const mermaid = mockMermaid('mindmap')
    const api = createCodexMermaidApi(mermaid)
    api.initialize(BASE)
    await api.render('id-4', 'mindmap\n  root((r))', false)
    const calls = (mermaid.initialize as ReturnType<typeof vi.fn>).mock.calls
    // setup 一次 + render 恢复一次，共两次——无第三次叠加调用
    expect(calls.length).toBe(2)
    expect(calls[1][0]).toEqual(BASE)
  })

  it('initialize 更新站点配置基线：后续 render 恢复的是最新基线', async () => {
    const mermaid = mockMermaid('flowchart')
    const api = createCodexMermaidApi(mermaid)
    api.initialize(BASE)
    const next = { ...BASE, theme: 'dark' }
    api.initialize(next)
    await api.render('id-5', 'flowchart TD\nA-->B', false)
    const calls = (mermaid.initialize as ReturnType<typeof vi.fn>).mock.calls
    // render 恢复的是最新基线（calls[0]/[1] 是两次 setup）
    expect(calls[2][0]).toEqual(next)
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
