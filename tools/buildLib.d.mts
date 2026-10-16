// tools/buildLib.mjs 的编译期类型声明（test/build-esm-guard.test.ts 消费）。
// 对齐本仓 scripts/release.d.mts 先例：构建工具脚本不进 tsconfig include，
// 声明只描述契约测试用到的导出面（scanArtifact 与 buildAddon 签名）。

export interface PageEntry {
  entry: string
  out: string
}

export interface EsmModuleEntry {
  entry: string
  name: string
}

export interface BuildAddonInput {
  pages: PageEntry[]
  /** 宿主入口（相对仓库根）；可省略——局部构建/测试场景跳过宿主段 */
  host?: string
  esmModules?: EsmModuleEntry[]
  log?: (message: string) => void
}

/**
 * 产物静态扫描：page（浏览器 IIFE，零 require）/ host（扩展宿主 CJS，
 * 仅 vscode）/ esm（浏览器模块产物，require 边界不适用）。所有产物都
 * 不得含 CM6 运行时标记与 vsidian 内部路径标记，命中即抛错。
 */
export function scanArtifact(productPath: string, kind: 'page' | 'host' | 'esm'): void

/** 构建本插件（页面 IIFE + 宿主 CJS + esm 模块产物，逐产物扫描） */
export function buildAddon(input: BuildAddonInput): Promise<{ distDir: string }>
