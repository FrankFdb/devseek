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
- active selector: `docs/process/devseek-active-baseline-selector.json` sha256=`7a2148a0e46e6305f7ba220749908974b3bf3f6970a19069b1b56f3e8c46f8c9`
- legacy inventory: `docs/process/devseek-legacy-doc-inventory.json` sha256=`6aaa11bc64d6166da5f62ea6727f1f4f64ec76feaecc919589d31f51575ae0cc`
- governed documents: `43`; active baselines: `3`; legacy/reference: `40`
- status view: `docs/process/generated/devseek-doc-governance-status.md`
- Gate 0 / claims effect: `NONE`; this generated status does not assert qualification.
<!-- DEVSEEK-GOVERNANCE-STATUS:END -->

- 本次复核日期：2026-08-07
- Extension 身份规则：当前开发候选以每轮 release loop 生成的 source/artifact/install/runtime 精确回执为准；`de2768c` 是上一稳定候选，R4 v2 冻结候选仍为 `4f8a567`，原 `a034e5e` v1 清单仍是历史不可变候选，三者不得互相覆盖身份或资格效力
- 复核原则：文档声明只作索引；结论以 `docs/process` 机器源、实际代码可达性、当前工作树和本轮重跑验证为准

## 1. 本次结论

**最开始的最终目的尚未达成。**

文档包已经完成诊断、对标、目标架构和资格方法设计，C0 本地可证地基也已接线。VS Code、CLI、Headless 已共用 canonical Coding Kernel 与 20 个收敛语义域，五类场景的真实工作区产品路径也已通过跨 Surface 联合验收；C1～C14 已有 17 项 `wired`，另有 tool execution、workspace mutation、external effect 和 resume idempotency 4 项为 `implemented`。其余 48 项能力、完整长任务路线和密封 holdout 资格尚未完成，因此当前不能宣称 DevSeek 已达到顶级编程智能体目标。

| 原始目的 | 当前判定 | 主要证据 |
| --- | --- | --- |
| 找出简单编程随功能增加而回退的根因 | `已完成` | 01、07、09 已形成多入口、多 owner、证据与完成权分裂的反证结论 |
| 建立 Codex / Claude Code / DevSeek 可核验对标 | `已完成文档责任` | 02 和官方来源清单；竞品版本变化后仍需重新核验 |
| 定义单一执行内核与完整生命周期 | `已完成设计` | 03、04、08 已定义目标、能力 DAG 和里程碑 |
| 建立机器账本、证据协议和 fail-closed 裁决 | `本地实现完成，未取得资格` | C0 `7/7 wired`；Gate 0 local conformance `PASSED`；claims `0` |
| 将 VS Code、CLI、Headless 切到同一 Coding Kernel | `本地产品责任已完成` | 三 Surface 共用 canonical Kernel、TaskContract、Tool、Mutation、Verification、Completion；五类真实工作区产品场景联合等价，legacy execution owner=0 |
| 让 C1～C14 产品能力达到可声明等级 | `进行中` | 69 项中 17 项已 `wired`，4 项为 `implemented`，其余 48 项为 `proposed`；C7 permission/sandbox 已接线，无 qualification claim |
| 完成正式项目、真实 Provider 与 holdout 顶级资格 | `未完成` | Gate 0 `NOT_PASSED`，6 个外部 authority blocker，R1 qualification `NOT_STARTED` |

## 2. 当前机器事实

