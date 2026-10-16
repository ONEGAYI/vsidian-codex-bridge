// 发布红线契约（票 #4 + 发布链路升级）：钉住 scripts/release.mjs 的纯函数
// 语义——VSIX 内容清单与体积红线（Mermaid 分块大头按本仓基线定线）、解包
// manifest 冒烟口径、CHANGELOG 最新版本段提取（Release notes 来源）、
// 发布前置校验（tag 命中 / GH_TOKEN / Release 不覆盖）。主流程（spawn
// vsce / gh / PowerShell 读 zip）不在此测：跨进程 IO 归 `npm run package`
// 端到端与 release.yml 工作流承载（真实产物实测）。另钉两组仓库现状
// 契约：.vscodeignore 排除清单（黑名单输入侧；产物输出侧由禁止模式钉住）
// 与发布护栏（真实发布通道的保护语义——发布只允许经显式 release 子命令
// 在精确命中 v<version> 标签、环境齐备、Release 不存在时执行）。形态对齐
// 参照仓 vsidian-easy-typing 的 test/release.test.ts 与上游 vsidian 主仓
// scripts/release.mjs 的 CHANGELOG 提取面，按本仓差异适配：无 Unreleased
// 转正工具（发版提交人工写版本段）、尾部变更链接注释不卷入 notes、
// Mermaid esm 分块产物（dist/mermaid-chunks/ 非空为必需项）。
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  SIZE_LIMITS,
  parseUnzipListing,
  parsePszListing,
  inspectVsixEntries,
  inspectVsixManifest,
  extractLatestChangelog,
  mergeSoftWraps,
  checkReleasePreconditions,
} from '../scripts/release.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 2026-10-16 实测打包基线的最小形态（mermaid 11.12.2 / layout-elk 0.2.0）：
// dist 解压共约 4.16 MB——editor.js 2.6 KB + extension.js 2.2 KB +
// mermaid.js 29 KB + 76 个分块约 3.93 MB（最大 ELK render 块约 1.4 MB）。
// 测试基线取代表分块三个（含大块），分块数量随构建变化不逐个枚举。
const BASE_ENTRIES = [
  { size: 1911, name: '[Content_Types].xml' },
  { size: 3000, name: 'extension.vsixmanifest' },
  { size: 1085, name: 'extension/LICENSE.txt' },
  { size: 1485, name: 'extension/package.json' },
  { size: 6000, name: 'extension/readme.md' },
  // vsce 自动打入（存在 CHANGELOG.md 时），扩展详情页 Changelog 标签页的
  // 数据源——发布链路升级后随包（上游 vsidian 同款）
  { size: 4500, name: 'extension/changelog.md' },
  { size: 2191, name: 'extension/dist/extension.js' },
  { size: 2612, name: 'extension/dist/editor.js' },
  { size: 29140, name: 'extension/dist/mermaid.js' },
  { size: 1467171, name: 'extension/dist/mermaid-chunks/render-2SQLY5QG-43DA4HWE.js' },
  { size: 443941, name: 'extension/dist/mermaid-chunks/chunk-7N23KT5N.js' },
  { size: 388858, name: 'extension/dist/mermaid-chunks/chunk-Q5GDCX74.js' },
]

const REPO_PKG = {
  name: 'vsidian-codex-bridge',
  publisher: 'ONEGAYI',
  version: '0.1.0',
  main: './dist/extension.js',
  extensionDependencies: ['onegayi.vsidian'],
  vsidianAddon: {
    manifestVersion: 1,
    api: '^1.0.0',
  },
}

describe('zip 条目解析（unzip 与 PowerShell 双通道）', () => {
  it('parseUnzipListing：解析 unzip -l 行，跳过表头与合计', () => {
    const text = [
      'Archive:  x.vsix',
      '  Length      Date    Time    Name',
      '---------  ---------- -----   ----',
      '     1911  2026-10-16 12:00   [Content_Types].xml',
      '     3000  2026-10-16 12:00   extension.vsixmanifest',
      '---------                     -------',
      '    95388                     9 files',
    ].join('\n')
    expect(parseUnzipListing(text)).toEqual([
      { size: 1911, name: '[Content_Types].xml' },
      { size: 3000, name: 'extension.vsixmanifest' },
    ])
  })

  it('parsePszListing：解析「大小\\t路径」行，跳过杂行', () => {
    const text = ['1911\t[Content_Types].xml', '', '3000\textension.vsixmanifest'].join('\n')
    expect(parsePszListing(text)).toEqual([
      { size: 1911, name: '[Content_Types].xml' },
      { size: 3000, name: 'extension.vsixmanifest' },
    ])
  })
})

