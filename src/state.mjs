/**
 * 状态管理：读写、安全化、原子写入、计数器逻辑
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.mjs';
import { getProjectName, sanitizeName } from './utils.mjs';

/**
 * @typedef {Object} DetectionState
 * @property {string} sessionId
 * @property {string} filePath
 * @property {number|undefined} offset
 * @property {number|undefined} limit
 * @property {number} consecutiveWastedReads
 * @property {string} lastUpdatedAt
 */

const STATE_FILE = 'state.json';

/**
 * 构建状态目录路径
 * @param {string} cwd
 * @param {string} sessionId
 * @param {string} [agentId]
 * @param {string} [agentType]
 * @returns {string}
 */
export function getStateDir(cwd, sessionId, agentId, _agentType) {
  const project = getProjectName(cwd);
  const session = sanitizeName(sessionId || 'unknown');
  // agent_id 为空或不存在时使用 "main"
  const agent = sanitizeName(agentId || 'main');
  return join(DATA_DIR, project, session, agent);
}

/**
 * 读取状态文件
 * @param {string} stateDir
 * @returns {DetectionState|null}
 */
export function readState(stateDir) {
  const filePath = join(stateDir, STATE_FILE);
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 原子写入状态文件
 * @param {string} stateDir
 * @param {DetectionState} state
 */
export function writeState(stateDir, state) {
  const filePath = join(stateDir, STATE_FILE);
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, filePath);
}

/**
 * 比较当前 Read 参数是否与状态记录一致
 * 使用 === 直接比较，不规范化 undefined→0（D7）
 * @param {DetectionState|null} state
 * @param {string} filePath
 * @param {number|undefined} offset
 * @param {number|undefined} limit
 * @returns {boolean}
 */
export function isSameReadParams(state, filePath, offset, limit) {
  if (!state) return false;
  return (
    state.filePath === filePath &&
    state.offset === offset &&
    state.limit === limit
  );
}

/**
 * 递增或重置计数器
 * @param {string} stateDir
 * @param {{ sessionId: string, filePath: string, offset?: number, limit?: number }} params
 * @returns {number} 新的 consecutiveWastedReads 值
 */
export function incrementCounter(stateDir, params) {
  const { sessionId, filePath, offset, limit } = params;
  const state = readState(stateDir);

  if (isSameReadParams(state, filePath, offset, limit)) {
    const newState = {
      ...state,
      consecutiveWastedReads: (state.consecutiveWastedReads || 0) + 1,
      lastUpdatedAt: new Date().toISOString(),
    };
    writeState(stateDir, newState);
    return newState.consecutiveWastedReads;
  }

  // 参数变化，重置计数
  const newState = {
    sessionId,
    filePath,
    offset,
    limit,
    consecutiveWastedReads: 1,
    lastUpdatedAt: new Date().toISOString(),
  };
  writeState(stateDir, newState);
  return 1;
}
