import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWatcher } from '../plugin/src/watcher.mjs';
import { getAlertsForSession } from '../plugin/src/alertStore.mjs';

/** 构造 assistant tool_use 行 */
function assistantLine(toolName, input) {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: `tu-${Math.random()}`, name: toolName, input }] },
  });
}

/** 在 tmpDir 下构造 projects/<proj>/<session>/subagents/agent-<id>.jsonl */
function writeAgentJsonl(root, project, session, agentId, lines) {
  const dir = join(root, project, session, 'subagents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-${agentId}.jsonl`), lines.join('\n') + '\n');
  return join(dir, `agent-${agentId}.jsonl`);
}

describe('Watcher', () => {
  let projectsDir;
  let alertsFile;
  let heartbeatFile;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-watcher-'));
    projectsDir = join(tmpDir, 'projects');
    alertsFile = join(tmpDir, 'alerts.json');
    heartbeatFile = join(tmpDir, 'heartbeat.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scanOnce 检测到死循环 jsonl → 写告警', () => {
    const deadLoop = Array(6).fill(assistantLine('Read', { file_path: '/a' }));
    writeAgentJsonl(projectsDir, 'proj-1', 'sess-1', 'abc', deadLoop);

    const watcher = createWatcher({
      projectsDir,
      alertsFile,
      heartbeatFile,
      windowSize: 20,
      threshold: 5,
    });

    watcher.scanOnce();

    const alerts = getAlertsForSession(alertsFile, 'sess-1');
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].taskId, 'abc');
    assert.strictEqual(alerts[0].toolName, 'Read');
    assert.strictEqual(alerts[0].repeatCount, 6);
  });

  it('scanOnce 无死循环 jsonl → 不写告警', () => {
    // 3 个不同参数的 Read，threshold=5 不触发
    writeAgentJsonl(projectsDir, 'proj-1', 'sess-1', 'abc', [
      assistantLine('Read', { file_path: '/a' }),
      assistantLine('Read', { file_path: '/b' }),
      assistantLine('Read', { file_path: '/c' }),
    ]);

    const watcher = createWatcher({ projectsDir, alertsFile, heartbeatFile, windowSize: 20, threshold: 5 });
    watcher.scanOnce();

    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-1').length, 0);
  });

  it('scanOnce 多 agent 各自独立检测', () => {
    writeAgentJsonl(projectsDir, 'proj-1', 'sess-1', 'agent-dead', Array(6).fill(assistantLine('Read', { file_path: '/a' })));
    writeAgentJsonl(projectsDir, 'proj-1', 'sess-1', 'agent-ok', [
      assistantLine('Bash', { command: 'ls' }),
      assistantLine('Bash', { command: 'pwd' }),
    ]);

    const watcher = createWatcher({ projectsDir, alertsFile, heartbeatFile, windowSize: 20, threshold: 5 });
    watcher.scanOnce();

    const alerts = getAlertsForSession(alertsFile, 'sess-1');
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].taskId, 'agent-dead');
  });

  it('之前死循环、现在恢复 → removeAlert 清除残留', () => {
    // 第一次扫描：死循环
    const jsonlPath = writeAgentJsonl(projectsDir, 'proj-1', 'sess-1', 'abc', Array(6).fill(assistantLine('Read', { file_path: '/a' })));
    const watcher = createWatcher({ projectsDir, alertsFile, heartbeatFile, windowSize: 20, threshold: 5 });
    watcher.scanOnce();
    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-1').length, 1);

    // 模拟子 Agent 恢复：追加不同参数的 tool_use 打断死循环
    writeFileSync(jsonlPath, [
      ...Array(6).fill(assistantLine('Read', { file_path: '/a' })),
      assistantLine('Bash', { command: 'ls' }),
    ].join('\n') + '\n');

    watcher.scanOnce();
    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-1').length, 0, '恢复后告警应清除');
  });

  it('scanOnce 写入心跳文件', () => {
    const watcher = createWatcher({ projectsDir, alertsFile, heartbeatFile, windowSize: 20, threshold: 5 });
    watcher.scanOnce();

    assert.strictEqual(existsSync(heartbeatFile), true);
    const hb = JSON.parse(readFileSync(heartbeatFile, 'utf8'));
    assert.ok(typeof hb.pid === 'number');
    assert.ok(typeof hb.ts === 'number');
  });

  it('无死循环时心跳仍写入（不依赖 alertStore 先建目录）', () => {
    // 无 jsonl，scanOnce 不触发 addAlert（不建 data 目录），但心跳必须写入
    const watcher = createWatcher({ projectsDir, alertsFile, heartbeatFile, windowSize: 20, threshold: 5 });
    watcher.scanOnce();

    assert.strictEqual(existsSync(heartbeatFile), true, '心跳文件应独立创建');
  });

  it('路径解析：从多项目多 session 结构正确提取 agentId/sessionId', () => {
    writeAgentJsonl(projectsDir, 'proj-alpha', 'sess-X', 'agent-1', Array(6).fill(assistantLine('Grep', { pattern: 'x' })));
    writeAgentJsonl(projectsDir, 'proj-beta', 'sess-Y', 'agent-2', Array(6).fill(assistantLine('Bash', { command: 'ls' })));

    const watcher = createWatcher({ projectsDir, alertsFile, heartbeatFile, windowSize: 20, threshold: 5 });
    watcher.scanOnce();

    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-X').length, 1);
    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-Y').length, 1);
    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-X')[0].taskId, 'agent-1');
  });

  it('start/stop 按 interval 定时扫描', async () => {
    vi.useFakeTimers();
    const deadLoop = Array(6).fill(assistantLine('Read', { file_path: '/a' }));
    writeAgentJsonl(projectsDir, 'proj-1', 'sess-1', 'abc', deadLoop);

    const watcher = createWatcher({ projectsDir, alertsFile, heartbeatFile, windowSize: 20, threshold: 5 });
    watcher.start(1000);

    // 初始无告警（start 不立即扫描）
    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-1').length, 0);

    await vi.advanceTimersByTimeAsync(1000);
    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-1').length, 1, '1s 后应扫描到');

    watcher.stop();
    vi.useRealTimers();
  });
});
