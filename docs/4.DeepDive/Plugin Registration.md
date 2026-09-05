# Deep Dive: Plugin Registration — 插件注册

## 概述

Claude Code 插件通过 `plugin/` 目录下的配置文件注册到 Hook 引擎。本插件注册 **6 个 hook entry**，覆盖两条检测线：线 1（主 agent Read）+ 线 2（子 agent 工具死循环）。

## 文件结构

```
plugin/
├── .claude-plugin/
│   └── plugin.json                    # 插件元数据
├── hooks/
│   └── hooks.json                     # Hook 注册（6 entry）
├── src/                               # 核心源码（13 模块）
│   ├── index.mjs                      # Hook 入口（5 事件分发 + watcher 保活 + Stop 阻断）
│   ├── config.mjs                     # 阈值 + 数据目录 + watcher 参数
│   ├── handlers.mjs                   # 线 1：PostToolUse:Read + PreToolUse:Read
│   ├── state.mjs                      # 线 1：主 agent 计数
│   ├── utils.mjs                      # sanitize + git
│   ├── watcher.mjs                    # 线 2：扫描协调
│   ├── watcherLifecycle.mjs           # 线 2：进程决策与 spawn
│   ├── alertStore.mjs                 # 线 2：告警存储
│   ├── deadLoopDetector.mjs           # 线 2：检测算法
│   ├── hookInjector.mjs               # 线 2：注入逻辑
│   ├── subagentTranscriptReader.mjs   # 线 2：jsonl 解析（含尾块时间戳读取）
│   ├── notifier.mjs                   # 桌面通知（活跃死循环提醒 + watcher 复活通知）
│   └── sessionStartAdvice.mjs         # SessionStart 注入文案（引导后台子代理）
└── scripts/
    ├── node-runner.mjs                # Hook 运行时（stdin + Stop exit 2 + fallback）
    ├── setup-check.mjs                # Setup：环境检测 + watcher 保活
    └── watcher.mjs                    # watcher 常驻进程入口
```

## plugin.json — 插件元数据

```json
{
  "name": "cc-break-dead-loop",
  "version": "0.3.1",
  "description": "Claude Code 插件：双线死循环防护 —— 主 agent 连续 Read 同一未改动文件（双 Hook 拦截）+ 子 agent 工具调用死循环（watcher 常驻进程扫描，引导主 agent 调 TaskStopTool 终止）",
  "author": { "name": "仿生狮子" },
  "license": "MIT",
  "repository": "https://github.com/Lionad-Morotar/cc-break-dead-loop",
  "homepage": "https://github.com/Lionad-Morotar/cc-break-dead-loop#readme"
}
```

不含技术配置，仅 Claude Code 识别插件的基础信息。

## hooks.json — Hook 注册（6 entry）

```json
{
  "hooks": {
    "Setup": [{ "matcher": "*", "hooks": [{ "type": "command",
      "command": "bash -c 'node \"${CLAUDE_PLUGIN_ROOT}/scripts/setup-check.mjs\"'" }] }],
    "PostToolUse": [
      { "matcher": "Read", "hooks": [{ "type": "command",
        "command": "bash -c 'node \"${CLAUDE_PLUGIN_ROOT}/scripts/node-runner.mjs\" post-tool-use'" }] },
      { "matcher": "*", "hooks": [{ "type": "command",
        "command": "bash -c 'node \"${CLAUDE_PLUGIN_ROOT}/scripts/node-runner.mjs\" post-tool-use-any'" }] }
    ],
    "PreToolUse": [{ "matcher": "Read", "hooks": [{ "type": "command",
      "command": "bash -c 'node \"${CLAUDE_PLUGIN_ROOT}/scripts/node-runner.mjs\" pre-tool-use-read'" }] }],
    "Stop": [{ "matcher": "*", "hooks": [{ "type": "command",
      "command": "bash -c 'node \"${CLAUDE_PLUGIN_ROOT}/scripts/node-runner.mjs\" stop'" }] }],
    "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command",
      "command": "bash -c 'node \"${CLAUDE_PLUGIN_ROOT}/scripts/node-runner.mjs\" session-start'" }] }]
  }
}
```

### Hook 配置解析

| Hook | matcher | 命令 | 线 | 职责 |
|------|---------|------|----|------|
| Setup | `*` | setup-check.mjs | — | 环境检测 + 启动/保活 watcher（仅 `--init`/`--init-only`/`--maintenance` 特殊触发） |
| SessionStart | `*` | node-runner session-start | — | 注入后台子代理规则 + watcher 保活 |
| PostToolUse | `Read` | node-runner post-tool-use | 线 1 | 主 agent Read 后计数 |
| PostToolUse | `*` | node-runner post-tool-use-any | 线 2 | 任意工具后注入子 agent 告警 + watcher 保活兜底 |
| PreToolUse | `Read` | node-runner pre-tool-use-read | 线 1 | Read 前拦截（警告/阻断）|
| Stop | `*` | node-runner stop | 线 2 | turn 结束时阻断（exit 2）+ watcher 保活兜底 |

