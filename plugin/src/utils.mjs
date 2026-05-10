/**
 * 工具函数：路径安全化 + Git 仓库名解析
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * 将名称安全化为文件系统可用的目录名
 * - 只保留 [a-zA-Z0-9-]
 * - 去除首尾 -
 * - 限制最大长度 64 字符
 * - 空结果 fallback 到 "unknown"
 * @param {string} name
 * @returns {string}
 */
export function sanitizeName(name) {
  if (!name || typeof name !== 'string') {
    return 'unknown';
  }
  let safe = name.replace(/[^a-zA-Z0-9-]/g, '-');
  safe = safe.replace(/^-+|-+$/g, '');
  safe = safe.slice(0, 64);
  return safe || 'unknown';
}

/**
 * 获取项目名称
 * 优先从 git remote 提取仓库名，失败时 fallback 到 cwd 的文件夹名
 * @param {string} cwd
 * @returns {string}
 */
export function getProjectName(cwd) {
  if (!cwd) {
    return sanitizeName('unknown');
  }

  // 尝试 git remote
  try {
    const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.status === 0 && result.stdout) {
      const url = result.stdout.trim();
      // 解析 URL 提取仓库名
      // 支持 https://github.com/user/repo.git 和 git@github.com:user/repo.git
      const match = url.match(/[:/]([^/]+?)\/?(?:\.git)?$/);
      if (match) {
        return sanitizeName(match[1]);
      }
    }
  } catch {
    // git 命令失败，静默 fallback
  }

  // fallback 到文件夹名
  return sanitizeName(path.basename(cwd));
}