| 范围 | 2026-08-07 观测 |
| --- | --- |
| Capability ledger | 76 项能力、15 个域；共 24 项 `wired`、4 项 `implemented`、48 项 `proposed`；其中 C1～C14 为 17/69 `wired`、4/69 `implemented`；claims=0 |
| Gate 0 | local conformance `PASSED`；implementation `7/7`；repository blocker `0`；external blocker `6`；最终 `NOT_PASSED` |
| Qualification runner | 19 个入口；1 个本地非资格 runner、10 个 catalog fixture、4 个 production disabled、4 个 historical disabled |
| R4 | 6/6 原始 leaf completed，blocked=0；冻结时 artifact/install/runtime 与 v2 候选精确绑定，stable runtime=1、window-sensitive leaf=0；当前开发候选另由 current identity 管理 |
| Frozen R4 candidate | 当前 `R4-RELEASE-CANDIDATE-MANIFEST/v2` 冻结 `4f8a567` VSIX；原 `a034e5e` v1 JSON/schema/view 以固定文件哈希归档为历史不可变候选；两者均无资格效力 |
| Current local development receipt | `379efbd` 精确 VSIX 的五场景 VS Code 产品路径继续作为历史稳定回执；I10 的 5 个 memory/checkpoint、I11 的 4 个 context/resume 与 I12 的 6 个 effect/authority 增量案例均在本地保留原始 TAP，不进入 Git。当前精确 VSIX 身份以本轮 release loop 为准，不改写 `4f8a567` 冻结候选，也不是 qualification receipt |
| Post-R4 local track | NP-05/06/07 manifest 已在 `5c32551` 提交；检查覆盖 16 个 source、17/17 anchors、8 个 local-only command，6/6 通过 |
| Surface inventory | 88 个入口分母全部 covered，无 unknown、重复或待 cutover；source hash 对账通过 |
| Architecture budget | 设计优先门禁通过，仍有 6 个明确债务热点；`extension.ts` 为 1679/1683 行；大小只作回退护栏，不替代职责、依赖和 owner 判定 |

必须同时保留三个事实：

1. R1～R3 的大量产品侧原子卡确实有本地测试、发包和 controlled VSIX 回执，不能抹消这些实现进展。
2. 这些回执一直声明 `qualification_effect=NONE`；能力账本只将具备 owner、产品接线和机器证据的 17 项 C1～C14 能力提升为 `wired`，另有 4 项保持 `implemented`，不能从“作业卡 PASS”批量推导其余能力已完成。
3. 当前 process baseline 已由简短 `PLAN-当前收敛迭代计划.md` 唯一承接；14 号只保留历史回执并已归档，计划与日志责任不再混写。

## 3. 核心缺口

### 3.1 事实与交付状态

- Post-R4 NP-05/06/07、Coding Kernel 路由重构，以及 01、20 号文档归档均按责任边界独立提交。
- R4 v2 release manifest 已按显式授权冻结 `4f8a567`，并绑定具名 VSIX、current-candidate identity 与已提交验证回执；后续 `latest` 漂移不能静默改写该版本。
- 原 `a034e5e` v1 清单、schema 和可读视图已迁入版本化历史目录并受字节哈希守卫；active runtime observe 为 exactly-one stable runtime，R4 6/6 leaf 已完成。
- 外部资格前置满足后执行一次 headed DeepSeek 路径的操作授权已收到；受保护 profile、独立身份/签名、WORM/retention、trusted time/anchor 等前置未满足，因此真实路径仍未执行。

### 3.2 单内核本地产品责任已完成

- VS Code、CLI、Headless 产品入口只向 shared `CanonicalCodingKernel` 提交版本化 request；Surface 不再拥有第二套完成、mutation 或 verification 语义。
- Orientation、TaskContract、EngineeringOrientation、CodebaseExploration、ContextGraph、ContextProvenance、InstructionPrecedence、RunLifecycle、AgentCommand、Settlement、SurfaceAdapter、Tool、Mutation、Verification、Completion、RunEvidenceRetention、MemoryPolicy、Checkpoint、ContextCompaction、ResumeIdempotency 20 个语义域均由 shared 单一 owner 裁决，legacy execution owner 已删除或封死。
- 在确认生产可达性为零后，旧 `agent-loop.ts`、只服务该 executor 的 16 个传递模块、旧 UI 最终授权 owner，以及零生产引用的 `llm-agent-loop.ts` 均已物理删除；对应专属测试同步删除，静态架构守卫禁止重新导入。
- Surface 现在只能提交 deny/allow/require-confirmation 约束和真实确认引用；最终 authority receipt 只由 Kernel session 签发，并绑定 action、effect、sandbox 与输入摘要，获批后的参数替换在宿主调用前 fail closed。
- canonical lifecycle 在三 Surface 保留 accepted/running/terminal 事实，blocked/cancelled 不再降格为 failed；同一生命周期由共享 retention port 写入 owner ledger 并随 Surface 终态封存。
- create、modify、repair、permission-denied、policy-refusal 已在三 Surface 的真实工作区产品路径完成联合比较；该结果只关闭本地产品契约责任，不产生资格声明。

