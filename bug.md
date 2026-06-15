# Bug 修复记录与风险备忘

> **用途**：每次修复前先查阅此表，确认不会重蹈已知陷阱。  
> **原则**：修改任意代码块时，先数括号是否对称；同一变量的多个初始化点须同步修改。

---

## 已修复 Bug 总表

| # | 现象 | 涉及文件 | 根本原因 | 修复方法 | ⚠️ 修改时的副作用风险 |
|---|------|----------|----------|----------|-----------------------|
| 1 | 代理工具调用结果出现在聊天气泡（刷屏） | `agent-loop.ts` → `executeFakeToolsForLoop` | 11 种工具的处理器都调用了 `callbacks.onDelta(...)` 把结果输出到聊天流 | 移除所有工具处理器内的 `onDelta` 调用，改为只写入 `parts[]` 供 AI 内部反馈 | 若未来新增工具处理器，切勿加 `onDelta`，只加 `parts.push(...)` |
| 2 | Agent 模式下所有 delta 被静默丢弃，只显示 spinner，不显示任何内容 | `webview.js` `agentPlanDone` 标志 / `extension.ts` | `runAgenticLoop` 跳过了 Architect 阶段，`plan:completed` 消息从未发出 → `agentPlanDone` 永远为 `false` → delta gate 拦截全部输出 | 在 `extension.ts` 调用 `runAgenticLoop` 之前，先主动发送一条空的 `plan:completed` 消息解锁 gate | 若将来在 `runAgenticLoop` 内部补充真正的计划阶段，需删除这条手动解锁，否则会触发两次 `plan:completed` |
| 3 | 任务完成后 Working box 一直保持 "Working…" 动画，不显示完成状态和摘要 | `webview.js` 多处 | ① `agentActivityCounts` 缺少 `write: 0`，写文件步骤不计入步骤总数；② `buildAgentAutoSummary()` 在无 todos/files 时返回 `''`，导致摘要气泡被整体移除；③ Working box 标签不使用 `msg.title` 回退，显示 "Working…" 而非任务描述 | ① 所有 6 处 `agentActivityCounts` 初始化都加上 `write: 0`；② `buildAgentAutoSummary` 在无 todos/files 时改用活动计数生成回退摘要；③ 标签构建逻辑加 `msg.title` 回退 | **`agentActivityCounts` 共有 6 处初始化**（全局声明 L1665、`createExecStepsList` L1982、plan 阶段 L2092、execute reusingPlan L2155、execute else L2163、`resetWorkingArea` L3543），修改任意一处时必须同步修改全部 6 处，否则计数在不同路径下不一致 |
| 4 | (**meta-bug**) 修复 Bug #3 时引入：Working box 动画永远不停，`phase:done` 不触发 finalize | `webview.js` execute 阶段 `if (reusingPlan)` 块 | 在 execute 阶段为 `if (reusingPlan)` 分支添加 `agentActivityCounts = {...}` 时，漏掉了该分支的闭合 `}`，导致 `else` 及其后的**容器创建代码、任务行追加、todos 同步、标题更新**全部被错误包裹进 `else` 块，`agentExecContainer` 再也无法被正确注册，`finalizeExecContainer` 找不到目标容器 | 恢复正确大括号结构：`if (reusingPlan) { ... } else { ... }` 各自独立，容器创建在两者之外 | **修改任何 `if/else` 多行块时，必须在修改后检查缩进层级和括号配对**。推荐用 `grep -c "{" file` vs `grep -c "}" file` 粗查平衡 |
| 5 | 摘要气泡内容重复出现两次 | `agent-loop.ts` → `runAgenticLoop` | `executeFakeToolsForLoop` 处理 `task_complete` 时，若 summary > 20 字符已发送一次 `\x00ASUM\x00`；`runAgenticLoop` 末尾又无条件再发一次 | 在末尾 ASUM 发送前，检查 `hadTaskComplete && completeSummary.trim().length > 20`，满足条件时跳过，避免重复 | 若将来修改 `task_complete` 的 ASUM 阈值（当前 20 字符），需同步修改 `runAgenticLoop` 末尾的判断条件 |

---

## 高风险改动检查清单

修改下列位置前，必须对照此表确认：

| 改动位置 | 必须同步检查 |
|----------|-------------|
| `agentActivityCounts` 初始化（任意一处） | 其余 5 处是否同步 |
| `if (reusingPlan) { ... } else { ... }` 块 | 块的闭合 `}` 数量是否正确 |
| `executeFakeToolsForLoop` 内工具处理器 | 新工具不得调用 `onDelta`，只用 `parts.push` |
| `runAgenticLoop` 末尾 ASUM 发送 | `hadTaskComplete` 判断是否与 `executeFakeToolsForLoop` 内阈值一致 |
| `plan:completed` 解锁逻辑（extension.ts） | 若 `runAgenticLoop` 将来新增真正的计划阶段，需删除手动解锁 |
| `buildAgentAutoSummary()` | 修改返回逻辑时，确认 `agentActivityCounts` 在调用时是否已被重置（`resetWorkingArea` 有 500ms 延迟，`buildAgentAutoSummary` 在 `endResponse` 同步调用，计数此时仍有效）|
| `buildAgenticSystemPrompt()` 工具列表 | `manage_todo_list` 和 `task_complete` 两者必须同时存在 |

| 6 | `runAgenticLoop` 路径从不显示 todos 框（计划阶段缺失） | `agent-loop.ts` → `buildAgenticSystemPrompt` | `buildAgenticSystemPrompt` 工具列表中没有 `manage_todo_list`，AI 看不到这个工具，无法调用，todos 框永远不出现；而 Copilot 的规划阶段 AI 必须先调用 `manage_todo_list` | ① 在 `buildAgenticSystemPrompt` 工具列表中加入 `manage_todo_list` 示例；② 在行为准则中明确要求"开始前先用 manage_todo_list 列出子任务" | 若将来修改 `buildAgenticSystemPrompt` 工具部分，务必保留 `manage_todo_list` 和 `task_complete` 都在工具列表中；两者缺一会导致 todos 消失或循环不能自然终止 |

---

*最后更新：2026-05-27*
