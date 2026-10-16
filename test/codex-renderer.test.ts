// @vitest-environment jsdom
// Codex 渲染提供者契约（票 #3，jsdom）：mount/refresh/release/exportSvg
// 行为、明暗切换重渲染、自处理降级（运行时不可用 / 渲染失败）、迟到结果
// 不回插。对齐平台语义（AddonRendererRegistration，vendor 快照）与
// T07 主题夹具的消费形态（themeEnvironment.onChange 中更新已挂载图形）。
import { describe, expect, it, vi } from 'vitest'
import { createCodexRenderer } from '../src/codex/renderer'
import type { CodexMermaidApi } from '../src/codex/runtime'

function fakeApi(): CodexMermaidApi & { render: ReturnType<typeof vi.fn> } {
  return {
    initialize: vi.fn(),
    render: vi.fn(async (id: string, _code: string, dark: boolean) => ({
      svg: `<svg id="${id}" data-dark="${dark ? '1' : '0'}"></svg>`,
    })),
  }
}

function makeEnv(dark: boolean) {
  return { dark, highContrast: false }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createCodexRenderer：mount / refresh / release', () => {
  it('mount 渲染 SVG 并标记 rendered 态', async () => {
    const api = fakeApi()
    const renderer = createCodexRenderer({ loadApi: async () => api, getEnv: () => makeEnv(false) })
    const container = document.createElement('div')
    document.body.appendChild(container)
    renderer.mount(container, 'flowchart TD\nA-->B', { language: 'mermaid', mode: 'reading' })
    await flush()
    expect(container.getAttribute('data-vscx-state')).toBe('rendered')
    expect(container.querySelector('svg')?.getAttribute('data-dark')).toBe('0')
    expect(api.render).toHaveBeenCalledTimes(1)
    // 挂载即接管容器内容（不留源码占位）
    expect(container.textContent).not.toContain('flowchart TD')
  })

  it('mount 时以 themeEnvironment 当前明暗渲染', async () => {
    const api = fakeApi()
    const renderer = createCodexRenderer({ loadApi: async () => api, getEnv: () => makeEnv(true) })
    const container = document.createElement('div')
    renderer.mount(container, 'pie', { language: 'mermaid', mode: 'live' })
    await flush()
    expect(api.render).toHaveBeenCalledWith(expect.any(String), 'pie', true)
  })

  it('refresh 就地重渲染（明暗变化后由平台热切换重派发）', async () => {
    const api = fakeApi()
    const renderer = createCodexRenderer({ loadApi: async () => api, getEnv: () => makeEnv(false) })
    const container = document.createElement('div')
    renderer.mount(container, 'flowchart TD\nA-->B', { language: 'mermaid', mode: 'live' })
    await flush()
    renderer.refresh!(container, 'flowchart TD\nA-->B', { language: 'mermaid', mode: 'live' })
    await flush()
    expect(api.render).toHaveBeenCalledTimes(2)
  })

  it('release 后容器退出跟踪：明暗切换不再重渲染它', async () => {
    const api = fakeApi()
    let dark = false
    const renderer = createCodexRenderer({ loadApi: async () => api, getEnv: () => makeEnv(dark) })
    const container = document.createElement('div')
    document.body.appendChild(container)
    renderer.mount(container, 'flowchart TD\nA-->B', { language: 'mermaid', mode: 'reading' })
    await flush()
    renderer.release!(container, { language: 'mermaid', mode: 'reading' })
    dark = true
    renderer.onThemeChange(makeEnv(true))
    await flush()
    expect(api.render).toHaveBeenCalledTimes(1)
  })
})

