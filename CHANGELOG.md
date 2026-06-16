# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-06-16

### Fixed

- `detectDeadLoop` 改用工具白名单指纹，防止子 agent 通过递增 `description` 等字段绕过死循环检测。

## [0.2.1] - 2026-06-15

### Fixed

- 同步 `plugin/.claude-plugin/plugin.json` 与 `package.json` 版本号至 `0.2.1`。
- 为 `.claude-plugin/marketplace.json` 补全 `version` 字段，使 Claude Code Marketplace 正确识别版本。
- 清除停滞子 agent 遗留的幽灵告警（基于 jsonl timestamp 判断 stale）。

## [0.2.0] - 2026-06-14

### Added

- 接线 watcher 与 hook 系统，实现双线死循环防护：
  - 线 1：主 agent 连续 Read 同一未改动文件时，通过 `PreToolUse`/`PostToolUse` 双 Hook 拦截。
  - 线 2：子 agent 工具调用死循环时，watcher 常驻进程扫描 transcript 并引导主 agent 终止子任务。
