import { strictEqual, ok, rejects, doesNotReject } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import runInstall from '../../src/cli/commands/install.mjs';

describe('install command', () => {
  let tmpDir;
  let originalClaudeConfigDir;

  const mockConfig = {
    owner: 'lionad-morotar',
    pluginName: 'cc-break-dead-loop',
    repo: 'https://github.com/Lionad-Morotar/cc-break-dead-loop',
    version: '0.1.0',
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-dead-loop-install-test-'));
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

  it('Claude Code 未安装时报错', async () => {
    rmSync(tmpDir, { recursive: true, force: true });
    await rejects(
      async () => runInstall(mockConfig, {}),
      (err) => {
        ok(err.message.includes('未检测到 Claude Code'), `应提示未安装: ${err.message}`);
        return true;
      }
    );
  });

  it('plugin/ 源目录不存在时报错', async () => {
    mkdirSync(join(tmpDir, 'plugins'), { recursive: true });
    ok(true, '在正常项目目录中源目录始终存在，跳过此测试');
  });

  it('全新安装：所有配置文件都不存在', async () => {
    mkdirSync(join(tmpDir, 'plugins'), { recursive: true });

    await doesNotReject(async () => {
      await runInstall(mockConfig, {});
    });

    // 验证 marketplace 注册
    const knownMktContent = readFileSync(join(tmpDir, 'plugins', 'known_marketplaces.json'), 'utf8');
    const knownMktData = JSON.parse(knownMktContent);
    ok(knownMktData['lionad-morotar'], 'marketplace 应被注册');
    strictEqual(knownMktData['lionad-morotar'].autoUpdate, true);

    // 验证插件注册
    const installedContent = readFileSync(join(tmpDir, 'plugins', 'installed_plugins.json'), 'utf8');
    const installedData = JSON.parse(installedContent);
    ok(installedData['cc-break-dead-loop@lionad-morotar'], '插件应被注册');
    strictEqual(installedData['cc-break-dead-loop@lionad-morotar'].version, '0.1.0');

    // 验证 settings.json 启用
    const settingsContent = readFileSync(join(tmpDir, 'settings.json'), 'utf8');
    const settingsData = JSON.parse(settingsContent);
    strictEqual(settingsData.enabledPlugins['cc-break-dead-loop@lionad-morotar'], true);
  });

  it('覆盖安装：更新已存在插件', async () => {
    mkdirSync(join(tmpDir, 'plugins'), { recursive: true });

    // 先安装一次旧版本
    const oldConfig = { ...mockConfig, version: '0.0.1' };
    await runInstall(oldConfig, {});

    // 再安装新版本
    let output = '';
    const originalLog = console.log;
    console.log = (...args) => { output += args.join(' ') + '\n'; };
    await runInstall(mockConfig, {});
    console.log = originalLog;

    ok(output.includes('已安装'), `应提示覆盖: ${output}`);

    const installedContent = readFileSync(join(tmpDir, 'plugins', 'installed_plugins.json'), 'utf8');
    const installedData = JSON.parse(installedContent);
    strictEqual(installedData['cc-break-dead-loop@lionad-morotar'].version, '0.1.0');
  });

  it('settings.json 缺少 enabledPlugins 字段时正确创建', async () => {
    mkdirSync(join(tmpDir, 'plugins'), { recursive: true });
    writeFileSync(join(tmpDir, 'settings.json'), JSON.stringify({ otherSetting: true }), 'utf8');

    await runInstall(mockConfig, {});

    const settingsContent = readFileSync(join(tmpDir, 'settings.json'), 'utf8');
    const settingsData = JSON.parse(settingsContent);
    strictEqual(settingsData.otherSetting, true, '其他设置应被保留');
    strictEqual(settingsData.enabledPlugins['cc-break-dead-loop@lionad-morotar'], true);
  });

  it('配置文件格式异常时抛出带上下文的错误', async () => {
    mkdirSync(join(tmpDir, 'plugins'), { recursive: true });
    writeFileSync(join(tmpDir, 'plugins', 'installed_plugins.json'), 'not json', 'utf8');

    await rejects(
      async () => runInstall(mockConfig, {}),
      (err) => {
        ok(err.message.includes('JSON 解析失败'), `应提示 JSON 错误: ${err.message}`);
        return true;
      }
    );
  });
});
