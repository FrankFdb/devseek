---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md"
  source_group: "handoff"
  decision: "keep"
  relationship: "supporting-ref"
  active_baselines:
    - "docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md"
  machine_sources:
    active_selector: "docs/process/devseek-active-baseline-selector.json"
    legacy_inventory: "docs/process/devseek-legacy-doc-inventory.json"
  asserts_gate_pass: false
---

<!-- DEVSEEK-GOVERNANCE-BANNER:START -->
> [!NOTE]
> DevSeek governance: this document is `historical` with decision `keep` and relationship `supporting-ref`. Current authority: `docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md`. Machine source: `docs/process/devseek-legacy-doc-inventory.json`.
<!-- DEVSEEK-GOVERNANCE-BANNER:END -->

# 顶级编程智能体收敛迭代原则、质量标准与 Skills 规划

- 更新日期：2026-08-07
- 文档性质：模型无关的工程执行规范、GPT-5.5 原子作业协议与候选 Skills backlog
- 当前状态：规范已定义；Skills 矩阵中的候选均未因本文而自动实现或取得资格
- 审计包入口：[README.md](README.md)
- 当前任务入口：[PLAN-当前收敛迭代计划.md](PLAN-当前收敛迭代计划.md)
- 历史接管协议：[15-新窗口与跨模型接管手册.md](archive/15-新窗口与跨模型接管手册.md)
- 历史旧文档裁决：[18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md](archive/18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md)
- 当前作业卡、阻塞和授权范围只由 `PLAN` 与 `docs/process` 机器事实确定；本文不复制动态任务状态

本文把 01～09 的审计、目标架构、路线图和反证结论压缩为可执行的日常工程标准，不重复竞品资料或长篇设计。DevSeek 对标 Codex/Claude 时只比较公开、可观察的软件工程行为，不臆测闭源内部架构。

## 1. 不可违反的收敛原则

1. **单一 semantic authority**：每类事实只能有一个语义 owner。Surface、Provider、parser、UI、history 和兼容层只能适配，不能自行判定完成、权限、mutation、验证或资格。
2. **修缺陷类，不修截图**：复现当前路径后必须审计 sibling entrypoint、状态流、工具/协议边界、持久化、恢复和 UI 投影；重复逻辑应收口为服务、契约或静态 guard。
3. **覆盖完整软件生命周期**：意图、需求、外部边界、设计、实现、编译测试、恢复结算、发布、文档和资格都必须有明确输入、输出、authority 与证据。
4. **最小可联合验收批次**：默认提升一个可独立验收的 capability；当多项能力共享同一上游契约、依赖连续、修改无冲突且能分别给出退出证据时，可在一张批次卡中联合实现和验证。不得用“大重构完成”代替逐项状态与证据。
5. **先 evidence，后 claim**：原始工具结果、变更、验证、artifact 和运行事实先进入不可变证据，再由独立规则派生结论。模型自述和 Markdown 不能成为事实源。
6. **deterministic 不等于 live/qualification**：unit、replay、Headless、同机签名、本地 CAS 和 Phase 全绿只证明对应本地范围；不能外推真实 UI、Provider 稳定或资格等级。
7. **未知默认 fail closed**：未知事件、命令、副作用、权限、Schema 版本、资格字段、环境或恢复状态不得隐式通过；产品可显式 fail-soft，但资格聚合必须把证据缺口视为 veto/不可聚合。
8. **禁止平行 owner 与长期双轨**：不得通过新 loop、fallback、case 特判或 feature flag 长期保留两套 writer/verifier/settlement。迁移期旧 API 只能无语义委托并有删除门禁；新边界达成行为等价后，同轮删除旧实现、旧测试和活动引用，不保留“也许以后有用”的不可达代码。
9. **用户权限与外部动作分离**：只读调查、workspace mutation、终端/MCP、网络、账号、发布和破坏性操作分层授权；模型不能扩大用户授权。
10. **比较可观察行为，不臆测内部**：对标 Codex/Claude 时记录任务契约、上下文发现、工具执行、变更边界、验证恢复和交付体验；结论必须落到 DevSeek 的 owner、contract、测试和删除项。
11. **失败事实粘性**：后续成功不能覆盖旧失败；解除 adverse state 必须有新的 committed effect、matching verification、quality gate 和显式 recovery 因果链。
12. **发布身份是实现的一部分**：Extension/Bridge 行为改变后，compile、package、packaged Bridge verify、hash、local install 和 installed identity 缺一不可。
13. **模型不是 authority**：从 GPT-5.6 Sol Ultra 切换到 GPT-5.5 只改变执行者，不改变 SSOT、权限、profile、claim、质量门或完成定义；模型自信度永远不是证据。
14. **WIP=1、窗口=一张卡**：一个窗口只认领一张 atomic/batch card 和一个集成 owner。批次可覆盖多个明确 semantic authority，但必须预先列出依赖、允许路径、独立验收和删除项；并行只允许无写冲突的实现/验证，不能借合批建立跨 owner 旁路，提交权仍归集成 owner。
15. **小上下文、可恢复 checkpoint**：定向读取任务直接依赖；工具输出保留必要证据。接近压缩时先记录 task id、baseline、dirty、首个失败、已改路径、验证与下一步，再切窗口，禁止重新扫全仓。
16. **元数据不是执行证据**：catalog、profile、prompt、Skill 或 runner inventory 的存在不证明语义已执行；每个声明语义必须有绑定输入、真实 executor、oracle、receipt 和 terminal evidence。
17. **旧文档不得复活执行权**：`docs/requirements`、`docs/architecture` 和本包 01～13 中的“当前、下一轮、已完成、stable、Phase”只作历史/设计证据；当前任务只由 `PLAN-当前收敛迭代计划.md` 发放，已归档的 14/18 只保留历史计划与承接映射。
18. **授权精确绑定且不继承**：用户/外部授权必须绑定当前窗口、atomic ID、candidate、run/action、tool、不可变 input digest、effect facets、sandbox policy、target scope、有效期和撤销源，并由当前 authority session 签发和验真；字段结构正确不能替代签发事实。journal、checkpoint 或 resume receipt 只能重放同一精确 operation；任一绑定缺失或漂移都 fail closed。旧聊天、旧窗口、另一个 slot 或一般性“继续”不能替代高影响动作的明确授权。
19. **设计原则优先，规模指标从属**：代码优化先确定行为契约、唯一 owner、单一职责、依赖方向和可测试边界，再查看行数、diff 和复杂度。如果缺陷暴露了错误边界，应重构或删除该边界，不在其上叠加补丁。规模预算只阻止职责回流；删说明、压格式、空壳拆分或无契约迁移不计收敛。
20. **计划可修订，范围不可偷换**：探索或工具调用发现新具体目标时，必须在副作用前由唯一 plan-revision authority 封存证据、父计划、影响与验收映射；执行 authority 只消费当前修订。显式 `allowed_paths`、`no_touch_paths`、`non_goals`、`no-other-files` 和 workspace 边界不得被模型提议改写，不能用“动态规划”伪装越权。

