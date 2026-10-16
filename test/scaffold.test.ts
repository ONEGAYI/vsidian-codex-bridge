// 脚手架结构契约（票 #1）：证明测试设施工作的同时，钉住 manifest 声明、
// vendor 快照纪律、目录结构、源码导入纪律与构建产物形态五组易回归事实。
// 形态对齐参照仓 vsidian-easy-typing 的 test/scaffold.test.ts，按本仓
// 差异裁剪：首期不消费任何 experimental 入口（粘贴/主题全在稳定候选面），
// vendor 入口表补 batch-2 新面（addonPasteRules / addonThemes）。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface ManifestContract {
  main: string
  engines: { vscode: string }
  extensionKind: string[]
  extensionDependencies: string[]
  dependencies?: Record<string, string>
  devDependencies: Record<string, string>
  vsidianAddon: {
    manifestVersion: number
    api: string
    experimental?: Record<string, string>
  }
}

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'))
}

function listFiles(dirRel: string, out: string[] = []): string[] {
  const dir = path.join(repoRoot, dirRel)
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      listFiles(path.join(dirRel, name), out)
    } else {
      out.push(path.join(dirRel, name).replaceAll('\\', '/'))
    }
  }
  return out
}

describe('manifest 契约（vsidianAddon 清单与依赖锁定）', () => {
  const pkg = readJson('package.json') as ManifestContract

  it('vsidianAddon 声明：api 范围用 ^，首期不声明 experimental', () => {
    expect(pkg.vsidianAddon.manifestVersion).toBe(1)
    expect(pkg.vsidianAddon.api).toBe('^1.0.0')
    // 首期两块能力（粘贴还原 bridge#2 / 主题 bridge#3）全在稳定候选面；
    // experimental 声明宿主未提供的入口名会使整个组件判不兼容
    // （experimental-unsupported），保守清单是零 experimental 表。后续票
    // 确需实验入口时在此扩充，且范围必须 ^（宿主升级兼容判定要求）
    expect(pkg.vsidianAddon.experimental).toBeUndefined()
  })

  it('宿主依赖与下界对齐', () => {
    expect(pkg.extensionDependencies).toEqual(['onegayi.vsidian'])
    expect(pkg.extensionKind).toEqual(['workspace'])
    expect(pkg.engines.vscode).toBe('^1.82.3')
    expect(pkg.main).toBe('./dist/extension.js')
  })

  it('依赖全部精确版本（无 ^ / ~ 前缀）', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const [name, range] of Object.entries(deps)) {
      expect(range, `${name} 应为精确版本`).toMatch(/^\d/)
    }
  })
})

