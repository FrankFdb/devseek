# 顶层 RunContext 与执行事实治理专题设计

文档编号：ARCH-17
最后更新：2026-07-02
状态：活跃专题设计
关联文档：[03-Agent运行时与工作流重构设计.md](03-Agent运行时与工作流重构设计.md)、[05-代码重构实施计划.md](05-代码重构实施计划.md)、[14-自动闭环迭代与测试方法论检讨.md](14-自动闭环迭代与测试方法论检讨.md)、[16-重复判定逻辑治理专题设计.md](16-重复判定逻辑治理专题设计.md)

## 1. 结论

DevSeek 当前反复出现“实际任务已完成，但 UI/Todos/QualityGate 判定失败”“同一任务生成多个日志目录”“历史续件污染当前请求”的根因，不是某个工具解析器小 bug，而是顶层执行事实没有统一归属。

对标 Claude Code/Codex，底层 Provider、HTTP 请求、工具执行器、UI 卡片都不应该各自生成会话事实。它们只能把事件挂到同一个顶层 `RunContext` 上。一次用户 Agent 执行必须有唯一 `runId`、唯一任务事实线、唯一证据归并入口。

## 2. 当前反模式

1. `bridgeClient.chat()` 每次模型调用都创建诊断 run，导致一次 Agent 执行被拆成多个目录。
2. 工具执行失败、自动修复成功、最终运行成功之间缺少统一 Evidence Ledger，早期失败会残留到最终 UI。
3. Provider continuation、session history、checkpoint 恢复各自拼接上下文，导致过期任务被带入当前请求。
4. Todo、QualityGate、ReviewLedger、historyText 在不同阶段各自推断成功/失败，容易出现 A 处修复、B 处仍按旧规则走。

## 3. 目标架构

`RunContext` 是一次顶层用户执行的唯一事实载体：

```text
User Turn
  RunContext(runId, workspaceRoot, sessionId, userPrompt, intent, startTime)
    ModelCall[]
    ToolCall[]
    FileEvidence[]
    TerminalEvidence[]
    ValidationEvidence[]
    TodoState[]
    UiEvent[]
    HistoryEvent[]
```

约束：

1. `runId` 在 Extension 顶层请求开始时生成，传入 Agent loop、Provider、Bridge、DeepSeek Web、工具和验证。
2. Provider 不得创建新 run，只能使用传入的 `traceRunId`；缺省只允许非 Agent 普通聊天降级自建。
3. Todo 与最终状态只能由统一 Evidence Ledger 结算。
4. 早期失败不是最终事实；后续成功验证可以按规则抵消可恢复失败。
5. 历史续件必须基于当前 session、当前 workspace、当前相关文件过滤，不能把旧任务无条件拼入模型输入。
6. 日志必须按 `RunContext` 输出单文件 JSONL 时间线，便于 replay 和根因定位。

## 4. 分阶段实施

### Phase 1：RunContext 打通

1. Extension 顶层 Agent 执行生成 `runId`。
2. `LLMChatOptions`、Bridge Provider、Bridge Client、Bridge Server、DeepSeek Agent 全链路传递 `traceRunId`。
3. `.devseek/runs/<YYYYMMDD-HHMMSS>/devseek.log` 记录同一次执行的所有模型请求和响应。
4. 禁止同一次 Agent 执行产生多个日志目录。

### Phase 2：Evidence Ledger 收敛

1. 把 terminal/file/validation/manual-review 统一成领域证据。
2. Todo settle、QualityGate、historyText、ReviewLedger 只读 Ledger 结论。
3. 最终成功验证可清理早期 missing-evidence、missing-write、terminal 失败。
4. 对硬失败、人工确认、已启动交互式程序做明确状态区分。

### Phase 3：Session Context 治理

1. 历史续件按 session、workspace、相关文件和用户最新请求过滤。
2. 旧任务摘要只作为参考，不允许生成新 Todo 或覆盖当前 intent。
3. reload/resume/checkpoint 必须写入同一 Evidence Ledger，而不是重建一份独立状态。

### Phase 4：Replay 与回归门禁

1. 从 `devseek.log` 生成 replay fixture。
2. L0-L5 测试覆盖模型响应、工具调用、文件落盘、编译运行、UI 状态、reload 历史。
3. 每个截图问题必须沉淀为一个可复放 case，避免人工反复撞同一类问题。

## 5. 验收标准

1. 一次 Agent 执行只创建一个 run 目录。
2. `devseek.log` 第一条是 `run-started`，后续事件按毫秒时间和 seq 可还原完整时序。
3. 同一请求的多轮模型调用、工具调用、验证结果都使用同一个 `runId`。
4. 先失败后修复成功的任务，最终 UI/Todos/History 不保留旧失败。
5. 真实 DeepSeek Web 输出异常时，日志能定位是模型方言、协议适配、工具执行、文件落盘、验证还是 UI 判定问题。
6. 新增 Provider 或工具时，不允许绕过 `RunContext` 和 Evidence Ledger。
