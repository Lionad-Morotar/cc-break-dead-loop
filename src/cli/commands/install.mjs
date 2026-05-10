import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import {
  claudeConfigDir,
  marketplaceDir,
  knownMarketplacesPath,
  installedPluginsPath,
  claudeSettingsPath,
  npmPackagePluginDir,
} from '../utils/paths.mjs';
import { readJsonFile, writeJsonFile, copyDir } from '../utils/fs.mjs';

/**
 * 验证 Claude Code 配置文件的基本格式
 * 防御性检查，防止因格式异常导致数据损坏（审查决定 D2）
 * @param {string} filePath
 * @param {any} data
 * @param {string} context
 */
function validateConfigFormat(filePath, data, context) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      `${context} 格式错误: ${filePath}\n` +
      `期望一个对象，但得到了 ${data === null ? 'null' : Array.isArray(data) ? '数组' : typeof data}。\n` +
      `请备份并删除此文件后重试。`
    );
  }
}

/**
 * 安装插件到 Claude Code
 * @param {{owner: string, pluginName: string, repo: string, version: string}} config
 * @param {Record<string, boolean|string>} flags
 */
export default async function runInstall(config, flags) {
  const pluginId = `${config.pluginName}@${config.owner}`;
  const owner = config.owner;

  // 1. 检测 Claude Code 是否安装
  const claudeDir = claudeConfigDir();
  if (!existsSync(claudeDir)) {
    throw new Error(
      `未检测到 Claude Code 配置目录: ${claudeDir}\n` +
      `请先安装 Claude Code 后再运行此命令。`
    );
  }

  // 2. 检查 plugin/ 源目录是否存在
  const srcPluginDir = npmPackagePluginDir();
  if (!existsSync(srcPluginDir)) {
    throw new Error(
      `未找到插件源目录: ${srcPluginDir}\n` +
      `请确保从 npm package 根目录运行此命令（npx cc-break-dead-loop install）。`
    );
  }

  // 3. 检查是否已安装
  const installedPlugins = await readJsonFile(installedPluginsPath());
  validateConfigFormat(installedPluginsPath(), installedPlugins, 'installed_plugins.json');

  const alreadyInstalled = Object.keys(installedPlugins).some(
    (key) => key === pluginId || key.startsWith(`${config.pluginName}@`)
  );

  if (alreadyInstalled) {
    console.log(`插件 ${pluginId} 已安装，正在覆盖更新...`);
  }

  // 4. 复制插件文件到 marketplace
  const destPluginDir = `${marketplaceDir(owner)}/plugin`;
  if (existsSync(destPluginDir)) {
    await rm(destPluginDir, { recursive: true, force: true });
  }
  await copyDir(srcPluginDir, destPluginDir);

  // 5. 注册 marketplace
  const knownMarketplaces = await readJsonFile(knownMarketplacesPath());
  validateConfigFormat(knownMarketplacesPath(), knownMarketplaces, 'known_marketplaces.json');

  knownMarketplaces[owner] = {
    source: { source: 'github', repo: config.repo.replace('https://github.com/', '') },
    installLocation: marketplaceDir(owner),
    lastUpdated: new Date().toISOString(),
    autoUpdate: true,
  };
  await writeJsonFile(knownMarketplacesPath(), knownMarketplaces);

  // 6. 注册插件
  installedPlugins[pluginId] = {
    scope: 'user',
    installPath: marketplaceDir(owner),
    version: config.version,
    installedAt: installedPlugins[pluginId]?.installedAt || new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
  await writeJsonFile(installedPluginsPath(), installedPlugins);

  // 7. 启用插件
  const settings = await readJsonFile(claudeSettingsPath());
  validateConfigFormat(claudeSettingsPath(), settings, 'settings.json');

  if (!settings.enabledPlugins) {
    settings.enabledPlugins = {};
  }
  settings.enabledPlugins[pluginId] = true;
  await writeJsonFile(claudeSettingsPath(), settings);

  console.log(`✓ ${pluginId} v${config.version} 安装成功！`);
  console.log(`  安装路径: ${destPluginDir}`);
  console.log(`  重启 Claude Code 后插件生效。`);
}
