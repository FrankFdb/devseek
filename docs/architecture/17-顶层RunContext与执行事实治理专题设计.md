---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/architecture/17-顶层RunContext与执行事实治理专题设计.md"
  source_group: "architecture"
  decision: "keep"
  relationship: "legacy-architecture"
  active_baselines:
    - "docs/architecture/01-顶级编程智能体总体架构设计.md"
  machine_sources:
    active_selector: "docs/process/devseek-active-baseline-selector.json"
    legacy_inventory: "docs/process/devseek-legacy-doc-inventory.json"
  asserts_gate_pass: false
---

<!-- DEVSEEK-GOVERNANCE-BANNER:START -->
> [!NOTE]
> DevSeek governance: this document is `historical` with decision `keep` and relationship `legacy-architecture`. Current authority: `docs/architecture/01-顶级编程智能体总体架构设计.md`. Machine source: `docs/process/devseek-legacy-doc-inventory.json`.
<!-- DEVSEEK-GOVERNANCE-BANNER:END -->

# 顶层 RunContext 与执行事实治理专题设计

文档编号：ARCH-17
最后更新：2026-07-03
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
5. 非 Agent 普通聊天路径没有 route decision trace；当执行型请求被误路由时，日志只能看到 Provider 返回源码，无法解释为什么没有写盘或编译。

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
3. `.devseek/runs/<YYYYMMDD-HHMMSS>.log` 记录同一次执行的所有模型请求和响应。
4. 禁止同一次 Agent 执行产生多个日志目录。

### Phase 2：Evidence Ledger 收敛

1. 把 terminal/file/validation/manual-review 统一成领域证据。
2. Todo settle、QualityGate、historyText、ReviewLedger 只读 Ledger 结论。
3. 最终成功验证可清理早期 missing-evidence、missing-write、terminal 失败。
4. 对硬失败、人工确认、已启动交互式程序做明确状态区分。
5. 自动编译/运行验证只能基于本轮真实写入文件或终端执行证据，不能把计划目标文件或旧构建成功当成本轮完成证据。
6. 验证失败默认保留本轮文件变更并挂入待确认/修复事实；自动回滚只能作为显式策略或用户选择，不能由底层验证失败隐式触发。

### Phase 3：Session Context 治理

1. 历史续件按 session、workspace、相关文件和用户最新请求过滤。
2. 旧任务摘要只作为参考，不允许生成新 Todo 或覆盖当前 intent。
3. reload/resume/checkpoint 必须写入同一 Evidence Ledger，而不是重建一份独立状态。

### Phase 4：Replay 与回归门禁

1. 从 `.devseek/runs/<runId>.log` 生成 replay fixture。
2. L0-L5 测试覆盖模型响应、工具调用、文件落盘、编译运行、UI 状态、reload 历史。
3. 每个截图问题必须沉淀为一个可复放 case，避免人工反复撞同一类问题。

### Phase 4.1：Run Log Replay Harness（已落地第一版）

新增 `diagnostics/run-log-replay` 作为日志回放诊断边界，直接读取 `.devseek/runs/*.log` 的 JSONL 时间线，不依赖 VS Code UI 或真实 DeepSeek 网页，即可还原并断言一次执行中的关键事实。

命令：

```bash
npm run run-log-replay -- .devseek/runs/<runId>.log
npm run run-log-replay -- --json .devseek/runs/<runId>.log
```

第一版覆盖的缺陷类型：

