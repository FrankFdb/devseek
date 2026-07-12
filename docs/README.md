# DevSeek 文档索引

本目录按软件工程生命周期分类。2026-07-11 重新审计确认：既有需求和架构文档混合了正确原则、早期 MVP 历史方案、实施状态和已被事实证伪的结论；在完成状态迁移前，不能仅因文件列在“活跃文档”就视为当前正确 SSOT。

当前唯一人工规划与执行包是 [`top-agent-convergence-audit-20260711/`](top-agent-convergence-audit-20260711/)；旧文档只按该目录 18 的承接矩阵定向读取。机器 Active Baseline 仍待 G0-01～03，Gate 0、目标 Coding Kernel 和产品资格均未完成。

最后更新：2026-07-12

## 快速入口

每次开始 DevSeek 开发任务，优先读这几份：

| 文档 | 分类 | 用途 |
| --- | --- | --- |
| [top-agent-convergence-audit-20260711/README.md](top-agent-convergence-audit-20260711/README.md) | 当前决策包 | 审计结论、文档导航和决策边界 |
| [top-agent-convergence-audit-20260711/15-新窗口与跨模型接管手册.md](top-agent-convergence-audit-20260711/15-新窗口与跨模型接管手册.md) | 当前接管 | GPT-5.5 动态身份复算、当前唯一 leaf、授权与停止协议 |
| [top-agent-convergence-audit-20260711/14-未完成事项与后续整体迭代计划.md](top-agent-convergence-audit-20260711/14-未完成事项与后续整体迭代计划.md) | 唯一 backlog | Gate 0～R4/EXT 原子 leaf、依赖和验证条件 |
| [top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md](top-agent-convergence-audit-20260711/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md) | 执行规范 | 单 owner、WIP=1、生命周期 DoD、Skills 与 GPT-5.5 作业模板 |
| [top-agent-convergence-audit-20260711/18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md](top-agent-convergence-audit-20260711/18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md) | 旧文档承接 | ARCH-01～18/ARCH-05 的保留、废止和 atomic ID 映射 |
| [process/devseek-capability-ledger.json](process/devseek-capability-ledger.json) | 机器 SSOT | 76 项 capability、138 条 typed architecture edge、实现状态与精确资格 claim 容器 |
| [process/generated/r1-minimal-capability-manifest.md](process/generated/r1-minimal-capability-manifest.md) | 生成目标视图 | R1 的 45 项目标依赖闭包；只表示未来工作要求，不表示当前资格 |
| [top-agent-convergence-audit-20260711/08-决策结论与最短收敛实施方案.md](top-agent-convergence-audit-20260711/08-决策结论与最短收敛实施方案.md) | 历史战略路线 | 审计阶段形成的里程碑与顺序依据；不发放当前任务，实际 leaf 只由 14 发放 |
| [top-agent-convergence-audit-20260711/09-文档自闭环反证审计报告.md](top-agent-convergence-audit-20260711/09-文档自闭环反证审计报告.md) | 反证审计 | 本轮关键反例、已修正矛盾、残余风险和交付验收清单 |
| [top-agent-convergence-audit-20260711/02-Codex-Claude-Code-DevSeek软件架构对比.md](top-agent-convergence-audit-20260711/02-Codex-Claude-Code-DevSeek软件架构对比.md) | 对标/架构 | 官方公开能力对标、目标框图、逐模块判断和差距 |
| [top-agent-convergence-audit-20260711/03-顶级编程智能体目标软件架构.md](top-agent-convergence-audit-20260711/03-顶级编程智能体目标软件架构.md) | 目标架构 | 唯一 Coding Kernel、组件、契约、状态机和生命周期 |
| [top-agent-convergence-audit-20260711/04-分能力专项迭代与收敛路线图.md](top-agent-convergence-audit-20260711/04-分能力专项迭代与收敛路线图.md) | 能力路线 | C0 地基、C1～C13 实现域、C14 综合资格的原子晋级、指标和收敛波次 |
| [top-agent-convergence-audit-20260711/05-黄金用户旅程与正式项目资格方案.md](top-agent-convergence-audit-20260711/05-黄金用户旅程与正式项目资格方案.md) | 测试资格 | DeepSeek Web 测试审计、黄金旅程、live 配额和 holdout |
| [top-agent-convergence-audit-20260711/07-原需求与架构设计正确性审计.md](top-agent-convergence-audit-20260711/07-原需求与架构设计正确性审计.md) | 旧文档裁决 | 原设计正确、错误、过期和应撤销项的逐文件矩阵 |
| [process/devseek-gate0-decision-report.json](process/devseek-gate0-decision-report.json) 与 [top-agent-convergence-audit-20260711/17-Gate0本地纵切机器裁决用户窗口仿真与GPT5.5接管报告.md](top-agent-convergence-audit-20260711/17-Gate0本地纵切机器裁决用户窗口仿真与GPT5.5接管报告.md) | 当前机器裁决与最近集成快照 | 新窗口仍须按 15 从 Git、process 报告、最新 Phase、artifact/install/active runtime 复算；`npm run verify:phase0-12` 的 deterministic PASS 或 3/2/1 observation 均不等于产品资格 |
| [process/TOP_AGENT_CHANGE_GATE.md](process/TOP_AGENT_CHANGE_GATE.md) | 工程过程 | 每次变更前后的检查清单、DoD、最近变更记录 |
| [release/CHANGELOG.md](release/CHANGELOG.md) | 发布 | 版本和未发布变更记录 |

