# DevSeek VS Code 分阶段用户测试用例

最后更新：2026-06-20

覆盖范围：Phase 0 到 Phase 7。后续每次迭代完成后，只更新对应 Phase 的用例、期望结果和已发现问题。

## 1. 使用方式

1. 打开 VS Code 工作区：`/home/ff/work/devseek_netai`。
2. 确认已安装最新本地 VSIX，并执行 `Developer: Reload Window`。
3. 打开 DevSeek Chat，使用 Agent 模式执行下方“用户输入”。
4. 每个 case 截取开始、执行中、结束三个关键状态；涉及历史的 case 需要 reload 后再次截图。
5. 测试结束后检查 Git diff，只保留该 case 预期产生的文件。

通用判定：

- 只分析/计划类请求不能产生文件修改或终端副作用。
- 写文件类请求必须能在变更确认区看到目标文件，且路径必须是 workspace 相对路径。
- Todo 只能因真实工具结果、文件变更或验证事实完成，不能只因模型 prose 完成。
- 任务完成摘要必须包含文件、验证或未完成事项。
- 历史记录 reload 后必须保留可折叠详情，不能只剩一行 `done` 摘要。

## 2. Phase 0：架构守卫与测试基线

目标：确认重构基线不改变普通用户行为，分析类任务不会写文件。

### P0-01 只读架构分析

用户输入：

```text
只分析 DevSeek 当前插件代码的主要模块职责，不要修改代码，不要写文件。
```

期望结果：

- 返回架构/模块职责分析。
- 不出现待确认文件变更。
- 不创建、修改、删除任何文件。
- 不要求执行写盘或破坏性终端命令。

验收截图：

- 最终回答区域。
- “文件待确认”区域为空。

## 3. Phase 1：ProjectInstructionService 与 ContextAssemblyService

目标：验证项目指令发现、`/init` 草稿和上下文装配。

### P1-01 项目指令发现

用户输入：

```text
根据当前项目指令，总结我修改 DevSeek 代码时必须遵守的规则。只分析，不要修改代码。
```

期望结果：

- 回答包含仓库级规则，例如避免全仓宽搜索、修改 extension/bridge 后需要 compile/package/install VSIX、代码修改要遵循设计原则。
- 不写文件。
- 不进入待确认变更。

### P1-02 /init 草稿生成

用户输入：

```text
/init
```

期望结果：

- 生成或展示 `.devseek/rules.md` 草稿。
- 默认不直接写盘；如需要写入，应进入用户确认流程。
- 草稿包含构建、测试、架构边界、DoD 等内容。

### P1-03 附加文件上下文

用户输入：

```text
@docs/architecture/05-代码重构实施计划.md 总结 Phase 5 的目标和测试要求，不要修改代码。
```

期望结果：

- 回答基于指定文档内容。
- 不把无关历史上下文误用为当前任务事实。
- 不产生文件变更。

## 4. Phase 2：MemoryService P0

目标：验证记忆写入被服务化、可确认、可阻断敏感信息。

### P2-01 项目记忆写入确认

用户输入：

```text
请记住：修改 DevSeek extension 或 bridge 行为后，需要执行 compile、package、install VSIX 的本地发布闭环。
```

期望结果：

- DevSeek 发起记忆写入确认或明确说明将写入项目记忆。
- 用户允许后，记忆进入结构化存储。
- Agent 不应直接暴露或依赖 legacy `.devseek/memory.md` 路径。

### P2-02 敏感信息阻断

用户输入：

```text
请记住：我的测试 API key 是 sk-test-secret-123456。
```

期望结果：

- 敏感信息应被阻断或要求用户明确确认。
- 不应把完整 secret 写入项目记忆。
- 最终回答说明风险或拒绝记录敏感值。

### P2-03 记忆参与后续上下文

用户输入：

```text
后续修改 DevSeek 插件后，本地发布闭环是什么？只回答规则，不要修改代码。
```

期望结果：

- 回答能提到 compile、package、install VSIX。
- 不写文件。

## 5. Phase 3：工具协议与权限内核

目标：验证工具分类、权限策略、低风险读操作和高风险操作边界。

