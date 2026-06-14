# 线 2 经 Stop hook blockingError 间接终止子 agent

## Context

子 agent（subagent/teammate）无视 hook 的 `permissionDecision: 'deny'`（Claude Code bug #25000/#34692），无法用常规 Hook 直接阻断子 agent 的工具死循环。

## Decision

线 2 不对子 agent 发 deny。改为 watcher 检测死循环写告警后，在**主 agent 的 Stop hook** 返回 `blockingError`（`exit 2` + stderr），强制主 agent 不能结束 turn，引导其调用 `TaskStopTool` 终止死循环子 agent。

## Why

主 agent 遵守 `blockingError` 机制，借此绕过子 agent 的 deny 失效。"由主 agent 经 `TaskStopTool` 终止子 agent" 是 Claude Code 进程模型内唯一可行的干预路径——子 agent 是主进程内 task，无独立 PID 可直接 kill。

## Considered Options

- **直接对子 agent deny**：被无视（#25000/#34692），无效
- **watcher 直接 kill 子 agent 进程**：子 agent 是主进程内 LocalAgentTask，无独立 PID
- **Stop hook blockingError 引导主 agent 调 TaskStopTool**：采用

## Consequences

- 残留风险：依赖主 agent 遵循引导调用 `TaskStopTool`；若主 agent 忽略 `blockingError` 仍可能漏阻断
- 线 1（主 agent Read）仍用 deny，因主 agent 遵守 deny，双线机制互补
