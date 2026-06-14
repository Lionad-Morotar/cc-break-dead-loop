/**
 * Watcher 常驻进程入口
 *
 * 由 Setup hook 通过 ensureWatcherRunning detached spawn 启动。
 * 立即扫描一次，随后按 WATCHER_SCAN_INTERVAL_MS 定时扫描。
 * 通过 stdin.resume() + 信号保持进程存活。
 */

import { createWatcher } from '../src/watcher.mjs';
import {
  PROJECTS_DIR,
  ALERTS_FILE,
  HEARTBEAT_FILE,
  WATCHER_WINDOW_SIZE,
  WATCHER_THRESHOLD,
  WATCHER_SCAN_INTERVAL_MS,
} from '../src/config.mjs';

const watcher = createWatcher({
  projectsDir: PROJECTS_DIR,
  alertsFile: ALERTS_FILE,
  heartbeatFile: HEARTBEAT_FILE,
  windowSize: WATCHER_WINDOW_SIZE,
  threshold: WATCHER_THRESHOLD,
});

// 启动时立即扫描一次，快速进入守护状态
watcher.scanOnce();
watcher.start(WATCHER_SCAN_INTERVAL_MS);

// 保持进程存活（detached 后不依赖父进程）
process.stdin.resume();

// 优雅退出
process.on('SIGTERM', () => {
  watcher.stop();
  process.exit(0);
});
process.on('SIGINT', () => {
  watcher.stop();
  process.exit(0);
});
