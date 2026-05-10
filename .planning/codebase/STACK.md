# Technology Stack

**Analysis Date:** 2026-05-11

## Languages

**Primary:**
- JavaScript (ES2022+) — 全部源码与测试文件使用 `.mjs` 扩展名，显式启用 ES Module

**Secondary:**
- JSON — 插件配置（`plugin.json`、`hooks.json`）与状态持久化格式
- Bash — 插件 `hooks.json` 中的 `command` 字段使用 bash 脚本定位插件根目录

## Runtime

**Environment:**
- Node.js >= 18.0.0（`package.json` `engines` 字段强制要求）
- 开发/测试环境实测：Node.js v22.22.1

**Package Manager:**
- 未指定（项目零外部依赖，无需 lockfile）
- Lockfile：无

## Frameworks

**Core：**
- 无框架 — 纯 Node.js 内置模块实现，零运行时依赖

**Testing：**
- `node:test`（Node.js 18+ 内置测试框架）
- `node:assert`（内置断言库）

**Build/Dev：**
- 无构建步骤 — 源码直接由 Node.js 运行，无需转译或打包

## Key Dependencies

**Critical：**
- 零外部依赖 — 项目仅使用 Node.js 内置模块

**Infrastructure（内置模块使用清单）：**
| 模块 | 用途 | 使用文件 |
|------|------|----------|
| `node:fs` | 状态文件读写、目录创建 | `plugin/src/state.mjs` |
| `node:path` | 路径拼接、目录名提取 | `plugin/src/state.mjs`、`plugin/src/utils.mjs` |
| `node:child_process` | Git 仓库名解析（`spawnSync`）、子进程集成测试 | `plugin/src/utils.mjs`、`tests/integration.test.mjs` |
| `node:os` | 临时目录获取（测试用） | `tests/state.test.mjs` |
| `node:url` | `fileURLToPath` 转换（测试用） | `tests/integration.test.mjs` |

## Configuration

**Environment：**
- `HOME` / `USERPROFILE` — 状态数据根目录定位（`plugin/src/config.mjs`）
- `CLAUDE_PLUGIN_ROOT` — 开发时覆盖插件根目录路径，避免复制到 `~/.claude/plugins/`（`plugin/hooks/hooks.json`）

**Build：**
- 无构建配置（无 `tsconfig.json`、无 bundler、无转译器）

**Plugin Metadata：**
- `plugin/.claude-plugin/plugin.json` — 插件元数据（名称、版本、描述）
- `plugin/hooks/hooks.json` — Hook 注册配置（Setup、PostToolUse、PreToolUse），record 格式按事件名分组

## Platform Requirements

**Development：**
- Node.js >= 18（`node:test` 和原生 ES Module 支持必需）
- Git（可选，用于 `getProjectName` 解析仓库名）

**Production：**
- Claude Code 插件目录：`~/.claude/plugins/cc-break-dead-loop/`
- 状态数据目录：`~/.data/cc-break-dead-loop/`（自动创建，不提交到仓库）

---

*Stack analysis: 2026-05-11*
