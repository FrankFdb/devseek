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
- 当前结论：顶级编程智能体目标尚未达成；C0 本地实现闭环已完成，但单一 Coding Kernel、C1～C14 产品接线、完整用户仿真和受保护资格仍未完成。
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
| Extension 类型与候选包基线 | `completed` | TypeScript 基线零错误；完整 extension 测试、架构守卫和精确 VSIX T3 Surface 仿真通过 |
| Surface 入口盘点 | `completed` | 87/87 入口受 inventory 覆盖，未知入口与未声明 legacy owner 可达性均为 0 |
| Kernel 切换前 owner baseline | `completed` | 3 条活跃产品路由均仍由 legacy semantic owner 执行；5 个核心语义域收敛数为 0；Headless 产品入口为 0；24/24 源码与默认门禁断言受保护 |
| R4 非资格本地工作 | `in_progress` | 6 个 leaf 中 5 个完成，1 个 clean-runtime leaf 受当前窗口/授权边界阻塞 |
| 能力账本 | `in_progress` | 76 项能力：C0 的 7 项为 `wired`，C1～C14 共 69 项为 `proposed`，qualification claims=0 |
| Gate 0 / 后续资格 | `blocked_external` | Gate 0=`NOT_PASSED`，6 个外部 authority blocker，exact claims=0；本地工作不得自行提升资格 |
| 顶级编程智能体综合验收 | `pending` | 尚未完成 Codex / Claude Code 同类行为对标下的黄金用户旅程、长任务、恢复与跨 Surface 等价性验收 |
| 10～14、17、20 文档治理结果 | `completed` | 对应限定责任完成后，完整文档已归档，根目录无同名尾页 |
| 01～09、15、16、18、19 文档收口 | `pending` | 对应产品、验证或接管责任完成后整份归档 |

## 当前任务

| 顺序 | 任务 ID | 状态 | 依赖 | 完成条件 |
| ---: | --- | --- | --- | --- |
| 1 | `QUALITY-TS-01` | `completed` | 无 | VS Code extension `tsc --noEmit` 零错误；每个错误在正确语义 owner 修复；同类路径有回归测试 |
| 2 | `KERNEL-PREP-01` | `in_progress` | `QUALITY-TS-01` | 在不切换产品路径的前提下，按职责抽取 CLI/VS Code legacy owner，固定端口与 conformance 基线；不得新增业务内核或终态 owner |
| 3 | `QUAL-EXT-01` | `blocked_external` | 独立授权、受保护身份/设施、holdout 和不可变保留 | 6 个外部 blocker 由授权主体关闭，7 个 C0 exact tuple claims 可复算，机器 decision 自主达到 `PASS` |
| 4 | `KERNEL-02` | `blocked_external` | `KERNEL-PREP-01`、Gate 0=`PASS` | VS Code、CLI、Headless 共用唯一 Coding Kernel、TaskContract、ToolExecutor、mutation/verification/completion 语义；legacy loop 不再拥有业务决策 |
| 5 | `SURFACE-CONTRACT-01` | `pending` | `KERNEL-02` | 同一任务在 VS Code、CLI、Headless 产生等价的状态、工具、验证和完成结果；静态守卫防止新旁路 |
| 6 | `CAP-C1-C14-WIRING` | `pending` | `SURFACE-CONTRACT-01` | 按 capability DAG 将 C1～C14 的 69 项能力从 `proposed` 逐项提升到可证的 `implemented/wired`；每项均有 owner、产品入口、失败恢复和机器证据 |
| 7 | `USER-SIM-01` | `pending` | 每个产品切片 | 以用户方式覆盖安装包、真实入口、多轮任务、失败恢复和结果核验；仿真与正式资格证据严格分离 |
| 8 | `TOP-AGENT-ACCEPTANCE-01` | `pending` | `CAP-C1-C14-WIRING`、`USER-SIM-01` | 按 01～09 的需求与黄金旅程，对照 Codex 和 Claude Code 在同类问题上的可观察行为；所有适用产品能力、长任务、故障恢复、结果验证和跨 Surface 验收通过 |

## 伴随治理结果

| 结果 ID | 状态 | 触发条件 | 完成条件 |
| --- | --- | --- | --- |
| `DOC-ARCHIVE-01` | `in_progress` | 对应产品能力、验证或历史交接责任已真实完成 | 将对应 01～20 文档整份移入 `archive/`；根目录无同名副本、跳转页或断链 |

## 当前作业卡

`KERNEL-PREP-01`

- 范围：在 Gate 0 外部资格闭合前，完成不改变产品路由的责任盘点、内聚模块抽取、端口定义和 conformance 基线准备。
- 已完成：CLI workspace context selection、artifact interpretation、workspace mutation、verification、run evidence 和 legacy coding coordination 已各有单一 owner；VS Code 请求取消、Kernel 绑定、AbortSignal 与 steer 隔离由 `ActiveChatRunCoordinator` 统一负责；会话持久化由 `SessionService` 统一负责；会话续接的文件恢复、上下文注入和新会话隔离由 `SessionContinuationProjector` 及其纯领域投影统一裁决。上述职责均有显式依赖、直接行为测试及防旁路静态守卫，产品路由保持不变。
- 下一任务：基于已冻结的 owner baseline，准备 TaskContract、工具执行、变更回执、验证和完成判定的跨 Surface conformance fixture 与 adapter contract；不得把准备性接口或测试夹具记作产品接线。
- 禁止：切换 R1 产品纵切、引入第二套 Kernel、修改资格状态，或将 legacy adapter 描述为已收敛内核。
- 完成后：保持 `KERNEL-02` 等待 Gate 0=`PASS`；执行证据只进机器报告或归档交付物。

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
