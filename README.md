# cc-break-dead-loop

Claude Code 插件：自动检测并打断 agent 对同一未改动文件的连续 Read 死循环。

## 问题背景

Claude Code 子代理（如 gsd-planner）在 Read 工具返回 `"Wasted call"` 或 `{ type: "file_unchanged" }` 时，不理解该信号，陷入连续重复读取同一文件的死循环。本插件通过双 Hook（PostToolUse 检测 + PreToolUse:Read 拦截）自动检测并打断这种死循环。

## 工作原理

```
Claude Code (Read 返回 file_unchanged / "Wasted call")
    │
    ▼
PostToolUse Hook ──→ 检测 wasted call → 计数器 +1
    │
    ▼
PreToolUse:Read Hook ──→ 检查计数器
    │ 达 3 次 → 注入 additionalContext 警告
    │ 达 5 次 → deny 阻断（主 agent）+ additionalContext 引导（子 agent）
    ▼
正常 Read / 被阻断
```

- **多重检测兼容**：字符串 `"Wasted call"` / 对象 `{ type: "file_unchanged" }` / JSON.stringify 兜底
- **检测状态按 project+session+agent 隔离**，互不干扰
- **状态持久化**在 `~/.data/cc-break-dead-loop/<project>/<session>/<agent>/`
- **Read 参数任一变化时重置计数器**（file_path、offset、limit）
- **双重错误边界**：handler try/catch + node-runner.mjs graceful fallback，插件 bug 永不阻断正常 Read

## 环境要求

- Node.js >= 18（`node:test` 和原生 ES Module 支持需要）
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
# 运行全部测试（90 tests）
npm test

# 运行单个测试文件
node --test tests/state.test.mjs
node --test tests/handlers.test.mjs
node --test tests/integration.test.mjs

# 手动模拟 Hook 输入
echo '{"tool_name":"Read","tool_input":{"file_path":"/a/b"},"tool_response":"Wasted call","session_id":"s","agent_id":"a","cwd":"/tmp"}' | node plugin/src/index.mjs post-tool-use
```

### 使用 CLAUDE_PLUGIN_ROOT 环境变量

开发时可直接使用项目路径，无需复制：

```bash
export CLAUDE_PLUGIN_ROOT=/path/to/cc-break-dead-loop
```

## 配置

当前阈值固定为：
- **3 次重复**：注入警告（additionalContext）
- **5 次重复**：deny 阻断（主 agent）+ additionalContext 引导（子 agent）

未来版本将支持用户自定义阈值（见 TODOS.md）。

## 状态数据

状态文件存储在：

```
~/.data/cc-break-dead-loop/
  └─ <safe-project-name>/
      └─ <session-id>/
          └─ <safe-agent-name>/
              └─ state.json
```

可安全删除，插件会在下次使用时自动重建。

## 架构

```
cc-break-dead-loop/
├── src/
│   └── cli/               # NPX CLI 工具
│       ├── index.mjs      # CLI 入口（命令路由）
│       ├── commands/      # install / uninstall / status
│       └── utils/         # 路径解析 / 文件操作 / 配置读取
├── plugin/
│   ├── .claude-plugin/
│   │   └── plugin.json    # 插件元数据
│   ├── hooks/
│   │   └── hooks.json     # Hook 注册配置
│   ├── scripts/
│   │   ├── node-runner.mjs   # Node.js runner（stdin 收集、graceful fallback）
│   │   └── setup-check.mjs   # 环境检测脚本
│   └── src/               # 核心源码
│       ├── index.mjs      # Hook 入口（stdin/stdout 协议、错误边界）
│       ├── config.mjs     # 阈值与数据目录配置
│       ├── handlers.mjs   # PostToolUse + PreToolUse:Read 双 Handler
│       ├── state.mjs      # 状态管理（原子写入、计数器逻辑）
│       └── utils.mjs      # 路径安全化 + Git 仓库名解析
├── .claude-plugin/
│   └── marketplace.json   # 插件市场注册表
├── tests/
│   ├── cli/               # CLI 测试（install / uninstall / status / paths / fs）
│   ├── state.test.mjs     # 状态管理单元测试
│   ├── handlers.test.mjs  # Handler 逻辑单元测试
│   └── integration.test.mjs # 端到端集成测试
└── package.json           # npm 包配置（bin / files / repository）
```

## 技术决策

- **无构建步骤**：纯 JavaScript（ES Module），Node.js 直接运行
- **零额外依赖**：仅使用 Node.js 内置模块
- **原子写入**：`writeFile(tmp) → rename(tmp, dest)` 避免并发损坏
- **多重检测兼容**：字符串 `"Wasted call"` / 对象 `{ type: "file_unchanged" }` / 对象 content / JSON.stringify 兜底（D6）
- **参数精确比较**：`===` 直接比较，不规范化 `undefined→0`（D7）
- **deny + additionalContext 双重保险**：`permissionDecision: "deny"` 阻断主 agent，`additionalContext` 引导子 agent 主动停止

## 已知限制

- **Subagent / Teammate 不遵守 hook 的 `permissionDecision: "deny"`**：Claude Code 已知 bug（[#25000](https://github.com/anthropics/claude-code/issues/25000) / [#34692](https://github.com/anthropics/claude-code/issues/34692)），deny 仅对主 agent 生效
- **每个 subagent / teammate 有独立 agent_id**：计数器按 agent 隔离计算，无法跨 agent 累计
- **主 agent 场景下 deny + additionalContext 完全有效**：双重机制确保主 agent 被可靠阻断
