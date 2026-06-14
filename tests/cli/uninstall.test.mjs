import { strictEqual, ok } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import runUninstall from '../../src/cli/commands/uninstall.mjs';

describe('uninstall command', () => {
  let tmpDir;
  let originalClaudeConfigDir;

  const mockConfig = {
    owner: 'lionad-morotar',
    pluginName: 'cc-break-dead-loop',
    repo: 'https://github.com/Lionad-Morotar/cc-break-dead-loop',
    version: '0.1.0',
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-dead-loop-uninstall-test-'));
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

  function setupInstalledState() {
    mkdirSync(join(tmpDir, 'plugins', 'marketplaces', 'lionad-morotar', 'plugin'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        'cc-break-dead-loop@lionad-morotar': {
          scope: 'user',
          installPath: join(tmpDir, 'plugins', 'marketplaces', 'lionad-morotar'),
          version: '0.1.0',
          installedAt: '2024-01-01T00:00:00.000Z',
        },
      }),
      'utf8'
    );
    writeFileSync(
      join(tmpDir, 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'cc-break-dead-loop@lionad-morotar': true,
          'other-plugin@someone': true,
        },
      }),
      'utf8'
    );
    writeFileSync(
      join(tmpDir, 'plugins', 'known_marketplaces.json'),
      JSON.stringify({
        'lionad-morotar': {
          source: { source: 'github', repo: 'Lionad-Morotar/cc-break-dead-loop' },
          autoUpdate: true,
        },
      }),
      'utf8'
    );
  }

  it('卸载已安装插件，清理配置文件', async () => {
    setupInstalledState();

    let output = '';
    const originalLog = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    await runUninstall(mockConfig, {});
    console.log = originalLog;

    ok(output.includes('已卸载'), `应提示卸载成功: ${output}`);

    // 验证 installed_plugins.json 已清理
    const installed = JSON.parse(readFileSync(join(tmpDir, 'plugins', 'installed_plugins.json'), 'utf8'));
    strictEqual(installed['cc-break-dead-loop@lionad-morotar'], undefined, '插件应从注册表中移除');

    // 验证 settings.json 已清理但保留其他插件
    const settings = JSON.parse(readFileSync(join(tmpDir, 'settings.json'), 'utf8'));
    strictEqual(settings.enabledPlugins['cc-break-dead-loop@lionad-morotar'], undefined, '应从 enabledPlugins 中移除');
    strictEqual(settings.enabledPlugins['other-plugin@someone'], true, '其他插件应保留');

    // 默认保留 marketplace 目录
    ok(existsSync(join(tmpDir, 'plugins', 'marketplaces', 'lionad-morotar')), 'marketplace 目录应保留');
  });

  it('卸载未安装的插件，优雅退出', async () => {
    mkdirSync(join(tmpDir, 'plugins'), { recursive: true });

    let output = '';
    const originalLog = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    await runUninstall(mockConfig, {});
    console.log = originalLog;

    ok(output.includes('未安装'), `应提示未安装: ${output}`);
  });

  it('--purge 模式彻底清理 marketplace 目录', async () => {
    setupInstalledState();

    let output = '';
    const originalLog = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    await runUninstall(mockConfig, { purge: true });
    console.log = originalLog;

    ok(output.includes('完全卸载'), `应提示彻底卸载: ${output}`);

    // marketplace 目录应被删除
    ok(!existsSync(join(tmpDir, 'plugins', 'marketplaces', 'lionad-morotar')), 'marketplace 目录应被删除');

    // known_marketplaces.json 应被清理
    const knownMkt = JSON.parse(readFileSync(join(tmpDir, 'plugins', 'known_marketplaces.json'), 'utf8'));
    strictEqual(knownMkt['lionad-morotar'], undefined, 'marketplace 注册应被移除');
  });

  it('enabledPlugins 只有本插件时变为空对象', async () => {
    setupInstalledState();
    writeFileSync(
      join(tmpDir, 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'cc-break-dead-loop@lionad-morotar': true,
        },
      }),
      'utf8'
    );

    await runUninstall(mockConfig, {});

    const settings = JSON.parse(readFileSync(join(tmpDir, 'settings.json'), 'utf8'));
    strictEqual(Object.keys(settings.enabledPlugins).length, 0, 'enabledPlugins 应为空对象');
  });
});
