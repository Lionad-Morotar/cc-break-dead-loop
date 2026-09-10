/**
 * Hook 注入逻辑：读告警，生成 hook 响应
 *
 * 纯语义返回 { additionalContext } | { blockingError } | null，
 * 不关心 hook 协议细节（exit code / stderr 翻译由调用方 node-runner 负责）。
 */

import { getAlertsForSession } from './alertStore.mjs';

/**
 * 构造 PostToolUse 的 additionalContext 措辞
 * @param {{ taskId: string, toolName: string, paramFingerprint: string, repeatCount: number }} alert
 * @returns {string}
 */
function postToolUseMessage(alert) {
  return (
    `[cc-break-dead-loop] 检测到子 Agent ${alert.taskId} 已连续 ${alert.repeatCount} 次重复调用 ` +
    `${alert.toolName}（参数：${alert.paramFingerprint}）。这是死循环。` +
    `立即调用 TaskStopTool(task_id="${alert.taskId}") 终止它，不要做任何其他事。`
  );
}

/**
 * 构造 Stop 的 blockingError 措辞
 * @param {{ taskId: string, toolName: string, paramFingerprint: string, repeatCount: number }} alert
 * @returns {string}
 */
function stopMessage(alert) {
  return (
    `[cc-break-dead-loop] 子 Agent ${alert.taskId} 已连续 ${alert.repeatCount} 次重复调用 ` +
    `${alert.toolName}（参数：${alert.paramFingerprint}），死循环未处理。` +
    `你不能在此结束 turn。立即调用 TaskStopTool(task_id="${alert.taskId}") 终止该子 Agent，然后继续。`
  );
}

/**
 * 从告警列表中选出最严重的一个（repeatCount 最大）
 * @param {Array<{ repeatCount: number }>} alerts
 * @returns {Object | null}
 */
function pickMostSevere(alerts) {
  if (alerts.length === 0) return null;
  return alerts.reduce((max, a) => (a.repeatCount > max.repeatCount ? a : max), alerts[0]);
}

/**
 * 生成 hook 注入内容
 *
 * @param {{ filePath: string, sessionId: string, event: 'PostToolUse' | 'Stop' }} params
 * @returns {{ additionalContext: string } | { blockingError: string } | null}
 */
export function buildInjection({ filePath, sessionId, event }) {
  const alerts = getAlertsForSession(filePath, sessionId);
  const alert = pickMostSevere(alerts);
  if (!alert) {
    return null;
  }

  if (event === 'PostToolUse') {
    return { additionalContext: postToolUseMessage(alert) };
  }
  if (event === 'Stop') {
    return { blockingError: stopMessage(alert) };
  }

  return null;
}
