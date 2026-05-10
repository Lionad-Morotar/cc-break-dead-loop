#!/usr/bin/env node

import { loadPluginConfig } from './utils/config.mjs';

const COMMANDS = {
  install: () => import('./commands/install.mjs'),
  uninstall: () => import('./commands/uninstall.mjs'),
  status: () => import('./commands/status.mjs'),
};

/**
 * 解析命令行参数，提取命令名和标志
 * @param {string[]} argv
 * @returns {{ command: string, args: string[], flags: Record<string, boolean|string> }}
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      flags[key] = true;
    } else {
      positional.push(arg);
    }
  }

  return {
    command: positional[0] || '',
    args: positional.slice(1),
    flags,
  };
}

/**
 * 显示帮助信息
 */
export function showHelp() {
  console.log(`
cc-break-dead-loop — Claude Code 插件：自动检测并打断 Read 死循环

用法:
  npx cc-break-dead-loop <command> [options]

命令:
  install      安装插件到 Claude Code
  uninstall    从 Claude Code 卸载插件
  status       查看插件安装状态
  version      显示版本号
  help         显示此帮助信息

选项:
  --purge      uninstall 时使用，同时删除 marketplace 目录
  --ide <ide>  预留：指定目标 IDE（claude, cursor, openclaw 等）

示例:
  npx cc-break-dead-loop install
  npx cc-break-dead-loop uninstall --purge
  npx cc-break-dead-loop status
`);
}

/**
 * 显示版本号
 * @param {{version: string}} config
 */
export function showVersion(config) {
  console.log(`cc-break-dead-loop v${config.version}`);
}

/**
 * CLI 主入口
 */
async function main() {
  const { command, flags } = parseArgs(process.argv);

  const config = await loadPluginConfig().catch((err) => {
    console.error(`错误: ${err.message}`);
    process.exit(1);
  });

  try {
    switch (command) {
      case 'install': {
        const { default: runInstall } = await COMMANDS.install();
        await runInstall(config, flags);
        break;
      }
      case 'uninstall': {
        const { default: runUninstall } = await COMMANDS.uninstall();
        await runUninstall(config, flags);
        break;
      }
      case 'status': {
        const { default: runStatus } = await COMMANDS.status();
        await runStatus(config, flags);
        break;
      }
      case 'version':
        showVersion(config);
        break;
      case 'help':
      case '':
      default:
        showHelp();
        if (command && command !== 'help') {
          console.error(`未知命令: ${command}`);
          process.exit(1);
        }
        break;
    }
  } catch (err) {
    console.error(`错误: ${err.message}`);
    process.exit(1);
  }
}

main();
