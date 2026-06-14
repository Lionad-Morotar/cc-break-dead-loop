# watcher 用 detached 常驻进程扫描 transcript

## Context

子 agent transcript 是 Claude Code **事后落盘**的 jsonl（`~/.claude/projects/<proj>/<session>/subagents/agent-<id>.jsonl`）。Hook 执行时只能拿到本次工具调用的输入/输出，拿不到完整 tool_use 序列，无法在 Hook 内联检测"尾部连续重复"这类需要历史窗口的死循环。

## Decision

用 **detached 常驻 watcher 进程**，由 Setup hook spawn（`detached: true` + `unref`），每 5s 全量扫描所有 `agent-*.jsonl`，对每个 agent 取最近 20 个 tool_use 检测尾部连续重复。

## Why

常驻进程可跨越单次 Hook 调用，定时获取完整 transcript，是唯一能拿到"历史 tool_use 序列"的位置。detached + 心跳（`watcher-heartbeat.json`）保活，崩溃由下次 Setup 检测心跳过期自动 restart。

## Considered Options

- **Hook 内联检测**：拿不到完整序列，只能看单次调用，失效
- **事件驱动（监听 transcript 文件变更）**：jsonl 追加无可靠的文件系统事件，跨平台不一致，仍需 polling 兜底
- **detached 常驻进程定时扫描**：采用

## Consequences

- 引入进程管理复杂度（心跳、PID、restart 决策），由 `watcherLifecycle.mjs` 封装
- 检测有延迟（扫描间隔 5s + transcript 落盘延迟），子 agent 死循环最快数秒后发现
- watcher 崩溃不阻断 Claude Code（Setup 层 catch + 心跳自愈）
