# DevSeek 顶级编程智能体收敛审计与目标架构

- 审计日期：2026-07-11
- 实施检查点：2026-07-12，G0-A/G0-B/G0-C/G0-D 已形成机器治理、签名资格协议、本地 Manifest/聚合和统一产品运行证据纵切；Core/Surface 独立复审均为 P0=0、P1=0，全部仍为零 qualification claim
- 审计基线：`591a266`
- 状态：Gate 0 未通过、未运行 live；当前只能闭合真实 runner、独立 trust/retention 与精确 tuple 资格缺口，R1 禁止开始

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
- TaskContract、权限、工具、mutation、验证、完成和 UI 事实仍有多个 owner。
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
| [14-未完成事项与后续整体迭代计划.md](14-未完成事项与后续整体迭代计划.md) | README 与 01～16 的完成度真值矩阵、统一 backlog、依赖 DAG、分批验收和停止/回滚条件 |
| [15-新窗口与跨模型接管手册.md](15-新窗口与跨模型接管手册.md) | 无聊天上下文接管的唯一阅读顺序、dirty 边界、条件原子任务与 commit/Phase/VSIX/installed identity 动态回执契约 |
| [16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md](16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md) | 模型无关的不可违反原则、全生命周期 DoD、固定收敛作业模板与候选 Skills 矩阵 |

新窗口或跨模型接管必须按 `AGENTS → README → 15 → 动态 Git/制品基线 → 14 → 16 → 12 → 13 → 11 → 10 → 机器 SSOT` 的唯一顺序执行。需要理解架构与历史原因时再读 `01～09、ARCH-18`，其中 ARCH-18 仅作历史资料。

## 4. 决策边界

### 4.1 立即停止

- 为单个正式项目样例继续增加领域正则或提示词特判。
- 新增与既有循环并行的 simple、deterministic、fallback 或 Surface 编排路径。
- 把 static grep、mock Provider 或预写正确工具调用视为产品稳定资格。
- 在未冻结候选版本时反复消耗真实 Provider 配额。
- 在核心基础编程纵切尚未稳定前继续扩张高级能力面。

### 4.2 当前只允许开始

- 按 [15](15-新窗口与跨模型接管手册.md) 动态核对本轮 containing commit、matching Phase、VSIX/Bridge 和 installed identity；任一不成立时只恢复 `CLOSE-INTEGRATION`。
- 仅当上述集成身份全部成立时，才执行 `G0-RUNNER-WIRING`：闭合声明 qualification runner 的全入口接线和旁路守卫；随后再做 Active Baseline/文档迁移并准备逐节点 Gate 0 profile 的可执行证据。
- 申请并接入独立 protected policy、非测试职责分离身份、外部 WORM/anchor/trusted time 和必要账号/条款授权；外部 authority 缺失时保持 blocked，不以本地 fixture 替代。
- 冻结候选后只按签名 plan 执行 Gate 0 所需 deterministic/replay/Surface/获授权 live，并由受保护 Manifest 和机器 Gate 裁决七个精确 claim tuple。

附件降为 Context、单一 `start/dispatch`、workspace mutation/external effect authority 和 D-G01～D-G03 cutover 都属于 **Gate 0 PASS 后**的 R1-A～D；当前不得因这些目标已经写入 03/08 而提前开始。

### 4.3 最终晋级条件

唯一可执行口径在 [05 第 10 节](05-黄金用户旅程与正式项目资格方案.md#10-唯一正式晋级协议)，机器可读 SSOT 在 [06](06-能力追踪与文档治理方案.md)。简述：C0 Gate 0 先达 wired/L2，适用 C1～C13 产品能力 P0/P1 再按精确 `profile/scope/Surface/Provider/platform` claim tuple 达 L4；C14 只消费这些结果，不参与自己的前置集合。冻结候选后才跑预注册且 append-only 的 live 配额；`3/2/1` 只是 RC smoke，不是“顶级”资格或统计稳定性证明。

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