## 既有需求与架构文档（待状态迁移）

以下清单保留历史查阅入口，不再自动表示“当前已验证的活跃 SSOT”。人工取舍以新决策包 18 为准；正式机器迁移由 G0-01～03 完成 selector、inventory 与生成式 active/superseded/historical banner 后再重新分类。

### 需求与规划

| 文档 | 用途 |
| --- | --- |
| [requirements/01-当前需求现状.md](requirements/01-当前需求现状.md) | 当前能力、差距、需求资产和治理原则 |
| [requirements/02-顶级编程智能体需求基线.md](requirements/02-顶级编程智能体需求基线.md) | Claude Code / Codex / Copilot 对标后的目标需求 |
| [requirements/03-产品需求分析.md](requirements/03-产品需求分析.md) | 产品级需求、约束和历史演进 |
| [requirements/04-Agent优化路线图.md](requirements/04-Agent优化路线图.md) | Agent 能力差距、优先级和状态 |
| [requirements/05-意图识别需求.md](requirements/05-意图识别需求.md) | 意图识别入口策略、误触发复盘和验收用例 |
| [requirements/06-记忆体需求.md](requirements/06-记忆体需求.md) | 记忆体分层、读写规则、隐私边界和重构推进方式 |
| [requirements/07-架构重构需求澄清.md](requirements/07-架构重构需求澄清.md) | 架构重构范围、六大设计原则约束和实施顺序 |
| [requirements/08-程序员智能编程体需求完备性审计.md](requirements/08-程序员智能编程体需求完备性审计.md) | 程序员真实使用场景覆盖审计和补强需求 |
| [requirements/09-运行形态与界面解耦需求.md](requirements/09-运行形态与界面解耦需求.md) | 运行形态、界面解耦、跨平台和多入口产品需求 |
| [requirements/references/](requirements/references/) | Claude Code、Codex、Copilot 官方能力参考 |

### 架构与设计

