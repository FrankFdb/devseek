# DevSeek 现状与功能回退根因审计

- 日期：2026-07-11
- 基线：`591a266`
- 审计范围：`docs/`、VS Code Extension、Shared、CLI、Bridge、测试脚本和全部 156 条可见 Git 提交

## 1. 执行结论

简单程序编写回退不是孤立缺陷，而是结构性复发：DevSeek 已增加大量能力和局部抽象，但旧执行路径没有在新边界接管后删除，形成多循环、多语义 owner、多 mutation 入口和多套资格解释。

应分别评价三个层次：

| 层次 | 审计结论 |
| --- | --- |
| 目标原则 | 基本正确：Headless Core、Surface Adapter、Provider 隔离、工具/证据/权限由宿主控制 |
| 物理实现 | 未收敛：实际业务编排仍主要位于 VS Code，CLI 另有 Coding Loop，Shared Core 主要做 Provider Chat |
| 产品资格 | 未稳定：deterministic 通过，但当前 commit 没有同提交真实插件成功配额 |

当前 DevSeek 应被定义为“功能丰富但内核未收敛的工程候选”，不能定义为已完成的顶级编程智能体。

## 2. 同一简单任务进入不同执行内核

当前主要分流如下：

```text
用户编程请求
├─ VS Code：无代码附件
│  └─ runAgenticLoop（自由探索循环）
├─ VS Code：有代码附件
│  └─ decomposeTask → runAgentLoop（Architect + Editor）
├─ VS Code：本地运行优先
│  └─ local execution / 独立 repair 路径
└─ CLI 与 PA benchmark
   └─ AgentApplicationService.chat → CLI runCodingLoop
```

直接证据：

- [`extension.ts`](../../packages/vscode-extension/src/extension.ts) 中 `runChat` 是 VS Code 总入口；约第 646～655 行根据 `effectiveFiles` 是否包含代码文件决定循环。
- 无代码附件的“纯代码创建”明确进入 `runAgenticLoop`；有代码附件才进入 `decomposeTask` 与 `runAgentLoop`。
- [`packages/shared/src/agent-application-service.ts`](../../packages/shared/src/agent-application-service.ts) 主要路由 Provider Chat，`plan.reviewDecision`、`permission.decision`、`task.resume`、`task.cancel` 仍返回 UnsupportedCommand。
- [`packages/cli/src/index.ts`](../../packages/cli/src/index.ts) 自己实现 `runCodingLoop`、artifact apply、validation 和 repair。

因此附件不只是上下文，而在改变任务的计划、工具、写盘、验证、完成和 UI 语义。同一自然语言请求在不同入口通过不同代码，是回退的第一根因。

## 3. “Headless Agent Core”目前不是完整事实 owner

目标文档要求：

```text
Surface → Headless Agent Core → Platform/Provider Adapter
```

实际更接近：

```text
VS Code extension.ts
├─ routing / intent / session
├─ agentic-loop
├─ agent-loop
├─ local execution
├─ permission callbacks
├─ mutation callbacks
├─ UI settlement
└─ Provider route

CLI index.ts
├─ context selection
├─ coding loop
├─ artifact apply
└─ validation / repair

Shared AgentApplicationService
└─ chat/provider/history/events 的部分能力
```

这不是 Surface Adapter，而是多个 Surface 拥有不同业务内核。Phase 10～12 的类型与服务存在，不代表业务已经接入同一执行主链。

## 4. Mutation 和验证仍有旁路

当前副作用至少分布在：

- `agent/simple-file-task.ts`
- `agent/deterministic-task-executor.ts`
- `agent/tool-loop.ts`
- `agent-loop.ts`
- `workspace-applier.ts`
- `agent/auto-validation.ts`
- `agent/agent-host-tools.ts`
- `workspace/edit-service.ts`

这些入口分别承担 `writeTextFileSync`、proposal apply、delete、mkdir、Undo 或验证期内容归一化写回。ARCH-18 的 P0-MUTATION 是必要工作，但必须成为“唯一 Coding Kernel”的子任务：如果先把所有 legacy 路径迁入更强事务，却不删除 alternate engine，系统仍然无法收敛。

