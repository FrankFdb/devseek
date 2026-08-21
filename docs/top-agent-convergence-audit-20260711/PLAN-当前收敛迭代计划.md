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
- 当前停止点：`devseek-multi` @ `a47ffe37f01817d14358b0ef4040e885b7867c8f`，T1～T12 已完成本地产品收敛；最终已安装 VSIX 为 `2.0.32-debug.20260820.t172525.ga47ffe3`，SHA-256 为 `8386445523df3b550d9a9edda07e59b594cc3c766e2aecc0a367b9ef5084a854`。
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
| T1～T5 意图、流程、网页兼容、权限与记忆 | `completed` | `2.0.24` 全面 run 15/15 steps；63 个 targeted case、14 个 controlled suite 的 56 次用户流程（55 unique controlled），共 118 selected、94 required、43/43 设计维度，执行证据缺失 0 |
| T6 卡顿与资源回收 | `completed` | `2.0.29` 建立 Bridge/浏览器/extension-host 生命周期 owner；HTTP graceful shutdown 与 parent exit 仿真通过，无跨任务窗口泄漏 |
| T7～T8 类型、架构债务与效率 | `completed` | `2.0.30` 收敛 read-only/tool route 类型边界、session 调度和差异化仿真；architecture drift 保持 0 violation |
| T9～T10 Provider 证据与效率 | `completed` | `2.0.31` 建立 sampling/operation/attempt、字节和阶段耗时证据；低风险新建任务减少冗余复核，已有源码编辑仍独立 review；17 suites/60 cases 通过 |
| T11 真实 Provider 编程收敛 | `completed` | `2.0.32` 真实 DeepSeek Web 五文件 CLI 自测 16/16、独立 holdout 8/8；前一候选由 holdout 检出 2 类入口缺陷；最终 exact-VSIX 17/17 suites、60/60 cases，Extension 197/197 |
| T12 模型主导语义与动作回执 | `completed` | 原始 turn 直接进入主模型；只有结构化动作经 schema、scope、approval、sandbox 和 effect 仲裁后执行，完成只接受绑定动作的 canonical receipt。Shared 366/366、Bridge 42/42、CLI 84/84、Headless 25/25、Extension 174/174 suites、Phase10 和 architecture drift 通过 |
| C13 扩展边界 | `completed` | 唯一活跃项 MCP 已使用官方稳定 SDK；server launch 建立会话信任，只读封闭调用直接执行，高风险调用精确确认且 receipt 不可重放；其余未启用生态保持 conditional/experimental |
| 用户仿真 | `completed` | T11 保留 17 套 60 个不重复产品流程、真实 DeepSeek Web 中型编程任务和实现外独立 CLI holdout；T12 增补短问答、追问、错字、多语言、标识符子串、动作拒绝、失败恢复、steering、session/restart 和 todo/completion 一致性；成功与失败样本均保留 |
| C14 正式顶级资格 | `blocked_external` | Gate 0=`NOT_PASSED`，6 个外部 authority blocker、7 个 exact claims 尚未满足；RC、真实 Provider wave 与 sealed holdout 不得本地伪造 |
| 本轮 release loop | `completed` | `a47ffe3` 提交已推送；最终 VSIX 按提交身份重新打包、包内 Bridge HTTP 200、SHA-256 复算并覆盖安装，本地与远端分支一致 |
| C14 候选流程资产 | `pending_scope` | 当前 `devseek-r4-release-candidate-manifest.json` 仍绑定历史 `1.0.0`/`4f8a567` 候选，且明确 `qualification_eligible=false`；下一阶段必须为当前候选建立版本化后继，不能覆盖历史身份或把本地 manifest 当资格回执 |
| 文档治理 | `pending_scope` | 产品文档正文已更新；既有 legacy inventory 仍仅登记 31/60 份受治理文档，`verify:doc-governance` 保持历史 2/4，缺 29 条库存记录，未伪造回执掩盖 |

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
| 1 | 关闭 T12 本地候选 | `completed` | Codex/Claude 责任审计、模型动作合同、跨 Surface 仿真、全量门禁、一个提交、最终 VSIX 安装和一次 push 已完成 |
| 2 | N1 修复 legacy 文档库存 | `pending_scope` | 逐份核对 60 份受治理文档 provenance，把缺失 29 条真实记录加入 inventory；`verify:doc-governance` 达到 4/4，且不改变 Gate 0 结论 |
| 3 | N2 当前候选与 C14 流程身份对齐 | `pending_scope` | 核对 `a47ffe3`、远端、release-channel VSIX、Bridge、安装身份和所有 source bindings；通过受支持生成器建立版本化候选后继，历史 RC manifest 保持不可变 |
| 4 | N3 跨平台产品证据 | `pending_scope` | 当前机器事实只覆盖 `linux-x64-v1`；由 profile owner 明确新增平台后，在独立主机验证安装、路径/symlink、shell、权限、Bridge 生命周期、session/restart 和编译测试，失败按根因回流 |
| 5 | N4 真实 Provider reliability wave | `blocked_external` | 取得 `R4-LIVE-AUTH-01/02` 后，冻结候选和干净 runtime，执行多用户、多语言、中大型编程、长任务、网络中断、取消、steering、重启与恢复波次；保留完整运行证据和资源回收结果 |
| 6 | N5 受保护 profile 与 sealed holdout | `blocked_external` | 取得 `R4-LIVE-AUTH-03/04`；独立 owner 在候选冻结前封存与开发集不重叠的 case、retry budget、failure taxonomy 和证据策略，失败不得选择性补跑或改 case 适配实现 |
| 7 | N6 Gate 0 外部 authority 与资格导入 | `blocked_external` | `EXT-01`～`EXT-05` 提供受信 source registry、独立 attestation、protected policy、角色/密钥、WORM retention 与 trusted time；再由 `R4-LIVE-AUTH-05` 独立导入 exact claims |
| 8 | N7 发布裁决 | `blocked_external` | protected aggregator 对冻结 RC、真实 Provider wave、跨平台证据和 sealed holdout 做机器复算；只有 Gate 0=`PASSED` 且正式 release decision 允许时才能声明顶级资格 |
| 9 | 新的本地产品专题 | `pending_scope` | 只从 N3～N5 的新失败或新的独立用户证据建专题；一旦改代码，旧候选立即失效，按行为合同、semantic owner、根因修复、全回归和新 RC 重新开始 |
| 10 | 激活可选产品能力 | `pending_scope` | 仅当产品明确声明相应能力时，为单个 capability 建立 owner、权限、失败恢复、产品入口和独立验收；不作为 C14 逃生路径 |