## 2. 生命周期质量标准与 Definition of Done

每个阶段都必须回答七个问题：输入是什么、输出是什么、谁拥有语义、机器门是什么、攻击反例是什么、是否需要真实 UI、何时停止/回退。

| 阶段 | 输入与输出 | 唯一 authority | 机器门与攻击反例 | 真实 UI / 停止回退 |
| --- | --- | --- | --- | --- |
| 意图识别 | 输入为用户原文、会话修订、项目规则和上下文证据；输出版本化 `TaskSemanticContract/TaskContract` 或 `devseek.semantic-intent/v1` 候选，不是自由文本标签；字段必须覆盖任务形态、工程上下文、mutation scope、验证/运行义务、副作用等级、完成 `done_iff` 和歧义状态 | TaskSemanticContract builder/merger + semantic intent governor；LLM 可产出自然语言理解候选，本地 governor 负责安全边界、no-write/destructive/external-effect/Bridge 可见通道约束；下游 validation、terminal、completion、QualityGate 和 UI route 只消费合并后的 contract 字段，不重新解析原始 prompt | 中英文否定、作用域、后续更正、resume/destructive、standalone/existing-project、print/stdout、compile-only/compile-run、run-only/no-write、Bridge hidden-prompt pollution 反例；每个 semantic task_kind 必须有外部来源用户输入 corpus 覆盖；duplicate intent owner 为硬失败；未知歧义必须提问或 blocked | 简单任务可无 UI 且走最短闭环；目标/禁止项冲突立即停止写入；可见 Web/Bridge Provider 未隔离前不得发送隐藏分类 prompt |
| 需求分析 | 输入 TaskContract 与 context evidence；输出 objectives、deliverables、constraints、non-goals、assumptions/conflicts、acceptance oracle 和不可变 revision | `RequirementDecisionPort` + `AcceptanceContractPort` | 每个验收项必须绑定 deliverable、verifier/scope/evidence kind；禁止固定领域关键词、固定文档数、把非目标变成交付物或把“只读源码”扩大成“不写报告” | 弱 oracle、冲突或关键未确认假设必须 clarification-required；不得自行扩需求 |
| 外部边界发现 | 输入用户路径、规则和外部来源证据；输出 repo root、入口、依赖、构建/发布、账号/网络/法规 boundary 与 source grounding | `ExternalBoundaryPort` + `SourceGroundingPort` | 来源必须精确绑定 boundary、locator、content digest、tool/effect receipt；覆盖 AGENTS/CLAUDE、构建文件、调用者/注册点、workspace 边界缺失、路径逃逸和来源冒名反例 | 网络/账号/外部系统前必须授权；边界或来源未知时 exploration-required/fail closed |
| 软件设计 | 输入 requirement revision 与 context graph；输出 design alternatives/trade-off、ImpactSet、ChangePlan、dependency checks、migration/deletion/rollback 和 acceptance mapping | `DesignDecisionPort` + `ChangePlanPort` | 单 owner、依赖方向、故障模型、幂等/恢复、跨平台、计划外 target/effect；平行 loop/双写/Surface 业务规则为硬失败 | 重大架构取舍超出范围时请求确认；新证据或实现偏离必须创建同 owner revision，不得旁路旧计划 |
| 代码实现 | 输入已批准 ChangePlan；输出最小 diff、迁移/删除、EvidenceRef 与 read-back | 对应 domain service；workspace 写盘仅 Mutation authority | compile/type/schema、diff budget、sibling guard、CAS/dirty/ABA/fault injection；禁止隐藏 writer | 发现需扩大 capability 时停止并拆新任务；不顺手扩功能 |
| 权限与副作用 | 输入 operation intent/identity/policy；输出 durable request/authorization/started/terminal receipt | Permission + SideEffect authority | deny-before-callback、unknown mutable、idempotency、timeout/indeterminate、secret non-observation、MCP/command/undo 旁路 | 高风险/网络/破坏性动作需用户授权；拒绝或身份漂移立即停止 |
| 编译与测试 | 输入变更、项目规则和 acceptance；输出 VerificationPlan 与原始结果 | Validation Planner + runner；模型无权自判 pass | focused→package full→replay→architecture→Phase；测试未执行、弱 oracle、环境失败误标 pass 为硬失败 | GUI/交互项显式 manual review；早层失败不跳后层 |
| 恢复与结算 | 输入全部运行事件；输出唯一 terminal settlement、seal 和可重放状态 | RunContext/Settlement authority | adverse<commit<verification<gate<recovery、失败粘性、预算/no-progress、exactly-one terminal；fake recovery 攻击 | 无新证据或预算耗尽时 failed/blocked，不无限继续 |
| 软件发布 | 输入干净 release commit；输出精确 VSIX/Bridge/hash/build/installed identity | Release pipeline | package reproducibility、包内 commit、Bridge health/auth、SHA-256、安装后 identity、tracked drift | 包身份不一致或发布后源码漂移立即停止/回滚完整旧 artifact |
| 文档与接管 | 输入机器 SSOT、Git、测试和 artifact；输出 active 状态、backlog、接管清单 | Machine SSOT + documentation generator/owner | 相对链接、diff check、生成物 drift、事实/计划分栏、commit 自引用处理 | 文档不得提升能力；冲突时机器证据优先并记录 superseding fact |
| 资格 | 输入冻结 candidate、签名 plan、完整事件、独立 Manifest/retention | 独立 qualification authority | 分母/失败/veto 守恒、精确 tuple、职责隔离、WORM/anchor/time、跨 scope 外推攻击 | 缺外部 authority 或 live 授权即 blocked；任一 veto 关闭候选 |

