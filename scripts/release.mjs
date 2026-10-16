// 发布脚本（票 #4 + 发布链路升级）：package 子命令 = compile → VSIX 打包 →
// 内容/体积红线检查 → 解包 manifest 冒烟（只产本地 VSIX）；release 子命令
// = 以上全链 + 创建 GitHub Release 附带 VSIX。发行渠道决策见 docs/adr/0004
// （2026-10-16 用户决策变更）：GitHub Release + VSCode Marketplace 双通道，
// Release 由本脚本创建（gh release create，经 GH_TOKEN 认证），Marketplace
// 由 release.yml 工作流从 Release 下载同一份 VSIX 发布——同一份字节。
//
//   npm run package   # compile + 打包 + 红线 + 冒烟（本地日常）
//   npm run release   # 以上全链 + gh release create 附 VSIX（CI 推 tag 触发）
//
// 发布的保护语义（对齐上游 vsidian 主仓 release.mjs，按本仓形态适配为
// 子命令）：release 只在「工作树干净（--allow-dirty 显式豁免）+ CHANGELOG
// 最新版本段与 package.json version 一致 + HEAD 精确命中 v<version> 标签 +
// GH_TOKEN 在场 + Release 不存在」全过时执行——不允许在错误对象上发布；
// Release 已存在时先读状态报错退出，不覆盖。旧 --upload/--publish 旗标是
// 无发布通道时期（ADR-0004 原决策）的拒绝面，现已废弃：显式报错并指引
// release 子命令。
//
// 打包命令与 CI 的 VSIX 步骤同款：npx @vscode/vsce package
// --no-dependencies（esbuild bundle 自包含，无运行时 node_modules；vsce
// 经 package.json 的 vscode:prepublish 自动重建三产物——本地与 CI 双保险）。
// 版本发布流程：CHANGELOG.md 记录面向用户的变更（Keep a Changelog 结构，
// 本仓无 Unreleased 转正工具——发版提交把新条目人工写进新版本段并 bump
// package.json），随后打 v<version> 标签推送触发 release.yml。
//
// 纯函数（parseUnzipListing / parsePszListing / inspectVsixEntries /
// inspectVsixManifest / mergeSoftWraps / extractLatestChangelog /
// checkReleasePreconditions）由 test/release.test.ts 契约测试钉住，形态
// 对齐上游 vsidian 主仓 scripts/release.mjs（提取/合并函数自其移植，
// 本仓适配：尾部变更链接注释不卷入版本段——首版即最老版本段）。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

// 必需运行时资产：vsce 自动打入的 manifest/readme/changelog/license + dist
// 三主产物。mermaid-chunks/ 分块目录另行做非空断言（分块数量与散列随构建
// 变化，不逐个枚举）。CHANGELOG.md 随包（发布链路升级起）：VSCode 扩展
// 详情页 Changelog 标签页的数据源。
const REQUIRED_RUNTIME = [
  'package.json',
  'readme.md', // vsce 对仓库 README.md 自动打入（实测小写形态）
  'changelog.md', // vsce 对仓库 CHANGELOG.md 自动打入（实测小写形态）
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
  'changelog.md',
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

/**
 * 合并段内软换行：CHANGELOG 源文件的条目折行原样进入 GitHub Release
 * 说明后，渲染时断成锯齿短行并在中文行间并入空格——发布说明的消费方
 * 是网页。空行、列表项、标题、引用与编号列表等结构边界保留换行；其余
 * 行拼接到上一行，拼接双方都是 ASCII 字母/数字时补一个空格，CJK 相接
 * 直接拼接。HTML 注释块（CHANGELOG 尾部的变更链接区）整体原样保留。
 * （自上游 vsidian 主仓 scripts/release.mjs 移植，语义不改。）
 */
export function mergeSoftWraps(body) {
  const out = []
  let inComment = false
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (inComment) {
      out.push(line)
      if (line.includes('-->')) inComment = false
      continue
    }
    if (line.includes('<!--') && !line.includes('-->')) {
      inComment = true
      out.push(line)
      continue
    }
    if (line === '' || /^([-*+]|\d+[.)])\s/.test(line) || /^#{1,6}\s/.test(line) || /^>/.test(line)) {
      out.push(line)
      continue
    }
    const prev = out[out.length - 1]
    if (prev === undefined || prev === '') {
      out.push(line)
    } else {
      // 拼接点补空格的判据：ASCII 词界与中英混排边界（两个方向）都留
      // 一个空格；CJK 相接与任一侧标点直接拼接。
      const ascii = /[A-Za-z0-9]/
      const cjk = /[\u3400-\u4dbf\u4e00-\u9fff]/
      const prevEnd = prev[prev.length - 1]
      const firstChar = line[0]
      const needSpace =
        (ascii.test(prevEnd) && ascii.test(firstChar)) ||
        (cjk.test(prevEnd) && ascii.test(firstChar)) ||
        (ascii.test(prevEnd) && cjk.test(firstChar))
      out[out.length - 1] = needSpace ? `${prev} ${line}` : prev + line
    }
  }
  return out.join('\n')
}

