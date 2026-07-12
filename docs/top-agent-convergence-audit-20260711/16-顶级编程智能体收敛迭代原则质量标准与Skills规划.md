# 顶级编程智能体收敛迭代原则、质量标准与 Skills 规划

- 更新日期：2026-07-12
- 文档性质：模型无关的工程执行规范与候选 Skills backlog
- 当前状态：规范已定义；Skills 矩阵中的候选均未因本文而自动实现或取得资格
- 审计包入口：[README.md](README.md)
- 接管入口：[15-新窗口与跨模型接管手册.md](15-新窗口与跨模型接管手册.md)
- 整体 backlog：[14-未完成事项与后续整体迭代计划.md](14-未完成事项与后续整体迭代计划.md)

本文把 01～09 的审计、目标架构、路线图和反证结论压缩为可执行的日常工程标准，不重复竞品资料或长篇设计。DevSeek 对标 Codex/Claude 时只比较公开、可观察的软件工程行为，不臆测闭源内部架构。

## 1. 不可违反的收敛原则

1. **单一 semantic authority**：每类事实只能有一个语义 owner。Surface、Provider、parser、UI、history 和兼容层只能适配，不能自行判定完成、权限、mutation、验证或资格。
2. **修缺陷类，不修截图**：复现当前路径后必须审计 sibling entrypoint、状态流、工具/协议边界、持久化、恢复和 UI 投影；重复逻辑应收口为服务、契约或静态 guard。
3. **覆盖完整软件生命周期**：意图、需求、外部边界、设计、实现、编译测试、恢复结算、发布、文档和资格都必须有明确输入、输出、authority 与证据。
4. **最小原子 capability**：每轮只提升一个可独立验收的 capability 或关闭一个失败类别；不得用“大重构完成”代替逐项退出证据。
5. **先 evidence，后 claim**：原始工具结果、变更、验证、artifact 和运行事实先进入不可变证据，再由独立规则派生结论。模型自述和 Markdown 不能成为事实源。
6. **deterministic 不等于 live/qualification**：unit、replay、Headless、同机签名、本地 CAS 和 Phase 全绿只证明对应本地范围；不能外推真实 UI、Provider 稳定或资格等级。
7. **未知默认 fail closed**：未知事件、命令、副作用、权限、Schema 版本、资格字段、环境或恢复状态不得隐式通过；产品可显式 fail-soft，但资格聚合必须把证据缺口视为 veto/不可聚合。
8. **禁止平行 owner 与长期双轨**：不得通过新 loop、fallback、case 特判或 feature flag 长期保留两套 writer/verifier/settlement。迁移期旧 API 只能无语义委托，并有删除门禁。
9. **用户权限与外部动作分离**：只读调查、workspace mutation、终端/MCP、网络、账号、发布和破坏性操作分层授权；模型不能扩大用户授权。
10. **比较可观察行为，不臆测内部**：对标 Codex/Claude 时记录任务契约、上下文发现、工具执行、变更边界、验证恢复和交付体验；结论必须落到 DevSeek 的 owner、contract、测试和删除项。
11. **失败事实粘性**：后续成功不能覆盖旧失败；解除 adverse state 必须有新的 committed effect、matching verification、quality gate 和显式 recovery 因果链。
12. **发布身份是实现的一部分**：Extension/Bridge 行为改变后，compile、package、packaged Bridge verify、hash、local install 和 installed identity 缺一不可。

## 2. 生命周期质量标准与 Definition of Done

每个阶段都必须回答七个问题：输入是什么、输出是什么、谁拥有语义、机器门是什么、攻击反例是什么、是否需要真实 UI、何时停止/回退。

