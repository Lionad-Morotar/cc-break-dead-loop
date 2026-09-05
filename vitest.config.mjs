import { defineConfig } from 'vitest/config';

/**
 * vitest 配置
 * 统一测试入口，迁移自 node:test
 *
 * testTimeout 20s：套件以子进程 spawn 为主要测试手段（hook 协议、保活、CLI），
 * 单用例最多串行 6+ 次 node 冷启动；默认 5s 在全量并行负载下不够，
 * 曾致计数器用例如期超时（真实耗时受机器负载支配，非行为回归）
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    testTimeout: 20_000,
  },
});
