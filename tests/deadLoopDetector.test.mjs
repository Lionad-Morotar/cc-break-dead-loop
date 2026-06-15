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

  it('Bash description 递增但 command 相同 → 视为死循环（指纹忽略注释字段）', () => {
    // 真实场景：子代理给重复 Bash 加 "poll 1/2/3..." 递增 description
    // 若指纹含 description，每次指纹不同，会绕过检测
    const cmd = "bash -c 'sleep 2; echo poll'";
    const calls = Array.from({ length: 5 }, (_, i) => ({
      toolName: 'Bash',
      input: { command: cmd, description: `poll ${i + 1}` },
    }));
    const result = detectDeadLoop(calls, 5);
    assert.ok(result, 'description 递增不应绕过检测，command 相同即死循环');
    assert.strictEqual(result.toolName, 'Bash');
    assert.strictEqual(result.repeatCount, 5);
    assert.ok(!result.paramFingerprint.includes('description'), '指纹应不含 description 字段');
    assert.ok(result.paramFingerprint.includes('command'), '指纹应含 command');
  });

  it('未注册工具 → 兜底全字段指纹（保持旧行为，不漏检）', () => {
    // 未在白名单注册的工具（如自定义 MCP 工具）：兜底用全部 input 字段
    const diffMeta = Array.from({ length: 3 }, (_, i) => ({
      toolName: 'mcp_custom__tool',
      input: { query: 'same', meta: `attempt ${i + 1}` },
    }));
    // meta 不同 → 全字段指纹不同 → 不触发（保持旧行为，避免误报）
    assert.strictEqual(detectDeadLoop(diffMeta, 3), null);

    const sameMeta = Array(3).fill({
      toolName: 'mcp_custom__tool',
      input: { query: 'same', meta: 'fixed' },
    });
    assert.ok(detectDeadLoop(sameMeta, 3), '全字段相同时应触发');
  });
});
