import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 获取 Claude Code 配置目录路径
 * 优先使用 $CLAUDE_CONFIG_DIR 环境变量，否则使用 ~/.claude
 * @returns {string}
 */
export function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

/**
 * 获取 Claude Code 插件根目录
 * @returns {string}
 */
export function pluginsDir() {
  return join(claudeConfigDir(), 'plugins');
}

/**
 * 获取本插件的 marketplace 安装目录
 * @param {string} owner - marketplace owner 名称
 * @returns {string}
 */
export function marketplaceDir(owner) {
  return join(pluginsDir(), 'marketplaces', owner);
}

/**
 * 获取已知 marketplace 注册表文件路径
 * @returns {string}
 */
export function knownMarketplacesPath() {
  return join(pluginsDir(), 'known_marketplaces.json');
}

/**
 * 获取已安装插件注册表文件路径
 * @returns {string}
 */
export function installedPluginsPath() {
  return join(pluginsDir(), 'installed_plugins.json');
}

/**
 * 获取 Claude Code 用户设置文件路径
 * @returns {string}
 */
export function claudeSettingsPath() {
  return join(claudeConfigDir(), 'settings.json');
}

/**
 * 从当前文件位置向上回溯到 npm package 根目录
 * @returns {string}
 */
export function npmPackageRoot() {
  // 从 src/cli/utils/ 向上回溯 3 层到项目根目录
  return resolve(__dirname, '..', '..', '..');
}

/**
 * 获取 package 中 plugin/ 子目录的绝对路径
 * @returns {string}
 */
export function npmPackagePluginDir() {
  return join(npmPackageRoot(), 'plugin');
}

/**
 * 获取 package 中 .claude-plugin/ 子目录的绝对路径
 * @returns {string}
 */
export function npmPackageMarketplaceDir() {
  return join(npmPackageRoot(), '.claude-plugin');
}
