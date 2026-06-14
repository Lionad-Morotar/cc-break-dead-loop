import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decideAction } from '../plugin/src/watcherLifecycle.mjs';

describe('WatcherLifecycle decideAction', () => {
  let heartbeatFile;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-lifecycle-'));
    heartbeatFile = join(tmpDir, 'heartbeat.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('心跳新鲜 → none（已在运行）', () => {
    writeFileSync(heartbeatFile, JSON.stringify({ pid: 12345, ts: Date.now() }));

    const action = decideAction({ heartbeatFile, staleTimeoutMs: 10_000 });

    assert.strictEqual(action, 'none');
  });

  it('心跳文件不存在 → start（首次启动）', () => {
    const action = decideAction({ heartbeatFile, staleTimeoutMs: 10_000 });
    assert.strictEqual(action, 'start');
  });

  it('心跳 ts 超时 → restart', () => {
    const staleTs = Date.now() - 60_000;
    writeFileSync(heartbeatFile, JSON.stringify({ pid: 12345, ts: staleTs }));

    const action = decideAction({ heartbeatFile, staleTimeoutMs: 10_000 });

    assert.strictEqual(action, 'restart');
  });

  it('心跳文件损坏（非 JSON）→ start（视为未运行）', () => {
    writeFileSync(heartbeatFile, 'not-json{');

    const action = decideAction({ heartbeatFile, staleTimeoutMs: 10_000 });

    assert.strictEqual(action, 'start');
  });

  it('心跳 ts 非数字 → start', () => {
    writeFileSync(heartbeatFile, JSON.stringify({ pid: 12345, ts: 'not-a-number' }));

    const action = decideAction({ heartbeatFile, staleTimeoutMs: 10_000 });

    assert.strictEqual(action, 'start');
  });
});