| 阶段 | 输入与输出 | 唯一 authority | 机器门与攻击反例 | 真实 UI / 停止回退 |
| --- | --- | --- | --- | --- |
| 意图识别 | 输入为用户原文、会话修订和项目规则；输出版本化 TaskContract，不是自由文本标签 | TaskContract builder/merger | 中英文否定、作用域、后续更正、resume/destructive 反例；未知歧义必须提问或 blocked | 简单任务可无 UI；目标/禁止项冲突立即停止写入 |
| 需求分析 | 输入 TaskContract 与证据；输出 objectives、deliverables、constraints、acceptance、applicability | Requirement Contract authority | 每个验收项可执行；禁止固定领域关键词、固定文档数、把“只读源码”扩大成“不写报告” | 关键选择会改变结果时请求用户；不得自行扩需求 |
| 外部边界发现 | 输入用户路径和规则；输出 repo root、入口、依赖、构建/发布、账号/网络/法规边界 EvidenceRefs | Context Discovery service | AGENTS/CLAUDE、构建文件、调用者/注册点、workspace 边界缺失测试；路径逃逸/大目录扫描反例 | 网络/账号/外部系统前必须授权；边界未知时 fail closed |
| 软件设计 | 输入需求与 context graph；输出 ADR/ChangePlan、authority、状态迁移、删除项和验证设计 | Architecture Decision authority | 单 owner、依赖方向、故障模型、幂等/恢复、跨平台；平行 loop/双写/Surface 业务规则为硬失败 | 重大架构取舍超出范围时请求确认；否则按最小设计执行 |
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

1. 从 [14](14-未完成事项与后续整体迭代计划.md) 或机器 capability DAG 只选一个原子 ID。
2. 写明用户结果、semantic authority、输入/输出 contract、依赖、非目标、删除项和退出证据。
3. 固定 branch、commit、dirty state、package/installed identity；先确认现有用户改动。
4. 用 Codex/Claude 同类可观察行为描述差距，但只转化为 DevSeek 的 contract/owner/test，不复制提示词。

### 3.2 最小实现与兄弟审计

1. 先构造最小 failing replay/attack。
2. 修改拥有事实的最小 authority，不在 Surface/Provider 临时补逻辑。
3. 定向检查 sibling entrypoint、state transition、persistence、recovery、protocol、UI 和 legacy migration。
4. 合并重复实现，添加静态 reachability/import/mutation guard；删除被替代路径。
5. 如果同类失败再次出现，必须提高 abstraction、Schema 或 guard 层级，不允许添加第三个样例分支。

### 3.3 验证、复审、提交与发布

```text
focused unit/property/schema attacks
  → affected package compile/typecheck/test
  → captured replay/headless/architecture/generated drift
  → independent adversarial review (P0=0, P1=0)
  → Phase 0–12
  → tracked docs 12–16 + README + machine SSOT
  → staged boundary/diff review
  → one reviewed implementation commit
  → Phase 0–12 from that clean commit
  → compile/package/exact VSIX
  → packaged Bridge verify + SHA-256
  → local install + installed identity
  → dynamic receipt + final handoff identities
```

任一阶段失败就回到最近的 authority 修复，不通过“先打包看看”、重跑成功覆盖失败、忽略 suite 或降低标准继续。tracked 文档必须在 source commit 前完成；post-commit package/install 只记录动态回执、Phase 报告和最终交付身份，不为回填自引用 commit/VSIX hash 再创建一个混合提交。真实 Provider/UI/holdout 只有在 profile、候选、计划、账号条款和用户授权同时满足时执行。

### 3.4 每轮作业卡

```text
atomic_capability_or_defect_class:
user_outcome:
baseline_commit_and_dirty_state:
semantic_authority:
contract_and_schema:
sibling_entrypoints:
minimal_failing_evidence:
minimal_change_and_deleted_path:
focused_gates:
full_gates:
adversarial_review:
commit_identity:
vsix_bridge_hash_installed_identity:
live_or_manual_not_run_reason:
qualification_scope_and_claim:
new_p2_backlog:
stop_or_next_atomic_id:
```

## 4. Skills 规划原则

这里的 Skill 不是一段“让模型表现更好”的 prompt。一个可进入 DevSeek 的 Skill 必须是：

> 版本化输入/输出契约 + semantic authority 适配 + 权限/副作用声明 + evidence schema + deterministic/replay/攻击测试 + applicability/profile + 可审计发布身份。

Skill 不能：自行写盘、绕过 permission、自己宣称 task complete、隐藏工具原始输出、把 Provider 特例写入 Kernel、用自然语言输出替代 Schema，或把本地 pass 外推成资格。

状态词：`candidate-design` 表示只完成规划；`implemented` 必须有代码和测试；`wired` 还要求真实声明入口不可绕过接线；L 级只来自有效精确 qualification claim。本文所有候选当前均为 `candidate-design`，不得因表格存在改写机器 ledger。

## 5. 候选 Skills 矩阵