### 3.3 产品能力和资格尚未对齐

- C1～C14 尚未 `wired` 的 52 项（4 项 `implemented`、48 项 `proposed`）需逐项回填“实现 owner 可达、全入口接线、失败语义、测试证据”，再由账本判定 `proposed -> implemented -> wired`。
- Gate 0 缺少独立受保护 profile、aggregator、签名 evidence digest binding、WORM/retention、trusted time 和 7 个 exact claims。
- R4 headed 真实用户路线已获得“外部资格前置满足后执行一次并保留窗口/页面”的条件授权；前置尚未满足，RC smoke 和 L6 holdout 均未执行，不能用 deterministic 或 controlled fake Bridge 结果替代。

### 3.4 迭代代码实现准则

1. 先明确行为契约和唯一 semantic owner，再按单一职责抽取内聚服务；依赖只能朝领域/应用边界收敛，接口只暴露调用方需要的能力。
2. 重构必须携带对应测试、失败与恢复语义，并审计同类入口是否仍可旁路；旧 owner 应删除或降为无语义兼容适配器。
3. 文件行数和预算只用于发现职责膨胀及阻止回退，不是优化目标。禁止通过删除有效说明、压缩格式、空壳封装或按行数机械拆分来制造“变小”。
4. 只有在命名职责、依赖方向、测试归属和旧 owner 处置都清楚时，才下调大小预算。最终判断看设计内聚度、可替换性、可测试性和行为证据。

该准则已写入仓库级 `AGENTS.md`、`docs/process/TOP_AGENT_CHANGE_GATE.md`、16 号迭代原则文档以及机器可检查的 architecture budget policy。

## 4. 达成目标的任务基线

### P0 统一当前事实

| ID | 状态 | 任务 | 完成条件 |
| --- | --- | --- | --- |
| `NOW-01` | `完成` | 审查并独立提交 Post-R4 改动 | `5c32551` 边界明确；NP-05/06/07 与实际源一致 |
| `NOW-02` | `完成` | 重生成 Surface inventory 及受影响机器源 | 88/88 covered；无 drift；generated view 与源一致 |
| `NOW-03` | `完成` | 在 current identity 刷新后重跑 Phase 0-12 | 32/32 gate 通过；deterministic=`passed`；real CLI/plugin Provider 均为 `not-run`，不产生资格效力 |
| `NOW-04` | `完成` | 替换失真的 process baseline | 当前 PLAN 由 selector 唯一指向；14 降为历史归档；计划不再承载执行日志 |
| `NOW-05` | `完成` | 收口 candidate identity | v2 清单冻结 `4f8a567`；冻结时 artifact/install/runtime 精确一致；clean-runtime completed；`a034e5e` v1 按字节归档且不可变 |
| `NOW-06` | `完成` | 收敛本地 Intent Semantic Contract owner | v2 contract、destructive/execution-mode policy、Provider candidate governor 为唯一语义边界；下游重复词表删除并受回归守卫 |

### P1 完成单一 Coding Kernel 物理收敛

