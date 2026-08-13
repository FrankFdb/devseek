# Codex 与 Claude Code 公开源码对标说明

日期：2026-08-13

## 本地留档位置

已按要求把公开仓库拉到本地并保留，不删除。保存位置如下：

| 项目 | 本地路径 | 远端 | 本地快照 | 大小 |
|---|---|---|---|---|
| OpenAI Codex | `code/upstream-agent-sources/openai-codex` | `https://github.com/openai/codex.git` | `fe614a6304ef804be74a622e482fdd75977abcba` | 92M |
| Anthropic Claude Code | `code/upstream-agent-sources/anthropic-claude-code` | `https://github.com/anthropics/claude-code.git` | `be90077c6a353f292fa612d97173865a9ab21b83` | 25M |

说明：仓库 `.gitignore` 默认忽略 `code/*`，因此这些上游源码属于本地参考留档，不会自动进入 DevSeek 自身提交范围。如果未来需要把这两份源码纳入版本管理，需要单独调整 `.gitignore` 策略。

## 公开资料边界

官方资料确认 OpenAI Codex 有关键开源部分：

- OpenAI 的 Codex open source 页面说明，Codex CLI、Codex SDK、Codex App Server 等关键组件在 GitHub 上开源：`https://learn.chatgpt.com/docs/open-source`
- Codex CLI 文档说明 CLI 在本地仓库上工作，用户通过自然语言描述任务，CLI 通过脚本、检查、权限和工具循环完成工作：`https://learn.chatgpt.com/docs/codex/cli`
- OpenAI Codex GitHub 仓库：`https://github.com/openai/codex`

Claude Code 的公开仓库边界不同：

- Anthropic 的 `anthropics/claude-code` 仓库公开了 README、官方插件、commands、agents、hooks、示例和若干脚本：`https://github.com/anthropics/claude-code`
- 该仓库 README 明确说 Claude Code 是终端里的 agentic coding tool，并说明本仓库包含若干 Claude Code plugins。
- 目前该公开仓库没有可直接审计的 Claude Code 核心 CLI/agent loop 源码。因此，Claude Code 的内部意图识别实现不能从该仓库逐行确认，只能对标其公开插件机制、公开文档和可观察行为。

## Codex CLI 可确认实现

Codex CLI 的公开 Rust 源码能确认一件关键事实：它不是靠“关键词命中即最终判定”的单点意图分类器来驱动编程任务，而是模型采样、工具调用、本地工具运行时、权限策略、sandbox、patch/diff/evidence 串成一个闭环。

关键源码证据：

| 层级 | 源码位置 | 可确认事实 |
|---|---|---|
| 任务 turn loop | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/session/turn.rs:153` | `run_turn` 是一次用户输入的主循环入口，负责上下文、插件/技能注入、模型采样、工具结果回灌和后续 follow-up。 |
| 循环式模型采样 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/session/turn.rs:281`、`:1325`、`:1355` | turn 内会反复构造 prompt、调用模型、处理重试和后续输入，模型语义理解体现在响应流和工具调用中，而不是先把用户话术压成一个关键词路由。 |
| 工具调用解析 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/tools/router.rs:153` | `ResponseItem::FunctionCall`、`CustomToolCall`、`ToolSearchCall` 被转换成统一 `ToolCall`。这是“模型提出动作”的边界。 |
| 工具运行时 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/tools/parallel.rs:72`、`:92`、`:145` | `ToolCallRuntime` 接收模型工具调用，通过 router/registry 分发，按工具能力决定并行或串行，并把成功或失败结果写回模型输入。 |
| shell 执行仲裁 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/tools/handlers/shell.rs:64`、`:145`、`:180`、`:225` | shell handler 会规范化执行参数，拦截 `apply_patch`，请求 exec policy 判定，再由 orchestrator 运行并生成工具输出。 |
| 本地权限策略 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/exec_policy.rs:726` | 未匹配策略的命令仍要由本地 policy 根据 approval、sandbox、危险命令等因素给出 `Allow`、`Prompt` 或 `Forbidden`。 |
| sandbox 执行 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/exec.rs:295`、`:319`、`code/upstream-agent-sources/openai-codex/codex-rs/core/src/tools/runtimes/shell.rs:194` | 实际执行统一进入 sandbox transform 和 `execute_env`，不是由模型直接无约束执行。 |
| patch 运行时 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/tools/runtimes/apply_patch.rs:44`、`:140`、`:165` | patch 请求带文件路径、变更集、approval requirement；运行时在 sandbox context 下应用 patch，并返回 committed delta。 |
| 证据闭环 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/turn_diff_tracker.rs:47`、`:92`、`:114` | `TurnDiffTracker` 从已提交 patch delta 维护本轮 net diff，并可输出 unified diff；这是“已修改了什么”的本地证据。 |
| turn 结束证据输出 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/session/turn.rs:2718`、`:2733` | turn 会等待 in-flight 工具完成，必要时发出 `TurnDiff` 事件。 |

因此，对 DevSeek 来说，最应该对标的是分层契约，而不是源码里的某个关键词表：