## 下一阶段执行顺序

### N0 新对话只读核对

1. 先读取本文件、仓库根 `AGENTS.md`、T12 交接和 `UPSTREAM-AGENT-SOURCE-AUDIT-20260813.md`。
2. 复算当前 Git、远端和 VSIX 身份；已跟踪工作树应为 clean，39 份既有 `docs/testing/*.md` 未跟踪历史报告不要误提交。
3. 读取 Gate 0、qualification profile、R4 request packet、holdout matrix、external authority readiness audit；保持所有 `BLOCKED` 终态，不以本地写文件替代外部授权。
4. 不自动运行 `generate:* --write`、真实 Provider holdout 或 release 打包。先确认本轮只做 N1、N2，还是已经获得 N3～N6 所需环境和授权。

### N1 文档治理清账

- 逐条审计缺失的 29 个 legacy record，确认 `source_group`、`decision`、`relationship`、当前 active baseline 和 rationale；不能批量复制同一理由。
- 只使用 `docs/process/devseek-legacy-doc-inventory.schema.json` 允许的结构，并由治理生成器更新受管 front matter/status view。
- 验收：`npm run verify:doc-governance` 4/4、active selector 不分叉、Gate 0 与 qualification claim 数不变化。
- 该任务是治理清账，不应顺手修改智能体行为；发现正文错误时另建有 owner 的专题。

### N2 候选身份与本地资格协议预备

- 当前 debug VSIX 是 T12 本地验收制品，不是 protected RC。正式候选应使用 release channel，并在测试、提交、打包后绑定精确 commit、VSIX/Bridge digest、安装身份和 source binding。
- 审计 R4 manifest 生成器的 lineage/versioning；为 `a47ffe3` 或其后继 release commit 建新版本，禁止静默改写 `4f8a567`/`1.0.0` 历史候选。
- 本地可以验证协议/schema/fail-closed 行为，但结果仍须标记 `local-protocol-conformance`、`qualification_eligible=false`、`claims_permitted=false`。
- 建议聚焦门禁：`verify:current-candidate-identity`、`verify:r4-process-artifacts`、`verify:external-authority-readiness-audit`、`verify:qualification-protocol`、`verify:qualification-evidence-manifest`、`verify:qualification-runner`、`verify:gate0-decision`。不要为了变绿伪造外部签名、时间锚或 claim。

### N3～N5 独立环境与真实用户仿真

