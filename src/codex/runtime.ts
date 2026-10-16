// Codex Mermaid 运行时包装（票 #3）：形态迁移自内核 src/webview/
// mermaidEntry.ts（vsidian@301d2c16）对 mermaid 的 render 包装——每张图先
// 恢复站点配置、再按 mermaid 自身识别结果叠加 Codex 预设。
//
// 图内显式配置优先（票面口径）：包装层把源码逐字节透传给 mermaid.render，
// 不做任何改写或剥离——frontmatter（init 配置）、classDef 与 style 由
// mermaid 自身解析并覆盖站点配置（「预设不改写源码」，上游原口径）。
//
// 与上游的差异：明暗由调用方显式传入（dark 参数——页面侧持有
// themeEnvironment 的事实），不像上游从 baseConfig.theme 推断。
import { buildCodexMermaidConfig } from './theme'

/** 包装所需的 mermaid 能力面（真实实现来自 npm mermaid；测试注入 mock） */
export interface CodexMermaidLike {
  initialize(config: Record<string, unknown>): void
  detectType(code: string): string
  render(id: string, code: string): Promise<{ svg: string }>
}

/** 暴露给页面装载层的包装 API 面 */
export interface CodexMermaidApi {
  initialize(config: Record<string, unknown>): void
  render(id: string, code: string, dark: boolean): Promise<{ svg: string }>
}

/** 包装真实 mermaid：站点配置基线 + 逐图叠加 Codex 预设 */
export function createCodexMermaidApi(mermaid: CodexMermaidLike): CodexMermaidApi {
  let baseConfig: Record<string, unknown> = {}
  return {
    initialize(config) {
      baseConfig = config
      mermaid.initialize(config)
    },
    async render(id, code, dark) {
      // 每张图先恢复站点配置（上一张图的预设不泄漏到本张），再按
      // detectType 结果叠加；白名单外类型（mindmap 等）返回 undefined
      // ——只恢复、不叠加，保持站点配置
      mermaid.initialize(baseConfig)
      const config = buildCodexMermaidConfig(mermaid.detectType(code), dark)
      if (config) {
        mermaid.initialize({ ...baseConfig, ...config })
      }
      return mermaid.render(id, code)
    },
  }
}
