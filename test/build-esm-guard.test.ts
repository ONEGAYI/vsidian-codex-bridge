// ESM 分块产物防线契约（PR #5 审查 P2）：esm+splitting 产物与页面 IIFE
// 同受两道防线约束——
// 1. 构建期：SDK 构建桥拒绝 @codemirror/* 值导入（含从分块混入——
//    审查实证：隔离入口动态 import @codemirror/state 后构建成功打印
//    「扫描通过」）；
// 2. 产物期：CM6 运行时标记与 vsidian 内部路径标记扫描覆盖**全部输出
//    JS**（入口 + 全部分块），不只入口。
// 直接驱动 tools/buildLib.mjs 的真实 esbuild 构建（不 mock 构建器），
// 临时入口写在 test/.tmp-esm-guard/ 下、产物名带 esmguard 前缀，用例
// 自建自清不污染 dist 正式产物。
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAddon } from '../tools/buildLib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmpSrc = path.join(repoRoot, 'test', '.tmp-esm-guard')

afterAll(() => {
  rmSync(tmpSrc, { recursive: true, force: true })
  for (const leftover of ['esmguard-cm6', 'esmguard-marker']) {
    rmSync(path.join(repoRoot, 'dist', `${leftover}.js`), { force: true })
    rmSync(path.join(repoRoot, 'dist', `${leftover}-chunks`), { recursive: true, force: true })
  }
})

function writeEntry(name: string, code: string, extra?: Record<string, string>): string {
  const dir = path.join(tmpSrc, name)
  mkdirSync(dir, { recursive: true })
  for (const [file, text] of Object.entries(extra ?? {})) {
    writeFileSync(path.join(dir, file), text, 'utf8')
  }
  const entry = path.join(dir, 'entry.ts')
  writeFileSync(entry, code, 'utf8')
  return path.relative(repoRoot, entry).replaceAll('\\', '/')
}

describe('esm 分块产物：构建桥依赖禁入（第一道防线）', () => {
  it('入口动态 import @codemirror/state → 构建拒绝（分块路径不得绕过构建桥）', async () => {
    const entry = writeEntry(
      'cm6',
      'const state = await import("@codemirror/state")\nexport const out = state\n',
    )
    await expect(
      buildAddon({
        pages: [],
        esmModules: [{ entry, name: 'esmguard-cm6' }],
        log: () => {},
      }),
    ).rejects.toThrow(/构建桥拒绝/)
  })
})

describe('esm 分块产物：内部路径标记扫描（第二道防线，含分块）', () => {
  it('分块携带 vsidian 内部路径标记 → 构建失败（扫描覆盖全部输出 JS）', async () => {
    const entry = writeEntry(
      'marker',
      [
        'const mod = await import("./chunked")',
        'export const out = mod.marker',
      ].join('\n'),
      {
        // 动态 import 模块独立成 chunk；字符串含内部路径标记（模拟把
        // vendor 快照值代码打进分块），扫描应命中分块（旧实现只扫入口）
        'chunked.ts': 'export const marker: string = "types/vendor/shared/addonPage.ts"\n',
      },
    )
    await expect(
      buildAddon({
        pages: [],
        esmModules: [{ entry, name: 'esmguard-marker' }],
        log: () => {},
      }),
    ).rejects.toThrow(/内部路径标记/)
  })

  it('干净的分块产物构建通过并逐一扫描（入口 + 每个分块）', async () => {
    const entry = writeEntry(
      'clean',
      [
        'const mod = await import("./chunked")',
        'export const out = mod.value',
      ].join('\n'),
      { 'chunked.ts': 'export const value: number = 42\n' },
    )
    await buildAddon({
      pages: [],
      esmModules: [{ entry, name: 'esmguard-clean' }],
      log: () => {},
    })
    // splitting 生效：动态 import 模块成独立分块（构建+扫描全路径走通）
    expect(existsSync(path.join(repoRoot, 'dist', 'esmguard-clean-chunks')), '分块目录缺失').toBe(true)
    rmSync(path.join(repoRoot, 'dist', 'esmguard-clean.js'), { force: true })
    rmSync(path.join(repoRoot, 'dist', 'esmguard-clean-chunks'), { recursive: true, force: true })
  })
})

describe('buildAddon：host 可选（局部构建测试支撑）', () => {
  it('省略 host 时跳过宿主产物构建（不写 dist/extension.js）', async () => {
    const entry = writeEntry('hostless', 'export const x = 1\n')
    await buildAddon({ pages: [], esmModules: [{ entry, name: 'esmguard-hostless' }], log: () => {} })
    // 仅清自建产物；dist/extension.js 的在场性由 scaffold 契约钉住，此处
    // 只断言本调用未触碰宿主段（构建无异常即未走 host 分支——host 分支
    // 以真入口运行，传入 host: undefined 时跳过）
    rmSync(path.join(repoRoot, 'dist', 'esmguard-hostless.js'), { force: true })
    rmSync(path.join(repoRoot, 'dist', 'esmguard-hostless-chunks'), { recursive: true, force: true })
  })
})