/**
 * 提取 CHANGELOG.md 最新版本段落（GitHub Release 发布说明的来源）。
 * 顶部常驻的 `## Unreleased` 开发段跳过（只认 `## <x.y.z>` 版本段，方括号
 * 形态 `## [0.1.0]` 与裸形态 `## 0.1.0` 均可）——发布说明不混入开发中
 * 内容（跳过语义与上游 vsidian 主仓同一函数一致；本仓无自动转正工具，
 * 发版提交把新条目人工写进新版本段）。段体边界停在下一个 `## ` 段头或
 * HTML 注释块起点（Keep a Changelog 尾部的变更链接区不属于任何版本段；
 * 上游函数不拦注释——其发布永远从最新段提取、下方还有更老版本段垫着，
 * 本仓首版即最老版本段，注释会紧贴其后，故显式排除）。
 * @throws 最新版本段落与 expectedVersion 不符、或找不到版本段落时抛错。
 */
export function extractLatestChangelog(content, expectedVersion) {
  const lines = content.split(/\r?\n/)
  let start = -1
  let version = null
  let date = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## (\[?[^\s\]]+\]?)\s*(?:-\s*(.*))?$/)
    if (!m) continue
    const token = m[1].replace(/^\[|\]$/g, '')
    if (!/^\d+\.\d+\.\d+$/.test(token)) continue
    start = i
    version = token
    date = (m[2] || '').trim() || null
    break
  }
  if (start < 0) throw new Error('CHANGELOG.md 中未找到任何 `## <版本>` 段落')
  if (version !== expectedVersion) {
    throw new Error(`CHANGELOG 最新段落为 ${version}，与 package.json 的 ${expectedVersion} 不一致`)
  }
  const bodyEnd = lines.findIndex((l, i) => i > start && (/^## /.test(l) || /^<!--/.test(l)))
  const body = lines.slice(start + 1, bodyEnd < 0 ? lines.length : bodyEnd).join('\n').trim()
  return { version, date, body: mergeSoftWraps(body) }
}

/**
 * 发布前置校验（纯函数）：tag 精确命中 / gh 认证 / 不覆盖既有 Release。
 * 全过才允许走 gh release create——「不允许在错误对象上发布」的代码化。
 * @param {{
 *   version: string        // package.json 的 version
 *   headTag: string|null   // git describe --tags --exact-match HEAD 的结果（无精确命中为 null）
 *   ghToken?: string       // GH_TOKEN 环境变量（gh release create 认证）
 *   releaseExists?: boolean|undefined // Release 存在性探测结果（未探测为 undefined，不算通过也不算失败）
 * }} pre
 * @returns {{ok:boolean,errors:string[]}}
 */
export function checkReleasePreconditions({ version, headTag, ghToken, releaseExists }) {
  const errors = []
  const tag = `v${version}`
  if (headTag !== tag) {
    errors.push(`HEAD 未打 ${tag} 标签（当前 ${headTag || '无'}）。发布只允许在精确命中 v<version> 的提交上执行：先提交并 git tag ${tag} 再发布`)
  }
  if (!ghToken) {
    errors.push('GH_TOKEN 未设置：创建 GitHub Release 需要 gh 认证（CI 由工作流注入 github.token；本地需导出具有 contents:write 权限的 token）')
  }
  if (releaseExists) {
    errors.push(`Release ${tag} 已存在：不覆盖既有发布——先 gh release view ${tag} 人工核对内容，确需重发先删除并明确后果`)
  }
  return { ok: errors.length === 0, errors }
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

/** git 子命令包装：失败抛错（发布链路对 git 不可用 fail-closed）。 */
function git(args) {
  const out = spawnSync('git', args, { encoding: 'utf8' })
  if (out.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${out.stderr}`)
  return out.stdout.trim()
}

/** HEAD 是否精确命中某标签：命中返回标签名，未命中返回 null（不抛错——
 * 非 tag 状态是发布前置校验的一个可报错分支，不是意外）。 */
function describeExactHeadTag() {
  const out = spawnSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], { encoding: 'utf8' })
  return out.status === 0 ? out.stdout.trim().split('\n')[0] : null
}

/**
 * 发布链路：前置校验（干净树 / CHANGELOG 版本段 / tag 命中 / GH_TOKEN /
 * Release 不存在）→ 打包 + 红线 + 冒烟（复用 runPackage）→ gh release
 * create 附 VSIX，--notes-file 写入 CHANGELOG 完整版本段。
 * 任一前置不过即明确报错退出——不允许在错误对象上发布。
 */
function runRelease(root) {
  const argv = process.argv.slice(2)
  const pkg = readRepoPkg(root)
  const tag = `v${pkg.version}`

  // 前置一：工作树干净（打包内容必须与被打标签的提交一致；--allow-dirty
  // 显式豁免并自担「包内容可能与提交不符」的后果）
  if (!argv.includes('--allow-dirty') && git(['status', '--porcelain']) !== '') {
    console.error('工作树不干净：先提交或 stash，或用 --allow-dirty 明确跳过（打包内容可能与提交不符）')
    process.exitCode = 1
    return
  }

  // 前置二：CHANGELOG 最新版本段与 package.json version 一致（Release
  // 说明来源；发版提交遗漏 bump 或忘记写版本段在此拦截）
  let notes
  try {
    notes = extractLatestChangelog(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), pkg.version)
  } catch (err) {
    console.error(`CHANGELOG 发布说明提取失败：${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
    return
  }
  console.log(`CHANGELOG ${notes.version}${notes.date ? `（${notes.date}）` : ''} 版本段提取成功，${notes.body.length} 字符（作为 Release 说明）`)

  // 前置三/四（静态）：HEAD 精确命中 v<version> 标签 + GH_TOKEN 在场
  const headTag = describeExactHeadTag()
  const staticCheck = checkReleasePreconditions({ version: pkg.version, headTag, ghToken: process.env.GH_TOKEN })
  if (!staticCheck.ok) {
    for (const e of staticCheck.errors) console.error(`发布前置不满足：${e}`)
    process.exitCode = 1
    return
  }

  // 前置五：Release 已存在则拒绝（不覆盖）；探测本身失败（网络/权限）也
  // fail-closed 退出，不在状态未知的 Release 对象上执行发布
  let releaseExists = false
  const view = spawnSync(`gh release view ${tag}`, { cwd: root, encoding: 'utf8', shell: true })
  if (view.status === 0) {
    releaseExists = true
  } else if (!/not found|未找到|404/i.test(view.stderr || '')) {
    console.error(`Release ${tag} 状态探测失败（无法确认可安全发布）：${view.stderr || view.stdout || 'gh 无输出'}`)
    process.exitCode = 1
    return
  }
  const existCheck = checkReleasePreconditions({ version: pkg.version, headTag, ghToken: process.env.GH_TOKEN, releaseExists })
  if (!existCheck.ok) {
    for (const e of existCheck.errors) console.error(`发布前置不满足：${e}`)
    process.exitCode = 1
    return
  }

  // 打包 + 红线 + manifest 冒烟（失败时 runPackage 已置退出码）
  const vsixPath = runPackage(root)
  if (!vsixPath || process.exitCode) return

  // gh release create：--notes-file 写入完整版本段（CHANGELOG 提取产物）
  const head = git(['rev-parse', 'HEAD'])
  const notesFile = path.join(mkdtempSync(path.join(tmpdir(), 'vsidian-codex-bridge-release-')), 'notes.md')
  writeFileSync(notesFile, notes.body + '\n', 'utf8')

  console.log(`创建 GitHub Release ${tag} 并上传 ${path.basename(vsixPath)}…`)
  // Windows 上 gh 是 .cmd，必须经 shell；参数拼接为整条命令避免 DEP0190
  const gh = spawnSync(`gh release create ${tag} "${vsixPath}" --target ${head} --title ${tag} --notes-file "${notesFile}"`, { cwd: root, encoding: 'utf8', shell: true })
  rmSync(path.dirname(notesFile), { recursive: true, force: true })
  if (gh.status !== 0) {
    console.error(gh.stdout)
    console.error(gh.stderr)
    process.exitCode = 1
    return
  }
  console.log(`Release ${tag} 创建完成。Marketplace 发布由 release.yml 工作流从该 Release 下载同一份 VSIX 执行（双开关，见 docs/adr/0004）`)
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

  console.log('本地打包完成。发布（GitHub Release 附 VSIX）：npm run release——须 HEAD 精确命中 v<version> 标签且 GH_TOKEN 在场（CI 由 release.yml 推 tag 触发）')
  return vsixPath
}

function main() {
  const argv = process.argv.slice(2)

  // 旧护栏入口废弃指引：--upload/--publish 是无发布通道时期（ADR-0004 原决策）
  // 的拒绝面，发布通道已落地为 release 子命令——旧旗标不映射、不静默忽略，
  // 显式报错指引，防误以为沿旧入口可直接发布
  if (argv.includes('--upload') || argv.includes('--publish')) {
    console.error('--upload/--publish 旗标已废弃：发布走 release 子命令（node scripts/release.mjs release），且须 HEAD 精确命中 v<version> 标签、GH_TOKEN 在场、Release 不存在（CI 由 release.yml 推 tag 触发）')
    process.exitCode = 1
    return
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const command = argv.find((a) => !a.startsWith('--')) ?? 'package'

  if (command === 'package') {
    runPackage(root)
  } else if (command === 'release') {
    runRelease(root)
  } else {
    console.error(`未知子命令 ${command}。用法：node scripts/release.mjs [package|release]（package=本地打包；release=发布 GitHub Release，前置校验见脚本头注；版本 bump 人工编辑 package.json 并同步写 CHANGELOG 版本段）`)
    process.exitCode = 1
  }
}

// 仅在直接执行（node scripts/release.mjs）时跑主流程；契约测试 import 纯函数不触发
if (process.argv[1] && path.resolve(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main()
}
