# Architecture

**分析日期:** 2026-06-14

## 模式总览

**整体：** 双线死循环检测插件 —— Hook 拦截（主 agent Read 死循环）+ Watcher 扫描（子 agent 死循环）

**关键特征：**
- Claude Code 插件，通过 Hook 机制 + 常驻 watcher 进程双重检测
- 补充缓解：SessionStart 注入（引导后台子代理）+ watcher 桌面通知（活跃死循环提醒用户手动中断），针对前台同步子代理死循环的架构死结
- **线 1（主 agent）**：PostToolUse:Read 计数 + PreToolUse:Read 阻断（双 Hook 协作）
- **线 2（子 agent）**：watcher 扫 subagent transcript → 检测 → 写告警 → Stop/PostToolUse:`*` Hook 注入引导主 agent 调用 `TaskStopTool`
- 零运行时依赖，纯 Node.js 内置模块
- 无构建步骤，ES Module 直接运行
- 多重错误边界确保插件 bug 永不阻断正常 Read / 永不阻断 Claude Code 启动

## 分层

**插件注册层（Plugin Registration）:**
- Purpose: 向 Claude Code 注册 Hook，定义触发条件与执行命令
- Location: `plugin/hooks/hooks.json`
- Contains: 6 个 hook entry — Setup、SessionStart、PostToolUse[Read]、PostToolUse[`*`]、PreToolUse[Read]、Stop
- Used by: Claude Code 运行时

**Runner 层:**
- Purpose: 收集 stdin，调用核心逻辑，透传 JSON 响应，处理 Stop 阻断（exit 2 + stderr），graceful fallback
- Location: `plugin/scripts/node-runner.mjs`
- Depends on: `plugin/src/index.mjs`

**入口/分发层（Entry）:**
- Purpose: stdin/stdout 协议处理、4 事件分发、统一错误边界
- Location: `plugin/src/index.mjs`
- Contains: `main(event, stdinData)`、`postToolUseAnyAlert`、`stopAlert`、`sessionStartAdvice`、CLI 入口
- Depends on: `handlers.mjs`、`hookInjector.mjs`、`config.mjs`

**主 Agent Handler 层:**
- Purpose: 主 agent Read 死循环的检测与拦截
- Location: `plugin/src/handlers.mjs`
- Contains: `postToolUse`（计数）、`preToolUseRead`（警告/阻断）、`isWastedCall`（多模式检测）
- Depends on: `state.mjs`、`config.mjs`

**状态管理层（主 Agent）:**
- Purpose: 主 agent Read 计数持久化、原子写入、参数比较
- Location: `plugin/src/state.mjs`
- Depends on: `config.mjs`、`utils.mjs`

**Watcher 进程层:**
- Purpose: 常驻后台进程，定时扫描 subagent transcript，检测子 agent 死循环，同步告警
- Location: `plugin/scripts/watcher.mjs`（入口）+ `plugin/src/watcher.mjs`（核心 `createWatcher`）
- Contains: `findAllAgentJsonls`、`scanOnce`（全量重算 + 增量同步告警）、`start`/`stop`、心跳写入
- Depends on: `subagentTranscriptReader.mjs`、`deadLoopDetector.mjs`、`alertStore.mjs`、`config.mjs`

**Watcher 生命周期层:**
- Purpose: 决策 watcher 是否需要（重）启动，执行 detached spawn / kill 旧进程
- Location: `plugin/src/watcherLifecycle.mjs`
- Contains: `decideAction`（纯决策：读心跳判断新鲜度 → none/start/restart）、`ensureWatcherRunning`（执行层）、`killOldProcess`
- Depends on: `config.mjs`
- Used by: `plugin/scripts/setup-check.mjs`

**死循环检测算法层:**
- Purpose: 给定 tool_use 序列，判定尾部是否构成死循环
- Location: `plugin/src/deadLoopDetector.mjs`
- Contains: `detectDeadLoop`（尾部连续重复计数）、`stableStringify`（对象键排序序列化，生成参数指纹）
- Pure function，无副作用

