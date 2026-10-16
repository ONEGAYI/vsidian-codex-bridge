#!/usr/bin/env node
// vendorSdkTypes.mjs — Vsidian SDK 类型快照生成/校验（票 #1）。
//
// 用法：
//   npm run vendor:sdk                          # 生成/刷新 types/vendor/
//   npm run vendor:check                        # 校验已提交快照无漂移（CI 用）
//   node scripts/vendorSdkTypes.mjs --source <vsidian仓路径> --commit <rev> [--check]
//
// 快照语义（ADR-0001，机制照搬 vsidian-easy-typing 同名脚本）：
// - 入口文件（VENDOR_ENTRIES）保留完整导出类型面（interface/type/enum 与
//   被类型引用的同文件常量）；经 type 导入发现的 vsidian 内部模块只保留
//   「被引用名字」的类型可达闭包——避免把平台内部实现整面拖进快照。
// - 值级导出（校验函数、运行时数据表）一律剥离；宿主实现以类型为准。
// - 产物按 vsidian 源码目录结构镜像到 types/vendor/（去掉 src/ 前缀），
//   文件相对导入路径原样有效，无需改写。
// - 每个文件头标注来源 commit；升级快照 = 改 DEFAULT_COMMIT 重跑 + 评审 diff。
// - 生成模式原子替换：全部产物先写 types/.vendor-staging-*/（每次调用
//   mkdtempSync 独立），写满后整体 rename 换入 types/vendor/（换入失败
//   回滚；换入/回滚段经 types/.vendor-lock 锁目录跨进程互斥，锁不做
//   陈旧自动回收——超时报错提示人工处置），中途异常不破坏已提交快照，
//   并发生成互不删除对方的暂存/备份目录；回滚也失败时唯一旧快照备份
//   保留现场，错误信息报出备份路径供人工恢复。
//
// 与 easy-typing 的入口表差异：锚定 batch-2 合入点（PR #564），补入
// addonPasteRules.ts（#541/#542 粘贴规则，bridge#2 直接消费）与
// addonThemes.ts（#546/T07 主题，bridge#3 直接消费）两个 batch-1/2 新面
// ——easy-typing 的锚定提交（9cd04d1c）早于 batch-2，不含这两面。
//
// 源仓定位：--source > 环境变量 VSIDIAN_SOURCE_REPO > ../vscode-obsidian-like-editor
// （相对本仓库根，两仓同级布局）。读取经 `git show <commit>:<path>`——
// 按提交快照取文，不受源仓工作树状态影响。
import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 当前快照锚定的 vsidian 提交（re-vendor 升级时随变更修改此常量并重跑）。
 * 80dfc285 = 附加组件 API 1.1.0 发行提交（2026-10-16 released）：candidate
 * 1.0.0 面（锚 301d2c16，batch-2 PR #564 合入点）全量并入、无破坏性变更，
 * 本仓消费面（paste/themes/renderers/themeEnvironment）原样转正。
 */
const DEFAULT_COMMIT = '80dfc285223e66b3b80535fd7f16b0df04ee8ded'

/**
 * vendor 入口：公开 API 面文件，保留完整导出类型面。
 * 页面 SDK（addonPage 及各组能力 facet）+ 宿主注册表（addonRegistry 的
 * setup/enable 上下文与 AddonDefinition）+ 身份声明（addonIdentity）；
 * 本仓另补 batch 新面：粘贴规则（addonPasteRules，bridge#2）与主题
 * （addonThemes，bridge#3）。导航/引用视图等本仓不消费的面不进入口表
 * （若 addonPage 完整面引用其类型，经最小闭包自动带出被引用名字）。
 */