describe('inspectVsixEntries（内容清单与体积红线）', () => {
  it('基线清单通过：必需产物齐全、分块在场、无禁止文件、体积在阈值内', () => {
    const result = inspectVsixEntries(BASE_ENTRIES)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.totalBytes).toBe(BASE_ENTRIES.reduce((s, e) => s + e.size, 0))
  })

  it('缺任一运行时产物即失败（宿主 / 页面 / mermaid 入口与分块）', () => {
    for (const name of [
      'extension/dist/extension.js',
      'extension/dist/editor.js',
      // mermaid esm 入口：分块懒加载的装载锚（resourceUri 目标）
      'extension/dist/mermaid.js',
      'extension/package.json',
      'extension/readme.md',
      'extension/changelog.md',
    ]) {
      const result = inspectVsixEntries(BASE_ENTRIES.filter((e) => e.name !== name))
      expect(result.ok, `缺 ${name} 应报错`).toBe(false)
    }
  })

  it('mermaid 分块目录全缺即失败（splitting 失效或清理后未重建）', () => {
    const result = inspectVsixEntries(BASE_ENTRIES.filter((e) => !e.name.includes('mermaid-chunks/')))
    expect(result.ok, '零分块应报错').toBe(false)
    expect(result.errors.join('\n')).toMatch(/mermaid-chunks/)
  })

  it('缺结构文件（vsixmanifest / Content_Types）即失败，大小写不敏感', () => {
    const noManifest = inspectVsixEntries(BASE_ENTRIES.filter((e) => !e.name.endsWith('vsixmanifest')))
    expect(noManifest.ok).toBe(false)
    const noTypes = inspectVsixEntries(BASE_ENTRIES.filter((e) => !/content_types/i.test(e.name)))
    expect(noTypes.ok).toBe(false)
  })

  it('LICENSE 形态兼容 LICENSE.txt 与裸 LICENSE', () => {
    const bare = BASE_ENTRIES.filter((e) => !/license/i.test(e.name))
    bare.push({ size: 1000, name: 'extension/LICENSE' })
    expect(inspectVsixEntries(bare).errors).toEqual([])
  })

  it('禁止模式拦截：源码 / 测试 / 文档 / vendor / node_modules / sourcemap / lockfile / 嵌套 vsix', () => {
    for (const [name, label] of [
      ['extension/src/extension.ts', 'TypeScript 源码'],
      ['extension/test/release.test.ts', '测试'],
      ['extension/types/vendor/shared/addonPage.ts', 'vendor 类型快照'],
      ['extension/tools/buildLib.mjs', '构建桥'],
      ['extension/scripts/release.mjs', '发布脚本'],
      ['extension/docs/adr/0004-x.md', '项目文档'],
      ['extension/node_modules/mermaid/dist/mermaid.js', 'node_modules'],
      ['extension/.github/workflows/ci.yml', 'GitHub 平台配置'],
      ['extension/dist/mermaid-chunks/render-2SQLY5QG.js.map', 'sourcemap'],
      ['extension/package-lock.json', 'npm lockfile'],
      ['extension/nested.vsix', 'VSIX 嵌套'],
    ] as Array<[string, string]>) {
      const result = inspectVsixEntries([...BASE_ENTRIES, { size: 100, name }])
      expect(result.ok, `${label} ${name} 进包应报错`).toBe(false)
    }
  })

  it('未知顶层条目拒绝（黑名单拦不住的工具残留，白名单兜底）', () => {
    const result = inspectVsixEntries([...BASE_ENTRIES, { size: 10, name: 'extension/.zcode/config' }])
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/未知顶层/)
  })

  it('dist/ 下未登记产物拒绝（构建实验残留），mermaid-chunks/ 分块放行', () => {
    const result = inspectVsixEntries([...BASE_ENTRIES, { size: 10, name: 'extension/dist/debug.js' }])
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/未登记/)
    // 新散列分块（构建产物正常变化）不构成「未登记」——分块目录前缀放行
    const rebuilt = inspectVsixEntries([
      ...BASE_ENTRIES,
      { size: 1000, name: 'extension/dist/mermaid-chunks/render-NEWHASH-abc.js' },
    ])
    expect(rebuilt.ok).toBe(true)
  })

  it('解压总量：超警告线只警告，超失败线报错', () => {
    const KB = 1024
    // 构造总量落进 (警告线, 失败线) 区间：三个大分块各 3 MB（单文件未超
    // 3 MB 警告线的整数倍不触发——此处取 3 * 1024 * 1024 - 1 恰在单文件
    // 警告线下），总量约 9 MB 只触发总量警告
    const inflated = BASE_ENTRIES.map((e) =>
      e.name.includes('mermaid-chunks/')
        ? { ...e, size: 3 * KB * KB - 1 }
        : e,
    )
    expect(inspectVsixEntries(inflated).warnings.some((w) => w.includes('解压总体积'))).toBe(true)
    expect(inspectVsixEntries(inflated).ok).toBe(true)
    // 各 6 MB - 1 × 3 → 总量约 18 MB 超失败线（单文件恰未超 6 MB 失败线）
    const overMax = BASE_ENTRIES.map((e) =>
      e.name.includes('mermaid-chunks/')
        ? { ...e, size: 6 * KB * KB - 1 }
        : e,
    )
    expect(inspectVsixEntries(overMax).ok).toBe(false)
    expect(inspectVsixEntries(overMax).errors.join('\n')).toMatch(/解压总体积/)
  })

  it('单文件：超警告线只警告，超失败线报错', () => {
    const withBig = BASE_ENTRIES.map((e) =>
      e.name.includes('render-') ? { ...e, size: SIZE_LIMITS.fileWarnBytes + 1 } : e,
    )
    expect(inspectVsixEntries(withBig).warnings.some((w) => w.includes('单文件'))).toBe(true)
    expect(inspectVsixEntries(withBig).ok).toBe(true)
    const overMax = BASE_ENTRIES.map((e) =>
      e.name.includes('render-') ? { ...e, size: SIZE_LIMITS.fileMaxBytes + 1 } : e,
    )
    expect(inspectVsixEntries(overMax).ok).toBe(false)
  })
})

