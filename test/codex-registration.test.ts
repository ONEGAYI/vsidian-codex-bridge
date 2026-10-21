// Codex 主题登记与页面装配契约（票 #3）：
// - 元数据单一事实源：宿主 themes.register 声明与页面 renderers.register
//   的 rendererId 必须同源（themeId/rendererId/languages 对齐 T07 实际
//   API 面，vendor 快照 addonThemes/addonRenderers）；
// - 宿主 enable：themes.register 整批登记 + 普通拒绝不抛（不算故障）；
// - 页面工厂：SDK 面缺失即抛、注册形状正确、themeEnvironment 订阅与
//   onDispose 退订（对齐 T07 主题夹具消费形态）。
import { describe, expect, it, vi } from 'vitest'
import { ADDON_ID, CODEX_RENDERER_ID, CODEX_THEME_DECLARATION } from '../src/codex/meta'
import { MERMAID_BUNDLE_PATH } from '../src/codex/loader'
import { codexEnable } from '../src/codex/host-enable'
import { codexPageFactory } from '../src/page-editor'

describe('Codex 主题元数据（单一事实源）', () => {
  it('声明形状：themeId / rendererId / languages 对齐 T07 API 面', () => {
    expect(ADDON_ID).toBe('ONEGAYI.vsidian-codex-bridge')
    expect(CODEX_THEME_DECLARATION.themeId).toBe('codex')
    expect(CODEX_THEME_DECLARATION.rendererId).toBe(CODEX_RENDERER_ID)
    expect(CODEX_THEME_DECLARATION.languages).toEqual(['mermaid'])
    // label 为直值或多语言映射（平台语义）；显示名对齐内核内置 Codex
    // 主题的 i18n 文案（'Codex'，中英同名）
    expect(CODEX_THEME_DECLARATION.label).toBe('Codex')
  })

  it('平台组合身份：themeRef = `${addonId}/${themeId}` 与内置保留值不冲突', () => {
    const themeRef = `${ADDON_ID}/${CODEX_THEME_DECLARATION.themeId}`
    expect(themeRef).toBe('ONEGAYI.vsidian-codex-bridge/codex')
    // 内置保留值为裸 'codex'（appearance.theme 值域 default | codex | themeRef）；
    // 组件主题恒为组合形态，不占用保留值
    expect(themeRef).not.toBe('codex')
  })
})

describe('宿主 enable：themes.register 登记', () => {
  function mockEnableCtx() {
    return {
      pages: { registerEditor: vi.fn((_entry: unknown) => ({ dispose: () => {} })) },
      themes: {
        register: vi.fn(
          (_declarations: readonly unknown[]): { ok: boolean; reason?: string; dispose(): void } => ({
            ok: true,
            dispose: () => {},
          }),
        ),
      },
      onDispose: vi.fn((_cb: () => void) => {}),
    }
  }

  it('登记编辑器页入口 + 资源基址 + Codex 主题元数据（整批一条）', () => {
    const ctx = mockEnableCtx()
    codexEnable(ctx as never)
    // resources 是 mermaid 独立产物的装载前提：平台只在登记了资源子目录时
    // 才提供 resourceUri（首个子目录作基址）——缺登记则 loader 恒 null，
    // 渲染恒降级「Mermaid 运行时不可用」（issue #7）。loader 请求的是带
    // dist/ 前缀的相对路径，基址须为安装目录根（'.'）
    expect(ctx.pages.registerEditor).toHaveBeenCalledWith({ entry: 'dist/editor.js', resources: ['.'] })
    expect(ctx.themes.register).toHaveBeenCalledTimes(1)
    expect(ctx.themes.register).toHaveBeenCalledWith([CODEX_THEME_DECLARATION])
  })

  it('resources 基址与 loader 请求路径配套：基址为安装根、产物在 dist/ 下', () => {
    const ctx = mockEnableCtx()
    codexEnable(ctx as never)
    const input = ctx.pages.registerEditor.mock.calls[0]![0] as { resources?: readonly string[] }
    expect(input.resources?.[0]).toBe('.')
    // 两个事实源不脱节：host-enable 的基址登记 vs loader 的 MERMAID_BUNDLE_PATH——
    // 平台拼接语义为 `${resourceBase}/${relativePath}`，产物落在 <安装目录>/dist/ 内
    expect(MERMAID_BUNDLE_PATH.startsWith('dist/')).toBe(true)
  })

  it('themes.register 普通拒绝（invalid-theme 等）不抛——不算组件故障', () => {
    const ctx = mockEnableCtx()
    ctx.themes.register = vi.fn(
      (_declarations: readonly unknown[]): { ok: boolean; reason?: string; dispose(): void } => ({
        ok: false,
        reason: 'invalid-theme',
        dispose: () => {},
      }),
    )
    expect(() => codexEnable(ctx as never)).not.toThrow()
  })
})

describe('页面工厂：renderers.register + themeEnvironment 装配', () => {
  function mockSdk() {
    return {
      addon: { id: ADDON_ID, generation: 1, page: 'editor' as const },
      renderers: { register: vi.fn((_spec: unknown) => ({ dispose: () => {} })) },
      themeEnvironment: {
        get: vi.fn(() => ({ dark: false, highContrast: false })),
        onChange: vi.fn((_cb: (env: { dark: boolean; highContrast: boolean }) => void) => () => {}),
      },
      onDispose: vi.fn((_cb: () => void) => {}),
      resourceUri: vi.fn((_relativePath: string) => 'vscode-webview-resource://test/dist/mermaid.js'),
    }
  }

  it('注册形状：rendererId / languages / modes / exportFormats / 回调齐备', () => {
    const sdk = mockSdk()
    codexPageFactory(sdk as never)
    expect(sdk.renderers.register).toHaveBeenCalledTimes(1)
    const spec = sdk.renderers.register.mock.calls[0]![0] as Record<string, unknown>
    expect(spec.rendererId).toBe(CODEX_RENDERER_ID)
    expect(spec.languages).toEqual(['mermaid'])
    expect(spec.modes).toEqual(['live', 'reading'])
    expect(spec.exportFormats).toEqual(['svg'])
    expect(typeof spec.mount).toBe('function')
    expect(typeof spec.refresh).toBe('function')
    expect(typeof spec.release).toBe('function')
    expect(typeof spec.exportSvg).toBe('function')
    // 显示名必填（AddonRendererProviderInfo.label）
    expect(typeof spec.label).toBe('string')
    expect(spec.label).not.toBe('')
  })

  it('订阅 themeEnvironment 并在 onDispose 退订', () => {
    const sdk = mockSdk()
    codexPageFactory(sdk as never)
    expect(sdk.themeEnvironment.onChange).toHaveBeenCalledTimes(1)
    expect(typeof sdk.themeEnvironment.onChange.mock.calls[0]![0]).toBe('function')
    expect(sdk.onDispose).toHaveBeenCalled()
  })

  it('SDK 面缺失即抛（renderers / themeEnvironment 为编辑器页必备面）', () => {
    const missingRenderers = mockSdk()
    delete (missingRenderers as Record<string, unknown>).renderers
    expect(() => codexPageFactory(missingRenderers as never)).toThrow()
    const missingTheme = mockSdk()
    delete (missingTheme as Record<string, unknown>).themeEnvironment
    expect(() => codexPageFactory(missingTheme as never)).toThrow()
  })
})
