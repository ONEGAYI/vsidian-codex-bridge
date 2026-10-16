// Codex 渲染提供者（票 #3）：平台 AddonRendererRegistration 的 Mermaid
// 实现——mount 渲染 SVG、refresh 就地重渲、release 退出跟踪、exportSvg
// 供图表弹窗与导出取图（快照语义：SVG 背景已由 Codex 预设的 themeCSS
// 烘焙进内嵌 <style>，导出原文即带背景）。
//
// 明暗联动：onThemeChange 由页面工厂直连 sdk.themeEnvironment.onChange——
// VSCode 实际生效主题变化时重渲染全部已挂载容器（H-U07：文档内已挂载
// 图形随明暗更新；图表弹窗沿平台既有快照/刷新语义，不经组件）。
//
// 降级口径（平台 ADR-0012 Q30）：装载失败与渲染失败是**自处理降级**——
// 组件捕获自己的异常、输出错误信息 + 源码占位，不向平台抛出（渲染 bug
// 不伪造组件故障停用）。迟到结果不回插：容器已 release 或脱离文档时，
// 在途渲染结果丢弃（平台保证容器不跨生效代次复用，旧代次容器退场即与
// 组件代码无关）。
import type {
  AddonRendererMountContext,
  AddonRendererRegistration,
} from '../../types/vendor/shared/addonRenderers'
import type { AddonThemeEnvironment } from '../../types/vendor/shared/addonThemes'
import type { CodexMermaidApi } from './runtime'
import { CODEX_RENDERER_ID, CODEX_RENDERER_LABEL } from './meta'

/** 依赖注入面（测试替换 loadApi/getEnv；生产由页面工厂供真实实现） */
export interface CodexRendererDeps {
  loadApi(): Promise<CodexMermaidApi | null>
  getEnv(): AddonThemeEnvironment
}

/** 渲染提供者 + 明暗联动入口（onThemeChange 直连 themeEnvironment.onChange） */
export interface CodexRenderer extends AddonRendererRegistration {
  onThemeChange(env: AddonThemeEnvironment): void
}

/** 容器渲染状态属性（组件私有观测；平台所有权标记由装载层另行写入） */
const STATE_ATTR = 'data-vscx-state'

function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message
  }
  const m = (e as { message?: unknown } | null | undefined)?.message
  return typeof m === 'string' && m !== '' ? m : String(e)
}

/** 创建 Codex Mermaid 渲染提供者 */
export function createCodexRenderer(deps: CodexRendererDeps): CodexRenderer {
  /** 已挂载容器 → 围栏源码（明暗联动与迟到结果判定的跟踪集） */
  const mounted = new Map<HTMLElement, string>()
  let dark = deps.getEnv().dark
  let seq = 0

  function applySvg(container: HTMLElement, svg: string): void {
    container.textContent = ''
    const tpl = document.createElement('template')
    tpl.innerHTML = svg
    container.appendChild(tpl.content)
    container.setAttribute(STATE_ATTR, 'rendered')
  }

  function applyError(container: HTMLElement, code: string, message: string): void {
    container.textContent = ''
    const note = document.createElement('div')
    note.setAttribute('role', 'note')
    note.textContent = message
    const source = document.createElement('pre')
    const codeEl = document.createElement('code')
    codeEl.textContent = code
    source.appendChild(codeEl)
    container.append(note, source)
    container.setAttribute(STATE_ATTR, 'error')
  }

  async function renderInto(container: HTMLElement, code: string): Promise<void> {
    const api = await deps.loadApi()
    if (!mounted.has(container)) {
      return // 装载期间容器已退场
    }
    if (!api) {
      applyError(container, code, 'Mermaid 运行时不可用')
      return
    }
    seq += 1
    try {
      const { svg } = await api.render(`vscx-mmd-${seq}`, code, dark)
      if (!mounted.has(container)) {
        return // 渲染期间容器已退场：迟到结果不回插
      }
      applySvg(container, svg)
    } catch (e) {
      if (!mounted.has(container)) {
        return
      }
      applyError(container, code, errorMessage(e))
    }
  }

  return {
    rendererId: CODEX_RENDERER_ID,
    label: CODEX_RENDERER_LABEL,
    languages: ['mermaid'],
    modes: ['live', 'reading'],
    exportFormats: ['svg'],
    mount(container: HTMLElement, code: string, _ctx: AddonRendererMountContext): void {
      container.setAttribute(STATE_ATTR, 'rendering')
      mounted.set(container, code)
      void renderInto(container, code)
    },
    refresh(container: HTMLElement, code: string, _ctx: AddonRendererMountContext): void {
      container.setAttribute(STATE_ATTR, 'rendering')
      mounted.set(container, code)
      void renderInto(container, code)
    },
    release(container: HTMLElement, _ctx: AddonRendererMountContext): void {
      mounted.delete(container)
    },
    async exportSvg(code: string, _language: string): Promise<string> {
      const api = await deps.loadApi()
      if (!api) {
        throw new Error('Mermaid 运行时不可用')
      }
      seq += 1
      const { svg } = await api.render(`vscx-mmd-x${seq}`, code, dark)
      return svg
    },
    onThemeChange(env: AddonThemeEnvironment): void {
      if (env.dark === dark) {
        return // 等值跳过（重复明暗不触发重渲染）
      }
      dark = env.dark
      for (const [container, code] of [...mounted]) {
        if (!container.isConnected) {
          mounted.delete(container) // 视口回收/CM6 丢弃：顺带清理跟踪
          continue
        }
        container.setAttribute(STATE_ATTR, 'rendering')
        void renderInto(container, code)
      }
    },
  }
}
