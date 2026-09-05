# TODOS

## 1. 可配置死循环阈值

**What:** 将固定的 3 次警告 / 5 次阻断阈值改为用户可配置。

**Why:** 不同工作流对死循环敏感度不同。调试复杂代码时可能需要更多尝试次数，而简单脚本可能希望更早打断。

**Pros:** 适应不同用户的工作流习惯；无需修改代码即可调整行为。
**Cons:** 需要配置文件解析逻辑和默认值处理。

**Context:** 当前 `plugin/src/config.mjs` 中硬编码 `WARN_THRESHOLD = 3` 和 `BLOCK_THRESHOLD = 5`。预期通过 `~/.config/cc-break-dead-loop/config.json` 或环境变量覆盖。

**Depends on:** 无（可在任何时间实现）。

---

## 2. CI 测试 Pipeline

**What:** 添加 GitHub Actions CI workflow（push / PR 跑 vitest 全量测试）。

**Why:** 当前测试仅本地执行，多宿主协作（不同 Agent runtime 提交）缺一道统一的质量门。

**Pros:** 每次提交有测试阻断信号；为中心集市条目自动同步（version/ref）打基础。
**Cons:** 需要维护 CI 配置与 minutes 消耗。

**Context:** 插件已经由中心集市 `Lionad-Morotar/claude-plugins` 分发（`/plugin marketplace add` + `install`），旧的 npm 全局安装设想随 NPX CLI 一并废弃——插件经 marketplace git clone 安装，不走 npm。

**Depends on:** 无。
