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
- legacy inventory: `docs/process/devseek-legacy-doc-inventory.json` sha256=`f8460c7576e4c826787c0af6bc3941db242ea2d59e141658e51d0aa376159d70`
- governed documents: `44`; active baselines: `3`; legacy/reference: `41`
- status view: `docs/process/generated/devseek-doc-governance-status.md`
- Gate 0 / claims effect: `NONE`; this generated status does not assert qualification.
<!-- DEVSEEK-GOVERNANCE-STATUS:END -->

- 本次复核日期：2026-08-04
- 当前 Extension 行为候选与 R4 v2 冻结候选：`4f8a567`（Intent Semantic Contract 本地 v2 纵切）；原 `a034e5e` v1 清单保留为历史不可变候选
- 复核原则：文档声明只作索引；结论以 `docs/process` 机器源、实际代码可达性、当前工作树和本轮重跑验证为准

## 1. 本次结论

**最开始的最终目的尚未达成。**

文档包已经完成诊断、对标、目标架构和资格方法设计，C0 本地可证地基也已接线。VS Code 主要执行入口与 local repair 已收敛到统一的 `AgentKernelService` 应用边界，checkpoint 持久化职责已抽离，跨 Surface conformance contract 和当前失败基线也已固定；但“单一 Coding Kernel 物理收敛、CLI/Headless 同核、C1～C14 按证据晋级、真实用户路线和密封 holdout 资格”仍未完成，因此当前不能宣称 DevSeek 已达到顶级编程智能体目标。

| 原始目的 | 当前判定 | 主要证据 |
| --- | --- | --- |
| 找出简单编程随功能增加而回退的根因 | `已完成` | 01、07、09 已形成多入口、多 owner、证据与完成权分裂的反证结论 |
| 建立 Codex / Claude Code / DevSeek 可核验对标 | `已完成文档责任` | 02 和官方来源清单；竞品版本变化后仍需重新核验 |
| 定义单一执行内核与完整生命周期 | `已完成设计` | 03、04、08 已定义目标、能力 DAG 和里程碑 |
| 建立机器账本、证据协议和 fail-closed 裁决 | `本地实现完成，未取得资格` | C0 `7/7 wired`；Gate 0 local conformance `PASSED`；claims `0` |
| 将 VS Code、CLI、Headless 切到同一 Coding Kernel | `部分完成` | VS Code 主要入口与 local repair 已统一经 `AgentKernelService`；仅根部兼容适配器直接导入双 loop；物理合并和 CLI/Headless 同核仍待完成 |
| 让 C1～C14 产品能力达到可声明等级 | `未完成` | 能力账本中 C1～C14 共 69 项仍全部为 `proposed`，无 qualification claim |
| 完成正式项目、真实 Provider 与 holdout 顶级资格 | `未完成` | Gate 0 `NOT_PASSED`，6 个外部 authority blocker，R1 qualification `NOT_STARTED` |

## 2. 当前机器事实

| 范围 | 2026-08-04 观测 |
| --- | --- |
| Capability ledger | 76 项能力、15 个域；C0 7 项全部 `wired`；C1～C14 69 项全部 `proposed`；claims=0 |
| Gate 0 | local conformance `PASSED`；implementation `7/7`；repository blocker `0`；external blocker `6`；最终 `NOT_PASSED` |
| Qualification runner | 19 个入口；1 个本地非资格 runner、10 个 catalog fixture、4 个 production disabled、4 个 historical disabled |
| R4 | 6/6 原始 leaf completed，blocked=0；current artifact/install/runtime 与 v2 冻结候选精确绑定，stable runtime=1、window-sensitive leaf=0 |
| Frozen R4 candidate | 当前 `R4-RELEASE-CANDIDATE-MANIFEST/v2` 冻结 `4f8a567` VSIX；原 `a034e5e` v1 JSON/schema/view 以固定文件哈希归档为历史不可变候选；两者均无资格效力 |
| Current local development receipt | `4f8a567` VSIX 已编译、打包、校验 Bridge、安装并完成 current identity 11/11 与本地用户闭环；真实 DeepSeek 用例按前置条件跳过，不是 qualification receipt |
| Post-R4 local track | NP-05/06/07 manifest 已在 `5c32551` 提交；检查覆盖 16 个 source、17/17 anchors、8 个 local-only command，6/6 通过 |
| Surface inventory | 87 个入口分母全部 covered，无 unknown、重复或待 cutover；source hash 对账通过 |
| Architecture budget | 设计优先门禁通过，仍有 7 个明确债务热点；Extension 受控总量 2018 行；大小只作回退护栏，不替代职责、依赖和 owner 判定 |

