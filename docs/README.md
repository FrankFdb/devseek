# DevSeek 文档索引

本目录只保留少量长期维护文档。阶段性报告、专项审计、实测记录和迭代纪要统一放入 `docs/archive/`，避免日常开发时在过期材料里来回翻。

最后更新：2026-06-18

## 快速入口

每次开始 DevSeek 开发任务，优先读这几份：

| 文档 | 用途 |
| --- | --- |
| [TOP_AGENT_CHANGE_GATE.md](TOP_AGENT_CHANGE_GATE.md) | 每次变更前后的检查清单、DoD、最近变更记录 |
| [CHANGELOG.md](CHANGELOG.md) | 版本和未发布变更记录 |
| [软件设计.md](软件设计.md) | 全局架构、模块边界、数据流 |
| [需求分析.md](需求分析.md) | 产品目标、功能范围、验收标准 |
| [agent/DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md](agent/DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md) | Agent 能力主路线图和待办入口 |

## 活跃文档

### Agent 能力

| 文档 | 用途 |
| --- | --- |
| [agent/DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md](agent/DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md) | 主迭代入口，记录能力差距、优先级和状态 |
| [agent/TOP_AGENT_FEATURE_REQUIREMENTS.md](agent/TOP_AGENT_FEATURE_REQUIREMENTS.md) | 对标 Copilot/Cursor/Claude Code 的需求矩阵 |
| [agent/COPILOT_AGENT_WORKFLOW.md](agent/COPILOT_AGENT_WORKFLOW.md) | 编程 Agent 工作流参考 |
| [agent/COPILOT_DISPLAY_STYLE_REFERENCE.md](agent/COPILOT_DISPLAY_STYLE_REFERENCE.md) | WebView Working/Finished/Todos 显示规范 |
| [agent/LLM_PROVIDER_ARCHITECTURE.md](agent/LLM_PROVIDER_ARCHITECTURE.md) | 多 Provider 架构和能力抽象 |

### 架构与意图

| 文档 | 用途 |
| --- | --- |
| [architecture/devseek-architecture-refactor-review.md](architecture/devseek-architecture-refactor-review.md) | 当前架构边界、重构方向和产品化评估 |
| [intent-recognition/intent-recognition-review.md](intent-recognition/intent-recognition-review.md) | 意图识别入口策略和误触发复盘 |

## 归档目录

归档文档只读，发现仍有价值的内容时，应合并回活跃文档，而不是继续维护旧报告。

| 目录 | 内容 |
| --- | --- |
| [archive/reports/](archive/reports/) | 审计报告、同步报告 |
| [archive/agent/](archive/agent/) | Agent 专项审计、实测、路径/会话分析 |
| [archive/architecture/](archive/architecture/) | 旧架构方案和重构迭代记录 |
| [archive/intent-recognition/](archive/intent-recognition/) | 意图识别测试报告 |
| [archive/iterations/](archive/iterations/) | 历史 sprint / 专题迭代纪要 |
| [archive/testing/](archive/testing/) | 一次性测试计划 |
| [archive/ui/](archive/ui/) | 旧 UI 风格指南 |
| [archive/plans/](archive/plans/) | 历史优化计划 |

## 维护规则

1. 新建文档前先判断是否能补充到现有活跃文档。
2. 阶段性产物直接放入 `docs/archive/<category>/`。
3. 完成功能或修复后，至少更新 `CHANGELOG.md` 和 `TOP_AGENT_CHANGE_GATE.md`。
4. 改到架构边界时，同步更新 `软件设计.md` 或 `architecture/devseek-architecture-refactor-review.md`。
5. 改到产品行为时，同步更新 `需求分析.md` 或对应 Agent/Intent 文档。
