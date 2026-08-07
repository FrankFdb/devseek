---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "active-baseline"
  path: "docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md"
  source_group: "handoff"
  decision: "active"
  relationship: "primary"
  document_id: "PROCESS-CURRENT-CONVERGENCE-PLAN"
  document_type: "process"
  active_baselines: []
  machine_sources:
    active_selector: "docs/process/devseek-active-baseline-selector.json"
    legacy_inventory: "docs/process/devseek-legacy-doc-inventory.json"
  asserts_gate_pass: false
---

# DevSeek 当前收敛迭代计划

- 首要产品目标：按本目录 01～20 的需求、审计、目标架构和能力路线，以 Codex 和 Claude Code 的官方公开能力与可观察优秀行为为主要对标，持续优化 DevSeek，使其达到顶级编程智能体的任务理解、自主实施、工具使用、故障恢复、结果验证和跨 Surface 一致性。
- 文档作用：01～20 是实现输入和验收依据，不是产品目标本身；文档收敛和归档只是对应能力真实完成后的治理结果，不得反向驱动实现取舍。
- 当前结论：顶级编程智能体目标尚未达成；三 Surface canonical Kernel 现共用稳定语义工具身份、不可变磁盘 operation journal、workspace/external effect 持久化对账，以及版本化需求、外部来源、验收、设计、change plan 和计划修订决策。自然任务中模型/工具提议的具体目标必须在副作用前形成证据绑定、可追溯父计划的修订；显式 `no-other-files`、glob 和 workspace 边界仍 fail closed。旧内存 fallback 与 VS Code 平行需求 owner 已从生产代码删除；C4/C5 六项能力为 `wired`，qualification claims 仍为 0。五类固定回归之外，I10～I16 共 35 个能力增量用户案例已通过本地验证。C1～C14 当前为 30/69 项 `wired`、39 项 `proposed`，剩余核心工作是 C8～C10 实施验证交付、C6 连接器能力协商、C7 其余平台安全、C11 协作长任务、C13 扩展边界和 C14 受保护资格；实时外部来源获取、clarification/steer、外部新证据驱动的需求/设计修订与可审阅计划状态仍需继续产品化。
- 状态词：`completed`、`in_progress`、`pending`、`blocked_external`。
- 更新规则：本文只记录完成状态、待办任务、依赖和验收条件；执行日志、命令输出、时间线和历史回执不写入本文。

## 对标执行规则

| 步骤 | 要求 | 依据 |
| ---: | --- | --- |
| 1 | 对每个缺陷类或能力切片，先确认 Codex 和 Claude Code 在同类问题上的官方公开机制和可观察行为 | `02-Codex-Claude-Code-DevSeek软件架构对比.md` |
| 2 | 从对标行为提取可验证的 DevSeek 契约，不推测、不复制竞品闭源内部架构 | `02` 的公开事实层与架构推导层 |
| 3 | 将契约实现到唯一 AgentKernel、工具、权限、验证和完成语义中，不为单一用例新增平行路径 | `03-顶级编程智能体目标软件架构.md` |
| 4 | 用真实用户入口、构建/测试反馈、故障恢复和工作区结果验证闭环，再判断是否达到对标行为 | `05-黄金用户旅程与正式项目资格方案.md` |

## 服务产品目标的实现准则

以下准则是优化迭代的约束，用于保证顶级编程智能体的行为质量和长期可演进性；遵守准则不等于产品目标已达成。

| 优先级 | 准则 | 验收要求 |
| --- | --- | --- |
| 1 | 行为契约 | 先固定用户可见行为、失败语义、恢复语义和证据边界 |
| 2 | 唯一语义 owner | 同一决策只有一个权威实现，其他入口只做适配和组合 |
| 3 | 单一职责 | 按稳定职责、依赖和测试边界拆分，不按行数机械切文件 |
| 4 | 依赖方向与接口隔离 | 内核不依赖 Surface 细节，端口不暴露无关能力 |
| 5 | 可测试、可恢复、可观测 | 职责拆分时同步迁移测试，为同类入口增加防绕过守卫 |
| 6 | 代码大小护栏 | 行数仅用于防止回退；只有命名职责、依赖和测试一起迁出后才下调上限 |

## 完成状态

