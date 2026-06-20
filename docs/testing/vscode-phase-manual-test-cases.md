# DevSeek VS Code 分阶段用户测试用例

最后更新：2026-06-19

覆盖范围：Phase 0 到 Phase 6。后续每次迭代完成后，只更新对应 Phase 的用例、期望结果和已发现问题。

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

### P6-03 自动验证不可得时进入 blocked

用户输入：

```text
创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target。
```

期望结果：

- 如果该文件类型没有可用自动验证计划，QualityGate 显示阻塞而不是通过。
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

## 9. 已发现问题跟踪

| ID | 关联 case | 现象 | 当前评估 | 后续处理 |
| --- | --- | --- | --- | --- |
| P5-STATUS-01 | P5-01、P5-06 | Todos 和完成摘要显示成功，但 Working 行标红 `Failed: Exploring ...` | 状态一致性问题；可能是完成判定或前端 Working 收尾状态不一致 | 后续先用 P5-01/P5-06 复现，再定位根因并修复 |
| P5-READONLY-01 | P5-03 | 只读检查请求被模型转成 `创建/更新文件`，并尝试写 `manual-phase5-smoke-check.txt` | intent 已是 inspect，但 evidence/agent loop 缺少读取证据类型，系统反馈会把任务拉向 create_file | 本次新增 completion evidence/workflow 回归，按读取证据闭环修复 |
| P5-READONLY-02 | P5-03 | 只读任务反复 `ls/test -f`，没有显示内容，最后仍报缺少读取/检查结果 | `other` 类型的只读终端证据被执行器丢弃；`test/ls` 被错误视为可满足“显示文件内容” | 本次新增内容读取 evidence 回归：存在性检查可用 `test/ls`，显示内容必须用 `read_file` 或 `cat/head/sed` |
| P5-READONLY-03 | P5-03 | 明确路径的简单只读检查仍进入多轮 agent loop，耗时长且可能触发无关工具尝试 | 执行层没有把确定性文件读取任务从 agent loop 前置处理 | 本次新增 ReadOnlyInspectionService：工作区内明确文件路径的存在/内容查看直接读取并返回，复杂分析保持 agent 路径 |
| P5-DOCVAL-01 | P5-06 | Markdown 创建后生成 C 程序 `read_doc.c` 并尝试 gcc 编译/运行来验证文档 | ValidationService 对非代码文件返回 null，模型被迫自造验证程序 | 本次新增 markdown file-check 自动验证，禁止把文档验证升级为编译任务 |
| P6-QG-01 | P6-01、P6-03 | 任务完成结论可能缺少独立 QualityGate 证据 | Claude Code/Codex 的优秀实践是把验证失败/不可得显式纳入最终状态，而不是用 prose 宣告完成 | 已新增 VerificationPlanner、QualityGateService、ReviewLedger 和 Agentic 历史 QualityGate 记录，失败/阻塞不能通过完成门 |
| P6-TS-01 | P6-01 | standalone `.ts` 类型错误被 `npm run compile` 假通过 | esbuild 不做 TS 语义检查，未被入口引用的文件不会被 bundle 覆盖 | 已新增 targeted `tsc --noEmit` 语义检查，再执行 bundle compile |
| P6-BLOCKED-01 | P6-03 | QualityGate blocked 后进入自动修复循环并写错路径 | blocked 是验证能力不足，不是可修复编译错误 | 已新增 `shouldRunClosedLoopRepair` 门控，blocked 不进入自动修复 |
| P6-HISTORY-01 | P6-04 | reload 历史缺少 QualityGate 结论 | Agentic history 输入模型没有 QualityGate 字段 | 已在折叠详情中渲染 QualityGate 状态、风险和证据引用 |

## 10. 每轮迭代更新规则

1. 新 Phase 完成后，在本文新增对应章节。
2. 每个新增 bug 必须关联至少一个用户可执行 case。
3. 修复 bug 前，先把能复现问题的 case 写入本文或自动化测试。
4. 修复后，更新“最新观察”和“已发现问题跟踪”的状态。
5. 如果 case 行为与 Claude Code/Codex 最佳实践不一致，需要在修复计划中说明对标结论。
