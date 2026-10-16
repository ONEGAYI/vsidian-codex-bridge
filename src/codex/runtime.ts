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
//
// 共享串行队列（PR #5 审查 P1，形态对齐内核 mermaidRender.ts 的外层
// renderQueue）：mermaid 的站点配置是**全局单例**（initialize 落地到
// mermaid 内部 siteConfig，render 在内部异步阶段消费它）——若 initialize
// 与 render 各自排队外立即执行，一屏多图并发 mount 时后图的叠加配置会
// 覆盖前图尚未消费完的配置（审查实证：并发 sequence→flowchart→pie 中间
// 流程图丢失 Codex 圆角 themeCSS；并发三张 pie（dark/dark/light）第二张
// 输出明色背景）。因此 initialize、detectType、render 在同一队列中按
// 「恢复基线 → 叠加预设 → 渲染完成」整段串行——mount、主题重绘与
// exportSvg 全部路径共用本包装 API，均被覆盖；队列吞掉已结算任务的重
// 复拒绝，单个任务失败不阻断后续排队。
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
  /** 共享串行队列尾：所有配置变更与渲染按入队顺序整段串行 */
  let queueTail: Promise<unknown> = Promise.resolve()

  function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const run = queueTail.then(task)
    // 队列尾吞掉已结算任务的拒绝：单任务失败不阻断后续排队（上游同款）
    queueTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    initialize(config) {
      baseConfig = config // 基线立即生效（后续 render 恢复最新基线）
      void enqueue(() => {
        mermaid.initialize(config)
      }).catch((e: unknown) => {
        // initialize 的 mermaid 侧失败不影响后续 render 的恢复路径；包装层
        // 无降级口径可走（该入口本就 void），保守记录不吞声
        console.warn('[codex-mermaid] initialize 排队执行失败', e)
      })
    },
    render(id, code, dark) {
      return enqueue(async () => {
        // 每张图先恢复站点配置（上一张图的预设不泄漏到本张），再按
        // detectType 结果叠加 Codex 预设；白名单外类型（mindmap 等）
        // buildCodexMermaidConfig 返回 undefined——只恢复、不叠加。
        // suppressErrorRendering 强制开启（包装层私有标志，非站点配置
        // 语义）：mermaid 解析/绘制失败默认向 document.body 插入错误图
        // 临时根（d<id>）再 reject——组件的错误口径是自处理降级（错误
        // 信息 + 源码进本容器，见 renderer），错误图 SVG 是残留物（PR #5
        // 审查 P2）；开启后 mermaid 在 throw 前自行移除临时根
        mermaid.initialize({ ...baseConfig, suppressErrorRendering: true })
        const config = buildCodexMermaidConfig(mermaid.detectType(code), dark)
        if (config) {
          mermaid.initialize({ ...baseConfig, ...config, suppressErrorRendering: true })
        }
        return mermaid.render(id, code)
      })
    },
  }
}