| 范围 | 状态 | 当前事实 |
| --- | --- | --- |
| C0 本地实现与机器裁决前置 | `completed` | 7/7 implementation requirements satisfied，repository blockers=0，local conformance=`PASSED` |
| Extension 类型与发布门禁 | `completed` | TypeScript 基线零错误；旧专属 owner/测试清退并新增 shared 边界测试后 163/163 extension suite 通过；行为变更必须提交后重新编译、打包、安装并精确核对 source/artifact/install/runtime，上一稳定 `bf19be1` 仅作回退基线，`realistic-product` 继续作为发版门禁 |
| Surface 入口盘点 | `completed` | 88/88 入口受 inventory 覆盖，其中 Headless product entry=1；未知入口与未声明 legacy owner 可达性均为 0 |
| Kernel owner 收敛基线 | `completed` | v25 将本地产品迭代与资格晋级解耦；4 条活跃路由均通过 shared `CanonicalCodingKernel`，legacy execution owner=0；30 个语义域均为 shared 单一 owner、missing Surface=0；122/122 源码断言通过 |
| VS Code 旧执行 owner 清退 | `completed` | 零生产可达性确认后，旧 `agent-loop.ts`、16 个传递模块、旧 UI 最终授权 owner 和孤立 `llm-agent-loop.ts` 已连同专属测试物理删除；现役执行只保留 `agentic-loop`、canonical tool session 与 shared authority/effect owner |
| 01：VS Code 新任务与恢复路由收敛 | `completed` | `AgentKernelService` 统一决定 fresh/checkpoint 路由；附件只作为 Context；durable checkpoint 与 local validation repair 均通过 typed recovery 输入进入 canonical loop，失败保留待办、成功唯一清除 checkpoint；产品 adapter 不再拥有 `runLegacyPlanned` |
| 01：CLI canonical Kernel 路由 | `completed` | shared 层拥有版本化 request/output、TaskContract 与唯一 `CanonicalCodingKernel`；VS Code/CLI product adapter 只组合 runtime；CLI Surface 不再 import parser、mutation、verification 或 loop，`CliLegacyCodingLoop` 源码与测试均已删除；非 mutation TaskContract 对意外写入 fail closed |
| 01：Headless canonical 产品路由 | `completed` | `@devseek-netai/headless` 提供公开 programmatic entry；只组合 shared `CanonicalCodingKernel` 与 runtime port，不依赖 `vscode`、Surface UI、CLI runtime 或 agent loop；预取消在 runtime dispatch 前失败 |
| 01：Headless 五维证据边界 | `completed` | create、modify、repair、permission-denied、policy-refusal 五类场景均由 Headless 产品输出完整 TaskContract、tool execution、change receipt、verification 与 completion；缺维、身份/契约/终态/evidence/risk 漂移均 fail closed；该结论不替代 VS Code/CLI 产品证据或 qualification |
| canonical 语义 owner | `completed` | Orientation、TaskContract、EngineeringOrientation、CodebaseExploration、ContextGraph、ContextProvenance、InstructionPrecedence、Requirements、ExternalBoundary、SourceGrounding、AcceptanceContract、DesignDecision、ChangePlan、ChangePlanRevision、RunLifecycle、AgentCommand、Settlement、SurfaceAdapterConformance、ProviderNormalization、ToolSchema、ToolDispatch、ToolExecution、Mutation、Verification、Completion、RunEvidenceRetention、MemoryPolicy、Checkpoint、ContextCompaction、ResumeIdempotency 均由 shared 唯一 owner 裁决；Surface 只组合宿主能力；语义域收敛数=30 |
| 01：三 Surface 五维 development projection | `completed` | create、modify、repair、permission-denied、policy-refusal 五类对标场景通过同一 settled projection owner 联合评估；CLI/VS Code 不再复制投影语义，缺证据和未决 mutation fail closed |
| 01：三 Surface 五场景产品契约 | `completed` | 同批真实工作区经 VS Code 精确安装 VSIX、CLI 和 Headless 产品入口完成五类场景；五个维度均有 product-route evidence，repair 保留失败→修复→重验证，两个拒绝场景零 mutation；该结论不产生 qualification claim |
| C1：运行生命周期 | `completed` | shared `RunLifecyclePort` 唯一裁决 accepted/running/waiting/terminal 转换；VS Code、CLI、Headless 保留同一不可变生命周期，blocked/cancelled 不再被 Surface 降格为 failed |
| C1：命令、结算与 Surface 适配 | `completed` | shared `AgentCommandPort` 统一 chat/steer/cancel/resume/confirmation 五类版本化命令，`SettlementDecisionPort` 统一终态裁决，`SurfaceAdapterConformancePort` 机器检查三 Surface 命令和交付投影；Surface 不再重算状态或完成语义 |
| C2：任务定向 | `completed` | shared `OrientationDecisionPort` 唯一裁决 explain/review/change/release、mutation 与 external-effect 事实；安全拒绝优先于提示词 hint，TaskContract 与 Kernel 对不一致 mode fail closed，VS Code 只投影 canonical decision |
| C2：任务契约 | `completed` | shared `TaskContractPort` 唯一负责规范化、校验、不可变快照与产品投影；Kernel 在接受运行前绑定用户原文和 orientation，三 Surface 复用同一 resolver，非法结构、版本、mode 和来源均 fail closed |
| C4：需求、外部来源与验收契约 | `completed` | shared `RequirementDecisionPort`、`ExternalBoundaryPort`、`SourceGroundingPort` 与 `AcceptanceContractPort` 将目标、约束、非目标、假设、冲突、外部边界和 deliverable-bound oracle 形成不可变 revision；来源精确绑定 boundary、locator、内容摘要及 tool/effect evidence，主观或缺来源验收在实现前 fail closed |
| C5：设计决策与 change plan | `completed` | shared `DesignDecisionPort`、`ChangePlanPort` 与 `ChangePlanRevisionPort` 唯一生成备选方案、trade-off、影响集、migration/deletion/rollback、acceptance mapping 和修订 lineage；工具提议目标必须先形成证据绑定的 design/plan revision，低层 authority 再依当前计划拒绝越界 target/effect |
| C12：运行证据保留 | `completed` | shared `RunEvidenceRetentionPort` 将生命周期投影到 append-only owner ledger；CLI 与 Headless owner 负责封存，VS Code 仅持 participant authority；三 Surface 均保留精确终态且 qualification effect=`NONE` |
| C12：记忆策略 | `completed` | shared `MemoryPolicyPort` 唯一裁决来源、权限、审批、敏感内容、TTL、作用域与上下文预算；Kernel 封存决策摘要，VS Code 提示词只投影该次决策，legacy markdown 与 external instruction 均不能自动提权或注入 |
| C11：durable checkpoint | `completed` | shared `CheckpointPort` 封存 run、Surface、workspace、TaskContract、ContextGraph、MemoryPolicy、完成前缀和剩余单元；VS Code 与 Headless 恢复只执行 pending 单元，篡改、工作区漂移和任务替换 fail closed |
| C12：上下文压缩 | `completed` | shared `ContextCompactionPort` 密封 TaskContract、ContextGraph provenance、MemoryPolicy、完成前缀、待办、证据引用、敏感信息清理和重验证要求；VS Code 活跃 agentic 路径仅负责收据投影与传输裁剪，多次压缩保持父收据与 checkpoint 连续性 |
| C11：恢复幂等 | `completed` | shared `ResumeIdempotencyPort`、不可变 operation journal 与三 Surface 产品组合已接线；checkpoint 封存 `effectClass` 与 exact `operationSha256`，workspace/external effect 在 VS Code、CLI 适用路径跨进程恢复时通过当前状态证明 committed、对不确定外部状态 fail closed，并且不重复调用宿主 |
| I10 用户仿真增量 | `completed` | 固定 5 例只作回归；I10 新增 5 例均直接消费版本化 fixture `scripts/test/fixtures/user-simulations/i10-memory-checkpoint.json`；治理门禁拒绝重复 case ID、重复用户场景、重复测试证据和未绑定 test name；原始 TAP、fixture SHA、精确 VSIX 与三 Surface 产品报告仅在本地 `code/devseek-tests/memory-checkpoint/runs/i10-local-20260806-g379efbd/` 保留，不进入 Git |
| I11 用户仿真增量 | `completed` | 新增 4 例覆盖三次连续压缩、VS Code 密封收据、已完成 workspace effect 二次恢复跳过和 indeterminate external effect 运行前阻断；版本化输入位于 `scripts/test/fixtures/user-simulations/i11-context-resume.json`，逐例 TAP 与汇总仅在本地 `code/devseek-tests/context-resume/runs/i11-context-resume-20260806/` 保留，qualification effect=`NONE` |
| I12 用户仿真增量 | `completed` | 新增 6 例：只读任务拒绝 Surface 越权写入、Surface 字段和非当前 session receipt 均不能伪造最终 authority、已批准输入不能被替换、已确认远程变更在对账后仅执行一次、真实 external-effect receipt 驱动二次 resume 零宿主调用、completed resume receipt 不能为替换后的输入授权；版本化输入位于 `scripts/test/fixtures/user-simulations/i12-effect-authority.json`，fixture SHA256=`52c84a7b111b289745fab2aaedb950bdf90f3e51876c9de98e16b7f2768aeb85`，原始回执只保留在本地 `code/devseek-tests/effect-authority/runs/i12-session-authority-final-20260807/`，不进入 Git |
| I13 用户仿真增量 | `completed` | 新增 6 例覆盖 Provider 缓冲事后篡改隔离、Schema 别名与 internal tool 隐藏、fake/native 调用等价、缺失字段与部分端口接线 fail closed、VS Code 工作区内外绝对路径风险分类、CLI 受保护 `.env.local` 路径投影、未分类 Ruby 维护命令保守拒绝；版本化输入位于 `scripts/test/fixtures/user-simulations/i13-provider-dispatch.json`，fixture SHA256=`fe768ac5019a0e6bdc97604f69175f2f60dea8c2ad1af62887cbe6aff8736e65`，原始回执只保留在本地 `code/devseek-tests/provider-dispatch/runs/i13-provider-dispatch-workspace-boundary-20260807/`，qualification effect=`NONE`，不进入 Git |
| I14 用户仿真增量 | `completed` | 新增 5 例覆盖工具身份跨重启稳定且同轮重复可区分、VS Code/CLI 已落盘 mutation 重启后只对账不重写、process-local 外部对账拒绝重复派发，以及 `.devseek` symlink 不能把证据写出工作区；版本化输入位于 `scripts/test/fixtures/user-simulations/i14-effect-restart.json`，fixture SHA256=`cebf436847b99f44ff907519c5169714cd717b441c4e05bbae95ad4b3a58a511`，原始回执只保留在本地 `code/devseek-tests/effect-restart/runs/i14-effect-restart-20260807/`，qualification effect=`NONE`，不进入 Git |
| I15 用户仿真增量 | `completed` | 新增 5 例覆盖非目标不变成功能交付物、外部来源与 boundary/tool/effect 精确绑定、主观 oracle 阻止完成、设计影响/回退/验收映射及计划外 effect 拒绝、基于新证据的 requirement revision lineage；版本化输入位于 `scripts/test/fixtures/user-simulations/i15-requirements-plan.json`，fixture SHA256=`98406978c4ef725b858b33dfe8cbd51dbe64716d46c7b5f8b0bdd15b3ba120da`，原始回执只保留在本地 `code/devseek-tests/requirements-plan/runs/i15-requirements-plan-20260807/`，qualification effect=`NONE`，不进入 Git |
| I16 用户仿真增量 | `completed` | 新增 4 例覆盖自然多文件目标发现与副作用前 plan revision、显式严格文件范围、workspace 逃逸拒绝和 glob 范围；版本化输入位于 `scripts/test/fixtures/user-simulations/i16-plan-revision.json`，fixture SHA256=`110fc55ae2213dcde591b1a28ccdb5fff69cd4e6ef56a0736e1725baa3709367`，原始回执只保留在本地 `code/devseek-tests/plan-revision/runs/i16-plan-revision-20260807/`，qualification effect=`NONE`，不进入 Git |
| Intent Semantic Contract 产品纵切 | `completed` | `TaskSemanticContract/v3` 统一任务形态、作用域、mutation/read、验证、质量义务、`done_iff`、歧义、跨轮修订与项目指令；session、Kernel、canonical agentic/tool loop 与受约束 artifact flow 只消费该契约；48 条外部形式自然输入覆盖 12 类任务。非 Web Provider candidate 与隔离 semantic channel 仍属后续责任 |
| 语义执行职责重构 | `completed` | Agentic 系统提示词、双阶段分析提示词、项目指令绑定、跨轮路由和 Agent Surface 展示均有独立 owner；Headless Kernel 不依赖 `vscode`；三项大型入口上限仅在职责、依赖和测试迁移后下调 |
| R4 非资格本地工作 | `completed` | v2 清单冻结 `4f8a567`；原 `a034e5e` v1 JSON/schema/view 按字节归档；冻结时 artifact/install/runtime 精确一致，stable runtime=1；6/6 leaf completed、blocked=0、qualification effect=`NONE` |
| 能力账本 | `in_progress` | 76 项能力：共 37 项 `wired`、39 项 `proposed`；其中 C1～C14 为 30/69 项 `wired`、39 项 `proposed`，qualification claims=0 |
| Gate 0 / 后续资格 | `blocked_external` | Gate 0=`NOT_PASSED`，6 个外部 authority blocker，exact claims=0；本地工作不得自行提升资格 |
| 顶级编程智能体综合验收 | `pending` | 尚未完成 Codex / Claude Code 同类行为对标下的 C1～C14 产品接线、黄金用户旅程、长任务与受保护资格验收 |
| 01、10～15、17～20 文档治理结果 | `completed` | 对应限定责任或历史交接责任完成后，完整文档已归档，根目录无同名尾页 |
| 02～09、16 文档收口 | `pending` | 对应产品、验证或规范责任完成后整份归档 |