describe('inspectVsixManifest（解包冒烟：manifest 合法性与声明核对）', () => {
  const manifestText = JSON.stringify(REPO_PKG, null, 2)

  it('与仓库清单一致的 manifest 通过', () => {
    const result = inspectVsixManifest(manifestText, REPO_PKG)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('非法 JSON 报错', () => {
    expect(inspectVsixManifest('{oops', REPO_PKG).ok).toBe(false)
  })

  it('版本与仓库不一致报错（打包时版本漂移）', () => {
    const drifted = JSON.stringify({ ...REPO_PKG, version: '0.0.9' })
    const result = inspectVsixManifest(drifted, REPO_PKG)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/version/)
  })

  it('extensionDependencies 缺宿主声明报错', () => {
    const noDeps = JSON.stringify({ ...REPO_PKG, extensionDependencies: [] })
    const result = inspectVsixManifest(noDeps, REPO_PKG)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/extensionDependencies/)
  })

  it('vsidianAddon 身份声明缺失或漂移报错（宿主发现机制的入口）', () => {
    const missing = JSON.stringify({ ...REPO_PKG, vsidianAddon: undefined })
    expect(inspectVsixManifest(missing, REPO_PKG).ok).toBe(false)
    const drifted = JSON.stringify({
      ...REPO_PKG,
      vsidianAddon: { manifestVersion: 1, api: '^1.0.0', experimental: { cm6: '^1.1.0' } },
    })
    const result = inspectVsixManifest(drifted, REPO_PKG)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/vsidianAddon/)
  })

  it('main 入口漂移报错', () => {
    const drifted = JSON.stringify({ ...REPO_PKG, main: './out/extension.js' })
    const result = inspectVsixManifest(drifted, REPO_PKG)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/main/)
  })
})