const VENDOR_ENTRIES = [
  'src/shared/addonPage.ts',
  'src/shared/addonEditApi.ts',
  'src/shared/addonBehaviors.ts',
  'src/shared/addonSettings.ts',
  'src/shared/addonRenderers.ts',
  'src/shared/addonCommands.ts',
  'src/shared/addonUi.ts',
  'src/shared/addonStorage.ts',
  'src/shared/addonFoldApi.ts',
  'src/shared/addonIdentity.ts',
  'src/shared/addonPasteRules.ts',
  'src/shared/addonThemes.ts',
  'src/host/addons/addonRegistry.ts',
]

const HEADER_LINES = (commit, srcPath) => [
  `// vendored from ONEGAYI/vsidian@${commit} — ${srcPath}`,
  '// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被',
  '// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；',
  '// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。',
]

// ---------------------------------------------------------------- CLI 参数

function parseArgs(argv) {
  const out = { check: false, source: null, commit: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--check') out.check = true
    else if (arg === '--source') out.source = argv[++i]
    else if (arg.startsWith('--source=')) out.source = arg.slice('--source='.length)
    else if (arg === '--commit') out.commit = argv[++i]
    else if (arg.startsWith('--commit=')) out.commit = arg.slice('--commit='.length)
    else {
      console.error(`[vendor] 未知参数 ${arg}`)
      process.exit(2)
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const sourceRepo = path.resolve(
  args.source ?? process.env.VSIDIAN_SOURCE_REPO ?? path.join(repoRoot, '..', 'vscode-obsidian-like-editor'),
)
if (!statSync(path.join(sourceRepo, '.git'), { throwIfNoEntry: false })) {
  console.error(`[vendor] 源仓不是 git 仓库：${sourceRepo}（用 --source 或 VSIDIAN_SOURCE_REPO 指定 vsidian 本体仓）`)
  process.exit(2)
}
const commitArg = args.commit ?? DEFAULT_COMMIT
const commit = execFileSync('git', ['-C', sourceRepo, 'rev-parse', `${commitArg}^{commit}`], {
  encoding: 'utf8',
}).trim()

function readSourceFile(srcPath) {
  return execFileSync('git', ['-C', sourceRepo, 'show', `${commit}:${srcPath}`], { encoding: 'utf8' })
}

// ---------------------------------------------------------------- 变换核心

const IDENT_RE = /\b[A-Za-z_$][\w$]*\b/g

/** 词法级标识符收集（注释与字符串字面量天然排除——文档注释里提到的
 *  函数名不算引用，避免误保留/误报错） */
function collectIdentifiers(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  const ids = new Set()
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.Identifier) ids.add(scanner.getTokenText())
  }
  return ids
}

/** 词法级 `typeof <标识符>` 引用收集（跳过中间空白/注释 token） */
function collectTypeofNames(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  const names = []
  let pendingTypeof = false
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.TypeOfKeyword) {
      pendingTypeof = true
      continue
    }
    if (kind === ts.SyntaxKind.Identifier && pendingTypeof) {
      names.push(scanner.getTokenText())
      pendingTypeof = false
      continue
    }
    if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.MultiLineCommentTrivia && kind !== ts.SyntaxKind.SingleLineCommentTrivia && kind !== ts.SyntaxKind.NewLineTrivia) {
      pendingTypeof = false
    }
  }
  return names
}

/** 单文件变换：返回 { text, requests }。
 *  roots = null 表示完整导出类型面；否则只保留 roots 类型可达闭包。
 *  requests = Map<模块源路径, Set<需要的导出名>>（type 导入的目标）。 */
