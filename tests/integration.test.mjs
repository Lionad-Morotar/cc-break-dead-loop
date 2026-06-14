import { describe, it } from 'vitest';
import assert from 'node:assert';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

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
    const child = spawn('node', args, { cwd: projectRoot });

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
