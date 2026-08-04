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
- 当前结论：顶级编程智能体目标尚未达成；C0 本地实现闭环和 Intent Semantic Contract v3 产品纵切已完成，但隔离 semantic channel、单一 Coding Kernel、C1～C14 产品接线、完整用户仿真和受保护资格仍未完成。
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
| Extension 类型与候选包基线 | `completed` | TypeScript 基线零错误；159/159 extension 套件、架构守卫、48/48 自然输入与 Webview 人工输入仿真通过；精确 VSIX T3 Surface 仿真继续作为发版门禁 |
| Surface 入口盘点 | `completed` | 87/87 入口受 inventory 覆盖，未知入口与未声明 legacy owner 可达性均为 0 |
| Kernel 切换前 owner baseline | `completed` | 3 条活跃产品路由均仍由 legacy semantic owner 执行；5 个核心语义域收敛数为 0；Headless 产品入口为 0；34/34 源码与默认门禁断言受保护；跨 Surface conformance 契约、5 个 development fixture 和 CLI/VS Code route-output probe 已准备，但产品 adapter 数仍为 0 |
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
| 7 | `QUAL-EXT-01` | `blocked_external` | 独立授权、受保护身份/设施、holdout 和不可变保留 | 6 个外部 blocker 由授权主体关闭，7 个 C0 exact tuple claims 可复算，机器 decision 自主达到 `PASS` |
| 8 | `KERNEL-02` | `blocked_external` | `KERNEL-PREP-01`、`KERNEL-BASELINE-02`、Gate 0=`PASS` | VS Code、CLI、Headless 共用唯一 Coding Kernel、TaskContract、ToolExecutor、mutation/verification/completion 语义；legacy loop 不再拥有业务决策 |
| 9 | `SURFACE-CONTRACT-01` | `pending` | `KERNEL-02` | 同一任务在 VS Code、CLI、Headless 产生等价的状态、工具、验证和完成结果；静态守卫防止新旁路 |
| 10 | `CAP-C1-C14-WIRING` | `pending` | `SURFACE-CONTRACT-01` | 按 capability DAG 将 C1～C14 的 69 项能力从 `proposed` 逐项提升到可证的 `implemented/wired`；每项均有 owner、产品入口、失败恢复和机器证据 |
| 11 | `USER-SIM-01` | `in_progress` | 每个产品切片 | 以用户方式覆盖安装包、真实入口、多轮任务、失败恢复和结果核验；当前自然输入与 Webview/Kernel 仿真已通过，真实安装包多轮恢复和 real Provider 仍待相应前置 |
| 12 | `TOP-AGENT-ACCEPTANCE-01` | `pending` | `CAP-C1-C14-WIRING`、`USER-SIM-01` | 按 01～09 的需求与黄金旅程，对照 Codex 和 Claude Code 在同类问题上的可观察行为；所有适用产品能力、长任务、故障恢复、结果验证和跨 Surface 验收通过 |

## 伴随治理结果

| 结果 ID | 状态 | 触发条件 | 完成条件 |
| --- | --- | --- | --- |
| `DOC-ARCHIVE-01` | `in_progress` | 对应产品能力、验证或历史交接责任已真实完成 | 将对应 01～20 文档整份移入 `archive/`；根目录无同名副本、跳转页或断链 |

## 当前作业卡

`QUAL-EXT-01`（`blocked_external`）

- 当前条件：R4 非资格本地工作 6/6 完成；Gate 0 仍为 `NOT_PASSED`，6 个外部 authority blocker 未关闭，exact claims=0。
- 接下来需要：独立 authority 提供受保护 profile、职责分离身份与签名、WORM/retention、trusted time/anchor 和可复算 exact claims，使机器 decision 自主达到 `PASS`。
- Headed 条件：已收到“外部资格前置满足后可执行一次 headed DeepSeek 真实用户路径并保留窗口/页面”的操作授权；前置未满足前保持未执行。
- 禁止：把 R4 6/6、本地稳定运行时、deterministic/fixture 或用户操作授权解释为 qualification authority。

## 机器状态源

| 状态 | 唯一机器源 |
| --- | --- |
| active requirement / architecture / process | `docs/process/devseek-active-baseline-selector.json` |
| 能力数、implementation state、claims | `docs/process/devseek-capability-ledger.json` |
| Gate 0、repository/external blockers | `docs/process/devseek-gate0-decision-report.json` |
| Surface 入口覆盖 | `docs/process/devseek-surface-entry-inventory.json` |
| Kernel 切换前 owner 与缺口 | `docs/process/devseek-kernel-prep-owner-baseline.json` |
| R4 leaf 状态 | `docs/process/devseek-r4-iteration-status-rollup.json` |
| 外部授权准备度 | `docs/process/devseek-external-authority-readiness-audit.json` |
| 设计优先的架构护栏 | `docs/process/devseek-architecture-budgets.json` |
| 文档治理与归档覆盖 | `docs/process/devseek-legacy-doc-inventory.json` |
