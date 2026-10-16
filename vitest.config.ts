// vitest 配置：node 环境纯逻辑/结构契约测试（无宿主依赖）；jsdom 环境
// 用例在文件头以 // @vitest-environment jsdom 声明（渲染器/加载器行为）。
// 浏览器层基建随能力票评估（票 #3 尽力项，见 ADR-0003）。
// vsidian-addon-sdk 是构建桥虚拟模块（esbuild 注入 shim）：vitest 不走
// esbuild，模块解析经 alias 指到测试侧 shim（test/fixtures/）。
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      'vsidian-addon-sdk': fileURLToPath(new URL('./test/fixtures/addon-sdk-shim.mjs', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