| ID | 状态 | 任务 | 当前完成事实 |
| --- | --- | --- | --- |
| `KERNEL-01` | `完成` | 生成产品执行根与 semantic owner 可达性清单 | 88 个 Surface 入口全覆盖；TaskContract、RunLifecycle、Tool、Mutation、Verification、Completion、RunEvidenceRetention 均有唯一可计算 owner |
| `KERNEL-02` | `完成` | 将 AgentKernel/Application Service 变成唯一产品执行边界 | fresh、checkpoint、local repair 与三 Surface 产品 request 均进入 shared canonical Kernel；Surface 只适配宿主能力和投影事件 |
| `KERNEL-03` | `完成` | 切除 VS Code 双 loop 和 local repair 旁路 | `extension.ts` 和 local repair 不再直连旧 loop；静态 guard 防止回退 |
| `KERNEL-04` | `完成` | 将 CLI 与 Headless 迁入同一 Kernel | VS Code、CLI、Headless 的五类真实工作区场景产生等价 TaskContract、tool、mutation、verification 和 completion 语义 |
| `KERNEL-05` | `完成` | 唯一化 mutation、external effect 和 completion | persistent write 走 canonical transaction；外部 effect 有 authority/idempotency/receipt；completion 只有 shared 单一 owner |
| `KERNEL-06` | `完成` | 删除或封死 legacy owner | legacy execution owner=0；静态 guard 阻止第二内核、Surface bypass 和重复 owner |

### P2 将产品进展转成能力证据

| ID | 任务 | 完成条件 |
| --- | --- | --- |
| `CAP-01` | 对 C1～C14 尚未 `wired` 的 52 项产品能力逐项反查 | 每项有 owner、入口可达性、失败/恢复语义、验证证据和真实 implementation state；不按历史卡名批量提升 |
| `CAP-02` | 补齐 P0 黄金旅程 | D-G01～D-G10 的写入、修改、运行、失败、权限拒绝、cancel/resume、CAS 冲突在共享 conformance suite 下通过 |
| `CAP-03` | 补齐 P1 软件工程能力 | 指令优先级、repo/symbol map、source grounding、设计影响、Provider normalization、review/delivery、memory/skills/hooks/MCP 分别有验收 profile |
| `CAP-04` | 完成 Surface 和平台矩阵 | VS Code/CLI/Headless 与 Linux/macOS/Windows/WSL 的适用边界和降级都有机器证据 |
| `CAP-05` | 与 Codex / Claude Code 做同题对标 | 同仓库、同任务契约、同允许工具和同评分标准；区分产品缺陷、Provider 局限和 infra 故障 |

### P3 完成正式资格

| ID | 任务 | 完成条件 |
| --- | --- | --- |
| `QUAL-01` | 由外部独立 authority 闭合 EXT-01～05 | protected profile/aggregator、职责分离签名、WORM/retention、trusted time/anchor 可验证 |
| `QUAL-02` | 冻结候选并执行 Gate 0 protected plan | 7 个 C0 exact tuple claim 有效，机器 decision 首次输出 `PASS` |
| `QUAL-03` | 按 profile 让 C1～C14 达 L4 | 每个 claim 精确绑定 profile/scope/Surface/Provider/platform/candidate，无 veto |
| `QUAL-04` | 执行自然 UI + real Provider RC smoke | 预注册 3/2/1，不重试直到通过；失败关闭候选；只声明 RC smoke |
| `QUAL-05` | 执行 disjoint sealed holdout 与独立盲评 | 满足重复、随机、置信下界、安全/恢复配额和无 veto 后，才声明精确作用域 L6 |

## 5. 本轮验证记录

