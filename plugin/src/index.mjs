/**
 * Hook 入口：stdin 解析、handler 分发、统一错误边界
 */

import { postToolUse, preToolUseRead } from './handlers.mjs';
import { buildInjection } from './hookInjector.mjs';
import { ALERTS_FILE } from './config.mjs';

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
    default:
      return { continue: true, suppressOutput: true };
  }
}

/**
 * PostToolUse（matcher:"*"）：注入子 Agent 死循环告警
 * 与 post-tool-use（Read 专属）共存，本 handler 只负责 watcher 告警注入
 */
function postToolUseAnyAlert(input) {
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
