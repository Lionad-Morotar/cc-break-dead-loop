import { describe, it } from 'vitest';
import assert from 'node:assert';
import { buildSessionStartAdvice } from '../plugin/src/sessionStartAdvice.mjs';

describe('sessionStartAdvice', () => {
  const advice = buildSessionStartAdvice();

  it('引导使用 run_in_background 后台子代理', () => {
    assert.ok(advice.includes('run_in_background'));
  });

  it('说明前台同步模式会导致死循环风险', () => {
    assert.ok(advice.includes('前台'));
    assert.ok(advice.includes('死循环'));
  });

  it('文案不含开发阶段/优先级标记（仅解释 Why）', () => {
    assert.ok(!advice.includes('TODO'));
    assert.ok(!advice.includes('FIXME'));
    assert.ok(!/P[0-9]/.test(advice));
  });
});
