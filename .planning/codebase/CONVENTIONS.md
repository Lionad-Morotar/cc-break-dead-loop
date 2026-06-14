# 编码规范

**分析日期:** 2026-05-11

## 命名模式

**文件:**
- 所有源码文件使用 `.mjs` 扩展名，显式标识 ES Module
- 测试文件命名：`{模块名}.test.mjs`，与源码模块一一对应
- 配置文件命名：`{名称}.mjs`，如 `config.mjs`、`utils.mjs`

**函数:**
- 使用 camelCase，动词开头描述行为
- 示例：`getStateDir`、`readState`、`writeState`、`isSameReadParams`、`incrementCounter`
- 私有/内部函数不加下划线前缀，直接以功能命名

**变量:**
- 使用 camelCase
- 常量使用 UPPER_SNAKE_CASE，如 `WARN_THRESHOLD`、`BLOCK_THRESHOLD`、`DATA_DIR`
- 布尔判断变量使用 `is`/`has` 前缀，如 `isWastedCall`

**类型:**
- 使用 JSDoc `@typedef` 定义复杂类型，如 `DetectionState`
- 函数参数和返回值均有 JSDoc 类型注解

## 代码风格

**格式化:**
- 无 Prettier/ESLint 配置文件，依赖手动保持一致
- 缩进：2 空格
- 引号：单引号（字符串）
- 行尾无分号（除少数情况外）
- 最大行宽：约 100-120 字符（观察值）

**代码注释:**
- 文件顶部必须有模块级 JSDoc 注释，描述模块职责
- 每个导出函数必须有 JSDoc，包含 `@param` 和 `@returns`
- 关键决策点使用行内注释标记决策 ID，如 `(D6)`、`(D7)`
- 错误边界处注释说明降级策略，如 `D5: 任何内部错误都返回 { continue: true } 静默失败`
- 禁止在代码注释中写入开发阶段标记（如 TODO/FIXME 应放入 TODOS.md）

## 导入组织

**顺序:**
1. Node.js 内置模块（带 `node:` 前缀）
2. 项目内部模块（相对路径）

**示例:**
```javascript
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.mjs';
import { getProjectName, sanitizeName } from './utils.mjs';
```

**路径别名:**
- 不使用路径别名，全部使用相对路径 `./xxx.mjs`
- 必须显式包含 `.mjs` 扩展名

## 错误处理

**核心原则 — 静默失败（fail-safe）:**
- 任何内部错误都返回 `{ continue: true, suppressOutput: true }`，绝不阻断正常 Read 操作
- 使用 `try/catch` 包裹所有可能抛出的操作（文件 IO、JSON 解析、handler 调用）
- catch 块中不使用错误参数，直接返回默认值

**模式示例:**
```javascript
// src/index.mjs — JSON 解析失败静默降级
try {
  input = JSON.parse(stdinData || '{}');
} catch {
  return { continue: true, suppressOutput: true };
}

// src/state.mjs — 文件读取失败返回 null
try {
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
} catch {
  return null;
}
```

**多层错误边界:**
- 第一层：`plugin/src/index.mjs` 的 `main()` 函数 try/catch（JSON 解析 + handler 调用）
- 第二层：`plugin/scripts/node-runner.mjs` 的 `finish()` 函数 try/catch（含 Stop `shouldBlock` 处理）
- 第三层：CLI 入口的 `process.stdin.on('error', ...)`
- watcher 层：`watcher.mjs` / `watcherLifecycle.mjs` 内部 try/catch，扫描异常跳过损坏 jsonl；watcher 崩溃由心跳过期 + 下次 Setup `decideAction → restart` 自动恢复
- Setup 层：`setup-check.mjs` watcher 启动失败仅 `console.error`，永不阻断 Claude Code（`exit(0)`）

## 日志记录

**框架:** 直接使用 `console.log` / `console.error`

**模式:**
- 正常输出使用 `console.log`，前缀 `[cc-break-dead-loop]`
- 错误/警告使用 `console.error`
- 所有 `console` 调用旁标注 `// eslint-disable-next-line no-console`
- 仅用于 stdout/stderr 协议通信，不用于调试日志

## 函数设计

**大小:** 函数保持短小，单一职责，通常 10-30 行

**参数:**
- 使用解构提取对象属性
- 可选参数使用默认值或 `||` fallback

**返回值:**
- 明确返回结构化对象，统一使用 `{ continue: boolean, suppressOutput: boolean }` 作为基础响应
- 特殊响应添加额外字段，如 `{ continue: false, hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason, additionalContext } }`

## 模块设计

**导出模式:**
- 使用命名导出（`export function`），不使用默认导出
- 每个模块职责单一：
  - `config.mjs` — 纯常量配置（阈值、数据目录、watcher 参数）
  - `utils.mjs` — 纯函数工具（`sanitizeName`、`getProjectName`）
  - `state.mjs` — 主 agent Read 计数状态管理
  - `handlers.mjs` — 主 agent 检测/拦截 handler（双 Hook）
  - `index.mjs` — Hook 入口与 4 事件分发
  - `watcher.mjs` — watcher 扫描协调（transcript → 检测 → 告警同步）
  - `watcherLifecycle.mjs` — watcher 进程决策（`decideAction`）与 spawn（`ensureWatcherRunning`）
  - `alertStore.mjs` — 子 agent 死循环告警存储（watcher 写 / hooks 读）
  - `deadLoopDetector.mjs` — 死循环检测算法（纯函数）
  - `hookInjector.mjs` — Hook 注入措辞生成（纯函数）
  - `subagentTranscriptReader.mjs` — subagent jsonl 解析

**无 barrel 文件:** 直接导入具体模块，不通过索引文件聚合导出

---

*规范分析: 2026-05-11*
