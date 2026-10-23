// 真宿主安装验证入口（票 #4 常驻宿主测试基建层，衔接 #3 遗留项）：
//
//   npm run test:host -- --host <vsidian仓根>
//
// 流程：构建验证套件（esbuild → .vscode-test/host-suite/suite.js）→ 定位
// vsidian 宿主产物（--host / VSIDIAN_HOST_OUT，自检含 batch-2 主题 API 面）
// → 定位/下载 VSCode 1.82.3（下界宿主）→ 生成临时工作区（单 folder
// .code-workspace，multi-root 形态起步——上游 #198 教训：目录形态下增根
// 触发 window reload 中断套件）→ 经 silentHost.mjs（上游 testHost.mjs
// 适配版）在**独立桌面**静默启动宿主：--extensionTestsPath 装载套件、
// --extensionDevelopmentPath 同时装载 vsidian 宿主与本组件 dist 产物
// （extensionDependencies 在开发装载下不经市场解析，两侧都显式给路径）
// → 报告落盘 .vscode-test/host-check.log → 退出码透传。
// 静默性：Windows 默认 desktop 模式（VSIDIAN_TEST_HOST_MODE 可显式
// foreground / desktop），宿主窗口只存在于测试桌面，用户桌面不可见；
// 结束时的「可见窗口峰值 / 前台 PID」证据行随报告落盘。非 Windows 无
// 隔离后端，入口预检直接拒绝（PR #5 约定统一，见 silentHost.mjs）。
// 本仓后续一切宿主层验证默认走本通道（常驻基建，见 ADR-0004）。
import { build } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTestHost, resolveTestHostMode } from './silentHost.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const cacheDir = path.join(repoRoot, '.vscode-test')
const reportPath = path.join(cacheDir, 'host-check.log')

function fail(message) {
  console.error(`[host-check] ${message}`)
  process.exitCode = 1
}

/** 定位 vsidian 宿主仓根：--host 参数 > VSIDIAN_HOST_OUT 环境变量。 */
function resolveHostRoot(args) {
  const flag = args.indexOf('--host')
  const fromFlag = flag >= 0 ? args[flag + 1] : undefined
  const root = fromFlag || process.env.VSIDIAN_HOST_OUT
  if (!root) {
    fail('未指定 vsidian 宿主仓根：用法 npm run test:host -- --host <vsidian仓根>（或环境变量 VSIDIAN_HOST_OUT）。宿主仓须含构建产物 out/extension.js——vendor 锚定提交 80dfc285（API 1.1.0 发行）或更新的构建')
    return null
  }
  if (!existsSync(path.join(root, 'out', 'extension.js'))) {
    fail(`${root} 下无 out/extension.js——先用该仓构建（npm run vscode:prepublish）；须为 80dfc285（API 1.1.0 发行）或更新（含 batch-2 主题 API）`)
    return null
  }
  // 自检 batch-2 面在场：主题目录观测钩子是套件断言入口，旧宿主（如
  // 0e5d5bc7 工作树产物）没有该命令——用旧宿主跑会得到假红（钩子缺席）
  const hostBundle = readFileSync(path.join(root, 'out', 'extension.js'), 'utf8')
  if (!hostBundle.includes('_test.addonThemes')) {
    fail(`${root} 的 out/extension.js 不含 _test.addonThemes——宿主产物早于 batch-2（主题注册 API 面 2026-10-16 随 PR #564 合入），请用 80dfc285（API 1.1.0 发行）或更新构建`)
    return null
  }
  // 自检 #629 探针分桶修复在场：套件断言③消费 renderers.addonSvg（组件
  // SVG 在场数），早于 c1ae8410 的宿主产物无该字段——接管断言会 60s 超时
  // 假红，提前给出可行动报错（发布时序：该修复随 vsidian v1.4.0 之后版本
  // 发行，本套件只对含修复的构建运行）
  if (!hostBundle.includes('addonSvg')) {
    fail(`${root} 的 out/extension.js 不含 addonSvg——宿主产物早于 #629 探针分桶修复（vsidian PR #644，merge c1ae8410，随 v1.4.0 之后版本发行）。套件「组件渲染器接管」断言依赖 renderers.addonSvg，请用含该修复的构建`)
    return null
  }
  return root
}

