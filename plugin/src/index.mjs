/**
 * Hook 入口：stdin 解析、handler 分发、统一错误边界
 */

import { postToolUse, preToolUseRead } from './handlers.mjs';

/**
 * 主入口函数
 * @param {string} event - "post-tool-use" 或 "pre-tool-use-read"
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
    default:
      return { continue: true, suppressOutput: true };
  }
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

      // 检查阻断标记
      if (result?.shouldBlock) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ systemMessage: result.systemMessage }));
        process.exit(2);
      }

      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result));
      process.exit(0);
    } catch {
      // D5: 任何内部错误都返回 { continue: true } 静默失败
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
