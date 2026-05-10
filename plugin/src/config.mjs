/**
 * 配置常量
 */

/** 连续无效 Read 达第 3 次时注入警告 */
export const WARN_THRESHOLD = 3;

/** 连续无效 Read 达第 5 次时强制阻断 */
export const BLOCK_THRESHOLD = 5;

/** 状态数据根目录 */
export const DATA_DIR = `${process.env.HOME || process.env.USERPROFILE || '/tmp'}/.data/cc-break-dead-loop`;
