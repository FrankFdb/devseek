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

- 首要产品目标：以 Codex 和 Claude Code 的官方公开能力及可观察优秀行为为对标，把 DevSeek 优化为顶级编程智能体。
- 编程主线：代码理解、计划、实现、多文件集成、测试、诊断、修复、复核和交付优先；默认模型入口是无需 API Key 的免费 DeepSeek 网页，权限与扩展能力只保留服务编程闭环的最小边界。
- 文档定位：本目录文档是需求、设计和验收输入；归档是责任完成后的结果，不是产品目标。
- 当前判断：本地适用的活跃产品能力已经完成接线，但正式顶级资格尚未通过。Gate 0 仍为 `NOT_PASSED`，不得把本地测试、安装或受控仿真解释为资格结论。
- 状态词：`completed`、`in_progress`、`pending_scope`、`blocked_external`。
- 更新规则：本文只记录当前状态、下一任务、依赖和完成条件；执行日志、命令输出、时间线和历史回执不进入本文。

## 当前状态

| 范围 | 状态 | 可复算事实 |
| --- | --- | --- |
| 单一 Coding Kernel | `completed` | VS Code、CLI、Headless 的 4 条活跃产品路由都通过 shared `CanonicalCodingKernel`；legacy execution owner=0 |
| 语义 owner 基线 | `completed` | `devseek.kernel-prep-owner-baseline/v31`：55/55 语义域收敛，150/150 源码约束通过，missing Surface=0 |
| 活跃能力 | `completed` | capability ledger 中 58/58 个 `active` capability 全部为 `wired` |
| 能力总账 | `completed` | 76 项中 62 项 `wired`、14 项 `proposed`、qualification claims=0；14 项全部属于 conditional、deferred、experimental 或 C14 资格范围 |
| C6 Provider、工具与连接器 | `completed` | 6/6 活跃能力已接线：Provider normalization、tool schema/dispatch/execution、capability negotiation、版本化 DeepSeek Web connector；visual computer use 保持 conditional |
| C7 权限与安全边界 | `completed` | 7/7：permission、sandbox、workspace mutation、external effect、secret redaction、dirty worktree、platform conformance 均有 shared owner 和产品接线 |
| C8～C10 实施到交付 | `completed` | 15/15：code change、integration、verification/diagnosis/repair、independent review、artifact/Git/release/rollback 均 fail closed |
| C11 协作与长任务 | `completed` | 6/6 活跃能力已接线：checkpoint、resume idempotency、cancel、steer、user collaboration、Surface accessibility；background automation 保持 deferred |
| C12 上下文、记忆与证据 | `completed` | 3/3：memory policy、run evidence retention、context compaction 已接线 |
| T1～T5 专题收敛 | `completed` | `2.0.24` 全面 run 15/15 steps；63 个 targeted case、14 个 controlled suite 的 56 次用户流程（55 unique controlled），共 118 selected、94 required、43/43 设计维度，执行证据缺失 0 |
| T6 卡顿与资源回收 | `pending_scope` | 按用户要求停在 T5；只有用户明确继续后，才审计 VS Code 窗口、浏览器、Bridge、后台 memory Provider、日志关联与跨进程回收 |
| C13 扩展边界 | `completed` | 唯一活跃项 MCP 已使用官方稳定 SDK；server launch 建立会话信任，只读封闭调用直接执行，高风险调用精确确认且 receipt 不可重放；其余未启用生态保持 conditional/experimental |
| 用户仿真 | `completed` | I10～I23 共 72 个增量案例绑定唯一 fixture 与自动化证据；I21/I22/I23 分别覆盖 connector/environment、run collaboration、MCP authority；原始结果只保留在被 Git 忽略的 `code/devseek-tests/` |
| C14 正式顶级资格 | `blocked_external` | Gate 0=`NOT_PASSED`，6 个外部 authority blocker、7 个 exact claims 尚未满足；RC、真实 Provider wave 与 sealed holdout 不得本地伪造 |
| 本轮 release loop | `completed` | Phase 0～12 的 32/32 门禁通过；VSIX 已打包安装；唯一 Bridge 运行时空闲，无测试进程或 `.inspect.cjs` 残留 |
| 文档治理 | `completed` | 01～20 编号文档已完整归档且根目录无编号尾页；当前状态与任务只由 PLAN 发放，README 仅提供入口和边界 |

