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
- legacy inventory: `docs/process/devseek-legacy-doc-inventory.json` sha256=`91bece15aaa5d623fc7a08c87f9004c45be67c5cd10c196e09ca4d0c08beb339`
- governed documents: `52`; active baselines: `3`; legacy/reference: `49`
- status view: `docs/process/generated/devseek-doc-governance-status.md`
- Gate 0 / claims effect: `NONE`; this generated status does not assert qualification.
<!-- DEVSEEK-GOVERNANCE-STATUS:END -->

- 审计日期：2026-07-11
- 实施检查点：2026-07-12，G0-A/B/C/D、本地非资格 runner composition root、Gate 0 machine decision contract 与 exact-VSIX controlled harness 已形成；稳定安装包与制品一致，但用户窗口仍运行旧 debug Bridge，同窗口仿真为 `NOT_RUN`
- 审计基线：`591a266`
- 状态：Gate 0 `NOT_PASSED`、claims=0、R1 `NOT_STARTED`；当前机器报告为 5 个 repository blocker、6 个 external-authority blocker。下一窗口使用 GPT-5.5，当前工作包是 `CLOSE-INTEGRATION-GATE0-LOCAL`，首个可领取 leaf 是 `CLOSE-01-ACTIVE-RUNTIME-IDENTITY`

## 1. 文档包目的

本目录回答四个问题：

1. Codex 与 Claude Code 的官方公开能力实际体现了怎样的编程智能体工作方式？
2. DevSeek 的需求、目标架构和物理实现分别处于什么状态，为什么简单编程会随功能增加而回退？
3. DevSeek 应建设怎样的单一软件工程执行内核，而不是继续增加互相绕过的功能分支？
4. 如何把每项能力分别迭代到顶级，再用用户真实使用方式完成正式项目资格测试？

用户提出的“意图、需求、设计、实现、编译测试、发布”是重要示例，但不是固定六阶段。官方公开资料并未把 Codex 或 Claude Code 定义为瀑布式软件工厂：Claude Code 明示的是“获取上下文 → 采取行动 → 验证结果 → 根据反馈重复”，Codex 公开能力则覆盖分层项目指令、沙箱与审批、可复用 Skills、Subagents 和多种工程工作流。因此本文抽象出一套适用于 DevSeek 的完整软件工程闭环；它是基于公开机制形成的目标架构，不声称等同于竞品闭源内部实现。

## 2. 核心结论

DevSeek 的目标原则基本正确，但物理架构尚未收敛：

- 同一任务会因附件、入口和会话状态进入不同执行循环。
- VS Code 与 CLI 尚未消费同一个完整 Coding Kernel。
- TaskContract、意图识别、权限、工具、mutation、验证、完成和 UI 事实仍有多个 owner；任务形态、验证计划、终端策略和完成证据会重复理解用户原文，必须收敛到同一个版本化语义契约。
- deterministic 测试大量通过，但 legacy VS Code development observation buckets 仍为 `canary 0/3、medium 0/2、formal 0/1`；当前 qualification authority 为 none，因此不构成候选资格。
- 文档把“已设计、已编码、已接入、deterministic、Surface、live”混成了“完成”。
- 原设计不是全部错误：Headless/Surface/Provider/Evidence 方向应保留；模型完成权、多状态机、多格式写盘和错误安全边界必须废止。

下一阶段总方向：

> 冻结非本轮 P2/旁路式功能扩张；允许 C0、P0/P1、安全和可观测性所必需的建设。先建立一个可折叠阶段但不可替换内核的 Coding Kernel；按原子能力逐项取得资格，最后才进入正式项目测试。

## 3. 文档导航