DoD 的最低共同部分：

- 输入/输出 Schema 和 owner 可定位；
- 正例、边界、恶意反例、故障恢复和 sibling bypass 都有自动测试或明确 manual gate；
- 拒绝路径在外部 callback、workspace、账本和 UI 上没有假成功；
- 实际验证命令、版本和 artifact 身份可复算；
- 未验证部分、适用范围和资格边界写明；
- 被替代 owner 已删除或只剩有删除期限的无语义 delegator。

## 3. 固定收敛迭代作业模板

### 3.1 选择与基线

1. 只从 [当前计划](PLAN-当前收敛迭代计划.md) 领取一个明确的作业卡；机器 capability DAG 只复核前置、状态和证据，不发卡。
2. 写明用户结果、semantic authority、输入/输出 contract、依赖、非目标、删除项和退出证据。
3. 固定 branch、commit、dirty state 和 applicability；仅在 release/Surface/runtime 进入本卡 scope 时分别复算 artifact、stable installed 与 active runtime identity；先确认现有用户改动。
4. 用 Codex/Claude 同类可观察行为描述差距，但只转化为 DevSeek 的 contract/owner/test，不复制提示词。

### 3.2 最小实现与兄弟审计

1. 先构造最小 failing replay/attack。
2. 修改拥有事实的最小 authority，不在 Surface/Provider 临时补逻辑。
3. 定向检查 sibling entrypoint、state transition、persistence、recovery、protocol、UI 和 legacy migration。
4. 合并重复实现，添加静态 reachability/import/mutation guard；删除被替代路径。
5. 如果同类失败再次出现，必须提高 abstraction、Schema 或 guard 层级，不允许添加第三个样例分支。
6. 最后才评估文件规模；只有职责、依赖和测试边界完整迁出时才下调预算，不得为过行数门而压缩表达。