**Transcript 解析层:**
- Purpose: 从 subagent jsonl 提取最近 N 个 tool_use
- Location: `plugin/src/subagentTranscriptReader.mjs`
- Contains: `readRecentToolCalls`（解析容错：跳过非 assistant 行、解析失败行、无 tool_use 行）

**告警存储层:**
- Purpose: 子 agent 死循环告警的共享状态（watcher 写 / hooks 读）
- Location: `plugin/src/alertStore.mjs`
- Contains: `addAlert`（upsert by taskId）、`removeAlert`、`getAlertsForSession`、原子写入
- 多 session 通过 `sessionId` 字段过滤隔离，单文件存储

**Hook 注入层:**
- Purpose: 读告警，生成 hook 响应（additionalContext / blockingError），纯语义不关心协议细节
- Location: `plugin/src/hookInjector.mjs`
- Contains: `buildInjection`、`postToolUseMessage`、`stopMessage`、`pickMostSevere`
- Depends on: `alertStore.mjs`
- Used by: `plugin/src/index.mjs`（post-tool-use-any / stop 事件）

**桌面通知层:**
- Purpose: 活跃死循环时发系统通知，提醒用户手动中断前台子代理（架构死结下够不到主 agent 就够用户）
- Location: `plugin/src/notifier.mjs`
- Contains: `notifyDeadLoop`（darwin osascript / linux notify-send，失败静默，依赖注入 exec/platform 便于测试）
- Used by: `plugin/src/watcher.mjs`

**SessionStart 注入层:**
- Purpose: 会话启动时注入子代理使用建议，引导主 agent 优先用后台子代理（预防性劝说）
- Location: `plugin/src/sessionStartAdvice.mjs`
- Contains: `buildSessionStartAdvice`
- Used by: `plugin/src/index.mjs`（session-start 事件）

**配置层:**
- Purpose: 阈值、数据目录、watcher 参数常量
- Location: `plugin/src/config.mjs`
- Exports: `WARN_THRESHOLD`(3)、`BLOCK_THRESHOLD`(5)、`DATA_DIR`、`CLAUDE_CONFIG_DIR`、`PROJECTS_DIR`、`ALERTS_FILE`、`HEARTBEAT_FILE`、`PID_FILE`、`WATCHER_WINDOW_SIZE`(20)、`WATCHER_THRESHOLD`(5)、`WATCHER_SCAN_INTERVAL_MS`(5000)、`WATCHER_STALE_TIMEOUT_MS`(30000)

**CLI 工具层:**
- Purpose: `npx cc-break-dead-loop` 命令（install / uninstall / status）
- Location: `src/cli/`

## 数据流

**Setup 流（插件加载时）:**

1. Claude Code 加载插件，执行 `Setup` Hook
2. `plugin/scripts/setup-check.mjs` 检测 Node.js >= 18
3. 调用 `ensureWatcherRunning`：读 `watcher-heartbeat.json` → `decideAction`
   - 心跳新鲜（`now - ts <= 30s`）→ `none`（不重启）
   - 心跳过期/缺失 → `start`/`restart`（`restart` 时按 `watcher.pid` kill 旧进程）
4. detached spawn `plugin/scripts/watcher.mjs`（`stdio: 'ignore'`，`unref`），写新 PID
5. 输出 Setup 结果，`exit(0)` 永不阻断启动

**Watcher 扫描流（常驻进程，每 5s）:**

1. `watcher.mjs` 启动时立即 `scanOnce`，随后 `setInterval(scanOnce, 5000)`
2. `findAllAgentJsonls(PROJECTS_DIR)` 递归收集所有 `agent-*.jsonl`
3. 对每个 jsonl：
   - `parseAgentFromPath` 解析 agentId / sessionId
   - `readRecentToolCalls(jsonl, 20)` 取最近 20 个 tool_use
   - `detectDeadLoop(calls, 5)` 判定尾部连续重复是否 ≥ 5
4. 全量重算 `currentDeadLoops`，与 `previousDeadLoopIds` 对比：
   - 消失的死循环 → `removeAlert`（子 agent 被 kill 后清理残留告警）
   - 持续/新增 → `addAlert`（upsert 更新 `detectedAt`）