目标不应只是“统一调用 WorkspaceEditService”，而应是：

```text
AgentRunSaga
  → AuthorityGrant
  → WorkspaceMutationTransaction # 每个 ChangeSet 一个短事务
      → Baseline/Snapshot
      → CAS/Commit Token
      → Read-back Evidence
  → ExternalEffectReceipt         # terminal/network/MCP/Git/release 独立协议
  → Validation（不修改用户交付物；临时构建产物隔离）
  → Review/Undo
  → Settlement/唯一终态
```

所有 Agent mutation、删除、建目录和 Undo 必须经过同一个 workspace-mutation semantic authority；一次 run 可以有多个短事务，由 saga/checkpoint 串联，不能把用户等待和外部调用包进长事务。验证不得修补用户交付物，编译/测试产生的临时文件必须进入声明目录并单独归类。

## 5. 任务语义被重复解释

DevSeek 已有 Intent Router、Workflow Selector、TaskContract、Task Decomposer、Quality Policy、Formal Project Quality、Validation 和 UI settlement。它们分别根据正则、附件、文件扩展名、提示词和运行历史推断任务语义。

后果包括：

- “不要修改输入源码”可能被扩大解释为“整个任务只读”。
- “创建一个简单程序”可能因没有附件绕开 Architect/Editor 路径。
- 文档任务、代码任务、run 请求和 follow-up 使用不同完成证据。
- Provider 文本方言、任务领域词和 UI 需求逐步进入核心判断。

正确边界是：Kernel 创建带 revision lineage 的 `TaskContract`，仅在用户决定或新证据改变目标/约束时显式修订；Router、Plan、Authority、QualityGate、Recovery 和 Surface 消费当前 revision，不能各自重解释目标或决定任务是否完成。

## 6. 测试为什么全绿仍然回退

### 6.1 Static spec grep 不是行为资格

[`workflow-compliance.test.mjs`](../../packages/vscode-extension/test/unit/workflow-compliance.test.mjs) 在文件开头明确说明自己是 static-analysis/spec grep，不能替代完整 E2E。该文件目前包含约 123 个测试，并在 156 条提交中被修改约 73 次。它能防止符号被删除，但无法证明真实用户路径正确。

### 6.2 PA benchmark 没有走 VS Code 主链

[`devseek-programming-agent-benchmark.mjs`](../../scripts/devseek-programming-agent-benchmark.mjs) 通过 Fake Bridge 返回预写的正确 `create_file`、`replace_file` 或 diff，再从 CLI 进入独立 `runCodingLoop`。

它证明的是：

- 预期工具文本可以被 CLI 解析；
- 文件应用、编译和 verifier 可以执行；
- 某些 plumbing 与确定性 repair 可运行。

它没有证明：

- VS Code `runChat` 选择了正确循环；
- 有无附件行为一致；
- 真实 DeepSeek Web 会生成正确协议；
- 精确安装 VSIX 的 UI、权限和终态一致。

### 6.3 当前报告本身没有宣称稳定

审计时本地生成的 Phase 0～12 报告路径为 `docs/testing/phase0-12-verification-reports/2026-07-11T12-54-35-452Z/report.md`；该目录被 Git 忽略，关键事实内嵌如下：

- Result：PASS；
- Qualification：deterministic；
- Stable claim allowed：no；
- Real DeepSeek CLI：not-run；
- Real VS Code plugin：not-run；
- canary `0/3`、medium `0/2`、formal `0/1`。

问题不是报告撒谎，而是开发过程经常把 lower-level PASS 口头扩展成产品能力已经完成。

## 7. 文档现状审计

活跃需求约 3207 行、架构约 5440 行，另有 838 行 Change Gate 和约 990 行发布日志，却没有机器可校验的“需求 → owner → 代码入口 → 测试 → 当前候选资格”矩阵。

典型冲突：

