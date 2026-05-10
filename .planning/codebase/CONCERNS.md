# Codebase Concerns

**Analysis Date:** 2026-05-11

## Tech Debt

### 硬编码阈值
- Issue: `WARN_THRESHOLD = 3` 和 `BLOCK_THRESHOLD = 5` 在 `plugin/src/config.mjs` 中硬编码，无法根据工作流调整
- Files: `plugin/src/config.mjs`, `plugin/src/handlers.mjs`
- Impact: 调试复杂代码时可能过早打断，简单脚本可能希望更早阻断
- Fix approach: 支持 `~/.config/cc-break-dead-loop/config.json` 或环境变量覆盖（见 TODOS.md #1）

### 状态文件无自动清理策略
- Issue: `~/.data/cc-break-dead-loop/` 下的状态文件按 session 隔离，但会话结束后永久保留
- Files: `plugin/src/state.mjs`
- Impact: 长期运行后磁盘上积累大量废弃状态目录，需要用户手动清理
- Fix approach: 添加 session 过期检测（如 `lastUpdatedAt` 超过 7 天自动清理），或在 SessionStop 钩子中清理

### 并发递增可能丢失计数
- Issue: `incrementCounter` 使用原子写入（tmp → rename），但读取-修改-写入不是原子操作
- Files: `plugin/src/state.mjs`（`incrementCounter` 函数）
- Impact: 高并发场景下（多个子代理同时触发）可能丢失部分递增，导致死循环检测延迟触发
- Fix approach: 使用文件锁（如 `proper-lockfile`）或基于目录的互斥锁；但当前 Node.js 零依赖约束限制了方案选择

### hooks.json bash 路径解析的脆弱性
- Issue: `hooks.json` 使用 `$(dirname "$0")/../..` 动态解析插件根目录，依赖 bash 执行环境
- Files: `plugin/hooks/hooks.json`
- Impact: 如果 Claude Code 的 hook 执行环境变更（如改用 sh 或 zsh 的兼容模式），路径解析可能失败
- Fix approach: 在 Setup 钩子中验证 `PLUGIN_ROOT` 解析结果，失败时输出明确错误

## Known Bugs

### 未检测到的问题
- 当前测试全部通过（90/90），无已知运行时 bug

### Subagent/Teammate 无视 permissionDecision: deny
- Claude Code 已知 bug（#25000/#34692）：subagent 和 teammate 类型 agent 无视 hook 的 `permissionDecision: 'deny'` 响应
- Files: `plugin/src/handlers.mjs`（`preToolUseRead` 函数）
- 影响：子 agent 的死循环只能依赖 `additionalContext` 引导，无法强制阻断
- 当前缓解：双重保险策略 — deny 对主 agent 强制阻断，additionalContext 对所有 agent 类型提供文本引导
- 独立 agent_id 问题：每个子 agent 拥有独立状态文件，需要自己累积到 count>=5 才触发，主 agent 的阻断状态不共享

### 潜在边界问题
- `getStateDir` 的 `_agentType` 参数被忽略，agent 目录仅使用 `agentId`
  - Files: `plugin/src/state.mjs`（第 30 行）
  - 原计划中 agent 目录应为 `agentType + '-' + agentId`，但实现简化为仅 `agentId`
  - 影响：同一 `agentId` 在不同 `agentType` 下共享计数器，隔离粒度比预期粗
  - 修复：将 `agentType` 纳入目录名，如 `sanitizeName(agentType + '-' + (agentId || 'main'))`

## Security Considerations

### 状态文件路径遍历风险
- Risk: `sanitizeName` 将非法字符替换为 `-`，但 `sessionId` 和 `agentId` 直接来自 Claude Code 注入，若 CC 被攻破可能注入恶意值
- Files: `plugin/src/utils.mjs`（`sanitizeName`）, `plugin/src/state.mjs`（`getStateDir`）
- Current mitigation: `sanitizeName` 过滤了 `[^a-zA-Z0-9-]`，移除了路径分隔符和特殊字符
- Recommendations: 考虑对 `sessionId` 增加长度限制（当前仅 64 字符截断），防止超长目录名导致文件系统问题

### 状态数据存储在用户 home 目录
- Risk: `~/.data/cc-break-dead-loop/` 存储了每个 session 的读取历史（文件路径、偏移、行数）
- Files: `plugin/src/config.mjs`
- Current mitigation: 数据仅包含文件路径和 Read 参数，不包含文件内容
- Recommendations: 在 README 中明确告知用户状态数据的存储位置和清理方式

## Performance Bottlenecks

### 每次 Hook 调用都进行文件 I/O
- Problem: `postToolUse` 和 `preToolUseRead` 每次都读取/写入状态文件
- Files: `plugin/src/handlers.mjs`, `plugin/src/state.mjs`
- Cause: 状态持久化依赖文件系统，无内存缓存层
- Improvement path: 对于高频场景（如死循环时每秒多次 Read），文件 I/O 开销可忽略；正常场景下 I/O 次数与 Read 调用次数成正比，影响有限

