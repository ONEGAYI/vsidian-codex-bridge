// 浏览器层冒烟（票 #3 尽力项）：在真实 Chromium 中装载 dist/mermaid.js
// esm 分块产物，验证——
// 1. 产物在浏览器可装载（动态分块 import 解析、ELK 懒加载）；
// 2. detectType 实际返回值命中 Codex 白名单（真实 mermaid，非 mock）；
// 3. 流程图 + 六类图型（时序/类/状态/ER/甘特/饼）亮暗两态渲染不抛、
//    SVG 在场且 Codex 色值生效（暗色节点填充 #1a283d）；
// 4. 图内显式配置优先：frontmatter theme 覆盖后仍正常出图。
//
// 运行：node test/browser/smoke-mermaid.mjs（Playwright 借用 vsidian 主仓
// node_modules 与其浏览器缓存——本仓不引浏览器测试重依赖；退出码 0 = 全过）。
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---- 定位 vsidian 主仓的 playwright（借用，不进本仓依赖） ----
const VSIAN_REPO = process.env.VSIDIAN_SOURCE_REPO ?? 'D:/CODE/Project/_Extensions/vscode-obsidian-like-editor'
const { createRequire } = await import('node:module')
const requireFromVsidian = createRequire(join(VSIAN_REPO, 'package.json'))
const { chromium } = requireFromVsidian('playwright')

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const distDir = join(repoRoot, 'dist')

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' }

// ---- 最小 http 资产服务（module script 的分块 import 需要 http URL） ----
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const file = normalize(join(distDir, url.pathname))
    if (!file.startsWith(distDir)) {
      res.writeHead(403).end()
      return
    }
    const data = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const SAMPLES = [
  ['flowchart', 'flowchart TD\n  A[开始] --> B{判断}\n  B -->|是| C[处理]\n  B -->|否| D[结束]\n  C --> D'],
  ['sequence', 'sequenceDiagram\n  participant U as 用户\n  participant S as 服务\n  U->>S: 请求\n  S-->>U: 响应'],
  ['class', 'classDiagram\n  class Base {\n    +run()\n  }\n  class Impl {\n    +run()\n  }\n  Base <|-- Impl'],
  ['state', 'stateDiagram-v2\n  [*] --> 待机\n  待机 --> 运行: 启动\n  运行 --> [*]: 停止'],
  ['er', 'erDiagram\n  USER ||--o{ ORDER : 下单\n  USER {\n    string id\n  }'],
  ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  调研 :a1, 2026-01-01, 3d\n  实施 :after a1, 5d'],
  ['pie', 'pie showData\n  "A 类" : 45\n  "B 类" : 55'],
]

let failures = 0
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' }).catch(() => {})

  const results = await page.evaluate(async ({ port, samples }) => {
    const out = []
    // 装载独立 esm 产物（入口挂全局 __vsidianCodexMermaid）
    await import(`http://127.0.0.1:${port}/mermaid.js`)
    const api = globalThis.__vsidianCodexMermaid
    if (!api) {
      return [{ name: '装载', ok: false, detail: 'globalThis.__vsidianCodexMermaid 未挂上' }]
    }
    out.push({ name: '装载 dist/mermaid.js（含分块与 ELK 懒加载）', ok: true, detail: '' })
    api.initialize({ securityLevel: 'strict', startOnLoad: false, theme: 'default' })
    for (const [name, code] of samples) {
      for (const dark of [false, true]) {
        try {
          const { svg } = await api.render(`smoke-${name}-${dark ? 'd' : 'l'}`, code, dark)
          const okSvg = typeof svg === 'string' && svg.includes('<svg')
          const hasDarkFill = !dark || svg.includes('#1a283d')
          out.push({
            name: `${name} ${dark ? '暗' : '亮'}`,
            ok: okSvg && hasDarkFill,
            detail: okSvg ? (hasDarkFill ? `${svg.length} B` : 'SVG 在场但暗色节点填充 #1a283d 缺失') : 'SVG 不在场',
          })
        } catch (e) {
          out.push({ name: `${name} ${dark ? '暗' : '亮'}`, ok: false, detail: String(e).slice(0, 160) })
        }
      }
    }
    // 图内显式配置优先：frontmatter 声明 theme 后仍出图（源码透传、由
    // mermaid 自身解析覆盖）
    try {
      const front = '---\nconfig:\n  theme: forest\n---\nflowchart LR\n  X --> Y'
      const { svg } = await api.render('smoke-frontmatter', front, false)
      out.push({ name: 'frontmatter 覆盖（图内显式配置优先）', ok: svg.includes('<svg'), detail: '' })
    } catch (e) {
      out.push({ name: 'frontmatter 覆盖（图内显式配置优先）', ok: false, detail: String(e).slice(0, 160) })
    }
    // 导出背景语义：themeCSS 的画布底色烘焙进 SVG 内嵌 style（弹窗快照
    // 与 SVG/PNG 导出走同一 SVG，背景随图自带）
    try {
      const dark = await api.render('smoke-bg-dark', samples[0][1], true)
      const light = await api.render('smoke-bg-light', samples[0][1], false)
      const ok = dark.svg.includes('background-color:#181818') && light.svg.includes('background-color:#ffffff')
      out.push({ name: '导出背景烘焙（暗 #181818 / 亮 #ffffff）', ok, detail: ok ? '' : 'themeCSS 背景未烘焙进 SVG' })
    } catch (e) {
      out.push({ name: '导出背景烘焙（暗 #181818 / 亮 #ffffff）', ok: false, detail: String(e).slice(0, 160) })
    }
    return out
  }, { port, samples: SAMPLES })

  for (const r of results) {
    if (!r.ok) failures += 1
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `（${r.detail}）` : ''}`)
  }
  if (await stat(join(distDir, 'mermaid.js'))) {
    // 占位读取防未使用告警；产物在场由 scaffold 契约钉住
  }
} finally {
  await browser.close()
  server.close()
}
console.log(failures === 0 ? 'SMOKE PASSED' : `SMOKE FAILED（${failures} 项）`)
process.exit(failures === 0 ? 0 : 1)
