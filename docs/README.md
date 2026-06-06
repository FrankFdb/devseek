# DeepSeek NetAI 文档索引

> **本文件是所有文档维护的唯一入口。**  
> 每次迭代开始前，先读本文件，再按指引找到对应文档，不要在目录中盲目翻找。

---

## 一、如何在新会话中恢复上次任务

**只需读一份文档即可继续上次工作：**

```
docs/agent/DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md
```

该文档包含：当前架构现状、所有待实现改进项（含优先级和状态）、与其他设计文档的交叉引用。  
Copilot 智能体读完后可直接接续上次任务，无需完整对话历史。

---

## 二、文档地图

### 2.1 核心开发文档（日常维护）

| 文档 | 定位 | 何时参考 |
|------|------|----------|
| [agent/DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md](agent/DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md) | **主迭代入口** — 架构现状 + 所有改进项 + 优先级路线图 | **每次迭代开始必读** |
| [agent/LLM_PROVIDER_ARCHITECTURE.md](agent/LLM_PROVIDER_ARCHITECTURE.md) | 多 LLM Provider 架构设计（Web/API/Other 优先级策略） | 实现 Provider 切换功能时 |
| [agent/TOP_AGENT_FEATURE_REQUIREMENTS.md](agent/TOP_AGENT_FEATURE_REQUIREMENTS.md) | 对标 Copilot/Cursor/Claude Code 的能力差距与需求矩阵 | 规划新功能、对比竞品时 |
| [agent/COPILOT_AGENT_WORKFLOW.md](agent/COPILOT_AGENT_WORKFLOW.md) | Copilot Agent 完整执行流参考（意图→规划→循环→完成，持续对标） | 实现/调试 Agent 模式功能时 |
| [agent/COPILOT_DISPLAY_STYLE_REFERENCE.md](agent/COPILOT_DISPLAY_STYLE_REFERENCE.md) | WebView 显示行为规范（NLS、Working/Finished 状态机） | 修改 webview.js / 显示逻辑时 |
| [软件设计.md](软件设计.md) | 全局软件设计（模块结构、数据流、接口定义） | 理解现有代码结构时 |
| [需求分析.md](需求分析.md) | 产品需求分析（功能列表、用户故事、验收标准） | 确认功能边界、验收时 |

### 2.2 流程与质检文档（每次变更必查）

| 文档 | 定位 | 何时参考 |
|------|------|----------|
| [TOP_AGENT_CHANGE_GATE.md](TOP_AGENT_CHANGE_GATE.md) | 变更闸门（五段式检查 + DoD + 变更记录模板） | **每次提交代码变更前必查** |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更日志（每版备份位置、已上线功能） | 查版本历史、写发布说明时 |

### 2.3 历史参考文档（不再主动维护）

| 文档 | 原用途 | 归档原因 |
|------|--------|----------|
| [archive/AGENT_ARCHITECTURE_REDESIGN.md](archive/AGENT_ARCHITECTURE_REDESIGN.md) | 2026-05-08 架构分析与重设计方案 | 结论已并入 agent/ 目录各文档 |
| [archive/CHAT_UI_STYLE_GUIDE.md](archive/CHAT_UI_STYLE_GUIDE.md) | 早期 WebView CSS 风格指南 | 已被 `agent/COPILOT_DISPLAY_STYLE_REFERENCE.md` 覆盖 |
| [archive/COPILOT_FLOW_TEST_PLAN.md](archive/COPILOT_FLOW_TEST_PLAN.md) | Copilot 风格专项测试计划 | 一次性专项，已完成 |
| [archive/COPILOT_STYLE_专题迭代记录.md](archive/COPILOT_STYLE_专题迭代记录.md) | Copilot 风格对齐 sprint 纪要 | Sprint 已结束，历史备查 |
| [archive/AUDIT_REPORT_2026-05-12.md](archive/AUDIT_REPORT_2026-05-12.md) | webview 显示规范审计报告（4 项，全部修复于 v2.18） | 审计已完成，问题已解决 |
| [archive/ITERATION_2026-05-09_P3-4.md](archive/ITERATION_2026-05-09_P3-4.md) | P3-4 sprint 纪要（测试生成 + B-7 修复） | Sprint 已结束，功能均已上线 |
| [archive/ITERATION_2026-05-09_P3-5.md](archive/ITERATION_2026-05-09_P3-5.md) | P3-5 sprint 纪要（MCP + @git + /test 修复） | Sprint 已结束，功能均已上线 |
| [archive/ITERATION_2026-05-09_P4-1.md](archive/ITERATION_2026-05-09_P4-1.md) | P4-1/P4-2 sprint 纪要（run_terminal + token 显示） | Sprint 已结束，功能均已上线 |
| [archive/OPTIMIZATION_PLAN_2026-05-13.md](archive/OPTIMIZATION_PLAN_2026-05-13.md) | Sprint G-A/B/C/D 优化计划（G-1~G-6 实现路线图）| Sprint G-A/B/C 全部完成，G-D(G-5 方案B) 以方案A StatusBar替代 |

