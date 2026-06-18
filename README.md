# cc-break-dead-loop

Claude Code 插件：自动检测并打断 agent 的死循环 —— 主 agent 对同一未改动文件的连续 Read 死循环（双 Hook 拦截），以及子 agent 的工具调用死循环（watcher 常驻进程扫描）。

## 问题背景

两类死循环：

1. **主 agent Read 死循环**：主 agent 在 Read 工具返回 `"Wasted call"` 或 `{ type: "file_unchanged" }` 时不理解信号，连续重复读取同一文件。
2. **子 agent 工具调用死循环**：子 agent（subagent / teammate）陷入连续重复调用同一工具（任意工具，不只是 Read）。子 agent 无视 hook 的 `permissionDecision: deny`（Claude Code 已知 bug #25000/#34692），无法用常规 Hook 直接阻断。

本插件用**双线机制**分别处理：
- **线 1（主 agent）**：双 Hook（PostToolUse 检测 + PreToolUse:Read 拦截）
- **线 2（子 agent）**：watcher 扫描 subagent transcript → 检测死循环 → 经 Stop/PostToolUse:`*` Hook 引导主 agent 调用 `TaskStopTool` 终止子 agent

## 工作原理

```
线 1：主 agent Read 死循环（双 Hook）
─────────────────────────────────────
Claude Code (Read 返回 file_unchanged)
    │
    ▼
PostToolUse:Read ──→ 检测 wasted call → 计数器 +1
    │
    ▼
PreToolUse:Read ──→ 检查计数器
    │ 达 3 次 → 注入 additionalContext 警告
    │ 达 5 次 → deny 阻断 + additionalContext 引导
    ▼
正常 Read / 被阻断


线 2：子 agent 死循环（watcher + 注入）
─────────────────────────────────────
Setup Hook ──→ 启动/保活 watcher 常驻进程（detached）
    │
    ▼
watcher（每 5s）
    ├─ 扫描 ~/.claude/projects/<proj>/<session>/subagents/agent-*.jsonl
    ├─ 提取最近 20 个 tool_use，检测尾部连续重复 ≥ 5 次
    └─ 写 alerts.json（消失的死循环清理，新增/持续的更新）
    │
    ▼
PostToolUse:* Hook ──→ 读 alerts.json → 注入 additionalContext（引导主 agent 调 TaskStopTool）
Stop Hook ──→ 读 alerts.json → 返回 blockingError（exit 2，强制主 agent 继续 turn 处理告警）
```

### 补充缓解：前台同步子代理死循环

线 2 的注入依赖主 agent 的 Stop/PostToolUse hook 触发。但**前台同步子代理**（`run_in_background:false`）死循环时，主 agent 阻塞在 Agent 工具里等返回、turn 不结束，hook 不触发——插件够不到主 agent，无法引导调用 `TaskStopTool`。这是 Claude Code 架构硬限制。本插件对此另补两道缓解：

- **SessionStart 注入**：会话启动时给主 agent 一段建议，引导优先用 `run_in_background:true` 后台子代理（后台子代理可被线 2 正常拦截）。
- **watcher 桌面通知**：检测到**活跃**死循环时弹系统通知（macOS osascript / Linux notify-send），提醒用户手动 Esc 中断。设 `CC_BREAK_NOTIFY=0` 关闭。

**核心特性：**

- **双线检测**：线 1 处理主 agent Read 死循环，线 2 处理子 agent 任意工具死循环
- **watcher 常驻进程**：detached spawn，心跳保活，崩溃自动重启
- **绕过 subagent deny 失效**：子 agent 死循环由主 agent 经 `TaskStopTool` 终止，不依赖对子 agent 的 deny
- **多重检测兼容**（线 1）：字符串 `"Wasted call"` / 对象 `{ type: "file_unchanged" }` / JSON.stringify 兜底
- **参数指纹检测**（线 2）：稳定序列化（对象键排序）生成指纹，键序不同的等价参数视为相同
- **状态按 project+session+agent 隔离**（线 1），告警按 sessionId 过滤隔离（线 2）
- **多重错误边界**：handler try/catch + node-runner graceful fallback + watcher 崩溃自愈，插件 bug 永不阻断正常 Read / 永不阻断 Claude Code 启动

