# Agents.md

`cc-break-dead-loop` 是一个 Claude Code 插件，自动检测并打断 agent 的两类死循环：主 agent 对同一未改动文件的连续 Read 死循环（线 1，双 Hook 拦截），以及子 agent 的工具调用死循环（线 2，watcher 常驻进程扫描 subagent transcript，经 Stop hook 阻断引导主 agent 调 `TaskStopTool`）。

* 现实层你有无限时间和资源，不要因上下文压缩简化任务执行

## 项目上下文

| 文档                                                    | 说明                       |
| ------------------------------------------------------- | -------------------------- |
| [README.md](./README.md)                                | 安装指南、使用说明与已知限制 |
| [TODOS.md](./TODOS.md)                                  | 未来改进事项与待办需求       |
| [STACK.md](./.planning/codebase/STACK.md)               | 技术栈、开发命令、部署流程   |
| [STRUCTURE.md](./.planning/codebase/STRUCTURE.md)       | 目录结构、命名规范、新增代码位置 |
| [ARCHITECTURE.md](./.planning/codebase/ARCHITECTURE.md) | 架构模式、分层职责、数据流   |
| [CONVENTIONS.md](./.planning/codebase/CONVENTIONS.md)   | 代码风格、开发约定           |
| [TESTING.md](./.planning/codebase/TESTING.md)           | 测试规范与覆盖范围           |
| [INTEGRATIONS.md](./.planning/codebase/INTEGRATIONS.md) | 外部服务、环境变量           |
| [CONCERNS.md](./.planning/codebase/CONCERNS.md)         | 技术债务、注意事项           |
| [docs/](./docs/)                                        | 项目深度文档（Project/Architecture/Workflow/DeepDive） |

你可以自行读取项目上下文文档，更新时也优先更新相关文档。

## Agent skills

### Domain docs

single-context 布局（`CONTEXT.md` + `docs/adr/` 位于仓库根）。详见 `docs/agents/domain.md`。