### 3.3 验证、复审、提交与发布

```text
focused unit/property/schema attacks
  → affected package compile/typecheck/test
  → captured replay/headless/architecture/generated drift
  → independent adversarial review (P0=0, P1=0)
  → Phase 0–12
  → 仅同步作业卡批准的 machine SSOT/generated views/docs；动态事实变化时至少核对 14/15
  → staged boundary/diff review
  → one reviewed task/source commit
  → Phase 0–12 from that clean commit
  → [仅当 Extension/Bridge 行为变化或作业卡明确要求 release] compile/package/exact VSIX
  → [同上] packaged Bridge verify + SHA-256
  → [同上] local install + stable installed identity
  → [仅当 Surface/runtime 在 scope] active runtime receipt；随后输出适用的 final handoff identities
```

任一阶段失败就回到最近的 authority 修复，不通过“先打包看看”、重跑成功覆盖失败、忽略 suite 或降低标准继续。不得固定改写 12～17 全套历史报告：只修改作业卡批准的动态/生成文档，17 仅在新集成批次形成时更新。tracked 文档必须在 task/source commit 前完成；post-commit package/install 只记录动态回执、Phase 报告和最终交付身份，不为回填自引用 commit/VSIX hash 再创建混合提交。docs-only handoff 不要求重打未变产品 source 的 VSIX。真实 Provider/UI/holdout 只有在 profile、候选、计划、账号条款和当前授权同时满足时执行。

### 3.4 每轮作业卡

```text
task_id:
model: GPT-5.5
authority_mode: read-only | implementation | integration-release
user_outcome:
machine_state_before:
source_of_truth_files:
baseline_branch_head:
dirty_staged_untracked_state:
handoff_doc_commit_and_ancestor:
implementation_commit:
phase_source_commit_and_report:
artifact_source_commit_and_applicability:
stable_installed_identity:
active_runtime_identity:

prerequisites_and_dependency_ids:
semantic_authority:
input_output_contract_and_schema:
defect_class_or_atomic_capability:

allowed_paths:
no_touch_paths:
non_goals:
external_actions_forbidden_or_explicitly_authorized:

minimal_failing_evidence:
sibling_entrypoints:
state_protocol_persistence_recovery_ui_audit:
minimal_change:
replaced_or_deleted_paths:
plan_revision_evidence_and_scope_invariants:

focused_commands_and_expected_counts:
affected_package_commands:
architecture_and_generated_drift_commands:
independent_review_requirement:
phase_command:
release_identity_commands_if_applicable:

evidence_paths_hashes_and_receipts:
task_source_commit_and_phase_identity:
artifact_bridge_stable_active_identity_and_applicability:
live_or_manual_result_or_not_run_reason:
qualification_scope_and_claim_effect:
not_run_items:
new_p2_backlog:

stop_if:
done_iff:
terminal_state: PASS | BLOCKED | FAIL
next_atomic_id_or_blocked_reason:
```

GPT-5.5 必须在写代码前补齐所有字段。`allowed_paths` 不是搜索提示而是变更上限；`no_touch_paths`、`non_goals` 和 `stop_if` 不能在执行中静默删除。执行中发现新具体目标时，只能在预先允许的语义 authority 与用户范围内通过证据化 plan revision 纳入；新的第二 authority 或范围外目标不得静默扩入。批次卡必须在实施前列明全部 semantic authorities、依赖和逐项 oracle；边界变化应登记新卡并以当前卡 `BLOCKED` 或限定 `PASS` 结束。

## 4. Skills 规划原则

这里的 Skill 不是一段“让模型表现更好”的 prompt。一个可进入 DevSeek 的 Skill 必须是：

> 版本化输入/输出契约 + semantic authority 适配 + 权限/副作用声明 + evidence schema + deterministic/replay/攻击测试 + applicability/profile + 可审计发布身份。

