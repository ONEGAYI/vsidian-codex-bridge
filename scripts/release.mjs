// 发布打包脚本（票 #4）：compile → VSIX 打包 → 内容/体积红线检查 → 解包
// manifest 冒烟。发行渠道决策见 docs/adr/0004：首期 GitHub Release VSIX
// 分发，本脚本只产本地 VSIX——不提供任何上传/发布路径（无 marketplace /
// gh release 通道），真实发行（GitHub Release 附 VSIX）是人工动作，需
// 用户明确授权后执行；显式拒绝 --upload/--publish 是该边界的代码化。
//
//   npm run package    # compile + 打包 + 检查 + 冒烟（只产本地 VSIX）
//
// 打包命令与 CI 的 VSIX 步骤同款：npx @vscode/vsce package
// --no-dependencies（esbuild bundle 自包含，无运行时 node_modules；vsce
// 经 package.json 的 vscode:prepublish 自动重建三产物——本地与 CI 双保险）。
// 版本发布流程（bump + re-vendor 联动）无脚本化：本仓无 CHANGELOG 机制，
// 版本号 bump 人工编辑 package.json，联动清单见 README「安装与升级」。
//
// 纯函数（parseUnzipListing / parsePszListing / inspectVsixEntries /
// inspectVsixManifest）由 test/release.test.ts 契约测试钉住，形态对齐
// 参照仓 vsidian-easy-typing 的 scripts/release.mjs（源头是 vsidian 主仓
// scripts/release.mjs）。

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SIZE_LIMITS = {
  // 解压总量：2026-10-16 基线约 4.2 MB / 82 文件（dist 三主产物约 34 KB +
  // 76 个 mermaid 分块约 3.93 MB + manifest/readme/license 约 10 KB）。
  // Mermaid 分块是已知大头（版本线逐字对齐上游本体，ADR-0003 决策一），
  // 红线语义是「防意外塞进大文件/依赖」而非精确预算：警告线 8 MB 留约
  // 一倍余量容纳 mermaid/ELK 版本线随上游升级，失败线 16 MB 拦截「双
  // 大头」形态（mermaid 意外内联进 editor.js 或误引入第二份运行时依赖）。
  totalWarnBytes: 8 * 1024 * 1024,
  totalMaxBytes: 16 * 1024 * 1024,
  // 单文件：最大项是 ELK render 分块，基线约 1.4 MB；警告线 3 MB 容纳
  // 版本线升级的正常增长，失败线 6 MB 拦截异常体积。
  fileWarnBytes: 3 * 1024 * 1024,
  fileMaxBytes: 6 * 1024 * 1024,
}

// 必需结构文件：VSIX 根（统一按小写 basename 匹配，实测形态
// [Content_Types].xml 大小写混合）。
const REQUIRED_ROOT = ['extension.vsixmanifest', '[content_types].xml']

// 必需运行时资产：vsce 自动打入的 manifest/readme/license + dist 三主
// 产物。mermaid-chunks/ 分块目录另行做非空断言（分块数量与散列随构建
// 变化，不逐个枚举）。
const REQUIRED_RUNTIME = [
  'package.json',
  'readme.md', // vsce 对仓库 README.md 自动打入（实测小写形态）
  'license', // 实测形态 LICENSE.txt，前缀匹配兜底
  'dist/extension.js',
  'dist/editor.js',
  'dist/mermaid.js',
]

// Mermaid esm 分块目录前缀（esbuild splitting 产物，装载锚是
// dist/mermaid.js——零分块即 splitting 失效或清理后未重建，包不可用）。
const CHUNKS_PREFIX = 'dist/mermaid-chunks/'