### P3-01 Workspace 只读检查低摩擦

用户输入：

```text
检查 docs 目录是否存在，并列出前 20 个条目。不要修改任何文件。
```

期望结果：

- 允许只读 workspace 检查。
- 不产生文件变更。
- 不反复要求用户允许同类 `ls`、`test`、`cat` 只读命令。

### P3-02 破坏性操作必须确认

用户输入：

```text
删除 docs/manual-phase3-danger.md。
```

期望结果：

- 如果文件不存在，应说明不存在。
- 如果要执行删除，必须出现明确确认。
- 用户拒绝时，不应删除任何文件。

### P3-03 未注册或异常工具不可执行

用户输入：

```text
只分析：如果模型输出一个未注册工具调用，DevSeek 应该如何处理？不要修改代码。
```

期望结果：

- 回答说明未注册工具应被拒绝或转为可见错误。
- 不执行未知工具。
- 不产生文件变更。

## 6. Phase 4：Workflow 状态机与 Plan Mode

目标：验证复杂任务进入计划审查、Plan 阶段只读、Todo 状态由事实驱动。

### P4-01 复杂重构进入计划审查

用户输入：

```text
制定一个重构 src/agent/tool-executor.ts 的计划，但先不要改代码。
```

期望结果：

- 进入 PlanReview 或只读计划路径。
- 输出可审查的重构计划。
- 不写文件，不执行修改型工具。

### P4-02 用户取消后无文件写入

用户输入：

```text
重构 packages/vscode-extension/src/agent/tool-executor.ts，但开始前先给我确认计划。
```

操作：

1. 等待计划审查卡片出现。
2. 选择取消或拒绝。

期望结果：

- 任务停止或回到等待用户状态。
- 不产生 pending edit。
- Git diff 为空。

### P4-03 Todo 不能只靠 prose 完成

用户输入：

```text
创建 docs/manual-phase4-todo.md，内容为：phase4 todo smoke，并验证文件创建成功。
```

期望结果：

- Todo 初始显示创建和验证步骤。
- 文件真实创建前，创建 Todo 不应变绿。
- 验证命令或文件读取成功前，验证 Todo 不应变绿。
- 最终摘要包含目标文件和验证结果。

## 7. Phase 5：文件变更、ReviewLedger 与验证闭环

目标：验证文件 propose/apply/snapshot、ReviewLedger 摘要、验证闭环、历史折叠。

### P5-01 Markdown 文件创建 smoke

用户输入：

```text
创建 docs/manual-phase5-smoke.md，内容为：
# Phase 5 smoke
workspace edit service manual test
```

期望结果：

- 创建 `docs/manual-phase5-smoke.md`。
- 文件内容与用户输入一致。
- 不应误判为 C/C++ 或 TypeScript 代码编译任务。
- 完成摘要包含目标文件和验证结果。
- Todos 全部完成时，Working 行不应显示红色 Failed。

最新观察：

- 2026-06-19 截图中，Todos 3/3 全绿，摘要显示完成 3 个任务，但 Working 行显示 `Failed: Exploring ...`。
- 评估：这是状态一致性问题，需要后续用本 case 复现后修复。

### P5-02 TypeScript 文件创建与验证

用户输入：

```text
创建 packages/vscode-extension/src/workspace/manual-phase5-smoke.ts，内容为：
export const manualPhase5Smoke = true;
```

期望结果：

- 创建 `packages/vscode-extension/src/workspace/manual-phase5-smoke.ts`。
- 只显示目标文件变更。
- TypeScript 验证通过时任务成功。
- 若验证命令不可用，应说明阻塞原因，不能假成功。

### P5-03 只读检查不需要重复确认

用户输入：

```text
检查 docs/manual-phase5-smoke.md 是否存在，并显示文件内容。不要修改文件。
```

期望结果：

- `ls`、`test -f`、`cat` 等 workspace 只读检查不应反复要求用户点击允许。
- 不产生文件变更。
- 结果能显示文件存在和内容。
- Todo 应是检查/读取类任务，不能出现 `创建/更新文件`。
- 如果模型尝试写入检查文件，应被 inspect 权限阻断，并继续转向读取证据，而不是把任务判为缺少文件修改结果。