Skill 不能：自行写盘、绕过 permission、自己宣称 task complete、隐藏工具原始输出、把 Provider 特例写入 Kernel、用自然语言输出替代 Schema，或把本地 pass 外推成资格。

状态词：`candidate-design` 表示只完成规划；`implemented` 必须有代码和测试；`wired` 还要求真实声明入口不可绕过接线；L 级只来自有效精确 qualification claim。本文所有候选当前均为 `candidate-design`，不得因表格存在改写机器 ledger。`Priority-0/1` 是候选实施先后标签，与独立复审的缺陷严重度 `P0/P1` 完全不同。

## 5. 候选 Skills 矩阵

| Candidate Skill | Purpose / Input → Output | Authority 与 side effects | Evidence / Schema / tests | 依赖 | 当前状态 / 优先级 |
| --- | --- | --- | --- | --- | --- |
| Intent Semantic Contract | 把用户原文、会话修订、项目规则和上下文证据转成 `task_kind`、工程上下文、mutation scope、目标产物、验证/运行义务、副作用等级、完成 `done_iff` 与歧义状态；非 Web Provider 可先产出严格 JSON semantic candidate，再由 governor 合并 | TaskSemanticContract authority + semantic intent governor；解释器无工具、无写盘、无执行；禁止下游模块再以原始 prompt 生成独立意图结论；Bridge/Web 可见会话未隔离前只能跳过隐藏解释 | versioned schema；外部来源 user-input corpus 至少覆盖 smalltalk、QA、inspect、planning、review、standalone、file artifact、existing edit、run-only、external-effect、destructive、ambiguous；否定/作用域/跨轮/歧义 property tests；Bridge hidden-prompt pollution oracle；duplicate-owner static/runtime guards | ContextRef、conversation revision、project rules、非 Web LLM Provider 或隔离 semantic channel | `implemented-partial` / Priority-0，R1-A2H/R1-A2I 产品侧非资格；v3 产品纵切已完成：`TaskSemanticContract` 统一跨轮修订、项目指令、mutation/read、产物/验证/质量义务、`done_iff` 与歧义，session、Kernel、双 loop、deterministic/fast path 只消费该契约，48 条自然输入覆盖 12 类任务；剩余：非 Web 严格 semantic candidate、隔离 semantic channel 与 hidden-prompt pollution oracle、跨 Surface 单一 Kernel 接线及更广 property/真实多轮验收 |
| Requirement Contract | 从 `TaskSemanticContract` 与证据转成 objectives/deliverables/constraints/acceptance/applicability | Requirement Contract authority；纯计算，无副作用；不得扩大 Intent contract 的禁止项或任务形态 | versioned contract；acceptance 可执行性、隐式扩需求、固定关键词/固定文档数反例 | Intent Semantic Contract、ContextRef | `candidate-design` / Priority-0，Gate 0 后 R1-A/R2-02 |
| Context Discovery | 从用户路径发现 repo、规则、构建、入口、依赖和外部边界 | Discovery port；默认只读，网络需授权 | EvidenceRef graph；path/symlink/large-tree/missing-rule tests | Requirement Contract、filesystem policy | `candidate-design` / Priority-1，R2 |
| Evidence & Provenance | 把文件、命令、工具、版本和 artifact 原始事实规范化为不可变引用 | EvidenceStore authority；采集默认只读，执行动作仍经对应 authority | EvidenceRef/provenance schema；hash/read-back/stale/version/tamper tests | Run identity、Context、工具 adapters | `candidate-design` / Priority-0，R1-A |
| Architecture Decision | 生成最小 ADR/ChangePlan、owner、状态、风险、删除项 | Design authority；无直接写盘 | ADR schema、dependency/owner/lifecycle checks、parallel-owner attacks | Requirement + Context | `candidate-design` / Priority-1，R2 |
| Code Implementation | 从 ChangePlan 与源码证据生成最小 ChangeSet，并保持项目约束和集成点 | Implementation planner；不能直接落盘，写入只经 Mutation authority | ChangeSet/symbol-impact schema；compile、scope、sibling、generated/handwritten boundary tests | Requirement、Context、Architecture、Evidence、Mutation | `candidate-design` / Priority-0，R1-B/R2 |
| Workspace Mutation | 把 write/edit/delete/mkdir/move/undo 归一为可恢复 change transaction | 唯一 Mutation authority；高影响本地副作用 | ChangeSet/receipt；CAS/ABA/dirty/symlink/ENOSPC/rollback tests | Permission、Evidence、RunContext | `candidate-design` / Priority-0，R1-B |
| Permission & SideEffect | 分类 command/MCP/network/terminal/workspace effect 并记录授权生命周期 | 唯一 Permission/Effect authority；可触发外部副作用 | operation schema/receipt；deny-before-call/idempotency/unknown-mutable/secret attacks | TaskContract、RunContext | `candidate-design` / Priority-0，R1-B |
| Validation Planning | 从 acceptance 和工程入口选择最小有效验证并逐层扩展 | Validation Planner；执行委托受控 runner | VerificationPlan/result；missing-command/weak-oracle/GUI/manual tests | Requirement、Context、Permission | `candidate-design` / Priority-0，R1-C |
| Failure Diagnosis & Repair | 将失败分类、定位最小根因并生成有界 repair plan | Diagnosis authority；修复写入仍经 Mutation | Diagnosis/RepairContract；sticky failure/repeat/no-progress/correlation tests | Evidence、Validation、Settlement | `candidate-design` / Priority-0，R1-C |
| Review | 将 contract、diff、证据和验证结果转成按严重级别排序的独立缺陷结论 | Review authority；默认只读，无修复写入权 | ReviewFinding schema；P0/P1、false-positive、sibling/bypass、reviewer-independence tests | Requirement、Architecture、Evidence、Validation | `candidate-design` / Priority-0，所有实现批次 |
| Recovery & Checkpoint | 从 adverse event、checkpoint 和 durable receipts 规划有界 resume/repair/compensation | Recovery authority；恢复 effect 仍经 Permission/Mutation | checkpoint/recovery schema；crash、retry、ABA、stale checkpoint、fake recovery tests | Run Evidence、Mutation、Validation、Permission | `candidate-design` / Priority-0，R1-C |
| Settlement & Completion | 依据完整事件和验收证据产生唯一 completed/failed/blocked/waiting terminal | 唯一 Settlement authority；无业务副作用，只封存事实 | settlement/seal schema；exactly-one terminal、pending/adverse/degraded、duplicate owner attacks | Requirement、Evidence、Validation、Recovery、RunContext | `candidate-design` / Priority-0，R1-A/R1-C |
| Release | 从冻结 commit 构建、验证、hash、安装并核对 identity | Release pipeline；本地 package/install，远端发布另授权 | ArtifactManifest；reproducibility/Bridge/auth/hash/installed identity tests | Full verification、Git clean state | `candidate-design` / Priority-0，当前流程先实现为脚本 authority |
| Handoff | 从 Git/SSOT/测试/artifact 生成无聊天接管包 | Documentation owner；只写批准 docs/generated views | Handoff schema；link/drift/placeholder/stale-baseline tests | Release evidence、Backlog | `candidate-design` / Priority-1；15 是人工协议，不是已实现 Skill |
| Qualification Evidence | 预注册、收集、独立复算精确 tuple claim | 独立 qualification authority；可触发获授权 live | G0-B/C schema；signature/denominator/veto/retention/scope attacks | protected policy/roles/WORM/time/runner | `candidate-design` / Gate 0；现有协议组件不等于完整 Skill wired |

