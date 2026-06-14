/**
 * 死循环检测器：识别连续重复的工具调用
 *
 * 深度模块 —— 封装"工具名 + 参数指纹"的重复判定策略。
 * 调用方（watcher）负责滑动窗口截断后传入，本模块只看传入序列的尾部连续重复。
 */

/**
 * 稳定序列化：对象键排序后 stringify，使键序不同的等价对象产生相同指纹
 * 递归处理嵌套对象与数组，保证 {a:1,b:2} 与 {b:2,a:1} 序列化结果一致
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(/** @type {Record<string, unknown>} */ (value)).sort();
  const pairs = keys.map(
    (k) => JSON.stringify(k) + ':' + stableStringify(/** @type {Record<string, unknown>} */ (value)[k]),
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * @typedef {Object} ToolCall
 * @property {string} toolName
 * @property {Record<string, unknown>} input
 */

/**
 * @typedef {Object} DeadLoop
 * @property {string} toolName
 * @property {string} paramFingerprint
 * @property {number} repeatCount
 */

/**
 * 检测尾部连续重复的工具调用是否达到死循环阈值
 *
 * 只看序列尾部的当前连续段（被工具名或参数变化打断即停止回溯），
 * 反映"当前正在发生的死循环"。历史死循环段（已被打断）不报，
 * 因为 watcher 只关心是否需要现在 intervention。
 *
 * @param {ToolCall[]} calls - 按时间序排列的工具调用（已截断为滑动窗口）
 * @param {number} threshold - 触发死循环的最小重复次数
 * @returns {DeadLoop | null}
 */
export function detectDeadLoop(calls, threshold) {
  if (calls.length === 0) {
    return null;
  }

  const last = calls[calls.length - 1];
  const lastFingerprint = stableStringify(last.input);

  let count = 1;
  for (let i = calls.length - 2; i >= 0; i--) {
    if (
      calls[i].toolName === last.toolName &&
      stableStringify(calls[i].input) === lastFingerprint
    ) {
      count++;
    } else {
      break;
    }
  }

  if (count >= threshold) {
    return {
      toolName: last.toolName,
      paramFingerprint: lastFingerprint,
      repeatCount: count,
    };
  }

  return null;
}