必须同时保留三个事实：

1. R1～R3 的大量产品侧原子卡确实有本地测试、发包和 controlled VSIX 回执，不能抹消这些实现进展。
2. 这些回执一直声明 `qualification_effect=NONE`，能力账本也没有将 C1～C14 提升为 `wired`，所以不能从“作业卡 PASS”推导“能力已完成”。
3. 当前 process baseline 已由简短 `PLAN-当前收敛迭代计划.md` 唯一承接；14 号只保留历史回执并已归档，计划与日志责任不再混写。

## 3. 核心缺口

### 3.1 事实与交付状态

- Post-R4 NP-05/06/07、Coding Kernel 路由重构和 20 号文档归档均已分别提交，便于按责任边界审计。
- R4 v2 release manifest 已按显式授权冻结 `4f8a567`，并绑定具名 VSIX、current-candidate identity 与已提交验证回执；后续 `latest` 漂移不能静默改写该版本。
- 原 `a034e5e` v1 清单、schema 和可读视图已迁入版本化历史目录并受字节哈希守卫；active runtime observe 为 exactly-one stable runtime，R4 6/6 leaf 已完成。
- 外部资格前置满足后执行一次 headed DeepSeek 路径的操作授权已收到；受保护 profile、独立身份/签名、WORM/retention、trusted time/anchor 等前置未满足，因此真实路径仍未执行。

### 3.2 单内核仍是迁移态

- VS Code 主要入口、free explore、planned task 和 local repair 已只向 `AgentKernelService` 提交具名 request；Surface 不再直接导入两个旧 loop。
- 根部 `ProductCodingKernelExecutor` 仍是双 loop 的兼容适配器；这实现了单一应用入口，但还不是单一物理执行内核。
- CLI/Headless 尚未证明与 VS Code 共享完整 TaskContract、mutation、verification 和 completion owner；旧 loop 也尚未删除。

### 3.3 产品能力和资格尚未对齐

- C1～C14 的产品实现需逐项回填“实现 owner 可达、全入口接线、失败语义、测试证据”，再由账本判定 `proposed -> implemented -> wired`。
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
| `NOW-02` | `完成` | 重生成 Surface inventory 及受影响机器源 | 87/87 covered；无 drift；generated view 与源一致 |
| `NOW-03` | `完成` | 在 current identity 刷新后重跑 Phase 0-12 | 32/32 gate 通过；deterministic=`passed`；real CLI/plugin Provider 均为 `not-run`，不产生资格效力 |
| `NOW-04` | `完成` | 替换失真的 process baseline | 当前 PLAN 由 selector 唯一指向；14 降为历史归档；计划不再承载执行日志 |
| `NOW-05` | `完成` | 收口 candidate identity | v2 清单冻结 `4f8a567`；current artifact/install/runtime 精确一致；clean-runtime completed；`a034e5e` v1 按字节归档且不可变 |
| `NOW-06` | `完成` | 收敛本地 Intent Semantic Contract owner | v2 contract、destructive/execution-mode policy、Provider candidate governor 为唯一语义边界；下游重复词表删除并受回归守卫 |

### P1 完成单一 Coding Kernel 物理收敛

| ID | 任务 | 完成条件 |
| --- | --- | --- |
| `KERNEL-01` | 生成产品执行根与 semantic owner 可达性清单 | VS Code、CLI、Headless、Bridge 入口与 TaskContract/permission/tool/mutation/verification/completion owner 都有唯一可计算路由 |
| `KERNEL-02` | 将 AgentKernel/Application Service 变成唯一 `start/dispatch/resume/cancel` 边界 | 已统一主要执行 request；仍需统一 resume/cancel/event 与 CLI/Headless，Surface 只投影 command/event |
| `KERNEL-03` | 切除 VS Code 双 loop 和 local repair 旁路 | `已完成本轮范围`：`extension.ts` 和 local repair 不再直接调用两个旧 loop；静态 guard 防回退 |
| `KERNEL-04` | 将 CLI 迁入同一 Kernel | VS Code 与 CLI 的 create/modify/repair 产生等价领域事件、mutation 和 completion evidence |
| `KERNEL-05` | 唯一化 mutation、external effect 和 completion | persistent write 与可改源码命令走 transaction；外部副作用有 permission/idempotency/receipt；completion 只有一个领域 owner |
| `KERNEL-06` | 删除或封死 legacy owner | 旧 loop 产品入口不可达；静态 guard 阻止第二内核、Surface bypass 和重复 owner |