可追加但不应先于以上核心 Skills 的候选：Collaboration/Subagent、Long-term Memory 和 UI Progress Projection。它们必须复用同一 TaskContract、Evidence、Permission、Mutation、Validation 与 Settlement，不得产生新的 owner。

### 5.1 GPT-5.5 工程 Workflow Skills 候选

下表是“帮助模型按本仓规则工作”的 workflow Skill，不是 DevSeek 产品能力。即使未来实现，也只能编排既有 checker/authority，不能替产品生成 claim、修改 completion 或绕过权限。

| Workflow Skill | 输入 → 输出 | 允许调用 / 明确禁止 | 机器门 | 当前状态 |
| --- | --- | --- | --- | --- |
| Baseline Resolver | repo path + handoff doc → handoff/source/Phase/artifact/stable/active runtime 分层 receipt | 只读 Git、报告、VSIX/install/process metadata；禁止 reset/clean/stash/输出 secret | short SHA 唯一解析；stale/mismatch/missing/applicability fail closed | `candidate-design`；G0-01 后评估 |
| Atomic Card Compiler | `PLAN` 当前任务 + machine state → 完整 GPT-5.5 作业卡 | 只读 docs/SSOT；禁止扩大 allowlist、领取 parent 或自动选择下一阶段 | required fields、dependency、WIP=1、no-touch、legacy mapping unmapped=0 | `candidate-design` |
| Runner Reachability Auditor | runner inventory + entrypoints → coverage/bypass report | 定向 source graph/static checks；禁止把 catalog metadata 计 runner | inventory coverage=100%、unknown import fail | `candidate-design`；现有 checker 是组件，不是完整 Skill |
| Gate0 Decision Inspector | decision report + source hashes → 本地/仓库/外部/claim 四栏解释 | 只读 checker；禁止生成 claim/override PASS | source-bound、const-false external trust、exact counts | `candidate-design`；现有 decision checker 是组件 |
| Documentation Truth Reconciler | machine SSOT + migration manifest → generated status/link drift | 只改批准 generated views；禁止 Markdown 反向提升 ledger | selector unique、links valid、second generation diff=0 | `candidate-design`；G0-01～03 |
| Verification Planner | task card + changed paths → focused/full/Phase/manual plan | 只选已注册 commands；外部动作仍需 permission | missing command/weak oracle/GUI classification tests | `candidate-design`；R1-C/R2-08 |
| Release Identity Verifier | clean commit + VSIX + Bridge + install → exact identity receipt | package/local install 可按 AGENTS；禁止 push/marketplace | commit/version/build/hash/installed exact match | `candidate-design`；脚本 authority 尚未统一 |
| Same-Window Surface Auditor | exact active identity + fresh explicit authorization + prompt marker → 用户窗口证据 | 只操作隔离 probe path并恢复临时设置；禁止把隔离窗口替代、禁止资格提升 | prompt/file/command/settlement/UI/cleanup 全绑定 | `candidate-design`；当前 `NOT_RUN`、授权不继承，协议见 15/17 |
| Handoff Generator | task/evidence/release receipts → 15 格式无聊天接管包 | 只写批准 docs/generated handoff；禁止静态自引用 hash | placeholder/stale baseline/link/drift tests | `candidate-design` |

