import { describe, it } from 'vitest';
import assert from 'node:assert';
import { detectDeadLoop } from '../plugin/src/deadLoopDetector.mjs';

describe('DeadLoopDetector', () => {
  it('空数组或长度不足 → null', () => {
    assert.strictEqual(detectDeadLoop([], 3), null);
    assert.strictEqual(detectDeadLoop([
      { toolName: 'Read', input: { file_path: '/a' } },
    ], 3), null);
  });

  it('同一工具同一参数连续重复达阈值 → 返回死循环详情', () => {
    const calls = [
      { toolName: 'Read', input: { file_path: '/a/b' } },
      { toolName: 'Read', input: { file_path: '/a/b' } },
      { toolName: 'Read', input: { file_path: '/a/b' } },
    ];

    const result = detectDeadLoop(calls, 3);

    assert.ok(result, '应检测到死循环');
    assert.strictEqual(result.toolName, 'Read');
    assert.strictEqual(result.repeatCount, 3);
  });

  it('连续重复次数恰好 threshold-1 → null', () => {
    const calls = [
      { toolName: 'Read', input: { file_path: '/a' } },
      { toolName: 'Read', input: { file_path: '/a' } },
    ];
    assert.strictEqual(detectDeadLoop(calls, 3), null);
  });

  it('同一工具但参数变化交替 → null（参数变化重置）', () => {
    const calls = [
      { toolName: 'Read', input: { file_path: '/a' } },
      { toolName: 'Read', input: { file_path: '/b' } },
      { toolName: 'Read', input: { file_path: '/a' } },
      { toolName: 'Read', input: { file_path: '/b' } },
    ];
    assert.strictEqual(detectDeadLoop(calls, 2), null);
  });

  it('不同工具交替 → null（工具变化重置）', () => {
    const calls = [
      { toolName: 'Read', input: { file_path: '/a' } },
      { toolName: 'Bash', input: { command: 'ls' } },
      { toolName: 'Read', input: { file_path: '/a' } },
      { toolName: 'Bash', input: { command: 'ls' } },
    ];
    assert.strictEqual(detectDeadLoop(calls, 2), null);
  });

  it('断点分隔连续段，跨断点的调用不计为连续重复', () => {
    // Read×2 后插入一个 Bash，再 Read×2；4 个 Read 被断点分成两段，每段 2
    const calls = [
      { toolName: 'Read', input: { file_path: '/a' } },
      { toolName: 'Read', input: { file_path: '/a' } },
      { toolName: 'Bash', input: { command: 'ls' } },
      { toolName: 'Read', input: { file_path: '/a' } },
      { toolName: 'Read', input: { file_path: '/a' } },
    ];

    const result = detectDeadLoop(calls, 2);

    assert.ok(result);
    assert.strictEqual(result.repeatCount, 2);
  });

  it('参数键序不同但内容相同 → 视为相同（指纹稳定）', () => {
    const calls = [
      { toolName: 'Read', input: { file_path: '/a', offset: 10 } },
      { toolName: 'Read', input: { offset: 10, file_path: '/a' } },
      { toolName: 'Read', input: { file_path: '/a', offset: 10 } },
    ];

    const result = detectDeadLoop(calls, 3);

    assert.ok(result, '键序不同但内容相同的参数应视为重复');
    assert.strictEqual(result.repeatCount, 3);
  });

  it('只看尾部连续段：尾部达标则报当前正在发生的死循环', () => {
    // [Read×5, Bash×3] threshold=3：尾部是 Bash×3 达标 → 报 Bash（当前正在发生的）
    const calls = [
      ...Array(5).fill({ toolName: 'Read', input: { file_path: '/a' } }),
      ...Array(3).fill({ toolName: 'Bash', input: { command: 'ls' } }),
    ];

    const result = detectDeadLoop(calls, 3);

    assert.ok(result);
    assert.strictEqual(result.toolName, 'Bash');
    assert.strictEqual(result.repeatCount, 3);
  });

  it('尾部段未达标但有历史达标段 → null（只关心当前）', () => {
    // [Read×5, Bash×1] threshold=3：尾部 Bash×1 不达标 → null
    // 即使前面 Read×5 曾达标，但当前已不在死循环，不需 intervention
    const calls = [
      ...Array(5).fill({ toolName: 'Read', input: { file_path: '/a' } }),
      { toolName: 'Bash', input: { command: 'ls' } },
    ];

    assert.strictEqual(detectDeadLoop(calls, 3), null);
  });
});
