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
- active selector: `docs/process/devseek-active-baseline-selector.json` sha256=`869219726bd2b5e23a4b03ec7d9b6ea58fb02efb4903ca6672de2bbac7cb0332`
- legacy inventory: `docs/process/devseek-legacy-doc-inventory.json` sha256=`2327cd8aa27ae51114b2d0fd7471134591ff71e1776b807bc271b999f1494fe8`
- governed documents: `53`; active baselines: `3`; legacy/reference: `50`
- status view: `docs/process/generated/devseek-doc-governance-status.md`
- Gate 0 / claims effect: `NONE`; this generated status does not assert qualification.
<!-- DEVSEEK-GOVERNANCE-STATUS:END -->

- 本次复核日期：2026-08-03
- Git 基线：`3331a74994b42c2cbc6f3cac9a5987da609d68d1`
- 复核原则：文档声明只作索引；结论以 `docs/process` 机器源、实际代码可达性、当前工作树和本轮重跑验证为准

## 1. 本次结论

**最开始的最终目的尚未达成。**

文档包已经完成诊断、对标、目标架构和资格方法设计，C0 本地可证地基也已接线。但“单一 Coding Kernel 物理收敛、C1～C13 按证据晋级、真实用户路线和密封 holdout 资格”仍未完成，因此当前不能宣称 DevSeek 已达到顶级编程智能体目标。

| 原始目的 | 当前判定 | 主要证据 |
| --- | --- | --- |
| 找出简单编程随功能增加而回退的根因 | `已完成` | 01、07、09 已形成多入口、多 owner、证据与完成权分裂的反证结论 |
| 建立 Codex / Claude Code / DevSeek 可核验对标 | `已完成文档责任` | 02 和官方来源清单；竞品版本变化后仍需重新核验 |
| 定义单一执行内核与完整生命周期 | `已完成设计` | 03、04、08 已定义目标、能力 DAG 和里程碑 |
| 建立机器账本、证据协议和 fail-closed 裁决 | `本地实现完成，未取得资格` | C0 `7/7 wired`；Gate 0 local conformance `PASSED`；claims `0` |
| 将 VS Code、CLI、Headless 切到同一 Coding Kernel | `未完成` | `extension.ts` 仍直接调用 `runAgenticLoop` 和 `runAgentLoop`；CLI 仍有独立执行编排 |
| 让 C1～C13 产品能力达到可声明等级 | `未完成` | 能力账本中 C1～C14 共 69 项仍全部为 `proposed`，无 qualification claim |
| 完成正式项目、真实 Provider 与 holdout 顶级资格 | `未完成` | Gate 0 `NOT_PASSED`，6 个外部 authority blocker，R1 qualification `NOT_STARTED` |

## 2. 当前机器事实

| 范围 | 2026-08-03 观测 |
| --- | --- |
| Capability ledger | 76 项能力、15 个域；C0 7 项全部 `wired`；C1～C14 69 项全部 `proposed`；claims=0 |
| Gate 0 | local conformance `PASSED`；implementation `7/7`；repository blocker `0`；external blocker `6`；最终 `NOT_PASSED` |
| Qualification runner | 19 个入口；1 个本地非资格 runner、10 个 catalog fixture、4 个 production disabled、4 个 historical disabled |
| R4 | 6 个原始 leaf 中 5 个 completed；`R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME` 为 `BLOCKED` |
| Candidate artifact | `3331a74` 的 VSIX 与 stable install 哈希一致，smoke `passed`；observe `failed`，不具资格效力 |
| Post-R4 local track | NP-05/06/07 本地 manifest 检查通过，覆盖 16 个 source、17/17 anchors、8 个 local-only command；该组变更尚未提交 |
| Surface inventory | 87 个入口分母无未知、重复或待 cutover 项；在途 `package.json` 脚本变更造成 source hash drift，checker 未全绿 |
| Architecture budget | 防增量门禁通过，但仍有 7 个超目标热点；`agent-loop.ts` 2471 行、`extension.ts` 2061 行、WebView 5375 行 |

必须同时保留三个事实：

1. R1～R3 的大量产品侧原子卡确实有本地测试、发包和 controlled VSIX 回执，不能抹消这些实现进展。
2. 这些回执一直声明 `qualification_effect=NONE`，能力账本也没有将 C1～C13 提升为 `wired`，所以不能从“作业卡 PASS”推导“能力已完成”。
3. `14` 仍是 selector 指向的 active process baseline，但头部快照停在 2026-07-22，尾部已追加到 R3/R4；Post-R4 compact index 又把它作为 historical support。这是待修复的治理冲突。

## 3. 核心缺口

### 3.1 事实与交付未收口

