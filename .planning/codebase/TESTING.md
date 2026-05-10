# 测试模式

**分析日期:** 2026-05-10

## 测试框架

**运行器:**
- Node.js 内置 `node:test`（Node.js 18+）
- 配置：`package.json` 中 `"test": "node --test tests/**/*.test.mjs"`
- 无额外测试框架依赖

**断言库:**
- Node.js 内置 `node:assert`
- 主要使用 `assert.strictEqual`、`assert.deepStrictEqual`、`assert.ok`

**运行命令:**
```bash
node --test                    # 运行全部测试
node --test tests/state.test.mjs      # 运行单个测试文件
node --test tests/handlers.test.mjs   # 运行单个测试文件
node --test tests/integration.test.mjs # 运行单个测试文件
```

## 测试文件组织

**位置:**
- 测试文件与源码分离，统一放在 `tests/` 目录
- 命名：`{模块名}.test.mjs`，与源码模块一一对应

**结构:**
```
tests/
├── state.test.mjs         # 状态管理单元测试（20 项）
├── handlers.test.mjs      # Handler 逻辑单元测试（18 项）
└── integration.test.mjs   # 端到端集成测试（8 项）
```

## 测试结构

**套件组织:**
使用 `describe` 分组，`it` 定义具体测试用例

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('sanitizeName', () => {
  it('保留字母数字和连字符', () => {
    assert.strictEqual(sanitizeName('my-project_123'), 'my-project-123');
  });

  it('空结果 fallback 到 unknown', () => {
    assert.strictEqual(sanitizeName('___'), 'unknown');
    assert.strictEqual(sanitizeName(''), 'unknown');
    assert.strictEqual(sanitizeName(null), 'unknown');
  });
});
```

**测试用例命名:**
- 使用中文描述测试意图
- 格式：`{条件} → {预期结果}`
- 标注相关决策 ID，如 `(D6)`、`(D7)`

## Mocking

**框架:** 不使用外部 mock 框架，依赖以下策略：

**模式:**
- 使用临时目录（`os.tmpdir()`）隔离文件系统副作用
- 使用子进程 spawn 进行集成测试，模拟真实 stdin/stdout 协议
- 不 mock Node.js 内置模块，直接操作真实文件系统

**测试辅助函数:**
```javascript
// tests/handlers.test.mjs — 状态预设辅助函数
function writeTestState(count, overrides = {}) {
  const stateDir = getStateDir(baseInput.cwd, baseInput.session_id, baseInput.agent_id, baseInput.agent_type);
  writeState(stateDir, {
    sessionId: baseInput.session_id,
    filePath: '/a/b',
    offset: 10,
    limit: 20,
    consecutiveWastedReads: count,
    lastUpdatedAt: new Date().toISOString(),
    ...overrides,
  });
  return stateDir;
}
```

**What to Mock:**
- 不 mock 任何模块
- 通过临时目录隔离状态文件副作用
- 通过子进程隔离全局状态

## Fixtures and Factories

**测试数据:**
- 使用内联对象定义测试输入，不单独提取 fixture 文件
- 共享基础输入对象通过 `const baseInput = {...}` 定义

```javascript
// tests/handlers.test.mjs
const baseInput = {
  tool_name: 'Read',
  cwd: '/tmp',
  session_id: 'sess-pre',
  agent_id: 'agent-pre',
  agent_type: 'planner',
  tool_input: { file_path: '/a/b', offset: 10, limit: 20 },
};
```

**临时目录:**
- 使用 `join(tmpdir(), `cc-break-dead-loop-state-test-${Date.now()}`)` 创建隔离测试目录
- 不主动清理（依赖 OS 临时目录清理机制）

## Coverage

**要求:** 无强制覆盖率目标

**当前覆盖领域:**
| 测试领域 | 状态 | 测试文件 |
|----------|------|----------|
| 状态管理 | 已覆盖 | `tests/state.test.mjs` |
| Handler 逻辑 | 已覆盖 | `tests/handlers.test.mjs` |
| Integration（stdin/stdout） | 已覆盖 | `tests/integration.test.mjs` |

## 测试类型

**单元测试:**
- 直接导入并测试单个函数
- 覆盖边界条件、错误路径、决策验证
- 示例：`tests/state.test.mjs` 测试 `sanitizeName`、`getProjectName`、`incrementCounter`

**集成测试:**
- 通过子进程运行 `node-runner.mjs` 和 `index.mjs`，模拟完整 stdin/stdout 协议
- 验证 exit code、stdout JSON 格式、状态持久化

```javascript
// tests/integration.test.mjs — 子进程集成测试模式
function runRunner(event, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [
      join(projectRoot, 'plugin/scripts/node-runner.mjs'),
      event,
    ], { cwd: projectRoot });

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });

    child.on('close', (code) => {
      resolve({ code, stdout: stdout.trim() });
    });

    if (input) {
      child.stdin.write(JSON.stringify(input));
    }
    child.stdin.end();
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
      setTimeout(() => {
        resolve(incrementCounter(dir, params));
      }, Math.random() * 10);
    })
  );
  await Promise.all(promises);
  // 断言...
});
```

**错误路径测试:**
```javascript
it('readState 文件不存在返回 null', () => {
  const state = readState(join(testDir, 'nonexistent'));
  assert.strictEqual(state, null);
});
```

**清理（before hook）:**
```javascript
describe('preToolUseRead', () => {
  before(() => {
    const stateDir = getStateDir(...);
    try {
      rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });
});
```

---

*测试分析: 2026-05-10*
