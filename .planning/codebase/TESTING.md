# 测试模式

**分析日期:** 2026-06-14

## 测试框架

**运行器:**
- Vitest ^4.1.8（devDependency）
- 配置：`package.json` 中 `"test": "vitest run"`，`vitest.config.mjs` 中 `include: ['tests/**/*.test.mjs']`
- 从 `node:test` 迁移而来（迁移动机：watcher 测试需要 fake timers + 模块 mock，`node:test` 无内置支持）

**断言库:**
- 仍使用 Node.js 内置 `node:assert`（仅迁移测试运行器，断言库未换）
- 主要使用 `assert.strictEqual`、`assert.deepStrictEqual`、`assert.ok`、`assert.rejects`、`assert.doesNotReject`

**运行命令:**
```bash
npm test                           # vitest run（CI / 单次运行）
npm run test:watch                 # vitest（watch 模式，TDD）
npx vitest run tests/state.test.mjs      # 单文件
npx vitest run tests/watcher.test.mjs    # 单文件
npx vitest -t "sanitizeName"             # 按测试名过滤
```

## 测试文件组织

**位置:**
- 测试文件与源码分离，统一放在 `tests/` 目录
- 命名：`{模块名}.test.mjs`，与源码模块一一对应

**结构（15 文件 / 135 用例）:**
```
tests/
├── state.test.mjs                    # 状态管理（主 agent 计数器）
├── handlers.test.mjs                 # Handler 逻辑（isWastedCall 多模式、deny+additionalContext）
├── integration.test.mjs              # 端到端 stdin/stdout 协议
├── watcher.test.mjs                  # watcher 扫描协调（fake timers + 真实 tmp fs）
├── watcherLifecycle.test.mjs         # 进程决策与 spawn（mock child_process）
├── alertStore.test.mjs               # 告警读写、并发、session 隔离
├── deadLoopDetector.test.mjs         # 检测算法（尾部连续重复、稳定序列化指纹）
├── hookInjector.test.mjs             # 注入措辞、最严重告警选取
├── subagentTranscriptReader.test.mjs # jsonl 解析容错
└── cli/                              # CLI 单元测试
    ├── index.test.mjs                # 参数解析、帮助、版本
    ├── install.test.mjs              # 安装流程、覆盖安装、格式校验
    ├── uninstall.test.mjs            # 卸载、--purge
    ├── status.test.mjs               # 状态查询
    ├── paths.test.mjs                # 路径常量
    └── fs.test.mjs                   # 文件操作工具
```

## 测试结构

**套件组织:**
使用 `describe` 分组，`it` / `test` 定义用例，钩子用 `before` / `beforeEach` / `afterEach`

```javascript
import { beforeAll, describe, it } from 'vitest';
import assert from 'node:assert';

describe('isWastedCall', () => {
  it('字符串包含 "Wasted call" → true', () => {
    assert.strictEqual(isWastedCall('Wasted call — file unchanged'), true);
  });
});
```

**测试用例命名:**
- 中文描述测试意图，格式 `{条件} → {预期结果}`
- 标注决策 ID，如 `(D6)`、`(D7)`、`(W4)`

## Mocking

**框架:** Vitest 内置 `vi`（`vi.useFakeTimers`、`vi.mock`、`vi.fn`、`vi.spyOn`）

**策略分层:**

| 测试对象 | 策略 | 说明 |
|----------|------|------|
| 纯函数（detector、handlers、injector）| 不 mock | 直接测真实逻辑 |
| 文件系统（state、alertStore）| 真实 tmp 目录 | `mkdtempSync(tmpdir())` 隔离，不 mock fs |
| watcher（含 setInterval）| `vi.useFakeTimers` + 真实 tmp fs | 手动推进时间触发 `scanOnce`，jsonl 写真实 tmp 目录 |
| watcherLifecycle（spawn）| `vi.mock('node:child_process')` | mock `spawn` 返回假 child，验证 detached/unref/PID 写入 |
| CLI 命令 | 真实 tmp `CLAUDE_CONFIG_DIR` | `process.env.CLAUDE_CONFIG_DIR = tmpDir` 隔离 |

**watcher fake timers 模式:**
```javascript
import { describe, it, beforeEach, afterEach, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it('定时扫描检测死循环', () => {
  const watcher = createWatcher({ projectsDir: tmpDir, ... });
  watcher.start(5000);
  // 写入死循环 jsonl 后，手动推进时间触发扫描
  vi.advanceTimersByTime(5000);
  const alerts = getAlertsForSession(alertsFile, sessionId);
  assert.ok(alerts.length > 0);
});
```

