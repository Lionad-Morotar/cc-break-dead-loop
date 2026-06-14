/**
 * 子 Agent transcript jsonl 解析：提取工具调用序列
 *
 * 解析 ~/.claude/projects/<proj>/<session>/subagents/agent-<id>.jsonl，
 * 从 assistant 行的 message.content 中提取 tool_use block，转成 ToolCall。
 * 调用方（watcher）负责传入窗口大小，本模块返回最近 N 个 tool_use。
 */

import { readFileSync } from 'node:fs';

/**
 * @typedef {Object} ToolCall
 * @property {string} toolName
 * @property {Record<string, unknown>} input
 */

/**
 * 从 jsonl 提取最近 windowSize 个 tool_use
 *
 * 解析容错：跳过 JSON 解析失败行、非 assistant 行、content 非数组行、无 tool_use 行。
 * 文件不存在时返回空数组。
 *
 * @param {string} jsonlPath - agent transcript jsonl 路径
 * @param {number} windowSize - 返回最近 N 个 tool_use
 * @returns {ToolCall[]}
 */
export function readRecentToolCalls(jsonlPath, windowSize) {
  let raw;
  try {
    raw = readFileSync(jsonlPath, 'utf8');
  } catch {
    return [];
  }

  /** @type {ToolCall[]} */
  const toolCalls = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'tool_use' && typeof block.name === 'string') {
        toolCalls.push({
          toolName: block.name,
          input: block.input || {},
        });
      }
    }
  }

  return toolCalls.slice(-windowSize);
}