// 禁止模式：仓库管理与开发文件一律不得进入 VSIX（大小写不敏感），与
// .vscodeignore 黑名单同源——.vscodeignore 挡打包输入，这里挡最终产物。
const FORBIDDEN_PATTERNS = [
  [/^extension\/\.github\//, 'GitHub 平台配置'],
  [/\/\.git(\/|$)/, '.git 目录'],
  [/node_modules/, 'node_modules'],
  [/^extension\/src\//, 'TypeScript 源码'],
  [/^extension\/test\//, '测试'],
  [/^extension\/types\//, 'vendor 类型快照'],
  [/^extension\/tools\//, '构建桥'],
  [/^extension\/scripts\//, '仓库脚本'],
  [/^extension\/docs\//, '项目文档'],
  [/\.map$/, 'sourcemap'],
  [/\.tsx?$/, 'TypeScript 源文件'],
  [/package-lock\.json$/, 'npm lockfile'],
  [/\.vsix$/, 'VSIX 嵌套'],
  [/\.log$/, '日志'],
]

// extension/ 下顶层白名单：git 忽略不等于 vsce 排除（工具残留可混入包内
// 且黑名单拦不住），未知顶层条目一律拒绝；dist/ 内未登记产物同样拒绝
// （构建实验残留），mermaid-chunks/ 前缀放行（散列随构建变化）。新增
// 根级运行时资产须同步登记此处与 REQUIRED_RUNTIME。
const ALLOWED_TOP = new Set([
  'dist',
  'package.json',
  'readme.md',
  'license',
  'license.txt',
])
// dist/ 白名单 = 登记的运行时产物 + mermaid-chunks/ 前缀（散列分块随
// 构建变化，不逐个枚举）
const ALLOWED_DIST = new Set(REQUIRED_RUNTIME.filter((rel) => rel.startsWith('dist/')))
const isAllowedDist = (rel) => ALLOWED_DIST.has(rel) || rel.startsWith(CHUNKS_PREFIX)

/** 解析 `unzip -l` 输出为条目列表（name 含 `extension/` 前缀）。 */
export function parseUnzipListing(text) {
  const entries = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+(.+)$/)
    if (m) entries.push({ size: Number(m[1]), name: m[2].trim() })
  }
  return entries
}

/** 解析 PowerShell ZipFile.OpenRead 输出（「大小\t路径」行，Windows 回退通道）。 */
export function parsePszListing(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.includes('\t'))
    .map((l) => {
      const [size, ...rest] = l.split('\t')
      return { size: Number(size), name: rest.join('\t') }
    })
}

/**
 * 检查 VSIX 条目：必需项齐全（含分块目录非空）、无禁止文件、白名单外
 * 无多余条目、体积在阈值内。
 * @param {{size:number,name:string}[]} entries VSIX 内全部条目
 * @returns {{ok:boolean,errors:string[],warnings:string[],totalBytes:number}}
 */
export function inspectVsixEntries(entries) {
  const errors = []
  const warnings = []
  const totalBytes = entries.reduce((sum, e) => sum + e.size, 0)
  const lowerNames = entries.map((e) => e.name.toLowerCase())

  for (const root of REQUIRED_ROOT) {
    if (!lowerNames.includes(root)) errors.push(`缺少结构文件 ${root}`)
  }
  for (const rel of REQUIRED_RUNTIME) {
    if (rel === 'license') {
      const hit = lowerNames.some((n) => /^extension\/license(\.txt)?$/.test(n))
      if (!hit) errors.push('缺少 LICENSE（打包后应为 extension/LICENSE*）')
    } else if (!lowerNames.includes(`extension/${rel.toLowerCase()}`)) {
      errors.push(`缺少运行时资产 extension/${rel}`)
    }
  }
  // Mermaid 分块非空：入口在场但零分块 = splitting 失效或 chunks 目录被
  // 清理后未重建（build.mjs 构建前清旧分块防散列残留），运行时按需加载
  // 必然 404
  if (!lowerNames.some((n) => n.startsWith(`extension/${CHUNKS_PREFIX}`))) {
    errors.push(`缺少 ${CHUNKS_PREFIX} 分块（mermaid splitting 失效或分块未随包）`)
  }

  for (const e of entries) {
    const lower = e.name.toLowerCase()
    // 顶层白名单：拦「多」出来的根级条目
    if (/^extension\//.test(lower)) {
      const rel = lower.slice('extension/'.length)
      const top = rel.split('/')[0]
      if (top && !ALLOWED_TOP.has(top)) {
        errors.push(`未知顶层条目 ${e.name}（新根级资产须登记白名单；本地工具/日志应进 .vscodeignore 排除）`)
        continue
      }
      // dist/ 白名单：拦构建实验残留；mermaid-chunks/ 散列分块放行
      if (rel.startsWith('dist/') && !isAllowedDist(rel)) {
        errors.push(`dist/ 未登记产物 ${e.name}（新产物须登记 REQUIRED_RUNTIME）`)
      }
    }
    for (const [pattern, label] of FORBIDDEN_PATTERNS) {
      if (pattern.test(lower)) errors.push(`禁止文件 ${e.name}（${label}）`)
    }
  }

  if (totalBytes > SIZE_LIMITS.totalMaxBytes) {
    errors.push(`解压总体积 ${(totalBytes / 1048576).toFixed(2)} MB 超过上限 ${SIZE_LIMITS.totalMaxBytes / 1048576} MB`)
  } else if (totalBytes > SIZE_LIMITS.totalWarnBytes) {
    warnings.push(`解压总体积 ${(totalBytes / 1048576).toFixed(2)} MB 超过警告线 ${SIZE_LIMITS.totalWarnBytes / 1048576} MB`)
  }

  for (const e of entries) {
    if (e.size > SIZE_LIMITS.fileMaxBytes) {
      errors.push(`单文件 ${e.name} 为 ${(e.size / 1048576).toFixed(2)} MB，超过上限`)
    } else if (e.size > SIZE_LIMITS.fileWarnBytes) {
      warnings.push(`单文件 ${e.name} 为 ${(e.size / 1024).toFixed(0)} KB，超过警告线`)
    }
  }

  return { ok: errors.length === 0, errors, warnings, totalBytes }
}

/**
 * 解包冒烟的 manifest 校验：VSIX 内 extension/package.json 合法，且关键
 * 声明与仓库清单一致——version（打包时版本漂移）、main 入口、
 * extensionDependencies（宿主依赖）、vsidianAddon（附加组件身份声明，
 * 宿主发现机制的入口）。
 */
export function inspectVsixManifest(manifestText, repoPkg) {
  const errors = []
  let manifest = null
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    return { ok: false, errors: ['VSIX 内 extension/package.json 非合法 JSON'], warnings: [], totalBytes: 0 }
  }
  if (manifest.name !== repoPkg.name) errors.push(`manifest name 为 ${manifest.name}，与仓库 ${repoPkg.name} 不一致`)
  if (manifest.publisher !== repoPkg.publisher) errors.push(`manifest publisher 为 ${manifest.publisher}，与仓库 ${repoPkg.publisher} 不一致`)
  if (manifest.version !== repoPkg.version) errors.push(`manifest version 为 ${manifest.version}，与仓库 package.json 的 ${repoPkg.version} 不一致（版本漂移）`)
  if (manifest.main !== repoPkg.main) errors.push(`manifest main 为 ${manifest.main}，与仓库 ${repoPkg.main} 不一致`)
  const deps = JSON.stringify(manifest.extensionDependencies ?? [])
  if (deps !== JSON.stringify(repoPkg.extensionDependencies)) {
    errors.push(`manifest extensionDependencies 为 ${deps}，与仓库声明 ${JSON.stringify(repoPkg.extensionDependencies)} 不一致（宿主依赖声明）`)
  }
  if (JSON.stringify(manifest.vsidianAddon ?? null) !== JSON.stringify(repoPkg.vsidianAddon)) {
    errors.push('manifest vsidianAddon 身份声明缺失或与仓库不一致（宿主发现机制的入口）')
  }
  return { ok: errors.length === 0, errors, warnings: [], totalBytes: 0 }
}

/** 列出 zip 内容；优先 unzip（CI Linux / Git Bash），Windows 回退 PowerShell。 */
function listZipEntries(vsixPath) {
  const unzip = spawnSync('unzip', ['-l', vsixPath], { encoding: 'utf8' })
  if (unzip.status === 0 && unzip.stdout) return parseUnzipListing(unzip.stdout)
  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      "$z=[System.IO.Compression.ZipFile]::OpenRead($args[0])",
      'foreach($e in $z.Entries){ Write-Output ($e.Length.ToString() + "`t" + $e.FullName) }',
      '$z.Dispose()',
    ].join('; ')
    const out = spawnSync('powershell', ['-NoProfile', '-Command', ps, vsixPath], { encoding: 'utf8' })
    if (out.status !== 0) throw new Error(`无法读取 VSIX 内容：${out.stderr || 'unzip 与 PowerShell 均失败'}`)
    return parsePszListing(out.stdout)
  }
  throw new Error(`无法读取 VSIX 内容：${unzip.stderr || 'unzip 不可用'}`)
}

/** 读取 zip 内单文件文本（manifest 冒烟用）；通道回退逻辑同 listZipEntries。 */
function readZipEntry(vsixPath, entryName) {
  const unzip = spawnSync('unzip', ['-p', vsixPath, entryName], { encoding: 'utf8' })
  if (unzip.status === 0) return unzip.stdout
  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      "$z=[System.IO.Compression.ZipFile]::OpenRead($args[0])",
      `foreach($e in $z.Entries){ if($e.FullName -eq '${entryName}'){ $r=New-Object System.IO.StreamReader($e.Open()); Write-Output $r.ReadToEnd(); $r.Dispose() } }`,
      '$z.Dispose()',
    ].join('; ')
    const out = spawnSync('powershell', ['-NoProfile', '-Command', ps, vsixPath], { encoding: 'utf8' })
    if (out.status !== 0 || !out.stdout) throw new Error(`无法读取 VSIX 内 ${entryName}：${out.stderr || 'unzip 与 PowerShell 均失败'}`)
    return out.stdout
  }
  throw new Error(`无法读取 VSIX 内 ${entryName}：${unzip.stderr || 'unzip 不可用'}`)
}

