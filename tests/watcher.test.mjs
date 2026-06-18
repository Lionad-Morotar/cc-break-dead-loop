import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWatcher } from '../plugin/src/watcher.mjs';
import { getAlertsForSession, addAlert } from '../plugin/src/alertStore.mjs';

/** 构造 assistant tool_use 行（可选 timestamp） */
function assistantLine(toolName, input, timestamp) {
  const obj = {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: `tu-${Math.random()}`, name: toolName, input }] },
  };
  if (timestamp) obj.timestamp = timestamp;
  return JSON.stringify(obj);
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

  it('jsonl 末行 timestamp 距今 > staleMs → 视为停滞，不写告警', () => {
    const staleTs = new Date(Date.now() - 60_000).toISOString(); // 1 分钟前
    const deadLoop = Array(6).fill(assistantLine('Read', { file_path: '/a' }, staleTs));
    writeAgentJsonl(projectsDir, 'proj-1', 'sess-1', 'stale-agent', deadLoop);

    const watcher = createWatcher({
      projectsDir, alertsFile, heartbeatFile,
      windowSize: 20, threshold: 5, staleMs: 15_000,
    });
    watcher.scanOnce();

    assert.strictEqual(
      getAlertsForSession(alertsFile, 'sess-1').length,
      0,
      '停滞子 agent（最后活动 > 15s）不应报',
    );
  });

  it('jsonl 末行 timestamp 距今 ≤ staleMs → 活跃，正常报死循环', () => {
    const freshTs = new Date(Date.now() - 1_000).toISOString(); // 1 秒前
    const deadLoop = Array(6).fill(assistantLine('Read', { file_path: '/a' }, freshTs));
    writeAgentJsonl(projectsDir, 'proj-1', 'sess-1', 'fresh-agent', deadLoop);

    const watcher = createWatcher({
      projectsDir, alertsFile, heartbeatFile,
      windowSize: 20, threshold: 5, staleMs: 15_000,
    });
    watcher.scanOnce();

    const alerts = getAlertsForSession(alertsFile, 'sess-1');
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].taskId, 'fresh-agent');
  });

  it('之前活跃告警、现在停滞 → removeAlert 清除', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T10:00:00Z'));

    const freshTs = new Date(Date.now() - 1_000).toISOString(); // 09:59:59
    writeAgentJsonl(
      projectsDir, 'proj-1', 'sess-1', 'gone-stale',
      Array(6).fill(assistantLine('Read', { file_path: '/a' }, freshTs)),
    );

    const watcher = createWatcher({
      projectsDir, alertsFile, heartbeatFile,
      windowSize: 20, threshold: 5, staleMs: 15_000,
    });
    watcher.scanOnce(); // now=10:00:00, lastTs=09:59:59, 1s < 15s → 活跃 → 报
    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-1').length, 1);

    // 时间推进 20s，jsonl 不变但 lastTs 距今 21s > 15s → 停滞
    vi.setSystemTime(new Date('2026-06-14T10:00:20Z'));
    watcher.scanOnce();

    assert.strictEqual(
      getAlertsForSession(alertsFile, 'sess-1').length,
      0,
      '停滞后告警应清除',
    );
    vi.useRealTimers();
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

  it('watcher 启动时从 alerts.json 初始化，清除重启遗留的幽灵告警', () => {
    // 预写一条幽灵告警（模拟旧 watcher 留下、子 agent 早已停滞）
    addAlert(alertsFile, {
      taskId: 'ghost',
      sessionId: 'sess-1',
      toolName: 'Read',
      paramFingerprint: 'f',
      repeatCount: 20,
      detectedAt: new Date().toISOString(),
    });
    // ghost 对应 jsonl：死循环内容 + 很旧的 timestamp（停滞）
    const staleTs = new Date(Date.now() - 60_000).toISOString();
    writeAgentJsonl(
      projectsDir, 'proj-1', 'sess-1', 'ghost',
      Array(6).fill(assistantLine('Read', { file_path: '/a' }, staleTs)),
    );

    // 新 watcher 启动：previousDeadLoopIds 从 alerts.json 初始化 = {ghost}
    const watcher = createWatcher({
      projectsDir, alertsFile, heartbeatFile,
      windowSize: 20, threshold: 5, staleMs: 15_000,
    });
    watcher.scanOnce(); // ghost 停滞 → 移出 currentDeadLoops → removeAlert

    assert.strictEqual(getAlertsForSession(alertsFile, 'sess-1').length, 0, '幽灵告警应清除');
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

  it('活跃死循环首次扫描 → 触发一次桌面通知，第二次扫描防抖', () => {
    const freshTs = new Date(Date.now() - 1_000).toISOString();
    writeAgentJsonl(
      projectsDir, 'proj', 'sess', 'agent-notify',
      Array(6).fill(assistantLine('Read', { file_path: '/a' }, freshTs)),
    );
    const calls = [];
    const watcher = createWatcher({
      projectsDir, alertsFile, heartbeatFile,
      windowSize: 20, threshold: 5, staleMs: 15_000,
      notify: (info) => calls.push(info),
    });

    watcher.scanOnce();
    assert.strictEqual(calls.length, 1, '首次发现应通知');
    assert.strictEqual(calls[0].agentType, 'agent-notify');
    assert.strictEqual(calls[0].toolName, 'Read');

    watcher.scanOnce();
    assert.strictEqual(calls.length, 1, '同 agent 防抖，不再通知');
  });

  it('死循环消失后重新出现 → 防抖重置，能再次通知', () => {
    const freshTs = new Date(Date.now() - 1_000).toISOString();
    const jsonlPath = writeAgentJsonl(
      projectsDir, 'proj', 'sess', 'agent-rebind',
      Array(6).fill(assistantLine('Read', { file_path: '/a' }, freshTs)),
    );
    const calls = [];
    const watcher = createWatcher({
      projectsDir, alertsFile, heartbeatFile,
      windowSize: 20, threshold: 5, staleMs: 15_000,
      notify: (info) => calls.push(info),
    });

    watcher.scanOnce();
    assert.strictEqual(calls.length, 1);

    // 恢复：追加 Bash 打断死循环 → 消失 → 防抖重置
    writeFileSync(
      jsonlPath,
      [...Array(6).fill(assistantLine('Read', { file_path: '/a' }, freshTs)), assistantLine('Bash', { command: 'ls' })].join('\n') + '\n',
    );
    watcher.scanOnce();
    assert.strictEqual(calls.length, 1, '恢复期间不通知');

    // 再次死循环 → 重新通知
    writeFileSync(jsonlPath, Array(6).fill(assistantLine('Read', { file_path: '/a' }, freshTs)).join('\n') + '\n');
    watcher.scanOnce();
    assert.strictEqual(calls.length, 2, '重新出现应再次通知');
  });

  it('停滞子 agent（isStale）→ 不通知', () => {
    const staleTs = new Date(Date.now() - 60_000).toISOString();
    writeAgentJsonl(
      projectsDir, 'proj', 'sess', 'agent-stale',
      Array(6).fill(assistantLine('Read', { file_path: '/a' }, staleTs)),
    );
    const calls = [];
    const watcher = createWatcher({
      projectsDir, alertsFile, heartbeatFile,
      windowSize: 20, threshold: 5, staleMs: 15_000,
      notify: (info) => calls.push(info),
    });

    watcher.scanOnce();
    assert.strictEqual(calls.length, 0, '停滞子 agent 不应通知');
  });

  it('notifyEnabled=false → 即使活跃死循环也不通知', () => {
    const freshTs = new Date(Date.now() - 1_000).toISOString();
    writeAgentJsonl(
      projectsDir, 'proj', 'sess', 'agent-muted',
      Array(6).fill(assistantLine('Read', { file_path: '/a' }, freshTs)),
    );
    const calls = [];
    const watcher = createWatcher({
      projectsDir, alertsFile, heartbeatFile,
      windowSize: 20, threshold: 5, staleMs: 15_000,
      notify: (info) => calls.push(info),
      notifyEnabled: false,
    });

    watcher.scanOnce();
    assert.strictEqual(calls.length, 0, 'notifyEnabled=false 应跳过通知');
    // 但告警仍正常写入（通知与告警注入是两路）
    assert.strictEqual(getAlertsForSession(alertsFile, 'sess').length, 1);
  });
});
