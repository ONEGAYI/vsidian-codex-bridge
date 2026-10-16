// 宿主测试基建层结构契约（票 #4）：钉住 test/host/ 常驻基建与 npm 入口
// 在场，及 hiddenDesktop.ps1 静默通道关键 API 未被误改（文本契约，对齐
// vendor 防回潮用例风格——ps1 是自上游 ONEGAYI/vsidian@301d2c16 的原样
// 复制，任何关键调用缺失都意味着静默保证被破坏：宿主会弹回用户桌面）。
// 宿主验证与 npm test 的关系：独立入口（test:host）不级联——宿主验证需
// 要外部 vsidian 仓构建产物与 VSCode 1.82.3（缓存缺失时 130 MB 下载），
// 级联会让单元层失去「秒级、零外部依赖」的属性；两者边界见 ADR-0004。
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('宿主测试基建层（test/host/ 常驻）', () => {
  it('基建四件在场：静默通道 / 启动包装 / 入口 / 用例', () => {
    for (const entry of [
      'test/host/hiddenDesktop.ps1',
      'test/host/silentHost.mjs',
      'test/host/run.mjs',
      'test/host/suite.ts',
    ]) {
      expect(existsSync(path.join(repoRoot, entry)), `${entry} 缺失`).toBe(true)
    }
  })

  it('npm script 入口在场（独立入口，不级联 npm test）', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts['test:host']).toBe('node test/host/run.mjs')
    // 级联防回潮：test 链不得拉起宿主层（外部仓 + GUI 通道依赖）
    expect(pkg.scripts.test, 'npm test 不得级联 test:host').not.toContain('test:host')
  })

  it('hiddenDesktop.ps1 头注含来源指向（同作者上游仓移植）', () => {
    const text = readFileSync(path.join(repoRoot, 'test/host/hiddenDesktop.ps1'), 'utf8')
    expect(text).toContain('ONEGAYI/vsidian')
    expect(text).toContain('301d2c16')
  })

  it('静默通道关键 API 未被误改（独立窗口站/桌面 + 进程树兜底）', () => {
    const text = readFileSync(path.join(repoRoot, 'test/host/hiddenDesktop.ps1'), 'utf8')
    // 独立窗口站 + 独立桌面：lpDesktop 指向新桌面，宿主窗口不进用户桌面
    expect(text).toContain('CreateWindowStation')
    expect(text).toContain('CreateDesktop')
    expect(text).toContain('lpDesktop')
    // Job Object 兜底：KILL_ON_JOB_CLOSE（0x00002000），启动器退出即清理
    expect(text).toContain('JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE')
    expect(text).toContain('0x00002000')
    // 静默性证据行：窗口峰值 + 前台 PID 采样（验证报告据此判定未打扰用户桌面）
    expect(text).toContain('可见窗口峰值')
    expect(text).toContain('前台 PID')
  })

  it('启动包装经 PowerShell 包装且窗口隐藏（windowsHide）', () => {
    const text = readFileSync(path.join(repoRoot, 'test/host/silentHost.mjs'), 'utf8')
    expect(text).toContain("'-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hiddenDesktopScript")
    expect(text).toContain('windowsHide: windowsWrapper')
    // 非 Windows 回退 foreground（desktop 仅 win32）
    expect(text).toContain("requested ?? (platform === 'win32' ? 'desktop' : 'foreground')")
  })

  it('入口自检 batch-2 主题 API 面（防旧宿主产物假红）', () => {
    const text = readFileSync(path.join(repoRoot, 'test/host/run.mjs'), 'utf8')
    expect(text).toContain("_test.addonThemes")
    expect(text).toMatch(/batch-2/)
  })
})
