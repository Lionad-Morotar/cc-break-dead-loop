import { strictEqual, ok } from 'node:assert';
import { describe, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  claudeConfigDir,
  pluginsDir,
  marketplaceDir,
  knownMarketplacesPath,
  installedPluginsPath,
  claudeSettingsPath,
  npmPackageRoot,
  npmPackagePluginDir,
  npmPackageMarketplaceDir,
} from '../../src/cli/utils/paths.mjs';

describe('paths.mjs', () => {
  describe('claudeConfigDir()', () => {
    it('默认返回 ~/.claude', () => {
      const original = process.env.CLAUDE_CONFIG_DIR;
      delete process.env.CLAUDE_CONFIG_DIR;
      strictEqual(claudeConfigDir(), join(homedir(), '.claude'));
      if (original) process.env.CLAUDE_CONFIG_DIR = original;
    });

    it('优先使用 $CLAUDE_CONFIG_DIR 环境变量', () => {
      const original = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = '/custom/claude/config';
      strictEqual(claudeConfigDir(), '/custom/claude/config');
      if (original) process.env.CLAUDE_CONFIG_DIR = original;
      else delete process.env.CLAUDE_CONFIG_DIR;
    });
  });

  describe('pluginsDir()', () => {
    it('返回 ~/.claude/plugins', () => {
      const expected = join(claudeConfigDir(), 'plugins');
      strictEqual(pluginsDir(), expected);
    });
  });

  describe('marketplaceDir(owner)', () => {
    it('返回正确的 marketplace 子目录', () => {
      const expected = join(pluginsDir(), 'marketplaces', 'lionad-morotar');
      strictEqual(marketplaceDir('lionad-morotar'), expected);
    });
  });

  describe('knownMarketplacesPath()', () => {
    it('返回 known_marketplaces.json 路径', () => {
      const expected = join(pluginsDir(), 'known_marketplaces.json');
      strictEqual(knownMarketplacesPath(), expected);
    });
  });

  describe('installedPluginsPath()', () => {
    it('返回 installed_plugins.json 路径', () => {
      const expected = join(pluginsDir(), 'installed_plugins.json');
      strictEqual(installedPluginsPath(), expected);
    });
  });

  describe('claudeSettingsPath()', () => {
    it('返回 settings.json 路径', () => {
      const expected = join(claudeConfigDir(), 'settings.json');
      strictEqual(claudeSettingsPath(), expected);
    });
  });

  describe('npmPackageRoot()', () => {
    it('返回项目根目录的绝对路径', () => {
      const root = npmPackageRoot();
      ok(root.includes('cc-break-dead-loop'), `路径应包含项目名: ${root}`);
    });
  });

  describe('npmPackagePluginDir()', () => {
    it('返回 plugin/ 子目录的绝对路径', () => {
      const expected = join(npmPackageRoot(), 'plugin');
      strictEqual(npmPackagePluginDir(), expected);
    });
  });

  describe('npmPackageMarketplaceDir()', () => {
    it('返回 .claude-plugin/ 子目录的绝对路径', () => {
      const expected = join(npmPackageRoot(), '.claude-plugin');
      strictEqual(npmPackageMarketplaceDir(), expected);
    });
  });
});
