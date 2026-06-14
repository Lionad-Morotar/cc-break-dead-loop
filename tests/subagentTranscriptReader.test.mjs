import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRecentToolCalls, readLastActivityTimestamp } from '../plugin/src/subagentTranscriptReader.mjs';

/**
 * 构造 assistant 行（含若干 tool_use block）
 */
function assistantLine(...toolUses) {
  return JSON.stringify({
    type: 'assistant',
    message: { content: toolUses },
  });
}

function toolUse(name, input) {
  return { type: 'tool_use', id: `tu-${Math.random()}`, name, input };
}

describe('SubagentTranscriptReader', () => {
  let jsonlFile;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-transcript-'));
    jsonlFile = join(tmpDir, 'agent-test.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('从 jsonl 提取所有 tool_use 转 ToolCall', () => {
    writeFileSync(
      jsonlFile,
      [
        assistantLine(toolUse('Read', { file_path: '/a' })),
        assistantLine(toolUse('Read', { file_path: '/a' })),
      ].join('\n') + '\n',
    );

    const result = readRecentToolCalls(jsonlFile, 10);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].toolName, 'Read');
    assert.deepStrictEqual(result[0].input, { file_path: '/a' });
  });

  it('文件不存在 → 空数组', () => {
    assert.deepStrictEqual(readRecentToolCalls(join(tmpDir, 'nope.jsonl'), 10), []);
  });

  it('跳过非 assistant 行（user tool_result）', () => {
    const userLine = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
    });
    writeFileSync(
      jsonlFile,
      [userLine, assistantLine(toolUse('Read', { file_path: '/a' }))].join('\n') + '\n',
    );

    const result = readRecentToolCalls(jsonlFile, 10);
    assert.strictEqual(result.length, 1);
  });

  it('跳过 assistant 行中纯 text/thinking（无 tool_use）', () => {
    const textLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '思考中' }] },
    });
    writeFileSync(
      jsonlFile,
      [textLine, assistantLine(toolUse('Bash', { command: 'ls' }))].join('\n') + '\n',
    );

    const result = readRecentToolCalls(jsonlFile, 10);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].toolName, 'Bash');
  });

  it('跳过无法解析的行（不完整末行）', () => {
    const good = assistantLine(toolUse('Read', { file_path: '/a' }));
    const broken = '{not-json';
    writeFileSync(jsonlFile, good + '\n' + broken + '\n');

    const result = readRecentToolCalls(jsonlFile, 10);
    assert.strictEqual(result.length, 1);
  });

  it('只返回最近 windowSize 个 tool_use', () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      assistantLine(toolUse('Read', { file_path: `/f${i}` })),
    );
    writeFileSync(jsonlFile, lines.join('\n') + '\n');

    const result = readRecentToolCalls(jsonlFile, 3);
    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(result[0].input, { file_path: '/f2' });
    assert.deepStrictEqual(result[2].input, { file_path: '/f4' });
  });

  it('单行 assistant 含多个并行 tool_use → 全部提取并保持顺序', () => {
    const line = assistantLine(
      toolUse('Read', { file_path: '/a' }),
      toolUse('Grep', { pattern: 'x' }),
      toolUse('Bash', { command: 'ls' }),
    );
    writeFileSync(jsonlFile, line + '\n');

    const result = readRecentToolCalls(jsonlFile, 10);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].toolName, 'Read');
    assert.strictEqual(result[1].toolName, 'Grep');
    assert.strictEqual(result[2].toolName, 'Bash');
  });

  it('assistant 行 message.content 非数组 → 跳过', () => {
    const stringContent = JSON.stringify({
      type: 'assistant',
      message: { content: '直接字符串内容' },
    });
    writeFileSync(
      jsonlFile,
      [stringContent, assistantLine(toolUse('Read', { file_path: '/a' }))].join('\n') + '\n',
    );

    const result = readRecentToolCalls(jsonlFile, 10);
    assert.strictEqual(result.length, 1);
  });
});

describe('readLastActivityTimestamp', () => {
  let jsonlFile;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-lastts-'));
    jsonlFile = join(tmpDir, 'agent-test.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('返回末行 timestamp（ms epoch）', () => {
    writeFileSync(
      jsonlFile,
      [
        JSON.stringify({ type: 'assistant', timestamp: '2026-06-14T10:00:00.000Z' }),
        JSON.stringify({ type: 'user', timestamp: '2026-06-14T10:00:05.000Z' }),
      ].join('\n') + '\n',
    );

    const ts = readLastActivityTimestamp(jsonlFile);
    assert.strictEqual(ts, Date.parse('2026-06-14T10:00:05.000Z'));
  });

  it('文件不存在 → null', () => {
    assert.strictEqual(readLastActivityTimestamp(join(tmpDir, 'nope.jsonl')), null);
  });

  it('空文件 → null', () => {
    writeFileSync(jsonlFile, '');
    assert.strictEqual(readLastActivityTimestamp(jsonlFile), null);
  });

  it('末行无 timestamp → 倒序找前一行有 timestamp 的', () => {
    writeFileSync(
      jsonlFile,
      [
        JSON.stringify({ type: 'assistant', timestamp: '2026-06-14T10:00:00.000Z' }),
        JSON.stringify({ type: 'user' }), // 无 timestamp
      ].join('\n') + '\n',
    );

    const ts = readLastActivityTimestamp(jsonlFile);
    assert.strictEqual(ts, Date.parse('2026-06-14T10:00:00.000Z'));
  });

  it('所有行都无 timestamp → null', () => {
    writeFileSync(
      jsonlFile,
      [JSON.stringify({ type: 'assistant' }), JSON.stringify({ type: 'user' })].join('\n') + '\n',
    );
    assert.strictEqual(readLastActivityTimestamp(jsonlFile), null);
  });

  it('末行损坏（非 JSON）→ 跳过找前一行', () => {
    writeFileSync(
      jsonlFile,
      [
        JSON.stringify({ type: 'assistant', timestamp: '2026-06-14T10:00:00.000Z' }),
        '{not-json',
      ].join('\n') + '\n',
    );

    const ts = readLastActivityTimestamp(jsonlFile);
    assert.strictEqual(ts, Date.parse('2026-06-14T10:00:00.000Z'));
  });
});