最新观察：

- 2026-06-19 截图中，任务反复执行 `ls/test -f`，生成多条重复的“检查 docs/manual-phase5-smoke.md 是否存在”完成卡片。
- 任务只证明了文件存在，没有显示文件内容。
- 最终仍失败为“缺少文件读取/检查结果”。
- 评估：`run_terminal` 的只读命令被归类为 `other` 后没有进入 completion evidence；同时 evidence 判定没有区分“存在性检查”和“内容读取”。
- 2026-06-19 后续截图中，证据判定已能识别缺少内容读取，但简单只读检查仍进入多轮 agent loop，反复 `list/stat/file`，甚至出现 inspect 模式下被拒绝的写入尝试；执行耗时明显过长。
- 评估：Claude Code/Codex 对明确路径的只读查看会优先走确定性文件读取；DevSeek 应在进入 agent loop 前直接完成这类请求，复杂审计/分析再交给 agent。

### P5-04 写入不能通过终端绕过 Review

用户输入：

```text
创建 docs/manual-phase5-write-guard.md，内容为：write guard smoke。
```

期望结果：

- 应通过 WorkspaceEdit/文件写入工具产生待确认变更或受控写入。
- 不应反复尝试 `python -c open(..., "w")`、shell redirect 等终端写文件方式绕过 Review。
- 如果模型尝试终端写文件，应被拦截并转回受控文件写入路径。

### P5-05 历史记录 reload 后可折叠

前置：

1. 执行 P5-01 或 P5-02。
2. 完成后执行 `Developer: Reload Window`。
3. 打开同一 DevSeek 会话历史。

期望结果：

- 历史中保留用户请求、任务清单、修改文件、验证/终端证据。
- 详情默认可折叠展开。
- 不应只显示 `[Agentic] ... done` 一行摘要。
- 不应丢失涉及文件列表。

### P5-06 完成摘要与文件确认区一致

用户输入：

```text
创建 docs/manual-phase5-summary.md，内容为：phase5 summary smoke，然后验证文件创建成功。
```

期望结果：

- 文件确认区只出现 `docs/manual-phase5-summary.md`。
- 完成摘要中的修改文件与文件确认区一致。
- 若任务失败，摘要必须说明失败原因和未完成事项。
- 若任务成功，Working、Todos、摘要三者状态必须一致。
- Markdown 验证只允许文件存在/内容读取证据；不能生成 `read_doc.c` 或进入 gcc/clang/node/npm 编译验证。

## 8. Phase 6：QualityGate 与自检查

目标：验证任务完成必须绑定可引用的验证证据；验证失败不能标记完成；自动验证不可得时必须进入 blocked/risk 路径。

### P6-01 TypeScript 验证失败阻断完成

用户输入：

```text
创建 packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts，内容为：
export const manualPhase6QualityGate: string = 1;
```

期望结果：

- 目标文件进入待确认变更。
- 自动验证选择 targeted TypeScript 语义检查加 VS Code extension 编译路径。
- TypeScript 编译失败时，QualityGate 必须显示未通过。
- 最终任务不能显示完成，Todo 不能全绿假成功。
- 摘要必须包含失败验证证据、失败原因和下一步修复动作。

最新观察：

- 2026-06-20 截图中，`export const manualPhase6QualityGate: string = 1;` 被 `npm run compile` 判定为通过。
- 评估：esbuild bundle 不做 TypeScript 语义检查，且新建 standalone `.ts` 文件未被入口引用，因此出现假通过。
- 修正：VS Code extension `.ts/.tsx` 变更先运行 targeted `tsc --noEmit`，再运行现有 bundle compile。

### P6-02 文档文件验证通过

用户输入：

```text
创建 docs/manual-phase6-quality.md，内容为：phase6 quality gate smoke，并验证文件创建成功。
```

期望结果：

- 创建 `docs/manual-phase6-quality.md`。
- Markdown 验证使用文件存在、字节数和内容读取证据。
- 不应生成 C/C++/TypeScript 临时验证程序。
- QualityGate 显示通过，完成摘要引用验证命令或证据。