## 当前任务

| 顺序 | 任务 ID | 状态 | 依赖 | 完成条件 |
| ---: | --- | --- | --- | --- |
| 1 | `QUALITY-TS-01` | `completed` | 无 | VS Code extension `tsc --noEmit` 零错误；每个错误在正确语义 owner 修复；同类路径有回归测试 |
| 2 | `KERNEL-PREP-01` | `completed` | `QUALITY-TS-01` | 在不切换产品路径的前提下，按职责抽取 CLI/VS Code legacy owner，固定端口与 conformance 基线；不得新增业务内核或终态 owner |
| 3 | `KERNEL-BASELINE-02` | `completed` | `KERNEL-PREP-01` | development route adapter 只投影 settled output；CLI/VS Code 当前缺失维度可机器复现，Headless 缺失显式失败；不得补造产品或资格证据 |
| 4 | `INTENT-CONTRACT-02` | `completed` | 16 号 Priority-0 产品侧非资格切片 | 统一本地 intent contract、destructive policy、execution-mode policy 和 Provider candidate governor；删除 classifier/router/chat-controller 的重复词表或合并权威；全量 extension、自然输入、静态 owner 守卫和本地用户闭环通过 |
| 5 | `TASK-SEMANTIC-CONTRACT-03` | `completed` | `INTENT-CONTRACT-02` | v3 契约覆盖跨轮、项目指令、mutation/read、义务与 `done_iff`；Kernel、双 loop 和 fast path 接线；159/159 extension、48/48 自然输入、3/3 续作路由与用户界面仿真通过 |
| 6 | `R4-CANDIDATE-DECISION-01` | `completed` | 显式候选选择授权 | `R4-RELEASE-CANDIDATE-MANIFEST/v2` 冻结 `4f8a567`；v1 `a034e5e` 历史候选字节不变；clean-runtime 与 6/6 rollup 完成且未产生资格声明 |
| 7 | `DOC01-KERNEL-ROUTE-01` | `completed` | `TASK-SEMANTIC-CONTRACT-03` | VS Code fresh task 不因附件形态切换执行器；route authority、legacy reason 白名单、Context 投影、Kernel 结算和同类入口静态守卫通过 |
| 8 | `DOC01-KERNEL-CHECKPOINT-02A` | `completed` | `DOC01-KERNEL-ROUTE-01` | typed recovery 只投影未完成任务与受限主机上下文；失败/异常保持 paused，成功只清除一次 durable checkpoint |
| 9 | `DOC01-KERNEL-REPAIR-02B` | `completed` | `DOC01-KERNEL-CHECKPOINT-02A` | local validation repair 通过 canonical Kernel 执行，保留失败命令、轮次、工作区路径约束和统一验证/完成语义 |
| 10 | `DOC01-KERNEL-OWNER-02C` | `completed` | `DOC01-KERNEL-REPAIR-02B` | VS Code 产品 adapter 只组合 `runAgenticLoop`；`runLegacyPlanned`、重复 planned callbacks 与对应旁路静态断言归零 |
| 11 | `KERNEL-02` | `completed` | `KERNEL-PREP-01`、`KERNEL-BASELINE-02`、`DOC01-KERNEL-OWNER-02C` | VS Code、CLI、Headless 共用唯一 Coding Kernel、TaskContract、ToolExecutor、mutation/verification/completion 语义；legacy loop 不再拥有业务决策；本地产品收敛不依赖 Gate 0 资格状态 |
| 12 | `DOC01-KERNEL-CONTRACT-03A` | `completed` | `DOC01-KERNEL-OWNER-02C` | shared 层固定版本化 canonical request/output、TaskContract、terminal status 与 runtime port；非法 route/version、启动前取消、缺失输出均 fail closed，TaskContract 对 runtime 不可变 |
| 13 | `DOC01-KERNEL-CLI-03B` | `completed` | `DOC01-KERNEL-CONTRACT-03A` | VS Code 与 CLI product adapter 均实例化 shared `CanonicalCodingKernel`；CLI Surface 只调用 product executor，原 mutation/verification/repair 行为由 runtime adapter 承接 |
| 14 | `DOC01-KERNEL-GUARD-03C` | `completed` | `DOC01-KERNEL-CLI-03B` | 删除 `CliLegacyCodingLoop` 源码与测试；v4 机器基线裁决 CLI canonical route=1、legacy execution owner=0、cross-Surface Kernel route=3，并阻止 Surface 直连 runtime 或 mutation/verification owner |
| 15 | `DOC01-KERNEL-HEADLESS-04A` | `completed` | `DOC01-KERNEL-GUARD-03C` | 建立唯一 Headless product entry；消费 shared request/output 与 TaskContract；无 VS Code/UI/CLI runtime 依赖，inventory 与静态旁路守卫通过 |
| 16 | `DOC01-KERNEL-HEADLESS-EVIDENCE-04B` | `completed` | `DOC01-KERNEL-HEADLESS-04A` | Headless 产品输出五维 settled evidence；五类对标场景结构完整，缺维和 request/output 绑定漂移 fail closed；qualification effect 保持 `NONE` |
| 17 | `DOC01-KERNEL-TASK-CONTRACT-04C` | `completed` | `DOC01-KERNEL-HEADLESS-EVIDENCE-04B` | 三 Surface 共用 shared canonical TaskContract builder/projection；Surface 重定义与本地投影受静态守卫阻断；v6 基线裁决该语义域 owner=1、missing Surface=0 |
| 18 | `DOC01-KERNEL-TOOL-05A` | `completed` | `KERNEL-02` | shared action/authority/receipt、三 Surface adapter、幂等 replay 与拒绝零副作用守卫通过 |
| 19 | `DOC01-KERNEL-MUTATION-05B` | `completed` | `DOC01-KERNEL-TOOL-05A` | text、batch、directory mutation 统一 baseline/readback/rollback/identity 事务；旧提交、回滚和目录直写 owner 删除 |
| 20 | `DOC01-KERNEL-VERIFICATION-05C` | `completed` | `DOC01-KERNEL-MUTATION-05B` | 验证回执绑定 acceptance；失败、unverified、repair 后 supersede 与工具回执归属由 shared owner 裁决 |
| 21 | `DOC01-KERNEL-COMPLETION-05D` | `completed` | `DOC01-KERNEL-VERIFICATION-05C` | 完成判定统一消费工具、mutation、verification、直接验收与风险；拒绝、缺证据、人工复核和恢复后的终态 fail closed |
| 22 | `SURFACE-CONTRACT-01` | `completed` | `KERNEL-02` | 同一批真实工作区经 VS Code、CLI、Headless 产品入口完成五类场景；TaskContract、工具、变更、验证和完成结果联合等价，拒绝零副作用，repair 证据链完整 |
| 23 | `CAP-C1-C14-WIRING` | `in_progress` | `SURFACE-CONTRACT-01` | C1～C14 当前 30 项 `wired`、39 项 `proposed`；按 capability DAG 逐项提升，每项均有 owner、产品入口、失败恢复和机器证据 |
| 24 | `USER-SIM-01` | `in_progress` | 每个产品切片 | 五个固定 fixture 仅作为永久回归基线；I10～I15 共 31 例已分别持久化输入、唯一测试证据和本地原始运行回执；后续每轮继续在 `code/devseek-tests/<scenario>` 新增或扩展样本，real Provider、自然 UI 与 sealed holdout 仍待相应前置 |
| 25 | `QUAL-EXT-01` | `blocked_external` | 独立授权、受保护身份/设施、holdout 和不可变保留 | 6 个外部 blocker 由授权主体关闭，7 个 C0 exact tuple claims 可复算，机器 decision 自主达到 `PASS`；只约束资格晋级，不阻塞本地产品迭代 |
| 26 | `TOP-AGENT-ACCEPTANCE-01` | `pending` | `CAP-C1-C14-WIRING`、`USER-SIM-01` | 按 01～09 的需求与黄金旅程，对照 Codex 和 Claude Code 在同类问题上的可观察行为；所有适用产品能力、长任务、故障恢复、结果验证和跨 Surface 验收通过 |

