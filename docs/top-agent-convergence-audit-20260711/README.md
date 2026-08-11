---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/top-agent-convergence-audit-20260711/README.md"
  source_group: "handoff"
  decision: "keep"
  relationship: "supporting-ref"
  active_baselines:
    - "docs/requirements/02-顶级编程智能体需求基线.md"
  machine_sources:
    active_selector: "docs/process/devseek-active-baseline-selector.json"
    legacy_inventory: "docs/process/devseek-legacy-doc-inventory.json"
  asserts_gate_pass: false
---

<!-- DEVSEEK-GOVERNANCE-BANNER:START -->
> [!NOTE]
> DevSeek governance: this document is `historical` with decision `keep` and relationship `supporting-ref`. Current authority: `docs/requirements/02-顶级编程智能体需求基线.md`. Machine source: `docs/process/devseek-legacy-doc-inventory.json`.
<!-- DEVSEEK-GOVERNANCE-BANNER:END -->

# DevSeek 顶级编程智能体收敛审计与目标架构

<!-- DEVSEEK-GOVERNANCE-STATUS:START -->
## Machine Governance Status

- generator: `devseek-doc-governance/v1`
- active selector: `docs/process/devseek-active-baseline-selector.json` sha256=`a313e81e91c0a7a0d8e1190c3b18d7b3e47ee3b642a155144544bd09db046ad3`
- legacy inventory: `docs/process/devseek-legacy-doc-inventory.json` sha256=`3b668b1c55ca02e63147e2e4b42095363d8fa4e9498f06568b58f8b1b3e526f8`
- governed documents: `34`; active baselines: `3`; legacy/reference: `31`
- status view: `docs/process/generated/devseek-doc-governance-status.md`
- Gate 0 / claims effect: `NONE`; this generated status does not assert qualification.
<!-- DEVSEEK-GOVERNANCE-STATUS:END -->

- 最近复核：2026-08-11
- 首要目标：以 Codex 和 Claude Code 的官方公开编程行为为主要对标，把 DevSeek 优化为顶级编程智能体；重点是理解、计划、编辑、测试、诊断、修复、复核和交付代码。
- 产品入口：默认使用无需 API Key 的免费 DeepSeek 网页；Provider、权限、MCP 和生态扩展只为编程闭环服务，不作为独立堆功能目标。
- 判断原则：文档只描述要求和边界；实现状态以 `docs/process` 机器源、生产可达代码和当前重跑证据为准。

## 当前结论

**本地适用的活跃产品能力已经完成收敛；最开始的正式顶级资格目标尚未证明。**

VS Code、CLI、Headless 已共用 canonical Coding Kernel。能力账本中的 58 个 `active` capability 全部为 `wired`；76 项总能力为 62 项 `wired`、14 项 `proposed`。剩余 14 项均属于未启用的 conditional/deferred/experimental 范围或 C14 外部资格，不应为了清空数字而强塞进 core-coding。

Gate 0 仍为 `NOT_PASSED`，qualification claims=0。受控测试、确定性 replay、VSIX 安装和本地用户仿真都不能替代真实 Provider、正式项目、受保护 RC 与 sealed holdout，因此当前不能宣称 DevSeek 已获得“顶级编程智能体”资格。

## 机器事实

| 范围 | 当前事实 |
| --- | --- |
| Capability ledger | 76 项：62 `wired`、14 `proposed`；58/58 active 全部 `wired`；claims=0 |
| Kernel owner baseline | v31；4 条活跃产品路由；55/55 shared 语义域；150/150 源码约束；legacy execution owner=0 |
| C6 | Provider、tool schema/dispatch/execution、capability negotiation、DeepSeek Web connector 共 6 个活跃项全部接线；visual computer use 为 conditional |
| C7 | permission、sandbox、mutation、external effect、secret、dirty worktree、platform conformance 共 7/7 |
| C11 | checkpoint、resume、cancel、steer、collaboration、accessibility 共 6 个活跃项全部接线；background automation 为 deferred |
| C13 | MCP 是唯一 active 项，使用官方稳定 SDK；用户批准 server session 后只读封闭调用直接执行，高风险调用仍精确确认且 receipt 不可重放 |
| 用户仿真 | I10～I23 共 72 个增量案例；每例绑定唯一 fixture/test；原始结果只保留在 Git 忽略目录 `code/devseek-tests/` |
| Gate 0 | local conformance=`PASSED`；external blocker=6；exact claims=0/7；最终 `NOT_PASSED` |

