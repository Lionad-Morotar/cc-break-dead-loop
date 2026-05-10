# Codebase Structure

**Analysis Date:** 2026-05-11

## Directory Layout

```
cc-break-dead-loop/
├── src/                           # CLI 工具源码
│   └── cli/                       # CLI 命令（未迁移至 plugin/）
├── plugin/                        # Claude Code 插件
│   ├── src/                       # 核心源码（从根 src/ 迁移而来）
│   │   ├── index.mjs              # Hook 入口（stdin/stdout 协议、handler 分发、错误边界）
│   │   ├── config.mjs             # 阈值与数据目录配置常量
│   │   ├── handlers.mjs           # PostToolUse + PreToolUse:Read 双 Handler
│   │   ├── state.mjs              # 状态管理（原子写入、计数器逻辑）
│   │   └── utils.mjs              # 路径安全化 + Git 仓库名解析
│   ├── .claude-plugin/
│   │   └── plugin.json            # 插件元数据（name、version、description）
│   ├── hooks/
│   │   └── hooks.json             # Hook 注册配置（record 格式，按事件名分组）
│   └── scripts/
│       ├── node-runner.mjs        # Node.js runner（stdin 收集、透传 JSON、graceful fallback）
│       └── setup-check.mjs        # Setup 钩子环境检测脚本
├── tests/                         # 测试套件
│   ├── state.test.mjs             # 状态管理单元测试
│   ├── handlers.test.mjs          # Handler 逻辑单元测试
│   └── integration.test.mjs       # 端到端集成测试
├── docs/                          # 文档
│   ├── brainstorms/
│   │   └── 2026-05-10-break-dead-loop-read-detection-requirements.md
│   └── plans/
│       └── 2026-05-10-001-feat-read-dead-loop-detection-plan.md
├── package.json                   # 项目配置（type: module, engines: node>=18）
├── .gitignore                     # Git 忽略规则
├── README.md                      # 安装指南和使用说明
└── TODOS.md                       # 未来改进事项
```

## Directory Purposes

**`plugin/src/`:**
- Purpose: 核心业务逻辑源码（从根 `src/` 迁移而来）
- Contains: 5 个 ES Module 文件，纯 JavaScript，零外部依赖
- Key files: `plugin/src/index.mjs`（入口）、`plugin/src/handlers.mjs`（业务逻辑）、`plugin/src/state.mjs`（状态管理）

**`src/cli/`:**
- Purpose: CLI 工具源码（未迁移至 plugin/）
- Contains: CLI 命令实现

**`plugin/`:**
- Purpose: Claude Code 插件注册和脚本层
- Contains: 插件元数据、Hook 配置、运行脚本
- Key files: `plugin/hooks/hooks.json`（Hook 注册）、`plugin/scripts/node-runner.mjs`（运行时入口）
- 安装时整个 `plugin/` 目录复制到 `~/.claude/plugins/cc-break-dead-loop/`

**`tests/`:**
- Purpose: 测试套件
- Contains: 3 个测试文件，使用 Node.js 内置 `node:test` 框架
- Key files: `tests/state.test.mjs`、`tests/handlers.test.mjs`、`tests/integration.test.mjs`

**`docs/`:**
- Purpose: 项目文档（需求分析、技术计划）
- Contains: brainstorms 和 plans 子目录
- Key files: `docs/plans/2026-05-10-001-feat-read-dead-loop-detection-plan.md`

**`.planning/codebase/`:**
- Purpose: 本项目的 codebase mapping 文档
- Contains: ARCHITECTURE.md、STRUCTURE.md 等分析文档

## Key File Locations

**Entry Points:**
- `plugin/src/index.mjs`: 核心逻辑入口，导出 `main(event, stdinData)`，支持 CLI 直接运行
- `plugin/scripts/node-runner.mjs`: Hook 运行时入口，被 Claude Code 通过 hooks.json 调用
- `plugin/scripts/setup-check.mjs`: Setup Hook 入口，环境检测

**Configuration:**
- `plugin/src/config.mjs`: 阈值常量（WARN_THRESHOLD=3, BLOCK_THRESHOLD=5）和数据目录路径
- `package.json`: 项目元数据、scripts、engines 约束
- `plugin/.claude-plugin/plugin.json`: 插件元数据（Claude Code 识别用）
- `plugin/hooks/hooks.json`: Hook 注册配置（record 格式，按事件名分组，含 matcher、command）