describe('mergeSoftWraps（段内软换行合并：Release notes 面向网页渲染）', () => {
  it('普通行拼接到上一行：CJK 字母接 ASCII 词界补空格、标点侧直接拼', () => {
    // 上一行以 CJK 字母（「词」）结尾、下一行 ASCII 开头 → 补空格；
    // 上一行以全角标点（非 CJK 字母类）结尾 → 直接拼接（上游判据只认词界）
    const body = ['第一行开头结尾词', 'second line（CJK 字母接 ASCII 补空格）', '后半句（前接全角标点直接拼）'].join('\n')
    expect(mergeSoftWraps(body)).toBe('第一行开头结尾词 second line（CJK 字母接 ASCII 补空格）后半句（前接全角标点直接拼）')
  })

  it('结构边界保留换行：空行、列表项、标题、引用', () => {
    const body = ['段一', '', '- 列表项', '### 小标题', '> 引用'].join('\n')
    expect(mergeSoftWraps(body).split('\n')).toEqual(['段一', '', '- 列表项', '### 小标题', '> 引用'])
  })

  it('HTML 注释块整体原样保留（换行不合并；真实形态：变更链接区在文件尾）', () => {
    const body = ['正文', '<!-- 变更链接', '0.1.0: https://example.com/commits/v0.1.0', '-->'].join('\n')
    expect(mergeSoftWraps(body)).toBe(body)
  })
})

describe('extractLatestChangelog（CHANGELOG 最新版本段提取，Release notes 来源）', () => {
  const body = ['### 新功能', '', '**粘贴还原（#2 / PR #5）**', '', '- 还原 data-prompt-link span 为 Markdown 链接', '  折行的第二半句', ''].join('\n')
  const withComments = [
    '## Unreleased - 开发中', '', '### 新功能', '', '- 开发中的条目', '',
    `## [0.1.0] - 2026-10-16`, '', body,
    '<!-- 变更链接', '0.1.0: https://github.com/ONEGAYI/vsidian-codex-bridge/commits/v0.1.0', '-->', '',
  ].join('\n')

  it('跳过 Unreleased 开发段，提取首个版本段（Keep a Changelog 方括号形态）', () => {
    const section = extractLatestChangelog(withComments, '0.1.0')
    expect(section.version).toBe('0.1.0')
    expect(section.date).toBe('2026-10-16')
    // 开发段条目不混入发布说明
    expect(section.body).not.toContain('开发中的条目')
    expect(section.body).toContain('**粘贴还原（#2 / PR #5）**')
    // 段内折行按 mergeSoftWraps 语义合并
    expect(section.body).toContain('还原 data-prompt-link span 为 Markdown 链接折行的第二半句')
  })

  it('尾部变更链接注释块不卷入版本段（首版即最老段的本仓适配）', () => {
    const section = extractLatestChangelog(withComments, '0.1.0')
    expect(section.body).not.toContain('变更链接')
    expect(section.body).not.toContain('<!--')
  })

  it('无方括号版本段形态兼容（上游 vsidian 段头形态）', () => {
    const section = extractLatestChangelog(['## 0.2.0 - 2026-11-01', '', '- 条目'].join('\n'), '0.2.0')
    expect(section.version).toBe('0.2.0')
    expect(section.date).toBe('2026-11-01')
  })

  it('最新版本段与 package.json version 不一致时报错（发版提交遗漏 bump 或 CHANGELOG 未转正）', () => {
    expect(() => extractLatestChangelog(withComments, '0.2.0')).toThrow(/0\.1\.0.*0\.2\.0|0\.2\.0.*0\.1\.0/)
  })

  it('无任何版本段时报错', () => {
    expect(() => extractLatestChangelog('# Changelog\n\n只有说明', '0.1.0')).toThrow(/未找到/)
  })

  it('仓库 CHANGELOG.md 在场且 0.1.0 段可被解析（真实文件契约）', () => {
    const file = path.join(repoRoot, 'CHANGELOG.md')
    expect(existsSync(file), 'CHANGELOG.md 缺失').toBe(true)
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string }
    const section = extractLatestChangelog(readFileSync(file, 'utf8'), pkg.version)
    expect(section.date, '0.1.0 段应带日期').toBe('2026-10-16')
    expect(section.body.length).toBeGreaterThan(0)
    // 首版三大主题组在场（发布说明的主干）
    for (const topic of ['粘贴还原', 'Mermaid Codex 主题', '工程与发布基建']) {
      expect(section.body, `主题组「${topic}」应在场`).toContain(topic)
    }
  })
})

