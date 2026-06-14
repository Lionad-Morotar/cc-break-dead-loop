import { ok } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import runStatus from '../../src/cli/commands/status.mjs';

describe('status command', () => {
  let tmpDir;
  let originalClaudeConfigDir;

  const mockConfig = {
    owner: 'lionad-morotar',
    pluginName: 'cc-break-dead-loop',
    repo: 'https://github.com/Lionad-Morotar/cc-break-dead-loop',
    version: '0.1.0',
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-dead-loop-status-test-'));
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalClaudeConfigDir !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('显示完整安装状态（全部 ✓）', async () => {
    mkdirSync(join(tmpDir, 'plugins', 'marketplaces', 'lionad-morotar', 'plugin', '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'plugins', 'marketplaces', 'lionad-morotar', 'plugin', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'cc-break-dead-loop' }),
      'utf8'
    );
    writeFileSync(
      join(tmpDir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ 'cc-break-dead-loop@lionad-morotar': { version: '0.1.0' } }),
      'utf8'
    );
    writeFileSync(
      join(tmpDir, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'cc-break-dead-loop@lionad-morotar': true } }),
      'utf8'
    );
    writeFileSync(
      join(tmpDir, 'plugins', 'known_marketplaces.json'),
      JSON.stringify({ 'lionad-morotar': { autoUpdate: true } }),
      'utf8'
    );

    let output = '';
    const originalLog = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    await runStatus(mockConfig, {});
    console.log = originalLog;

    ok(output.includes('cc-break-dead-loop v0.1.0'), `应包含版本号: ${output}`);
    ok(output.includes('✓ installed'), `应显示文件已安装: ${output}`);
    ok(output.includes('✓ registered'), `应显示已注册: ${output}`);
    ok(output.includes('✓ enabled'), `应显示已启用: ${output}`);
    ok(!output.includes('npx cc-break-dead-loop install'), '已安装时不应提示安装命令');
  });

  it('显示未安装状态并提示安装命令', async () => {
    mkdirSync(join(tmpDir, 'plugins'), { recursive: true });

    let output = '';
    const originalLog = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    await runStatus(mockConfig, {});
    console.log = originalLog;

    ok(output.includes('未安装'), `应提示未安装: ${output}`);
    ok(output.includes('npx cc-break-dead-loop install'), `应提示安装命令: ${output}`);
  });

  it('部分安装状态显示异常提示', async () => {
    // 只注册插件，但不启用、不复制文件
    mkdirSync(join(tmpDir, 'plugins'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ 'cc-break-dead-loop@lionad-morotar': { version: '0.1.0' } }),
      'utf8'
    );
    writeFileSync(
      join(tmpDir, 'settings.json'),
      JSON.stringify({ enabledPlugins: {} }),
      'utf8'
    );

    let output = '';
    const originalLog = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    await runStatus(mockConfig, {});
    console.log = originalLog;

    ok(output.includes('✗ missing') || output.includes('✗ disabled'), `应显示异常状态: ${output}`);
    ok(output.includes('建议重新安装'), `应提示重新安装: ${output}`);
  });
});
