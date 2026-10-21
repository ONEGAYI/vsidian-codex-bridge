// Mermaid 独立产物加载器（票 #3）：dist/mermaid.js（esm+splitting 独立
// 产物，见 build.mjs）经 sdk.resourceUri 取本页地址后 <script type=
// "module"> 按需注入——mermaid 运行时（约 2.7MB）不进页面 IIFE 主产物，
// 每次编辑器页面装载不付解析成本（对齐内核 mermaidRender.ensureMermaidApi
// 的懒加载决策，机制见 ADR-0003）。
//
// 全局名 __vsidianCodexMermaid 是本组件私有通道：不占用内置管线的
// globalThis.mermaid——组件被停用/回落内置时两套 mermaid 实例互不污染。
// 单例与失败终态口径对齐内核：装载承诺共享（一次注入）、script onerror
// 或装载后全局缺失进入终态不再重试（资源 URI 固定，重注入只会堆积失败
// script；调用方降级为错误态展示源码）。
import type { CodexMermaidApi } from './runtime'

/** 独立产物相对 resourceUri 基址的路径（resourceUri 输入）；目录归
 *  host-enable 登记的基址（dist/），此处只写文件名 */
export const MERMAID_BUNDLE_PATH = 'mermaid.js'

type GlobalWithCodex = typeof globalThis & { __vsidianCodexMermaid?: unknown }

let api: CodexMermaidApi | null = null
let loadPromise: Promise<CodexMermaidApi | null> | null = null
let loadFailed = false

function readGlobal(): CodexMermaidApi | null {
  const found = (globalThis as GlobalWithCodex).__vsidianCodexMermaid
  if (
    found &&
    typeof (found as CodexMermaidApi).initialize === 'function' &&
    typeof (found as CodexMermaidApi).render === 'function'
  ) {
    return found as CodexMermaidApi
  }
  return null
}

/**
 * 确保 Codex mermaid API 可用（页面装载层入口）：
 * resourceUri 不可用（null）或无 DOM 时返回 null，调用方降级。
 */
export function loadCodexMermaidApi(
  resourceUri: (relativePath: string) => string | null,
): Promise<CodexMermaidApi | null> {
  if (api) {
    return Promise.resolve(api)
  }
  const direct = readGlobal()
  if (direct) {
    api = direct
    return Promise.resolve(api)
  }
  if (loadFailed) {
    return Promise.resolve(null)
  }
  if (loadPromise) {
    return loadPromise
  }
  const uri = resourceUri(MERMAID_BUNDLE_PATH)
  if (!uri || typeof document === 'undefined') {
    return Promise.resolve(null)
  }
  loadPromise = new Promise((resolve) => {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = uri
    script.async = true
    script.onload = () => {
      const loaded = readGlobal()
      if (loaded) {
        api = loaded
      } else {
        // 装载完成但全局未挂上（产物内容异常）：终态，不重试
        loadFailed = true
      }
      loadPromise = null
      resolve(api)
    }
    script.onerror = () => {
      loadFailed = true
      loadPromise = null
      resolve(null)
    }
    document.head.appendChild(script)
  })
  return loadPromise
}

/** 测试钩子：重置单例与终态（生产不消费） */
export function resetLoaderForTest(): void {
  api = null
  loadPromise = null
  loadFailed = false
}