**lifecycle spawn mock 模式:**
```javascript
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ pid: 12345, unref: () => {} })),
}));
```

## Fixtures and Factories

**测试数据:** 内联对象，不单独提取 fixture 文件

```javascript
// tests/handlers.test.mjs — 共享基础输入
const baseInput = {
  tool_name: 'Read',
  cwd: '/tmp',
  session_id: 'sess-pre',
  agent_id: 'agent-pre',
  agent_type: 'planner',
  tool_input: { file_path: '/a/b', offset: 10, limit: 20 },
};
```

**transcript 构造辅助（watcher 测试）:**
```javascript
// tests/watcher.test.mjs — 构造 assistant tool_use 行
function assistantLine(toolName, input) {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: `tu-${Math.random()}`, name: toolName, input }] },
  });
}

// 在 tmpDir 下构造 projects/<proj>/<session>/subagents/agent-<id>.jsonl
function writeAgentJsonl(root, project, session, agentId, lines) { ... }
```

**临时目录:** `join(tmpdir(), \`cc-break-dead-loop-<scope>-test-${Date.now()}\`)`，不主动清理

## Coverage

**要求:** 无强制覆盖率目标

**当前覆盖领域:**

| 测试领域 | 状态 | 测试文件 |
|----------|------|----------|
| 状态管理（主 agent）| 已覆盖 | `tests/state.test.mjs` |
| Handler 逻辑（主 agent）| 已覆盖 | `tests/handlers.test.mjs` |
| Integration（stdin/stdout）| 已覆盖 | `tests/integration.test.mjs` |
| watcher 扫描协调 | 已覆盖 | `tests/watcher.test.mjs` |
| watcher 生命周期 | 已覆盖 | `tests/watcherLifecycle.test.mjs` |
| 告警存储 | 已覆盖 | `tests/alertStore.test.mjs` |
| 死循环检测算法 | 已覆盖 | `tests/deadLoopDetector.test.mjs` |
| Hook 注入逻辑 | 已覆盖 | `tests/hookInjector.test.mjs` |
| transcript 解析 | 已覆盖 | `tests/subagentTranscriptReader.test.mjs` |
| CLI（install/uninstall/status/paths/fs/index）| 已覆盖 | `tests/cli/*.test.mjs` |

## 测试类型

**单元测试:**
- 直接导入测试纯函数（detector、handlers、injector、alertStore、state）
- 覆盖边界条件、错误路径、决策验证

**集成测试:**
- `integration.test.mjs`：子进程运行 `node-runner.mjs` / `index.mjs`，模拟完整 stdin/stdout 协议，验证 Stop `exit(2)` 阻断、`permissionDecision: 'deny'` 响应、状态持久化

```javascript
function runRunner(event, input) {
  return new Promise((resolve) => {
    const child = spawn('node', [join(projectRoot, 'plugin/scripts/node-runner.mjs'), event], { cwd: projectRoot });
    // ...收集 stdout，返回 { code, stdout }
  });
}
```

**E2E 测试:** 无（依赖 Claude Code 运行环境）

## 常见模式

**异步测试:**
```javascript
it('并发调用 incrementCounter 不会导致状态文件损坏', async () => {
  const promises = Array.from({ length: 20 }, () =>
    new Promise((resolve) => {
      setTimeout(() => resolve(incrementCounter(dir, params)), Math.random() * 10);
    })
  );
  await Promise.all(promises);
  const state = readState(dir);
  assert.ok(state && typeof state.consecutiveWastedReads === 'number');
});
```

**错误路径测试:**
```javascript
it('readState 文件不存在返回 null', () => {
  assert.strictEqual(readState(join(testDir, 'nonexistent')), null);
});
```

**before 钩子清理:**
```javascript
describe('preToolUseRead', () => {
  beforeAll(() => {
    const stateDir = getStateDir(...);
    try { rmSync(stateDir, { recursive: true, force: true }); } catch {}
  });
});
```

**fake timers + 手动推进（watcher）:**
```javascript
beforeEach(() => vi.useFakeTimers());
it('心跳过期触发 restart', () => { ... vi.advanceTimersByTime(...) });
```

---

*测试分析: 2026-06-14*
