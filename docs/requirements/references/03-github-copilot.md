---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "reference"
  path: "docs/requirements/references/03-github-copilot.md"
  source_group: "requirements"
  decision: "not-applicable"
  relationship: "external-reference"
  active_baselines:
    - "docs/requirements/02-顶级编程智能体需求基线.md"
  machine_sources:
    active_selector: "docs/process/devseek-active-baseline-selector.json"
    legacy_inventory: "docs/process/devseek-legacy-doc-inventory.json"
  asserts_gate_pass: false
---

<!-- DEVSEEK-GOVERNANCE-BANNER:START -->
> [!NOTE]
> DevSeek governance: this document is `reference` with decision `not-applicable` and relationship `external-reference`. Current authority: `docs/requirements/02-顶级编程智能体需求基线.md`. Machine source: `docs/process/devseek-legacy-doc-inventory.json`.
<!-- DEVSEEK-GOVERNANCE-BANNER:END -->

# GitHub Copilot 官方能力参考

文档编号：REQ-REF-03
最后更新：2026-06-18
用途：保存 GitHub Copilot / VS Code Copilot 官方文档中对 DevSeek 有参考价值的编程智能体能力。本文为摘要和链接，不复制官方全文。

## 1. 官方来源

- Copilot features: https://docs.github.com/en/copilot/get-started/features
- Copilot CLI: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli
- Copilot cloud agent: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- Starting cloud agent sessions: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/start-copilot-sessions
- Copilot code review: https://docs.github.com/en/copilot/concepts/agents/code-review
- MCP for Copilot: https://docs.github.com/en/copilot/concepts/context/mcp
- Custom agents: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-custom-agents
- Agent skills: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills
- VS Code chat: https://code.visualstudio.com/docs/chat/chat-overview
- VS Code tools in chat: https://code.visualstudio.com/docs/chat/chat-tools
- VS Code custom instructions: https://code.visualstudio.com/docs/agent-customization/custom-instructions

## 2. 原始能力摘录

| 能力 | 官方描述摘要 | DevSeek 可吸收需求 |
| --- | --- | --- |
| IDE Agent Mode | Copilot 在 IDE 中自主决定要改哪些文件，提出代码变更和终端命令，并迭代修复问题 | DevSeek Agent 需要文件选择、命令执行、验证修复的稳定闭环 |
| 多聊天表面 | VS Code 提供 Agents window、Chat view、Inline Chat、Quick Chat | DevSeek 至少要补 Inline Chat 和选区上下文 |
| CLI agent | Copilot CLI 可在终端交互，也支持 programmatic prompt；支持 Linux、macOS、Windows PowerShell/WSL | DevSeek CLI 需要交互和 JSONL/脚本两种模式，并纳入跨平台测试 |
| 工具系统 | VS Code 支持 built-in tools、MCP tools、extension tools，工具可选择、分组和显式引用 | DevSeek 需要工具注册中心、工具集和 per-request 工具开关 |
| 终端工具 | Agent 可运行构建、测试、安装依赖，并在 chat 中展示命令和输出 | DevSeek 终端执行需内联确认、输出可追踪 |
| Custom instructions | 支持 repo/user/org 指令，VS Code 可发现 `AGENTS.md`、`CLAUDE.md` 等约定文件 | DevSeek 要兼容主流指令文件，降低用户迁移成本 |
| Cloud agent | Copilot 可在 GitHub Actions 环境中研究仓库、创建计划、改分支、运行测试、开 PR | DevSeek 远期可参考其“异步后台 + 分支 + PR review”模式 |
| Session entry points | Cloud agent 可从 GitHub、IDE、CLI、REST API、Slack、Jira、Linear 等入口启动 | DevSeek 可先支持 VS Code 和本地 CLI，远期再接 issue/PR |
| Code review | Copilot 可审查 PR、识别问题并提供可应用建议 | DevSeek P1：AI code review 需要严重性、文件行号、可应用修复 |
| MCP across surfaces | MCP 可扩展 Copilot Chat、CLI、App、cloud agent、code review | DevSeek MCP 能力应统一适配 Agent 和 Review |
| Custom agents | Agent profile 用 Markdown + YAML 定义 name、description、prompt、tools、MCP | DevSeek subagent/custom agent 可采用类似可读文件格式 |
| Agent skills | Skills 与 custom instructions 分工：简单常驻规则用 instructions，复杂按需流程用 skills | DevSeek 需求要区分规则、技能、记忆三类上下文 |
| Memory | Copilot Memory 可保存仓库和个人偏好，提升后续工作效果 | DevSeek 记忆应服务重复工程经验，不替代强制规则 |
| PR 生命周期 | Cloud agent 自动创建分支、commit message、push，用户可 review、迭代、开 PR | DevSeek 可先做本地 Git diff/commit/PR 描述，再考虑远端 |

## 3. 对 DevSeek 的关键启发

1. 最好的 IDE 体验不是单一聊天框，而是 Chat、Inline、Diff、Terminal、Problems 面板联动。
2. 工具系统要允许用户看见、筛选和显式引用工具，降低“Agent 胡乱操作”的不确定感。
3. Code review 是编程智能体的高价值入口，和代码生成同等重要。
4. Custom instructions、skills、MCP、custom agents 应成为统一的“可配置工作方式”。
5. 云端 agent 的核心用户价值是异步和 PR 生命周期，而不是必须复制 GitHub Actions 形态。
6. 多入口 session 说明 Agent 任务不应绑定单一界面；DevSeek 应以任务事实和事件协议作为跨 Surface 的共同语言。