### Git 仓库名解析阻塞
- Problem: `getProjectName` 在 `getStateDir` 调用链中同步执行 `spawnSync('git', ...)`
- Files: `plugin/src/utils.mjs`（`getProjectName`）
- Cause: 每次 Hook 调用都可能触发一次 git 子进程调用（5 秒超时）
- Improvement path: 缓存项目名结果（按 `cwd` 缓存），避免重复调用 git

## Fragile Areas

### 检测文案依赖 Claude Code 内部实现
- Files: `plugin/src/handlers.mjs`（`isWastedCall` 函数）
- Why fragile: 死循环检测依赖 "Wasted call — file unchanged since your last Read" 文案和 `{ type: "file_unchanged" }` 对象格式。若 Claude Code 未来版本变更文案或对象结构，检测将完全失效
- Safe modification: 修改检测逻辑时需保持向后兼容，新增文案模式而非替换
- Test coverage: `tests/handlers.test.mjs` 覆盖了字符串 "Wasted call"、`{ type: "file_unchanged" }` 对象、JSON.stringify 兜底三种模式，但未覆盖 CC 文案变更场景

### 双重错误边界的重复逻辑
- Files: `plugin/src/index.mjs`, `plugin/scripts/node-runner.mjs`
- Why fragile: `index.mjs` 和 `node-runner.mjs` 都实现了几乎相同的错误边界逻辑（try/catch → `{ continue: true }` → exit(0)）。修改时容易遗漏一处，导致行为不一致
- Safe modification: 将错误边界逻辑提取到共享模块（如 `plugin/src/fallback.mjs`），统一入口
- Test coverage: integration.test.mjs 测试了 node-runner.mjs 的 fallback 和 index.mjs 的 CLI，但未直接测试 index.mjs 内部 handler 抛出的 fallback

### `process.argv[1]` 与 `import.meta.url` 比较
- Files: `plugin/src/index.mjs`（第 31 行）
- Why fragile: `import.meta.url === \`file://${process.argv[1]}\`` 在符号链接、Windows 路径、某些打包工具下可能不匹配
- Safe modification: 使用更健壮的检测方式，如 `process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])`

## Scaling Limits

### 状态文件数量
- Current capacity: 每个 session 每个 agent 一个状态文件
- Limit: 文件系统 inode 限制。极端情况下（数千个并发 session）可能达到文件系统上限
- Scaling path: 按项目维度定期清理过期 session，或改用 SQLite 等轻量数据库

### 单状态文件并发写入
- Current capacity: 原子写入（tmp → rename）避免文件损坏
- Limit: 无锁机制，并发递增可能丢失计数（见 Tech Debt）
- Scaling path: 引入文件锁或改用支持原子递增的存储（如 SQLite 的 `UPDATE ... SET count = count + 1`）

## Dependencies at Risk

### Node.js 内置模块依赖
- 项目零外部依赖，仅依赖 Node.js 内置模块：`fs`, `path`, `child_process`, `os`, `url`
- Risk: 低。这些模块是 Node.js 核心 API，稳定性高

### Claude Code Hook 协议
- Risk: 协议字段（`tool_name`, `tool_input`, `tool_response`, `agent_id`, `session_id`）若在未来版本中变更或废弃
- Impact: 检测完全失效
- Migration plan: 关注 Claude Code 更新日志，保持多模式检测策略（D6）以兼容部分变更

## Missing Critical Features

### 可配置阈值
- Problem: 阈值固定为 3/5，无法适应不同场景
- Blocks: 用户无法根据工作流调整敏感度
- 优先级: 中（见 TODOS.md #1）

### 状态文件自动清理
- Problem: 无自动清理过期状态文件的机制
- Blocks: 长期运行后磁盘占用增长
- 优先级: 低

### npm / CI 分发
- Problem: 当前仅支持手动复制 `plugin/` 目录安装
- Blocks: 无法通过 npm 自动安装和更新
- 优先级: 中（见 TODOS.md #2）

## Test Coverage Gaps

### Handler 内部异常 fallback
- What's not tested: `index.mjs` 中 `main()` 函数调用 handler 时内部抛出异常的 fallback 路径
- Files: `plugin/src/index.mjs`
- Risk: 若 handler 抛出非预期异常，可能未正确返回 `{ continue: true }`
- Priority: 中

### node-runner.mjs 异常场景
- What's not tested: runner 内部异常（如 `import` 失败）时的 graceful fallback
- Files: `plugin/scripts/node-runner.mjs`
- Risk: 源码损坏或依赖缺失时可能未正确降级
- Priority: 低

### Setup 钩子失败场景
- What's not tested: Node.js < 18 时 setup-check.mjs 的输出和 exit code
- Files: `plugin/scripts/setup-check.mjs`
- Risk: 旧版本 Node.js 用户可能看到不友好的错误信息
- Priority: 低

### 并发递增的计数准确性
- What's not tested: 并发递增时计数是否精确（当前仅测试文件不损坏）
- Files: `tests/state.test.mjs`（"并发调用 incrementCounter" 测试）
- Risk: 高并发下死循环检测阈值偏移
- Priority: 中

---

*Concerns audit: 2026-05-10*
