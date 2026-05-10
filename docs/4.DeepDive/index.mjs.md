# Deep Dive: index.mjs — Hook 入口

## 概述

`src/index.mjs` 是整个插件的**单一入口点**，负责 stdin 解析、事件分发、以及统一错误边界。它被两处调用：

1. **CLI 入口**：`node src/index.mjs <event>`（通过 stdin 接收 JSON 数据）
2. **模块入口**：`import { main } from '../src/index.mjs'`（由 `node-runner.mjs` 使用）

## 职责

- 解析 stdin 注入的 JSON（HookInput）
- 根据 event 名称分发到对应 handler
- **统一错误边界**：任何内部错误都返回 `{ continue: true }` 静默失败
- 处理阻断标记（`shouldBlock`），在 CLI 模式下触发 `process.exit(2)`

## 架构

```mermaid
flowchart TD
  A[stdin JSON] --> B{JSON.parse}
  B -->|成功| C{event}
  B -->|失败| D[返回 { continue: true }]
  C -->|post-tool-use| E[postToolUse(input)]
  C -->|pre-tool-use-read| F[preToolUseRead(input)]
  C -->|其他| D
  E --> G{result.shouldBlock?}
  F --> G
  G -->|是| H[console.log systemMessage]
  G -->|是| I[process.exit(2)]
  G -->|否| J[console.log result]
  G -->|否| K[process.exit(0)]
  E -->|异常| D
  F -->|异常| D
```

## 关键代码分析

### main() 函数

```javascript
export async function main(event, stdinData) {
  let input;
  try {
    input = JSON.parse(stdinData || '{}');
  } catch {
    return { continue: true, suppressOutput: true };
  }

  switch (event) {
    case 'post-tool-use':
      return postToolUse(input);
    case 'pre-tool-use-read':
      return preToolUseRead(input);
    default:
      return { continue: true, suppressOutput: true };
  }
}
```

**设计要点**：
- `JSON.parse` 失败时静默返回 `continue: true`（D5 错误边界）
- `stdinData || '{}'` 处理空输入场景
- 使用同步 `switch` 而非动态路由，因为事件类型固定且极少

### CLI 入口

```javascript
if (import.meta.url === `file://${process.argv[1]}`) {
  const event = process.argv[2];
  let data = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });

  process.stdin.on('end', async () => {
    try {
      const result = await main(event, data);
      if (result?.shouldBlock) {
        console.log(JSON.stringify({ systemMessage: result.systemMessage }));
        process.exit(2);
      }
      console.log(JSON.stringify(result));
      process.exit(0);
    } catch {
      // D5: 任何内部错误都返回 { continue: true } 静默失败
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      process.exit(0);
    }
  });

  process.stdin.on('error', () => {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    process.exit(0);
  });
}
```

**设计要点**：
- `import.meta.url === file://${process.argv[1]}` 判断是否为直接运行（非 import）
- 阻断时只输出 `{ systemMessage }`，不含其他字段
- `process.exit(2)` 对应 Claude Code 的 blocking error 语义
- `stdin.on('error')` 处理 stdin 流异常（如管道断裂）

## 输入/输出契约

### 输入（stdin JSON）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tool_name` | string | 条件 | PostToolUse 时需要，如 "Read" |
| `tool_input` | object | 条件 | PostToolUse/PreToolUse 时需要，含 `file_path`, `offset`, `limit` |
| `tool_response` | any | 条件 | PostToolUse 时需要，Read 的返回结果 |
| `session_id` | string | 是 | Claude Code 会话 ID |
| `agent_id` | string | 否 | 代理 ID，空值时 fallback 为 "main" |
| `agent_type` | string | 否 | 代理类型（如 "planner"） |
| `cwd` | string | 是 | 当前工作目录 |

### 输出（stdout JSON）

| 场景 | 输出格式 |
|------|----------|
| 正常放行 | `{ "continue": true, "suppressOutput": true }` |
| 注入警告 | `{ "continue": true, "suppressOutput": false, "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "...", "permissionDecision": "allow" } }` |
| 阻断 | `{ "systemMessage": "检测到 Read 死循环..." }` + exit(2) |
| 错误降级 | `{ "continue": true, "suppressOutput": true }` |

## 错误边界设计

本文件是**第二层错误边界**（第一层是 `node-runner.mjs`）。`main()` 内部没有 try/catch，因为 `postToolUse()` 和 `preToolUseRead()` 自身都是纯函数，不会抛出异常。错误边界集中在 CLI 入口：

```
stdin.on('end') 中的 try/catch
    ├── main() 调用
    │   ├── JSON.parse 失败 → 已内部处理
    │   ├── postToolUse() → 纯函数，无异常
    │   └── preToolUseRead() → 纯函数，无异常
    └── 任何异常 → { continue: true } + exit(0)
```

为什么 handler 不抛异常？因为 `state.mjs` 的所有 I/O 操作都有内部 try/catch（`readState` 返回 null，`writeState` 假设目录已存在——实际上由 `mkdirSync` 的 `recursive: true` 保证）。

## 测试覆盖

| 测试场景 | 覆盖文件 | 断言 |
|----------|----------|------|
| 有效 event 分发 | integration.test.mjs | stdout 返回预期 JSON |
| 无效 event 名称 | integration.test.mjs | 返回 `{ continue: true }` |
| stdin 为空 | integration.test.mjs | 不崩溃，返回 `{ continue: true }` |
| stdin 无效 JSON | integration.test.mjs | 不崩溃，返回 `{ continue: true }` |
| 直接运行 index.mjs CLI | integration.test.mjs | 正确处理 stdin |