describe('createCodexRenderer：明暗联动', () => {
  it('onThemeChange 重渲染全部已挂载容器（暗色入参生效）', async () => {
    const api = fakeApi()
    const renderer = createCodexRenderer({ loadApi: async () => api, getEnv: () => makeEnv(false) })
    const c1 = document.createElement('div')
    const c2 = document.createElement('div')
    document.body.append(c1, c2)
    renderer.mount(c1, 'flowchart TD\nA-->B', { language: 'mermaid', mode: 'reading' })
    renderer.mount(c2, 'pie', { language: 'mermaid', mode: 'live' })
    await flush()
    renderer.onThemeChange(makeEnv(true))
    await flush()
    expect(api.render).toHaveBeenCalledTimes(4)
    expect(c1.querySelector('svg')?.getAttribute('data-dark')).toBe('1')
    expect(c2.querySelector('svg')?.getAttribute('data-dark')).toBe('1')
  })

  it('等值明暗不触发重渲染（重复值语义）', async () => {
    const api = fakeApi()
    const renderer = createCodexRenderer({ loadApi: async () => api, getEnv: () => makeEnv(false) })
    const container = document.createElement('div')
    renderer.mount(container, 'flowchart TD\nA-->B', { language: 'mermaid', mode: 'reading' })
    await flush()
    renderer.onThemeChange(makeEnv(false))
    await flush()
    expect(api.render).toHaveBeenCalledTimes(1)
  })

  it('已脱离文档的容器不重渲染', async () => {
    const api = fakeApi()
    const renderer = createCodexRenderer({ loadApi: async () => api, getEnv: () => makeEnv(false) })
    const container = document.createElement('div')
    renderer.mount(container, 'flowchart TD\nA-->B', { language: 'mermaid', mode: 'reading' })
    await flush()
    container.remove()
    renderer.onThemeChange(makeEnv(true))
    await flush()
    expect(api.render).toHaveBeenCalledTimes(1)
  })
})

describe('createCodexRenderer：自处理降级（不构成组件故障）', () => {
  it('运行时不可用（loadApi → null）：错误态 + 源码展示', async () => {
    const renderer = createCodexRenderer({ loadApi: async () => null, getEnv: () => makeEnv(false) })
    const container = document.createElement('div')
    renderer.mount(container, 'flowchart TD\nA-->B', { language: 'mermaid', mode: 'reading' })
    await flush()
    expect(container.getAttribute('data-vscx-state')).toBe('error')
    expect(container.textContent).toContain('flowchart TD')
    expect(container.textContent).not.toContain('undefined')
  })

  it('渲染失败（render reject）：错误消息 + 源码展示', async () => {
    const api: CodexMermaidApi = {
      initialize: vi.fn(),
      render: vi.fn(async () => {
        throw new Error('parse bomb')
      }),
    }
    const renderer = createCodexRenderer({ loadApi: async () => api, getEnv: () => makeEnv(false) })
    const container = document.createElement('div')
    renderer.mount(container, 'flowchart TD\nA--x', { language: 'mermaid', mode: 'reading' })
    await flush()
    expect(container.getAttribute('data-vscx-state')).toBe('error')
    expect(container.textContent).toContain('parse bomb')
    expect(container.textContent).toContain('A--x')
  })

  it('迟到结果不回插：mount 后立即 release，异步完成时不写入容器', async () => {
    const api = fakeApi()
    const renderer = createCodexRenderer({ loadApi: async () => api, getEnv: () => makeEnv(false) })
    const container = document.createElement('div')
    document.body.appendChild(container)
    renderer.mount(container, 'flowchart TD\nA-->B', { language: 'mermaid', mode: 'reading' })
    renderer.release!(container, { language: 'mermaid', mode: 'reading' })
    await flush()
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('createCodexRenderer：exportSvg（弹窗快照 / 导出共用取图路径）', () => {
  it('返回渲染 SVG 原文（背景已由 themeCSS 烘焙进内嵌 style）', async () => {
    const api: CodexMermaidApi = {
      initialize: vi.fn(),
      render: vi.fn(async () => ({ svg: '<svg><style>& { background-color:#181818; }</style></svg>' })),
    }
    const renderer = createCodexRenderer({ loadApi: async () => api, getEnv: () => makeEnv(true) })
    await expect(renderer.exportSvg!('sequenceDiagram\nA->>B: x', 'mermaid')).resolves.toBe(
      '<svg><style>& { background-color:#181818; }</style></svg>',
    )
  })

  it('运行时不可用时 reject（调用方降级）', async () => {
    const renderer = createCodexRenderer({ loadApi: async () => null, getEnv: () => makeEnv(false) })
    await expect(renderer.exportSvg!('pie', 'mermaid')).rejects.toThrow()
  })
})