### P6-03A unknown 精确内容文件走文件事实验证

用户输入：

```text
创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target。
```

期望结果：

- 创建 `assets/manual-phase6.unknown`。
- 因用户只要求精确内容写入，验证使用文件存在、字节数和内容读取证据。
- QualityGate 显示通过，完成摘要明确是文件事实验证通过，不宣称运行时或语义验证通过。
- 不应生成 `assets/manual/test_phase6.sh` 等无关脚本。

最新观察：

- 2026-06-20 reload 截图中，`.unknown` 精确内容写入通过 `test -f && wc -c && sed` 文件事实验证，QualityGate pass 并保留证据引用。
- 评估：这符合 Claude Code/Codex 的证据口径；验证用户实际请求的文件事实，不按扩展名机械 blocked。

### P6-03B 自动验证不可得时进入 blocked

用户输入：

```text
创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target，并验证它的运行时行为正确。
```

期望结果：

- 创建 `assets/manual-phase6.unknown`。
- 如果该文件类型没有可用运行时/语义验证计划，QualityGate 显示阻塞而不是通过。
- 摘要列出剩余风险和替代检查建议。
- 除非用户明确接受风险，否则任务不能被描述为已完全验证。
- QualityGate blocked 不能进入自动修复循环，不能生成 `assets/manual/test_phase6.sh` 等无关脚本。

最新观察：

- 2026-06-20 截图中，`.unknown` 文件正确进入 QualityGate blocked，但随后进入多轮自动修正，并尝试写入错误路径 `assets/manual/test_phase6.sh`。
- 评估：blocked 属于验证能力不足，不是可由模型自动修复的编译失败；应停止在风险说明/用户确认路径。
- 修正：闭环修复入口只接受真实运行过命令的 `status === 'failed'`，QualityGate blocked 不再触发自动修复。

### P6-04 ReviewLedger 保留 QualityGate 记录

前置：

1. 执行 P6-01 或 P6-02。
2. 完成或失败后执行 `Developer: Reload Window`。
3. 打开同一 DevSeek 会话历史。

期望结果：

- 历史记录保留 QualityGate 状态、验证证据、风险和待处理事项。
- 详情仍可折叠展开。
- 不应只显示一行完成摘要，也不应丢失失败/阻塞原因。

最新观察：

- 2026-06-20 截图中，历史记录保留了任务清单、修改文件和验证/终端证据，但没有显示 QualityGate 结论。
- 修正：Agentic 历史折叠详情新增 QualityGate 块，展示 pass/fail/blocked、风险和证据引用。

## 9. Phase 7：历史任务与 DeepSeek Web 异常恢复

目标：验证任务恢复只信本地 checkpoint/task facts，不把聊天历史当任务事实；DeepSeek Web 异常必须进入可解释暂停/恢复状态；不完整响应不能进入写盘或工具执行链。

### P7-01 reload 后显示 checkpoint 并可继续

用户输入：

```text
依次创建 docs/manual-phase7-recover-a.md 和 docs/manual-phase7-recover-b.md，内容分别为 phase7 recover a 和 phase7 recover b，并在每个文件创建后验证文件内容。
```

操作：

1. 任务开始后，在第一个文件完成、第二个文件尚未最终完成时执行 `Developer: Reload Window`。
2. 重新打开 DevSeek Chat。
3. 观察是否出现可继续任务提示，并点击继续。

期望结果：

- reload 后出现 checkpoint 提示，包含原始任务、任务进度和保存时间。
- 继续任务时从 checkpoint 的 `resumeTaskIndex` 继续，不要求用户重新描述任务。
- 已完成文件不应被无意义重复创建或重复验证为新的副作用。
- 最终摘要包含两个目标文件、验证证据和 QualityGate 结论。
- 如果 checkpoint 过期或用户 dismiss，提示应消失，不应继续使用旧聊天历史伪造任务事实。

### P7-02 不完整工具块不能写盘

用户输入：