/** 定位 VSCode 1.82.3 可执行文件：env 覆盖 > 本仓缓存 > vsidian 源仓缓存 > 在线下载。 */
async function resolveExecutable() {
  if (process.env.VSIDIAN_TEST_VSCODE_PATH) {
    return process.env.VSIDIAN_TEST_VSCODE_PATH
  }
  if (process.platform === 'win32') {
    const exe = 'Code.exe'
    const archive = path.join('vscode-win32-x64-archive-1.82.3', exe)
    // 缓存候选：本仓 .vscode-test/，及 vsidian 源仓（VSIDIAN_SOURCE_REPO
    // > 同级布局，vendor 脚本同款定位序）的 .vscode-test/——上游集成测试
    // 的下载缓存直接复用，首次运行免下载
    const sourceRepo = process.env.VSIDIAN_SOURCE_REPO
      || path.join(repoRoot, '..', 'vscode-obsidian-like-editor')
    const candidates = [
      path.join(cacheDir, archive),
      path.join(sourceRepo, '.vscode-test', archive),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        console.log(`[host-check] 复用已缓存宿主 ${candidate}`)
        return candidate
      }
    }
  }
  const { downloadAndUnzipVSCode } = await import('@vscode/test-electron')
  console.log('[host-check] 本地无 1.82.3 缓存，下载中（约 130 MB，仅首次）…')
  return downloadAndUnzipVSCode({ version: '1.82.3' })
}

async function main() {
  const args = process.argv.slice(2)
  // 静默模式预检（PR #5 约定统一）：非 Windows 无隔离后端直接拒绝——
  // 提前到下载 VSCode（约 130MB）与构建套件之前，失败原因立即可见
  resolveTestHostMode()
  const hostRoot = resolveHostRoot(args)
  if (!hostRoot) return

  for (const artifact of ['dist/extension.js', 'dist/editor.js', 'dist/mermaid.js']) {
    if (!existsSync(path.join(repoRoot, artifact))) {
      fail(`${artifact} 缺失——先 npm run compile（test:host 不代跑构建，保持与 CI 步骤链同源）`)
      return
    }
  }

  console.log('[host-check] 构建验证套件（esbuild → .vscode-test/host-suite/suite.js）…')
  await build({
    entryPoints: [path.join(repoRoot, 'test', 'host', 'suite.ts')],
    outfile: path.join(cacheDir, 'host-suite', 'suite.js'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: false,
    logLevel: 'silent',
    external: ['vscode'],
  })

  const executable = await resolveExecutable()
  console.log(`[host-check] 宿主 ${executable}`)
  console.log(`[host-check] vsidian 宿主产物 ${hostRoot}`)

  // 临时工作区：单 folder 的 .code-workspace（multi-root 形态起步，上游
  // #198 教训——目录形态下工作区根增删触发 window reload 使 ext host 退出）
  const wsDir = mkdtempSync(path.join(tmpdir(), 'bridge-host-check-'))
  const wsFile = `${wsDir}.code-workspace`
  writeFileSync(wsFile, `${JSON.stringify({ folders: [{ path: wsDir.split(path.sep).join('/') }] }, null, 2)}\n`, 'utf8')
  const runDir = path.join(cacheDir, `host-run-${Date.now()}`)
  rmSync(runDir, { recursive: true, force: true })

  const suitePath = path.join(cacheDir, 'host-suite', 'suite.js')
  const launchArgs = [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--no-cached-data',
    '--disable-workspace-trust',
    `--extensionTestsPath=${suitePath}`,
    // development path 可重复传递（CLI 多值）：vsidian 宿主 + 本组件同宿主装载
    `--extensionDevelopmentPath=${hostRoot}`,
    `--extensionDevelopmentPath=${repoRoot}`,
    `--extensions-dir=${path.join(runDir, 'extensions')}`,
    `--user-data-dir=${path.join(runDir, 'user-data')}`,
    wsFile,
  ]

  console.log(`[host-check] 静默启动下界宿主 VSCode 1.82.3（独立桌面，报告 ${reportPath}）…`)
  const code = await runTestHost({
    executable,
    args: launchArgs,
    env: { ...process.env, VSIDIAN_TEST_HOOKS: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' },
    timeoutMs: 5 * 60_000,
    reportPath,
  })
  rmSync(wsDir, { recursive: true, force: true })
  rmSync(wsFile, { force: true })
  rmSync(runDir, { recursive: true, force: true })

  if (code === 0) {
    console.log(`[host-check] 真宿主安装验证通过（退出码 0，报告 ${reportPath}——末尾「可见窗口峰值/前台 PID」行为静默性证据）`)
  } else {
    fail(`真宿主安装验证失败（退出码 ${code}），报告 ${reportPath}`)
  }
}

main().catch((error) => {
  fail(`启动异常：${error instanceof Error ? error.stack : String(error)}`)
})
