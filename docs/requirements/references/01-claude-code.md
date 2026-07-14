---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "reference"
  path: "docs/requirements/references/01-claude-code.md"
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

# Claude Code 官方能力参考

文档编号：REQ-REF-01
最后更新：2026-06-18
用途：保存 Claude Code 官方文档中对 DevSeek 有参考价值的编程智能体能力。本文为摘要和链接，不复制官方全文。

## 1. 官方来源

- Overview: https://code.claude.com/docs/en/overview
- Common workflows: https://code.claude.com/docs/en/common-workflows
- VS Code integration: https://code.claude.com/docs/en/vs-code
- Desktop application: https://code.claude.com/docs/en/desktop
- Setup / Windows: https://code.claude.com/docs/en/setup
- Memory: https://code.claude.com/docs/en/memory
- Hooks: https://code.claude.com/docs/en/hooks-guide
- Subagents: https://code.claude.com/docs/en/sub-agents
- Skills: https://code.claude.com/docs/en/skills
- CLI reference: https://code.claude.com/docs/en/cli-reference
- Agent SDK: https://docs.anthropic.com/en/docs/claude-code/sdk

## 2. 原始能力摘录

| 能力 | 官方描述摘要 | DevSeek 可吸收需求 |
| --- | --- | --- |
| 代码库代理 | Claude Code 能读取代码库、编辑文件、运行命令，并跨多文件和工具完成任务 | DevSeek Agent 必须保持“读-改-跑-修”的完整闭环 |
| 终端优先 | CLI 可直接在项目目录启动、继续、恢复会话，适合真实工程工作流 | DevSeek 需要补非交互/脚本化入口和可靠会话恢复 |
| VS Code / CLI 切换 | VS Code extension 提供图形界面、diff、@mention、历史、多会话，也说明可切换到终端模式 | DevSeek 需要 Surface Adapter，让 VS Code 和 CLI 共享同一任务事实 |
| Desktop / 图形界面 | Desktop 承载权限模式、计划模式、会话恢复和应用预览 | DevSeek 非 VS Code UI 可放 P2，但不能绕过 Agent Core |
| Windows native / WSL | Claude Code 支持 Windows native、PowerShell/Git Bash 与 WSL 选择 | DevSeek 需要 PlatformRuntimeAdapter、ShellAdapter、PathAdapter |
| Plan Mode | 计划模式先读文件并提出计划，用户批准前不编辑文件 | DevSeek P0：实现 read-only Plan Mode |
| VS Code diff 审查 | Claude VS Code 插件展示 side-by-side diff，并让用户接受、拒绝或反馈 | DevSeek File Changes 需要 hunk 级和 inline feedback |
| 权限模式 | 普通模式逐步请求权限，Plan 模式先计划，auto-accept 自动编辑 | DevSeek 需要 Chat / Plan / Agent / Auto / Full Access 分层 |
| @ 文件/目录上下文 | 支持 @ mention 文件、目录、选区和行号 | DevSeek 需要 fuzzy @ context 和选区上下文 |
| 记忆 | `CLAUDE.md` 负责持久指令，auto memory 记录偏好、命令和调试经验 | DevSeek 需要项目规则、用户偏好和自动记忆分层 |
| Hooks | 生命周期 hook 可在关键事件执行 shell/HTTP/LLM 逻辑，适合强制校验和自动化 | DevSeek 需要 PreToolUse、PermissionRequest、PostToolUse、Stop 等 hooks |
| Skills | `SKILL.md` 把重复流程变为可复用能力，支持 `/debug`、`/code-review`、`/run`、`/verify` 等 | DevSeek 需要内置 debug/review/verify/docs skills |
| Subagents | 子代理在独立上下文中搜索、计划、审查，减少主会话上下文污染 | DevSeek 需要探索/审查/验证类 subagent |
| Worktrees / parallel sessions | 支持隔离并行会话，避免编辑冲突 | DevSeek 可在 P2 引入 worktree 隔离 |
| 非交互模式 | `claude -p` 支持管道、CI、pre-commit 和批处理 | DevSeek 可在 P2 提供 CLI/JSONL 自动化入口 |
| Agent SDK | SDK 暴露 agent loop、工具、权限、hooks、会话等能力 | DevSeek 架构应保持工具、权限、状态和事件可编程 |

## 3. 对 DevSeek 的关键启发

1. Plan Mode 是复杂任务的安全起点，必须先于全自动模式完善。
2. `CLAUDE.md` 与 auto memory 的分工很清楚：规则靠文档，经验靠记忆；DevSeek 不能把强制规则只放进可变记忆。
3. Hooks 是把“每次都应该发生”的行为从 LLM 判断中拿出来的关键机制。
4. Subagents 的核心价值不是炫技，而是隔离高噪声探索，保护主会话质量。
5. Skills 适合沉淀可复用流程，避免把长流程规则全部塞进系统 prompt。
6. CLI 体验可以对标 Claude Code，但 DevSeek 架构上必须先做 Headless Agent Core，避免 VS Code、CLI、桌面界面分叉。