## 剩余任务分类与合批策略

69 项 C1～C14 能力中已有 30 项 `wired`、39 项 `proposed`；逐项 ID、owner、依赖和机器状态以 `docs/process/devseek-capability-ledger.json` 为唯一明细源，本表只做可执行分类，不建立第二份状态账本。

| 类别 | 覆盖的剩余任务 | 执行方式 | 联合验收 | 归档影响 |
| --- | --- | --- | --- | --- |
| A. shared 语义内核（已完成） | `DOC01-KERNEL-TOOL-05A`、`MUTATION-05B`、`VERIFICATION-05C`、`COMPLETION-05D` | 后续只做回归防护和被新能力复用，不新增 Surface 旁路 | 权限在 effect 前、拒绝无副作用、mutation baseline/readback/rollback、acceptance 绑定、唯一完成裁决 | 与 B 一起完成 01 的限定责任；01 已整份归档 |
| B. 跨 Surface 产品契约（已完成） | `SURFACE-CONTRACT-01`、VS Code/CLI 五维 product projection、Headless 等价回放 | 后续作为每个能力切片的共享产品验收边界 | create/modify/repair/permission-denied/policy-refusal 在同一 fixture 上的 TaskContract、tool、mutation、verification、completion 等价 | 与 A 一起完成 01 的限定责任；01 已整份归档 |
| C. 基础能力波次（已完成） | C1/C2/C3、C11 checkpoint/resume idempotency 与 C12 三项均已 `wired` | 作为共享基础和永久回归门；后续长任务增量归入 G，不再复制恢复 owner | 断线重放、checkpoint、重复 resume、跨重启 effect 对账、上下文预算、多次压缩和证据保留 | 推进 03、04、08、16，不因基础 capability wired 提前归档 |
| D. 契约与规划波次（已完成） | C4 requirements/external-boundary/source-grounding/acceptance、C5 design/change-plan 六项均已 `wired` | shared owner 消费 TaskContract v2 与 ContextGraph v2；旧 VS Code requirement owner 已删除；计划目标/effect 成为工具 authority 的强制输入 | I15 覆盖否定、非目标、来源精确绑定、弱 oracle、revision、影响/回退与计划外 effect 拒绝 | 推进 02、03、04、07、16；动态来源获取和运行中重规划归入后续产品循环，不冒充本批资格 |
| E. 执行与安全波次 | C6 provider normalization/tool schema/tool dispatch/tool execution 与 C7 permission/sandbox/workspace/external 已 `wired`；剩余 C6 capability/connector/visual、C7 secrets/dirty-tree/platform 与 C8 implementation/integration | 复用 A/B 的唯一执行链和 durable effect journal；terminal/network/MCP/Git/release 按 effect facet 分类，不建平行旁路 | 能力协商、secret redaction、dirty tree、平台差异、schema 拒绝、明示审批和补偿 | 推进 02～04、07、08、16 |
| F. 验证与交付波次 | C9 verification/repair/review、C10 Git/CI/release | 可共享 verifier/review evidence；真实外部发布单独受权限约束 | 失败→诊断→修复→重验证，independent review，dirty tree/release/rollback | 推进 01～05、08、09、16 |
| G. 长任务与扩展波次 | C11 steering/collaboration、C13 skills/hooks/MCP/subagents/headless | 共用 typed command/event/registry；并行写冲突和子代理隔离分开压测 | steer/resume/cancel 幂等、扩展旁路=0、并行冲突=0、长任务恢复 | 推进 03～05、08、09、16 |
| H. 用户仿真与资格 | `USER-SIM-01`、C14、`QUAL-EXT-01`、`TOP-AGENT-ACCEPTANCE-01` | 每个产品切片先跑本地用户路径；real Provider/holdout/受保护签署只在外部前置满足后独立执行 | 精确 VSIX、多轮、故障恢复、正式项目 holdout、不可变候选与机器 Gate | 最终判定 02～09、16 是否能整份归档；外部 blocker 不得伪装成本地实现失败 |

