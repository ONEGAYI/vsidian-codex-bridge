// vendor 快照换入/回滚/锁语义行为测试（PR #5 二轮复审两个 P2 回归）。
//
// 脚本顶层即执行副作用（读 env / exit / spawn git），无法 import 做行为
// 断言（scaffold.test.ts 钉文本契约的同一原因）——这里以子进程驱动真实
// 脚本：最小 fixture git 源仓（VENDOR_ENTRIES 各一个空接口、无内部相对
// 导入，闭包一轮收敛）+ VENDOR_TEST_TYPES_ROOT 把 types 根重定向到临时
// 目录，不触碰仓库真实快照；故障注入经 VENDOR_TEST_FAIL_SWAP（真实
// EPERM 形态）/ VENDOR_TEST_SWAP_LOCK_WAIT_MS（缩短等待，不真等 60s），
// 只注入故障与时序，不伪造断言结果。
//
// 复审原文对应：
// - P2 回滚失败保护：换入与回滚 rename 均 EPERM 时，唯一旧快照备份必须
//   完整保留并给出人工恢复指引（旧代码 finally 无条件清理 prev 属数据
//   保护回归）；
// - P2 锁语义：锁存在（哪怕远超陈旧阈值）绝不按 mtime 自动抢占——等待
//   超时明确报错、锁原样保留、不进入临界段（旧代码「读旧 stat 后删除」
//   存在删掉新持有者活锁的竞态）。
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = path.join(repoRoot, 'scripts', 'vendorSdkTypes.mjs')

// 入口表从脚本源码抽取（脚本加入口时测试自动跟随，避免硬编码漂移）
const scriptText = readFileSync(scriptPath, 'utf8')
const entryBlock = scriptText.match(/const VENDOR_ENTRIES = \[([\s\S]*?)\]/)?.[1] ?? ''
const vendorEntries = [...entryBlock.matchAll(/'([^']+)'/g)].map((m) => m[1])
expect(vendorEntries.length, 'VENDOR_ENTRIES 抽取失败（脚本结构变化？）').toBeGreaterThan(0)
/** 生成产物按 localeCompare 排序写盘，期望侧同序对比 */
const expectedSnapshot = vendorEntries.map((p) => p.replace(/^src\//, '')).sort((a, b) => a.localeCompare(b))

let sourceRepo = ''
let commitSha = ''
let typesRoot = ''

/** 列目录下全部 .ts 文件（相对路径，/ 分隔） */
function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string, base: string) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name)
      if (statSync(full).isDirectory()) walk(full, base)
      else if (name.endsWith('.ts')) out.push(path.relative(base, full).replaceAll('\\', '/'))
    }
  }
  walk(dir, dir)
  return out.sort()
}

/** 同步跑一轮生成，返回 { code, stdout, stderr } */
function runVendor(env: Record<string, string> = {}, timeoutMs = 120_000) {
  const r = spawnSync(process.execPath, [scriptPath, '--source', sourceRepo, '--commit', commitSha], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, VENDOR_TEST_TYPES_ROOT: typesRoot, ...env },
  })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error?.message ?? '' }
}