## 非活跃能力

以下 14 项不是当前 core-coding 本地缺口，只有在产品范围正式启用或外部资格前置满足后才能转为当前任务：

| 分类 | 能力 | 当前处理 |
| --- | --- | --- |
| conditional | `C6-VISUAL-COMPUTER-USE` | 产品声明 visual computer use 时建立隔离 runtime、权限和视觉验收 |
| deferred | `C11-BACKGROUND-AUTOMATION` | 产品声明无人值守后台任务时建立独立 profile 和恢复/通知边界 |
| conditional / experimental | C13 Skills、Hooks、Subagent、Worktree、Extension、Plugin、Peer、Headless SDK | 逐项激活；不得为功能对称把未使用生态塞入 Kernel |
| qualification | C14 RC、live qualification、blind holdout、release decision | 只由受保护外部设施、身份和冻结候选证据推进 |

## 下一任务

| 顺序 | 任务 | 状态 | 完成条件 |
| ---: | --- | --- | --- |
| 1 | 关闭当前本地候选 | `completed` | 全量 shared/Bridge/CLI/Headless/Extension 测试、Phase 0～12、架构与生成物门禁全部通过；VSIX 已安装；无残留测试进程；产品、候选身份、文档归档和测试边界均已独立提交 |
| 2 | T6 卡顿与资源回收 | `pending_scope` | 用户明确继续后，按与 T1 相同原则完成 Codex 源码责任对标、模块化修正、真实进程/窗口资源仿真和无残留证据；当前不得自动开始 |
| 3 | 建立 Gate 0 外部资格设施 | `blocked_external` | 独立受保护 profile/aggregator、签名身份、WORM retention、trusted time/anchor 与 7 个 exact claims 全部由授权主体提供并经机器复算 |
| 4 | 执行一次 headed DeepSeek 真实用户路径 | `blocked_external` | 第 3 项完成后，按已有条件授权保留 VS Code 窗口和 DeepSeek 页面；绑定当前冻结候选与真实 Provider evidence，不复用旧回执 |
| 5 | 执行 C14 RC 与 sealed holdout | `blocked_external` | 冻结 profile、runner、候选和 coverage；RC 与全新 disjoint holdout 均满足门槛，失败不得补跑覆盖 |
| 6 | 激活可选产品能力 | `pending_scope` | 仅当产品明确声明相应能力时，为单个 capability 建立 owner、权限、失败恢复、产品入口和独立验收后再提升状态 |

## 完成口径

本地产品收敛完成必须同时满足：行为契约由唯一 shared owner 裁决、Surface 只做宿主适配、所有活跃 capability 为 `wired`、旧 owner 和无生产调用代码已删除、增量用户旅程与总回归通过、发布制品可安装且身份可复算。

“达到顶级编程智能体”还必须满足 C14：真实 Provider、正式项目、受保护 RC、盲 holdout 和资格发布决策全部通过。在此之前，只能声明“本地活跃产品能力收敛完成”，不能声明顶级资格完成。

## 实现准则

1. 先固定用户可见行为、失败/恢复语义和证据边界，再选择实现。
2. 同一决策只有一个 semantic owner；其他入口只适配和组合。
3. 以单一职责、依赖方向、接口隔离和可测试边界组织代码，不按行数机械拆分。
4. 修复缺陷类别并审计 sibling entry points、状态流、协议和恢复路径。
5. 旧代码无生产责任时连同专属测试删除，不保留补丁式双轨实现。
6. 文件大小和复杂度只作回退护栏；行为契约与设计内聚度优先。

## 事实来源

- 能力状态：`docs/process/devseek-capability-ledger.json`
- Kernel owner：`docs/process/devseek-kernel-prep-owner-baseline.json`
- 用户旅程：`docs/process/devseek-iteration-user-journeys.json`
- Gate 0：`docs/process/devseek-gate0-decision-report.json`
- 文档权威：`docs/process/devseek-active-baseline-selector.json`
- 历史回执：`archive/`
