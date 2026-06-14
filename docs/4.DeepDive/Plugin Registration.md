# Deep Dive: Plugin Registration — 插件注册

## 概述

Claude Code 插件通过 `plugin/` 目录下的配置文件注册到 Hook 引擎。本插件注册 **5 个 hook entry**，覆盖两条检测线：线 1（主 agent Read）+ 线 2（子 agent 工具死循环）。

## 文件结构

```
plugin/
├── .claude-plugin/
│   └── plugin.json                    # 插件元数据
├── hooks/
│   └── hooks.json                     # Hook 注册（5 entry）
├── src/                               # 核心源码（11 模块）
│   ├── index.mjs                      # Hook 入口（4 事件分发 + Stop 阻断）
│   ├── config.mjs                     # 阈值 + 数据目录 + watcher 参数
│   ├── handlers.mjs                   # 线 1：PostToolUse:Read + PreToolUse:Read
│   ├── state.mjs                      # 线 1：主 agent 计数
│   ├── utils.mjs                      # sanitize + git
│   ├── watcher.mjs                    # 线 2：扫描协调
│   ├── watcherLifecycle.mjs           # 线 2：进程决策与 spawn
│   ├── alertStore.mjs                 # 线 2：告警存储
│   ├── deadLoopDetector.mjs           # 线 2：检测算法
│   ├── hookInjector.mjs               # 线 2：注入逻辑
│   └── subagentTranscriptReader.mjs   # 线 2：jsonl 解析
└── scripts/
    ├── node-runner.mjs                # Hook 运行时（stdin + Stop exit 2 + fallback）
    ├── setup-check.mjs                # Setup：环境检测 + watcher 保活
    └── watcher.mjs                    # watcher 常驻进程入口
```

## plugin.json — 插件元数据

```json
{
  "name": "cc-break-dead-loop",
  "version": "0.2.0",
  "description": "Claude Code 插件：自动检测并打断 agent 的死循环",
  "author": { "name": "仿生狮子" },
  "license": "MIT",
  "repository": "https://github.com/Lionad-Morotar/cc-break-dead-loop",
  "homepage": "https://github.com/Lionad-Morotar/cc-break-dead-loop#readme"
}
```

不含技术配置，仅 Claude Code 识别插件的基础信息。

## hooks.json — Hook 注册（5 entry）

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
      "command": "bash -c 'node \"${CLAUDE_PLUGIN_ROOT}/scripts/node-runner.mjs\" stop'" }] }]
  }
}
```

### Hook 配置解析

| Hook | matcher | 命令 | 线 | 职责 |
|------|---------|------|----|------|
| Setup | `*` | setup-check.mjs | — | 环境检测 + 启动/保活 watcher |
| PostToolUse | `Read` | node-runner post-tool-use | 线 1 | 主 agent Read 后计数 |
| PostToolUse | `*` | node-runner post-tool-use-any | 线 2 | 任意工具后注入子 agent 告警 |
| PreToolUse | `Read` | node-runner pre-tool-use-read | 线 1 | Read 前拦截（警告/阻断）|
| Stop | `*` | node-runner stop | 线 2 | turn 结束时阻断（exit 2）|

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

### 方式一：Marketplace 安装（推荐）

```bash
# 在 Claude Code CLI 中
/plugin marketplace add Lionad-Morotar/cc-break-dead-loop
/plugin install cc-break-dead-loop
```

Marketplace 配置由项目根目录 `.claude-plugin/marketplace.json` 定义。

### 方式二：NPX CLI 安装

```bash
npx cc-break-dead-loop install
```

安装流程（`src/cli/commands/install.mjs`）：
1. 检测 Claude Code 配置目录
2. 复制 `plugin/` 到 `~/.claude/plugins/marketplaces/<owner>/plugin/`
3. 注册到 `known_marketplaces.json`
4. 注册到 `installed_plugins.json`
5. 启用插件（`settings.json` 的 `enabledPlugins`）

### 验证安装

重启 Claude Code，启动日志应出现：

```
[cc-break-dead-loop] Setup: OK (Node.js v22.22.1)
[cc-break-dead-loop] Watcher start (pid=12345)
```

### 其他 CLI 命令

```bash
npx cc-break-dead-loop status            # 查看安装状态
npx cc-break-dead-loop uninstall         # 卸载
npx cc-break-dead-loop uninstall --purge # 卸载并删除 marketplace 目录
npx cc-break-dead-loop version           # 版本号
```
