/**
 * Node.js Runner：收集 stdin，import main()，透传结果
 * D3: 内部异常时 graceful fallback（异常时 exit 0 + { continue: true }）
 */

import { main } from '../src/index.mjs';

const event = process.argv[2];
let data = '';

const timeout = setTimeout(() => {
  // stdin 5s 超时保护
  finish();
}, 5000);

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  data += chunk;
});

process.stdin.on('end', finish);
process.stdin.on('error', handleError);

async function finish() {
  clearTimeout(timeout);
  try {
    const result = await main(event, data);

    // 阻断标记由 runner 处理
    if (result?.shouldBlock) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ systemMessage: result.systemMessage }));
      process.exit(2);
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch {
    handleError();
  }
}

function handleError() {
  clearTimeout(timeout);
  // D3: 任何异常都静默降级，不阻断 Read
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}
