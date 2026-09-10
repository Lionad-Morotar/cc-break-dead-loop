# Codebase Structure

**分析日期:** 2026-06-14

## 目录布局

```
cc-break-dead-loop/
├── src/                           # 核心源码（13 个 ES Module 文件）
│   ├── index.mjs                  # Hook 入口（stdin/stdout 协议、handler 分发、Stop 阻断）
│   ├── config.mjs                 # 阈值、数据目录、watcher 参数常量
│   ├── handlers.mjs               # PostToolUse:Read + PreToolUse:Read 双 Handler（主 agent Read 死循环）
│   ├── state.mjs                  # 状态管理（原子写入、计数器逻辑）
│   ├── utils.mjs                  # 路径安全化 + Git 仓库名解析
│   ├── watcher.mjs                # watcher 核心：扫 transcript → 检测死循环 → 同步告警
│   ├── watcherLifecycle.mjs       # watcher 进程生命周期（decideAction / ensureWatcherRunning）
│   ├── alertStore.mjs             # 告警共享状态（watcher 写、hooks 读，原子写入）
│   ├── deadLoopDetector.mjs       # 死循环检测算法（尾部连续重复判定 + 稳定序列化指纹）
│   ├── hookInjector.mjs           # Hook 注入逻辑（读告警 → additionalContext / blockingError）
│   ├── subagentTranscriptReader.mjs # subagent jsonl 解析（tool_use 序列 + 尾块时间戳读取）
│   ├── notifier.mjs               # 桌面通知（活跃死循环提醒 + watcher 复活通知）
│   └── sessionStartAdvice.mjs     # SessionStart 注入文案（引导后台子代理）
├── .claude-plugin/                # 插件元数据（必须在仓库根，CC 只从根读取）
│   └── plugin.json
├── hooks/
│   └── hooks.json                 # Hook 注册（Setup、SessionStart、PostToolUse[Read+*]、PreToolUse[Read]、Stop）
├── scripts/
│   ├── node-runner.mjs            # Node.js runner（stdin 收集、透传 JSON、Stop exit 2、graceful fallback）
│   ├── setup-check.mjs            # Setup 钩子：环境检测 + 启动/保活 watcher 常驻进程
│   └── watcher.mjs                # watcher 常驻进程入口（detached spawn）
├── tests/                         # 测试套件（12 文件，136 用例）
│   ├── state.test.mjs             # 状态管理单元测试
│   ├── handlers.test.mjs          # Handler 逻辑单元测试
│   ├── integration.test.mjs       # 端到端集成测试（stdin/stdout 协议，env 隔离）
│   ├── watcher.test.mjs           # watcher 扫描/告警同步（fake timers + fs mock）
│   ├── watcherLifecycle.test.mjs  # 进程决策与 spawn（mock child_process）
│   ├── watcherKeepalive.test.mjs  # 保活接线集成（真实 spawn + PATH shim 通知断言）
│   ├── alertStore.test.mjs        # 告警读写与并发
│   ├── deadLoopDetector.test.mjs  # 检测算法（尾部连续重复、稳定序列化）
│   ├── hookInjector.test.mjs      # 注入措辞与最严重告警选取
│   ├── notifier.test.mjs          # 桌面通知平台分发（依赖注入）
│   ├── sessionStartAdvice.test.mjs # SessionStart 注入文案
│   └── subagentTranscriptReader.test.mjs # jsonl 解析容错 + 尾块时间戳读取
├── packages/
│   └── claude-plugins/            # git submodule：中心插件集市仓库（Lionad-Morotar/claude-plugins）
├── docs/                          # 深度文档（Project / Architecture / Workflow / DeepDive）
├── .planning/codebase/            # 本目录：codebase mapping 文档（7 份）
├── vitest.config.mjs              # Vitest 配置（include tests/**/*.test.mjs）
├── pnpm-lock.yaml                 # pnpm lockfile
├── package.json                   # 项目配置（type: module, engines: node>=18, vitest devDep）
├── .gitignore
├── README.md                      # 安装指南和使用说明
├── Agents.md                      # 代理指令入口（Claude.md 为其符号链接）
└── TODOS.md                       # 未来改进事项
```

## 目录用途

