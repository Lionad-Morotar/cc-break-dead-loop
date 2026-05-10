/**
 * Setup 钩子脚本：检测 Node.js 版本 >= 18
 * 永不阻断 Claude Code 启动（exit 0）
 */

import { spawnSync } from 'node:child_process';

function checkNode() {
  const result = spawnSync('node', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return { ok: false, message: 'Node.js 未安装或不在 PATH 中' };
  }

  const version = result.stdout.trim();
  const majorMatch = version.match(/v(\d+)/);
  if (!majorMatch) {
    return { ok: false, message: `无法解析 Node.js 版本: ${version}` };
  }

  const major = parseInt(majorMatch[1], 10);
  if (major < 18) {
    return { ok: false, message: `Node.js 版本 ${version} 过低，需要 >= v18.0.0` };
  }

  return { ok: true, message: `Node.js ${version}` };
}

function checkGit() {
  const result = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return { ok: false, message: 'Git 未安装（可选，用于解析项目名）' };
  }
  return { ok: true, message: `Git ${result.stdout.trim()}` };
}

const nodeCheck = checkNode();
const gitCheck = checkGit();

if (nodeCheck.ok) {
  // eslint-disable-next-line no-console
  console.log(`[cc-break-dead-loop] Setup: OK (${nodeCheck.message})`);
} else {
  // eslint-disable-next-line no-console
  console.error(`[cc-break-dead-loop] Setup 警告: ${nodeCheck.message}`);
  // eslint-disable-next-line no-console
  console.error('请安装 Node.js >= 18: https://nodejs.org/');
}

if (!gitCheck.ok) {
  // eslint-disable-next-line no-console
  console.error(`[cc-break-dead-loop] Setup 提示: ${gitCheck.message}`);
}

// Setup 永不阻断启动
process.exit(0);