### 当前合批顺序

| 批次 | 状态 | 内容 | 暂停点 |
| --- | --- | --- | --- |
| Batch K1 | `completed` | shared Tool action/authority/receipt + VS Code/CLI/Headless adapter + 幂等/无副作用守卫 | 三 Surface 不再自定义 tool terminal receipt |
| Batch K2 | `completed` | mutation baseline/readback/rollback receipt + verification acceptance/result + completion decision | 五个核心语义域 owner=1，missing Surface=0 |
| Batch S1 | `completed` | 五类 fixture 的 development 与真实产品路径 projection 均完成三 Surface 五维联合判定 | 01 限定责任完成并整份归档 |
| Batch C1 | `completed` | `RunLifecyclePort`、`AgentCommandPort`、`SettlementDecisionPort`、`SurfaceAdapterConformancePort` 与 `RunEvidenceRetentionPort` 已完成三 Surface 接线 | C1 4/4 wired；命令、状态、终态与交付投影均有唯一 shared owner |
| Batch C2 | `completed` | `OrientationDecisionPort` 与 `TaskContractPort` 已完成；三 Surface 共用定向、契约校验和不可变产品投影 | C2 2/2 wired；请求原文、mode、effect 和契约来源绑定可复算 |
| Batch C3-A | `completed` | 工程定向、代码库探索和不可变上下文图已由 shared Kernel 统一生成并接到三 Surface；旧聚合入口已删除 | C3 首组三项 wired；敏感内容先排除，缺失文件不伪装为存在 |
| Batch C3-B | `completed` | 上下文来源与指令优先级已由 shared owner 裁决；用户请求高于工作区指令，Codex/Claude 分层文件、冲突赢家和内容哈希均进入上下文图 | C3 5/5 wired；Surface 不能伪造 user/runtime authority，来源记录不保留正文 |
| Batch C4/C5 | `completed` | 需求、外部边界、来源、验收、设计和 change plan 六项 capability 由 shared Kernel 生成并进入三 Surface；删除 VS Code 平行需求契约，工具目标先经 shared plan-revision owner 再由 authority 执行 | I15/I16 九条独立用户旅程通过；C4/C5 6/6 wired、claims=0；v25 机器基线 122/122 |
| Batch C11/C12-A | `completed` | `C12-MEMORY-POLICY` 与 `C11-CHECKPOINT` 已由 shared owner 收口并接入产品路径；I10 五个增量用户案例通过 | 外部内容不提权；恢复只执行 pending 单元；固定五场景不冒充本轮增量证据 |
| Batch C11/C12-B | `completed` | `C12-CONTEXT-COMPACTION` 已接入 VS Code 活跃路径；`C11-RESUME-IDEMPOTENCY` 先完成 shared/Kernel/Headless 实现，并由后续 durable effect 批次补齐产品接线 | I11 四条独立用户旅程及原始回执通过；压缩连续性、敏感信息清理、重复 effect 跳过与不确定 effect 阻断均有确定性证据 |
| Batch C6/C7-C11 | `completed` | tool identity、workspace/external preparation/settlement 和 replay 由 shared owner 持久化；三 Surface 产品组合根注入 filesystem journal，VS Code sibling mutation 使用唯一产品 transaction owner，工具循环不存在隐式内存 fallback | I14 五条增量路径通过；跨重启已落盘 effect 零重复宿主调用，未知外部状态 fail closed，metadata symlink 越界被拒绝；该批结果由后续 v25 基线持续守卫 |