5. 写心跳 `watcher-heartbeat.json`

**主 Agent Read 检测流（线 1，运行时）:**

1. Read 执行后触发 `PostToolUse:Read` → `node-runner post-tool-use` → `postToolUse()`
2. `isWastedCall` 多模式检测（字符串 "Wasted call" / `{ type: "file_unchanged" }` / JSON.stringify 兜底）
3. 命中则 `incrementCounter`（参数相同递增，不同重置为 1）
4. Read 执行前触发 `PreToolUse:Read` → `node-runner pre-tool-use-read` → `preToolUseRead()`
5. 读计数 → `count >= 5` 返回 `permissionDecision: 'deny'` + `additionalContext`（双重保险）→ `count >= 3` 返回警告

**子 Agent 死循环注入流（线 2，运行时）:**

1. 任意工具执行后触发 `PostToolUse:*` → `node-runner post-tool-use-any` → `postToolUseAnyAlert()`
2. `buildInjection({ filePath: ALERTS_FILE, sessionId, event: 'PostToolUse' })` 读告警 → 选最严重 → 返回 `additionalContext`（引导主 agent 调用 `TaskStopTool`）
3. 主 agent 结束 turn 触发 `Stop` → `node-runner stop` → `stopAlert()`
4. `buildInjection({ ..., event: 'Stop' })` 返回 `{ shouldBlock, blockingError }`
5. `node-runner` 检测 `shouldBlock` → `process.stderr.write(blockingError)` + `exit(2)` → Claude Code 视为 blockingError，强制主 agent 继续 turn 处理告警

**状态/告警存储结构:**

```
~/.data/cc-break-dead-loop/
  ├─ <project>/<session>/<agent>/state.json   # 主 agent Read 计数（线 1）
  ├─ alerts.json                              # 子 agent 死循环告警（线 2，watcher 写 / hooks 读）
  ├─ watcher-heartbeat.json                   # watcher 心跳（{pid, ts}）
  └─ watcher.pid                              # watcher PID（重启时 kill）
```

## 关键抽象

**HookInput:** Claude Code stdin 注入的事件数据
- Fields: `tool_name`、`tool_input`、`tool_response`、`agent_id`、`agent_type`、`session_id`、`cwd`

**DetectionState（线 1）:** 主 agent Read 计数
- Fields: `sessionId`、`filePath`、`offset`、`limit`、`consecutiveWastedReads`、`lastUpdatedAt`
- 存储: `~/.data/cc-break-dead-loop/<project>/<session>/<agent>/state.json`

**ToolCall（线 2）:** watcher 提取的工具调用
- Fields: `toolName`、`input`（原始参数对象）

**DeadLoop（线 2）:** 检测结果
- Fields: `toolName`、`paramFingerprint`（stableStringify 结果）、`repeatCount`

**Alert（线 2）:** 持久化告警
- Fields: `taskId`（= agentId）、`sessionId`、`toolName`、`paramFingerprint`、`repeatCount`、`detectedAt`
- 存储: `~/.data/cc-break-dead-loop/alerts.json`（`{ version: 1, alerts: [...] }`）

**WatcherHeartbeat:** watcher 存活证明
- Fields: `pid`、`ts`（`Date.now()`）
- 存储: `~/.data/cc-break-dead-loop/watcher-heartbeat.json`

## 入口点

**Plugin Hook Entry:**
- Location: `plugin/hooks/hooks.json`
- Triggers: Setup、PostToolUse[Read]、PostToolUse[`*`]、PreToolUse[Read]、Stop

**CLI Entry（直接执行）:**
- Location: `plugin/src/index.mjs`（`import.meta.url === file://...` 分支）
- 从 stdin 读取，调用 `main()`，Stop 阻断时 `exit(2)`

**Runner Entry（Hook 脚本）:**
- Location: `plugin/scripts/node-runner.mjs`
- 收集 stdin（5s 超时），调用 `main()`，处理 `shouldBlock` → `exit(2)`，异常降级