**Core Logic:**
- `plugin/src/handlers.mjs`: PostToolUse 检测 + PreToolUse:Read 拦截逻辑
- `plugin/src/state.mjs`: 状态文件读写、计数器递增/重置、参数比较
- `plugin/src/utils.mjs`: sanitizeName、getProjectName 工具函数

**Testing:**
- `tests/state.test.mjs`: 状态管理测试（sanitizeName、getProjectName、read/writeState、incrementCounter、isSameReadParams、并发安全）
- `tests/handlers.test.mjs`: Handler 逻辑测试（isWastedCall 多模式检测、postToolUse、preToolUseRead 阈值判断）
- `tests/integration.test.mjs`: 集成测试（stdin/stdout 协议、子进程调用、exit code、graceful fallback）

## Naming Conventions

**Files:**
- 源码文件: `*.mjs`（ES Module，Node.js 直接运行）
- 测试文件: `*.test.mjs`（与源码对应，使用 `node:test`）
- 配置文件: `*.json`（plugin.json、hooks.json、package.json）
- 文档文件: `YYYY-MM-DD-*.md`（plans 和 brainstorms 目录中）

**Directories:**
- 源码目录: `plugin/src/`（扁平结构，无子目录）
- 插件目录: `plugin/`（包含 `.claude-plugin/`、`hooks/`、`scripts/` 子目录）
- 测试目录: `tests/`（扁平结构，与 `plugin/src/` 对应）
- 文档目录: `docs/brainstorms/`、`docs/plans/`（按类型分类）

**Functions:**
- 导出函数: camelCase（`main`、`postToolUse`、`preToolUseRead`、`incrementCounter`）
- 工具函数: camelCase（`sanitizeName`、`getProjectName`、`isSameReadParams`、`isWastedCall`）
- 私有函数（模块内）: camelCase（`extractReadParams`、`finish`、`handleError`）

**Constants:**
- 配置常量: UPPER_SNAKE_CASE（`WARN_THRESHOLD`、`BLOCK_THRESHOLD`、`DATA_DIR`）
- 模块级常量: UPPER_SNAKE_CASE（`STATE_FILE`）

## Where to Add New Code

**New Handler:**
- Primary code: `plugin/src/handlers.mjs`（添加新 handler 函数）
- 入口注册: `plugin/src/index.mjs`（在 `main()` 的 switch 中添加新 event case）
- Hook 注册: `plugin/hooks/hooks.json`（添加新 Hook 配置）
- Runner 适配: `plugin/scripts/node-runner.mjs`（如需新 event 名称）
- Tests: `tests/handlers.test.mjs`（单元测试）+ `tests/integration.test.mjs`（集成测试）

**New State Management Feature:**
- Implementation: `plugin/src/state.mjs`（添加新函数）
- Tests: `tests/state.test.mjs`

**New Utility Function:**
- Implementation: `plugin/src/utils.mjs`
- Tests: `tests/state.test.mjs`（当前 utils 测试与 state 测试在同一文件中）

**New Configuration Option:**
- Constants: `plugin/src/config.mjs`
- 消费处: 相应 handler 或 state 文件

**New Plugin Hook:**
- Hook config: `plugin/hooks/hooks.json`
- Handler: `plugin/src/handlers.mjs` 或新建 handler 文件
- 入口分发: `plugin/src/index.mjs`

## Special Directories

**`plugin/`:**
- Purpose: Claude Code 插件安装包内容
- Generated: No
- Committed: Yes（这是插件分发的核心内容）
- Note: 安装时复制到 `~/.claude/plugins/cc-break-dead-loop/`，hooks.json 中的 bash 命令使用 `CLAUDE_PLUGIN_ROOT` 环境变量或相对路径解析插件根目录

**`~/.data/cc-break-dead-loop/`（运行时生成）:**
- Purpose: 插件运行时状态数据存储
- Generated: Yes（由 `plugin/src/state.mjs` 在首次写入时创建）
- Committed: No（已在 `.gitignore` 中排除）
- Structure: `<safe-project-name>/<session-id>/<safe-agent-name>/state.json`

**`.planning/codebase/`:**
- Purpose: GSD 工作流的 codebase mapping 文档
- Generated: No（由 GSD 工具创建和维护）
- Committed: Yes

---

*Structure analysis: 2026-05-11*
