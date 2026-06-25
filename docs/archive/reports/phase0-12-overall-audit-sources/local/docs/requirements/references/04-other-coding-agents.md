# 其他编程智能体能力参考

文档编号：REQ-REF-04
最后更新：2026-06-18
用途：保存 Claude Code / Codex / Copilot 之外，对 DevSeek 需求有补充价值的编程智能体能力。本文为摘要和链接，不复制官方全文。

## 1. 官方或项目来源

- Cursor Docs: https://cursor.com/docs
- Cursor Rules: https://cursor.com/docs/rules
- Devin Desktop / Windsurf Cascade Overview: https://docs.devin.ai/desktop/cascade/cascade
- Devin Desktop / Windsurf Cascade Skills: https://docs.devin.ai/desktop/cascade/skills
- Devin Desktop / Windsurf Cascade Memories & Rules: https://docs.devin.ai/desktop/cascade/memories
- Devin Desktop / Windsurf Cascade Workflows: https://docs.devin.ai/desktop/cascade/workflows
- Devin Desktop / Windsurf Cascade Hooks: https://docs.devin.ai/desktop/cascade/hooks
- Cline Tasks: https://docs.cline.bot/core-workflows/task-management
- Cline Checkpoints: https://docs.cline.bot/core-workflows/checkpoints
- Cline Multi-Root Workspaces: https://docs.cline.bot/features/multiroot-workspace
- Aider Documentation: https://aider.chat/docs/
- Gemini CLI: https://github.com/google-gemini/gemini-cli
- Gemini CLI MCP: https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html
- Gemini Code Assist agent mode: https://developers.google.com/gemini-code-assist/docs/use-agentic-chat-pair-programmer
- Gemini CLI GitHub Actions: https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemini-cli-github-actions/

## 2. 原始能力摘录

| 来源 | 能力摘要 | DevSeek 可吸收需求 |
| --- | --- | --- |
| Cursor | Agent、Rules、MCP、Skills、CLI 是核心配置面 | DevSeek 要把规则、技能、MCP、Provider 和 CLI 自动化作为同一工作方式治理 |
| Devin Desktop / Cascade | Code/Chat 模式、计划与 todo、队列消息、工具调用、Web Search、MCP、Terminal、Workflows、App Deploys | DevSeek 要支持运行中追加指令、外部文档 grounding、可复用 workflow、部署/预览前检查 |
| Cascade | 可以检测包和工具、安装依赖、继续受限轨迹；有 prompt credit 和 tool calling 成本提示 | DevSeek 需要工程环境识别、依赖安装审批、成本/配额预算 |
| Cascade | 支持 named checkpoints、reverts、实时动作感知、Problems 入口、Explain and Fix、ignore 文件、linter integration、同时多会话与 worktrees | DevSeek 需要 checkpoint、用户并发修改冲突、Problems 上下文入口、忽略规则和 linter/validation 自动修复 |
| Cascade Skills/Workflows | Skills 适合复杂多步骤并带支持文件；Workflows 适合手动触发的重复流程 | DevSeek 要区分 Skills、Workflows、Rules、Memory，不把所有流程塞进 prompt |
| Cascade Memories & Rules | Memories 自动生成；Rules 可以 global/workspace/system，AGENTS.md 是目录作用域规则 | DevSeek 记忆体和项目规则要分层，规则优先于记忆 |
| Cascade Hooks | pre/post read/write/run/MCP/prompt/response/worktree 等 hook 事件用于日志、安全、验证和治理 | DevSeek Hooks 要覆盖工具、命令、写盘、MCP、prompt 和停止事件 |
| Cline | Task 是自包含工作单元，记录会话、代码变化、命令、决策、token、API 成本、执行时间，可中断续作 | DevSeek `TaskHistoryStore` 要记录任务事实、成本、时间和可恢复状态 |
| Cline | Checkpoints 使用独立快照保存每次工具后的文件状态，可恢复文件、任务或两者 | DevSeek checkpoint 要区分代码回滚和任务上下文回滚 |
| Cline | Multi-root 支持跨多个项目/仓库，但规则和 checkpoint 有边界限制 | DevSeek 多根/monorepo 要明确 root、规则、checkpoint、Git 状态和 cwd |
| Aider | Git 集成、repository map、lint/test、脚本化调用、Web/图片上下文、prompt caching、模型与 API key 配置 | DevSeek 需要 repository map、lint/test 自动修复、非交互脚本化、成本优化和多模态输入 |
| Gemini CLI | 终端优先、内置工具、Google Search grounding、文件操作、shell、web fetch、MCP | DevSeek 要保留本地终端开发体验，同时让联网资料进入可追溯证据 |
| Gemini Code Assist | IDE Agent 可用内置工具和 MCP，解决多步骤任务，用户可评论、编辑和批准计划/工具使用 | DevSeek 计划和工具使用必须可编辑、可批准、可暂停 |
| Gemini CLI GitHub Actions | 异步 issue triage、PR review、按事件触发、命令 allowlist、无长期密钥、OpenTelemetry 可观测 | DevSeek 远期自动化需要最小权限、可观测、事件来源和审计 |

## 3. 对 DevSeek 的关键启发

1. 任务历史不只是聊天记录，还要记录成本、命令、文件快照、决策和恢复入口。
2. Repository map、符号索引、Problems 面板、linter/test 是程序员日常效率的核心，不应只依赖大模型搜索。
3. 忽略规则、内容排除、用户并发修改冲突，是本地代码 Agent 的 P0 安全边界。
4. 依赖安装、网络访问、dev server、浏览器预览和 Notebook 输出都应进入工具协议和审计证据。
5. Skills、Workflows、Rules、Memory 的用途不同，应该分别建模。
6. API Provider 接入后，成本、token、配额、速率限制和 prompt caching 会成为真实用户体验的一部分。
