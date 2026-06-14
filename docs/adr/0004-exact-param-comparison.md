# Read 参数用 === 精确比较，不规范化 undefined→0

## Context

主 agent Read 计数器（线 1）需判断"本次 Read 是否与上次相同"以决定递增还是重置。`offset` 字段可能是 `undefined`（调用方未指定，默认从头）或 `0`（显式从开头）。

## Decision

用 `===` 直接比较三参数（filePath / offset / limit），`undefined` 与 `0` 视为**不同**，触发计数器重置。

## Why

把参数规范化交给 Claude Code 和 LLM。`undefined`（未指定）与 `0`（显式从开头）代表不同的调用意图，不应被静默等同。若规范化，会把"LLM 改变调用习惯"误判为"同一调用继续计数"。

## Considered Options

- **规范化 `undefined → 0` 后比较**：掩盖调用意图差异，可能把不同意图的 Read 错误地累计为同一死循环
- **`===` 精确比较**：采用

## Consequences

- 已有测试（`tests/state.test.mjs` "offset undefined 和 0 视为不同"）锁定此行为
- 若未来 Claude Code 统一传 `offset: 0`，此差异自然消失，无需改代码