## 环境要求

- Node.js >= 18（ES Module + watcher detached 进程模型需要）
- Git（可选，用于解析项目名）

## 安装

```bash
# 1. 添加 marketplace（首次使用）
/plugin marketplace add Lionad-Morotar/cc-break-dead-loop

# 2. 安装插件
/plugin install cc-break-dead-loop
```

### 验证安装

重启 Claude Code，启动日志中应出现：

```
[cc-break-dead-loop] Setup: OK (Node.js v22.22.1)
[cc-break-dead-loop] Watcher start (pid=12345)
```

## 更新

```bash
/plugin update cc-break-dead-loop
```

## 卸载

```bash
/plugin uninstall cc-break-dead-loop
```

## 开发测试

```bash
# 运行全部测试（135 tests，15 files）
npm test                         # = vitest run

# watch 模式（TDD）
npm run test:watch

# 运行单个测试文件
npx vitest run tests/state.test.mjs
npx vitest run tests/watcher.test.mjs
npx vitest run tests/integration.test.mjs

# 按测试名过滤
npx vitest -t "sanitizeName"

# 手动模拟 Hook 输入
echo '{"tool_name":"Read","tool_input":{"file_path":"/a/b"},"tool_response":"Wasted call","session_id":"s","agent_id":"a","cwd":"/tmp"}' | node plugin/src/index.mjs post-tool-use
```

### 使用 CLAUDE_PLUGIN_ROOT 环境变量

开发时可直接使用项目路径，无需复制：

```bash
export CLAUDE_PLUGIN_ROOT=/path/to/cc-break-dead-loop
```

## 配置

当前阈值固定为（见 `plugin/src/config.mjs`）：

**线 1（主 agent Read）：**
- **3 次重复**：注入警告（additionalContext）
- **5 次重复**：deny 阻断 + additionalContext 引导

**线 2（子 agent watcher）：**
- 滑动窗口：最近 **20** 个 tool_use
- 触发阈值：尾部连续重复 **5** 次
- 扫描间隔：**5000ms**
- 心跳超时（视为死亡需重启）：**30000ms**
- 桌面通知：检测到**活跃**死循环时弹系统通知提醒手动中断（设环境变量 `CC_BREAK_NOTIFY=0` 关闭）

**SessionStart 注入（补充缓解）：**
- 会话启动时注入子代理使用建议，引导主 agent 优先用 `run_in_background:true`

未来版本将支持用户自定义阈值（见 TODOS.md）。

## 状态数据

状态/告警/进程数据存储在（可由 `CC_BREAK_DATA_DIR` 覆盖）：

```
~/.data/cc-break-dead-loop/
  ├─ <safe-project-name>/<session-id>/<safe-agent-name>/
  │   └─ state.json              # 线 1：主 agent Read 计数
  ├─ alerts.json                 # 线 2：子 agent 死循环告警（watcher 写 / hooks 读）
  ├─ watcher-heartbeat.json      # watcher 心跳（{ pid, ts }）
  └─ watcher.pid                 # watcher PID（重启时 kill 旧进程）
```

watcher 扫描的 subagent transcript 位于 `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`（Claude Code 生成，只读输入）。

可安全删除 `~/.data/cc-break-dead-loop/`，插件会在下次使用时自动重建。

## 架构

