#!/usr/bin/env node
// 并发 re-vendor 隔离验证夹具（PR #5 审查 P2，可执行验证，不进 vitest——
// 依赖真实 vsidian 源仓经 git show 生成，秒级单元层不吸纳外部仓依赖）。
//
// 复现形态（对齐审查实证）：A 进程写完首个暂存文件后暂停，B 进程完整
// 成功（旧实现的固定 .vendor-staging/.vendor-prev 会被 B 无条件删除，
// A 恢复后换入失败或产物缺文件），恢复 A；断言：
//   1. A、B 两进程退出码均为 0；
//   2. 结束后 vendor:check 通过（最终快照完整，预期文件不再缺失）；
//   3. 不残留暂存/备份目录（.vendor-staging-*/.vendor-prev-*）。
//
// 用法：node test/fixtures/vendorConcurrency.mjs --source <vsidian仓根>
// （缺省走脚本同款定位序：--source > VSIDIAN_SOURCE_REPO > 同级主仓）。
// 退出码 0 = 并发隔离验证通过。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---- 源仓定位（与 scripts/vendorSdkTypes.mjs 同款序） ----
const argv = process.argv.slice(2)
let source = process.env.VSIDIAN_SOURCE_REPO ?? path.join(repoRoot, '..', 'vscode-obsidian-like-editor')
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--source') source = argv[i + 1]
  else if (argv[i].startsWith('--source=')) source = argv[i].slice(9)
}
if (!existsSync(path.join(source, '.git'))) {
  console.error(`[vendor-concurrency] 源仓不是 git 仓库：${source}（--source 或 VSIDIAN_SOURCE_REPO 指定）`)
  process.exit(2)
}

const signalDir = mkdtempSync(path.join(tmpdir(), 'vendor-concurrency-'))
function fail(message) {
  console.error(`[vendor-concurrency] ${message}`)
  rmSync(signalDir, { recursive: true, force: true })
  process.exit(1)
}

/** 起一个 vendor 生成进程（stdio 透传），返回其退出 Promise */
function startVendor(label, env = {}) {
  const child = spawn(process.execPath, ['scripts/vendorSdkTypes.mjs', '--source', source], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const exited = new Promise((resolve) => {
    child.on('close', (code) => {
      console.log(`[vendor-concurrency] ${label} 退出（码 ${code}）`)
      resolve(code)
    })
    child.on('error', (err) => fail(`${label} 启动失败：${err.message}`))
  })
  return { child, exited }
}

console.log(`[vendor-concurrency] 信号目录 ${signalDir}`)
console.log('[vendor-concurrency] A 启动（暂停钩子：写完首个暂存文件后等待 go 信号）…')
const a = startVendor('A', { VENDOR_TEST_PAUSE_AFTER_FIRST_FILE: signalDir })

// 等 A 落 staged-waiting 标记（A 已写完首个暂存文件、进入暂停）
const waitingFlag = path.join(signalDir, 'staged-waiting')
for (let i = 0; i < 1500 && !existsSync(waitingFlag); i++) {
  await new Promise((r) => setTimeout(r, 100))
}
if (!existsSync(waitingFlag)) {
  a.child.kill()
  fail('A 未在限定时间内落 staged-waiting 标记（暂停钩子未生效）')
}
console.log('[vendor-concurrency] A 已写首个暂存文件并暂停；B 完整运行…')

const b = startVendor('B')
const codeB = await b.exited
if (codeB !== 0) {
  a.child.kill()
  fail(`B 退出码 ${codeB}（完整成功路径不应失败）`)
}

console.log('[vendor-concurrency] 恢复 A（落 go 信号）…')
writeFileSync(path.join(signalDir, 'go'), 'go')
const codeA = await a.exited
if (codeA !== 0) fail(`A 退出码 ${codeA}（暂停恢复后应完整成功）`)

// 最终完整性：vendor:check 必须通过（并发后快照不缺文件、无漂移）
const check = spawnSync(process.execPath, ['scripts/vendorSdkTypes.mjs', '--check', '--source', source], {
  cwd: repoRoot,
  env: process.env,
  encoding: 'utf8',
})
if (check.stdout) process.stdout.write(`[check] ${check.stdout}`)
if (check.stderr) process.stderr.write(`[check] ${check.stderr}`)
if (check.status !== 0) fail(`vendor:check 退出码 ${check.status}（并发后快照不完整或漂移）`)

// 清理断言：types/ 下不应残留暂存/备份目录
const leftovers = readdirSync(path.join(repoRoot, 'types')).filter(
  (name) => name.startsWith('.vendor-staging') || name.startsWith('.vendor-prev'),
)
rmSync(signalDir, { recursive: true, force: true })
if (leftovers.length > 0) fail(`残留暂存/备份目录：${leftovers.join('、')}`)

console.log('[vendor-concurrency] 并发隔离验证通过：A/B 均 0 退出、check 一致、无残留')
process.exit(0)