| 文档 | 作用 |
| --- | --- |
| [01-DevSeek现状与功能回退根因审计.md](01-DevSeek现状与功能回退根因审计.md) | 需求、文档、代码、测试和 Git 历史的事实审计 |
| [02-Codex-Claude-Code-DevSeek软件架构对比.md](02-Codex-Claude-Code-DevSeek软件架构对比.md) | 按官方公开能力对比三方架构，并标出 DevSeek 差距 |
| [03-顶级编程智能体目标软件架构.md](03-顶级编程智能体目标软件架构.md) | DevSeek 目标组件、数据契约、状态机和完整生命周期 |
| [04-分能力专项迭代与收敛路线图.md](04-分能力专项迭代与收敛路线图.md) | C0 运行证据/评测地基、C1～C13 实现能力组、C14 综合资格，以及原子化、依赖和退出指标 |
| [05-黄金用户旅程与正式项目资格方案.md](05-黄金用户旅程与正式项目资格方案.md) | 行为测试阶梯、黄金集、真实配额和 holdout 正式项目方法 |
| [06-能力追踪与文档治理方案.md](06-能力追踪与文档治理方案.md) | SSOT、能力账本、状态定义、自动生成和漂移门禁 |
| [07-原需求与架构设计正确性审计.md](07-原需求与架构设计正确性审计.md) | 逐文件判断旧设计哪里正确、错误、过期或已被事实证伪 |
| [08-决策结论与最短收敛实施方案.md](08-决策结论与最短收敛实施方案.md) | 四个收敛里程碑、Gate 0 顺序和 Gate 0 后的 R1-KERNEL-DG01-03 工作包 |
| [09-文档自闭环反证审计报告.md](09-文档自闭环反证审计报告.md) | 对本包做事实、架构、可实现性、资格真实性和最少迭代的独立反证收口 |
| [10-G0-A机器能力账本实施与迭代计划.md](10-G0-A机器能力账本实施与迭代计划.md) | G0-A 实施证据、机器账本边界及 G0-B/D/C 闭环状态 |
| [11-G0-B签名资格协议实施报告.md](11-G0-B签名资格协议实施报告.md) | G0-B 签名计划/事件/receipt/guard 实施、攻击测试、能力状态与诚实限制 |
| [12-G0-D统一运行证据账本实施报告.md](12-G0-D统一运行证据账本实施报告.md) | G0-D 双 head/record 链、产品纵切、legacy migration、攻击测试与非资格边界 |
| [13-G0-C资格证据清单与独立聚合协议实施报告.md](13-G0-C资格证据清单与独立聚合协议实施报告.md) | G0-C Manifest/独立复算/retention 协议、攻击测试、零 claim 与 Gate 0 缺口 |
| [14-未完成事项与后续整体迭代计划.md](14-未完成事项与后续整体迭代计划.md) | README 与 01～18 真值、GPT-5.5 原子 backlog、依赖 DAG、验收与停止/回滚条件 |
| [15-新窗口与跨模型接管手册.md](15-新窗口与跨模型接管手册.md) | GPT-5.5 无聊天接管、动态 Git/Phase/VSIX/安装/用户窗口身份、首个原子作业卡与停止协议 |
| [16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md](16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md) | 不可违反原则、全生命周期 DoD、GPT-5.5 WIP=1 作业协议、产品与 workflow Skills 候选 |
| [17-Gate0本地纵切机器裁决用户窗口仿真与GPT5.5接管报告.md](17-Gate0本地纵切机器裁决用户窗口仿真与GPT5.5接管报告.md) | 本轮 runner/decision 架构、机器真值、exact-VSIX 与用户同窗口仿真边界、动态接管回执 |
| [18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md](18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md) | `docs/architecture` 01～18 与 ARCH-05 的保留/废止/atomic ID 承接，以及防止旧路线复活的规则 |
| [19-GPT5.5新窗口启动与授权指令.md](19-GPT5.5新窗口启动与授权指令.md) | 用户可直接复制给 GPT-5.5 的只读启动提示、动态回执字段与条件性 `CLOSE-01` 授权文本；不发卡、不继承授权 |

### 3.1 唯一人工执行基线

本目录现在是后续 DevSeek 迭代的唯一人工规划与执行包，但不是已经生效的机器 Active Baseline：`G0-01～03` 仍须实现 selector、legacy inventory 和生成式 banner/status。权威分工固定为：

- 15 复算动态身份并选择当前唯一卡；14 是唯一 backlog；16 约束每卡 DoD；17 保存本轮静态检查点；18 裁决旧文档承接；19 仅提供可复制启动文本。
- 01～09 是审计/对标/目标/资格规范，10～13 是历史实施证据；它们都不能直接发出作业卡。
- `docs/requirements` 与 `docs/architecture` 仅在 atomic card 明确引用时定向读取；其中所有“当前、下一轮、已完成、stable”必须先经过 18 和机器事实复核。
- 真正的机器事实来自 `docs/process` Schema、ledger、inventory、decision report 与 checker；06 只是治理设计规范。

