---
status: accepted
---

# 测试框架从 node:test 迁移到 vitest

## Context

watcher 子系统测试需要 fake timers（`setInterval` 扫描循环）+ 模块 mock（`node:fs` / `node:child_process` 的 spawn），Node.js 内置 `node:test` 无内置支持，手写 fake 复杂且脆弱。

## Decision

全量迁移到 **vitest ^4.1.8**（devDependency），引入 `vitest.config.mjs` 与 `pnpm-lock.yaml`。断言库仍用 `node:assert`（仅迁移测试运行器）。

## Why

vitest 提供 `vi.useFakeTimers` / `vi.mock` / `vi.fn`，原生支撑 watcher 子系统的 TDD。运行时仍零依赖（vitest 仅 devDependency，不进入插件运行时）。

## Considered Options

- **保持 node:test + 手写 fake timers/mock**：复杂、脆弱、重复造轮
- **迁移 vitest**：采用

## Consequences

- 运行时零依赖原则保留（vitest 不入 `files`，仅开发）
- 后续新增需 mock 的测试（进程、定时器、fs）直接用 `vi.*`，无需自建 mock 基础设施