1. 模型负责理解自然语言并提出语义/动作候选。
2. 本地契约层负责确认任务类型、写权限、目标路径、危险动作、sandbox、用户显式禁止项。
3. 工具运行时只执行被本地契约允许的动作。
4. 结束前必须根据真实文件变更、readback、命令输出、测试输出、artifact 质量检查生成证据。

## Claude Code 可确认实现

Claude Code 的核心 CLI 源码没有在当前公开仓库中出现，但公开仓库仍能确认几个对标点：

| 层级 | 源码位置 | 可确认事实 |
|---|---|---|
| 产品形态 | `code/upstream-agent-sources/anthropic-claude-code/README.md:7` | Claude Code 是终端、IDE、GitHub 中使用的自然语言 coding agent。 |
| 插件机制 | `code/upstream-agent-sources/anthropic-claude-code/README.md:48`、`plugins/README.md:1` | 公开仓库包含官方插件，用 commands、agents、hooks、MCP server 扩展 Claude Code。 |
| hooks 约束 | `code/upstream-agent-sources/anthropic-claude-code/plugins/hookify/README.md:3`、`:71`、`:122` | Hookify 插件能基于会话、工具事件、文件事件、停止事件等做 warn/block。 |
| 安全证据闭环 | `code/upstream-agent-sources/anthropic-claude-code/plugins/security-guidance/README.md:3`、`:44`、`:85` | Security guidance 插件展示了 pattern warning、LLM diff review、agentic commit review 三层闭环，并说明 Stop hook diff review 会读取变更路径和 diff。 |
| 编程流程 | `code/upstream-agent-sources/anthropic-claude-code/plugins/feature-dev/README.md:7`、`:56`、`:85`、`:113` | Feature-dev 插件体现了先理解代码库、澄清问题、设计架构、再实现和 review 的流程。 |

需要特别注意：这些只能证明 Claude Code 公开插件/工作流层的设计方向，不能证明核心意图识别内部是否采用某种具体源码实现。DevSeek 可以对标 Claude Code 的可观察产品行为和插件边界，但不能声称已逐行复刻 Claude Code 核心。

## 对 DevSeek 的直接对标结论

当前 DevSeek 不能继续把“关键词命中”作为最终意图判定。正确的对标方案应是：

### 1. 模型语义理解层

模型输出结构化语义提案，例如：

```json
{
  "taskKind": "file-artifact",
  "mutation": "create-file",
  "targetPaths": ["docs/login-report.md"],
  "sourcePaths": ["docs/login-spec.md"],
  "requiresValidation": true,
  "confidence": 0.82,
  "evidence": ["用户要求阅读登录说明并生成报告到指定 md 文件"]
}
```

这层的输出只能是 proposal，不能直接拥有写权限，也不能直接决定 workflow。

### 2. 本地契约仲裁层

本地层必须用确定性契约约束模型提案：

- 用户显式说“不要改文件”“只读”“先不要执行”，必须压过模型的 edit/run 提案。
- 指定目标路径、workspace root、文件类型、artifact 类型必须由本地 path contract 和 deliverable contract 绑定。
- 修改源码、生成报告、运行测试、外部副作用、破坏性命令必须分成不同 effect kind。
- 语义提案只能补充本地关键词/路径无法覆盖的语义，不允许越过 write authority、sandbox、approval、destructive guard。
- 本地契约输出要包括可解释的 arbitration trace，说明哪些模型提案被接受、哪些被降权或拒绝。

### 3. 证据闭环层

任务完成不能只看模型最后一句“完成了”。必须用真实证据确认：

- 源码修改：需要 diff 或 changed paths，并按任务风险跑静态/单测/构建。
- 文档/report artifact：需要目标文件存在、readback 可读、内容满足用户指定主题和结构。
- run-only/验证任务：需要命令输出、退出码、失败摘要和必要复跑逻辑。
- 只读分析：需要说明基于哪些读取文件或命令输出得出结论。
- 无证据时必须继续工具循环或向用户明确说明无法完成验证。

## DevSeek 下一步实施要求

基于上述源码审计，DevSeek 意图识别迭代应按下面优先级继续：

1. 将 `SemanticIntentInterpretation` 接入 `TaskSemanticContract` 解析路径，让模型语义 proposal 参与契约构建。
2. 增加 `SemanticIntentProposalArbiter`，只允许高置信 proposal 在本地契约允许范围内补充任务类型、目标路径、artifact 类型、验证需求。
3. 在 `ChatRouteController` 和 agentic kernel 入口统一传递 semantic intent，避免 UI routing 与 agentic write authority 使用两套意图判断。
4. 扩展多用户仿真矩阵，覆盖中文、英文、口语、省略目标、先读后写、只读、不要改、run-only、review-only、报告生成、源码修改、带绝对路径、带 workspace 相对路径、带验证要求、带禁止执行等场景。
5. 将 report-only Markdown、readback-only artifact、source-change verification、no-write boundary 放入稳定单测和真实工具仿真测试。
6. 每次迭代必须输出 evidence summary：语义提案、仲裁结果、真实工具动作、readback/diff/test 证据、失败原因。

这和 Codex 公开源码中的核心结构一致：模型负责提出动作，本地系统负责仲裁权限和执行，真实工具结果负责闭环。
