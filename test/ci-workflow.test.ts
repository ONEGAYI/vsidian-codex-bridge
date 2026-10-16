// CI 工作流结构契约（票 #4）：钉住 .github/workflows/ci.yml 的触发配置
// 与关键步骤在场——「push 与 PR 均触发」是票面验收项，步骤链
// （npm ci → compile → test → vsidian 源仓获取 → vendor:check → vsce 打包
// → artifact 上传）删任一环即回归。用文本断言而非 YAML 解析：仓库
// devDependencies 无 YAML 解析器，不为一组结构断言引入新依赖；断言粒度
// 取关键行，不锁步骤顺序与措辞。形态对齐参照仓 vsidian-easy-typing 的
// test/ci-workflow.test.ts。浏览器层冒烟（test/browser/smoke-mermaid.mjs）
// 借 vsidian 主仓 node_modules 的 Playwright，布局依赖不可移植 CI，
// 不在工作流内（本地跑法见 README）——该边界由 ADR-0004 落档。
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(repoRoot, '.github/workflows/ci.yml')
const releaseWorkflowPath = path.join(repoRoot, '.github/workflows/release.yml')

describe('CI 工作流结构契约', () => {
  it('workflow 文件在场', () => {
    expect(existsSync(workflowPath), '.github/workflows/ci.yml 缺失').toBe(true)
  })

  it('push(main) 与 PR 均触发（票面验收）', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toMatch(/push:\s*\n\s*branches:\s*\[\s*main\s*\]/)
    expect(text).toMatch(/^\s*pull_request:\s*$/m)
  })

  it('步骤链覆盖：install → compile → test → vsidian 源仓获取 → vendor:check', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toContain('npm ci')
    expect(text).toContain('npm run compile')
    expect(text).toContain('npm test')
    // vendor:check 需要读 vsidian 源仓 git 对象（快照锚定 commit），CI 无
    // 本地源仓：先 partial clone 再以 VSIDIAN_SOURCE_REPO 指向，锚定不可达
    // 必须失败而非降级（fail-closed，防漂移检查的意义就在与源对比）
    expect(text).toMatch(/git clone --filter=blob:none .*ONEGAYI\/vsidian\.git/)
    expect(text).toContain('npm run vendor:check')
    expect(text).toContain('VSIDIAN_SOURCE_REPO:')
  })

  it('VSIX 打包与上传在场，与本地 npm run package 同款 vsce 命令', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toContain('vsce package --no-dependencies')
    expect(text).toContain('actions/upload-artifact@v4')
    // 名称带 attempt 号：rerun 后新 attempt 同名上传会覆盖旧报告
    expect(text).toMatch(/name:\s*vsix-a\$\{\{ github\.run_attempt \}\}/)
  })

  it('测试 JSON 报告在失败时上传留证', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toMatch(/reporter=json/)
    expect(text).toMatch(/name:\s*test-report-a\$\{\{ github\.run_attempt \}\}/)
    expect(text).toMatch(/if:\s*\$\{\{ failure\(\) \}\}/)
  })
})

// 发布工作流结构契约（发布链路升级，2026-10-16 用户决策：GitHub Release +
// VSCode Marketplace 双通道自动发布）：钉住 .github/workflows/release.yml 的
// 触发（推 v* 标签 + dispatch 补跑）、双 job 分工与 Marketplace 双开关。
// 形态照搬上游 vsidian 主仓 release.yml，适配点：发布前复验步骤换本仓对应
// 物（vendor:check + 源仓获取，同 ci.yml 方式）；双开关（secrets.VSCE_PAT +
// vars.MARKETPLACE_PUBLISH）在上游仅存于注释语义，本仓显式代码化进 job if。

describe('Release 工作流结构契约', () => {
  it('workflow 文件在场', () => {
    expect(existsSync(releaseWorkflowPath), '.github/workflows/release.yml 缺失').toBe(true)
  })

  it('推 v* 标签触发 + workflow_dispatch 补跑入口（tag 输入）', () => {
    const text = readFileSync(releaseWorkflowPath, 'utf8')
    expect(text).toMatch(/push:\s*\n\s*tags:\s*\[\s*'v\*'\s*\]/)
    expect(text).toMatch(/workflow_dispatch:/)
    expect(text).toMatch(/inputs:\s*\n\s*tag:/)
  })

  it('双 job：release（tag 推送）与 marketplace（从 Release 取同一份 VSIX 发布）', () => {
    const text = readFileSync(releaseWorkflowPath, 'utf8')
    expect(text).toMatch(/\n  release:\s*\n/)
    expect(text).toMatch(/\n  marketplace:\s*\n/)
    expect(text).toMatch(/needs:\s*release/)
    // marketplace 从 Release 下载同一份 VSIX——release 与市场发布同一字节
    expect(text).toMatch(/gh release download/)
    expect(text).toMatch(/vsce publish --no-dependencies --packagePath \.\/\*\.vsix/)
  })

  it('release job：完整历史与标签检出（tag 精确命中校验依赖）', () => {
    const text = readFileSync(releaseWorkflowPath, 'utf8')
    expect(text).toMatch(/fetch-depth:\s*0/)
    expect(text).toMatch(/fetch-tags:\s*true/)
    // 创建 Release 需要 contents: write 权限与 GH_TOKEN
    expect(text).toMatch(/contents:\s*write/)
    expect(text).toMatch(/GH_TOKEN:\s*\$\{\{ github\.token \}\}/)
    expect(text).toContain('npm run release')
  })

  it('release job 发布前复验：vendor 快照防漂移（源仓获取同 CI 方式）', () => {
    const text = readFileSync(releaseWorkflowPath, 'utf8')
    expect(text).toMatch(/git clone --filter=blob:none .*ONEGAYI\/vsidian\.git/)
    expect(text).toContain('npm run vendor:check')
    expect(text).toContain('VSIDIAN_SOURCE_REPO:')
  })

  it('Marketplace 双开关代码化：MARKETPLACE_PUBLISH 变量与 VSCE_PAT 密钥都配置才执行', () => {
    const text = readFileSync(releaseWorkflowPath, 'utf8')
    expect(text).toMatch(/vars\.MARKETPLACE_PUBLISH == 'true'/)
    expect(text).toMatch(/secrets\.VSCE_PAT != ''/)
    expect(text).toMatch(/VSCE_PAT:\s*\$\{\{ secrets\.VSCE_PAT \}\}/)
  })

  it('dispatch 补跑豁免：!cancelled() 绕过上游 release job 的 skipped', () => {
    const text = readFileSync(releaseWorkflowPath, 'utf8')
    expect(text).toMatch(/!cancelled\(\)/)
    // release job 只在真实 tag 推送时执行，dispatch 只跑 marketplace
    expect(text).toMatch(/if:\s*github\.event_name == 'push'/)
  })
})