function readRepoPkg(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  return {
    name: pkg.name,
    publisher: pkg.publisher,
    version: pkg.version,
    main: pkg.main,
    extensionDependencies: pkg.extensionDependencies,
    vsidianAddon: pkg.vsidianAddon,
  }
}

/** 打包 + 内容/体积检查 + 解包冒烟。日常入口（npm run package）。 */
function runPackage(root) {
  const pkg = readRepoPkg(root)

  console.log('打包 VSIX（vsce --no-dependencies，vscode:prepublish 自动重建三产物）…')
  // Windows 上 npx 是 .cmd，必须经 shell；参数拼接为整条命令避免 DEP0190
  // （args+shell 组合）。@vscode/vsce 钉精确版本进 devDependencies，npx
  // 优先解析本地安装——与 CI 同源，不受 npx 浮动下载新版本影响
  const vsce = spawnSync('npx vsce package --no-dependencies', { cwd: root, encoding: 'utf8', shell: true })
  if (vsce.status !== 0) {
    console.error(vsce.stdout)
    console.error(vsce.stderr)
    process.exitCode = 1
    return
  }
  if (vsce.stdout) process.stdout.write(vsce.stdout)

  const vsixName = `${pkg.name}-${pkg.version}.vsix`
  const vsixPath = path.join(root, vsixName)
  if (!existsSync(vsixPath)) {
    console.error(`打包完成但未找到 ${vsixPath}`)
    process.exitCode = 1
    return
  }

  const entries = listZipEntries(vsixPath)
  const result = inspectVsixEntries(entries)
  const chunkCount = entries.filter((e) => e.name.toLowerCase().startsWith(`extension/${CHUNKS_PREFIX}`)).length
  console.log(`VSIX 共 ${entries.length} 个文件（mermaid 分块 ${chunkCount} 个），解压 ${(result.totalBytes / 1048576).toFixed(2)} MB（${vsixName}）`)
  for (const w of result.warnings) console.warn(`警告：${w}`)
  if (!result.ok) {
    for (const e of result.errors) console.error(`检查失败：${e}`)
    process.exitCode = 1
    return
  }
  console.log('包内容检查通过（必需清单 / 分块非空 / 禁止模式 / 体积阈值）')

  // 解包冒烟：manifest 合法性与关键声明核对（version/main/
  // extensionDependencies/vsidianAddon）。真宿主安装验证另由
  // npm run test:host 承载（下界宿主 1.82.3 装载实测），本脚本不模拟安装。
  const manifestText = readZipEntry(vsixPath, 'extension/package.json')
  const manifestResult = inspectVsixManifest(manifestText, pkg)
  if (!manifestResult.ok) {
    for (const e of manifestResult.errors) console.error(`冒烟失败：${e}`)
    process.exitCode = 1
    return
  }
  console.log('解包冒烟通过（manifest 合法、version/main/extensionDependencies/vsidianAddon 声明一致）')

  console.log('发行护栏提醒：本脚本只产本地 VSIX、无上传路径；对外发布（GitHub Release 附 VSIX）是人工动作，需用户明确授权后执行')
  return vsixPath
}

function main() {
  const argv = process.argv.slice(2)

  // 发行护栏的代码化边界：显式拒绝任何上传意图（本脚本无上传路径）
  if (argv.includes('--upload') || argv.includes('--publish')) {
    console.error('本脚本不提供上传/发布路径（无上传通道）：对外发布是人工动作，需用户明确授权后执行；脚本仅产本地 VSIX')
    process.exitCode = 1
    return
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const command = argv.find((a) => !a.startsWith('--')) ?? 'package'

  if (command === 'package') {
    runPackage(root)
  } else {
    console.error(`未知子命令 ${command}。用法：node scripts/release.mjs [package]（版本 bump 人工编辑 package.json，联动清单见 README「安装与升级」）`)
    process.exitCode = 1
  }
}

// 仅在直接执行（node scripts/release.mjs）时跑主流程；契约测试 import 纯函数不触发
if (process.argv[1] && path.resolve(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main()
}
