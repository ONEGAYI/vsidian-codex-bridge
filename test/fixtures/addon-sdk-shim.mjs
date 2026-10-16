// vsidian-addon-sdk 虚拟模块的测试侧 shim：esbuild 构建桥
// （tools/sdkBridge.mjs）在构建期注入真实 shim 并登记工厂；vitest 不走
// esbuild，模块解析经本文件兜底——defineAddonPage 仅收集工厂（装配契约
// 测试直驱 codexPageFactory 导出，不经登记表），currentSdk 返回 undefined
// （测试不消费模块作用域 SDK）。
export function defineAddonPage(addonId, factory) {
  const pages = (globalThis.__vsidianAddonPagesForTest ??= {})
  pages[addonId] = factory
}

export function currentSdk() {
  return undefined
}