| Candidate Skill | Purpose / Input → Output | Authority 与 side effects | Evidence / Schema / tests | 依赖 | 当前状态 / 优先级 |
| --- | --- | --- | --- | --- | --- |
| Requirement Contract | 把用户原文、修订、规则转成 objectives/deliverables/constraints/acceptance/applicability | TaskContract authority；纯计算，无副作用 | versioned contract；否定/作用域/跨轮/歧义 property tests | ContextRef、conversation revision | `candidate-design` / P0，Gate 0 后 R1-A |
| Context Discovery | 从用户路径发现 repo、规则、构建、入口、依赖和外部边界 | Discovery port；默认只读，网络需授权 | EvidenceRef graph；path/symlink/large-tree/missing-rule tests | Requirement Contract、filesystem policy | `candidate-design` / P1，R2 |
| Evidence & Provenance | 把文件、命令、工具、版本和 artifact 原始事实规范化为不可变引用 | EvidenceStore authority；采集默认只读，执行动作仍经对应 authority | EvidenceRef/provenance schema；hash/read-back/stale/version/tamper tests | Run identity、Context、工具 adapters | `candidate-design` / P0，R1-A |
| Architecture Decision | 生成最小 ADR/ChangePlan、owner、状态、风险、删除项 | Design authority；无直接写盘 | ADR schema、dependency/owner/lifecycle checks、parallel-owner attacks | Requirement + Context | `candidate-design` / P1，R2 |
| Code Implementation | 从 ChangePlan 与源码证据生成最小 ChangeSet，并保持项目约束和集成点 | Implementation planner；不能直接落盘，写入只经 Mutation authority | ChangeSet/symbol-impact schema；compile、scope、sibling、generated/handwritten boundary tests | Requirement、Context、Architecture、Evidence、Mutation | `candidate-design` / P0，R1-B/R2 |
| Workspace Mutation | 把 write/edit/delete/mkdir/move/undo 归一为可恢复 change transaction | 唯一 Mutation authority；高影响本地副作用 | ChangeSet/receipt；CAS/ABA/dirty/symlink/ENOSPC/rollback tests | Permission、Evidence、RunContext | `candidate-design` / P0，R1-B |
| Permission & SideEffect | 分类 command/MCP/network/terminal/workspace effect 并记录授权生命周期 | 唯一 Permission/Effect authority；可触发外部副作用 | operation schema/receipt；deny-before-call/idempotency/unknown-mutable/secret attacks | TaskContract、RunContext | `candidate-design` / P0，R1-B |
| Validation Planning | 从 acceptance 和工程入口选择最小有效验证并逐层扩展 | Validation Planner；执行委托受控 runner | VerificationPlan/result；missing-command/weak-oracle/GUI/manual tests | Requirement、Context、Permission | `candidate-design` / P0，R1-C |
| Failure Diagnosis & Repair | 将失败分类、定位最小根因并生成有界 repair plan | Diagnosis authority；修复写入仍经 Mutation | Diagnosis/RepairContract；sticky failure/repeat/no-progress/correlation tests | Evidence、Validation、Settlement | `candidate-design` / P0，R1-C |
| Review | 将 contract、diff、证据和验证结果转成按严重级别排序的独立缺陷结论 | Review authority；默认只读，无修复写入权 | ReviewFinding schema；P0/P1、false-positive、sibling/bypass、reviewer-independence tests | Requirement、Architecture、Evidence、Validation | `candidate-design` / P0，所有实现批次 |
| Recovery & Checkpoint | 从 adverse event、checkpoint 和 durable receipts 规划有界 resume/repair/compensation | Recovery authority；恢复 effect 仍经 Permission/Mutation | checkpoint/recovery schema；crash、retry、ABA、stale checkpoint、fake recovery tests | Run Evidence、Mutation、Validation、Permission | `candidate-design` / P0，R1-C |
| Settlement & Completion | 依据完整事件和验收证据产生唯一 completed/failed/blocked/waiting terminal | 唯一 Settlement authority；无业务副作用，只封存事实 | settlement/seal schema；exactly-one terminal、pending/adverse/degraded、duplicate owner attacks | Requirement、Evidence、Validation、Recovery、RunContext | `candidate-design` / P0，R1-A/R1-C |
| Release | 从冻结 commit 构建、验证、hash、安装并核对 identity | Release pipeline；本地 package/install，远端发布另授权 | ArtifactManifest；reproducibility/Bridge/auth/hash/installed identity tests | Full verification、Git clean state | `candidate-design` / P0，当前流程先实现为脚本 authority |
| Handoff | 从 Git/SSOT/测试/artifact 生成无聊天接管包 | Documentation owner；只写批准 docs/generated views | Handoff schema；link/drift/placeholder/stale-baseline tests | Release evidence、Backlog | `candidate-design` / P1；15 是人工协议，不是已实现 Skill |
| Qualification Evidence | 预注册、收集、独立复算精确 tuple claim | 独立 qualification authority；可触发获授权 live | G0-B/C schema；signature/denominator/veto/retention/scope attacks | protected policy/roles/WORM/time/runner | `candidate-design` / Gate 0；现有协议组件不等于完整 Skill wired |

