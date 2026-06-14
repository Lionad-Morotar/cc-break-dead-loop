/**
 * Setup 钩子脚本：检测 Node.js 版本 >= 18，启动/保活 watcher 常驻进程
 * 永不阻断 Claude Code 启动（exit 0）
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureWatcherRunning } from '../src/watcherLifecycle.mjs';
import {
  HEARTBEAT_FILE,
  PID_FILE,
  WATCHER_STALE_TIMEOUT_MS,
} from '../src/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watcherScript = join(__dirname, 'watcher.mjs');

function checkNode() {
  const result = spawnSync('node', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return { ok: false, message: 'Node.js 未安装或不在 PATH 中' };
  }

  const version = result.stdout.trim();
  const majorMatch = version.match(/v(\d+)/);
  if (!majorMatch) {
    return { ok: false, message: `无法解析 Node.js 版本: ${version}` };
  }

  const major = parseInt(majorMatch[1], 10);
  if (major < 18) {
    return { ok: false, message: `Node.js 版本 ${version} 过低，需要 >= v18.0.0` };
  }

  return { ok: true, message: `Node.js ${version}` };
}

const nodeCheck = checkNode();

if (nodeCheck.ok) {
  // eslint-disable-next-line no-console
  console.log(`[cc-break-dead-loop] Setup: OK (${nodeCheck.message})`);

  // 启动/保活 watcher 常驻进程
  try {
    const result = ensureWatcherRunning({
      watcherScript,
      heartbeatFile: HEARTBEAT_FILE,
      pidFile: PID_FILE,
      staleTimeoutMs: WATCHER_STALE_TIMEOUT_MS,
    });
    if (result.started) {
      // eslint-disable-next-line no-console
      console.log(`[cc-break-dead-loop] Watcher ${result.action} (pid=${result.pid})`);
    }
  } catch (e) {
    // watcher 启动失败不阻断 Claude Code，仅告警
    // eslint-disable-next-line no-console
    console.error(`[cc-break-dead-loop] Watcher 启动失败: ${e.message}`);
  }
} else {
  // eslint-disable-next-line no-console
  console.error(`[cc-break-dead-loop] Setup 警告: ${nodeCheck.message}`);
  // eslint-disable-next-line no-console
  console.error('请安装 Node.js >= 18: https://nodejs.org/');
}

// Setup 永不阻断启动
process.exit(0);