1. `legacy-build-path`：模型响应或终端命令重新出现 `.devseek-build` / `devseek-build`。
2. `build-artifact-workdir`：工具循环默认工作目录漂移到 `build/bin` 等构建产物目录。
3. `provider-authored-tool-result`：模型响应夹带 `[工具返回]`、`[工具执行结果]` 等伪造工具结果文本；该项作为污染响应 warning，真正可执行工具只允许来自协议适配层隔离出的工具请求区。
4. `malformed-tool-block`：模型输出了 `[TOOL:*]` 标记，但协议适配器无法解析完整工具调用。
5. `destructive-model-command`：模型生成 `rm -rf build` 等应由本地执行规划器接管的清理命令。
6. `long-running-run`：一次执行超过 60 秒目标。
7. `missing-final-convergence`：日志最后停在未完成工具执行后，没有最终收敛事件。
8. `empty-provider-response`：DeepSeek Web 返回空正文，执行器不得继续把它当成正常计划或任务回复。
9. `incomplete-provider-request`：有 provider 请求开始但没有完成/失败事件，说明执行中断在模型调用边界。
10. `missing-agent-run-completion`：存在 `agent-run-started` 但没有 `agent-run-completed`，说明顶层 run 缺少最终收敛事实。

使用原则：

1. 真实用户测试失败后，优先运行 replay harness 获取机器诊断，再决定修改协议适配、路径解析、执行规划、证据结算还是 UI。
2. 每个新截图问题至少沉淀一个最小 JSONL fixture 单测，避免只能靠人工复现。
3. Replay 只读日志并生成事实报告，不修改工作区文件；日志本身用于根因分析，replay 用于复现旧分叉和验证修复后同类日志不会再走旧解析/判定路径。
4. 真实网页 E2E 仍保留用于登录、DOM、流式输出等浏览器相关问题；日志 replay 不替代真实 DeepSeek Web 交互测试。

### Phase 1.1：RunContext Owner（已落地第一版）

2026-07-02 已完成第一轮顶层 RunContext owner 收敛：

1. 新增 `packages/vscode-extension/src/app/run-context.ts`，作为 VS Code 扩展侧一次 Agent 执行的顶层 `RunContext` owner。
2. `extension.ts` 的 Agent 入口不再直接调用 `createDevSeekRunId()`，而是通过 `createDevSeekRunContext()` 生成唯一 `runId`，并把该 `runId` 继续传给 Agent loop、terminal、provider/bridge。
3. `RunContext` 创建时写入 `agent-run-started`，结束时通过 `agentRunContext.complete()` 写入 `agent-run-completed`；free-explore 路径、分解任务路径和异常路径都纳入同一 completion 入口，completion 具备幂等保护。
4. 底层 `DevSeekTraceLogger` 继续负责 `.devseek/runs/<runId>.log` 的 JSONL 写入、payload、脱敏和 seq；`RunContext` 不重复实现日志文件格式，只作为顶层事实归属者。
5. 新增 `run-context.test.mjs` 验证同一 `RunContext`、child trace、completion 均写入同一个 `<runId>.log`，且 completion 不会重复写入。
6. `workflow-compliance.test.mjs` 新增 ARCH-17 守卫：Agent 入口必须通过 `RunContext` 创建 run，不允许回退到裸 `createDevSeekRunId()`。

该基线对标 Claude Code/Codex 的顶层 turn/run context：Provider、HTTP、工具和 UI 仍可以记录事件，但不得各自创建会话事实。后续 Phase 1 继续推进时，应把更多 participant logger 获取方式改为从 `RunContext.childTrace()` 派生，而不是在各入口用 `runId` 重新创建 logger。

### Phase 4.2：Provider 空响应与未完成 Run 诊断（已落地第一版）

2026-07-02 已完成一轮真实日志驱动修复：

1. `bridge-client` 在记录 provider payload 后立即检查响应正文；空响应升级为 `EMPTY_PROVIDER_RESPONSE`，不再继续进入 planner fallback、tool parser 或任务执行。
2. `agent/network-error` 将空 provider 响应归类为可恢复的 provider/网络边界问题，Agent 应停止当前执行并给出明确可重试说明。
3. `run-log-replay` 新增空响应、未完成 provider 请求、缺少 `agent-run-completed` 三类诊断；真实日志 `.devseek/runs/20260702-171258.log` 可稳定回放出多次空响应和未收敛事实。
4. 新增 `run-log-replay.test.mjs` fixture，确保截图中的“红色失败但无原因”不会再次只被诊断成泛化耗时过长。

