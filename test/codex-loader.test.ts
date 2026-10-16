// @vitest-environment jsdom
// Mermaid 独立产物加载器契约（票 #3）：dist/mermaid.js（esm 分块产物）经
// sdk.resourceUri 取本页地址、<script type="module"> 按需注入一次、装载
// 后从全局 __vsidianCodexMermaid 取包装 API（独立全局名——不占用内置
// 管线的 globalThis.mermaid，两套实例互不污染）。对齐内核 ensureMermaidApi
// 的单例与失败终态口径。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCodexMermaidApi, resetLoaderForTest } from '../src/codex/loader'
import type { CodexMermaidApi } from '../src/codex/runtime'

const GLOBAL_KEY = '__vsidianCodexMermaid'

afterEach(() => {
  resetLoaderForTest()
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY]
  document.head.innerHTML = ''
})

function lastScript(): HTMLScriptElement {
  const scripts = [...document.head.querySelectorAll('script')]
  return scripts[scripts.length - 1] as HTMLScriptElement
}

describe('loadCodexMermaidApi', () => {
  it('resourceUri 不可用（null）时返回 null（降级错误态）', async () => {
    await expect(loadCodexMermaidApi(() => null)).resolves.toBeNull()
    // 未注入任何 script
    expect(document.head.querySelector('script')).toBeNull()
  })

  it('注入 module script 指向独立产物；两次调用共享同一装载承诺', async () => {
    const pending = loadCodexMermaidApi(() => 'vscode-webview-resource://x/dist/mermaid.js')
    const script = lastScript()
    expect(script.type).toBe('module')
    expect(script.src).toBe('vscode-webview-resource://x/dist/mermaid.js')
    const again = loadCodexMermaidApi(() => 'vscode-webview-resource://x/dist/mermaid.js')
    expect(document.head.querySelectorAll('script').length).toBe(1)
    // 预置全局后触发 onload，两个承诺解析到同一 API
    const api: CodexMermaidApi = { initialize: vi.fn(), render: vi.fn() }
    ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = api
    script.dispatchEvent(new Event('load'))
    await expect(pending).resolves.toBe(api)
    await expect(again).resolves.toBe(api)
  })

  it('装载失败（onerror）进入终态：后续调用不再注入新 script', async () => {
    const first = loadCodexMermaidApi(() => 'vscode-webview-resource://x/dist/mermaid.js')
    lastScript().dispatchEvent(new Event('error'))
    await expect(first).resolves.toBeNull()
    await expect(loadCodexMermaidApi(() => 'vscode-webview-resource://x/dist/mermaid.js')).resolves.toBeNull()
    expect(document.head.querySelectorAll('script').length).toBe(1)
  })

  it('装载完成但全局未挂上（产物异常）同样进入终态', async () => {
    const first = loadCodexMermaidApi(() => 'vscode-webview-resource://x/dist/mermaid.js')
    lastScript().dispatchEvent(new Event('load'))
    await expect(first).resolves.toBeNull()
    await expect(loadCodexMermaidApi(() => 'vscode-webview-resource://x/dist/mermaid.js')).resolves.toBeNull()
    expect(document.head.querySelectorAll('script').length).toBe(1)
  })
})