function transformFile(srcPath, source, roots) {
  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.Latest, true)
  const imports = [] // { stmt, module, specifiers: [{exported, local, typeOnly}] }
  const typeReexports = [] // export type { ... } from '...'
  const decls = [] // { stmt, names: string[], kind: 'type'|'const'|'func', exported: boolean }

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
      const specifiers = []
      for (const el of stmt.importClause.namedBindings.elements) {
        specifiers.push({
          exported: (el.propertyName ?? el.name).text,
          local: el.name.text,
          typeOnly: !!el.isTypeOnly,
        })
      }
      imports.push({ stmt, module: stmt.moduleSpecifier.text, specifiers })
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.isTypeOnly
    ) {
      typeReexports.push({ stmt, module: stmt.moduleSpecifier.text })
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
      decls.push({ stmt, names: [stmt.name.text], kind: 'type', exported: stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false })
    } else if (ts.isVariableStatement(stmt)) {
      const names = []
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text)
      }
      if (names.length > 0) {
        decls.push({ stmt, names, kind: 'const', exported: stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false })
      }
    } else if ((ts.isFunctionDeclaration(stmt) && stmt.name) || ts.isClassDeclaration(stmt)) {
      const name = stmt.name?.text
      if (name) decls.push({ stmt, names: [name], kind: 'func', exported: stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false })
    }
    // 其余语句（表达式、export * 等）一律丢弃
  }

  // 种子：roots 模式取名字命中的导出类型声明（以及被跨文件值请求的
  // 导出 const——被保留 const 的初始化器值引用时目标模块须产出该声明，
  // 否则快照空模块 + TS2306）；完整模式取全部导出类型声明（值级导出仍剥离）
  const kept = new Set()
  const seed = (d) =>
    d.exported &&
    (roots === null || roots.has(d.names[0])) &&
    (d.kind === 'type' || (roots !== null && d.kind === 'const'))
  for (const d of decls) if (seed(d)) kept.add(d)

  // 文件内可达闭包：被保留文本引用的声明继续保留。类型/枚举按标识符引用；
  // 常量（含 const 箭头函数）只在被 `typeof <名字>` 引用时保留——接口属性
  // 名与顶层声明同名时不算引用（easy-typing 实测坑：属性名误保了同名
  // const 谓词函数）。
  for (let changed = true; changed; ) {
    changed = false
    const joined = [...kept].map((d) => d.stmt.getFullText(sf)).join('\n')
    const ids = collectIdentifiers(joined)
    const typeofNames = new Set(collectTypeofNames(joined))
    for (const d of decls) {
      if (kept.has(d)) continue
      const referenced =
        d.kind === 'const'
          ? d.names.some((n) => typeofNames.has(n))
          : d.names.some((n) => ids.has(n))
      if (!referenced) continue
      if (d.kind === 'func') {
        throw new Error(
          `${srcPath}: 保留的类型引用了函数/类「${d.names[0]}」——类型快照不携带实现，` +
            '请把该引用改写为结构类型或调整 VENDOR_ENTRIES 根名字',
        )
      }
      kept.add(d)
      changed = true
    }
  }

  const keptText = [...kept].map((d) => d.stmt.getFullText(sf)).join('\n')
  const keptIds = collectIdentifiers(keptText)

  // 跨文件值引用 typeof <导入名>：type-only 导入不能作值用（TS1361）——当前面无此形态，出现即报错
  for (const name of collectTypeofNames(keptText)) {
    const imp = imports.find((i) => i.specifiers.some((s) => s.local === name))
    if (imp) {
      throw new Error(`${srcPath}: 保留的类型经 typeof 引用了导入值「${name}」（来自 ${imp.module}）——跨文件值引用不受支持，需人工改写`)
    }
  }

  // 值依赖导入：保留 const 的**初始化器**中以值形态出现的导入名——这些导入
  // 必须保持普通 import（type-only 名作值用是 TS1361）。只取 initializer 文本，
  // 类型注解名不参与（普通 import 名可兼作类型，但避免不必要的非 type 行）
  const valueRefIds = new Set()
  for (const d of kept) {
    if (d.kind !== 'const') continue
    for (const decl of d.stmt.declarationList.declarations) {
      if (decl.initializer !== undefined) {
        for (const id of collectIdentifiers(decl.initializer.getFullText())) valueRefIds.add(id)
      }
    }
  }

  // 导入裁剪：只保留被引用的具名符号，一律输出 import type——值依赖命中的
  // 导入行例外（整行普通 import，名字可兼作类型，混合行不拆两份）
  const requests = new Map()
  const importLines = []
  for (const imp of imports) {
    const referenced = imp.specifiers.filter((s) => keptIds.has(s.local))
    if (referenced.length === 0) continue
    const hasValueRef = referenced.some((s) => valueRefIds.has(s.local))
    const line = `import ${hasValueRef ? '' : 'type '}{ ${referenced.map((s) => (s.exported === s.local ? s.local : `${s.exported} as ${s.local}`)).join(', ')} } from '${imp.module}'`
    if (!imp.module.startsWith('.')) {
      importLines.push(line)
      continue
    }
    const resolved = resolveModule(srcPath, imp.module)
    if (!resolved) {
      throw new Error(`${srcPath}: 无法解析相对导入 ${imp.module}（.ts / index.ts 均不存在）`)
    }
    const names = referenced.map((s) => s.exported)
    const bucket = requests.get(resolved) ?? new Set()
    for (const n of names) bucket.add(n)
    requests.set(resolved, bucket)
    importLines.push(line)
  }

  // type 再导出保留原文（具名 type re-export 不裁剪——开销为零；目标模块进请求表）
  const reexportLines = []
  for (const re of typeReexports) {
    reexportLines.push(re.stmt.getFullText(sf).trim())
    const resolved = resolveModule(srcPath, re.module)
    if (resolved) {
      const names = re.stmt.exportClause.elements.map((e) => (e.propertyName ?? e.name).text)
      const bucket = requests.get(resolved) ?? new Set()
      for (const n of names) bucket.add(n)
      requests.set(resolved, bucket)
    }
  }

  const body = [importLines.join('\n'), reexportLines.join('\n'), keptText]
    .filter((s) => s.trim().length > 0)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '')
    .trimEnd()

  return { text: `${HEADER_LINES(commit, srcPath).join('\n')}\n\n${body}\n`, requests }
}

