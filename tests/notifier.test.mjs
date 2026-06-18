import { describe, it } from 'vitest';
import assert from 'node:assert';
import { notifyDeadLoop } from '../plugin/src/notifier.mjs';

describe('notifier', () => {
  it('darwin → 调 osascript display notification，含 agentType/toolName/repeatCount', () => {
    const calls = [];
    const exec = (...args) => { calls.push(args); };
    notifyDeadLoop(
      { agentType: 'reviewer', toolName: 'Read', repeatCount: 8 },
      { exec, platform: 'darwin' },
    );

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], 'osascript');
    const script = calls[0][1][1];
    assert.ok(script.includes('display notification'), '应是 osascript 通知脚本');
    assert.ok(script.includes('reviewer'), '脚本含 agentType');
    assert.ok(script.includes('Read'), '脚本含 toolName');
    assert.ok(script.includes('8'), '脚本含 repeatCount');
  });

  it('linux → 调 notify-send', () => {
    const calls = [];
    notifyDeadLoop(
      { agentType: 'r', toolName: 'Bash', repeatCount: 5 },
      { exec: (...a) => calls.push(a), platform: 'linux' },
    );

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], 'notify-send');
  });

  it('未知平台（win32 等）→ 不调用 exec，静默跳过', () => {
    const calls = [];
    notifyDeadLoop(
      { toolName: 'Read', repeatCount: 5 },
      { exec: (...a) => calls.push(a), platform: 'win32' },
    );
    assert.strictEqual(calls.length, 0);
  });

  it('exec 抛错 → notifyDeadLoop 整体不抛（绝不影响 watcher）', () => {
    const exec = () => { throw new Error('boom'); };
    assert.doesNotThrow(() =>
      notifyDeadLoop({ toolName: 'Read', repeatCount: 5 }, { exec, platform: 'darwin' }),
    );
  });

  it('消息含双引号 → 转义，防 osascript 注入', () => {
    const calls = [];
    notifyDeadLoop(
      { agentType: 'a"x', toolName: 'Read', repeatCount: 5 },
      { exec: (...a) => calls.push(a), platform: 'darwin' },
    );
    const script = calls[0][1][1];
    // 原始裸双引号应被转义为 \"，不能出现 a"x 这样的裸引号序列
    assert.ok(script.includes('a\\"x'), '双引号应被转义为 \\"');
  });
});
