# External Integrations

**Analysis Date:** 2026-05-10

## APIs & External Services

**Claude Code Plugin API：**
- Claude Code Hook 系统 — 插件通过 stdin/stdout JSON 协议与 Claude Code 主进程通信
  - 协议格式：Claude Code 向插件 stdin 注入 JSON 数据，插件向 stdout 输出 JSON 响应
  - 响应格式：`{ continue: boolean, suppressOutput?: boolean, hookSpecificOutput?: Object, systemMessage?: string }`
  - 阻断信号：`shouldBlock: true` 时插件以 exit code 2 退出，stdout 输出 `{ systemMessage: "..." }`
  - SDK/Client：无（纯 stdin/stdout 协议，无 SDK 依赖）

**Git：**
- 本地 Git 命令 — 用于解析项目仓库名（`git remote get-url origin`）
  - 调用方式：`spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8', timeout: 5000 })`
  - 完全可选：Git 不可用时自动 fallback 到当前工作目录文件夹名
  - 使用文件：`src/utils.mjs`

## Data Storage

**Databases：**
- 无 — 不使用任何数据库

**File Storage：**
- 本地文件系统 — 状态数据以 JSON 文件形式持久化
  - 根目录：`~/.data/cc-break-dead-loop/`
  - 路径结构：`~/.data/cc-break-dead-loop/<safe-project-name>/<session-id>/<safe-agent-name>/state.json`
  - 写入策略：原子写入（`writeFile(tmp) → rename(tmp, dest)`）避免并发损坏
  - 使用文件：`src/state.mjs`

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
- 测试命令：`node --test tests/**/*.test.mjs`（`package.json` `scripts.test`）

**Distribution：**
- 当前：手动复制安装（见 `README.md`）
- 计划中：npm 全局安装（见 `TODOS.md` 第 2 项）

## Environment Configuration

**Required env vars：**
- `HOME` 或 `USERPROFILE` — 用于定位状态数据根目录（`~/.data/cc-break-dead-loop/`）
- `CLAUDE_PLUGIN_ROOT`（可选）— 开发时覆盖插件根目录路径

**Secrets location：**
- 无 secrets — 项目不涉及 API Key、Token 或其他敏感凭证

## Webhooks & Callbacks

**Incoming：**
- Claude Code Hook 调用（非 HTTP webhook，而是子进程 stdin/stdout 调用）
  - `Setup` Hook — 启动时检测 Node.js 版本
  - `PostToolUse` Hook — Read 工具调用后检测 wasted call
  - `PreToolUse` Hook — Read 工具调用前检查计数器并决定是否阻断

**Outgoing：**
- 无 — 插件不向外部服务发起任何 HTTP 请求或回调

---

*Integration audit: 2026-05-10*
