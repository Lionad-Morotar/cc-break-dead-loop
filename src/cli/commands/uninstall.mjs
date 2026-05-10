import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import {
  marketplaceDir,
  knownMarketplacesPath,
  installedPluginsPath,
  claudeSettingsPath,
} from '../utils/paths.mjs';
import { readJsonFile, writeJsonFile } from '../utils/fs.mjs';

/**
 * 从 Claude Code 卸载插件
 * @param {{owner: string, pluginName: string, repo: string, version: string}} config
 * @param {Record<string, boolean|string>} flags
 */
export default async function runUninstall(config, flags) {
  const pluginId = `${config.pluginName}@${config.owner}`;
  const owner = config.owner;

  // 读取已安装插件列表
  const installedPlugins = await readJsonFile(installedPluginsPath());
  if (!installedPlugins[pluginId]) {
    console.log(`插件 ${pluginId} 未安装。`);
    return;
  }

  // 从 installed_plugins.json 中移除
  delete installedPlugins[pluginId];
  await writeJsonFile(installedPluginsPath(), installedPlugins);

  // 从 settings.json 的 enabledPlugins 中移除
  const settings = await readJsonFile(claudeSettingsPath());
  if (settings.enabledPlugins) {
    delete settings.enabledPlugins[pluginId];
    await writeJsonFile(claudeSettingsPath(), settings);
  }

  // --purge 模式：同时删除 marketplace 目录和注册
  if (flags.purge) {
    const mktDir = marketplaceDir(owner);
    if (existsSync(mktDir)) {
      await rm(mktDir, { recursive: true, force: true });
    }

    const knownMarketplaces = await readJsonFile(knownMarketplacesPath());
    if (knownMarketplaces[owner]) {
      delete knownMarketplaces[owner];
      await writeJsonFile(knownMarketplacesPath(), knownMarketplaces);
    }

    console.log(`✓ ${pluginId} 已完全卸载（包含 marketplace 目录）。`);
  } else {
    console.log(`✓ ${pluginId} 已卸载。`);
    console.log(`  marketplace 目录已保留，供其他插件复用。`);
    console.log(`  如需彻底清理，请使用: npx cc-break-dead-loop uninstall --purge`);
  }
}