## 已完成的本地产品责任

- 单一 shared Kernel 统一 TaskContract、运行生命周期、工具、mutation、verification、completion、review 与交付语义；Surface 不再拥有第二套业务内核。
- Provider 能力声明、版本化 DeepSeek Web connector、request/stream correlation、取消、去重、有界重试和错误分类已有独立协议 owner。
- permission 与 sandbox 分层；workspace/external effect 使用可持久化 preparation/settlement、幂等对账和 fail-closed 恢复。
- secret redaction、dirty worktree 与 Linux platform adapter conformance 进入共享产品边界。
- cancel 先冻结新 effect，再对账 in-flight work 后结算；steering、协作和 accessibility 在三 Surface 使用共享语义与各自原生投影。
- MCP 使用 `@modelcontextprotocol/sdk` 稳定版；server launch 建立会话信任，只读封闭调用不重复打断编程，高风险调用仍需精确用户授权，所有 receipt 一次性且配置、参数、输出和错误均有界脱敏。
- 零生产调用、职责重复或违反当前设计边界的旧 agent enhancement、subagent contract 和 worktree conflict 原型及专属测试已删除。
- I21 connector/environment、I22 run collaboration、I23 MCP authority 是本轮新增用户旅程，不复用固定五场景冒充能力增量测试。

## 尚未完成的目标边界

1. **外部资格设施**：独立受保护 profile/aggregator、签名身份、WORM retention、trusted time/anchor 和 7 个 exact claims 仍需外部授权主体提供。
2. **真实资格路径**：只有资格前置完成后，才按已有条件授权执行一次 headed DeepSeek 真实用户路径，并保留 VS Code 窗口和 DeepSeek 页面。
3. **C14**：冻结候选上的 RC、真实 Provider 正式项目 wave、全新 disjoint sealed holdout 和 release decision 尚未执行。
4. **条件产品范围**：visual computer use、background automation、Skills、Hooks、Subagent、Worktree、Plugin、Peer、Headless SDK 等仅在产品明确启用时逐项实现和验收。

当前任务、依赖和完成条件只从 [PLAN-当前收敛迭代计划.md](PLAN-当前收敛迭代计划.md) 领取。PLAN 不保存执行日志；详细机器状态由 `docs/process` 维护。

## 实现准则

代码优化服务于顶级编程智能体行为目标，顺序固定为：行为契约、唯一 semantic owner、单一职责、依赖方向、接口隔离、可测试/可恢复边界，最后才是文件大小。

- 修复缺陷类别，审计 sibling entry points、状态流、工具/协议边界和恢复路径。
- 同一决策只允许一个 owner；重复逻辑应收敛为共享抽象，并增加防旁路测试。
- 旧代码不再承担生产职责时直接删除，不保留双轨补丁和空壳兼容层。
- 行数、diff 和复杂度只作回退护栏，不通过压缩格式、删说明或机械拆文件制造“优化”。
- 每项能力先核对 Codex/Claude Code 官方公开机制，再把可观察行为转成 DevSeek 可验证契约，不推测闭源内部实现。

## 文档责任

| 文档 | 当前责任 |
| --- | --- |
| [PLAN](PLAN-当前收敛迭代计划.md) | 唯一当前状态、下一任务、依赖和完成条件来源 |
| [README](README.md) | 审计入口、产品目标、资格边界和机器事实索引 |
| [archive](archive/README.md) | 01～20 历史对标、设计、实施、验收与交接证据 |

01～20 编号文档已完成各自的文档责任并完整移入 [archive/](archive/README.md)，根目录不保留同名尾页。外部 Gate 0、真实 Provider、RC 与 sealed holdout 仍由 PLAN 明确标记为 `blocked_external`；归档历史方案不等于这些资格任务已经完成。

## 事实来源

- `docs/process/devseek-capability-ledger.json`
- `docs/process/devseek-kernel-prep-owner-baseline.json`
- `docs/process/devseek-iteration-user-journeys.json`
- `docs/process/devseek-gate0-decision-report.json`
- `docs/process/devseek-active-baseline-selector.json`
- `docs/process/devseek-legacy-doc-inventory.json`
