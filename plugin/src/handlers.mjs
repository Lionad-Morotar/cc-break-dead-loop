/**
 * 双 Handler：PostToolUse 检测 + PreToolUse:Read 拦截
 */

import { BLOCK_THRESHOLD, WARN_THRESHOLD } from './config.mjs';
import {
  getStateDir,
  incrementCounter,
  isSameReadParams,
  readState,
} from './state.mjs';

/**
 * 检测 toolResponse 是否包含 "Wasted call"（D6 多模式检测）
 * @param {any} toolResponse
 * @returns {boolean}
 */
export function isWastedCall(toolResponse) {
  if (typeof toolResponse === 'string') {
    return toolResponse.includes('Wasted call');
  }
  if (toolResponse && typeof toolResponse === 'object') {
    if (typeof toolResponse.content === 'string' && toolResponse.content.includes('Wasted call')) {
      return true;
    }
    // JSON.stringify 兜底
    return JSON.stringify(toolResponse).includes('Wasted call');
  }
  return false;
}

/**
 * 从 HookInput 中提取 Read 参数
 * @param {Object} input
 * @returns {{ filePath: string, offset?: number, limit?: number } | null}
 */
function extractReadParams(input) {
  const toolInput = input?.tool_input;
  if (!toolInput || typeof toolInput !== 'object') {
    return null;
  }
  const filePath = toolInput.file_path;
  if (!filePath) {
    return null;
  }
  return {
    filePath,
    offset: toolInput.offset,
    limit: toolInput.limit,
  };
}

/**
 * PostToolUse Handler：检测 wasted call 并更新计数器
 * @param {Object} input - HookInput
 * @returns {{ continue: boolean, suppressOutput: boolean }}
 */
export function postToolUse(input) {
  const toolName = input?.tool_name;
  if (toolName !== 'Read') {
    return { continue: true, suppressOutput: true };
  }

  const toolResponse = input?.tool_response;
  if (!isWastedCall(toolResponse)) {
    return { continue: true, suppressOutput: true };
  }

  const params = extractReadParams(input);
  if (!params) {
    return { continue: true, suppressOutput: true };
  }

  const stateDir = getStateDir(
    input.cwd,
    input.session_id,
    input.agent_id,
    input.agent_type
  );

  incrementCounter(stateDir, {
    sessionId: input.session_id,
    filePath: params.filePath,
    offset: params.offset,
    limit: params.limit,
  });

  return { continue: true, suppressOutput: true };
}

/**
 * PreToolUse:Read Handler：检查计数器并注入警告/阻断
 * @param {Object} input - HookInput
 * @returns {{ continue: boolean, suppressOutput: boolean } | { hookSpecificOutput: Object } | { systemMessage: string }}
 */
export function preToolUseRead(input) {
  const params = extractReadParams(input);
  if (!params) {
    return { continue: true, suppressOutput: true };
  }

  const stateDir = getStateDir(
    input.cwd,
    input.session_id,
    input.agent_id,
    input.agent_type
  );

  const state = readState(stateDir);
  if (!state || !isSameReadParams(state, params.filePath, params.offset, params.limit)) {
    return { continue: true, suppressOutput: true };
  }

  const count = state.consecutiveWastedReads || 0;

  if (count >= BLOCK_THRESHOLD) {
    // 强制阻断 — 返回标记，由调用者（index.mjs）执行 process.exit(2)
    const message = `[cc-break-dead-loop] 检测到 Read 死循环：已连续 ${count} 次读取文件「${params.filePath}」，每次返回「文件未改动」。请使用之前的读取结果，不要再重复 Read 同一文件。`;
    return { shouldBlock: true, systemMessage: message };
  }

  if (count >= WARN_THRESHOLD) {
    // 注入警告
    return {
      continue: true,
      suppressOutput: false,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `⚠️ [cc-break-dead-loop] 警告：这是第 ${count} 次重复读取文件「${params.filePath}」，该文件未改动。请直接使用之前的读取结果，避免继续 Read 同一未改动文件。`,
        permissionDecision: 'allow',
      },
    };
  }

  return { continue: true, suppressOutput: true };
}
