/**
 * 桌面通知：watcher 检测到活跃死循环时提醒用户手动中断
 *
 * 缓解前台同步子代理死循环的架构死结——主 agent 阻塞时插件够不到它，
 * 只能把死循环信号送到用户眼前。watcher 是 detached 进程，无控制终端，
 * 故用系统桌面通知（macOS osascript / Linux notify-send）而非终端响铃。
 * 任何失败静默吞掉，绝不影响 watcher 主流程。
 */

import { execFileSync } from 'node:child_process';

/** 默认执行函数：同步执行系统命令 */
function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, opts);
}

/** 转义双引号与反斜杠，防 osascript / shell 注入 */
function escape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 检测到活跃死循环时发桌面通知
 *
 * 仅 darwin/linux 实发，其他平台静默跳过；任何错误静默吞掉。
 * 通过 deps 注入 exec/platform 便于测试（项目无 vi.mock 先例，沿用依赖注入风格）。
 *
 * @param {{ agentType?: string, toolName: string, repeatCount: number }} info
 * @param {{ exec?: Function, platform?: string }} [deps]
 */
export function notifyDeadLoop(info, deps = {}) {
  const exec = deps.exec ?? defaultExec;
  const platform = deps.platform ?? process.platform;
  const agentType = info?.agentType || '子代理';
  const title = '[cc-break-dead-loop] 子代理疑似死循环';
  const message =
    `${agentType} 连续 ${info?.repeatCount ?? '?'} 次相同的 ${info?.toolName ?? '?'} 调用。` +
    `前台子代理无法自动拦截，如需中断请手动 Esc。`;

  try {
    if (platform === 'darwin') {
      exec(
        'osascript',
        ['-e', `display notification "${escape(message)}" with title "${escape(title)}"`],
        { timeout: 3000 },
      );
    } else if (platform === 'linux') {
      exec('notify-send', [title, message], { timeout: 3000 });
    }
    // 其他平台（win32 等）：静默跳过
  } catch {
    // 通知失败绝不影响 watcher
  }
}