> 归档文档只读，发现仍有价值的内容请合并到活跃文档，不要直接修改归档文件。

---

## 三、文档维护规则

### 3.1 新建文档前先问这三个问题

1. **现有文档能否覆盖？** 能加章节就不建新文件。
2. **是阶段性产物还是持续维护？** 阶段性产物（sprint 纪要、专项分析）直接归入 `archive/`，不建活跃文档。
3. **放哪个目录？** 参考下方目录职责说明。

### 3.2 目录职责

```
docs/
├── README.md                 ← 本文件，文档索引，不要删除
├── CHANGELOG.md              ← 版本日志，每次发版后追加
├── TOP_AGENT_CHANGE_GATE.md  ← 变更流程/闸门，可扩展第6节记录
├── 软件设计.md                ← 全局设计，架构级变更时更新
├── 需求分析.md                ← 产品需求，功能添加/删除时更新
│
├── agent/                    ← 智能体专项文档（deepseek 插件 AI Agent 能力）
│   ├── DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md  ← 主迭代入口
│   ├── LLM_PROVIDER_ARCHITECTURE.md
│   ├── TOP_AGENT_FEATURE_REQUIREMENTS.md
│   ├── COPILOT_AGENT_WORKFLOW.md    ← Copilot Agent 执行流对标（持续更新）
│   └── COPILOT_DISPLAY_STYLE_REFERENCE.md
│
└── archive/                  ← 历史文档（只读，不维护）
```

### 3.3 agent/ 目录文档更新时机

| 事件 | 要更新的文档 |
|------|-------------|
| 实现一个改进项 | `DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md` — 将该项状态标为 ✅ |
| 新增 LLM Provider 功能 | `LLM_PROVIDER_ARCHITECTURE.md` |
| 发现新的竞品能力差距 | `TOP_AGENT_FEATURE_REQUIREMENTS.md` |
| 修改 webview 显示行为 | `COPILOT_DISPLAY_STYLE_REFERENCE.md` |
| 发现文档错误或过时信息 | 原地修改，不要新建文档 |
| 完成一个重要专项审计 | 新建 `AUDIT_REPORT_<日期>.md`（只增不改已有报告） |

### 3.4 每次迭代末尾的必做事项

1. **更新 `DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md`**：标记已完成项，补充新发现的问题。
2. **追加 `CHANGELOG.md`**：写明版本号、关键变更、备份路径。
3. **填写 `TOP_AGENT_CHANGE_GATE.md` 第 6 节**：更新最近一次变更记录。
4. **检查 `软件设计.md` 和 `需求分析.md`**：若有架构/功能变更，同步更新。

---

## 四、Copilot 智能体快速恢复指令模板

在新会话中粘贴以下提示即可恢复上下文（无需上传历史对话）：

```
请读取以下文档，然后继续上次的开发任务：

1. docs/README.md                                          （本索引，了解全局）
2. docs/agent/DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md  （当前任务状态与待办）
3. [按需] docs/agent/LLM_PROVIDER_ARCHITECTURE.md         （如涉及 Provider 功能）
4. [按需] docs/软件设计.md                                 （如涉及架构变更）

读完后，告知我当前最高优先级的未完成任务，并等待我确认后开始。
```

---

*最后更新：2026-05-09*
