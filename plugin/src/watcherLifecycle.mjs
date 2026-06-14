/**
 * Watcher 生命周期管理：决策是否需要（重）启动 watcher
 *
 * 分两层：
 *   - decideAction：纯决策逻辑（读心跳文件判断新鲜度），可测
 *   - ensureWatcherRunning：执行 spawn/kill（薄执行层）
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * 决策 watcher 是否需要（重）启动
 *
 * @param {{ heartbeatFile: string, staleTimeoutMs: number, now?: number }} params
 * @returns {'none' | 'start' | 'restart'} 'none'=已运行, 'start'=首次启动, 'restart'=心跳超时需重启
 */
export function decideAction({ heartbeatFile, staleTimeoutMs, now = Date.now() }) {
  let heartbeat;
  try {
    heartbeat = JSON.parse(readFileSync(heartbeatFile, 'utf8'));
  } catch {
    return 'start';
  }

  if (typeof heartbeat.ts !== 'number') {
    return 'start';
  }

  if (now - heartbeat.ts > staleTimeoutMs) {
    return 'restart';
  }

  return 'none';
}

/**
 * 尝试 kill 旧 watcher 进程（按 PID 文件）。失败静默
 * @param {string} pidFile
 */
function killOldProcess(pidFile) {
  let pid;
  try {
    pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  } catch {
    return;
  }
  if (!Number.isFinite(pid)) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // 进程已死或无权限，静默
  }
}

/**
 * 启动或保活 watcher 进程
 *
 * @param {{ watcherScript: string, heartbeatFile: string, pidFile: string, staleTimeoutMs?: number, env?: Record<string,string> }} params
 * @returns {{ action: 'none'|'start'|'restart', started: boolean, pid?: number }}
 */
export function ensureWatcherRunning({
  watcherScript,
  heartbeatFile,
  pidFile,
  staleTimeoutMs = 30_000,
  env,
}) {
  const action = decideAction({ heartbeatFile, staleTimeoutMs });
  if (action === 'none') {
    return { action, started: false };
  }

  if (action === 'restart') {
    killOldProcess(pidFile);
  }

  const child = spawn('node', [watcherScript], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env },
  });
  child.unref();

  try {
    mkdirSync(dirname(pidFile), { recursive: true });
    writeFileSync(pidFile, String(child.pid));
  } catch {
    // PID 文件写入失败不影响 watcher 运行
  }

  return { action, started: true, pid: child.pid };
}

