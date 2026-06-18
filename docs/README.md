# DevSeek 文档索引

本目录按软件工程生命周期分类，只保留后续迭代需要持续维护的活文档。阶段性报告、专项审计、实测记录、竞品长参考和迭代纪要统一放入 `docs/archive/`。

最后更新：2026-06-18

## 快速入口

每次开始 DevSeek 开发任务，优先读这几份：

| 文档 | 分类 | 用途 |
| --- | --- | --- |
| [requirements/01-当前需求现状.md](requirements/01-当前需求现状.md) | 需求现状 | 当前能力、差距和需求资产 |
| [requirements/02-顶级编程智能体需求基线.md](requirements/02-顶级编程智能体需求基线.md) | 目标需求 | Claude Code / Codex / Copilot 对标后的迭代目标 |
| [requirements/08-程序员智能编程体需求完备性审计.md](requirements/08-程序员智能编程体需求完备性审计.md) | 需求审计 | 程序员真实使用场景覆盖矩阵和新增需求说明 |
| [requirements/09-运行形态与界面解耦需求.md](requirements/09-运行形态与界面解耦需求.md) | 需求审计 | VS Code、CLI、非 VS Code UI、跨平台和显示/功能分离 |
| [architecture/02-模型供应商与工具协议架构设计.md](architecture/02-模型供应商与工具协议架构设计.md) | 架构设计 | DeepSeek Web 默认 Provider、API Provider 直连和统一工具协议 |
| [architecture/03-Agent运行时与工作流重构设计.md](architecture/03-Agent运行时与工作流重构设计.md) | 架构设计 | Agent 运行时与工作流重构主设计 |
| [architecture/07-DeepSeek网页异常与恢复设计.md](architecture/07-DeepSeek网页异常与恢复设计.md) | 架构设计 | DeepSeek Web 输出质量、异常恢复和幂等保护 |
| [architecture/08-历史任务与续作架构设计.md](architecture/08-历史任务与续作架构设计.md) | 架构设计 | 历史任务保存、显示、打开和继续工作 |
| [architecture/09-程序员工程完整性架构设计.md](architecture/09-程序员工程完整性架构设计.md) | 架构设计 | 代码库索引、工程环境、语言/运行时支持、忽略规则、冲突、预算和回放评测 |
| [architecture/10-运行形态与界面解耦架构设计.md](architecture/10-运行形态与界面解耦架构设计.md) | 架构设计 | Headless Agent Core、Surface Adapter、CLI、JSONL、跨平台 Platform Runtime、构建矩阵 |
| [architecture/05-代码重构实施计划.md](architecture/05-代码重构实施计划.md) | 实施计划 | 按需求和设计推进代码重构与测试 |
| [requirements/04-Agent优化路线图.md](requirements/04-Agent优化路线图.md) | 需求/路线图 | Agent 能力路线图和待办入口 |
| [process/TOP_AGENT_CHANGE_GATE.md](process/TOP_AGENT_CHANGE_GATE.md) | 工程过程 | 每次变更前后的检查清单、DoD、最近变更记录 |
| [release/CHANGELOG.md](release/CHANGELOG.md) | 发布 | 版本和未发布变更记录 |

## 活跃文档

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

1. 新建文档前先判断是否能补充到现有活跃文档。
2. 长期维护文档按 `requirements/`、`architecture/`、`process/`、`release/` 分类；一次性材料直接放入 `docs/archive/<category>/`。
3. 完成功能或修复后，至少更新 [release/CHANGELOG.md](release/CHANGELOG.md) 和 [process/TOP_AGENT_CHANGE_GATE.md](process/TOP_AGENT_CHANGE_GATE.md)。
4. 改到架构边界时，同步更新 [architecture/01-顶级编程智能体总体架构设计.md](architecture/01-顶级编程智能体总体架构设计.md)、[architecture/02-模型供应商与工具协议架构设计.md](architecture/02-模型供应商与工具协议架构设计.md)、[architecture/03-Agent运行时与工作流重构设计.md](architecture/03-Agent运行时与工作流重构设计.md)、[architecture/04-记忆体架构设计.md](architecture/04-记忆体架构设计.md)、[architecture/07-DeepSeek网页异常与恢复设计.md](architecture/07-DeepSeek网页异常与恢复设计.md)、[architecture/08-历史任务与续作架构设计.md](architecture/08-历史任务与续作架构设计.md)、[architecture/09-程序员工程完整性架构设计.md](architecture/09-程序员工程完整性架构设计.md)、[architecture/10-运行形态与界面解耦架构设计.md](architecture/10-运行形态与界面解耦架构设计.md) 或对应编号设计文档。
5. 改到产品行为时，同步更新 [requirements/02-顶级编程智能体需求基线.md](requirements/02-顶级编程智能体需求基线.md)、[requirements/03-产品需求分析.md](requirements/03-产品需求分析.md) 或对应 Agent/Intent 文档。
