// 静默宿主启动包装（票 #4 常驻宿主测试基建层）：自同作者上游仓
// ONEGAYI/vsidian 迁移（test/integration/testHost.mjs@301d2c16 的 spawn
// 包装节选——openReport/writeReportAll/resolveTestHostMode/runTestHost
// 原样保留原始注释，未迁移上游专有的便携分片/多根工作区/集成报告
// 判定函数）。与上游留两处微差：writeReportAll 的 writeSync 显式传第
// 四参 length（上游为三参调用）；runTestHost 默认 timeoutMs 由上游
// 15min 收紧为 5min——run.mjs 调用处显式传值，默认值无实际影响。
//
// 通道形态：Windows 经 powershell 包装 hiddenDesktop.ps1（Base64 配置，
// windowsHide），VSCode 宿主起在独立窗口站+桌面（用户桌面不可见、剪贴板
// 随窗口站隔离、Job Object KILL_ON_JOB_CLOSE 保证启动器退出即清理进程
// 树）；非 Windows **拒绝运行**（无隔离后端，foreground 会在用户桌面弹
// GUI——违反本仓静默约定，见 resolveTestHostMode）。宿主超时/信号均经
// stop 统一收尾并留最近输出尾行；stdout/stderr 全量写报告文件（跑一次
// = 留一份证据，复核读文件不重跑）。
//
// 静默性证据：hiddenDesktop.ps1 结束时输出「[testHost] 测试桌面可见窗口
// 峰值 N；观察期间前台 PID …；结束时前台 PID …；宿主退出码 …」——desktop
// 模式下宿主窗口只存在于测试桌面（峰值计数即证据），前台 PID 采样观察
// 用户桌面前台是否被测试宿主抢占。
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const hiddenDesktopScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hiddenDesktop.ps1')

function writeReportAll(fd, data) {
  // writeSync 对普通文件也可能部分写入，循环写满
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
  let offset = 0
  while (offset < buf.length) offset += writeSync(fd, buf, offset, buf.length - offset)
}

function openReport(reportPath, stderr) {
  try {
    mkdirSync(path.dirname(reportPath), { recursive: true })
    const fd = openSync(reportPath, 'w')
    writeReportAll(fd, `[testHost] 运行报告 ${new Date().toISOString()}\n`)
    return fd
  } catch (error) {
    stderr.write(`[testHost] 报告文件不可写（${reportPath}）：${error.message}；继续运行但不留报告\n`)
    return -1
  }
}

export function resolveTestHostMode(platform = process.platform, env = process.env) {
  const requested = env.VSIDIAN_TEST_HOST_MODE
  if (requested && requested !== 'desktop' && requested !== 'foreground') {
    throw new Error(`VSIDIAN_TEST_HOST_MODE 只能为 desktop 或 foreground，收到 ${requested}`)
  }
  if (requested === 'desktop' && platform !== 'win32') {
    throw new Error('VSIDIAN_TEST_HOST_MODE=desktop 仅支持 Windows')
  }
  if (platform === 'win32') {
    return requested ?? 'desktop'
  }
  // 非 Windows 一律拒绝（PR #5 约定统一）：独立桌面后端（hiddenDesktop.ps1）
  // 是 Win32 通道，本仓约定宿主层禁止用户桌面可见 GUI——foreground 会在
  // 用户桌面弹出宿主窗口，静默回落不可接受。显式请求 foreground 同样拒
  // 绝（无隔离后端时不存在合规的可见模式）。如需在 Linux/macOS 跑宿主层，
  // 先为该平台提供隔离后端（如 Linux 下 xvfb/headless 方案）再放开。
  throw new Error(
    '非 Windows 平台无静默宿主后端：独立桌面通道（hiddenDesktop.ps1）仅支持 Windows，' +
      'foreground 模式会在用户桌面弹出 GUI——按本仓「宿主层禁止用户桌面可见 GUI」约定拒绝运行。' +
      '如需支持该平台，请先提供隔离后端（如 Linux 的 xvfb/headless）再放开此处。',
  )
}

export function runTestHost({ executable, args, env, mode = resolveTestHostMode(), timeoutMs = 5 * 60_000, stdout = process.stdout, stderr = process.stderr, reportPath }) {
  if (mode === 'desktop' && process.platform !== 'win32') {
    throw new Error('独立桌面仅支持 Windows')
  }
  if (mode !== 'desktop' && mode !== 'foreground') {
    throw new Error(`未知测试宿主模式：${mode}`)
  }
  if (mode === 'foreground' && process.platform !== 'win32') {
    // 防线：resolveTestHostMode 已拒，显式传 mode 绕过默认值时同样拦截
    throw new Error('foreground 模式仅支持 Windows（非 Windows 无隔离后端，会在用户桌面弹 GUI）')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`测试宿主超时必须为正数：${timeoutMs}`)
  }
  const reportFd = reportPath ? openReport(reportPath, stderr) : -1
  const report = (data) => { if (reportFd >= 0) writeReportAll(reportFd, data) }
  const windowsWrapper = process.platform === 'win32'
  const command = windowsWrapper ? 'powershell.exe' : executable
  const commandArgs = windowsWrapper
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hiddenDesktopScript,
      Buffer.from(JSON.stringify({ executable, args, cwd: process.cwd(), mode, parentPid: process.pid }), 'utf8').toString('base64')]
    : args
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { env, windowsHide: windowsWrapper })
    let stopCode = 0
    // 最近输出环形缓冲（超时/信号停止时随原因就地输出——分清「超时截断」
    // 与「真失败」、定位断点用例，不必回读报告；只留尾部行防复读洪流）
    const TAIL_LINES = 20
    const tailLines = []
    const noteTail = (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.length === 0) continue
        tailLines.push(line)
        if (tailLines.length > TAIL_LINES) tailLines.shift()
      }
    }
    const writeStop = (reason) => {
      const head = `[testHost] ${reason}，结束本次测试宿主进程树\n`
      const tail = tailLines.length > 0
        ? `[testHost] 最近输出（最后 ${tailLines.length} 行）：\n${tailLines.join('\n')}\n`
        : ''
      report(head + tail)
      stderr.write(head + tail)
    }
    const stop = (code, reason) => {
      if (stopCode) return
      stopCode = code
      writeStop(reason)
      child.kill()
    }
    const onSigint = () => stop(130, '收到 SIGINT')
    const onSigterm = () => stop(143, '收到 SIGTERM')
    const timeout = setTimeout(() => stop(124, `超过 ${timeoutMs} ms`), timeoutMs)
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)
    const cleanup = () => {
      clearTimeout(timeout)
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    }
    child.stdout.on('data', (chunk) => { noteTail(chunk); report(chunk); stdout.write(chunk) })
    child.stderr.on('data', (chunk) => { noteTail(chunk); report(chunk); stderr.write(chunk) })
    child.on('error', (error) => {
      report(`[testHost] 启动失败 ${error.message}\n`)
      if (reportFd >= 0) closeSync(reportFd)
      cleanup(); reject(error)
    })
    child.on('close', (code) => {
      const finalCode = stopCode || (code ?? 1)
      report(`[testHost] 宿主退出码 ${finalCode}\n`)
      if (reportFd >= 0) closeSync(reportFd)
      cleanup(); resolve(finalCode)
    })
  })
}
