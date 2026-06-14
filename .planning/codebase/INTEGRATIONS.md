# External Integrations

**Analysis Date:** 2026-05-11

## APIs & External Services

**Claude Code Plugin API：**
- Claude Code Hook 系统 — 插件通过 stdin/stdout JSON 协议与 Claude Code 主进程通信
  - 协议格式：Claude Code 向插件 stdin 注入 JSON 数据，插件向 stdout 输出 JSON 响应
  - 响应格式：`{ continue: boolean, suppressOutput?: boolean, hookSpecificOutput?: Object }`
  - 阻断信号：`{ continue: false, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason, additionalContext } }`（官方 Anthropic hook 格式）
  - SDK/Client：无（纯 stdin/stdout 协议，无 SDK 依赖）

**Git：**
- 本地 Git 命令 — 用于解析项目仓库名（`git remote get-url origin`）
  - 调用方式：`spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8', timeout: 5000 })`
  - 完全可选：Git 不可用时自动 fallback 到当前工作目录文件夹名
  - 使用文件：`plugin/src/utils.mjs`

## Data Storage

**Databases：**
- 无 — 不使用任何数据库

**File Storage：**
- 本地文件系统 — 状态/告警/进程数据以 JSON 文件形式持久化
  - 根目录：`~/.data/cc-break-dead-loop/`（可由 `CC_BREAK_DATA_DIR` 覆盖）
  - 主 agent 计数：`<safe-project-name>/<session-id>/<safe-agent-name>/state.json`（`plugin/src/state.mjs`）
  - 子 agent 告警：`alerts.json`（`{ version: 1, alerts: [...] }`，`plugin/src/alertStore.mjs`，watcher 写 / hooks 读）
  - watcher 心跳：`watcher-heartbeat.json`（`{ pid, ts }`，`plugin/src/watcher.mjs`）
  - watcher PID：`watcher.pid`（`plugin/src/watcherLifecycle.mjs`，重启时 kill 旧进程）
  - 写入策略：原子写入（`writeFile(tmp) → rename(tmp, dest)`）避免并发损坏
- subagent transcript（只读输入）：`~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`（Claude Code 生成，watcher 扫描）

**Caching：**
- 无 — 状态文件即为唯一持久化层，无额外缓存机制

## Authentication & Identity

**Auth Provider：**
- 无 — 插件不涉及任何身份验证或授权
- 状态隔离基于 `session_id` + `agent_id` + `cwd`（项目名），无需用户认证

## Monitoring & Observability

**Error Tracking：**
- 无 — 无外部错误追踪服务集成

**Logs：**
- `console.log` / `console.error` — 仅用于 Setup 检测和错误边界输出
- 所有生产代码中的 `console` 调用均带有 `eslint-disable-next-line no-console` 注释
- 无持久化日志文件

## CI/CD & Deployment

**Hosting：**
- 无 — 当前为手动安装（复制 `plugin/` 目录到 `~/.claude/plugins/`）

**CI Pipeline：**
- 无 — 未配置 GitHub Actions 或其他 CI 服务
- 测试命令：`npm test`（= `vitest run`，见 `package.json` `scripts.test` 与 `vitest.config.mjs`）

**Distribution：**
- 当前：手动复制安装（见 `README.md`）
- 计划中：npm 全局安装（见 `TODOS.md` 第 2 项）

## Environment Configuration

**环境变量：**
- `HOME` 或 `USERPROFILE` — 定位状态数据根目录（`~/.data/cc-break-dead-loop/`）
- `CLAUDE_CONFIG_DIR` — Claude Code 配置目录（默认 `~/.claude`），watcher 据此定位 `projects/` 子目录
- `CC_BREAK_DATA_DIR`（可选）— 覆盖状态/告警数据根目录（默认 `~/.data/cc-break-dead-loop`）
- `CC_BREAK_PROJECTS_DIR`（可选）— 覆盖 subagent transcript 根目录（默认 `$CLAUDE_CONFIG_DIR/projects`）
- `CLAUDE_PLUGIN_ROOT` — Claude Code 注入的插件根目录（`hooks.json` 命令展开 `${CLAUDE_PLUGIN_ROOT}`）

**Secrets location：**
- 无 secrets — 项目不涉及 API Key、Token 或其他敏感凭证

## Webhooks & Callbacks

**Incoming：**
- Claude Code Hook 调用（子进程 stdin/stdout 协议，非 HTTP webhook）
  - `Setup` Hook — 检测 Node.js 版本 + 启动/保活 watcher 常驻进程
  - `PostToolUse:Read` Hook — 主 agent Read 后检测 wasted call，计数（线 1）
  - `PostToolUse:*` Hook — 任意工具后注入子 agent 死循环告警（读 `alerts.json`，线 2）
  - `PreToolUse:Read` Hook — Read 前检查计数器，决定警告（count≥3）/阻断（count≥5）
  - `Stop` Hook — 主 agent 结束 turn 时，若有未处理子 agent 死循环告警，返回 blockingError（`exit 2`）强制继续 turn

**Outgoing：**
- 无 — 插件不向外部服务发起任何 HTTP 请求或回调

---

*Integration audit: 2026-05-11*
