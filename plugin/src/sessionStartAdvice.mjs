/**
 * SessionStart 注入：引导主 agent 优先使用后台子代理
 *
 * 缓解前台同步子代理死循环的架构死结——前台子代理（run_in_background:false）死循环时
 * 主 agent 阻塞在 Agent 工具里、turn 不结束，Stop/PostToolUse hook 都不触发，
 * 本插件的拦截链路够不到主 agent。此处仅在会话启动时给主 agent 一段建议性提示，
 * 属预防性劝说，对已失控的子代理无效。
 */

/**
 * 构造 SessionStart 注入文案
 * @returns {string}
 */
export function buildSessionStartAdvice() {
  return `## 子代理使用提示 · cc-break-dead-loop

派出子代理（Agent 工具）执行可能反复重试或耗时的任务时，优先使用 \`run_in_background: true\`（后台异步），而非默认的前台同步调用。

原因：前台同步子代理一旦陷入死循环，主代理会阻塞等待、不结束 turn，本插件的拦截链路（Stop hook → TaskStopTool）无法触发，只能靠用户手动 Esc 中断。后台子代理则可被插件正常检测并终止。`;
}
