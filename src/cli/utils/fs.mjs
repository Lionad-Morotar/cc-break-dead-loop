import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * 读取 JSON 文件，不存在时返回空对象
 * 若 JSON 格式损坏，抛出带上下文的自定义错误
 * @param {string} filePath
 * @returns {Promise<Record<string, any>>}
 */
export async function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  const content = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(
      `JSON 解析失败: ${filePath}\n` +
      `原因: ${err.message}\n` +
      `请检查文件是否被手动编辑或损坏，必要时可删除后重试。`
    );
  }
}

/**
 * 原子写入 JSON 文件（先写临时文件再 rename）
 * @param {string} filePath
 * @param {any} data
 * @returns {Promise<void>}
 */
export async function writeJsonFile(filePath, data) {
  const dir = dirname(filePath);
  await ensureDir(dir);
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(tmpPath, filePath);
}

/**
 * 递归创建目录（若已存在则静默通过）
 * @param {string} dirPath
 * @returns {Promise<void>}
 */
export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

/**
 * 递归复制目录
 * @param {string} src - 源目录
 * @param {string} dest - 目标目录
 * @param {number} maxDepth - 最大递归深度，防止符号链接循环
 * @param {number} currentDepth - 当前深度（内部使用）
 * @returns {Promise<void>}
 */
export async function copyDir(src, dest, maxDepth = 10, currentDepth = 0) {
  if (currentDepth > maxDepth) {
    throw new Error(`copyDir 递归深度超过限制 (${maxDepth}): ${src}`);
  }

  await ensureDir(dest);

  const items = await readdir(src, { withFileTypes: true });

  for (const item of items) {
    const srcPath = join(src, item.name);
    const destPath = join(dest, item.name);

    if (item.isDirectory()) {
      await copyDir(srcPath, destPath, maxDepth, currentDepth + 1);
    } else if (item.isSymbolicLink()) {
      // 跳过符号链接，防止循环和意外引用
      continue;
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}