该基线的规则是：底层 HTTP/Bridge 不自建“会话事实”，但必须把 provider 传输异常明确挂到同一个 `RunContext`。Planner 和 Todo 不能吞掉这类异常，也不能用本地 fallback 掩盖网页空响应。

### Phase 1.2：聊天路由与源码展示漏执行诊断（已落地第一版）

2026-07-03 根据真实日志 `.devseek/runs/20260703-094912.log` 完成一轮修复：

1. 非 Agent/普通 chat 路径也创建顶层 `RunContext`，并记录 `routing/route-decision`，便于解释一次请求为什么进入 Agent、local execution、plan review 或普通聊天。
2. `AgentChatRequest`、共享 `LLMChatOptions`、`AgentApplicationService` 和 VS Code bridge adapter 已传递 `traceRunId`，避免 shared service 与 extension provider 调用各自生成事实线。
3. 对执行型工作区请求，replay 新增 `source-output-without-application` 诊断：如果 Provider 返回大段源码，但日志里没有工具执行、写盘、终端或验证证据，该 run 必须被标为错误。
4. 该诊断用于防止“代码直接显示在 DeepSeek 网页/DevSeek 对话中，但没有替换原文件，也没有重新编译执行”的问题再次被误认为正常完成。
5. route decision trace 必须包含 intent、workflow、forceNoAgent、agentEnabled 和文件计数；后续截图问题应先从同一 run log 判断是路由、协议、应用、验证还是展示层错误。

### Phase 2.2：GUI 运行证据与旧失败清理（已落地第一版）

2026-07-03 根据真实日志 `.devseek/runs/20260703-130114.log` 完成一轮执行事实归并修复：

1. `ExecutionOutcomeClassifier` 新增交互式/图形程序启动证据识别，`3D Shape Viewer`、`Controls`、鼠标/键盘操作提示等输出进入 manual-review 语义，不再被普通 timeout 或退出码直接判为硬失败。
2. CMake/pkg-config 中 `-- No package 'glut' found` 等非致命探测噪声不再触发通用 `not found` 硬失败规则；真实编译错误仍保留为硬失败。
3. `tools/terminal` 的 observation timer 与 child close 分支统一使用同一分类器和 manual-review context，避免“运行中已弹窗，但 close/timeout 分支又按失败结算”。
4. `run-log-replay` 延迟结算 terminal 非零退出证据：如果后续 payload 显示交互式程序已启动，或最终 `agent-run-completed` 成功，则旧 terminal failure 不再覆盖最终成功事实。
5. 新增 replay fixture 覆盖“GUI timeout + 最终完成”路径，确保先失败后成功的 run 不再残留 `terminal-command-failed` 或 `missing-final-convergence`。

该基线继续强化 `RunContext` 的原则：早期事件只是候选证据，最终 UI/Todos/History 必须读取同一条 run 时间线归并后的结论，不能由某个底层工具分支单独决定整轮失败。

## 5. 验收标准

1. 一次 Agent 执行只创建一个 `.devseek/runs/<runId>.log` 单文件日志，不再为单个 run 额外创建日志目录。
2. `<runId>.log` 第一条是 `run-started`，后续事件按毫秒时间和 seq 可还原完整时序。
3. 同一请求的多轮模型调用、工具调用、验证结果都使用同一个 `runId`。
4. 先失败后修复成功的任务，最终 UI/Todos/History 不保留旧失败。
5. 真实 DeepSeek Web 输出异常时，日志能定位是模型方言、协议适配、工具执行、文件落盘、验证还是 UI 判定问题。
6. 新增 Provider 或工具时，不允许绕过 `RunContext` 和 Evidence Ledger。