/** 相对导入 → vsidian 源码路径（相对源仓根）；解析失败返回 null */
function resolveModule(fromPath, module) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), module))
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    try {
      execFileSync('git', ['-C', sourceRepo, 'cat-file', '-e', `${commit}:${candidate}`], { stdio: 'ignore' })
      return candidate
    } catch {
      // 尝试下一个
    }
  }
  return null
}

// ---------------------------------------------------------------- 全局闭包

/** 迭代到不动点：入口（完整面）+ 发现模块（按请求名字）逐轮处理 */
function generateAll() {
  const full = new Map() // srcPath -> text（完整面入口）
  const rooted = new Map() // srcPath -> { roots: Set, text }
  const pending = new Map() // srcPath -> Set<names> | null（null = 完整面）
  const entrySet = new Set(VENDOR_ENTRIES)
  for (const entry of VENDOR_ENTRIES) pending.set(entry, null) // null = 完整面

  for (let round = 1; ; round++) {
    const queue = [...pending.entries()]
    pending.clear()
    if (queue.length === 0) break
    // 在途请求登记（easy-typing 版机制缺陷修复，301d2c16 实证）：同一轮
    // 内，先处理的模块请求某依赖时，若该依赖在本轮队列尾部还带着更大的
    // 请求集合，旧版从 pending（轮首已清空）与 rooted（尚未处理）都取不
    // 到它——会以更小集合入队，并在下一轮 rooted.set 覆盖掉已保留的名字
    // （SerChange 与 HoverPreviewFailReason 分轮到达 protocol.ts，最终
    // 快照丢 SerChange → tsc TS2305）。queue 快照内的请求一并参与
    // 「已请求」判定。
    const inFlight = new Map()
    for (const [srcPath, names] of queue) {
      if (names === null) continue
      const merged = new Set([...(inFlight.get(srcPath) ?? []), ...names])
      inFlight.set(srcPath, merged)
    }
    for (const [srcPath, names] of queue) {
      const source = readSourceFile(srcPath)
      // rooted 模式先把本轮请求与已处理 roots 取并集再变换：文本不因
      // 请求分轮到达而回退到小子集
      const effectiveNames = names === null ? null : new Set([...(rooted.get(srcPath)?.roots ?? []), ...names])
      const result = transformFile(srcPath, source, effectiveNames)
      if (names === null) {
        const prev = full.get(srcPath)
        if (prev !== undefined && prev !== result.text) throw new Error(`${srcPath}: 完整面产物在两轮间不一致（不应发生）`)
        full.set(srcPath, result.text)
      } else {
        const prev = rooted.get(srcPath)
        if (prev && isSubset(effectiveNames, prev.roots) && prev.text === result.text) continue
        rooted.set(srcPath, { roots: effectiveNames, text: result.text })
      }
      for (const [dep, depNames] of result.requests) {
        // 入口文件（含尚未处理的）与已定完整面的模块：完整面覆盖一切请求
        if (full.has(dep) || entrySet.has(dep)) continue
        const existing = new Set([...(rooted.get(dep)?.roots ?? []), ...(inFlight.get(dep) ?? []), ...(pending.get(dep) ?? [])])
        if (isSubset(depNames, existing)) continue
        const merged = new Set([...existing, ...depNames])
        pending.set(dep, merged)
      }
    }
    if (round > 12) throw new Error('闭包迭代超过 12 轮未收敛（不应发生）')
  }
  return { full, rooted }
}

