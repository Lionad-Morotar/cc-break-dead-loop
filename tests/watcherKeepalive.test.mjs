/**
 * watcher 保活接线集成测试
 *
 * 通过 node-runner 子进程走真实 stdin/stdout hook 协议（公共接口行为测试），
 * 用 CC_BREAK_DATA_DIR / CC_BREAK_PROJECTS_DIR 把全部状态隔离到 temp dir。
 * 断言对象是文件系统效果（心跳/pid 文件）与进程存活性（kill 0 探测）。
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

/** 带 env 运行 node-runner 子进程，模拟真实 hook 调用 */
function runRunner(event, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [join(projectRoot, 'scripts/node-runner.mjs'), event],
      {
        cwd: projectRoot,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.on('close', (code) => resolve({ code, stdout: stdout.trim() }));
    child.on('error', reject);

    if (input) {
      child.stdin.write(JSON.stringify(input));
    }
    child.stdin.end();
  });
}

/** 轮询等待条件成立；超时返回最后一次判定结果 */
async function waitFor(predicate, { timeoutMs = 15_000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** pid 存活探测（signal 0 不发送信号只检查存在性与权限） */
function isAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('watcher keepalive: hook 接线', () => {
  let tmpDir;
  let dataDir;
  let projectsDir;
  let heartbeatFile;
  let pidFile;
  let binDir;
  let markerFile;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-keepalive-'));
    dataDir = join(tmpDir, 'data');
    projectsDir = join(tmpDir, 'projects');
    binDir = join(tmpDir, 'bin');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    heartbeatFile = join(dataDir, 'watcher-heartbeat.json');
    pidFile = join(dataDir, 'watcher.pid');
    markerFile = join(tmpDir, 'notify-marker.log');
    // PATH shim：假 osascript/notify-send 把参数追加到 marker 文件，
    // 用于在不弹真实桌面通知的情况下断言 notify 接线是否触发；
    // 两个平台二进制都要伪造，否则 linux 上「通知开启」用例必红
    for (const bin of ['osascript', 'notify-send']) {
      writeFileSync(
        join(binDir, bin),
        `#!/bin/sh\nprintf '%s\\n' "$@" >> '${markerFile}'\n`,
      );
      chmodSync(join(binDir, bin), 0o755);
    }
  });

  afterEach(() => {
    // 清理测试可能 spawn 的真实 watcher：SIGTERM 即可，
    // 不等待也不按 exit code 判死（被信号杀死时 code 为 null）
    for (const pid of [
      readJson(heartbeatFile)?.pid,
      existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : null,
    ]) {
      if (isAlive(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // 已死或无权限，忽略
        }
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function testEnv(overrides = {}) {
    return {
      CC_BREAK_DATA_DIR: dataDir,
      CC_BREAK_PROJECTS_DIR: projectsDir,
      PATH: `${binDir}:${process.env.PATH}`,
      CC_BREAK_NOTIFY: '0',
      ...overrides,
    };
  }

  /** 通知开启的 env（CC_BREAK_NOTIFY 键必须缺席而非 undefined，故用解构剔除） */
  function notifyOnEnv() {
    const { CC_BREAK_NOTIFY: _ignored, ...rest } = testEnv();
    return rest;
  }

  it('session-start: 无心跳 → spawn watcher，心跳出现且 pid 存活', async () => {
    const { code, stdout } = await runRunner('session-start', {}, testEnv());

    assert.strictEqual(code, 0);
    assert.ok(stdout.includes('SessionStart'), 'advice 注入应正常返回');

    const spawned = await waitFor(() => {
      const hb = readJson(heartbeatFile);
      return hb !== null && typeof hb.ts === 'number' && isAlive(hb.pid);
    });
    assert.ok(spawned, 'watcher 应被拉起并在超时内写出存活心跳');
  }, 25_000);

  it('stop: 心跳新鲜 → 不 spawn（心跳即节流器）', async () => {
    const sentinel = { pid: 424242, ts: Date.now() };
    writeFileSync(heartbeatFile, JSON.stringify(sentinel));

    const { code } = await runRunner('stop', { session_id: 'sess-x' }, testEnv());

    assert.strictEqual(code, 0);
    assert.ok(!existsSync(pidFile), '未 spawn 时不应写 pid 文件');
    assert.deepStrictEqual(readJson(heartbeatFile), sentinel, '心跳应原样未动');
  }, 25_000);

  it('stop: 心跳过期 → 自愈重启（新 pid 存活）', async () => {
    // 99999999 超出 macOS pid 上限，killOldProcess 对其 ESRCH 静默
    writeFileSync(heartbeatFile, JSON.stringify({ pid: 99999999, ts: Date.now() - 60_000 }));
    writeFileSync(pidFile, '99999999');

    const { code } = await runRunner('stop', { session_id: 'sess-x' }, testEnv());
    assert.strictEqual(code, 0);

    const revived = await waitFor(() => {
      const hb = readJson(heartbeatFile);
      return hb !== null && hb.pid !== 99999999 && isAlive(hb.pid);
    });
    assert.ok(revived, 'stop hook 应自愈拉起 watcher');
  }, 25_000);

  it('post-tool-use-any: 心跳过期 → 自愈重启', async () => {
    writeFileSync(heartbeatFile, JSON.stringify({ pid: 99999999, ts: Date.now() - 60_000 }));
    writeFileSync(pidFile, '99999999');

    const { code } = await runRunner(
      'post-tool-use-any',
      { session_id: 'sess-y', tool_name: 'Bash' },
      testEnv(),
    );
    assert.strictEqual(code, 0);

    const revived = await waitFor(() => {
      const hb = readJson(heartbeatFile);
      return hb !== null && hb.pid !== 99999999 && isAlive(hb.pid);
    });
    assert.ok(revived, 'post-tool-use-any hook 应自愈拉起 watcher');
  }, 25_000);

  it('hooks.json: SessionStart matcher 为 *（覆盖 resume/clear/compact）', () => {
    const hooks = readJson(join(projectRoot, 'hooks/hooks.json'));
    assert.strictEqual(hooks.hooks.SessionStart[0].matcher, '*');
  });

  it('stop: 心跳过期自愈 + 通知开启 → 假 osascript 被调（复活通知一次）', async () => {
    writeFileSync(heartbeatFile, JSON.stringify({ pid: 99999999, ts: Date.now() - 60_000 }));
    writeFileSync(pidFile, '99999999');

    const { code } = await runRunner('stop', { session_id: 'sess-n' }, notifyOnEnv());
    assert.strictEqual(code, 0);

    const revived = await waitFor(() => {
      const hb = readJson(heartbeatFile);
      return hb !== null && hb.pid !== 99999999 && isAlive(hb.pid);
    });
    assert.ok(revived, 'watcher 应自愈');
    assert.ok(existsSync(markerFile), '自愈路径应触发桌面通知');
    const marker = readFileSync(markerFile, 'utf8');
    assert.ok(
      marker.split('\n').filter((l) => l.includes('display notification')).length === 1,
      '复活通知应恰好一次（shim 每次调用写一行脚本）',
    );
    assert.ok(marker.includes('监控已自愈'), '应使用自愈文案而非死循环文案');
  }, 25_000);

  it('stop: 心跳过期自愈 + CC_BREAK_NOTIFY=0 → 自愈但不通知', async () => {
    writeFileSync(heartbeatFile, JSON.stringify({ pid: 99999999, ts: Date.now() - 60_000 }));
    writeFileSync(pidFile, '99999999');

    await runRunner('stop', { session_id: 'sess-n0' }, testEnv());

    const revived = await waitFor(() => {
      const hb = readJson(heartbeatFile);
      return hb !== null && hb.pid !== 99999999 && isAlive(hb.pid);
    });
    assert.ok(revived, 'watcher 应自愈');
    assert.ok(!existsSync(markerFile), '通知关闭时不应调用 osascript');
  }, 25_000);

  it('session-start: 首启（无心跳文件）+ 通知开启 → spawn 但不通知', async () => {
    const { code } = await runRunner('session-start', {}, notifyOnEnv());
    assert.strictEqual(code, 0);

    const spawned = await waitFor(() => {
      const hb = readJson(heartbeatFile);
      return hb !== null && isAlive(hb.pid);
    });
    assert.ok(spawned, 'watcher 应被拉起');
    assert.ok(!existsSync(markerFile), '首启属正常初始化，不应惊动用户');
  }, 25_000);
});
