# cc-break-dead-loop

Claude Code 插件的领域语言：检测并打断 agent 在工具调用中的死循环。本文档是术语表（glossary），仅定义概念"是什么"，不含实现细节（实现见 `.planning/codebase/ARCHITECTURE.md` 与 `docs/adr/`）。

## Language

### Agent 角色

**主 agent（main agent）**：
直接与用户交互、执行顶层任务的 Claude Code agent。在计数状态中以 agent_id 为空（fallback `main`）标识。
_Avoid_: 主代理（口语化）、primary agent

**子 agent（subagent）**：
主 agent 派生、独立执行子任务的辅助 agent。Claude Code 区分 subagent 与 teammate 两种类型，本项目检测逻辑不区分（两者均无视 hook 的 deny）。
_Avoid_: 子代理（口语化）、child agent

### 死循环

**死循环（dead loop）**：
agent 连续重复调用同一工具且参数完全相同，无实质进展，超过项目阈值即判定为死循环。具体阈值（线 1 的 `WARN_THRESHOLD` / `BLOCK_THRESHOLD`、线 2 的 `WATCHER_THRESHOLD`）见 `.planning/codebase/ARCHITECTURE.md`。
_Avoid_: 循环（太泛）、infinite loop（不准确，每次调用都产生新记录）

**Read 死循环**：
主 agent 对同一未改动文件连续 Read 的死循环，由 Claude Code 的 wasted call 信号触发检测。
_Avoid_: 重复读取（未区分 CC 信号）

**工具调用死循环**：
子 agent 对任意工具连续重复调用的死循环，无 wasted call 信号，需扫描 transcript 检测。

**wasted call**：
Claude Code 对主 agent 重复 Read 未改动文件返回的信号，格式 `{ type: "file_unchanged" }` 或字符串 `"Wasted call — file unchanged"`。
_Avoid_: 重复读取（未区分 CC 信号）

**参数指纹（paramFingerprint）**：
工具调用输入参数经稳定序列化（对象键排序）后的字符串。键序不同但内容相同的参数产生相同指纹，用于判定"参数完全相同"。
_Avoid_: 参数哈希（非哈希，是序列化）

### 检测与干预

**线 1（主 agent 检测）**：
针对主 agent Read 死循环的检测场景。主 agent 遵守 hook 的 `permissionDecision`，可直接阻断。
_Avoid_: Hook 检测（实现细节）

**线 2（子 agent 检测）**：
针对子 agent 工具死循环的检测场景。子 agent 无视 hook 的 deny（Claude Code bug #25000/#34692），需通过主 agent 间接终止。
_Avoid_: watcher 检测（实现细节）

**告警（alert）**：
子 agent 死循环的持久化记录，含 agentId、sessionId、工具名、参数指纹、重复次数。供 hooks 读取后向主 agent 注入引导。
_Avoid_: 警告（混淆 additionalContext 措辞）

**transcript**：
Claude Code 落盘的 agent 活动日志（jsonl），每行一个 assistant/user 事件。子 agent transcript 是线 2 的检测输入。
_Avoid_: 日志（太泛）

**TaskStopTool**：
Claude Code 内置工具，主 agent 调用以终止子 agent。线 2 的最终干预手段。
_Avoid_: kill（非工具调用）

## Flagged ambiguities

- **"子 agent" 统称 vs subagent/teammate 子类型**：本项目检测逻辑不区分两者（均无视 deny，均由 watcher 扫 transcript），故 CONTEXT 用"子 agent"统称。若未来需区分检测策略，需在状态隔离维度纳入 agent_type（当前 `getStateDir` 忽略该参数）。

## 示例对话

> **Dev**: 子 agent 陷入死循环了，检测到吗？
> **Expert**: 是的，扫到它的 transcript 尾部连续 7 次同参数 Read，超阈值，已写告警。
> **Dev**: 直接 deny 它不行吗？
> **Expert**: 不行，这是线 2——子 agent 无视 deny。要在主 agent 的 Stop hook 返回 blockingError，让主 agent 调 TaskStopTool 终止它。
> **Dev**: 那主 agent 自己 Read 死循环呢？
> **Expert**: 那是线 1，wasted call 计数到 5 直接 deny，对主 agent 完全有效。
