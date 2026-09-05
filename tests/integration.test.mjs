import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

/**
 * 全文件级 env 隔离：DATA_DIR/PROJECTS_DIR 钉到 temp 目录并关闭桌面通知。
 *
 * 保活接线让 SessionStart hook 与 setup-check 在心跳缺失时 spawn 真实 watcher；
 * 不隔离则落在真实 ~/.data 与 ~/.claude/projects 上：GB 级历史语料让 watcher
 * 满载扫描、真实通知弹窗，重 IO 还会把同套件其他用例拖过 5s 超时。
 * 附带收益：PreToolUse 计数器状态不再写入真实 DATA_DIR。
 */
const isolatedRoot = mkdtempSync(join(tmpdir(), 'cc-break-integration-'));
const ISOLATED_ENV = {
  CC_BREAK_DATA_DIR: join(isolatedRoot, 'data'),
  CC_BREAK_PROJECTS_DIR: join(isolatedRoot, 'projects'),
  CC_BREAK_NOTIFY: '0',
};
mkdirSync(ISOLATED_ENV.CC_BREAK_DATA_DIR, { recursive: true });
mkdirSync(ISOLATED_ENV.CC_BREAK_PROJECTS_DIR, { recursive: true });

afterAll(() => {
  // 清理隔离 env 下 hook spawn 的真实 watcher（SIGTERM 即可，被信号杀死时 exit code 为 null，不按 code 判死）
  for (const file of ['watcher.pid', 'watcher-heartbeat.json']) {
    try {
      const raw = readFileSync(join(ISOLATED_ENV.CC_BREAK_DATA_DIR, file), 'utf8');
      const pid = file.endsWith('.pid') ? Number(raw.trim()) : JSON.parse(raw).pid;
      if (Number.isFinite(pid) && pid > 0) process.kill(pid, 'SIGTERM');
    } catch {
      // 未 spawn 或已死，忽略
    }
  }
  rmSync(isolatedRoot, { recursive: true, force: true });
});

/**
 * 通过子进程运行 node-runner.mjs，模拟 stdin/stdout 协议
 */
function runRunner(event, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [
      join(projectRoot, 'plugin/scripts/node-runner.mjs'),
      event,
    ], {
      cwd: projectRoot,
      env: { ...process.env, ...ISOLATED_ENV },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    child.on('error', reject);

    if (input) {
      child.stdin.write(JSON.stringify(input));
    }
    child.stdin.end();
  });
}

/**
 * 运行子进程并传入任意 stdin 内容
 */
function runWithStdin(args, stdinData) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, {
      cwd: projectRoot,
      env: { ...process.env, ...ISOLATED_ENV },
    });

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });

    child.on('close', (code) => {
      resolve({ code, stdout: stdout.trim() });
    });

    child.on('error', reject);

    if (stdinData !== undefined) {
      child.stdin.write(stdinData);
    }
    child.stdin.end();
  });
}

describe('integration: stdin/stdout protocol', () => {
  it('PostToolUse event → stdout 返回 { continue: true }', async () => {
    const result = await runRunner('post-tool-use', {
      tool_name: 'Read',
      cwd: '/tmp',
      session_id: 'sess-int-1',
      agent_id: 'agent-int-1',
      agent_type: 'planner',
      tool_input: { file_path: '/a/b', offset: 10, limit: 20 },
      tool_response: '正常文件内容',
    });

    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.continue, true);
    assert.strictEqual(parsed.suppressOutput, true);
  });

  it('PostToolUse wasted call (file_unchanged) → 计数器更新，返回 continue', async () => {
    const result = await runRunner('post-tool-use', {
      tool_name: 'Read',
      cwd: '/tmp',
      session_id: 'sess-int-2',
      agent_id: 'agent-int-2',
      agent_type: 'planner',
      tool_input: { file_path: '/a/b', offset: 10, limit: 20 },
      tool_response: { type: 'file_unchanged', file: { filePath: '/a/b' } },
    });

    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.continue, true);
  });

  it('PreToolUse:Read 计数器 >= 5 → deny + additionalContext 双重保险', async () => {
    // 先通过 PostToolUse 写入 5 次 wasted call 状态
    const input = {
      tool_name: 'Read',
      cwd: '/tmp',
      session_id: 'sess-int-3',
      agent_id: 'agent-int-3',
      agent_type: 'planner',
      tool_input: { file_path: '/a/b', offset: 10, limit: 20 },
    };

    for (let i = 0; i < 5; i++) {
      await runRunner('post-tool-use', {
        ...input,
        tool_response: { type: 'file_unchanged', file: { filePath: '/a/b' } },
      });
    }

    const result = await runRunner('pre-tool-use-read', input);

    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.continue, false);
    // deny 阻断主 agent
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(parsed.hookSpecificOutput.permissionDecisionReason.includes('cc-break-dead-loop'));
    // additionalContext 引导 subagent/teammate
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes('立即停止'));
  });

  it('无效 event 名称 → stdout 返回 { continue: true }', async () => {
    const result = await runRunner('unknown-event', {
      tool_name: 'Read',
      cwd: '/tmp',
      session_id: 'sess-int-4',
      agent_id: 'agent-int-4',
      agent_type: 'planner',
      tool_input: { file_path: '/a/b' },
    });

    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.continue, true);
  });

  it('SessionStart event → 注入 additionalContext（hookSpecificOutput.SessionStart）', async () => {
    const result = await runRunner('session-start', {});

    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.ok(typeof parsed.hookSpecificOutput.additionalContext === 'string');
    assert.ok(parsed.hookSpecificOutput.additionalContext.length > 0);
  });

  it('stdin 为空 → 不崩溃，返回 { continue: true }（D5）', async () => {
    const result = await runRunner('post-tool-use', null);

    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.continue, true);
    assert.strictEqual(parsed.suppressOutput, true);
  });

  it('stdin 为无效 JSON 字符串 → 返回 { continue: true }（D5）', async () => {
    const result = await runWithStdin(
      [join(projectRoot, 'plugin/scripts/node-runner.mjs'), 'post-tool-use'],
      'not-json-at-all{'
    );

    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.continue, true);
    assert.strictEqual(parsed.suppressOutput, true);
  });
});

describe('integration: setup-check.mjs', () => {
  it('Node.js >= 18 → stdout 包含 "OK"', async () => {
    const result = await runWithStdin(
      [join(projectRoot, 'plugin/scripts/setup-check.mjs')],
      ''
    );

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('OK'));
    assert.ok(result.stdout.includes('Node.js'));
  });
});

describe('integration: index.mjs CLI', () => {
  it('直接运行 index.mjs post-tool-use → 正确处理 stdin', async () => {
    const result = await runWithStdin(
      [join(projectRoot, 'plugin/src/index.mjs'), 'post-tool-use'],
      JSON.stringify({
        tool_name: 'Read',
        cwd: '/tmp',
        session_id: 'sess-int-5',
        agent_id: 'agent-int-5',
        agent_type: 'planner',
        tool_input: { file_path: '/x/y' },
        tool_response: 'content',
      })
    );

    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.continue, true);
  });
});