```
cc-break-dead-loop/
├── src/
│   └── cli/               # NPX CLI 工具（install / uninstall / status）
├── plugin/
│   ├── .claude-plugin/
│   │   └── plugin.json    # 插件元数据
│   ├── hooks/
│   │   └── hooks.json     # Hook 注册（Setup + SessionStart + PostToolUse[Read+*] + PreToolUse[Read] + Stop）
│   ├── scripts/
│   │   ├── node-runner.mjs   # Hook 运行时（stdin 收集、Stop exit 2、graceful fallback）
│   │   ├── setup-check.mjs   # 环境检测 + 启动/保活 watcher
│   │   └── watcher.mjs       # watcher 常驻进程入口（detached spawn）
│   └── src/               # 核心源码（13 模块）
│       ├── index.mjs               # Hook 入口（5 事件分发、Stop 阻断）
│       ├── config.mjs              # 阈值 + 数据目录 + watcher 参数常量
│       ├── handlers.mjs            # 线 1：PostToolUse:Read + PreToolUse:Read
│       ├── state.mjs               # 线 1：主 agent 计数状态（原子写入）
│       ├── utils.mjs               # 路径安全化 + Git 仓库名解析
│       ├── watcher.mjs             # 线 2：扫描协调（transcript → 检测 → 告警同步）
│       ├── watcherLifecycle.mjs    # 线 2：watcher 进程决策与 spawn
│       ├── alertStore.mjs          # 线 2：告警存储（watcher 写 / hooks 读）
│       ├── deadLoopDetector.mjs    # 线 2：死循环检测算法（稳定序列化指纹）
│       ├── hookInjector.mjs        # 线 2：Hook 注入措辞生成
│       ├── notifier.mjs            # 桌面通知（活跃死循环提醒用户手动中断）
│       ├── sessionStartAdvice.mjs  # SessionStart 注入（引导后台子代理）
│       └── subagentTranscriptReader.mjs # 线 2：subagent jsonl 解析
├── tests/                # 测试套件（17 文件，160 用例，Vitest）
├── vitest.config.mjs     # Vitest 配置
├── pnpm-lock.yaml
└── package.json
```

## 技术决策

- **无构建步骤**：纯 JavaScript（ES Module），Node.js 直接运行
- **零运行时依赖**：仅 Node.js 内置模块；开发依赖仅 `vitest`
- **原子写入**：`writeFile(tmp) → rename(tmp, dest)` 避免并发损坏（state.json、alerts.json 均如此）
- **多重检测兼容**（线 1）：字符串 / `file_unchanged` 对象 / JSON.stringify 兜底
- **参数精确比较**（线 1）：`===` 直接比较，不规范化 `undefined→0`
- **稳定序列化指纹**（线 2）：对象键排序后 stringify，键序不同的等价参数视为相同
- **watcher detached 常驻进程**（线 2）：subagent transcript 是事后落盘的 jsonl，Hook 无法实时拿到，常驻进程定时全量扫描
- **绕过 subagent deny 失效**（线 2）：子 agent 死循环不直接 deny，改为在主 agent 的 Stop hook 返回 blockingError，引导主 agent 调 `TaskStopTool` 终止子 agent
- **告警全量重算 + 增量同步**（线 2）：每次扫描全量重算死循环集合，对比上次集合，消失的 removeAlert、持续/新增的 addAlert，解决子 agent 被 kill 后告警残留

## 已知限制

- **前台同步子代理死循环是架构死结**：`run_in_background:false` 的子代理死循环时主 agent 阻塞、Stop/PostToolUse hook 不触发，线 2 够不到主 agent，无法自动拦截。仅靠 SessionStart 引导 + watcher 桌面通知缓解，最终需用户手动 Esc。
- **线 2 依赖主 agent 遵循引导**：watcher 检测到子 agent 死循环后，通过 Stop hook blockingError + PostToolUse additionalContext 引导主 agent 调用 `TaskStopTool`。若主 agent 忽略 blockingError，仍可能漏阻断。
- **watcher 检测有延迟**：扫描间隔 5s + transcript 落盘延迟，子 agent 死循环最快在数秒后被发现。
- **每个 subagent 独立计数**：线 1 计数器按 agent 隔离，无法跨 agent 累计。
- **主 agent 场景下 deny 完全有效**：线 1 的 deny + additionalContext 双重机制确保主 agent 被可靠阻断。