| 文档 | 用途 |
| --- | --- |
| [architecture/01-顶级编程智能体总体架构设计.md](architecture/01-顶级编程智能体总体架构设计.md) | 基于新需求重写的顶级编程智能体总体架构 |
| [architecture/02-模型供应商与工具协议架构设计.md](architecture/02-模型供应商与工具协议架构设计.md) | DeepSeek Web 默认 Provider、API Provider 直连接入、模型能力契约、工具协议和降级策略 |
| [architecture/03-Agent运行时与工作流重构设计.md](architecture/03-Agent运行时与工作流重构设计.md) | 基于 REQ-A/B/C/D/E/I 的 Agent 运行时与工作流重构主设计 |
| [architecture/04-记忆体架构设计.md](architecture/04-记忆体架构设计.md) | MemoryService、schema、scope、隐私阻断和管理 UI 设计 |
| [architecture/05-代码重构实施计划.md](architecture/05-代码重构实施计划.md) | 基于代码现状差异的分阶段实施和测试计划 |
| [architecture/06-竞品实现方式对标审计与设计修正.md](architecture/06-竞品实现方式对标审计与设计修正.md) | Claude Code / Codex / Copilot 正式产品实现方式对标审计和修正 |
| [architecture/07-DeepSeek网页异常与恢复设计.md](architecture/07-DeepSeek网页异常与恢复设计.md) | DeepSeek Web Bridge 异常分类、质量门禁、恢复状态机和幂等保护 |
| [architecture/08-历史任务与续作架构设计.md](architecture/08-历史任务与续作架构设计.md) | TaskHistoryStore、TaskRunRecord、任务列表、打开续作和隐私清理设计 |
| [architecture/09-程序员工程完整性架构设计.md](architecture/09-程序员工程完整性架构设计.md) | EngineeringContextService、ContentExclusionService、CodebaseIndexService、EnvironmentProfileService、LanguageRuntimeRegistry、ConflictGuard、UsageBudgetService 设计 |
| [architecture/10-运行形态与界面解耦架构设计.md](architecture/10-运行形态与界面解耦架构设计.md) | AgentApplicationService、SurfaceAdapter、AgentCommand/AgentEvent、PlatformRuntimeAdapter、BuildProfile 设计 |
| [architecture/11-需求设计覆盖最终审计.md](architecture/11-需求设计覆盖最终审计.md) | REQ-A~N、MEM-01~14 和 ARCH-01~10 的最终覆盖审计 |
| [architecture/12-Agentic修复运行时专题设计.md](architecture/12-Agentic修复运行时专题设计.md) | Agentic 修复运行时、任务恢复、失败收敛和人工确认边界 |
| [architecture/13-工程完整性与顶级增强核心设计.md](architecture/13-工程完整性与顶级增强核心设计.md) | 工程完整性增强、上下文、验证、回归防护和顶级智能体能力补强 |
| [architecture/14-自动闭环迭代与测试方法论检讨.md](architecture/14-自动闭环迭代与测试方法论检讨.md) | 测试版本日志、真实执行追踪、run-log replay 和闭环验证方法 |
| [architecture/15-文件上下文与大文件治理专题设计.md](architecture/15-文件上下文与大文件治理专题设计.md) | 大文件读取、文件上下文切片、摘要、精确定位和 AI 友好代码拆分 |
| [architecture/16-重复判定逻辑治理专题设计.md](architecture/16-重复判定逻辑治理专题设计.md) | 重复判定逻辑、单一事实源、统一状态机和防回归重构计划 |
| [architecture/17-顶层RunContext与执行事实治理专题设计.md](architecture/17-顶层RunContext与执行事实治理专题设计.md) | 顶层 RunContext、单文件日志、执行事实归属、证据归并和 replay 诊断 |
| [architecture/18-优秀编程智能体100%收敛与新窗口接管计划.md](architecture/18-优秀编程智能体100%25收敛与新窗口接管计划.md) | 历史 mutation 接管快照；后续方向和任务发放已由当前审计包 README、14～18 接管 |

### 过程与发布

| 文档 | 用途 |
| --- | --- |
| [process/TOP_AGENT_CHANGE_GATE.md](process/TOP_AGENT_CHANGE_GATE.md) | 变更闸门、DoD、最近变更记录 |
| [release/CHANGELOG.md](release/CHANGELOG.md) | 版本记录、发布验证、可追溯变更 |

## 归档目录

归档文档只读，发现仍有价值的内容时，应合并回活跃文档，而不是继续维护旧报告。

| 目录 | 内容 |
| --- | --- |
| [archive/reports/](archive/reports/) | 审计报告、同步报告 |
| [archive/agent/](archive/agent/) | Agent 专项审计、实测、路径/会话分析、竞品工作流长参考 |
| [archive/architecture/](archive/architecture/) | 旧架构方案和重构迭代记录 |
| [archive/intent-recognition/](archive/intent-recognition/) | 意图识别测试报告 |
| [archive/iterations/](archive/iterations/) | 历史 sprint / 专题迭代纪要 |
| [archive/testing/](archive/testing/) | 一次性测试计划 |
| [archive/ui/](archive/ui/) | 旧 UI 风格指南、显示风格长参考 |
| [archive/plans/](archive/plans/) | 历史优化计划 |

## 维护规则

1. 新迭代先选择一个 capability id、唯一 owner、黄金旅程和退出指标；不要以新增 Phase 文档代替能力契约。
2. 需求、目标架构、实施状态、故障复盘、测试证据和 release history 分开管理，禁止同一文档同时充当全部 SSOT。
3. 旧需求/架构完成状态迁移前，修改相关边界必须先查 [18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md](top-agent-convergence-audit-20260711/18-旧架构实施计划承接矩阵与GPT5.5唯一执行基线.md)，再按 atomic card 定向读取 07/旧文档，避免复活已废止机制。
4. 完成功能或修复后，更新 capability/evidence 状态、[release/CHANGELOG.md](release/CHANGELOG.md) 和 [process/TOP_AGENT_CHANGE_GATE.md](process/TOP_AGENT_CHANGE_GATE.md)；没有真实证据不得提升资格等级。
5. 新 owner 接管后必须删除或封死旧 owner，并更新 architecture guard；不能以兼容或 fallback 为由长期保留多主链。
6. 一次性报告和大日志进入 archive/artifact store；活跃索引只指向当前可复算 manifest，不把易失 `/tmp` 路径作为资格证据。
