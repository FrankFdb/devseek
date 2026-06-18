# OpenAI Codex 官方能力参考

文档编号：REQ-REF-02
最后更新：2026-06-18
用途：保存 OpenAI Codex 官方文档中对 DevSeek 有参考价值的编程智能体能力。本文为摘要和链接，不复制官方全文。

## 1. 官方来源

- Codex overview: https://developers.openai.com/codex
- CLI: https://developers.openai.com/codex/cli
- Best practices: https://developers.openai.com/codex/learn/best-practices
- IDE extension: https://developers.openai.com/codex/ide
- Windows: https://developers.openai.com/codex/windows
- Agent approvals & security: https://developers.openai.com/codex/agent-approvals-security
- Sandbox: https://developers.openai.com/codex/concepts/sandboxing
- AGENTS.md: https://developers.openai.com/codex/guides/agents-md
- Config basics: https://developers.openai.com/codex/config-basic
- App features: https://developers.openai.com/codex/app/features
- Skills: https://developers.openai.com/codex/skills
- Subagents: https://developers.openai.com/codex/subagents

## 2. 原始能力摘录

| 能力 | 官方描述摘要 | DevSeek 可吸收需求 |
| --- | --- | --- |
| 跨表面一致 | Codex 覆盖 CLI、IDE extension、App、Cloud，配置、MCP、skills 可跨入口共享 | DevSeek 应保持 VS Code、CLI、桌面/本地 Web、MCP 配置的一致模型 |
| CLI 本地运行 | Codex CLI 可在终端本地读取、修改、运行代码，支持 macOS、Windows、Linux | DevSeek CLI 应通过 Headless Agent Core 运行，不复制 VS Code 业务 |
| IDE extension | Codex IDE extension 支持 VS Code forks 和 JetBrains，并可委派 cloud | DevSeek VS Code 插件要作为 Surface，而不是唯一产品边界 |
| Windows native / WSL2 | Codex 在 Windows 可 native 或 WSL2，涉及 sandbox 与 Linux-native 环境选择 | DevSeek 需要明确 Windows/WSL 平台 profile |
| 提示结构 | 官方建议 prompt 包含 Goal、Context、Constraints、Done when | DevSeek 计划器应把用户输入正规化为目标、上下文、约束、完成判据 |
| Plan first | 复杂任务先计划、收集上下文、澄清问题，再实施 | DevSeek P0：Plan Mode 与需求访谈 |
| AGENTS.md | Codex 自动读取全局、项目、子目录 `AGENTS.md`，近目录规则覆盖上层 | DevSeek 需要统一项目指令发现链 |
| 配置层 | 用户级、项目级、profile、系统级配置分层；可信项目才加载项目配置 | DevSeek 权限、模型、MCP、hooks 需要分层配置 |
| 沙箱 | 本地命令在受限环境中执行，默认写入限于 workspace，网络默认关闭或需配置 | DevSeek 需要写入边界、网络确认和越界审批 |
| Approval policy | 沙箱定义技术边界，审批策略定义何时暂停询问用户 | DevSeek 需要模式化权限策略，而不是零散确认框 |
| Review pane | 支持查看 Git diff、last turn、staged/unstaged、inline comments、stage/revert | DevSeek File Changes 需要 Git/hunk/inline comment 级审查 |
| Worktree / Cloud | 本地、worktree、cloud 三种运行方式，worktree 用于隔离任务 | DevSeek 可先做本地 worktree 隔离，再考虑云端 |
| Skills | `SKILL.md` 按需加载，避免长规则常驻上下文 | DevSeek 需要 skills 机制和内置常用技能 |
| MCP | CLI 与 IDE extension 共享 MCP 配置，支持 STDIO/HTTP/OAuth 等 | DevSeek 需要 MCP 配置、权限和失败治理 |
| Subagents | 并行子代理用于探索、测试、审查和摘要，减少上下文污染 | DevSeek P2：读多写少任务可委派 |
| Hooks | 可在 PreToolUse、PermissionRequest、PostToolUse、Stop 等事件插入脚本 | DevSeek P1：确定性策略和验证通过 hooks 实现 |
| Memories | 记忆默认可控，适合偏好、惯例、技术栈和已知坑；强规则仍应在 `AGENTS.md` | DevSeek 记忆要可查看、可禁用、可清理 |
| Non-interactive | `codex exec` 支持 CI、脚本、JSONL 事件和权限预设 | DevSeek P2：CLI/automation 输出机器可读事件 |

## 3. 对 DevSeek 的关键启发

1. 安全不是“多问用户几次”，而是沙箱边界和审批策略协同。
2. `AGENTS.md` 类指令链应成为每次任务的稳定输入，而不是用户每次手动贴规则。
3. Review pane 的粒度应从“看整个文件”升级到“按本轮、按 hunk、按 Git 状态审查”。
4. Skills、MCP、hooks、subagents 都应进入同一套权限和审计模型。
5. 非交互模式要天然适配 CI/脚本，因此输出必须机器可读，权限必须显式预设。
6. CLI、IDE、App 共享配置层是重要参考；DevSeek 的 Provider、权限、历史任务和记忆不能按入口分叉。