| 维度 | 必须覆盖 | 失败条件 |
| --- | --- | --- |
| 用户表达 | 新手短句、错别字/同音字、中文/英文/日文及混输、专家精确约束、模糊要求、中途纠正和撤销 | 依赖关键词格式、忽略最新约束、普通问答被项目上下文污染 |
| 任务规模 | 直接回答、只读 review、小修复、约千行中型程序、多文件大型任务、报告 artifact、已有测试失败后修复 | 任务类型/目标错误、只生成代码不验证、失败后口头宣称完成 |
| 生命周期 | 新会话、连续 steering、切换 session、回到任务、Extension Host/Bridge 重启、网络中断、取消、恢复 | 旧任务/旧权限复活、重复 effect、窗口或进程泄漏、无界重试 |
| 权限与 effect | workspace 新文件、源码修改、命令、依赖安装、外部目录、删除、commit/push、拒绝后的继续工作 | 模型文字自授权、拒绝被当成功、越界写入、effect receipt 不匹配 |
| 交付一致性 | 文件确认、全部保留/撤销、todo、编译/测试、readback、最终总结 | UI 无响应、todo 与验证矛盾、非零退出仍显示成功、成果不可运行 |
| Provider 可靠性 | 慢首包、半截 Markdown/JSON/XML、重复响应、网页验证、断流、恢复后继续 | 半截工具被执行、错误会话串线、等待无反馈、资源不回收 |
| 平台 | profile 明确批准的每个 OS/架构/VS Code 版本 | 用 Linux 结果外推其他平台，或路径/shell/权限差异未被发现 |
| 独立性 | 实现外 case author、冻结前 sealed、开发集 disjoint、统一 retry/failure taxonomy | 看实现后改答案、只保留成功样本、失败后选择性补跑覆盖 |

任何产品失败必须先保留原始 prompt、Provider transcript、run log、工具/权限/变更/验证 receipt、工作区前后状态和进程资源证据。随后定位 defect class 与唯一 owner；必要时重构并删除旧责任。修复会使当前 RC 与 holdout 结果全部失效，必须生成新候选并重新执行完整门禁。

### N6～N7 外部资格与发布

- Gate 0 当前有 6 个 external-authority blocker、7 个 exact claim 均未满足；仓库本地代码不能解除它们。
- 五个基础外部请求分别由 registry owner、独立安全 attestation、qualification policy、组织身份/密钥、外部存储/时间主体批准；五个 live 请求还需要用户窗口、clean runtime、holdout profile、trusted evidence 和独立 qualification import。
- 受保护 aggregator 必须校验 exact tuple、签名 purpose、source/profile digest、append-only/WORM retention、trusted non-rollback time、stream anchor 和独立角色分离。
- 任何缺失、签名不匹配、候选漂移、holdout 失败、跨平台失败或证据链断裂都保持 fail closed。只有机器 Gate 0 与独立 release decision 同时允许，才可更新发布声明。

## 对标与开发规则

1. 产品代码缺陷继续以本地 Codex 源码 `code/upstream-agent-sources/openai-codex` @ `fe614a6304ef804be74a622e482fdd75977abcba` 为主要实现基线，按责任映射而不是照搬 Rust；Claude Code 公开归档 @ `be90077c6a353f292fa612d97173865a9ab21b83` 只作为 hooks、权限和可观察行为补充。
2. 不把 Codex/Claude 的优秀确定性 parser、tool registry、approval 或 sandbox 误删为“关键词逻辑”；只禁止自然语言子串直接决定意图、权限、effect 或完成。
3. 代码修改遵循单一语义 owner、依赖方向和可测试边界；修复 defect class，审计 sibling Surface/状态流/协议/恢复/UI，不做 case patch。
4. 同一专题测试通过后一个提交、最后一次 push；不打 tag，除非用户另行明确要求。Extension/Bridge 变化必须 compile、package、校验 Bridge、安装 exact VSIX。
5. 外部 authority、sealed holdout、trusted time、WORM storage 和 qualification claim 不能由本地 fixture、自签测试 key、Markdown 结论或人工改 JSON 代替。

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
- Qualification profiles：`docs/process/devseek-qualification-profiles.json`
- 当前历史 RC manifest：`docs/process/devseek-r4-release-candidate-manifest.json`
- Live 授权请求：`docs/process/devseek-r4-live-qualification-request-packet.json`
- Holdout matrix：`docs/process/devseek-r4-live-user-way-holdout-matrix.json`
- 外部 authority readiness：`docs/process/devseek-external-authority-readiness-audit.json`
- 文档权威：`docs/process/devseek-active-baseline-selector.json`
- 历史回执：`archive/`

## 新对话启动提示

```text
请读取仓库根 AGENTS.md 和 docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md。T1～T12 已在 devseek-multi/a47ffe3 完成本地验收，下一阶段从 N0 只读核对开始，优先执行 N1 文档治理和 N2 当前候选/C14 流程身份对齐。不要重复旧仿真，不要把 debug VSIX 当 protected RC，不要执行未授权的 live/sealed holdout，也不要伪造 external authority 或 Gate 0 claim。产品缺陷继续以本地 Codex 源码为主基线、Claude Code 公开证据为辅，按设计原则修复 defect class。所有回复中文。
```
