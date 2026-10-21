// 真宿主安装验证套件（票 #4 宿主测试基建层，衔接 #3 遗留项）：在下界
// 宿主 VSCode 1.82.3 的扩展宿主内运行（由 test/host/run.mjs 经
// --extensionTestsPath 装载，经 silentHost.mjs 独立桌面静默启动），以
// extensionDevelopmentPath 模式同时装载 vsidian 宿主（vsidian@80dfc285
// 构建产物，API 1.1.0 发行）与本组件 dist 产物，断言四层：
//   1. 组件激活无错（extensionDependencies 联动 + registerAddon 成功）；
//   2. 主题目录出现 Codex 候选（设置「外观 → 主题」的数据源）；
//   3. 选择后 mermaid 渲染走组件（平台 paint 探针：provider 身份 + 容器
//      内 SVG 在场〔builtinSvg>=1〕——esm 分块在 webview CSP 下真实装载
//      的证明。width/builtinSvg===0 形态因 vsidian 探针语义缺陷暂不可用，
//      见断言③处注释）；
//   4. 停用组件回落内置 default 且保留首选（降级底线）。
// 观测全部经 vsidian 的 _test.* 测试钩子命令（VSIDIAN_TEST_HOOKS=1 会话
// 注册，形态与上游 test/integration/suite/addonThemeCases.ts 同源）——
// 不访问 vsidian 内部对象。绘制断言消费生产 view.state.paint 探针。
// 组织方式为极简自研 runner（不引 mocha）：失败汇总后抛错使宿主以非零
// 码退出。暗色填充/私有全局名在宿主侧无观测面（paint 探针 color 对 SVG
// 叶子元素恒透明、webview 全局不可从扩展宿主读取），色板证据由浏览器层
// 冒烟承载（ADR-0003）——README 手动验证清单含这两处人工证据点。
import * as vscode from 'vscode'
import { ADDON_ID, CODEX_RENDERER_ID } from '../../src/codex/meta'

const HOST_ID = 'onegayi.vsidian'
const PREFIX = 'onegayi.vsidian._test.'
const THEME_REF = `${ADDON_ID}/codex`
const PROVIDER_ID = `${ADDON_ID}/${CODEX_RENDERER_ID}`

interface ThemeState {
  themes: Array<{ themeRef: string; available: boolean }>
  preferred: string
  preferredAvailable: boolean
  table: { languages: Array<{ language: string; effective: string }> }
}
interface PaintContainer {
  language: string
  provider: string
  mode: string
  state: string | null
  color: string | null
  width: number
}
interface Paint {
  containers: PaintContainer[]
  builtinSvg: number
}

const state = () => vscode.commands.executeCommand<ThemeState>(`${PREFIX}addonThemes`)

async function paint(uri: vscode.Uri): Promise<Paint | undefined> {
  const view = await vscode.commands.executeCommand<{ paint?: { renderers?: Paint } }>(
    `${PREFIX}requestViewState`, uri.toString(), 0,
  )
  return view?.paint?.renderers
}

