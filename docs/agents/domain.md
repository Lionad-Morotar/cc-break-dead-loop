# Domain Docs

工程技能（engineering skills）在探索代码库时如何消费本仓库的领域文档。

本仓库为 **single-context** 布局：`CONTEXT.md` 与 `docs/adr/` 位于仓库根目录。

## 探索前先读取

- 仓库根目录的 **`CONTEXT.md`**，或
- 如果存在仓库根目录的 **`CONTEXT-MAP.md`**，它指向每个 context 对应的一个 `CONTEXT.md`，读取与当前主题相关的那些
- **`docs/adr/`** —— 读取涉及即将工作区域的 ADR。在多 context 仓库中，还要检查 `src/<context>/docs/adr/` 中 context 级别的决策

如果这些文件中任何一个不存在，**静默继续**。不要标记它们的缺失；不要预先建议创建它们。生产者技能（`/grill-with-docs`）会在术语或决策实际确定时懒加载创建它们。

## 文件结构

单 context 仓库（大多数仓库，本仓库即属此类）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多 context 仓库（仓库根存在 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context 特定决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表的词汇

当输出命名一个领域概念（issue 标题、重构提案、假设、测试名），使用 `CONTEXT.md` 中定义的术语。不要漂移到术语表明确避免的同义词。

如果需要的概念还不在术语表中，这是一个信号——要么在发明项目不使用的语言（重新考虑），要么存在真实缺口（记录给 `/grill-with-docs`）。

## 标记 ADR 冲突

如果输出与现有 ADR 矛盾，明确指出而不是静默覆盖：

> _与 ADR-0007（事件溯源订单）矛盾——但值得重新讨论，因为…_
