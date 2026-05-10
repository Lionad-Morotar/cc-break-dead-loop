# Deep Dive: Testing — 测试体系

## 概述

测试套件使用 Node.js 18+ 内置的 `node:test` 模块和 `node:assert`，**零外部测试依赖**。共 46 项断言，覆盖状态管理、handler 逻辑、端到端集成三个层次。

```
node --test
# 或指定文件
node --test tests/state.test.mjs
```

## 测试金字塔

```mermaid
graph TD
  subgraph "集成测试 (8 项)"
    I1[stdin/stdout 协议]
    I2[setup-check.mjs]
    I3[index.mjs CLI]
  end

  subgraph "Handler 测试 (18 项)"
    H1[isWastedCall]
    H2[postToolUse]
    H3[preToolUseRead]
  end

  subgraph "状态管理测试 (20 项)"
    S1[sanitizeName]
    S2[getProjectName]
    S3[getStateDir]
    S4[read/write State]
    S5[incrementCounter]
    S6[isSameReadParams]
  end
```

## state.test.mjs — 状态管理（20 项断言）

### sanitizeName

| 断言 | 输入 | 预期 | 场景 |
|------|------|------|------|
| 保留字母数字连字符 | `my-project_123` | `my-project-123` | 下划线转连字符 |
| 去除首尾连字符 | `-hello-` | `hello` | 首尾清理 |
| 空结果 fallback | `___` / `''` / `null` | `unknown` | 无效输入保护 |
| 截断到 64 字符 | `x`.repeat(100) | 64 个 x | 路径长度限制 |

### getProjectName

| 断言 | 场景 |
|------|------|
| git 仓库中返回仓库名 | 当前目录是 git 仓库 |
| 无 git 目录返回文件夹名 | `/tmp` → `tmp` |
| 空路径返回 unknown | `''` / `null` → `unknown` |

### getStateDir

| 断言 | 验证点 |
|------|--------|
| 构建正确路径 | 包含 project / session / agent |
| agent_id 为空用 main | 主代理 fallback |

### readState / writeState / incrementCounter

| 断言 | 场景 |
|------|------|
| writeState 自动创建目录 | 深层目录不存在时递归创建 |
| readState 正确读取 | 写入后读取内容一致 |
| readState 文件不存在 | 返回 `null` |
| incrementCounter 连续递增 | 同一参数调用 3 次返回 1, 2, 3 |
| incrementCounter 参数变化重置 | `offset: 10` → `offset: 11` 重置为 1 |
| incrementCounter undefined vs 0 | `offset: undefined` 和 `offset: 0` 视为不同（D7） |
| 并发调用不损坏文件 | 20 次并发写入，文件始终合法 JSON |

### isSameReadParams

| 断言 | 场景 |
|------|------|
| 相同参数 | `filePath`/`offset`/`limit` 全匹配 |
| 不同参数 | 任一字段不匹配 |
| undefined 和 0 | `undefined !== 0`（D7） |
| null state | 返回 `false` |

## handlers.test.mjs — Handler 逻辑（18 项断言）

### isWastedCall

| 断言 | 输入 | 预期 |
|------|------|------|
| 字符串包含 | `'Wasted call — file unchanged'` | `true` |
| 字符串不包含 | `'File content here'` | `false` |
| 对象 content 包含 | `{ content: 'Wasted call...' }` | `true`（D6） |
| 嵌套对象兜底 | `{ nested: { msg: 'Wasted call...' } }` | `true`（D6） |
| null / undefined | `null` / `undefined` | `false` |
| 数字 / 布尔 | `42` / `true` | `false` |

### postToolUse

| 断言 | 场景 | 验证点 |
|------|------|--------|
| 正常内容 | `tool_response: '正常文件内容'` | 不操作计数器 |
| 非 Read 工具 | `tool_name: 'Bash'` | 不操作 |
| 缺少 file_path | `tool_input: { offset: 10 }` | 静默跳过 |
| 字符串 wasted call | `tool_response: 'Wasted call...'` | 计数器递增 |
| 对象 content wasted call | `{ content: 'Wasted call...' }` | 计数器递增（D6） |
| 嵌套对象 wasted call | `{ nested: { msg: 'Wasted call...' } }` | 计数器递增（D6） |

