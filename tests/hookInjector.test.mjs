import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addAlert } from '../plugin/src/alertStore.mjs';
import { buildInjection } from '../plugin/src/hookInjector.mjs';

describe('HookInjector', () => {
  let alertsFile;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-inject-'));
    alertsFile = join(tmpDir, 'alerts.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('PostToolUse + 有告警 → additionalContext 含 taskId 与强硬措辞', () => {
    addAlert(alertsFile, {
      taskId: 'agent-1',
      sessionId: 'sess-1',
      toolName: 'Read',
      paramFingerprint: 'file=/a',
      repeatCount: 7,
      detectedAt: 't',
    });

    const result = buildInjection({ filePath: alertsFile, sessionId: 'sess-1', event: 'PostToolUse' });

    assert.ok(result, '应返回注入内容');
    assert.ok(result.additionalContext, 'PostToolUse 应返回 additionalContext');
    assert.ok(result.additionalContext.includes('agent-1'), '含 taskId');
    assert.ok(result.additionalContext.includes('TaskStopTool'), '含调用指令');
    assert.ok(result.additionalContext.includes('7'), '含 repeatCount');
  });

  it('PostToolUse + 无告警 → null', () => {
    const result = buildInjection({ filePath: alertsFile, sessionId: 'sess-1', event: 'PostToolUse' });
    assert.strictEqual(result, null);
  });

  it('Stop + 有告警 → blockingError 强制 continue 措辞', () => {
    addAlert(alertsFile, {
      taskId: 'agent-1',
      sessionId: 'sess-1',
      toolName: 'Grep',
      paramFingerprint: 'pattern=x',
      repeatCount: 5,
      detectedAt: 't',
    });

    const result = buildInjection({ filePath: alertsFile, sessionId: 'sess-1', event: 'Stop' });

    assert.ok(result);
    assert.ok(result.blockingError, 'Stop 应返回 blockingError');
    assert.ok(result.blockingError.includes('TaskStopTool'));
    assert.ok(result.blockingError.includes('不能在此结束 turn'), '强制 continue 语气');
  });

  it('Stop + 无告警 → null', () => {
    const result = buildInjection({ filePath: alertsFile, sessionId: 'sess-1', event: 'Stop' });
    assert.strictEqual(result, null);
  });

  it('多告警 → 返回 repeatCount 最大的（最严重先杀）', () => {
    addAlert(alertsFile, { taskId: 'agent-1', sessionId: 'sess-1', toolName: 'Read', paramFingerprint: 'f', repeatCount: 3, detectedAt: 't' });
    addAlert(alertsFile, { taskId: 'agent-2', sessionId: 'sess-1', toolName: 'Bash', paramFingerprint: 'g', repeatCount: 9, detectedAt: 't' });

    const result = buildInjection({ filePath: alertsFile, sessionId: 'sess-1', event: 'PostToolUse' });

    assert.ok(result);
    assert.ok(result.additionalContext.includes('agent-2'), '应选 repeatCount=9 的 agent-2');
    assert.ok(result.additionalContext.includes('9'));
  });

  it('只报当前 session 的告警，跨 session 不串扰', () => {
    addAlert(alertsFile, { taskId: 'agent-1', sessionId: 'sess-A', toolName: 'Read', paramFingerprint: 'f', repeatCount: 5, detectedAt: 't' });
    addAlert(alertsFile, { taskId: 'agent-2', sessionId: 'sess-B', toolName: 'Read', paramFingerprint: 'f', repeatCount: 5, detectedAt: 't' });

    const result = buildInjection({ filePath: alertsFile, sessionId: 'sess-A', event: 'PostToolUse' });

    assert.ok(result);
    assert.ok(result.additionalContext.includes('agent-1'));
    assert.ok(!result.additionalContext.includes('agent-2'));
  });

  it('措辞包含可直接调用的 task_id 参数', () => {
    addAlert(alertsFile, { taskId: 'agent-xyz', sessionId: 'sess-1', toolName: 'Read', paramFingerprint: 'f', repeatCount: 5, detectedAt: 't' });

    const result = buildInjection({ filePath: alertsFile, sessionId: 'sess-1', event: 'PostToolUse' });

    assert.ok(result.additionalContext.includes('TaskStopTool(task_id="agent-xyz")'));
  });
});