- 工作树存在一组 Post-R4 未提交代码、Schema、检查器和生成物；局部检查通过不等于交付闭环。
- current-candidate identity 已指向 `3331a74` 安装包，R4 rollup/release manifest 仍绑定 `a034e5e`，机器源尚未在同一候选身份上对账。
- active runtime observe 仍失败。本轮没有新的窗口、Provider、安装或外部 authority 授权，不得自行解除该 blocker。

### 3.2 单内核仍是迁移态

- VS Code 组合根仍有两条可执行 loop，附件、意图或运行态仍可影响进入哪条路径。
- `local-execution-chat-runner` 仍可直接调用 legacy loop，CLI 也没有证明与 VS Code 共享完整 TaskContract、mutation、verification 和 completion owner。
- 架构门禁目前主要阻止热点继续变大，还没有证明旧 loop 已删除或不可达。

### 3.3 产品能力和资格尚未对齐

- C1～C13 的产品实现需逐项回填“实现 owner 可达、全入口接线、失败语义、测试证据”，再由账本判定 `proposed -> implemented -> wired`。
- Gate 0 缺少独立受保护 profile、aggregator、签名 evidence digest binding、WORM/retention、trusted time 和 7 个 exact claims。
- R4 真实用户路线、RC smoke 和 L6 holdout 未授权或未执行，不能用 deterministic 或 controlled fake Bridge 结果替代。

## 4. 达成目标的任务基线

### P0 统一当前事实

| ID | 任务 | 完成条件 |
| --- | --- | --- |
| `NOW-01` | 审查并独立提交现有 Post-R4 在途改动 | 边界明确；NP-05/06/07 manifest、NP-08/09/10 与实际源一致；无未解释 dirty file |
| `NOW-02` | 重生成 Surface inventory 及受影响机器源 | `verify:surface-entry-inventory` 无 drift；所有 generated view 与源一致 |
| `NOW-03` | 在 clean commit 上重跑 Phase 0-12 | 本地 gate 全绿；需外部或窗口授权的 gate 精确标为 `BLOCKED`，不伪造 PASS |
| `NOW-04` | 替换失真的 process baseline | 新的简短 active process baseline 由 selector 唯一指向；`14` 降为历史证据；compact index、banner 和 hash 全部对账 |
| `NOW-05` | 收口 candidate identity | 仅在 fresh 用户窗口/安装授权或 external clean receipt 下证明 exactly-one stable runtime，再重生成 R4 全链产物 |

### P1 完成单一 Coding Kernel 物理收敛

| ID | 任务 | 完成条件 |
| --- | --- | --- |
| `KERNEL-01` | 生成产品执行根与 semantic owner 可达性清单 | VS Code、CLI、Headless、Bridge 入口与 TaskContract/permission/tool/mutation/verification/completion owner 都有唯一可计算路由 |
| `KERNEL-02` | 将 AgentKernel/Application Service 变成唯一 `start/dispatch/resume/cancel` 边界 | Surface 只投影 command/event，不构造 completion 或直接调用 Provider/tool loop |
| `KERNEL-03` | 切除 VS Code 双 loop 和 local repair 旁路 | `extension.ts` 不再直接调用两个旧 loop；附件和任务大小只改变 Context/Budget |
| `KERNEL-04` | 将 CLI 迁入同一 Kernel | VS Code 与 CLI 的 create/modify/repair 产生等价领域事件、mutation 和 completion evidence |
| `KERNEL-05` | 唯一化 mutation、external effect 和 completion | persistent write 与可改源码命令走 transaction；外部副作用有 permission/idempotency/receipt；completion 只有一个领域 owner |
| `KERNEL-06` | 删除或封死 legacy owner | 旧 loop 产品入口不可达；静态 guard 阻止第二内核、Surface bypass 和重复 owner |

### P2 将产品进展转成能力证据

| ID | 任务 | 完成条件 |
| --- | --- | --- |
| `CAP-01` | 对 C1～C13 全部 65 项产品能力逐项反查 | 每项有 owner、入口可达性、失败/恢复语义、验证证据和真实 implementation state；不按历史卡名批量提升 |
| `CAP-02` | 补齐 P0 黄金旅程 | D-G01～D-G10 的写入、修改、运行、失败、权限拒绝、cancel/resume、CAS 冲突在共享 conformance suite 下通过 |
| `CAP-03` | 补齐 P1 软件工程能力 | 指令优先级、repo/symbol map、source grounding、设计影响、Provider normalization、review/delivery、memory/skills/hooks/MCP 分别有验收 profile |
| `CAP-04` | 完成 Surface 和平台矩阵 | VS Code/CLI/Headless 与 Linux/macOS/Windows/WSL 的适用边界和降级都有机器证据 |
| `CAP-05` | 与 Codex / Claude Code 做同题对标 | 同仓库、同任务契约、同允许工具和同评分标准；区分产品缺陷、Provider 局限和 infra 故障 |

### P3 完成正式资格