可追加但不应先于以上核心 Skills 的候选：Collaboration/Subagent、Long-term Memory 和 UI Progress Projection。它们必须复用同一 TaskContract、Evidence、Permission、Mutation、Validation 与 Settlement，不得产生新的 owner。

## 6. Skill 实施与晋级门禁

每个 Skill 必须逐级取得以下证据：

1. **Design**：purpose、applicability、input/output Schema、authority、权限、副作用、错误模型和依赖明确。
2. **Implemented**：纯核心/adapter 存在，unknown/default fail closed，unit/property/attack 测试通过。
3. **Wired**：所有声明入口 reachability=100%、bypass=0，旧入口删除或无语义委托。
4. **Surface verified**：VS Code/CLI 等声明 Surface 使用同一 contract，replay 与真实 UI 事实一致。
5. **Qualified**：冻结 candidate 按受保护 profile 产生精确 tuple claim；不得跨 Surface/Provider/platform 外推。

任何 Skill 只能请求它声明的权限；副作用发生前必须有 durable operation identity 和 authorization，发生后必须有 terminal receipt。Skill 组合由 Kernel 调度，不能互相直接改 completion 或 qualification 状态。

## 7. 新模型执行与输出契约

新 Codex、Claude 或其他模型接管时：

1. 先执行 [15](15-新窗口与跨模型接管手册.md) 的唯一阅读顺序和 dynamic baseline。
2. 只选择一个 atomic capability/defect class，先说明 authority、范围、非目标和退出门。
3. 输出区分 `repository fact`、`test evidence`、`inference`、`proposal`；外部竞品事实需要官方公开来源。
4. 不因模型更换重写已有设计、重复跑 live、清理 dirty worktree或改变 qualification state。
5. 工具输出只保留必要证据，遵守 AGENTS 的定向搜索和小输出要求。
6. 最终交付顺序固定为：结果、改动、测试/复审、commit/artifact identity、未运行/风险、资格边界、下一原子任务或暂停。

禁止项：

- 不用 prompt 特判代替契约/authority；
- 不让 Skill、Surface、Provider、UI 或模型文本自行结算；
- 不把 mock、replay、Phase、同机签名、本地安装称为 live/qualification；
- 不删除失败、补跑覆盖、改变分母、降低 profile 或跨 scope 合并 claim；
- 不在未获授权时登录、触网、消耗 Provider、发布、push 或修改外部基础设施；
- 不在共享 dirty worktree 上执行破坏性 Git 操作；
- 不在 Gate 0 PASS 前开始 R1，也不因路线图写完而称产品完成。

## 8. 与现有审计包的分工

- 01/07：回答旧需求、架构和回退问题如何形成；
- 02：提供 Codex/Claude 公开可观察能力对标及事实来源；
- 03：给出目标软件架构；
- 04/05/06：给出 capability DAG、黄金旅程、资格与机器治理；
- 08/09：给出最短路线和反证结果；
- [14](14-未完成事项与后续整体迭代计划.md)：维护未完成 backlog 和批次依赖；
- [15](15-新窗口与跨模型接管手册.md)：维护当前动态接管点；
- 本文：维护跨批次不变的工程原则、DoD 和 Skills 候选标准。

当三者冲突时：机器 SSOT/实际证据优先；15 的当前动态任务优先于 14 的后续选择；14 的依赖顺序优先于本文的通用模板。任何冲突都必须显式登记，不得靠模型静默解释。
