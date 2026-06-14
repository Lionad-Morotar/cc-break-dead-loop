import { defineConfig } from 'vitest/config';

/**
 * vitest 配置
 * 统一测试入口，迁移自 node:test
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
  },
});