| 验证 | 结果 |
| --- | --- |
| VS Code extension compile | `PASS` |
| VS Code extension full unit runner | `PASS`，164/164 suites |
| Intent / Surface permission focused suites | `PASS`，52/52；未分类 terminal、否定 external-effect 与 duplicate-owner 反例受保护 |
| Natural intent UI corpus | `PASS`，48/48，12 类任务各 4 条自然输入 |
| Shared / CLI / Headless regression | `PASS`，Shared 342/342 tests、CLI 72/72 tests、Headless 23/23 tests |
| I10 增量用户仿真 | `PASS`，memory/checkpoint 5/5；版本化场景位于 `scripts/test/fixtures/user-simulations/i10-memory-checkpoint.json`，fixture SHA、逐例原始 TAP 与汇总仅在本地 `code/devseek-tests/memory-checkpoint/runs/i10-local-20260806-g379efbd/` 保留，不进入 Git；固定五场景不计作本轮增量 |
| I11 增量用户仿真 | `PASS`，context/resume 4/4；版本化场景位于 `scripts/test/fixtures/user-simulations/i11-context-resume.json`，三次连续压缩、VS Code 密封收据、completed effect 跳过和 indeterminate effect 阻断均使用独立 case；原始 TAP 仅在本地 `code/devseek-tests/context-resume/runs/i11-context-resume-20260806/` 保留 |
| I12 增量用户仿真 | `PASS`，effect/authority 6/6；版本化场景位于 `scripts/test/fixtures/user-simulations/i12-effect-authority.json`，fixture SHA256=`52c84a7b111b289745fab2aaedb950bdf90f3e51876c9de98e16b7f2768aeb85`；分别验证只读越权拒绝、Surface 字段和非当前 session receipt 伪造拒绝、授权输入替换拒绝、对账后远程变更仅执行一次、真实回执驱动 resume 跳过、completed resume receipt 拒绝替换后的 operation；原始 TAP 仅在本地 `code/devseek-tests/effect-authority/runs/i12-session-authority-final-20260807/` 保留，不进入 Git |
| Kernel owner convergence baseline | `PASS`，v21、108/108 source checks、20 semantic domains converged、missing Surface=0 |
| Lifecycle focused/static suites | `PASS`；blocked 保真、flush 异常、证据保留与职责防绕过均覆盖 |
| Workspace TypeScript `--noEmit` audit | `PASS`，既存 extension 类型债务已清零 |
| Capability ledger | `PASS`，76 capabilities / 138 dependency edges；24 `wired`、4 `implemented`、48 `proposed`、claims=0 |
| Gate 0 decision | checker `PASS`，决策仍为 `NOT_PASSED` |
| External authority readiness | `PASS`，10/10 请求均保持精确 blocker 与可执行下一授权动作；approved=0、local-unblockable=0、live runs=0 |
| R4 versioned candidate manifest | `PASS`，v2 冻结 `4f8a567`；v1 `a034e5e` JSON/schema/view 与两份 VSIX 字节哈希受守卫 |
| R4 iteration rollup | `PASS`，6/6 completed、0 blocked；clean-runtime=`COMPLETED`；qualification effect=`NONE` |
| Post-R4 local regression manifest | `PASS`，6/6 checker tests |
| Post-R4 compact index | `PASS`，6/6 checker tests |
| R4 process aggregate | `PASS`，11 个产物、无 stale/missing view |
| Architecture drift budget | `PASS`，仍保留 6 个显式债务 |
| Surface inventory | `PASS`，12/12 checker tests；88/88 covered，unknown=0 |
| Legacy doc inventory | `PASS`，5/5 tests；40 个 legacy 文档全覆盖，archive 明确排除，root duplicate=0 |
| Doc governance | `PASS`，4/4 tests；43 个受治理文档，3 个 active baseline、40 个 legacy/reference |
| Surface product conformance | `PASS`，`379efbd` 精确 VSIX 的 VS Code create/modify/repair/permission-denied/policy-refusal 5/5 通过，并与 CLI、Headless 形成 5/5 三 Surface product-route conformance；qualification eligible=false |
| Previous stable VSIX receipt | `PASS`，`1.0.0-debug.20260806.t180307.gde2768c`；SHA256 `56e617798efd161b37ac99d1d30f8bd63ca36a0e2350625633046310498b77f7`；该回执是本轮 release loop 前的回退基线，不冒充当前源码候选 |
| Candidate identity rule | 当前 source/artifact/install/runtime 必须由同一轮 release loop 精确绑定；禁止从上一稳定 `de2768c` 或 R4 冻结候选继承当前候选 PASS |
| 本地用户闭环 | `PASS`，精确已安装 VSIX 的受控普通用户路径与五场景产品路径通过；Bridge 为 `session-missing`，real DeepSeek 因资格前置未满足而未执行 |
| R4 frozen candidate identity | `PASS`，11/11；冻结验证时 stable=1、stale/unknown/unreadable=0；qualification effect=`NONE` |
| Phase 0-12 | `PASS`，32/32；run id `2026-08-06T10-05-12-844Z`；前置失败 run `2026-08-06T09-03-17-068Z`、`2026-08-06T09-25-42-512Z`、`2026-08-06T09-31-50-408Z` 均保留诊断；Gate 0 仍为 `NOT_PASSED` |

