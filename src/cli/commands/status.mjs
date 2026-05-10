import { existsSync } from 'node:fs';
import {
  marketplaceDir,
  installedPluginsPath,
  claudeSettingsPath,
} from '../utils/paths.mjs';
import { readJsonFile } from '../utils/fs.mjs';

/**
 * 检查插件安装状态
 * @param {{owner: string, pluginName: string, repo: string, version: string}} config
 * @param {Record<string, boolean|string>} flags
 */
export default async function runStatus(config, flags) {
  const pluginId = `${config.pluginName}@${config.owner}`;
  const owner = config.owner;

  // 检查各项状态
  const pluginFilesExist = existsSync(`${marketplaceDir(owner)}/plugin/.claude-plugin/plugin.json`);

  const installedPlugins = await readJsonFile(installedPluginsPath());
  const isRegistered = !!installedPlugins[pluginId];

  const settings = await readJsonFile(claudeSettingsPath());
  const isEnabled = !!settings.enabledPlugins?.[pluginId];

  const knownMarketplaces = await readJsonFile(
    (await import('../utils/paths.mjs')).knownMarketplacesPath()
  );
  const isMarketplaceRegistered = !!knownMarketplaces[owner];

  // 输出状态报告
  console.log(`\ncc-break-dead-loop v${config.version}`);
  console.log('─────────────────────────');

  if (!pluginFilesExist && !isRegistered && !isEnabled) {
    console.log('状态: 未安装');
    console.log('');
    console.log('安装命令:');
    console.log('  npx cc-break-dead-loop install');
    return;
  }

  console.log(`Plugin files:    ${pluginFilesExist ? '✓ installed' : '✗ missing'}`);
  console.log(`Marketplace reg: ${isMarketplaceRegistered ? '✓ registered' : '✗ missing'}`);
  console.log(`Plugin reg:      ${isRegistered ? '✓ registered' : '✗ missing'}`);
  console.log(`Enabled:         ${isEnabled ? '✓ enabled' : '✗ disabled'}`);

  if (!pluginFilesExist || !isRegistered || !isEnabled) {
    console.log('');
    console.log('提示: 部分状态异常，建议重新安装:');
    console.log('  npx cc-break-dead-loop install');
  }
}