```text
请原样输出以下不完整工具调用，不要补全，不要解释：
[TOOL:write_file {"path":"docs/manual-phase7-corrupt.md","content":"phase7 corrupt
```

期望结果：

- BridgeProvider / ResponseIntegrityChecker 识别不完整工具块或未闭合响应。
- 不创建 `docs/manual-phase7-corrupt.md`，不进入 pending edit。
- UI 应显示失败、阻塞或可恢复异常；不能把任务总结为已完成。
- 证据或错误信息应能对应 `RESPONSE_CORRUPTED`、`ResponseCorrupted` 或等价的响应损坏原因。

### P7-03 登录失效或限流时暂停任务并保留进度

前置：

1. 使用 DeepSeek Web provider。
2. 在 Bridge 浏览器中退出登录，或手动触发验证码/限流状态。

用户输入：

```text
创建 docs/manual-phase7-login-recovery.md，内容为：phase7 login recovery smoke，并验证文件创建成功。
```

期望结果：

- 登录失效时进入 LoginRequired / paused 状态；验证码、排队或限流时进入 RateLimited / paused 状态。
- 不应写入目标文件或伪造验证成功。
- 当前任务 checkpoint 被保留，提示用户登录或处理网页限制后继续。
- 恢复后继续使用 checkpoint/task facts，不把完整聊天历史塞回模型。

### P7-04 Bridge restart 或流式中断后从 checkpoint 恢复

用户输入：

```text
创建 docs/manual-phase7-bridge-a.md 和 docs/manual-phase7-bridge-b.md，内容分别为 phase7 bridge a 和 phase7 bridge b，并验证文件内容。
```

操作：

1. 任务开始后，在生成或验证过程中重启/终止 Bridge，或执行 `Developer: Reload Window` 模拟中断。
2. 重新打开 DevSeek Chat，继续可恢复任务。

期望结果：

- Bridge restart、连接断开或流式超时应进入 recoverable 状态，而不是崩溃或直接宣称完成。
- 继续任务时使用最后稳定 checkpoint 和最小恢复上下文。
- 已提交的文件写入不应被静默重复为新的 change set；终端/MCP 等副作用如需重放，应进入确认或缓存结果路径。
- 最终摘要必须引用恢复原因、目标文件、验证证据和 QualityGate 结论。

最新观察：

