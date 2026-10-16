// 宿主入口（票 #1 脚手架形态）。消费面全部经公开路径：
// - 清单声明 vsidianAddon（package.json）+ extensionDependencies；
// - registerAddon 两段生命周期：setup 常驻设置能力（本仓暂无——bridge#2/#3
//   均为纯运行功能，无自有设置页与设置定义时保持空实现），enable 装配
//   运行功能（编辑器页入口占位；粘贴规则 ctx.paste.registerRules 随
//   bridge#2、主题登记 ctx.themes.register 随 bridge#3 在此扩展）。
import * as vscode from 'vscode'
import type { AddonDefinition } from '../types/vendor/host/addons/addonRegistry'
import type { VsidianHostExports } from './host-api'

/** 本扩展 ID（publisher.name，装载器按此核对入口身份） */
const SELF_ID = 'ONEGAYI.vsidian-codex-bridge'
/** Vsidian 本体扩展 ID */
const HOST_ID = 'onegayi.vsidian'

const definition: AddonDefinition = {
  setup(_setupCtx) {
    // 常驻设置能力（普通停用后仍可配置）：本仓首期无自有设置面，
    // bridge#2/#3 若需要用户开关再在此注册设置定义
  },
  enable(enableCtx) {
    // 编辑器页入口占位（dist/editor.js 为空工厂 IIFE）：bridge#3 的
    // 渲染提供者（页面 sdk.renderers.register）经此页面装载
    enableCtx.pages.registerEditor({ entry: 'dist/editor.js' })
    // bridge#2 粘贴规则（enableCtx.paste.registerRules——Codex
    // data-prompt-link-* span → Markdown 链接）与 bridge#3 主题登记
    // （enableCtx.themes.register——Codex 亮暗色板元数据）在此扩展
    enableCtx.onDispose(() => {
      // 运行释放回调：功能票在此注销运行期资源
    })
  },
}

async function activate(_context: vscode.ExtensionContext): Promise<void> {
  const ext = vscode.extensions.getExtension<VsidianHostExports>(HOST_ID)
  if (!ext) {
    // 开发者向诊断信息（非用户可见通知）
    throw new Error(`${SELF_ID}: host extension ${HOST_ID} not found`)
  }
  const host = await ext.activate()
  const result = host.registerAddon({ id: SELF_ID }, definition)
  if (!result.ok) {
    throw new Error(`${SELF_ID}: registerAddon rejected (${result.reason})`)
  }
}

function deactivate(): void {}

// VSCode 扩展宿主契约：activate/deactivate 经 module.exports 公布。不用
// ESM export——esbuild CJS bundle 会把无 bundle 内消费者的入口导出消除为
// 死代码（0&&module.exports=...），显式赋值是可靠保留形态（蓝本实测坑，
// 见 ADR-0001）。
module.exports = { activate, deactivate }
