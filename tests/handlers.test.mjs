import { before, describe, it } from 'node:test';
import assert from 'node:assert';
import { rmSync } from 'node:fs';
import {
  isWastedCall,
  postToolUse,
  preToolUseRead,
} from '../plugin/src/handlers.mjs';
import { getStateDir, writeState } from '../plugin/src/state.mjs';

const baseInput = {
  tool_name: 'Read',
  cwd: '/tmp',
  session_id: 'sess-pre',
  agent_id: 'agent-pre',
  agent_type: 'planner',
  tool_input: { file_path: '/a/b', offset: 10, limit: 20 },
};

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

describe('isWastedCall', () => {
  it('字符串包含 "Wasted call" → true', () => {
    assert.strictEqual(isWastedCall('Wasted call — file unchanged'), true);
  });

  it('字符串不包含 → false', () => {
    assert.strictEqual(isWastedCall('File content here'), false);
  });

  it('对象 content 字段包含 → true（D6）', () => {
    assert.strictEqual(isWastedCall({ content: 'Wasted call — file unchanged' }), true);
  });

  it('嵌套对象 JSON.stringify 兜底命中 → true（D6）', () => {
    assert.strictEqual(isWastedCall({ nested: { msg: 'Wasted call — file unchanged' } }), true);
  });

  it('null / undefined → false', () => {
    assert.strictEqual(isWastedCall(null), false);
    assert.strictEqual(isWastedCall(undefined), false);
  });

  it('数字 / 布尔 → false', () => {
    assert.strictEqual(isWastedCall(42), false);
    assert.strictEqual(isWastedCall(true), false);
  });
});

describe('postToolUse', () => {
  const postBase = {
    tool_name: 'Read',
    cwd: '/tmp',
    session_id: 'sess-post',
    agent_id: 'agent-post',
    agent_type: 'planner',
    tool_input: { file_path: '/a/b', offset: 10, limit: 20 },
  };

  it('正常内容 → 不操作计数器', () => {
    const result = postToolUse({
      ...postBase,
      tool_response: '正常文件内容',
    });
    assert.deepStrictEqual(result, { continue: true, suppressOutput: true });
  });

  it('toolName 不为 Read → 不操作', () => {
    const result = postToolUse({
      ...postBase,
      tool_name: 'Bash',
      tool_response: 'Wasted call — file unchanged',
    });
    assert.deepStrictEqual(result, { continue: true, suppressOutput: true });
  });

  it('tool_input 缺少 file_path → 静默跳过', () => {
    const result = postToolUse({
      ...postBase,
      tool_input: { offset: 10 },
      tool_response: 'Wasted call — file unchanged',
    });
    assert.deepStrictEqual(result, { continue: true, suppressOutput: true });
  });

  it('字符串 wasted call → 计数器递增', () => {
    const result = postToolUse({
      ...postBase,
      tool_response: 'Wasted call — file unchanged since your last Read',
    });
    assert.deepStrictEqual(result, { continue: true, suppressOutput: true });
  });

  it('对象 content wasted call → 计数器递增（D6）', () => {
    const result = postToolUse({
      ...postBase,
      tool_response: { content: 'Wasted call — file unchanged' },
    });
    assert.deepStrictEqual(result, { continue: true, suppressOutput: true });
  });

  it('嵌套对象 wasted call → 计数器递增（D6）', () => {
    const result = postToolUse({
      ...postBase,
      tool_response: { nested: { msg: 'Wasted call — file unchanged' } },
    });
    assert.deepStrictEqual(result, { continue: true, suppressOutput: true });
  });
});

describe('preToolUseRead', () => {
  before(() => {
    // 清理之前测试运行可能遗留的状态文件
    const stateDir = getStateDir(baseInput.cwd, baseInput.session_id, baseInput.agent_id, baseInput.agent_type);
    try {
      rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  it('状态文件不存在 → 放行', () => {
    const result = preToolUseRead(baseInput);
    assert.deepStrictEqual(result, { continue: true, suppressOutput: true });
  });

  it('计数器 = 2，参数匹配 → 放行', () => {
    writeTestState(2);
    const result = preToolUseRead(baseInput);
    assert.deepStrictEqual(result, { continue: true, suppressOutput: true });
  });

  it('计数器 = 3，参数匹配 → 注入 additionalContext 警告', () => {
    writeTestState(3);
    const result = preToolUseRead(baseInput);
    assert.strictEqual(result.continue, true);
    assert.strictEqual(result.suppressOutput, false);
    assert.ok(result.hookSpecificOutput);
    assert.strictEqual(result.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.ok(result.hookSpecificOutput.additionalContext.includes('文件未改动'));
    assert.strictEqual(result.hookSpecificOutput.permissionDecision, 'allow');
  });

  it('计数器 = 5，参数匹配 → 返回阻断标记', () => {
    writeTestState(5);

    const result = preToolUseRead(baseInput);

    assert.strictEqual(result.shouldBlock, true);
    assert.ok(result.systemMessage.includes('cc-break-dead-loop'));
    assert.ok(result.systemMessage.includes('文件未改动'));
  });

  it('计数器 = 5，但 Read 参数已变化 → 放行（D7）', () => {
    writeTestState(5, { offset: undefined });

    // 传入 offset: 0，与状态中的 undefined 不同
    const result = preToolUseRead({
      ...baseInput,
      tool_input: { file_path: '/a/b', offset: 0, limit: 20 },
    });
    assert.deepStrictEqual(result, { continue: true, suppressOutput: true });
  });

  it('阻断文案明确包含 "文件未改动" 相关提示', () => {
    writeTestState(5);

    const result = preToolUseRead(baseInput);

    assert.ok(result.systemMessage.includes('文件未改动'));
    assert.ok(result.systemMessage.includes('请使用之前的读取结果') || result.systemMessage.includes('不要再重复 Read'));
  });
});