function isSubset(small, big) {
  for (const n of small) if (!big.has(n)) return false
  return true
}

// ---------------------------------------------------------------- 输出/校验

/** 测试钩子（test/vendor-swap.test.ts 子进程注入；生产不设环境变量即无
 *  任何行为变化）：types 目录基址重定向——行为测试在临时 types 根上做
 *  换入/回滚/锁语义，不触碰仓库真实快照。 */
const typesRoot = process.env.VENDOR_TEST_TYPES_ROOT ?? path.join(repoRoot, 'types')

const outDir = path.join(typesRoot, 'vendor')
const toOutPath = (srcPath) => path.join(outDir, srcPath.replace(/^src\//, ''))

function collectExistingFiles(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...collectExistingFiles(full, base))
    else if (name.endsWith('.ts')) out.push(path.relative(base, full).replaceAll('\\', '/'))
  }
  return out
}

const { full, rooted } = generateAll()
const generated = new Map()
for (const [p, text] of full) generated.set(p.replace(/^src\//, ''), text)
for (const [p, info] of rooted) generated.set(p.replace(/^src\//, ''), info.text)

/** 并发回归夹具钩子（test/fixtures/vendorConcurrency.mjs 消费；生产不设
 *  环境变量即无任何行为变化）：写完首个暂存文件后落 staged-waiting 标记
 *  并轮询等待 go 信号文件出现——构造「A 暂停、B 完整成功、恢复 A」的
 *  并发窗口（PR #5 审查 P2 的复现形态）。 */
const pauseFlagDir = process.env.VENDOR_TEST_PAUSE_AFTER_FIRST_FILE ?? null

async function waitResumeSignal() {
  writeFileSync(path.join(pauseFlagDir, 'staged-waiting'), String(process.pid))
  const goFlag = path.join(pauseFlagDir, 'go')
  for (;;) {
    if (statSync(goFlag, { throwIfNoEntry: false })) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

// ------------------------------- 并发隔离（PR #5 审查 P2 修复）

/** 换入/回滚互斥锁目录（mkdir 原子性 = 跨进程互斥；.gitignore 的
 *  「.vendor-*」通配已覆盖）。 */
const swapLockDir = path.join(typesRoot, '.vendor-lock')
/** 获取锁的最长等待（正常一轮换入是毫秒级，超时说明对端真挂了或异常
 *  残留）。测试钩子 VENDOR_TEST_SWAP_LOCK_WAIT_MS 可缩短（行为测试不
 *  真等 60s）。 */
const SWAP_LOCK_WAIT_MS = Number(process.env.VENDOR_TEST_SWAP_LOCK_WAIT_MS ?? 60_000)

/** 换入临界段互斥：并发生成进程的「换出旧快照 → 换入新快照 → 清备份」
 *  rename 序列必须整体互斥，否则对端 rmSync(prev) 可能删掉本端换出中
 *  的备份（旧快照永久丢失）。
 *  锁语义（PR #5 二轮复审 P2）：不做陈旧锁自动回收——按 mtime 判陈旧
 *  再删除存在竞态：读到旧 stat 与执行删除之间，锁可能已被人工处理或
 *  他者重新取得，旧 stat 不能证明删除时该路径仍是原陈旧锁（实证会删
 *  掉新持有者的活锁、双进程双双进入临界段破坏互斥）。re-vendor 是低频
 *  手动操作，安全优先于自动恢复：锁存在即等待，超时明确报错提示人工
 *  恢复，绝不按 mtime 自动删除。 */
/** 测试钩子（生产不设环境变量即无任何行为变化）：VENDOR_TEST_FAIL_SWAP
 *  = 逗号分隔的换入阶段序号（0 = 换入 staging→vendor，1 = 回滚
 *  prev→vendor），命中阶段以 code=EPERM 抛错——按真实 rename 故障形态
 *  注入，验证换入/回滚失败路径的数据保护行为。 */
const failSwapPhases = new Set((process.env.VENDOR_TEST_FAIL_SWAP ?? '').split(',').filter(Boolean))
let swapRenameSeq = 0
function swapRename(from, to) {
  const phase = String(swapRenameSeq++)
  if (failSwapPhases.has(phase)) {
    const err = new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'（VENDOR_TEST_FAIL_SWAP 阶段 ${phase} 注入）`)
    err.code = 'EPERM'
    throw err
  }
  return renameSync(from, to)
}

async function withSwapLock(critical) {
  const deadline = Date.now() + SWAP_LOCK_WAIT_MS
  for (;;) {
    try {
      mkdirSync(swapLockDir, { recursive: false })
      break // 拿到锁（mkdir 的原子性保证唯一持有者）
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      // 锁被他者持有或为异常残留：只等待，绝不自动删除（见上方锁语义
      // 注释——按 mtime 抢占会删掉新持有者的活锁）
      if (Date.now() > deadline) {
        throw new Error(
          `等待 vendor 快照换入锁超时（${SWAP_LOCK_WAIT_MS / 1000}s）：${swapLockDir} 被其他生成进程持有或为异常残留（锁不会被自动删除）。` +
            '请确认无并发生成在跑后，人工删除该锁目录再重试',
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  try {
    return await critical()
  } finally {
    rmSync(swapLockDir, { recursive: true, force: true })
  }
}

async function writeGenerated() {
  // 原子替换（评审 P2）+ 并发隔离（PR #5 审查 P2）：全部产物先写 staging
  // 目录，写满后整体 rename 换入；换入失败先回滚换出，原快照目录在任何
  // 失败路径下保持不动。暂存与备份目录**每次调用独立**（mkdtempSync），
  // 换入/回滚段经锁目录互斥——固定目录会被并发另一轮生成无条件 rmSync：
  // 暂存被删则本轮产物缺文件、备份被删则回滚把旧快照永久丢掉（审查实证
  // 退出码全 0 但快照缺首个暂存文件）。锁内不触碰其他调用的目录树。
  const staging = mkdtempSync(path.join(typesRoot, '.vendor-staging-'))
  let prev = null
  let keepPrevForRecovery = false
  let created = 0
  let updated = 0
  try {
    let pausedOnce = false
    for (const [rel, text] of [...generated.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const outPath = path.join(staging, rel)
      mkdirSync(path.dirname(outPath), { recursive: true })
      // 新建/覆盖计数以原快照目录在场与否判定（staging 恒为全新文件）
      if (statSync(path.join(outDir, rel), { throwIfNoEntry: false })) updated++
      else created++
      writeFileSync(outPath, text)
      if (pauseFlagDir && !pausedOnce) {
        pausedOnce = true
        await waitResumeSignal()
      }
    }
    await withSwapLock(() => {
      const hadExisting = !!statSync(outDir, { throwIfNoEntry: false })
      if (hadExisting) {
        // 备份目录独立创建（mkdtemp 后删除占位再用：rename 要求目标不存在）
        prev = mkdtempSync(path.join(typesRoot, '.vendor-prev-'))
        rmSync(prev, { recursive: true, force: true })
        renameSync(outDir, prev)
      }
      try {
        swapRename(staging, outDir)
      } catch (swapErr) {
        if (!prev) throw swapErr
        try {
          swapRename(prev, outDir) // 换入失败：回滚换出，恢复原快照
        } catch (rollbackErr) {
          // 回滚也失败（PR #5 二轮复审 P2）：此刻 prev 是唯一完整旧快照，
          // 绝不能随 finally 清理——保留现场并把两个原始错误与恢复路径
          // 一起报出，交人工恢复
          keepPrevForRecovery = true
          throw new Error(
            `换入与回滚均失败：旧快照已完整保留在备份目录 ${prev}（恢复前请勿删除）。` +
              `换入错误：${swapErr.message}；回滚错误：${rollbackErr.message}。` +
              `请人工恢复：核对无误后将该备份目录 rename 回 ${outDir}`,
          )
        }
        throw swapErr // 回滚成功：原快照已复位，仍如实报出本轮换入失败
      }
      if (prev) {
        rmSync(prev, { recursive: true, force: true })
        prev = null
      }
    })
  } finally {
    // 正常路径 staging 已被 rename 走或尚未写入；仅写入/换入阶段失败时
    // 残留的**本调用**暂存/备份在此清理（独立目录，不影响其他调用）。
    // 例外：回滚失败的 prev 是唯一完整旧快照，保留现场供人工恢复
    rmSync(staging, { recursive: true, force: true })
    if (prev && !keepPrevForRecovery) rmSync(prev, { recursive: true, force: true })
  }
  const rootedList = [...rooted.keys()].map((p) => p.replace(/^src\//, ''))
  console.log(`[vendor] 生成 ${created} 个 / 覆盖 ${updated} 个文件到 types/vendor/（锚定 ONEGAYI/vsidian@${commit.slice(0, 8)}）`)
  console.log(`[vendor] 完整面 ${full.size} 个；最小闭包 ${rooted.size} 个：${rootedList.join('、') || '无'}`)
}

// ---------------------------------------------------------------- 入口

if (args.check) {
  const existing = collectExistingFiles(outDir)
  const problems = []
  for (const [rel, text] of generated) {
    const diskPath = path.join(outDir, rel)
    const disk = statSync(diskPath, { throwIfNoEntry: false })
    if (!disk) problems.push(`缺失：types/vendor/${rel}`)
    // 行尾归一后对比：Windows 下 core.autocrlf=true 的 checkout 会把仓库内
    // LF 快照转成 CRLF，字节级严格对比会全量伪漂移（生成器恒写 LF）——
    // 行尾差异不是语义漂移，语义对比在任一平台行为一致（easy-typing 实证）。
    else if (readFileSync(diskPath, 'utf8').replaceAll('\r\n', '\n') !== text) problems.push(`漂移：types/vendor/${rel}（源已变或生成器已改，重跑 npm run vendor:sdk）`)
  }
  for (const rel of existing) {
    if (!generated.has(rel)) problems.push(`多余：types/vendor/${rel}（生成器不再产出，请删除）`)
  }
  if (problems.length > 0) {
    console.error(`[vendor:check] 快照与生成器不一致（锚定 ${commit}）：\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`[vendor:check] 快照一致：${generated.size} 个文件，锚定 ONEGAYI/vsidian@${commit.slice(0, 8)}`)
} else {
  await writeGenerated()
}