describe('vendor SDK 类型快照纪律（锚定 vsidian@301d2c16）', () => {
  const vendorFiles = listFiles('types/vendor').filter((f) => f.endsWith('.ts'))

  it('快照在场且非空，含本仓直接消费面（粘贴规则 + 主题）', () => {
    expect(vendorFiles.length).toBeGreaterThanOrEqual(17)
    for (const entry of [
      'types/vendor/shared/addonPage.ts',
      'types/vendor/shared/addonPasteRules.ts',
      'types/vendor/shared/addonThemes.ts',
      'types/vendor/shared/addonRenderers.ts',
      'types/vendor/shared/addonIdentity.ts',
      'types/vendor/host/addons/addonRegistry.ts',
    ]) {
      expect(existsSync(path.join(repoRoot, entry)), `${entry} 缺失`).toBe(true)
    }
  })

  it('每个快照文件头标注来源 commit（vendored from ONEGAYI/vsidian@）', () => {
    expect(vendorFiles.length).toBeGreaterThan(0)
    for (const rel of vendorFiles) {
      const head = readFileSync(path.join(repoRoot, rel), 'utf8').split('\n')[0]
      expect(head, `${rel} 缺 vendored 头`).toMatch(/^\/\/ vendored from ONEGAYI\/vsidian@[0-9a-f]{40} — /)
    }
  })

  it('快照锚定提交与脚本 DEFAULT_COMMIT 一致（改锚必须 re-vendor）', () => {
    const script = readFileSync(path.join(repoRoot, 'scripts/vendorSdkTypes.mjs'), 'utf8')
    const anchor = script.match(/DEFAULT_COMMIT = '([0-9a-f]{40})'/)
    expect(anchor, '脚本缺 40 位 DEFAULT_COMMIT 锚定').not.toBeNull()
    const commit = anchor![1]
    // 锚定 batch-2 合入点（PR #564，含 #530 粘贴 + #546/T07 主题 API 面）
    expect(commit).toBe('301d2c162a25f1e34c90cb54f74a26cdc2fbee7e')
    for (const rel of vendorFiles) {
      const head = readFileSync(path.join(repoRoot, rel), 'utf8').split('\n')[0]
      expect(head, `${rel} 头注与 DEFAULT_COMMIT 不一致`).toContain(`vsidian@${commit} — `)
    }
  })

  it('默认源仓路径为同级一级上：代码与头注释一致', () => {
    // 脚本顶层即执行副作用（读 env / exit），无法 import 做行为断言，
    // 故钉源码文本契约；CI runner 同级仓不在场，磁盘存在性断言必假红
    const text = readFileSync(path.join(repoRoot, 'scripts/vendorSdkTypes.mjs'), 'utf8')
    // 正向：默认值恰为一级上（两仓同级布局裸跑 vendor 系命令可达）
    expect(text).toContain(`path.join(repoRoot, '..', 'vscode-obsidian-like-editor')`)
    // 负向：防回潮两级上（同级布局下不可达必挂）
    expect(text, '默认源仓路径回潮两级上').not.toContain(`'..', '..', 'vscode-obsidian-like-editor'`)
    // 头注释定位序声称的默认语义与代码同源
    expect(text).toContain(`> ../vscode-obsidian-like-editor`)
  })

  it('生成模式原子替换：全部产物先写暂存目录再整体换入', () => {
    // 同上钉文本契约：生成分支不得「先 rmSync 快照目录再逐个写入」——
    // 写入中途失败（磁盘满/变换异常）会把已提交快照破坏成半成品，
    // vendor:check 与评审 diff 都失去稳定基线；要求 staging 写满 +
    // rename 整体换入、失败保留原快照的替换路径
    const text = readFileSync(path.join(repoRoot, 'scripts/vendorSdkTypes.mjs'), 'utf8')
    expect(text, '生成模式不得先删原快照目录').not.toMatch(/rmSync\(outDir/)
    expect(text, '缺少暂存目录整体换入（renameSync(staging, outDir)）').toContain('renameSync(staging, outDir)')
  })
})

describe('目录结构契约（脚手架主体在场）', () => {
  it('构建链与入口文件齐备', () => {
    for (const entry of [
      'build.mjs',
      'tools/buildLib.mjs',
      'tools/sdkBridge.mjs',
      'tools/cm6Markers.mjs',
      'scripts/vendorSdkTypes.mjs',
      'tsconfig.json',
      'vitest.config.ts',
      'src/extension.ts',
      'src/page-editor.ts',
      'src/host-api.ts',
      'src/vsidian-addon-sdk.d.ts',
    ]) {
      expect(existsSync(path.join(repoRoot, entry)), `${entry} 缺失`).toBe(true)
    }
  })
})

describe('源码导入纪律（构建桥第一道防线的测试侧镜像）', () => {
  const srcFiles = listFiles('src').filter((f) => f.endsWith('.ts'))

  it('types/vendor 只允许 type-only 导入', () => {
    expect(srcFiles.length).toBeGreaterThan(0)
    for (const rel of srcFiles) {
      const lines = readFileSync(path.join(repoRoot, rel), 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!/^\s*import\s/.test(line)) return
        // 目标是 types/vendor 的导入行必须是 import type（逐行判定，约定
        // 导入语句单行书写——构建桥与产物扫描是兜底防线）
        if (!/['"][^'"]*types\/vendor/.test(line)) return
        expect(
          /^\s*import\s+type\b/.test(line),
          `${rel}:${index + 1} 值导入 vendor（只允许 import type）：${line.trim()}`,
        ).toBe(true)
      })
    }
  })

  it('动态代码禁令：src 下不得调用 new Function / eval——CSP 页面必炸', () => {
    for (const rel of srcFiles) {
      // 注释行豁免（头注与决策说明会提及该词；禁的是可执行代码）
      const codeLines = readFileSync(path.join(repoRoot, rel), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      for (const line of codeLines) {
        expect(line, `${rel} 含 new Function 调用`).not.toContain('new Function')
        expect(line, `${rel} 含 eval 调用`).not.toMatch(/\beval\s*\(/)
      }
    }
  })
})

describe('构建产物形态（npm test 内置先构建）', () => {
  // 直调 vitest（npx vitest run）且未先构建时，缺产物不是契约失败而是前置
  // 步骤缺失——附明确提示避免误报为构建链回归；npm test 先构建不受影响
  const distHint = '（dist/ 不在场：请先运行 npm run compile，或使用 npm test——其内置先构建）'

  it('双产物在场：宿主 CJS + 页面 IIFE', () => {
    expect(existsSync(path.join(repoRoot, 'dist/extension.js')), `dist/extension.js 缺失${distHint}`).toBe(true)
    expect(existsSync(path.join(repoRoot, 'dist/editor.js')), `dist/editor.js 缺失${distHint}`).toBe(true)
  })

  it('宿主产物仅 require vscode；页面产物零 require', () => {
    // 本用例直接读产物内容，缺产物时 ENOENT 堆栈难定位——先在场断言给提示
    for (const rel of ['dist/extension.js', 'dist/editor.js']) {
      expect(existsSync(path.join(repoRoot, rel)), `${rel} 缺失${distHint}`).toBe(true)
    }
    const extractRequires = (rel: string): string[] => {
      const text = readFileSync(path.join(repoRoot, rel), 'utf8')
      return [...text.matchAll(/require\(\s*(['"])([^'"]*)\1\s*\)/g)].map((m) => m[2])
    }
    const hostRequires = extractRequires('dist/extension.js')
    expect(hostRequires.every((id) => id === 'vscode'), `宿主产物含 vscode 之外的裸 require：${hostRequires.join(', ')}`).toBe(true)
    expect(extractRequires('dist/editor.js'), '页面产物须为自包含 IIFE（零 require）').toEqual([])
  })
})
