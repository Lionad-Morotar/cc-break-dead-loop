/**
 * 配置常量
 */

/** 连续无效 Read 达第 3 次时注入警告 */
export const WARN_THRESHOLD = 3;

/** 连续无效 Read 达第 5 次时注入强制停止指令 */
export const BLOCK_THRESHOLD = 5;

/** 状态数据根目录 */
export const DATA_DIR =
  process.env.CC_BREAK_DATA_DIR || `${process.env.HOME || process.env.USERPROFILE || '/tmp'}/.data/cc-break-dead-loop`;

/** Claude Code 配置目录 */
export const CLAUDE_CONFIG_DIR =
  process.env.CLAUDE_CONFIG_DIR || `${process.env.HOME || process.env.USERPROFILE || '/tmp'}/.claude`;

/** subagent transcript 根目录（含所有 project/session） */
export const PROJECTS_DIR =
  process.env.CC_BREAK_PROJECTS_DIR || `${CLAUDE_CONFIG_DIR}/projects`;

/** watcher 写入的告警文件（hook 读取） */
export const ALERTS_FILE = `${DATA_DIR}/alerts.json`;

/** watcher 心跳文件（lifecycle 据此判断存活） */
export const HEARTBEAT_FILE = `${DATA_DIR}/watcher-heartbeat.json`;

/** watcher PID 文件（重启时 kill 旧进程） */
export const PID_FILE = `${DATA_DIR}/watcher.pid`;

/** watcher 死循环检测的滑动窗口大小（最近 N 个 tool_use） */
export const WATCHER_WINDOW_SIZE = 20;

/** watcher 死循环触发阈值 */
export const WATCHER_THRESHOLD = 5;

/** watcher 扫描间隔（ms） */
export const WATCHER_SCAN_INTERVAL_MS = 5_000;

/** 子 agent 停滞判定阈值（ms）：jsonl 最后活动距今超过此值视为已停止，清除其告警 */
export const WATCHER_STALE_MS = 15_000;

/** 心跳超时阈值（ms），超过视为 watcher 已死需重启 */
export const WATCHER_STALE_TIMEOUT_MS = 30_000;