**Setup Entry:**
- Location: `plugin/scripts/setup-check.mjs`
- 检测 Node.js + 启动/保活 watcher，永不阻断（`exit(0)`）

**Watcher Process Entry:**
- Location: `plugin/scripts/watcher.mjs`
- detached spawn，立即扫描 + 定时扫描，`process.stdin.resume()` 保持存活，SIGTERM/SIGINT 优雅退出

## 错误处理

**策略：** 防御性编程 + 多层降级，确保插件 bug 永不阻断正常 Read / 永不阻断 Claude Code 启动

**Hook 链降级:**
- Runner graceful fallback：`node-runner.mjs` 任何异常 → `{ continue: true }` + `exit(0)`
- Handler 错误边界：`index.mjs` try/catch 包裹，错误 → `{ continue: true }`
- 静默失败：状态/告警读取失败返回 `null`/`[]`，JSON 解析失败返回默认，Git 命令失败 fallback 到文件夹名
- Setup 永不阻断：`setup-check.mjs` 无论结果 `exit(0)`

**Watcher 降级:**
- watcher 启动失败：`setup-check.mjs` catch 后仅 `console.error`，不阻断 Claude Code
- watcher 崩溃：心跳过期，下次 Setup 时 `decideAction` 返回 `restart`，自动拉起
- watcher 扫描异常：`findAllAgentJsonls` / `readRecentToolCalls` 内部 try/catch，跳过损坏文件
- 告警读写失败：`alertStore` 原子写入 + 读失败返回空数组，不影响 Hook 放行

**原子写入:**
- state.json、alerts.json 均用 `writeFile(tmp) → rename(dest)`，并发安全

## 横切关注点

**日志：** 仅 `console.log` / `console.error`
- Setup: `[cc-break-dead-loop] Setup: OK (Node.js x.y.z)` + `[cc-break-dead-loop] Watcher <action> (pid=N)`
- 阻断: Stop hook 经 `exit(2)` + stderr 输出 blockingError

**验证：** 运行时类型检查（`typeof`、`Array.isArray`、字段存在性），无 schema 库

**认证：** 不适用 — 纯本地插件，无外部认证

## 关键设计决策

| ID | 决策 | 理由 |
|----|------|------|
| D1 | `utils.mjs` 合并 sanitize + git | 两功能单一，总量小，避免碎片 |
| D2 | hooks.json 用 bash 展开 `${CLAUDE_PLUGIN_ROOT}` | 避免硬编码绝对路径，支持任意安装位置 |
| D3 | node-runner.mjs graceful fallback | 任何异常静默降级，不阻断 Read |
| D5 | Handler 统一 try/catch 边界 | 插件 bug 永不阻断正常 Read |
| D6 | 三层 toolResponse 检测（字符串 / `file_unchanged` / JSON.stringify 兜底）| 兼容 Claude Code 版本变更 |
| D7 | `===` 直接比较参数，不规范化 `undefined→0` | 参数规范交给 LLM/CC，不同调用意图不应等同 |
| W1 | watcher 用 detached 常驻进程而非 Hook 内联检测 | subagent transcript 是事后落盘的 jsonl，Hook 无法实时拿到；常驻进程可定时全量扫描 |
| W2 | 线 2 不用 deny 而用 Stop blockingError | subagent 无视 `permissionDecision: deny`（#25000/#34692），改为在主 agent 的 Stop hook 阻断，引导主 agent 调用 `TaskStopTool` 终止子 agent |
| W3 | 告警单文件 + sessionId 过滤隔离 | 避免多 session 多文件管理复杂度，单文件原子写入简单可靠 |
| W4 | watcher 全量重算 + 增量同步（previousDeadLoopIds）| 解决子 agent 被 kill 后告警残留问题，removeAlert 清理消失的死循环 |
| W5 | 心跳 + PID 双文件管理生命周期 | 心跳判断存活（stale → restart），PID 用于 kill 旧进程避免重复 |

---

*Architecture analysis: 2026-06-14*
