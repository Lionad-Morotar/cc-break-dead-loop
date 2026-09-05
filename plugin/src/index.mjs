/**
 * Hook 入口：stdin 解析、handler 分发、统一错误边界
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postToolUse, preToolUseRead } from './handlers.mjs';
import { buildInjection } from './hookInjector.mjs';
import { buildSessionStartAdvice } from './sessionStartAdvice.mjs';
import { ensureWatcherRunning } from './watcherLifecycle.mjs';
import {
  ALERTS_FILE,
  HEARTBEAT_FILE,
  PID_FILE,
  WATCHER_STALE_TIMEOUT_MS,
} from './config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WATCHER_SCRIPT = join(here, '..', 'scripts', 'watcher.mjs');

/**
 * watcher 保活：心跳超时则（重）启常驻进程，失败静默不阻断 hook。
 *
 * 接线在 SessionStart/Stop/PostToolUse 而非 Setup——Setup 仅在
 * --init/--maintenance 等特殊触发下执行，普通交互会话永不运行，
 * 曾导致 watcher 长期无人拉起、子代理死循环防线整体失效。
 * 心跳文件本身即节流器：新鲜时 decideAction 判 none，开销仅一次文件读取，
 * 因此每个 hook 事件都调用也足够廉价。
 */
function ensureWatcherAlive() {
  try {
    return ensureWatcherRunning({
      watcherScript: WATCHER_SCRIPT,
      heartbeatFile: HEARTBEAT_FILE,
      pidFile: PID_FILE,
      staleTimeoutMs: WATCHER_STALE_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
}

/**
 * 主入口函数
 * @param {string} event - hook 事件名
 * @param {string} stdinData - stdin 注入的 JSON 字符串
 */
export async function main(event, stdinData) {
  let input;
  try {
    input = JSON.parse(stdinData || '{}');
  } catch {
    return { continue: true, suppressOutput: true };
  }

  switch (event) {
    case 'post-tool-use':
      return postToolUse(input);
    case 'pre-tool-use-read':
      return preToolUseRead(input);
    case 'post-tool-use-any':
      return postToolUseAnyAlert(input);
    case 'stop':
      return stopAlert(input);
    case 'session-start':
      ensureWatcherAlive();
      return sessionStartAdvice();
    default:
      return { continue: true, suppressOutput: true };
  }
}

/**
 * SessionStart：会话启动时注入子代理使用建议（引导优先用后台子代理）
 */
function sessionStartAdvice() {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: buildSessionStartAdvice(),
    },
  };
}

/**
 * PostToolUse（matcher:"*"）：注入子 Agent 死循环告警
 * 与 post-tool-use（Read 专属）共存，本 handler 只负责 watcher 告警注入
 */
function postToolUseAnyAlert(input) {
  // 保活兜底：PostToolUse 是最高频 hook，watcher 中途死亡（睡眠/OOM/手滑 kill）
  // 在下一次工具调用即自愈，覆盖 SessionStart matcher 触达不到的 resume 长会话
  ensureWatcherAlive();

  const sessionId = input?.session_id;
  if (!sessionId) {
    return { continue: true, suppressOutput: true };
  }

  const injection = buildInjection({
    filePath: ALERTS_FILE,
    sessionId,
    event: 'PostToolUse',
  });

  if (!injection) {
    return { continue: true, suppressOutput: true };
  }

  return {
    continue: true,
    suppressOutput: false,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: injection.additionalContext,
    },
  };
}

/**
 * Stop：主 Agent 结束 turn 时注入子 Agent 死循环告警
 * 返回 shouldBlock + systemMessage，由 node-runner 翻译为 exit 2 + stderr
 * 触发 Claude Code 的 blockingError 机制，强制主 Agent continue turn
 */
function stopAlert(input) {
  // 保活兜底：turn 边界是死循环告警的消费点，watcher 死亡时此处自愈
  ensureWatcherAlive();

  const sessionId = input?.session_id;
  if (!sessionId) {
    return { continue: true, suppressOutput: true };
  }

  const injection = buildInjection({
    filePath: ALERTS_FILE,
    sessionId,
    event: 'Stop',
  });

  if (!injection) {
    return { continue: true, suppressOutput: true };
  }

  return {
    shouldBlock: true,
    systemMessage: injection.blockingError,
  };
}

// CLI 入口：node src/index.mjs <event>
if (import.meta.url === `file://${process.argv[1]}`) {
  const event = process.argv[2];
  let data = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    data += chunk;
  });

  process.stdin.on('end', async () => {
    try {
      const result = await main(event, data);

      // Stop hook 的 blockingError：exit 2 + stderr 触发 Claude Code 强制 continue
      if (result?.shouldBlock) {
        process.stderr.write(result.systemMessage);
        process.exit(2);
      }

      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result));
      process.exit(0);
    } catch {
      // 任何内部错误都返回 { continue: true } 静默失败
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      process.exit(0);
    }
  });

  process.stdin.on('error', () => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    process.exit(0);
  });
}