**`src/`:**
- Purpose: 核心业务逻辑源码
- Contains: 13 个 ES Module 文件，纯 JavaScript，零运行时依赖
- Key files: `index.mjs`（入口分发）、`handlers.mjs`（主 agent 检测）、`watcher.mjs`（子 agent 检测核心）
- 架构分两条检测线：
  - **主 agent Read 死循环**：`handlers.mjs` + `state.mjs`（双 Hook：PostToolUse:Read 计数 + PreToolUse:Read 阻断）
  - **子 agent 死循环**：`watcher.mjs` 扫 transcript → `deadLoopDetector.mjs` 判定 → `alertStore.mjs` 写告警 → `hookInjector.mjs` 经 Stop/PostToolUse:`*` Hook 注入

**`scripts/`:**
- Purpose: Hook 执行入口 + watcher 进程入口
- Key files: `node-runner.mjs`（Hook 运行时）、`setup-check.mjs`（环境检测 + watcher 保活）、`watcher.mjs`（detached 常驻进程）

**`tests/`:**
- Purpose: 测试套件
- Contains: 12 个测试文件，使用 Vitest
- Key files: `integration.test.mjs`（stdin/stdout 协议）、`watcher.test.mjs`（fake timers）、`watcherLifecycle.test.mjs`（spawn mock）

**`packages/claude-plugins/`:**
- Purpose: 中心插件集市仓库（git submodule，ssh 远端），本插件的 marketplace 条目（`.claude-plugin/marketplace.json` 的 version/ref/description）在此维护
- Committed: Yes（gitlink 指针；未设 `ignore = all`，子仓提交后须在主仓 bump 指针，推送顺序见 Plugin Registration DeepDive）

**`docs/`:**
- Purpose: 项目深度文档（Project / Architecture / Workflow / DeepDive）+ 历史需求/计划
- Contains: `1. Project Overview.md`、`2. Architecture Overview.md`、`3. Workflow Overview.md`、`4.DeepDive/`、`brainstorms/`、`plans/`、`agents/`

**`.planning/codebase/`:**
- Purpose: 本项目的 codebase mapping 文档（STACK / STRUCTURE / ARCHITECTURE / CONVENTIONS / TESTING / INTEGRATIONS / CONCERNS）

## 关键文件位置

**入口点:**
- `src/index.mjs`: Hook 逻辑入口，导出 `main(event, stdinData)`，分发 5 个事件（post-tool-use / pre-tool-use-read / post-tool-use-any / stop / session-start），支持直接运行
- `scripts/node-runner.mjs`: Hook 运行时入口，被 `hooks.json` 调用，处理 Stop 的 `shouldBlock` → `exit(2)`
- `scripts/setup-check.mjs`: Setup Hook 入口（仅 `--init`/`--init-only`/`--maintenance` 特殊触发），环境检测 + `ensureWatcherRunning` 保活
- `scripts/watcher.mjs`: watcher 常驻进程入口，由 hook 保活接线 detached spawn

**配置:**
- `src/config.mjs`: 阈值（WARN=3 / BLOCK=5）、数据目录、watcher 参数（WINDOW=20 / THRESHOLD=5 / SCAN=5000ms / STALE=30000ms）
- `package.json`: 项目元数据、`scripts.test = "vitest run"`、`vitest` devDep
- `.claude-plugin/plugin.json`: 插件元数据
- `hooks/hooks.json`: Hook 注册（record 格式，6 个 hook entry）
- `vitest.config.mjs`: Vitest 配置

**核心逻辑:**
- 主 agent 线：`src/handlers.mjs`（PostToolUse 检测 + PreToolUse 阻断）、`src/state.mjs`（计数器）
- 子 agent 线：`src/watcher.mjs`（扫描协调）、`deadLoopDetector.mjs`（算法）、`alertStore.mjs`（告警）、`hookInjector.mjs`（注入）、`subagentTranscriptReader.mjs`（jsonl 解析）、`watcherLifecycle.mjs`（进程管理）
- 共享：`src/utils.mjs`（sanitizeName、getProjectName）
- 补充缓解：`src/notifier.mjs`（活跃死循环桌面通知）、`src/sessionStartAdvice.mjs`（SessionStart 注入引导后台子代理）

