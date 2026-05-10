# Architecture

**Analysis Date:** 2026-05-11

## Pattern Overview

**Overall:** Observer-style Hook Plugin with Dual-Phase Detection

**Key Characteristics:**
- Claude Code 插件，通过 Hook 机制拦截 Read 工具调用
- 双 Hook 协作：PostToolUse 检测 + PreToolUse:Read 拦截
- 零外部依赖，纯 Node.js 内置模块
- 无构建步骤，ES Module 直接运行
- 多重错误边界确保插件 bug 永不阻断正常 Read 操作

## Layers

**Plugin Registration Layer:**
- Purpose: 向 Claude Code 注册 Hook，定义触发条件和执行命令
- Location: `plugin/hooks/hooks.json`
- Contains: Hook 配置（Setup、PostToolUse、PreToolUse）
- Depends on: `plugin/scripts/*.mjs`
- Used by: Claude Code 运行时

**Runner Layer:**
- Purpose: 收集 stdin，调用核心逻辑，透传 JSON 响应，graceful fallback
- Location: `plugin/scripts/node-runner.mjs`
- Contains: stdin 收集（含 5s 超时）、main() 调用、直接透传返回 JSON、异常降级处理
- Depends on: `../src`（即 `plugin/src/index.mjs`）
- Used by: `plugin/hooks/hooks.json` 通过 bash 命令调用

**Entry Layer:**
- Purpose: stdin/stdout 协议处理、handler 分发、统一错误边界
- Location: `plugin/src/index.mjs`
- Contains: `main(event, stdinData)` 函数、CLI 入口、JSON 解析、event 分发
- Depends on: `plugin/src/handlers.mjs`
- Used by: `plugin/scripts/node-runner.mjs` 和直接 CLI 调用

**Handler Layer:**
- Purpose: 实现 PostToolUse 检测和 PreToolUse:Read 拦截的业务逻辑
- Location: `plugin/src/handlers.mjs`
- Contains: `postToolUse(input)`、`preToolUseRead(input)`、参数提取、阈值判断
- Depends on: `plugin/src/state.mjs`、`plugin/src/config.mjs`
- Used by: `plugin/src/index.mjs`

**State Management Layer:**
- Purpose: 检测状态的持久化读写、原子写入、计数器逻辑
- Location: `plugin/src/state.mjs`
- Contains: `getStateDir()`、`readState()`、`writeState()`、`incrementCounter()`、`isSameReadParams()`
- Depends on: `plugin/src/config.mjs`、`plugin/src/utils.mjs`
- Used by: `plugin/src/handlers.mjs`

**Utility Layer:**
- Purpose: 路径安全化和 Git 仓库名解析
- Location: `plugin/src/utils.mjs`
- Contains: `sanitizeName()`、`getProjectName()`
- Depends on: Node.js 内置模块（`child_process`、`path`）
- Used by: `plugin/src/state.mjs`

**Configuration Layer:**
- Purpose: 定义阈值常量和数据目录路径
- Location: `plugin/src/config.mjs`
- Contains: `WARN_THRESHOLD`、`BLOCK_THRESHOLD`、`DATA_DIR`
- Depends on: 无
- Used by: `plugin/src/handlers.mjs`、`plugin/src/state.mjs`

## Data Flow

**Setup Flow（插件加载时）:**

1. Claude Code 加载插件，执行 `Setup` Hook
2. `plugin/hooks/hooks.json` 触发 bash 命令，解析插件根目录
3. 运行 `plugin/scripts/setup-check.mjs`
4. 检测 Node.js >= 18 和 Git 可用性
5. 输出检测结果到 stdout/stderr，exit(0) 永不阻断启动

**Detection Flow（运行时）:**

1. Claude Code 执行 Read 工具，返回结果
2. `PostToolUse` Hook 触发（matcher: Read）
3. `plugin/scripts/node-runner.mjs` 收集 stdin 中的 HookInput JSON
4. 调用 `plugin/src/index.mjs` 的 `main('post-tool-use', stdinData)`
5. `main()` 解析 JSON，分发到 `postToolUse(input)`
6. `postToolUse()` 检测 `tool_response` 是否包含 wasted call 标记（多模式：字符串 "Wasted call" / `{ type: "file_unchanged" }` 对象 / JSON.stringify 兜底）
7. 若命中 wasted call，提取 `file_path`/`offset`/`limit`，调用 `incrementCounter()`
8. `incrementCounter()` 读取 `state.json`，比较参数（`===` 直接比较，不规范化 undefined→0）
9. 参数相同则递增计数器，不同则重置为 1
10. 原子写入 `state.json`（writeFile tmp → rename）
11. 返回 `{ continue: true, suppressOutput: true }`

**Interception Flow（Read 执行前）:**

1. Claude Code 准备执行 Read 工具
2. `PreToolUse` Hook 触发（matcher: Read）
3. `plugin/scripts/node-runner.mjs` 收集 stdin
4. 调用 `main('pre-tool-use-read', stdinData)`
5. `main()` 分发到 `preToolUseRead(input)`
6. `preToolUseRead()` 提取 Read 参数，读取当前状态
7. 若状态不存在或参数不匹配 → 放行 `{ continue: true, suppressOutput: true }`
8. 若 `consecutiveWastedReads >= BLOCK_THRESHOLD(5)` → 返回官方 Anthropic hook 阻断格式：
   ```javascript
   {
     continue: false,
     hookSpecificOutput: {
       hookEventName: 'PreToolUse',
       permissionDecision: 'deny',
       permissionDecisionReason: reason,
       additionalContext: reason  // 双重保险：deny 对主 agent 生效，additionalContext 对 subagent/teammate 引导
     }
   }
   ```