优先级以 `PLAN-当前收敛迭代计划.md` 为唯一滚动来源；外部 Gate 0 blocker 不得由 workflow Skill 伪造关闭，也不得为了“让模型更聪明”抢占产品 Kernel、语义契约和资格 authority。任何 workflow Skill 只有在至少两轮人工协议重复且边界稳定后才值得产品化。

## 6. Skill 实施与晋级门禁

每个 Skill 必须逐级取得以下证据：

1. **Design**：purpose、applicability、input/output Schema、authority、权限、副作用、错误模型和依赖明确。
2. **Implemented**：纯核心/adapter 存在，unknown/default fail closed，unit/property/attack 测试通过。
3. **Wired**：所有声明入口 reachability=100%、bypass=0，旧入口删除或无语义委托。
4. **Surface verified**：VS Code/CLI 等声明 Surface 使用同一 contract，replay 与真实 UI 事实一致。
5. **Qualified**：冻结 candidate 按受保护 profile 产生精确 tuple claim；不得跨 Surface/Provider/platform 外推。

任何 Skill 只能请求它声明的权限；副作用发生前必须有 durable operation identity 和 authorization，发生后必须有 terminal receipt。Skill 组合由 Kernel 调度，不能互相直接改 completion 或 qualification 状态。

## 7. GPT-5.5 执行与输出契约

### 7.1 三种 authority mode

| mode | 可以做 | 不可以做 | 典型终态 |
| --- | --- | --- | --- |
| `read-only` | 基线、inventory、diff、机器报告、设计与独立复审 | 写产品/docs、提交、安装、触网 | finding + `PASS/BLOCKED/FAIL` |
| `implementation` | 作业卡 allowlist 内实现、测试、同步机器 SSOT/批准 docs、local commit | 外部 live/发布、越过依赖、修改 no-touch paths | 一个 atomic commit |
| `integration-release` | 合并已复审切片、全量/Phase、package/Bridge/hash/install/用户授权的 Surface gate | 新增无关能力、push/marketplace、补跑覆盖失败 | 精确动态 release receipt |

一个窗口只使用一种 mode；需要提升 mode 时先结束当前卡并取得用户/集成 owner 明确授权。

### 7.2 GPT-5.5 微循环