### 动态路径解析（D2）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/node-runner.mjs"
```

- `CLAUDE_PLUGIN_ROOT` 由 Claude Code 自动设置为插件根目录
- 所有脚本通过该变量定位，无需硬编码绝对路径
- bash 层负责环境变量展开与路径规范化

## node-runner.mjs — 运行时包装

```javascript
import { main } from '../src/index.mjs';

async function finish() {
  clearTimeout(timeout);
  try {
    const result = await main(event, data);

    // Stop hook 的 blockingError：exit 2 + stderr 触发 Claude Code 强制 continue
    if (result?.shouldBlock) {
      process.stderr.write(result.systemMessage);
      process.exit(2);
    }

    console.log(JSON.stringify(result));
    process.exit(0);
  } catch {
    handleError();
  }
}

function handleError() {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}
```

### 设计要点

**stdin 超时保护**：5s 未结束则强制处理（data 可能为空，`main()` 会处理）。

**Stop blockingError 翻译**：`main()` 返回 `{ shouldBlock, systemMessage }` 时，runner 写 stderr + `exit(2)`，触发 Claude Code blockingError 机制。其余结果直接 `JSON.stringify` 透传。

**Graceful Fallback（D3）**：任何异常输出 `{ continue: true }` + `exit(0)`，插件问题不阻断正常操作。

## setup-check.mjs — 环境检测 + watcher 保活

```javascript
import { ensureWatcherRunning } from '../src/watcherLifecycle.mjs';

const nodeCheck = checkNode();
if (nodeCheck.ok) {
  console.log(`[cc-break-dead-loop] Setup: OK (${nodeCheck.message})`);

  // 启动/保活 watcher 常驻进程
  try {
    const result = ensureWatcherRunning({
      watcherScript,
      heartbeatFile: HEARTBEAT_FILE,
      pidFile: PID_FILE,
      staleTimeoutMs: WATCHER_STALE_TIMEOUT_MS,
    });
    if (result.started) {
      console.log(`[cc-break-dead-loop] Watcher ${result.action} (pid=${result.pid})`);
    }
  } catch (e) {
    console.error(`[cc-break-dead-loop] Watcher 启动失败: ${e.message}`);
  }
}
// Setup 永不阻断启动
process.exit(0);
```

### 设计要点

**Setup 永不阻断**：无论 Node.js 检测还是 watcher 启动结果，`exit(0)`。

**watcher 保活决策**：`ensureWatcherRunning` 读心跳 → `decideAction`：
- 心跳新鲜 → `none`（已运行，不重启）
- 心跳过期 → `restart`（按 PID kill 旧进程后 spawn 新的）
- 无心跳 → `start`（首次 spawn）

**watcher 失败不阻断**：spawn 异常仅 `console.error`，Claude Code 仍正常启动（只是线 2 失效）。

## watcher.mjs — 常驻进程入口

```javascript
import { createWatcher } from '../src/watcher.mjs';

const watcher = createWatcher({
  projectsDir: PROJECTS_DIR,
  alertsFile: ALERTS_FILE,
  heartbeatFile: HEARTBEAT_FILE,
  windowSize: WATCHER_WINDOW_SIZE,
  threshold: WATCHER_THRESHOLD,
});

watcher.scanOnce();                       // 立即扫描一次
watcher.start(WATCHER_SCAN_INTERVAL_MS);  // 定时扫描

process.stdin.resume();                   // 保持进程存活

process.on('SIGTERM', () => { watcher.stop(); process.exit(0); });
process.on('SIGINT', () => { watcher.stop(); process.exit(0); });
```

detached spawn（`stdio: 'ignore'`, `unref`），不依赖父进程。立即扫描一次快速进入守护状态，随后每 5s 扫描。SIGTERM/SIGINT 优雅退出。

## 安装机制

### Marketplace 安装

```bash
# 在 Claude Code CLI 中
/plugin marketplace add Lionad-Morotar/claude-plugins
/plugin install cc-break-dead-loop@lionad-morotar
```

Marketplace 配置由中心集市仓库 `Lionad-Morotar/claude-plugins` 的 `.claude-plugin/marketplace.json` 定义，本插件条目以 `source: github` 指向本仓库并用 `ref` 锁定发布 tag。

本仓库以 git submodule 方式在 `packages/claude-plugins` 绑定该集市仓库，条目的 version/ref 更新随本仓库发版流程在子模块内提交。推送顺序防双向引用悬空：主仓 release commit 与 tag 先推 → 子模块条目（ref 指向已存在的 tag）再推 → 主仓 gitlink bump（指向已推送的子模块 commit）最后单独提交推送。

### 验证安装

重启 Claude Code（新开会话即触发 SessionStart hook，watcher 自动拉起），随后确认常驻进程存活：

```bash
cat ~/.data/cc-break-dead-loop/watcher-heartbeat.json   # ts 应在最近 30 秒内
ps -p $(cat ~/.data/cc-break-dead-loop/watcher.pid)      # 应显示 watcher.mjs 进程
```
