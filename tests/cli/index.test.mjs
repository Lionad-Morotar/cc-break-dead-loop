import { strictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';
import { parseArgs, showHelp, showVersion } from '../../src/cli/index.mjs';

describe('CLI index.mjs', () => {
  describe('parseArgs()', () => {
    it('解析 install 命令', () => {
      const result = parseArgs(['node', 'cli', 'install']);
      strictEqual(result.command, 'install');
      strictEqual(result.args.length, 0);
    });

    it('解析 uninstall --purge 命令', () => {
      const result = parseArgs(['node', 'cli', 'uninstall', '--purge']);
      strictEqual(result.command, 'uninstall');
      strictEqual(result.flags.purge, true);
    });

    it('解析 --ide cursor 标志', () => {
      const result = parseArgs(['node', 'cli', 'install', '--ide', 'cursor']);
      strictEqual(result.command, 'install');
      strictEqual(result.flags.ide, 'cursor');
    });

    it('无命令时返回空字符串', () => {
      const result = parseArgs(['node', 'cli']);
      strictEqual(result.command, '');
    });

    it('解析多个位置参数', () => {
      const result = parseArgs(['node', 'cli', 'cmd', 'arg1', 'arg2']);
      strictEqual(result.command, 'cmd');
      strictEqual(result.args[0], 'arg1');
      strictEqual(result.args[1], 'arg2');
    });

    it('解析短标志', () => {
      const result = parseArgs(['node', 'cli', 'cmd', '-f']);
      strictEqual(result.flags.f, true);
    });
  });

  describe('showHelp()', () => {
    it('输出包含所有命令', () => {
      let output = '';
      const original = console.log;
      console.log = (...args) => { output += args.join(' ') + '\n'; };
      showHelp();
      console.log = original;

      ok(output.includes('install'), '应包含 install 命令');
      ok(output.includes('uninstall'), '应包含 uninstall 命令');
      ok(output.includes('status'), '应包含 status 命令');
      ok(output.includes('version'), '应包含 version 命令');
      ok(output.includes('--purge'), '应包含 --purge 选项');
      ok(output.includes('--ide'), '应包含 --ide 选项');
    });
  });

  describe('showVersion()', () => {
    it('输出版本号', () => {
      let output = '';
      const original = console.log;
      console.log = (...args) => { output += args.join(' ') + '\n'; };
      showVersion({ version: '0.1.0' });
      console.log = original;

      ok(output.includes('cc-break-dead-loop v0.1.0'), `应包含版本号: ${output}`);
    });
  });
});