| ID | 任务 | 完成条件 |
| --- | --- | --- |
| `QUAL-01` | 由外部独立 authority 闭合 EXT-01～05 | protected profile/aggregator、职责分离签名、WORM/retention、trusted time/anchor 可验证 |
| `QUAL-02` | 冻结候选并执行 Gate 0 protected plan | 7 个 C0 exact tuple claim 有效，机器 decision 首次输出 `PASS` |
| `QUAL-03` | 按 profile 让 C1～C13 达 L4 | 每个 claim 精确绑定 profile/scope/Surface/Provider/platform/candidate，无 veto |
| `QUAL-04` | 执行自然 UI + real Provider RC smoke | 预注册 3/2/1，不重试直到通过；失败关闭候选；只声明 RC smoke |
| `QUAL-05` | 执行 disjoint sealed holdout 与独立盲评 | 满足重复、随机、置信下界、安全/恢复配额和无 veto 后，才声明精确作用域 L6 |

## 5. 本轮验证记录

| 验证 | 结果 |
| --- | --- |
| VS Code extension compile | `PASS` |
| VS Code extension full unit runner | `PASS` |
| Capability ledger | `PASS`，76 capabilities / 138 dependency edges |
| Gate 0 decision | checker `PASS`，决策仍为 `NOT_PASSED` |
| Post-R4 local regression manifest | `PASS`，6/6 checker tests |
| Post-R4 compact index | `PASS`，6/6 checker tests |
| R4 process aggregate | `PASS`，11 个产物、无 stale/missing view |
| Architecture drift budget | `PASS`，仍保留 7 个显式债务 |
| Surface inventory | `FAIL`，唯一错误为 `inventory:drift-from-sources` |
| Legacy doc inventory | `PASS`，4/4 tests；50 个 legacy 文档全覆盖，archive 明确排除 |
| Doc governance | `PASS`，4/4 tests；53 个受治理文档，机器清单哈希未变化 |
| Phase 0-12 | `FAIL`，29/31 passed；仅 `current-candidate-identity-probe` 与 `external-authority-readiness-audit` 失败 |

## 6. 归档与文档责任

本轮已将限定任务完成、机器事实已迁移、且不再作为当前生成器输入的文档移入 [archive/](archive/README.md)：

- 10 G0-A 机器能力账本实施报告
- 11 G0-B 签名资格协议实施报告
- 12 G0-D 统一运行证据账本实施报告
- 13 G0-C 资格证据清单与独立聚合协议实施报告
- 17 Gate 0 本地纵切集成和接管报告

原路径保留受治理跳转页，防止历史链接失效。`20-R3收尾与下一阶段任务.md` 仍被 R4 生成器按路径和哈希消费，暂不移动；先完成机器绑定迁移，再归档。

## 7. 文档导航

| 类别 | 文档 |
| --- | --- |
| 事实与反证 | [01](01-DevSeek现状与功能回退根因审计.md)、[07](07-原需求与架构设计正确性审计.md)、[09](09-文档自闭环反证审计报告.md) |
| 对标与目标架构 | [02](02-Codex-Claude-Code-DevSeek软件架构对比.md)、[03](03-顶级编程智能体目标软件架构.md)、[08](08-决策结论与最短收敛实施方案.md) |
| 能力、资格与治理 | [04](04-分能力专项迭代与收敛路线图.md)、[05](05-黄金用户旅程与正式项目资格方案.md)、[06](06-能力追踪与文档治理方案.md)、[16](16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md) |
| 历史 backlog 与接管 | [14](14-未完成事项与后续整体迭代计划.md)、[15](15-新窗口与跨模型接管手册.md)、[18](18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md)、[19](19-GPT5.5新窗口启动与授权指令.md)、[20](20-R3收尾与下一阶段任务.md) |
| 已归档实施报告 | [archive/README.md](archive/README.md) |

## 8. 执行边界

- 冻结新的旁路 loop、Surface 编排和针对单一样例的领域特判。
- deterministic、replay、mock Provider、controlled VSIX、安装或 Markdown 全绿都不能自行产生资格 claim。
- 未获 fresh 授权时，不关闭或重载用户窗口、不发送 Provider prompt、不安装 VSIX、不写外部 qualification ledger。
- 每张实现卡先对照 Codex 和 Claude Code 在同类问题上的可观察行为，再以 DevSeek 的单内核、可审计和 fail-closed 原则选择实现。
- 完成判断只消费当前 candidate 上的机器证据，不从旧聊天、旧作业卡或文档标题继承 PASS。

## 9. 对标来源与限制

Codex 与 Claude Code 的完整逐项来源在 [02](02-Codex-Claude-Code-DevSeek软件架构对比.md)。本包只记录官方公开行为，不推测闭源内部实现；页面、版本或适用范围变化后必须重新核验。