1. **Resolve**：按 15 复算 Git、dirty、Phase、runner/decision，并按 applicability 复算 artifact/stable installed；仅当 Surface/runtime 在 scope 时观察 active runtime。机器事实与聊天冲突时机器优先。
2. **Claim one card**：按当前计划和 capability DAG，选择一个前置已满足的 leaf，或一组依赖连续、修改无冲突且可逐项验收的 cohesive batch，补齐第 3.4 节作业卡；无边界的 parent/program group 不可领取。
3. **Reproduce first**：建立最小失败/攻击证据，记录首个根因；没有可证伪 oracle 时不实施。
4. **Change owner only**：修改事实 owner，审计 sibling/state/protocol/persistence/recovery/UI；删除旧 owner或加不可绕过 guard。
5. **Verify outward**：focused→affected package→replay/headless→architecture/generated drift；任何失败立即回 owner。
6. **Adversarial review**：独立复审 P0=0/P1=0；reviewer 不能用实现者自述替代 diff/测试。
7. **Integrate**：Phase、docs/SSOT、staged boundary、一个 commit；需要时从 clean commit release。
8. **Settle and stop**：只输出 `PASS/BLOCKED/FAIL`，完整动态 receipt 和下一 atomic ID；不自动进入下一卡。

### 7.3 输出事实分栏

GPT-5.5 的 commentary/checkpoint/final 必须区分：

- `repository fact`：文件、Git、Schema、machine report 可直接读取的事实；
- `test evidence`：本轮实际命令、版本、计数、first failure、修复后结果、未运行项；
- `inference`：由多项事实推导，必须写出依据和不确定性；
- `proposal`：尚未实施的新卡/P2/外部请求，不能写成现状。

外部竞品事实需要官方公开来源；不推测 Codex/Claude 闭源内部。最终交付顺序固定：结果 → 改动 → 测试/独立复审 → commit/Phase/artifact/install/用户窗口 identity → 未运行/风险 → qualification boundary → 下一 atomic ID/暂停。

### 7.4 GPT-5.5 停止与 checkpoint

立即停止并结算当前卡：

- P0/P1 未清零、focused/full/Phase 任一失败或 oracle 无法绑定用户意图；
- 新改动需要第二 authority、dual writer/settlement、fallback 或任务外路径；
- dirty ownership 不明、用户选择会实质改变结果、外部 authority/账号/条款缺失；
- candidate 冻结后任一 source/profile/oracle/Provider/Surface/artifact identity 变化；
- Gate 0 未 PASS 却准备进入 R1；
- context 接近压缩且尚未留下 checkpoint。

checkpoint 最小字段：`task_id`、mode、branch/HEAD、dirty/staged/untracked、事实/假设、首个失败、已改路径、已跑命令与结果、P0/P1、未运行项、Gate/claim 状态、下一条精确命令。新窗口从 checkpoint 和 Git 继续，禁止重做整仓审计。

禁止项：

- 不用 prompt 特判代替契约/authority；
- 不让 Skill、Surface、Provider、UI 或模型文本自行结算；
- 不把 mock、replay、Phase、同机签名、本地安装称为 live/qualification；
- 不删除失败、补跑覆盖、改变分母、降低 profile 或跨 scope 合并 claim；
- 不在未获授权时登录、触网、消耗 Provider、发布、push 或修改外部基础设施；
- 不在共享 dirty worktree 上执行破坏性 Git 操作；
- 不在 Gate 0 PASS 前开始 R1，也不因路线图写完而称产品完成。
- 不把 catalog metadata、profile 声明或通用 happy-path executor 统计成语义执行覆盖；
- 不让同仓 mode + fresh self-hash 建立 independent authority；受保护 claim 必须逐项绑定受信 profile、manifest、retention 和 provenance；
- 不用隔离 Extension Host 代替用户明确要求的同一 DevSeek 窗口 Surface gate；两者必须分级报告。

## 8. 与现有审计包的分工

- 01/07：回答旧需求、架构和回退问题如何形成；
- 02：提供 Codex/Claude 公开可观察能力对标及事实来源；
- 03：给出目标软件架构；
- 04/05/06：给出 capability DAG、黄金旅程、资格与机器治理；
- 08/09：给出最短路线和反证结果；
- [当前计划](PLAN-当前收敛迭代计划.md)：维护完成状态、下一任务、批次依赖和验收条件；
- [15](archive/15-新窗口与跨模型接管手册.md)：保存旧 CLOSE/G0 动态接管协议，不再发放当前任务；
- [17](archive/17-Gate0本地纵切机器裁决用户窗口仿真与GPT5.5接管报告.md)：保存本轮静态集成检查点，不作为滚动状态 owner；
- [18](archive/18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md)：保存旧 requirements/architecture 的历史保留、废止和 atomic ID 承接；
- 本文：维护跨批次不变的工程原则、DoD 和 Skills 候选标准。

冲突顺序：实际 Git/runtime/artifact 与 `docs/process` 机器事实优先；`PLAN` 是唯一当前任务和依赖 owner；本文只约束工程原则；归档 14/15/18/19 仅保留历史证据。任何冲突都必须显式登记，不得靠模型静默解释。
