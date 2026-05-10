import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { npmPackageMarketplaceDir, npmPackageRoot } from './paths.mjs';

/**
 * 从 marketplace.json 和 package.json 动态读取插件标识信息
 * 避免在 CLI 代码中硬编码 owner、plugin name、repo 等信息（审查决定 D3）
 * @returns {Promise<{owner: string, pluginName: string, repo: string, version: string}>}
 */
export async function loadPluginConfig() {
  const marketplacePath = join(npmPackageMarketplaceDir(), 'marketplace.json');
  const packagePath = join(npmPackageRoot(), 'package.json');

  let marketplaceData;
  let packageData;

  try {
    marketplaceData = JSON.parse(await readFile(marketplacePath, 'utf8'));
  } catch (err) {
    throw new Error(
      `无法读取 marketplace.json: ${marketplacePath}\n` +
      `请确保从 npm package 根目录运行此命令。`
    );
  }

  try {
    packageData = JSON.parse(await readFile(packagePath, 'utf8'));
  } catch (err) {
    throw new Error(
      `无法读取 package.json: ${packagePath}\n` +
      `请确保从 npm package 根目录运行此命令。`
    );
  }

  const owner = marketplaceData.name;
  const pluginEntry = marketplaceData.plugins?.[0];

  if (!owner || !pluginEntry) {
    throw new Error(
      `marketplace.json 格式错误: 缺少 name 或 plugins 字段`
    );
  }

  return {
    owner,
    pluginName: pluginEntry.name,
    repo: packageData.repository?.url?.replace(/\.git$/, '') || packageData.homepage || '',
    version: pluginEntry.version || packageData.version || '0.0.0',
  };
}
