// scripts/release.mjs 的编译期类型声明（test/release.test.ts 消费）。
// 对齐 vsidian 主仓 scripts/genNls.d.mts 与参照仓 vsidian-easy-typing
// scripts/release.d.mts 先例：工具脚本不进 tsconfig include，声明只描述
// 契约测试用到的纯函数面（本仓无 CHANGELOG Unreleased 转正面，无
// promote/validate 版本函数；发布链路升级新增 CHANGELOG 提取与发布前置
// 校验两组纯函数）。

export interface SizeLimits {
  /** 解压总量警告线（字节），超出仅警告 */
  totalWarnBytes: number
  /** 解压总量失败线（字节），超出非零退出 */
  totalMaxBytes: number
  /** 单文件警告线（字节） */
  fileWarnBytes: number
  /** 单文件失败线（字节） */
  fileMaxBytes: number
}

export interface ZipEntry {
  size: number
  name: string
}

export interface InspectResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  totalBytes: number
}

export interface RepoPkgShape {
  name: string
  publisher: string
  version: string
  main: string
  extensionDependencies: string[]
  vsidianAddon: {
    manifestVersion: number
    api: string
    experimental?: Record<string, string>
  }
}

/** CHANGELOG 最新版本段（GitHub Release 发布说明来源） */
export interface ChangelogSection {
  version: string
  /** 段头日期（`## [x.y.z] - <date>` 的 date 部分，缺省为 null） */
  date: string | null
  /** 段体（软换行已按 mergeSoftWraps 语义合并） */
  body: string
}

/** 发布前置校验入参（checkReleasePreconditions） */
export interface ReleasePreconditions {
  version: string
  /** git describe --tags --exact-match HEAD 结果，无精确命中为 null */
  headTag: string | null
  /** GH_TOKEN 环境变量；缺失即拒绝 */
  ghToken?: string
  /** Release 存在性探测结果；true 拒绝（不覆盖），undefined（未探测）不构成拒绝 */
  releaseExists?: boolean
}

export const SIZE_LIMITS: SizeLimits

export function parseUnzipListing(text: string): ZipEntry[]
export function parsePszListing(text: string): ZipEntry[]
export function inspectVsixEntries(entries: ZipEntry[]): InspectResult
export function inspectVsixManifest(manifestText: string, repoPkg: RepoPkgShape): InspectResult

/** 段内软换行合并（自上游 vsidian 主仓移植）：网页渲染友好的发布说明文本 */
export function mergeSoftWraps(body: string): string

/** 提取 CHANGELOG.md 最新版本段；版本不一致或无版本段时抛错 */
export function extractLatestChangelog(content: string, expectedVersion: string): ChangelogSection

/** 发布前置校验：tag 命中 / GH_TOKEN / Release 不覆盖，全过才放行 */
export function checkReleasePreconditions(pre: ReleasePreconditions): { ok: boolean; errors: string[] }
