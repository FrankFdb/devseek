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
- 当前结论：顶级编程智能体目标尚未达成；C0 本地实现闭环、Intent Semantic Contract v3，以及 VS Code 新任务/恢复和 CLI fresh task 的 shared canonical Kernel 路由已完成，但 Headless 产品入口、五个跨 Surface 语义域、完整 conformance 输出、C1～C14 产品接线、完整用户仿真和受保护资格仍未完成。
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
| Extension 类型与候选包基线 | `completed` | TypeScript 基线零错误；162/162 extension 套件、架构守卫、48/48 自然输入、8 步 Webview 人工输入与精确 VSIX T3 Surface 仿真通过；T3 继续作为发版门禁 |
| Surface 入口盘点 | `completed` | 87/87 入口受 inventory 覆盖，未知入口与未声明 legacy owner 可达性均为 0 |
| Kernel owner 收敛基线 | `completed` | v4 将本地产品迭代与资格晋级解耦；3 条活跃路由均通过 shared `CanonicalCodingKernel`，其中 fresh-task canonical route=2、canonical recovery route=1、legacy recovery route=0；legacy execution owner=0、跨 Surface Kernel route=3、5 个核心语义域收敛数=0、Headless 产品入口=0；42/42 源码与默认门禁断言通过 |
| 01：VS Code 新任务与恢复路由收敛 | `completed` | `AgentKernelService` 统一决定 fresh/checkpoint 路由；附件只作为 Context；durable checkpoint 与 local validation repair 均通过 typed recovery 输入进入 canonical loop，失败保留待办、成功唯一清除 checkpoint；产品 adapter 不再拥有 `runLegacyPlanned` |
| 01：CLI canonical Kernel 路由 | `completed` | shared 层拥有版本化 request/output、TaskContract 与唯一 `CanonicalCodingKernel`；VS Code/CLI product adapter 只组合 runtime；CLI Surface 不再 import parser、mutation、verification 或 loop，`CliLegacyCodingLoop` 源码与测试均已删除；非 mutation TaskContract 对意外写入 fail closed |
| Intent Semantic Contract 产品纵切 | `completed` | `TaskSemanticContract/v3` 统一任务形态、作用域、mutation/read、验证、质量义务、`done_iff`、歧义、跨轮修订与项目指令；session、Kernel、双 loop、deterministic/fast path 只消费该契约；48 条外部形式自然输入覆盖 12 类任务。非 Web candidate 与隔离 semantic channel、跨 Surface 同核仍属后续责任 |
| 语义执行职责重构 | `completed` | Agentic 系统提示词、双阶段分析提示词、项目指令绑定、跨轮路由和 Agent Surface 展示均有独立 owner；Headless Kernel 不依赖 `vscode`；三项大型入口上限仅在职责、依赖和测试迁移后下调 |
| R4 非资格本地工作 | `completed` | v2 清单冻结 `4f8a567`；原 `a034e5e` v1 JSON/schema/view 按字节归档；当前候选 artifact/install/runtime 精确一致，stable runtime=1；6/6 leaf completed、blocked=0、qualification effect=`NONE` |
| 能力账本 | `in_progress` | 76 项能力：C0 的 7 项为 `wired`，C1～C14 共 69 项为 `proposed`，qualification claims=0 |
| Gate 0 / 后续资格 | `blocked_external` | Gate 0=`NOT_PASSED`，6 个外部 authority blocker，exact claims=0；本地工作不得自行提升资格 |
| 顶级编程智能体综合验收 | `pending` | 尚未完成 Codex / Claude Code 同类行为对标下的黄金用户旅程、长任务、恢复与跨 Surface 等价性验收 |
| 10～15、17～20 文档治理结果 | `completed` | 对应限定责任或历史交接责任完成后，完整文档已归档，根目录无同名尾页 |
| 01～09、16 文档收口 | `pending` | 对应产品、验证或规范责任完成后整份归档 |

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
| 11 | `KERNEL-02` | `in_progress` | `KERNEL-PREP-01`、`KERNEL-BASELINE-02`、`DOC01-KERNEL-OWNER-02C` | VS Code、CLI、Headless 共用唯一 Coding Kernel、TaskContract、ToolExecutor、mutation/verification/completion 语义；legacy loop 不再拥有业务决策；本地产品收敛不依赖 Gate 0 资格状态 |
| 12 | `DOC01-KERNEL-CONTRACT-03A` | `completed` | `DOC01-KERNEL-OWNER-02C` | shared 层固定版本化 canonical request/output、TaskContract、terminal status 与 runtime port；非法 route/version、启动前取消、缺失输出均 fail closed，TaskContract 对 runtime 不可变 |
| 13 | `DOC01-KERNEL-CLI-03B` | `completed` | `DOC01-KERNEL-CONTRACT-03A` | VS Code 与 CLI product adapter 均实例化 shared `CanonicalCodingKernel`；CLI Surface 只调用 product executor，原 mutation/verification/repair 行为由 runtime adapter 承接 |
| 14 | `DOC01-KERNEL-GUARD-03C` | `completed` | `DOC01-KERNEL-CLI-03B` | 删除 `CliLegacyCodingLoop` 源码与测试；v4 机器基线裁决 CLI canonical route=1、legacy execution owner=0、cross-Surface Kernel route=3，并阻止 Surface 直连 runtime 或 mutation/verification owner |
| 15 | `SURFACE-CONTRACT-01` | `pending` | `KERNEL-02` | 同一任务在 VS Code、CLI、Headless 产生等价的状态、工具、验证和完成结果；静态守卫防止新旁路 |
| 16 | `CAP-C1-C14-WIRING` | `pending` | `SURFACE-CONTRACT-01` | 按 capability DAG 将 C1～C14 的 69 项能力从 `proposed` 逐项提升到可证的 `implemented/wired`；每项均有 owner、产品入口、失败恢复和机器证据 |
| 17 | `USER-SIM-01` | `in_progress` | 每个产品切片 | 以用户方式覆盖安装包、真实入口、多轮任务、失败恢复和结果核验；当前自然输入、Webview/Kernel 恢复仿真及精确 VSIX 单轮写入/读回/QualityGate 已通过，真实安装包多轮恢复和 real Provider 仍待相应前置 |
| 18 | `QUAL-EXT-01` | `blocked_external` | 独立授权、受保护身份/设施、holdout 和不可变保留 | 6 个外部 blocker 由授权主体关闭，7 个 C0 exact tuple claims 可复算，机器 decision 自主达到 `PASS`；只约束资格晋级，不阻塞本地产品迭代 |
| 19 | `TOP-AGENT-ACCEPTANCE-01` | `pending` | `CAP-C1-C14-WIRING`、`USER-SIM-01` | 按 01～09 的需求与黄金旅程，对照 Codex 和 Claude Code 在同类问题上的可观察行为；所有适用产品能力、长任务、故障恢复、结果验证和跨 Surface 验收通过 |