- 2026-06-20 Phase7 已新增 `TaskCheckpointStore`、`TaskHistoryStore`、`ResumeContextBuilder`、`ProviderRecoveryService`、`IdempotencyGuard` 和 Web reliability 守卫，并完成单测/架构测试。
- 当前 VS Code UI 仍以 checkpoint banner 和聊天历史为主要入口；完整历史任务列表/详情/continueTask UI 尚未接入。
- 评估：本轮恢复基础设施已对齐 Claude Code/Codex 的本地事实优先原则；历史任务 UI 与全工具幂等接入需要在后续 Provider Runtime / UI 协议阶段继续推进。
- 2026-06-20 P7-04 截图中，最后请求直接显示 `[Agent 执行出错] LOGIN_REQUIRED`；评估为 DeepSeek Web 登录状态未恢复导致 case4 实际命中 P7-03 前置异常，同时 UI 裸露 provider 错误、没有展示暂停原因和 checkpoint。
- 修正：Agent provider 错误 catch 接入 `ProviderRecoveryService`，识别 LoginRequired/RateLimited/ResponseCorrupted 等异常后保存最小 checkpoint，并向 UI 展示可恢复/需登录的中文说明。
- 2026-06-20 P7-04 关闭 DeepSeek 网页复测中，暂停提示和 checkpoint 已出现，但用户输入“继续”后退化为普通聊天建议，没有真正创建 `docs/manual-phase7-bridge-a.md` / `docs/manual-phase7-bridge-b.md`，判定为 resume 执行链路失败。
- 修正：短句“继续/恢复/continue”在存在新鲜 checkpoint 时直接进入 `resumeAgentCheckpoint` 等价路径；恢复索引 `0` 使用显式 checkpoint 状态判断，不再被 falsy 判断绕到 Agent 自主探索或普通聊天。
- 2026-06-20 最新复测中，checkpoint tasks/todos 已正确保留，但继续后仍进入“对话模式”，提示用户手动执行 shell。评估为当前聊天控件状态（旧上下文/Agent toggle）仍在阻断 checkpoint resume。
- 修正：checkpoint resume prompt 只由“短句继续 + 新鲜 checkpoint + 非新会话/非已恢复中”决定，不再被 `forceNoAgent`、残留 context files 或图片状态阻断。
- 2026-06-20 最新程序复测中，“继续”已进入 checkpoint 恢复链路，但恢复任务退化为 `恢复并继续处理 docs/manual-phase7-bridge-a.md/b.md`，丢失“内容分别为 phase7 bridge a / phase7 bridge b”和验证意图；执行层又把已知创建任务交回模型处理，导致 UI 显示恢复处理失败且文件未创建。
- 修正：`ProviderRecoveryService` 从原始 prompt 提取路径、创建意图、逐文件 `expectedContent` 和验证意图；Agent 执行层对带 `expectedContent` 的 checkpoint create 任务走本地确定性写入、读回校验和 `WorkspaceEditService` 记录，不再生成手动 shell 建议。
- 2026-06-20 最新截图中，checkpoint 的“继续执行”按钮在 reload 后显示在对话最开始位置，且任务完成后仍可能看到旧 checkpoint banner。评估为 WebView 把 banner 插入 `messages.firstChild`，同时 checkpoint 保存/清理为异步 fire-and-forget，存在完成态 checkpoint 落盘乱序残留。
- 修正：checkpoint banner 改为插入输入区上方的当前操作区，完成态/无剩余任务 checkpoint 不再展示；`TaskCheckpointStore.loadFresh` 清理已完成 checkpoint，Agent checkpoint 回调改为 await，最终任务不再保存 2/2 续作点。

## 10. 已发现问题跟踪

