# Technology Stack

**分析日期:** 2026-06-14

## 语言

**主语言：**
- JavaScript (ES2022+) — 全部源码与测试文件使用 `.mjs` 扩展名，显式启用 ES Module

**次要：**
- JSON — 插件配置（`plugin.json`、`hooks.json`）与状态/告警/心跳持久化格式
- JSONL — subagent transcript（`~/.claude/projects/<proj>/<session>/subagents/agent-<id>.jsonl`），watcher 扫描输入
- Bash — 插件 `hooks.json` 的 `command` 字段用 bash 展开 `${CLAUDE_PLUGIN_ROOT}`

## 运行时

**环境：**
- Node.js >= 18.0.0（`package.json` `engines` 字段强制要求）
- 开发/测试环境实测：Node.js v22.22.1

**包管理器:**
- pnpm（仓库内含 `pnpm-lock.yaml`）

## 框架

**核心：**
- 无运行时框架 — 纯 Node.js 内置模块实现，零运行时依赖

**测试：**
- Vitest ^4.1.8（devDependency）— 从 `node:test` 迁移而来，用于 watcher 的 fake timers（`vi.useFakeTimers`）、fs mock（`vi.mock('node:fs')`）、`child_process.spawn` mock

**构建/开发：**
- 无构建步骤 — 源码直接由 Node.js 运行，无需转译或打包

## 关键依赖

**运行时：**
- 零运行时依赖 — 仅使用 Node.js 内置模块

**开发依赖：**

| 包 | 用途 |
|------|------|
| `vitest` ^4.1.8 | 测试框架（fake timers、模块 mock、watch 模式）|

**内置模块使用清单：**

| 模块 | 用途 | 使用文件 |
|------|------|----------|
| `node:fs` | 状态/告警/心跳文件读写、目录创建、transcript 读取 | `plugin/src/state.mjs`、`alertStore.mjs`、`watcher.mjs`、`watcherLifecycle.mjs`、`subagentTranscriptReader.mjs` |
| `node:path` | 路径拼接、目录名/基名提取 | 多个模块（state、utils、watcher、watcherLifecycle、alertStore、setup-check）|
| `node:child_process` | Git 仓库名解析（`spawnSync`）、watcher 进程 spawn（`spawn` detached）、子进程集成测试 | `plugin/src/utils.mjs`、`watcherLifecycle.mjs`、`tests/integration.test.mjs` |
| `node:os` | 临时目录获取（测试用） | `tests/*.test.mjs` |
| `node:url` | `fileURLToPath` 转换（解析 `__dirname`） | `plugin/scripts/setup-check.mjs`、`tests/integration.test.mjs` |

## 配置

**环境变量：**
- `HOME` / `USERPROFILE` — 状态数据根目录定位（`plugin/src/config.mjs`）
- `CLAUDE_CONFIG_DIR` — Claude Code 配置目录（默认 `~/.claude`），watcher 据此定位 `projects/` 子目录
- `CC_BREAK_DATA_DIR` — 覆盖状态/告警数据根目录（默认 `~/.data/cc-break-dead-loop`）
- `CC_BREAK_PROJECTS_DIR` — 覆盖 subagent transcript 根目录（默认 `$CLAUDE_CONFIG_DIR/projects`）
- `CLAUDE_PLUGIN_ROOT` — Claude Code 注入的插件根目录，`hooks.json` 命令据此定位脚本

**构建：**
- 无构建配置（无 `tsconfig.json`、无 bundler、无转译器）
- 测试配置：`vitest.config.mjs`（`include: ['tests/**/*.test.mjs']`）

**插件元数据：**
- `plugin/.claude-plugin/plugin.json` — 插件元数据（名称、版本、描述）
- `plugin/hooks/hooks.json` — Hook 注册（Setup、PostToolUse[Read+`*`]、PreToolUse[Read]、Stop），record 格式按事件名分组

## 平台要求

**开发：**
- Node.js >= 18（ES Module + watcher detached 进程模型必需）
- Git（可选，用于 `getProjectName` 解析仓库名）

**生产：**
- Claude Code 插件目录：`~/.claude/plugins/marketplaces/<owner>/plugin/`
- 状态/告警/心跳数据目录：`~/.data/cc-break-dead-loop/`（`state.json`、`alerts.json`、`watcher-heartbeat.json`、`watcher.pid`）
- subagent transcripts：`~/.claude/projects/`（watcher 扫描输入，自动生成）

---

*Stack analysis: 2026-06-14*