### preToolUseRead

| 断言 | 前置状态 | 预期行为 |
|------|----------|----------|
| 状态不存在 | 无 | 放行 |
| 计数器 = 2 | `writeTestState(2)` | 放行 |
| 计数器 = 3 | `writeTestState(3)` | 注入 `additionalContext` |
| 计数器 = 5 | `writeTestState(5)` | 返回 `shouldBlock` |
| 计数器 = 5 但参数变化 | `writeTestState(5, { offset: undefined })` | 放行（D7） |
| 阻断文案验证 | `writeTestState(5)` | 包含"文件未改动"和"使用之前结果" |

**测试隔离**：每个 `preToolUseRead` 测试通过 `before()` 清理状态文件，使用不同的 `baseInput` 参数避免交叉污染。

## integration.test.mjs — 端到端集成（8 项断言）

### 测试工具函数

```javascript
function runRunner(event, input) {
  return new Promise((resolve) => {
    const child = spawn('node', [
      join(projectRoot, 'plugin/scripts/node-runner.mjs'),
      event,
    ], { cwd: projectRoot });

    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('close', (code) => {
      resolve({ code, stdout: stdout.trim() });
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}
```

通过子进程运行真实的 `node-runner.mjs`，验证完整的 stdin → stdout 协议。

### 测试场景

| 断言 | 场景 | 验证点 |
|------|------|--------|
| PostToolUse 正常 | stdin 注入 Read 输入 | exit 0, `continue: true` |
| PostToolUse wasted call | stdin 注入 wasted call | exit 0, 计数器更新 |
| PreToolUse:Read 阻断 | 先写入 5 次 wasted call，再触发 PreToolUse | exit 2, `systemMessage` |
| 无效 event | `unknown-event` | exit 0, `continue: true` |
| stdin 为空 | `null` | exit 0, `continue: true`（D5） |
| stdin 无效 JSON | `'not-json-at-all{'` | exit 0, `continue: true`（D5） |
| setup-check OK | 直接运行 setup-check.mjs | exit 0, stdout 包含 "OK" |
| index.mjs CLI | 直接运行 `node src/index.mjs post-tool-use` | exit 0, 正确处理 stdin |

## 测试设计原则

### 1. 纯函数优先

Handler 逻辑设计为纯函数（不依赖外部状态），便于单元测试：
```javascript
// handlers.mjs
export function isWastedCall(toolResponse) { /* 纯函数 */ }
export function postToolUse(input) { /* 纯函数 */ }
```

副作用（文件 I/O）集中在 `state.mjs`，通过临时目录隔离测试。

### 2. 临时目录隔离

```javascript
const testDir = join(tmpdir(), `cc-break-dead-loop-state-test-${Date.now()}`);
```

每个测试使用独立临时目录，避免交叉污染。测试结束后由 OS 自动清理。

### 3. 子进程集成测试

集成测试通过 `spawn` 启动真实子进程，验证完整的 stdin/stdout 协议：
- JSON 序列化/反序列化
- exit code 正确性
- 超时处理
- 错误降级

### 4. 并发安全验证

```javascript
const promises = Array.from({ length: 20 }, () =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve(incrementCounter(dir, params));
    }, Math.random() * 10);
  })
);
```

验证原子写入机制在并发场景下的正确性。

## 覆盖率统计

| 模块 | 测试文件 | 断言数 | 覆盖场景 |
|------|----------|--------|----------|
| `utils.mjs` | state.test.mjs | 7 | sanitizeName / getProjectName |
| `state.mjs` | state.test.mjs | 13 | 所有导出函数 |
| `handlers.mjs` | handlers.test.mjs | 18 | isWastedCall / postToolUse / preToolUseRead |
| `index.mjs` | integration.test.mjs | 3 | stdin/stdout / 错误边界 |
| `node-runner.mjs` | integration.test.mjs | 3 | 协议 / 阻断 / 错误降级 |
| `setup-check.mjs` | integration.test.mjs | 1 | 环境检测 |
| **总计** | **3 个文件** | **46** | **全部核心功能** |