9. `node-runner.mjs` 直接透传 main() 返回的 JSON 到 stdout（不再处理 shouldBlock/exit(2)）
10. 若 `consecutiveWastedReads >= WARN_THRESHOLD(3)` → 返回 `{ continue: true, hookSpecificOutput: { additionalContext, permissionDecision: 'allow' } }`
11. 否则 → 放行

**State Management Flow:**

```
~/.data/cc-break-dead-loop/
  └─ <safe-project-name>/       # getProjectName(cwd) + sanitizeName
      └─ <session-id>/          # sanitizeName(session_id)
          └─ <agent-name>/      # sanitizeName(agent_id || 'main')
              └─ state.json     # DetectionState
```

**State Management:**
- 状态按 `project + session + agent` 三维隔离
- 状态文件为单个 JSON，包含 `sessionId`, `filePath`, `offset`, `limit`, `consecutiveWastedReads`, `lastUpdatedAt`
- 原子写入：先写 `.tmp.<timestamp>` 文件，再 `renameSync` 到目标路径
- 无自动清理策略，依赖用户手动删除

## Key Abstractions

**HookInput:**
- Purpose: Claude Code 通过 stdin 注入的 Hook 事件数据
- Fields: `tool_name`, `tool_input`, `tool_response`, `agent_id`, `agent_type`, `session_id`, `cwd`
- 来源: Claude Code Hook 协议

**DetectionState:**
- Purpose: 持久化的检测状态
- Fields: `sessionId`, `filePath`, `offset`, `limit`, `consecutiveWastedReads`, `lastUpdatedAt`
- 存储: `~/.data/cc-break-dead-loop/<project>/<session>/<agent>/state.json`

**HookResult:**
- Purpose: Handler 返回给 Claude Code 的处理结果
- 普通放行: `{ continue: true, suppressOutput: true }`
- 警告注入: `{ continue: true, suppressOutput: false, hookSpecificOutput: { hookEventName, additionalContext, permissionDecision: 'allow' } }`
- 阻断: `{ continue: false, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason, additionalContext } }`（官方 Anthropic hook 格式，deny 对主 agent 生效，additionalContext 对所有 agent 类型引导）

## Entry Points

**Plugin Entry (Claude Code Hook):**
- Location: `plugin/hooks/hooks.json`
- Triggers: Claude Code 生命周期事件（Setup、PostToolUse、PreToolUse）
- Responsibilities: 注册 Hook 匹配器和执行命令

**CLI Entry (Direct Execution):**
- Location: `plugin/src/index.mjs`（`import.meta.url === file://${process.argv[1]}` 分支）
- Triggers: `node plugin/src/index.mjs <event>` 命令行调用
- Responsibilities: 从 process.stdin 读取数据，调用 main()，输出 JSON 到 stdout

**Runner Entry (Hook Script):**
- Location: `plugin/scripts/node-runner.mjs`
- Triggers: Claude Code 通过 hooks.json 的 bash 命令调用
- Responsibilities: 收集 stdin（5s 超时保护），调用 main()，直接透传返回 JSON 和异常降级

**Setup Entry:**
- Location: `plugin/scripts/setup-check.mjs`
- Triggers: Claude Code Setup Hook
- Responsibilities: 检测 Node.js >= 18 和 Git 可用性，输出环境状态

## Error Handling

**Strategy:** 防御性编程 + 多层降级，确保插件 bug 永不阻断正常 Read

**Patterns:**
- **D3 (Runner Graceful Fallback):** `plugin/scripts/node-runner.mjs` 中任何异常都输出 `{ continue: true, suppressOutput: true }` 并 exit(0)
- **D5 (Handler Error Boundary):** `plugin/src/index.mjs` 中 try/catch 包裹整个 handler 调用，任何错误都返回 `{ continue: true }`
- **Silent Failures:** 状态文件读取失败返回 `null`；JSON 解析失败返回默认对象；Git 命令失败静默 fallback 到文件夹名
- **Setup Never Blocks:** `setup-check.mjs` 无论检测结果如何都 exit(0)

## Cross-Cutting Concerns

**Logging:** 仅使用 `console.log`/`console.error` 输出到 stdout/stderr，无专用日志框架
- Setup 检测成功: `[cc-break-dead-loop] Setup: OK (Node.js x.y.z)`
- Setup 检测失败: stderr 输出具体错误
- 阻断时: stdout 输出官方 hook JSON（含 `permissionDecision: 'deny'`）

**Validation:** 无专用验证框架，使用运行时类型检查
- `typeof toolResponse === 'string'` / `typeof toolResponse === 'object'`（含 `{ type: "file_unchanged" }` 检测）
- `toolInput && typeof toolInput === 'object'`
- 空值和缺失字段的防御性检查

**Authentication:** 不适用 — 纯本地插件，无外部认证

---

*Architecture analysis: 2026-05-11*
