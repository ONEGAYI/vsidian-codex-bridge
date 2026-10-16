// vitest 冒烟配置：node 环境纯逻辑/结构契约测试（无宿主依赖）。
// 浏览器层基建不在脚手架票（#1）范围，随能力票按需扩展。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
