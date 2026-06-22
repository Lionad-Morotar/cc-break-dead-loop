/**
 * SessionStart 注入：强制引导主 agent 使用后台子代理
 *
 * 缓解前台同步子代理死循环的架构死结——前台子代理（run_in_background:false）死循环时
 * 主 agent 阻塞在 Agent 工具里、turn 不结束，Stop/PostToolUse hook 都不触发，
 * 本插件的拦截链路够不到主 agent。此处仅在会话启动时给主 agent 一段强制性提示，
 * 属预防性规则声明，对已失控的子代理无效。
 */

/**
 * 构造 SessionStart 注入文案
 * @returns {string}
 */
export function buildSessionStartAdvice() {
  return `## Plugin cc-break-dead-loop Rules

子代理必须使用 \`run_in_background: true\`（后台异步模式），禁止使用默认的前台同步模式，以防无法退出的死循环。`;
}
