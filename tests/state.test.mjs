import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getStateDir,
  readState,
  writeState,
  isSameReadParams,
  incrementCounter,
} from '../plugin/src/state.mjs';
import { sanitizeName, getProjectName } from '../plugin/src/utils.mjs';

describe('sanitizeName', () => {
  it('保留字母数字和连字符', () => {
    assert.strictEqual(sanitizeName('my-project_123'), 'my-project-123');
  });

  it('去除首尾连字符', () => {
    assert.strictEqual(sanitizeName('-hello-'), 'hello');
  });

  it('空结果 fallback 到 unknown', () => {
    assert.strictEqual(sanitizeName('___'), 'unknown');
    assert.strictEqual(sanitizeName(''), 'unknown');
    assert.strictEqual(sanitizeName(null), 'unknown');
  });

  it('截断到 64 字符', () => {
    const long = 'x'.repeat(100);
    assert.strictEqual(sanitizeName(long).length, 64);
  });
});

describe('getProjectName', () => {
  it('在 git 仓库中返回正确的仓库名', () => {
    // 当前目录是 git 仓库
    const name = getProjectName(process.cwd());
    assert.ok(name.length > 0);
    assert.notStrictEqual(name, 'unknown');
  });

  it('在无 git 目录中返回文件夹名', () => {
    const name = getProjectName('/tmp');
    assert.strictEqual(name, 'tmp');
  });

  it('空路径返回 unknown', () => {
    assert.strictEqual(getProjectName(''), 'unknown');
    assert.strictEqual(getProjectName(null), 'unknown');
  });
});

describe('state management', () => {
  it('getStateDir 构建正确的路径', () => {
    const dir = getStateDir('/home/user/my-project', 'sess-123', 'agent-abc', 'planner');
    assert.ok(dir.includes('my-project') || dir.includes('cc-break-dead-loop'));
    assert.ok(dir.includes('sess-123'));
    assert.ok(dir.includes('agent-abc'));
  });

  it('getStateDir agent_id 为空时使用 main', () => {
    const dir = getStateDir('/tmp', 'sess', undefined, 'type');
    assert.ok(dir.includes('main'));
  });
});

describe('readState / writeState / incrementCounter', () => {
  const testDir = join(tmpdir(), `cc-break-dead-loop-state-test-${Date.now()}`);

  it('writeState 自动创建目录', () => {
    const deepDir = join(testDir, 'a', 'b', 'c');
    writeState(deepDir, { sessionId: 's', filePath: '/f', consecutiveWastedReads: 1, lastUpdatedAt: 't' });
    assert.strictEqual(existsSync(join(deepDir, 'state.json')), true);
  });

  it('readState 读取正确', () => {
    const deepDir = join(testDir, 'a', 'b', 'c');
    const state = readState(deepDir);
    assert.strictEqual(state.sessionId, 's');
    assert.strictEqual(state.consecutiveWastedReads, 1);
  });

  it('readState 文件不存在返回 null', () => {
    const state = readState(join(testDir, 'nonexistent'));
    assert.strictEqual(state, null);
  });

  it('incrementCounter 同一参数连续调用递增', () => {
    const dir = join(testDir, 'counter-test');
    const params = { sessionId: 's', filePath: '/a/b', offset: 10, limit: 20 };
    assert.strictEqual(incrementCounter(dir, params), 1);
    assert.strictEqual(incrementCounter(dir, params), 2);
    assert.strictEqual(incrementCounter(dir, params), 3);
  });

  it('incrementCounter 参数变化后重置', () => {
    const dir = join(testDir, 'reset-test');
    const p1 = { sessionId: 's', filePath: '/a/b', offset: 10, limit: 20 };
    const p2 = { sessionId: 's', filePath: '/a/b', offset: 11, limit: 20 };
    assert.strictEqual(incrementCounter(dir, p1), 1);
    assert.strictEqual(incrementCounter(dir, p1), 2);
    assert.strictEqual(incrementCounter(dir, p2), 1);
  });

  it('incrementCounter offset undefined 和 0 视为不同（D7）', () => {
    const dir = join(testDir, 'undefined-vs-zero');
    const p1 = { sessionId: 's', filePath: '/a', offset: undefined, limit: 20 };
    const p2 = { sessionId: 's', filePath: '/a', offset: 0, limit: 20 };
    assert.strictEqual(incrementCounter(dir, p1), 1);
    assert.strictEqual(incrementCounter(dir, p1), 2);
    // offset 不同，应重置
    assert.strictEqual(incrementCounter(dir, p2), 1);
  });

  it('并发调用 incrementCounter 不会导致状态文件损坏', async () => {
    const dir = join(testDir, 'concurrent');
    const params = { sessionId: 's', filePath: '/c', offset: 0, limit: 10 };

    // 先初始化
    incrementCounter(dir, params);

    const promises = Array.from({ length: 20 }, () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(incrementCounter(dir, params));
        }, Math.random() * 10);
      })
    );

    await Promise.all(promises);
    const state = readState(dir);
    // 由于原子写入，文件应该始终是合法 JSON
    assert.ok(state);
    assert.ok(typeof state.consecutiveWastedReads === 'number');
    // 可能有些递增丢失，但文件不会损坏
    assert.ok(state.consecutiveWastedReads >= 1);
  });
});

describe('isSameReadParams', () => {
  it('相同参数返回 true', () => {
    const state = { filePath: '/a', offset: 10, limit: 20 };
    assert.strictEqual(isSameReadParams(state, '/a', 10, 20), true);
  });

  it('不同参数返回 false', () => {
    const state = { filePath: '/a', offset: 10, limit: 20 };
    assert.strictEqual(isSameReadParams(state, '/b', 10, 20), false);
    assert.strictEqual(isSameReadParams(state, '/a', 11, 20), false);
    assert.strictEqual(isSameReadParams(state, '/a', 10, 21), false);
  });

  it('undefined 和 0 视为不同', () => {
    const state = { filePath: '/a', offset: undefined, limit: 20 };
    assert.strictEqual(isSameReadParams(state, '/a', 0, 20), false);
  });

  it('null state 返回 false', () => {
    assert.strictEqual(isSameReadParams(null, '/a', 0, 20), false);
  });
});