GPT-5.5 新窗口固定按 `AGENTS → README → 15 → 14 → 16 → 18 → docs/process 机器事实 → 当前 atomic card 直接依赖` 执行。不得从旧聊天、ARCH-05 或 ARCH-18 的历史相对时序开始工作。

## 4. 决策边界

### 4.1 立即停止

- 为单个正式项目样例继续增加领域正则或提示词特判。
- 新增与既有循环并行的 simple、deterministic、fallback 或 Surface 编排路径。
- 把 static grep、mock Provider 或预写正确工具调用视为产品稳定资格。
- 在未冻结候选版本时反复消耗真实 Provider 配额。
- 在核心基础编程纵切尚未稳定前继续扩张高级能力面。

### 4.2 当前只允许开始

- 按 [15](15-新窗口与跨模型接管手册.md) 分别复算 handoff、implementation/Phase、artifact/stable install、active runtime 与用户窗口 receipt；短 SHA 必须先唯一解析。当前工作包是 `CLOSE-INTEGRATION-GATE0-LOCAL`，只领取其首个 leaf `CLOSE-01-ACTIVE-RUNTIME-IDENTITY`；需要用户窗口动作却未获新授权时以 `BLOCKED` 停止。
- 仅当上述集成关闭卡 `PASS` 后，GPT-5.5 才执行 `G0-01-ACTIVE-BASELINE-SELECTOR`；本地 runner slice 已实现但仍是 nonqualification，4 个 production entrypoints 保持 disabled。
- 申请并接入独立 protected policy、非测试职责分离身份、外部 WORM/anchor/trusted time 和必要账号/条款授权；外部 authority 缺失时保持 blocked，不以本地 fixture 替代。
- 冻结候选后只按签名 plan 执行 Gate 0 所需 deterministic/replay/Surface/获授权 live，并由受保护 Manifest 和机器 Gate 裁决七个精确 claim tuple。

附件降为 Context、单一 `start/dispatch`、workspace mutation/external effect authority 和 D-G01～D-G03 cutover 都属于 **Gate 0 PASS 后**的 R1-A～D；当前不得因这些目标已经写入 03/08 而提前开始。

### 4.3 最终晋级条件

唯一正式资格晋级协议在 [05 第 10 节](05-黄金用户旅程与正式项目资格方案.md#10-唯一正式晋级协议)，06 只定义治理方案，机器事实位于 `docs/process` 的 ledger/profile/inventory/decision report 与 checker。简述：C0 Gate 0 先达 wired/L2，适用 C1～C13 产品能力 P0/P1 再按精确 `profile/scope/Surface/Provider/platform` claim tuple 达 L4；C14 只消费这些结果，不参与自己的前置集合。冻结候选后才跑预注册且 append-only 的 live 配额；`3/2/1` 只是 RC smoke，不是“顶级”资格或统计稳定性证明。

## 5. 对标来源与限制

Codex 对标只使用 OpenAI 官方公开资料；以下为代表性入口，完整逐项来源在 02：

- [Codex use cases](https://developers.openai.com/codex/use-cases)
- [Custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [Sandboxing](https://developers.openai.com/codex/concepts/sandboxing)
- [Subagents](https://developers.openai.com/codex/subagents)
- [Skills](https://developers.openai.com/codex/skills)
- [Customization](https://learn.chatgpt.com/docs/customization/overview)
- [Plugins](https://learn.chatgpt.com/docs/plugins)
- [Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)

Claude Code 对标只使用 Anthropic 官方公开资料；以下为代表性入口：

- [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [Best practices](https://code.claude.com/docs/en/best-practices)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Memory and project instructions](https://code.claude.com/docs/en/memory)
- [Permissions and sandbox](https://code.claude.com/docs/en/permissions)
- [Agent teams](https://code.claude.com/docs/en/agent-teams)
- [Computer use](https://code.claude.com/docs/en/computer-use)

报告只记录访问日可核实的公开行为，不推测 Codex 或 Claude Code 的闭源内部类名、数据结构或实现代码；`documented/experimental/not assessed` 必须分栏，页面、版本或适用范围变化后重新核验。
