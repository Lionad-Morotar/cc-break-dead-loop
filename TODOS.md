# TODOS

## 1. 可配置死循环阈值

**What:** 将固定的 3 次警告 / 5 次阻断阈值改为用户可配置。

**Why:** 不同工作流对死循环敏感度不同。调试复杂代码时可能需要更多尝试次数，而简单脚本可能希望更早打断。

**Pros:** 适应不同用户的工作流习惯；无需修改代码即可调整行为。
**Cons:** 需要配置文件解析逻辑和默认值处理。

**Context:** 当前 `src/config.ts` 中硬编码 `WARN_THRESHOLD = 3` 和 `BLOCK_THRESHOLD = 5`。预期通过 `~/.config/cc-break-dead-loop/config.json` 或环境变量覆盖。

**Depends on:** 无（可在任何时间实现）。

---

## 2. npm / CI 分发 Pipeline

**What:** 添加 npm 包发布和 GitHub Actions CI/CD workflow。

**Why:** 当前手动复制 `plugin/` 目录到 Claude Code plugins 目录的安装方式容易出错，且不利于版本管理和自动更新。

**Pros:** 用户可通过 `npm install -g cc-break-dead-loop` 安装；自动获取更新；版本锁定。
**Cons:** 需要维护 npm 账号、CI 配置、版本管理流程。

**Context:** Claude Code 插件生态暂不成熟，npm 分发需要验证插件加载机制是否支持 node_modules 路径。当前安装说明在 README.md 中描述为手动复制。

**Depends on:** 核心功能稳定、README 安装文档完成。