- [`requirements/04-Agent优化路线图.md`](../requirements/04-Agent优化路线图.md) 自称主迭代入口，[`architecture/18`](../architecture/18-优秀编程智能体100%25收敛与新窗口接管计划.md) 又自称唯一执行入口，而审计前的 [`docs/README.md`](../README.md) 未收录 ARCH-18；本次已修订索引并把旧文档列为待状态迁移。
- [`requirements/01-当前需求现状.md`](../requirements/01-当前需求现状.md) 仍说 CLI/JSONL 尚未形成，后续文档又把 Phase 10 写成完成。
- “接入 source-sanity”被写成“统一写入事实”，而 ARCH-18 又列出相同入口尚未接入完整 baseline/CAS/commit-token。
- 旧 PRD、历史路线、事故复盘、最终审计和当前计划都留在活跃区。

文档问题不是数量不足，而是状态粒度和配置管理失效。

## 8. Git 复发模式

156 条可见提交中，81 个主题直接包含 `fix`。高频反复类别：

1. 文件创建、应用、回滚、原子写入和路径锚定。
2. 完成状态、验证证据、Todo、History 和 UI 真相。
3. DeepSeek 工具协议、XML/JSON/DSML 和异常转录恢复。
4. 路由、附件、路径、工程上下文和 session 续作。
5. checkpoint、recovery、progress 和 display。

反复出现的开发模式：

```text
新增抽象
→ 保留旧入口兼容
→ 新旧双轨
→ 新场景绕过抽象
→ 补正则/helper/static test
→ 下一类任务再次回退
```

近期提交面又偏宽：最近 27 个提交平均触碰约 20 个文件、约 1400 行变更。功能、重构、测试、文档和资格经常一起移动，难以归因和回滚。

## 9. 架构预算的盲点

[`devseek-architecture-budgets.json`](../process/devseek-architecture-budgets.json) 只冻结 7 个旧热点文件，并未覆盖 `markdown-deliverable-task`、`task-contract`、`workspace-applier`、`evidence-grounding` 等新增长到 1000～1600 行的文件。

更重要的是，行数预算没有测量：

- 执行引擎数量；
- mutation API 数量；
- Task 语义 owner 数量；
- completion/validation owner 数量；
- Surface 业务分支数量；
- 黄金用户旅程覆盖率。

因此“架构预算通过”不等于架构收敛。

## 10. 保留项与重构项

### 应保留的资产

- Provider Runtime、Bridge 和多 Provider 边界方向。
- TaskContract、EvidenceRef、RunContext、ReviewLedger、QualityGate 的领域概念。
- replay、真实插件 harness、版本/VSIX 绑定和失败分类基础。
- WorkspaceEdit 的 baseline/CAS/commit-token 方向。
- 项目指令、memory、MCP、tool registry 的已有契约。

### 必须重构的边界

- `runChat` 只保留 composition 与 Surface 适配。
- `AgentApplicationService` 升级为真正 `AgentKernel` 或由新的 Kernel 替代。
- `agentic-loop`、`agent-loop`、CLI loop 不再作为并行产品内核。
- Provider 文本解析只存在于 Provider Adapter。
- mutation、validation、completion、resume 各只允许一个 owner。
- simple、medium、formal 使用同一状态机，区别只能是阶段折叠和预算。

## 11. 下一方向决定

最高优先级从单独的 P0-MUTATION 提升为 P0-CODING-KERNEL：

1. 建立能力账本和核心黄金旅程。
2. 复现简单 create/modify/repair 的真实 VS Code 分流。
3. 建立单一、可重入的 `start(TaskRequest)` / `dispatch(runId, AgentCommand)` seam，由内核创建和修订 `TaskContract`。
4. 使附件只影响 Context，不选择执行循环。
5. 将 workspace mutation、external effect、validation 和 completion 接入同一 Kernel 生命周期中的各自唯一 authority/receipt 边界。
6. 迁移一个纵切就删除一个旧 owner，并增加静态依赖守卫。
7. 核心旅程跨 Headless、VS Code、CLI 一致后，再恢复高级能力建设。

这能直接阻止“正式 Markdown 能力增强、简单程序却回退”的能力倒挂。
