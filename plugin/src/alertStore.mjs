/**
 * 告警共享状态：watcher 写、hooks 读
 *
 * 全局单文件 + sessionId 字段过滤实现多 session 隔离。
 * 原子写入（tmp + rename）保证并发读写时文件始终完整。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @typedef {Object} Alert
 * @property {string} taskId
 * @property {string} sessionId
 * @property {string} toolName
 * @property {string} paramFingerprint
 * @property {number} repeatCount
 * @property {string} detectedAt
 */

/**
 * 读取全部告警。文件不存在或损坏时降级为空数组
 * @param {string} filePath
 * @returns {Alert[]}
 */
function readAllAlerts(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.alerts) ? data.alerts : [];
  } catch {
    return [];
  }
}

/**
 * 原子写入全部告警
 * @param {string} filePath
 * @param {Alert[]} alerts
 */
function writeAllAlerts(filePath, alerts) {
  const tmpPath = `${filePath}.tmp.${Date.now()}.${process.pid}`;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmpPath, JSON.stringify({ version: 1, alerts }, null, 2));
  renameSync(tmpPath, filePath);
}

/**
 * 添加或更新告警（同 taskId 覆盖）
 * @param {string} filePath
 * @param {Alert} alert
 */
export function addAlert(filePath, alert) {
  const alerts = readAllAlerts(filePath);
  const idx = alerts.findIndex((a) => a.taskId === alert.taskId);
  if (idx >= 0) {
    alerts[idx] = alert;
  } else {
    alerts.push(alert);
  }
  writeAllAlerts(filePath, alerts);
}

/**
 * 删除指定 taskId 的告警。不存在时静默
 * @param {string} filePath
 * @param {string} taskId
 */
export function removeAlert(filePath, taskId) {
  const alerts = readAllAlerts(filePath);
  const filtered = alerts.filter((a) => a.taskId !== taskId);
  if (filtered.length !== alerts.length) {
    writeAllAlerts(filePath, filtered);
  }
}

/**
 * 按 session（可选按 agent）过滤读取告警
 * @param {string} filePath
 * @param {string} sessionId
 * @param {string} [agentId] - 可选，按 taskId 再过滤
 * @returns {Alert[]}
 */
export function getAlertsForSession(filePath, sessionId, agentId) {
  const alerts = readAllAlerts(filePath);
  return alerts.filter(
    (a) => a.sessionId === sessionId && (!agentId || a.taskId === agentId),
  );
}