async function wait<T>(label: string, read: () => Promise<T | undefined>): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() - start > 30_000) throw new Error(`等待超时：${label}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/** 删除临时文件，不存在时静默（@types/vscode 1.82 的 fs.delete 无 ignore 选项） */
async function deleteQuietly(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri)
  } catch {
    // 临时文件缺席不是失败
  }
}

/** 诊断版 wait：每 5 秒落一行原始观测（面板未就绪/容器缺席的定位窗口） */
async function waitProbe<T>(label: string, read: () => Promise<T | undefined>, probe: () => Promise<unknown>): Promise<T> {
  const start = Date.now()
  let lastProbe = 0
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() - start > 60_000) throw new Error(`等待超时：${label}`)
    if (Date.now() - lastProbe > 5_000) {
      lastProbe = Date.now()
      console.log(`[宿主验证][probe] ${label} 已等 ${((Date.now() - start) / 1000).toFixed(0)}s：${JSON.stringify(await probe())}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

const CASES: Array<[string, () => Promise<void>]> = [
  ['组件在下界宿主激活无错（extensionDependencies 联动 + registerAddon 成功）', async () => {
    const host = vscode.extensions.getExtension(HOST_ID)
    if (!host) throw new Error(`${HOST_ID} 未装载——宿主扩展缺席，验证装配错误`)
    if (!host.isActive) await host.activate()
    const self = vscode.extensions.getExtension(ADDON_ID)
    if (!self) throw new Error(`${ADDON_ID} 未装载（--extensionDevelopmentPath 缺席或清单非法）`)
    // extensionDependencies 使 VSCode 在宿主激活后联动激活本组件；组件
    // activate 内 registerAddon 拒绝会 throw（激活错误），isActive 即证明
    // 两段接线成功
    if (!self.isActive) {
      await self.activate()
    }
    if (!self.isActive) throw new Error(`${ADDON_ID} 激活失败`)
    console.log(`[宿主验证] ${ADDON_ID} isActive=${self.isActive}；宿主 ${HOST_ID} isActive=${host.isActive}`)
  }],

  ['主题目录出现 Codex 候选（设置「外观 → 主题」数据源，available）', async () => {
    const directory = await wait('Codex 主题进入目录', async () => {
      const current = await state()
      return current?.themes.some((theme) => theme.themeRef === THEME_REF && theme.available) ? current : undefined
    })
    const entry = directory.themes.find((theme) => theme.themeRef === THEME_REF)
    console.log(`[宿主验证] 主题目录 ${directory.themes.length} 项；Codex 候选 themeRef=${entry!.themeRef} available=${entry!.available}`)
    console.log(`[宿主验证] 目录快照 themes=${JSON.stringify(directory.themes)}`)
  }],

  ['选择 Codex 主题后 mermaid 渲染走组件，停用回落内置且保留首选（降级底线）', async () => {
    // 渲染与停用回落共用同一文档生命周期（开一次面板内先断言组件渲染、
    // 再停用断言回落）——对齐上游 addonThemeCases 的验证形态：closeAll-
    // Editors 后立即二次 openWith 存在面板销毁/重建竞态（实测三次两中，
    // 停用前基线等不到组件容器），上游从不二次开面板
    const previous = await vscode.commands.executeCommand<Record<string, unknown>>(`${PREFIX}getSettings`)
    const root = vscode.workspace.workspaceFolders![0]!.uri
    const uri = vscode.Uri.joinPath(root, 'codex-host-check.md')
    const content = '# Codex 宿主验证\n\n```mermaid\ngraph TD; A-->B\n```\n\n收尾段落\n'
    try {
      const applyResult = await vscode.commands.executeCommand(`${PREFIX}setSettings`, { 'appearance.theme': THEME_REF })
      console.log(`[宿主验证] setSettings 返回 ok=${(applyResult as { ok?: boolean })?.ok}（appearance.theme=${THEME_REF}）`)
      // 设置广播是异步的：等目录侧 preferred 落到 THEME_REF 即开文档。
      // 不等生效表指向组件渲染器——生效表的 provider 条目以页面渲染
      // 提供者已注册为前提（面板至少开过一次），先等它是次序颠倒的
      // 恒假条件（实测 60s 探针 mermaidEffective 恒 builtin 而 preferred/
      // preferredAvailable 均已落地）；选路正确性的硬证据由下方的 paint
      // 容器断言直接承载
      await waitProbe('主题首选落地（preferred）', async () => {
        const current = await state()
        return current?.preferred === THEME_REF ? true : undefined
      }, async () => {
        const current = await state()
        return { preferred: current?.preferred, preferredAvailable: current?.preferredAvailable, mermaidEffective: current?.table.languages.find((e) => e.language === 'mermaid')?.effective }
      })
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content))
      await vscode.commands.executeCommand('vscode.openWith', uri, 'onegayi.vsidian.editor')
      // ---- 断言层 ③：容器真实绘制走组件 ----
      // provider 是平台写在图形容器上的生效提供者标记（${PROVIDER_ID}）。
      // 绘制证据取 builtinSvg>=1（容器内有 SVG）：vsidian 探针（#358）的
      // builtinSvg 统计 `.vsidian-mermaid svg`，而热切换重挂载的容器无论
      // 内置/组件接管一律挂 .vsidian-mermaid 类（vsidian graphicRenderers
      // remountGraphicContainer）——组件 SVG 亦被计数；width 的探针 fallback
      // 落 SVG 内嵌 <style>（display:none，rect 恒 0），真渲染场景不可用。
      // 在「接管必经重挂载、内置旧容器退场」的前提下，builtinSvg>=1 即
      // 组件 SVG 在场的绘制证据；装载失败（error 占位无 svg）恒 0——
      // 两态可区分，本断言即装载链（resourceUri + module script + CSP
      // 放行）的端到端证明（ADR-0003 未尽项在此闭环）。待 vsidian 探针
      // 语义修复后回到 width>0 && builtinSvg===0 形态
      const rendered = await waitProbe('组件渲染器接管 mermaid 容器', async () => {
        const current = await paint(uri)
        if (!current) return undefined
        const hit = current.containers.find((item) => item.language === 'mermaid'
          && item.provider === PROVIDER_ID)
        return hit && current.builtinSvg >= 1 ? { hit, current } : undefined
      }, async () => {
        const current = await paint(uri)
        const directory = await state()
        return { containers: current?.containers, builtinSvg: current?.builtinSvg, mermaidEffective: directory?.table.languages.find((entry) => entry.language === 'mermaid')?.effective, preferred: directory?.preferred }
      })
      console.log(`[宿主验证] 容器 provider=${rendered.hit.provider} width=${rendered.hit.width.toFixed(0)} builtinSvg=${rendered.current.builtinSvg}`)
      console.log(`[宿主验证] 容器观测 state=${JSON.stringify(rendered.hit.state)} color=${JSON.stringify(rendered.hit.color)}（color 对 SVG 叶子恒透明，色板证据见浏览器层冒烟与手动清单）`)
      console.log(`[宿主验证] 全容器=${JSON.stringify(rendered.current.containers.map((c) => ({ language: c.language, provider: c.provider, width: c.width })))}`)
      // ---- 断言层 ④：停用回落内置 default 且保留主题首选 ----
      // 平台开关停用：运行期注册撤回（组件 enable 生命周期结束），主题
      // 目录失去该候选——首选保留、渲染回落内置 default（平台语义，本
      // 组件停用不拖累宿主）
      await vscode.commands.executeCommand(`${PREFIX}addonSetEnabled`, { addonId: ADDON_ID, enabled: false })
      await wait('目录回落（preferred 保留 + effective 回 builtin）', async () => {
        const current = await state()
        return current?.preferred === THEME_REF && !current.preferredAvailable
          && current.table.languages.find((entry) => entry.language === 'mermaid')?.effective === 'builtin' ? current : undefined
      })
      const after = await wait('内置管线实际接管（builtinSvg=1 且组件容器消失）', async () => {
        const current = await paint(uri)
        return current?.builtinSvg === 1
          && !current.containers.some((item) => item.provider === PROVIDER_ID) ? current : undefined
      })
      console.log(`[宿主验证] 停用后 builtinSvg=${after.builtinSvg}；目录 preferred=${THEME_REF}（保留）、mermaid effective=builtin`)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand(`${PREFIX}addonSetEnabled`, { addonId: ADDON_ID, enabled: true })
      await vscode.commands.executeCommand(`${PREFIX}setSettings`, {
        'appearance.theme': previous!['appearance.theme'] ?? 'default',
        'appearance.mermaidTheme': previous!['appearance.mermaidTheme'] ?? 'default',
      })
      await deleteQuietly(uri)
    }
  }],
]

async function run(): Promise<void> {
  const failures: string[] = []
  console.log(`[宿主验证] 执行 ${CASES.length} 项（${ADDON_ID} × 下界宿主 VSCode 1.82.3）`)
  for (const [name, fn] of CASES) {
    console.log(`[宿主验证][START] ${name}`)
    const started = Date.now()
    try {
      await fn()
      console.log(`[宿主验证][PASS] ${name}（${Date.now() - started}ms）`)
    } catch (error) {
      failures.push(`${name}：${error instanceof Error ? error.message : String(error)}`)
      console.log(`[宿主验证][FAIL] ${name}（${Date.now() - started}ms）：${failures[failures.length - 1]}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`真宿主安装验证 ${failures.length}/${CASES.length} 项失败：\n- ${failures.join('\n- ')}`)
  }
  console.log(`[宿主验证] 全部 ${CASES.length} 项通过`)
}

// VSCode extensionTestsPath 契约：宿主 require 该模块后调用 run()。不用
// ESM export——esbuild CJS bundle 会把无 bundle 内消费者的入口导出消除为
// 死代码（0&&module.exports=...），显式赋值是可靠保留形态（同
// src/extension.ts，见 ADR-0001）。
module.exports = { run }