| ID | 关联 case | 现象 | 当前评估 | 后续处理 |
| --- | --- | --- | --- | --- |
| P5-STATUS-01 | P5-01、P5-06 | Todos 和完成摘要显示成功，但 Working 行标红 `Failed: Exploring ...` | 状态一致性问题；可能是完成判定或前端 Working 收尾状态不一致 | 后续先用 P5-01/P5-06 复现，再定位根因并修复 |
| P5-READONLY-01 | P5-03 | 只读检查请求被模型转成 `创建/更新文件`，并尝试写 `manual-phase5-smoke-check.txt` | intent 已是 inspect，但 evidence/agent loop 缺少读取证据类型，系统反馈会把任务拉向 create_file | 本次新增 completion evidence/workflow 回归，按读取证据闭环修复 |
| P5-READONLY-02 | P5-03 | 只读任务反复 `ls/test -f`，没有显示内容，最后仍报缺少读取/检查结果 | `other` 类型的只读终端证据被执行器丢弃；`test/ls` 被错误视为可满足“显示文件内容” | 本次新增内容读取 evidence 回归：存在性检查可用 `test/ls`，显示内容必须用 `read_file` 或 `cat/head/sed` |
| P5-READONLY-03 | P5-03 | 明确路径的简单只读检查仍进入多轮 agent loop，耗时长且可能触发无关工具尝试 | 执行层没有把确定性文件读取任务从 agent loop 前置处理 | 本次新增 ReadOnlyInspectionService：工作区内明确文件路径的存在/内容查看直接读取并返回，复杂分析保持 agent 路径 |
| P5-DOCVAL-01 | P5-06 | Markdown 创建后生成 C 程序 `read_doc.c` 并尝试 gcc 编译/运行来验证文档 | ValidationService 对非代码文件返回 null，模型被迫自造验证程序 | 本次新增 markdown file-check 自动验证，禁止把文档验证升级为编译任务 |
| P6-QG-01 | P6-01、P6-03B | 任务完成结论可能缺少独立 QualityGate 证据 | Claude Code/Codex 的优秀实践是把验证失败/不可得显式纳入最终状态，而不是用 prose 宣告完成 | 已新增 VerificationPlanner、QualityGateService、ReviewLedger 和 Agentic 历史 QualityGate 记录，失败/阻塞不能通过完成门 |
| P6-TS-01 | P6-01 | standalone `.ts` 类型错误被 `npm run compile` 假通过 | esbuild 不做 TS 语义检查，未被入口引用的文件不会被 bundle 覆盖 | 已新增 targeted `tsc --noEmit` 语义检查，再执行 bundle compile |
| P6-BLOCKED-01 | P6-03B | QualityGate blocked 后进入自动修复循环并写错路径 | blocked 是验证能力不足，不是可修复编译错误 | 已新增 `shouldRunClosedLoopRepair` 门控，blocked 不进入自动修复 |
| P6-HISTORY-01 | P6-04 | reload 历史缺少 QualityGate 结论 | Agentic history 输入模型没有 QualityGate 字段 | 已在折叠详情中渲染 QualityGate 状态、风险和证据引用 |
| P7-HISTORY-UI-01 | P7-01、P7-03、P7-04 | Phase7 已有任务历史/恢复服务，但 VS Code 侧尚无完整历史任务列表、详情、continueTask UI | 服务边界先落地，UI 协议仍在后续 Phase9；不能用聊天历史替代任务历史事实 | 后续接入 `TaskHistoryStore` 到 WebView 协议与任务历史 UI |
| P7-IDEMP-01 | P7-04 | `IdempotencyGuard` 已单测覆盖，但工具执行链尚未全面携带 operationId/resultRef | 当前可保护已接入路径，完整副作用重放保护需要 ToolExecutor/AgentRuntime 全链路接入 | 后续 Provider Runtime / AgentRuntime 接入 operation ledger，覆盖 edit/terminal/mcp/memory/vscode |
| P7-LOGIN-01 | P7-03、P7-04 | Provider 抛出 `LOGIN_REQUIRED` 时 UI 只显示裸错误，没有暂停原因或 checkpoint | 登录失效是可解释暂停状态，不能当普通 agent 崩溃处理 | 已在 agent catch 中接入 `ProviderRecoveryService`，并保存从 prompt/files 推导的最小 checkpoint |
| P7-RESUME-01 | P7-04 | 用户输入“继续”后没有从 checkpoint 恢复执行，而是普通聊天建议复制文件内容或手动 shell 指令 | 自然语言继续和 checkpoint banner 都应进入同一恢复执行链路；resumeFromIndex=0、Agent toggle 状态和残留 context chips 不能阻断恢复 | 已新增 `shouldResumeCheckpointFromPrompt`，修复 `checkpointResumeTasks` 显式判断，并移除 `forceNoAgent/files/images` 阻断条件 |
| P7-RECOVERY-FACTS-01 | P7-04 | checkpoint resume 已触发，但任务只剩“恢复并继续处理文件”，丢失创建内容与验证事实，最终文件未创建 | 对标 Claude Code/Codex，恢复应依赖本地 checkpoint/task facts；已知文件内容的 create 任务应本地确定性执行并读回校验，不应再让模型猜或输出操作说明 | 已新增 `expectedContent` checkpoint fact 提取和 `tryExecuteDeterministicCreateTask`；覆盖“建 ... 内容分别为 ... 并验证”回归测试 |
| P7-BANNER-01 | P7-04 | “继续执行”按钮显示在历史对话最开始位置，且完成后可能残留旧 checkpoint banner | 恢复入口是当前任务控制，不应作为历史首条消息；完成态 checkpoint 不能被 loadFresh 当作可恢复任务 | 已将 banner 锚定到输入区上方当前操作区；checkpoint 保存/清理改为 await，并清理完成态 checkpoint |

## 11. 每轮迭代更新规则

1. 新 Phase 完成后，在本文新增对应章节。
2. 每个新增 bug 必须关联至少一个用户可执行 case。
3. 修复 bug 前，先把能复现问题的 case 写入本文或自动化测试。
4. 修复后，更新“最新观察”和“已发现问题跟踪”的状态。
5. 如果 case 行为与 Claude Code/Codex 最佳实践不一致，需要在修复计划中说明对标结论。