### P2 将产品进展转成能力证据

| ID | 任务 | 完成条件 |
| --- | --- | --- |
| `CAP-01` | 对 C1～C14 全部 69 项产品能力逐项反查 | 每项有 owner、入口可达性、失败/恢复语义、验证证据和真实 implementation state；不按历史卡名批量提升 |
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
| VS Code extension full unit runner | `PASS`，158/158 suites |
| Intent/routing focused matrix | `PASS`，524/524；否定 external-effect 与 duplicate-owner 反例受保护 |
| Natural intent UI corpus | `PASS`，48/48，12 类任务各 4 条自然输入 |
| Shared / CLI conformance baseline | `PASS`，shared 247/247 tests、CLI 52/52 tests；5 个 development fixture 和 fail-closed partial projection 已覆盖 |
| Kernel/checkpoint focused unit | `PASS`，20/20 tests |
| 受影响 architecture static suites | `PASS`，325/325 tests |
| Workspace TypeScript `--noEmit` audit | `PASS`，既存 extension 类型债务已清零 |
| Capability ledger | `PASS`，76 capabilities / 138 dependency edges |
| Gate 0 decision | checker `PASS`，决策仍为 `NOT_PASSED` |
| External authority readiness | `PASS`，10/10 请求均保持精确 blocker 与可执行下一授权动作；approved=0、local-unblockable=0、live runs=0 |
| R4 versioned candidate manifest | `PASS`，v2 冻结 `4f8a567`；v1 `a034e5e` JSON/schema/view 与两份 VSIX 字节哈希受守卫 |
| R4 iteration rollup | `PASS`，6/6 completed、0 blocked；clean-runtime=`COMPLETED`；qualification effect=`NONE` |
| Post-R4 local regression manifest | `PASS`，6/6 checker tests |
| Post-R4 compact index | `PASS`，6/6 checker tests |
| R4 process aggregate | `PASS`，11 个产物、无 stale/missing view |
| Architecture drift budget | `PASS`，仍保留 7 个显式债务 |
| Surface inventory | `PASS`，12/12 checker tests；87/87 covered，unknown=0 |
| Legacy doc inventory | `PASS`，5/5 tests；41 个 legacy 文档全覆盖，archive 明确排除，root duplicate=0 |
| Doc governance | `PASS`，4/4 tests；44 个受治理文档，3 个 active baseline、41 个 legacy/reference |
| VSIX release loop | `PASS`，`1.0.0-debug.20260804.t093020.g4f8a567`；SHA256 `68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc`；Bridge 校验、本地安装和 exactly-one runtime identity 通过 |
| 本地用户闭环 | `PASS`，8 个 static/local create/modify/multiturn/repair/multi-file 场景；3 个 real DeepSeek 场景因资格前置未满足而显式跳过 |
| Current candidate identity | `PASS`，11/11；stable=1、stale/unknown/unreadable=0；qualification effect=`NONE` |
| Phase 0-12 | `PASS`，32/32；run id `2026-08-04T03-14-57-152Z`；Gate 0 仍为 `NOT_PASSED` |

受控 T3 使用真实已安装 VSIX、隔离 Extension Host 与确定性 fake Bridge，并通过测试专用消息和程序化 intent approval 驱动。它不是自然 UI、real Provider、RC smoke、T4/T5 或 qualification 证据，`qualification_effect=NONE`。

## 6. 归档与文档责任

本轮已将限定任务完成、机器事实已迁移、且不再作为当前生成器输入的文档移入 [archive/](archive/README.md)：

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

10～15、17～20 的根目录副本已彻底删除，`archive/` 是这些完成文档的唯一正文位置。第 19、20 号文档的 R4 对账与 release/rollup/compact-index 机器绑定也已同步迁入 `archive/`。当前状态和下一任务由 [PLAN-当前收敛迭代计划.md](PLAN-当前收敛迭代计划.md) 唯一接管，该计划不收录日志。

其余 01～09、16 仍承担当前审计、目标架构、能力验收或工程规范责任；对应产品目标尚未全部落地，因此不因“文档已写完”而归档。

## 7. 文档导航

| 类别 | 文档 |
| --- | --- |
| 事实与反证 | [01](01-DevSeek现状与功能回退根因审计.md)、[07](07-原需求与架构设计正确性审计.md)、[09](09-文档自闭环反证审计报告.md) |
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