**测试:**
- `tests/state.test.mjs`、`tests/handlers.test.mjs`、`tests/integration.test.mjs`
- `tests/watcher.test.mjs`、`tests/watcherLifecycle.test.mjs`、`tests/watcherKeepalive.test.mjs`
- `tests/alertStore.test.mjs`、`tests/deadLoopDetector.test.mjs`、`tests/hookInjector.test.mjs`
- `tests/notifier.test.mjs`、`tests/sessionStartAdvice.test.mjs`、`tests/subagentTranscriptReader.test.mjs`

## 命名约定

**文件:**
- 源码文件: `*.mjs`（ES Module）
- 测试文件: `*.test.mjs`（与源码一一对应）
- 配置文件: `*.json` / `*.config.mjs`
- 文档文件: `YYYY-MM-DD-*.md`（plans / brainstorms 目录）

**目录:**
- `src/`（扁平，13 文件，无子目录）
- `.claude-plugin/`、`hooks/`、`scripts/`（插件运行时，必须位于仓库根）
- `tests/`（扁平）
- `docs/`（按类型分类）

**函数:**
- camelCase（`main`、`postToolUse`、`preToolUseRead`、`createWatcher`、`ensureWatcherRunning`、`detectDeadLoop`、`buildInjection`、`addAlert`、`readRecentToolCalls`）

**常量:**
- UPPER_SNAKE_CASE（`WARN_THRESHOLD`、`BLOCK_THRESHOLD`、`DATA_DIR`、`ALERTS_FILE`、`HEARTBEAT_FILE`、`PID_FILE`、`WATCHER_WINDOW_SIZE` 等）

## 新增代码位置

**新 Handler / Hook 事件:**
- Handler: `src/handlers.mjs` 或 `src/index.mjs`（注入类）
- 入口分发: `src/index.mjs`（`main()` switch 添加 case）
- Hook 注册: `hooks/hooks.json`
- Runner: `scripts/node-runner.mjs`（如需新 event 参数）
- Tests: `tests/handlers.test.mjs` + `tests/integration.test.mjs`

**新 watcher 检测能力:**
- 算法: `src/deadLoopDetector.mjs`
- 扫描协调: `src/watcher.mjs`
- Tests: `tests/deadLoopDetector.test.mjs`、`tests/watcher.test.mjs`

**新状态/告警存储:**
- 实现: `src/state.mjs` 或 `src/alertStore.mjs`
- Tests: 对应 `tests/*.test.mjs`

**新配置常量:**
- `src/config.mjs`，消费处相应模块

## 特殊目录

**`.claude-plugin/`、`hooks/`、`scripts/`（插件运行时）:**
- Purpose: Claude Code 插件安装包内容
- Generated: No
- Committed: Yes（插件分发核心）
- Note: Claude Code 只从仓库根读取 `.claude-plugin/plugin.json` 与 `hooks/hooks.json`，埋在子目录会导致插件以「已启用但零 hook 生效」的静默方式失效（`claude plugin details` 显示 `Version: unknown` / `Hooks (0)`）。`hooks.json` 用 `${CLAUDE_PLUGIN_ROOT}` 解析根目录

**`~/.data/cc-break-dead-loop/`（运行时生成）:**
- Purpose: 插件运行时状态/告警/进程数据
- Generated: Yes（首次写入时创建）
- Committed: No（`.gitignore` 排除）
- Structure:
  - `<project>/<session>/<agent>/state.json`（主 agent Read 计数）
  - `alerts.json`（子 agent 死循环告警，watcher 写 / hooks 读）
  - `watcher-heartbeat.json`（watcher 心跳，lifecycle 据此判断存活）
  - `watcher.pid`（watcher PID，重启时 kill 旧进程）

**`~/.claude/projects/`（Claude Code 生成，watcher 只读）:**
- Purpose: subagent transcript 存储
- Structure: `<project>/<session>/subagents/agent-<id>.jsonl`
- watcher 通过 `findAllAgentJsonls` 递归扫描所有 `agent-*.jsonl`

**`.planning/codebase/`:**
- Purpose: codebase mapping 文档
- Committed: Yes

---

*Structure analysis: 2026-06-14*
