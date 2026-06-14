/**
 * Watcher 常驻进程核心：扫描 subagent transcript，检测死循环，同步告警
 *
 * 集成 SubagentTranscriptReader + DeadLoopDetector + AlertStore。
 * 每次 scanOnce 全量重算当前死循环集合，对比上次集合：
 *   - 消失的死循环 → removeAlert（解决子 Agent 被 kill 后告警残留）
 *   - 持续/新增的死循环 → addAlert（upsert 更新 detectedAt）
 */

import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { readRecentToolCalls, readLastActivityTimestamp } from './subagentTranscriptReader.mjs';
import { detectDeadLoop } from './deadLoopDetector.mjs';
import { addAlert, removeAlert, getAllAlerts } from './alertStore.mjs';

/**
 * 递归查找所有 agent-*.jsonl
 * @param {string} dir
 * @returns {string[]}
 */
function findAllAgentJsonls(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAllAgentJsonls(full));
    } else if (entry.isFile() && /^agent-.*\.jsonl$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * 从 jsonl 路径解析 agentId 和 sessionId
 * 路径结构：<projectsDir>/<project>/<session>/subagents/agent-<id>.jsonl
 * @param {string} jsonlPath
 * @returns {{ agentId: string, sessionId: string }}
 */
function parseAgentFromPath(jsonlPath) {
  const agentId = basename(jsonlPath).replace(/^agent-/, '').replace(/\.jsonl$/, '');
  const subagentsDir = dirname(jsonlPath);
  const sessionDir = dirname(subagentsDir);
  return { agentId, sessionId: basename(sessionDir) };
}

/**
 * 创建 watcher 实例
 * @param {{ projectsDir: string, alertsFile: string, heartbeatFile: string, windowSize?: number, threshold?: number, staleMs?: number }} options
 */
export function createWatcher(options) {
  const {
    projectsDir,
    alertsFile,
    heartbeatFile,
    windowSize = 20,
    threshold = 5,
    staleMs = 15_000,
  } = options;

  /**
   * 上次扫描检测到的死循环 agentId 集合，用于同步告警。
   * 启动时从 alerts.json 初始化，使重启后能清除遗留的幽灵告警
   * （否则 previousDeadLoopIds 为空 → 首次扫描无法 removeAlert 旧告警）。
   */
  let previousDeadLoopIds = new Set(getAllAlerts(alertsFile).map((a) => a.taskId));

  function writeHeartbeat() {
    try {
      mkdirSync(dirname(heartbeatFile), { recursive: true });
      writeFileSync(
        heartbeatFile,
        JSON.stringify({ pid: process.pid, ts: Date.now() }),
      );
    } catch {
      // 心跳写入失败不影响扫描
    }
  }

  function scanOnce() {
    const jsonls = findAllAgentJsonls(projectsDir);
    /** @type {Map<string, Object>} agentId → alert */
    const currentDeadLoops = new Map();

    for (const jsonlPath of jsonls) {
      const { agentId, sessionId } = parseAgentFromPath(jsonlPath);
      const lastTs = readLastActivityTimestamp(jsonlPath);
      // null（无 timestamp）视为活跃：生产 Claude Code 总写 timestamp，null 是异常，
      // 保守报死循环（宁误报不漏报）
      const isStale = lastTs !== null && Date.now() - lastTs > staleMs;
      if (isStale) {
        // 子 agent 已停滞（最后活动 > staleMs 前），跳过检测；
        // 不放入 currentDeadLoops → 若之前有告警会触发 removeAlert 清除
        continue;
      }
      const calls = readRecentToolCalls(jsonlPath, windowSize);
      const loop = detectDeadLoop(calls, threshold);
      if (loop) {
        currentDeadLoops.set(agentId, {
          taskId: agentId,
          sessionId,
          toolName: loop.toolName,
          paramFingerprint: loop.paramFingerprint,
          repeatCount: loop.repeatCount,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // 同步告警：消失的移除，持续/新增的写入
    for (const id of previousDeadLoopIds) {
      if (!currentDeadLoops.has(id)) {
        removeAlert(alertsFile, id);
      }
    }
    for (const alert of currentDeadLoops.values()) {
      addAlert(alertsFile, alert);
    }

    previousDeadLoopIds = new Set(currentDeadLoops.keys());
    writeHeartbeat();
  }

  /** @type {NodeJS.Timeout | null} */
  let timer = null;

  function start(intervalMs = 5000) {
    if (timer) return;
    timer = setInterval(scanOnce, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { scanOnce, start, stop };
}