## 伴随治理结果

| 结果 ID | 状态 | 触发条件 | 完成条件 |
| --- | --- | --- | --- |
| `DOC-ARCHIVE-01` | `in_progress` | 对应产品能力、验证或历史交接责任已真实完成 | 将对应 01～20 文档整份移入 `archive/`；根目录无同名副本、跳转页或断链 |

## 当前作业卡

`DOC01-KERNEL-HEADLESS-04`（`in_progress`，父任务 `KERNEL-02`）

- 当前条件：VS Code fresh task、checkpoint resume、local validation repair 与 CLI fresh task 均进入 shared `CanonicalCodingKernel`；CLI legacy execution owner=0，Surface 不再直连 parser/mutation/verification/runtime。Headless 产品入口仍缺失，五个语义域仍未完全收敛。
- 接下来需要：建立 Headless product adapter，并让其消费同一版本化 request/output 与 TaskContract；不得把 test-only `AgentKernelService.startRun` 误报为 Headless 产品入口。
- 后续任务：把 VS Code/CLI 当前不完整的 conformance 输出收敛到共享 ToolExecutor、mutation receipt/readback、verification acceptance 与 completion evidence；完成 create/modify/repair/permission-denied/policy-refusal 三 Surface 等价性。
- 当前验收：Headless 产品入口=1、shared canonical route 覆盖 VS Code/CLI/Headless；Headless 不 import `vscode` 或 Surface UI；五类 conformance 先达到结构完整，再进行真实 workspace 结果等价验收。
- 归档判断：01 的 VS Code 路由、恢复与 CLI 子责任已完成，但 Headless 和五个语义域仍未完成，因此 01 整份文档继续留在根目录；不得创建归档副本或尾页。
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
| 文档治理与归档覆盖 | `docs/process/devseek-legacy-doc-inventory.json` |
