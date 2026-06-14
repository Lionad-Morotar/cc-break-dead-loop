import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addAlert, removeAlert, getAlertsForSession } from '../plugin/src/alertStore.mjs';

describe('AlertStore', () => {
  let alertsFile;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-alerts-'));
    alertsFile = join(tmpDir, 'alerts.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addAlert 写入后能按 session 读到', () => {
    const alert = {
      taskId: 'agent-1',
      sessionId: 'sess-1',
      toolName: 'Read',
      paramFingerprint: 'file=/a',
      repeatCount: 5,
      detectedAt: '2026-06-14T10:00:00Z',
    };

    addAlert(alertsFile, alert);
    const result = getAlertsForSession(alertsFile, 'sess-1');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].taskId, 'agent-1');
  });

  it('文件不存在 → getAlertsForSession 返回空数组', () => {
    assert.deepStrictEqual(getAlertsForSession(alertsFile, 'sess-x'), []);
  });

  it('同 taskId 再次 addAlert → 覆盖而非重复', () => {
    addAlert(alertsFile, { taskId: 'agent-1', sessionId: 'sess-1', toolName: 'Read', paramFingerprint: 'f', repeatCount: 3, detectedAt: 't1' });
    addAlert(alertsFile, { taskId: 'agent-1', sessionId: 'sess-1', toolName: 'Read', paramFingerprint: 'f', repeatCount: 7, detectedAt: 't2' });

    const result = getAlertsForSession(alertsFile, 'sess-1');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].repeatCount, 7);
  });

  it('removeAlert 删除指定 taskId', () => {
    addAlert(alertsFile, { taskId: 'agent-1', sessionId: 'sess-1', toolName: 'Read', paramFingerprint: 'f', repeatCount: 3, detectedAt: 't' });
    addAlert(alertsFile, { taskId: 'agent-2', sessionId: 'sess-1', toolName: 'Bash', paramFingerprint: 'g', repeatCount: 3, detectedAt: 't' });

    removeAlert(alertsFile, 'agent-1');

    const result = getAlertsForSession(alertsFile, 'sess-1');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].taskId, 'agent-2');
  });

  it('getAlertsForSession 按 sessionId 过滤，跨 session 不串扰', () => {
    addAlert(alertsFile, { taskId: 'agent-1', sessionId: 'sess-A', toolName: 'Read', paramFingerprint: 'f', repeatCount: 3, detectedAt: 't' });
    addAlert(alertsFile, { taskId: 'agent-2', sessionId: 'sess-B', toolName: 'Read', paramFingerprint: 'f', repeatCount: 3, detectedAt: 't' });

    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-A').length, 1);
    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-B').length, 1);
    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-A')[0].taskId, 'agent-1');
  });

  it('getAlertsForSession 传 agentId 时按 taskId 再过滤', () => {
    addAlert(alertsFile, { taskId: 'agent-1', sessionId: 'sess-1', toolName: 'Read', paramFingerprint: 'f', repeatCount: 3, detectedAt: 't' });
    addAlert(alertsFile, { taskId: 'agent-2', sessionId: 'sess-1', toolName: 'Read', paramFingerprint: 'f', repeatCount: 3, detectedAt: 't' });

    const result = getAlertsForSession(alertsFile, 'sess-1', 'agent-2');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].taskId, 'agent-2');
  });

  it('损坏的 JSON 文件 → 降级返回空数组', () => {
    writeFileSync(alertsFile, 'not-json{broken', 'utf8');
    assert.deepStrictEqual(getAlertsForSession(alertsFile, 'sess-1'), []);
  });

  it('并发 addAlert 不损坏文件（原子写）', async () => {
    const promises = Array.from({ length: 20 }, (_, i) =>
      new Promise((resolve) => {
        setTimeout(() => {
          addAlert(alertsFile, {
            taskId: `agent-${i}`,
            sessionId: 'sess-1',
            toolName: 'Read',
            paramFingerprint: 'f',
            repeatCount: 3,
            detectedAt: 't',
          });
          resolve();
        }, Math.random() * 10);
      }),
    );

    await Promise.all(promises);

    // 文件应始终是合法 JSON；upsert 保证无重复 taskId
    // 并发 read-modify-write 可能丢失部分写入，但文件不会损坏
    const result = getAlertsForSession(alertsFile, 'sess-1');
    assert.ok(result.length > 0, '至少有一条告警存活');
    const taskIds = result.map((a) => a.taskId);
    assert.strictEqual(taskIds.length, new Set(taskIds).size, '无重复 taskId');
  });
});