## 伴随治理结果

| 结果 ID | 状态 | 触发条件 | 完成条件 |
| --- | --- | --- | --- |
| `DOC-ARCHIVE-01` | `in_progress` | 对应产品能力、验证或历史交接责任已真实完成 | 将对应 01～20 文档整份移入 `archive/`；根目录无同名副本、跳转页或断链 |

## 当前作业卡

`CAP-C1-C14-WIRING`（`in_progress`，前置 `SURFACE-CONTRACT-01` 已完成）

- 当前条件：三 Surface 已共用 canonical Kernel、30 个收敛语义域、同一产品契约与 durable operation journal；能力账本当前为 37 项 `wired`、39 项 `proposed`、claims=0，C4/C5 契约、规划与执行前目标修订、C6 tool execution、C7 workspace/external 与 C11 resume 均已完成全入口接线。
- 接下来需要：优先合批推进 C8/C9/C10 实施、验证、审查与交付，使 change plan、acceptance 和 completion 形成真实反馈闭环；并行盘点 C6 连接器能力协商、C7 secrets/dirty-tree/platform、C11 协作长任务、C13 扩展和本地 C14 前置。实时外部来源获取、clarification/steer、外部新证据驱动的 requirement/design revision 与可审阅计划状态必须扩展现有 C4/C5 revision owner，不得恢复平行路径。
- 当前验收：每项能力必须在所有适用 Surface 可达，不能绕过 Kernel、authority、mutation、verification 或 completion owner；成功、拒绝、失败、恢复和取消路径均有可复算证据。
- 本地迭代估算：C4/C5 与 C7-C11 durable effect 批次已完成；其余 39 项 `proposed` 可按“实现验证交付”“连接器与平台安全”“长任务与扩展”三大批继续合并审计，但不能在未读取实际可达性前承诺固定轮次。real Provider、外部 authority 与 sealed holdout 仍不属于本地实现完成计数。
- 文档收敛：01 已整份移入 `archive/` 且根目录无副本；02～09、16 继续承担对标、目标架构、能力、资格和工程准则责任，不按局部卡完成提前归档。
- 资格边界：Gate 0=`NOT_PASSED`、6 个外部 blocker 和 claims=0 保持不变；它们只阻止 qualification promotion。已授权的 headed DeepSeek 路径仍须等待外部前置满足。

## 机器状态源

| 状态 | 唯一机器源 |
| --- | --- |
| active requirement / architecture / process | `docs/process/devseek-active-baseline-selector.json` |
| 能力数、implementation state、claims | `docs/process/devseek-capability-ledger.json` |
| Gate 0、repository/external blockers | `docs/process/devseek-gate0-decision-report.json` |
| Surface 入口覆盖 | `docs/process/devseek-surface-entry-inventory.json` |
| Kernel owner、产品路由与跨 Surface 缺口 | `docs/process/devseek-kernel-prep-owner-baseline.json` |
| R4 leaf 状态 | `docs/process/devseek-r4-iteration-status-rollup.json` |
| 外部授权准备度 | `docs/process/devseek-external-authority-readiness-audit.json` |
| 设计优先的架构护栏 | `docs/process/devseek-architecture-budgets.json` |
| 固定回归与每轮增量用户案例 | `docs/process/devseek-iteration-user-journeys.json` |
| 持久化仿真输入与原始运行回执 | `code/devseek-tests/<scenario>/` |
| 文档治理与归档覆盖 | `docs/process/devseek-legacy-doc-inventory.json` |