受控 T3 使用真实已安装 VSIX、隔离 Extension Host 与确定性 fake Bridge，并通过测试专用消息和程序化 intent approval 驱动。它不是自然 UI、real Provider、RC smoke、T4/T5 或 qualification 证据，`qualification_effect=NONE`。

## 6. 归档与文档责任

本轮已将限定任务完成、机器事实已迁移、且不再作为当前生成器输入的文档移入 [archive/](archive/README.md)：

- 01 现状、功能回退根因与单内核收敛方向审计
- 10 G0-A 机器能力账本实施报告
- 11 G0-B 签名资格协议实施报告
- 12 G0-D 统一运行证据账本实施报告
- 13 G0-C 资格证据清单与独立聚合协议实施报告
- 14 历史 backlog、批次计划与执行回执
- 15 历史跨窗口接管与身份复算手册
- 17 Gate 0 本地纵切集成和接管报告
- 18 旧架构与历史实施计划承接矩阵
- 19 GPT-5.5 历史启动与授权文本
- 20 R3 收尾与 R4 启动交接回执

01、10～15、17～20 的根目录副本已彻底删除，`archive/` 是这些完成文档的唯一正文位置。第 19、20 号文档的 R4 对账与 release/rollup/compact-index 机器绑定也已同步迁入 `archive/`。当前状态和下一任务由 [PLAN-当前收敛迭代计划.md](PLAN-当前收敛迭代计划.md) 唯一接管，该计划不收录日志。

其余 02～09、16 仍承担当前对标、目标架构、能力验收、资格或工程规范责任；对应产品目标尚未全部落地，因此不因“文档已写完”而归档。

## 7. 文档导航

| 类别 | 文档 |
| --- | --- |
| 事实与反证 | [01（已归档）](archive/01-DevSeek现状与功能回退根因审计.md)、[07](07-原需求与架构设计正确性审计.md)、[09](09-文档自闭环反证审计报告.md) |
| 对标与目标架构 | [02](02-Codex-Claude-Code-DevSeek软件架构对比.md)、[03](03-顶级编程智能体目标软件架构.md)、[08](08-决策结论与最短收敛实施方案.md) |
| 能力、资格与治理 | [04](04-分能力专项迭代与收敛路线图.md)、[05](05-黄金用户旅程与正式项目资格方案.md)、[06](06-能力追踪与文档治理方案.md)、[16](16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md) |
| 当前计划 | [PLAN](PLAN-当前收敛迭代计划.md) |
| 历史 backlog 与接管 | [14](archive/14-未完成事项与后续整体迭代计划.md)、[15](archive/15-新窗口与跨模型接管手册.md)、[18](archive/18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md)、[19](archive/19-GPT5.5新窗口启动与授权指令.md) |
| 已归档实施报告 | [archive/README.md](archive/README.md) |

## 8. 执行边界

- 冻结新的旁路 loop、Surface 编排和针对单一样例的领域特判。
- deterministic、replay、mock Provider、controlled VSIX、安装或 Markdown 全绿都不能自行产生资格 claim。
- 未获 fresh 授权时，不关闭或重载用户窗口、不发送 Provider prompt、不安装 VSIX、不写外部 qualification ledger。
- 每张实现卡先对照 Codex 和 Claude Code 在同类问题上的可观察行为，再以 DevSeek 的单内核、可审计和 fail-closed 原则选择实现。
- 完成判断只消费当前 candidate 上的机器证据，不从旧聊天、旧作业卡或文档标题继承 PASS。

## 9. 对标来源与限制

Codex 与 Claude Code 的完整逐项来源在 [02](02-Codex-Claude-Code-DevSeek软件架构对比.md)。本包只记录官方公开行为，不推测闭源内部实现；页面、版本或适用范围变化后必须重新核验。