describe('checkReleasePreconditions（发布前置校验：tag 命中 / 认证 / 不覆盖）', () => {
  const ready = { version: '0.1.0', headTag: 'v0.1.0', ghToken: 'ghs_test', releaseExists: false }

  it('环境齐备放行', () => {
    const result = checkReleasePreconditions(ready)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('HEAD 未精确命中 v<version> 标签即拒绝（无标签或错标签都拒）', () => {
    for (const headTag of [null, 'v0.0.9', 'v0.1.0-rc.1']) {
      const result = checkReleasePreconditions({ ...ready, headTag })
      expect(result.ok, `headTag=${headTag} 应拒绝`).toBe(false)
      expect(result.errors.join('\n')).toMatch(/v0\.1\.0/)
    }
  })

  it('GH_TOKEN 缺失即拒绝（gh release create 无认证）', () => {
    const result = checkReleasePreconditions({ ...ready, ghToken: '' })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/GH_TOKEN/)
  })

  it('Release 已存在即拒绝，不覆盖既有发布', () => {
    const result = checkReleasePreconditions({ ...ready, releaseExists: true })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/已存在|不覆盖/)
  })

  it('releaseExists 未探测（undefined）不构成拒绝——存在性探测在静态校验之后', () => {
    const result = checkReleasePreconditions({ version: '0.1.0', headTag: 'v0.1.0', ghToken: 'ghs_test' })
    expect(result.ok).toBe(true)
  })
})

describe('仓库现状契约（.vscodeignore 输入侧与发布护栏）', () => {
  it('.vscodeignore 排除源码/测试/文档/工程设施（与检查器禁止模式同源）', () => {
    const file = path.join(repoRoot, '.vscodeignore')
    expect(existsSync(file), '.vscodeignore 缺失').toBe(true)
    const text = readFileSync(file, 'utf8')
    for (const pattern of [
      'src/**',
      'test/**',
      'types/**',
      'tools/**',
      'scripts/**',
      'docs/**',
      'node_modules/**',
      '**/*.map',
      'package-lock.json',
    ]) {
      expect(text, `应排除 ${pattern}`).toContain(pattern)
    }
  })

  it('SIZE_LIMITS 双线语义：警告线严于失败线、失败线容纳当前基线', () => {
    expect(SIZE_LIMITS.totalWarnBytes).toBeLessThan(SIZE_LIMITS.totalMaxBytes)
    expect(SIZE_LIMITS.fileWarnBytes).toBeLessThan(SIZE_LIMITS.fileMaxBytes)
    // 总量失败线须容纳 dist 基线约 4.16 MB 解压 + 清单/文档约 0.1 MB
    expect(SIZE_LIMITS.totalMaxBytes).toBeGreaterThan(4300 * 1024)
    // 单文件警告线须容纳最大分块基线（ELK render 块约 1.4 MB）
    expect(SIZE_LIMITS.fileWarnBytes).toBeGreaterThan(1500 * 1024)
  })

  it('发布护栏代码化：发布经显式 release 子命令 + gh release create，前置校验四道闸', () => {
    // 真实发布通道（2026-10-16 用户决策升级）后的保护语义：发布只允许在
    // 显式 release 子命令内执行，且经 checkReleasePreconditions 四道闸
    // （tag 命中 / GH_TOKEN / Release 不覆盖）+ 工作树干净检查。旧
    // --upload/--publish 入口废弃并指引新子命令，不再是无通道时期的死拒
    const text = readFileSync(path.join(repoRoot, 'scripts/release.mjs'), 'utf8')
    expect(text).toContain('checkReleasePreconditions(')
    expect(text).toMatch(/gh release create/)
    // --notes-file 语义：Release 说明写入完整版本段（临时文件）
    expect(text).toMatch(/--notes-file/)
    // 旧入口显式拒绝并指引（防误以为 --upload 仍是无通道护栏语义）
    expect(text).toContain(`argv.includes('--upload')`)
    expect(text).toContain(`argv.includes('--publish')`)
    expect(text).toMatch(/release 子命令/)
  })
})
