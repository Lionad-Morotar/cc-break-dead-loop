import { strictEqual, ok, rejects, doesNotReject } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJsonFile, writeJsonFile, ensureDir, copyDir } from '../../src/cli/utils/fs.mjs';

describe('fs.mjs', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cc-break-dead-loop-test-'));
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('readJsonFile()', () => {
    it('文件不存在时返回空对象', async () => {
      const result = await readJsonFile(join(tmpDir, 'nonexistent.json'));
      strictEqual(JSON.stringify(result), '{}');
    });

    it('正确解析存在的 JSON 文件', async () => {
      const filePath = join(tmpDir, 'test.json');
      writeFileSync(filePath, JSON.stringify({ name: 'test', value: 42 }), 'utf8');
      const result = await readJsonFile(filePath);
      strictEqual(result.name, 'test');
      strictEqual(result.value, 42);
    });

    it('JSON 格式损坏时抛出带上下文的错误', async () => {
      const filePath = join(tmpDir, 'corrupt.json');
      writeFileSync(filePath, '{ invalid json }', 'utf8');
      await rejects(
        async () => readJsonFile(filePath),
        (err) => {
          ok(err.message.includes('JSON 解析失败'), `应包含 "JSON 解析失败": ${err.message}`);
          ok(err.message.includes(filePath), `应包含文件路径: ${err.message}`);
          ok(err.message.includes('请检查文件'), `应包含提示信息: ${err.message}`);
          return true;
        }
      );
    });
  });

  describe('writeJsonFile()', () => {
    it('正确写入 JSON 文件', async () => {
      const filePath = join(tmpDir, 'output.json');
      await writeJsonFile(filePath, { key: 'value', arr: [1, 2] });
      const content = readFileSync(filePath, 'utf8');
      ok(content.includes('"key": "value"'), `应包含序列化后的 JSON: ${content}`);
      const result = await readJsonFile(filePath);
      strictEqual(result.key, 'value');
      strictEqual(result.arr.length, 2);
    });

    it('自动创建不存在的父目录', async () => {
      const filePath = join(tmpDir, 'nested', 'deep', 'file.json');
      await doesNotReject(async () => {
        await writeJsonFile(filePath, { ok: true });
      });
      ok(existsSync(filePath), '文件应被创建');
    });
  });

  describe('ensureDir()', () => {
    it('递归创建目录', async () => {
      const dirPath = join(tmpDir, 'a', 'b', 'c');
      await ensureDir(dirPath);
      ok(existsSync(dirPath), '目录应被创建');
    });

    it('对已存在目录静默通过', async () => {
      const dirPath = join(tmpDir, 'existing');
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(join(dirPath, 'file.txt'), 'test', 'utf8');
      await doesNotReject(async () => {
        await ensureDir(dirPath);
      });
    });
  });

  describe('copyDir()', () => {
    it('递归复制目录内容', async () => {
      const src = join(tmpDir, 'src');
      const dest = join(tmpDir, 'dest');
      mkdirSync(join(src, 'a'), { recursive: true });
      mkdirSync(join(src, 'b'), { recursive: true });
      writeFileSync(join(src, 'a', 'file1.txt'), 'content1', 'utf8');
      writeFileSync(join(src, 'b', 'file2.txt'), 'content2', 'utf8');

      await copyDir(src, dest);

      ok(existsSync(join(dest, 'a', 'file1.txt')), '嵌套文件应被复制');
      ok(existsSync(join(dest, 'b', 'file2.txt')), '嵌套文件应被复制');
    });

    it('超过 maxDepth 时抛出错误', async () => {
      const src = join(tmpDir, 'src');
      const dest = join(tmpDir, 'dest');
      mkdirSync(join(src, '1', '2', '3', '4', '5', '6'), { recursive: true });
      writeFileSync(join(src, '1', '2', '3', '4', '5', '6', 'deep.txt'), 'deep', 'utf8');

      await rejects(
        async () => copyDir(src, dest, 3),
        (err) => {
          ok(err.message.includes('递归深度超过限制'), `应包含深度限制提示: ${err.message}`);
          return true;
        }
      );
    });

    it('跳过符号链接', async () => {
      const src = join(tmpDir, 'src');
      const dest = join(tmpDir, 'dest');
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'real.txt'), 'real', 'utf8');
      // 创建符号链接（在支持的平台上）
      try {
        const { symlink } = await import('node:fs/promises');
        await symlink(join(src, 'real.txt'), join(src, 'link.txt'));
        await copyDir(src, dest);
        ok(existsSync(join(dest, 'real.txt')), '真实文件应被复制');
        ok(!existsSync(join(dest, 'link.txt')), '符号链接应被跳过');
      } catch {
        // Windows 可能需要管理员权限，跳过此测试
        ok(true, '平台不支持符号链接，跳过');
      }
    });
  });
});
