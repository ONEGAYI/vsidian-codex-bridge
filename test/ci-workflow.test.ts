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