/** 异步起一个生成进程（交错测试用），返回退出码 Promise */
function startVendor(env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [scriptPath, '--source', sourceRepo, '--commit', commitSha], {
    cwd: repoRoot,
    env: { ...process.env, VENDOR_TEST_TYPES_ROOT: typesRoot, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
  return new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

/** types 根下的暂存/备份/锁残留名 */
function leftovers() {
  return readdirSync(typesRoot).filter(
    (n) => n.startsWith('.vendor-staging') || n.startsWith('.vendor-prev') || n === '.vendor-lock',
  )
}

/** 每用例隔离：清掉临时 types 根的全部产物状态 */
function resetTypesRoot() {
  for (const name of readdirSync(typesRoot)) rmSync(path.join(typesRoot, name), { recursive: true, force: true })
}

/** 预置一个 mtime 远超陈旧阈值（130s 前）的锁目录 */
function presetStaleLock() {
  const lockDir = path.join(typesRoot, '.vendor-lock')
  mkdirSync(lockDir)
  const old = new Date(Date.now() - 130_000)
  utimesSync(lockDir, old, old)
  return lockDir
}

beforeAll(() => {
  // 最小 fixture 源仓：git init + VENDOR_ENTRIES 各一个空接口 + 一次提交
  sourceRepo = mkdtempSync(path.join(tmpdir(), 'vendor-fixture-src-'))
  for (let i = 0; i < vendorEntries.length; i++) {
    const full = path.join(sourceRepo, vendorEntries[i])
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, `export interface FixtureEntry${i} { ok: 1 }\n`)
  }
  execFileSync('git', ['-C', sourceRepo, 'init', '-q'])
  execFileSync('git', ['-C', sourceRepo, 'add', '-A'])
  execFileSync('git', ['-C', sourceRepo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@test', 'commit', '-q', '-m', 'fixture'])
  commitSha = execFileSync('git', ['-C', sourceRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  typesRoot = mkdtempSync(path.join(tmpdir(), 'vendor-fixture-types-'))
}, 60_000)

afterAll(() => {
  rmSync(sourceRepo, { recursive: true, force: true })
  rmSync(typesRoot, { recursive: true, force: true })
})

describe('vendor 换入失败与回滚保护（PR #5 二轮复审 P2）', () => {
  it('正常生成：退出 0、快照齐、无暂存/备份/锁残留', () => {
    resetTypesRoot()
    const r = runVendor()
    expect(r.code).toBe(0)
    expect(listTsFiles(path.join(typesRoot, 'vendor'))).toEqual(expectedSnapshot)
    expect(leftovers()).toEqual([])
  }, 60_000)

  it('换入与回滚 rename 均 EPERM：退出 1，唯一旧快照备份完整保留并给出人工恢复指引', () => {
    resetTypesRoot()
    // 第一次正常生成，建立旧快照（换出/回滚路径需要已有快照在场）
    const first = runVendor()
    expect(first.code, first.stderr).toBe(0)

    // 第二轮注入：阶段 0（staging→vendor 换入）与阶段 1（prev→vendor
    // 回滚）均 EPERM——复审实证的复现形态（对两次 rename 注入 EPERM）
    const r = runVendor({ VENDOR_TEST_FAIL_SWAP: '0,1' })
    expect(r.code, `stderr：\n${r.stderr}`).toBe(1)

    // 唯一旧快照备份完整保留：13 个入口文件一个不少
    const prevs = readdirSync(typesRoot).filter((n) => n.startsWith('.vendor-prev-'))
    expect(prevs.length, `备份目录应恰好一个，实际：${prevs.join('、')}`).toBe(1)
    const prevDir = path.join(typesRoot, prevs[0])
    expect(listTsFiles(prevDir)).toEqual(expectedSnapshot)

    // vendor 已被换走且换入失败：目录不存在（对齐复审实证形态）
    expect(existsSync(path.join(typesRoot, 'vendor'))).toBe(false)

    // 错误信息：备份目录路径 + 换入/回滚两个原始 EPERM + 人工恢复指引
    expect(r.stderr).toContain(prevs[0])
    expect((r.stderr.match(/EPERM/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(r.stderr).toMatch(/人工/)
    expect(r.stderr).toMatch(/恢复/)

    // 除备份外无其他残留（staging 属可再生产物，正常清理；锁随临界段释放）
    expect(leftovers()).toEqual([prevs[0]])
  }, 60_000)
})

describe('vendor 换入锁语义：不自动抢占陈旧锁（PR #5 二轮复审 P2）', () => {
  it('锁被持有（远超陈旧阈值）时不抢占：等待超时报错退出，锁原样保留、不进入临界段', () => {
    resetTypesRoot()
    const first = runVendor()
    expect(first.code, first.stderr).toBe(0)
    const snapshotBefore = listTsFiles(path.join(typesRoot, 'vendor'))

    const lockDir = presetStaleLock()
    const r = runVendor({ VENDOR_TEST_SWAP_LOCK_WAIT_MS: '2000' })
    expect(r.code, `stderr：\n${r.stderr}`).toBe(1)

    // 报错含锁路径与人工处置指引（新语义：绝不按 mtime 自动删除）
    expect(r.stderr).toContain('.vendor-lock')
    expect(r.stderr).toMatch(/人工/)

    // 锁原样保留：未被删除重建（mtime 仍远超陈旧阈值）
    expect(existsSync(lockDir)).toBe(true)
    expect(Date.now() - statSync(lockDir).mtimeMs).toBeGreaterThan(120_000)

    // 未进入临界段：快照原样、无暂存/备份残留
    expect(listTsFiles(path.join(typesRoot, 'vendor'))).toEqual(snapshotBefore)
    expect(readdirSync(typesRoot).filter((n) => n.startsWith('.vendor-staging') || n.startsWith('.vendor-prev'))).toEqual([])
  }, 60_000)

  it('预置陈旧锁 + 双进程并发生成：等待不抢占，人工清锁后经 mkdir 原子性互斥完成', async () => {
    resetTypesRoot()
    const lockDir = presetStaleLock()

    // A、B 同时启动：陈旧锁在场，两进程都只能等待（旧语义会立刻按
    // mtime 抢占；新语义等待）——等待期间人工删除预置锁（模拟人工
    // 恢复），两进程经 mkdir 原子性先后拿锁，换入互斥不被破坏
    const a = startVendor()
    const b = startVendor()
    await new Promise((resolve) => setTimeout(resolve, 500))
    rmSync(lockDir, { recursive: true, force: true })
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.code, `A stderr：\n${ra.stderr}`).toBe(0)
    expect(rb.code, `B stderr：\n${rb.stderr}`).toBe(0)

    // 最终快照一致 + 无任何残留（锁/暂存/备份）
    const check = spawnSync(process.execPath, [scriptPath, '--check', '--source', sourceRepo, '--commit', commitSha], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, VENDOR_TEST_TYPES_ROOT: typesRoot },
    })
    expect(check.status, `check stderr：\n${check.stderr}`).toBe(0)
    expect(leftovers()).toEqual([])
  }, 120_000)
})
