# Codex 与 Claude Code 公开源码对标说明

日期：2026-08-14（基于 2026-08-13 本地快照持续复核）

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
| pending input 有序队列 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/session/input_queue.rs:19-80`、`:268-367` | turn/session scoped queue 保留每次 `UserInput`、response item 和跨 agent message，`split_off(0)` 按已到达顺序取出，不把多次 steer 覆盖成一个关键词状态。 |
| 同一 turn 持续跟进 | `code/upstream-agent-sources/openai-codex/codex-rs/core/src/session/turn.rs:393-405`、`code/upstream-agent-sources/openai-codex/codex-rs/core/src/tasks/regular.rs:74-90` | 模型/工具处理后仍检查 pending input；有新输入就继续正常主循环，不另建一个与工具上下文脱节的静态意图会话。 |
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

## 带噪用户输入与实时修正的源码复核

本轮补充复核“错别字、同音字、口语、省略、中英混输和用户中途改口”后，可以确认 DevSeek 不应增加一套通用拼写纠正器或继续扩张关键词路由。更接近 Codex/Claude Code 的实现边界是：保留用户原文，由模型恢复语义；本地系统只仲裁权限、字面量、工具动作和执行证据。

### Codex 可直接确认的实现

| 源码位置 | 可确认事实 | 对 DevSeek 的含义 |
|---|---|---|
| `code/upstream-agent-sources/openai-codex/codex-rs/protocol/src/user_input.rs:15` | `UserInput::Text` 保存原始 `String`；`text_elements` 只标记特殊 UI span，并明确要求不修改 literal text。 | 原始输入必须不可变保存；纠错结果只能是派生语义，不能覆盖用户原文。 |
| `code/upstream-agent-sources/openai-codex/codex-rs/protocol/src/models.rs:1767` | `UserInput::Text { text }` 直接转换为模型的 `InputText { text }`。 | 错别字、同音字和口语理解主要交给大模型，而不是先经过关键词分类器或强制格式化。 |
| `code/upstream-agent-sources/openai-codex/codex-rs/core/src/session/turn.rs:153` | 原始 turn input 进入模型采样、工具调用、结果回灌的循环。 | 意图理解应存在于完整 agent loop 中，不能在进入模型前被单一枚举路由压扁。 |
| `code/upstream-agent-sources/openai-codex/codex-rs/core/src/session/turn_input.rs:374`、`:546` | 活跃任务可接收新的 `UserInput` steering，并把新输入追加到 pending input。 | 用户可以在任务进行中补充、纠正或撤销要求；新输入必须修订当前合同，而不是创建互不相关的任务。 |
| `code/upstream-agent-sources/openai-codex/codex-rs/core/src/tools/router.rs:153`、`core/src/exec_policy.rs:726` | 模型提出工具动作，本地 router、approval、sandbox 和 exec policy 决定能否执行。 | 模型可以理解并纠正语义，但不能因为“猜到了用户意思”就获得写入、删除或外部 effect 权限。 |

Codex 公开源码中未发现一个在模型调用前把自然语言错别字统一改写、再按关键词决定最终任务类型的核心流程。可以据此确认架构方向，但不能据此声称知道模型内部如何完成中文同音字纠正。

### Claude Code 可确认边界

Claude Code 核心 agent loop 仍未在公开仓库中提供，不能逐行确认其内部纠错算法。不过本地保存的公开变更记录能确认这些产品行为：

- `code/upstream-agent-sources/anthropic-claude-code/CHANGELOG.md:5282`：运行过程中可以发送消息实时 steering。
- `code/upstream-agent-sources/anthropic-claude-code/CHANGELOG.md:2765`：权限自动模式必须尊重用户显式边界，例如“不要 push”“等 X 后再 Y”。
- `code/upstream-agent-sources/anthropic-claude-code/CHANGELOG.md:1575`：权限分类器会把用户对提问的回答作为 intent signal。
- `code/upstream-agent-sources/anthropic-claude-code/CHANGELOG.md:3115`：排队 prompt 的分隔完整性属于需要修复的输入语义问题。

这些证据支持“模型理解 + 会话 steering + 独立权限层”的对标方向；Claude Code 的具体错别字处理仍只能通过公开行为和同题仿真验证，不能伪装成源码事实。

### 对 DevSeek 策略的修订

1. 新增不可变 `OriginalInputEnvelope`：保存原文、附件、语言、turn/session id 和受保护字面量 span。
2. 将模型输出升级为 `SemanticIntentProposalV2`：除任务候选外，返回 `normalized_meaning`、`correction_hypotheses`、`protected_literals`、`ambiguities`、`confidence` 和依据；这些字段只表达模型理解，不替换原文。
3. 自然语言错别字、同音字、语序、省略、口语和中英混输由模型恢复；多语言 lexicon 仅提供禁止项、明确授权、路径/命令等高置信本地信号，不承担通用纠错。
4. 路径、命令、URL、版本号、hash、代码标识符和引号内文本默认是 protected literal。模型可以提出候选映射，但必须经 workspace、项目脚本或符号索引 grounding；不得静默改写后直接执行。
5. 语义纠错不得创造授权、删除否定词或提升 effect 等级。低风险只读可按高置信候选继续；源码写入需要目标 grounding；删除、发布、部署、commit/push 等高影响动作仍进入本地确认或澄清。
6. 后续用户输入作为 contract revision：允许补充、纠正、收窄、扩大或撤销先前要求，保留 revision provenance，并以最新明确约束优先。
7. 当前 `semantic-intent-interpreter.ts` 对 web provider 直接返回 `undefined`，因此还不能宣称真实 DeepSeek Web 入口拥有上述模型语义恢复能力。下一轮必须把 semantic proposal 做成 provider-agnostic：可以来自独立解释调用，也可以来自主 agent response 的结构化 envelope，但都进入同一个本地 arbiter。
8. 验收采用 clean/noisy metamorphic pairs：同一意图的规范输入和带噪输入应得到等价合同；同时加入 literal-preservation、否定词、权限升级和错误纠正反例，避免“理解力提升”变成静默误操作。

## 按 Codex 主循环对 DevSeek 现方案的进一步检讨

仅加入 `SemanticIntentProposalV2` 仍不够。Codex 源码显示，其关键不是“有一个更强的意图分类器”，而是根本不让预分类器成为执行权威：原始输入进入主模型循环，模型选择直接回答或提出工具调用，本地系统再对每个真实动作做权限和 sandbox 仲裁。

| Codex 源码行为 | DevSeek 当前行为 | 检讨结论 |
|---|---|---|
| `run_turn` 接收原始 `TurnInput`，模型可以直接回答或提出 function call。 | `resolveSemanticRouteDecision()` 先执行本地 `controller.decide()`，再选择性发起独立 semantic intent 调用，然后重新决定 route/workflow。 | 存在“双重理解”和过早路由；独立 semantic call 可作为辅助 proposal，但不应决定主模型是否有机会理解原始输入。 |
| 用户文本原样转换为模型 `InputText`。 | `extension.ts:408` 仍用 `(编写|创建|...)` 正则提前判断是否属于 write request，并据此决定目录上下文发现。 | 带错别字或同音字的写入请求会在模型前走错分支；这类前置关键词门控应移入语义/动作层或只保留为无权限影响的性能提示。 |
| 工具调用形成后，router/exec policy/sandbox 按具体命令、路径和风险处理。 | `buildToolPolicy(mode)` 在模型动作出现前按 `qa/inspect/edit/run` 预先生成 allow/deny 工具集合；例如 `qa` 没有任何工具。 | task mode 不应是最终 authority。路由最多决定默认体验；真实权限必须由 action descriptor、effect、target、当前合同和 approval policy 决定。 |
| 新用户输入可以追加到活跃 turn 的 pending input，供后续采样使用。 | DevSeek 有 semantic contract revision 能力，但用户实时 steering、在途动作失效和 authority receipt 版本绑定尚未形成 Codex 式统一输入队列。 | 需要 turn-scoped input queue 和单调递增 contract revision；“停止/不要改/刚才说错了”到达后，旧 revision 的未执行写动作必须失效。 |
| 工具结果回灌模型，`TurnDiffTracker` 维护本轮真实 net diff。 | DevSeek 已有 tool result/evidence、canonical executor 和 authority receipt，但完成判定仍有多条 surface 路径。 | 保留现有 action/evidence 基础，将所有 surface 收敛到统一的 execution receipt 和 completion contract。 |

### 修订后的 Codex-style DevSeek 目标结构

1. **Turn Input Store**：不可变保存原始用户输入、附件、rich spans 和后续 steering；不对原文做 destructive normalization。
2. **Main Model Understanding**：原始输入、当前会话和 workspace context 进入主 agent 模型。模型可以直接回答、请求澄清，或提出结构化 tool/action proposal。错别字、同音字和口语恢复在这里完成。
3. **Constraint Contract**：本地合同只保存能够确定的边界，例如 no-write、no-run、目标 scope、protected literals、approval mode 和最新 steering revision。`taskKind` 是解释/调度信息，不是权限令牌。
4. **Action Authority Arbiter**：每个工具调用在执行前按 descriptor、effects、target paths、risk、sandbox、用户约束和 contract revision 生成 `allow / confirm / deny` receipt。模型提案和初始 route 都不能绕过它。
5. **Tool Runtime Loop**：执行结果、错误和 evidence 回灌主模型，允许模型根据观察继续工作；重复失败必须有界。
6. **Turn Evidence Tracker**：统一维护 changed paths、net diff、readback、command output、test result、external-effect receipt 和未满足义务。
7. **Steering/Reconciliation**：新用户输入进入活跃 turn，重新解释并生成新 revision；尚未执行的旧 authority receipt 失效，已发生 effect 记录为事实并据此恢复。

### 对现有组件的处置

- 保留并加强：`TaskSemanticContract` 的禁止项/scope/effect 合同、`AgentToolExecutor` 的 action descriptor、canonical executor、authority receipt、文件/终端 permission coordinator 和 evidence store。
- 降级：`ChatIntentDecision.mode`、`SemanticIntentInterpretation.taskKind` 和 learned intent 只能用于 UI、模型选择、上下文准备和默认工作流，不再单独授予或永久剥夺工具能力。
- 重构：`resolveSemanticRouteDecision()` 不再以“本地先判型 + 第二次模型判型”控制执行入口。优先从主模型首轮响应获得 semantic/action proposal；不支持结构化输出时才使用独立解释调用作辅助。
- 删除/收敛：任何影响权限、上下文正确性或任务完成的前置 `isWriteRequest`/关键词快捷判断，都必须迁移到 shared semantic/action owner；只影响缓存或展示的 hint 可以保留，但要有 typo/noisy 输入反例。
- Provider 一致性：API、DeepSeek Web 和测试 provider 必须产生同一内部 proposal/action envelope。Web 返回即使混合 Markdown、JSON-like 或半截调用，也只能影响解析结果，不能改变权限模型。

因此，DevSeek 的最终方案不应表述为“关键词层 + LLM 分类层 + 路由层”，而应表述为“原始 turn 输入 + 主模型理解/动作提案 + 本地 constraint/action 仲裁 + 工具观察循环 + evidence 完成合同”。这比单独增强意图分类器更接近 Codex 公开源码。

需要特别注意：这些只能证明 Claude Code 公开插件/工作流层的设计方向，不能证明核心意图识别内部是否采用某种具体源码实现。DevSeek 可以对标 Claude Code 的可观察产品行为和插件边界，但不能声称已逐行复刻 Claude Code 核心。

## 对 DevSeek 的直接对标结论

不再增加独立“LLM 意图分类调用”。Codex 的核心边界是主模型本身在正常 turn 中选择消息或工具，而不是先让另一个模型把输入压成任务枚举：

- `core/src/session/turn.rs:245-405`：原始输入和 pending steer 进入同一个采样循环；pending input 在下一次模型请求前写入历史。
- `core/src/stream_events_utils.rs:288-381`：模型输出若能构造成工具调用，就排入本地工具 runtime 并要求 follow-up；否则作为普通消息完成。
- `core/src/session/input_queue.rs:19-80`、`:273-367`：turn-scoped queue 保存 `UserInput`、response item 和跨 agent 消息，并能判断、取出 pending input。
- `core/src/tasks/regular.rs:74-94`：常规任务结束仍检查 pending input，存在时继续当前 turn。

因此 DevSeek 采用以下责任划分：

1. **主模型理解**：原始用户输入直接进入正常 agent loop。模型自行决定直接回答、澄清、只读调查或提出工具动作；错别字、同音字、口语、省略和中英混输由模型结合上下文理解。
2. **具体动作仲裁**：本地层不根据任务枚举授予工具能力，只对模型实际提出的 read/write/process/network/git/release 动作按 workspace containment、显式 scope、protected path、risk、approval、sandbox 和 safety policy 逐项裁决。
3. **工具观察循环**：工具成功、失败、拒绝和确认结果进入同一模型历史，模型据此继续或回答。
4. **实时 steering**：新用户输入形成当前修订快照；模型历史保留旧消息，但冲突的旧未执行工具提案作废。已提交效果作为事实保留，不伪造回滚。
5. **证据闭环**：changed paths、readback、命令退出码、测试结果和外部 effect receipt 决定是否完成，模型口头声明不能替代执行证据。

## 本轮 DevSeek 实施映射

| Codex 责任边界 | DevSeek 实现 | 状态 |
|---|---|---|
| 非空输入进入主模型 turn | `src/app/workflow-service.ts` 统一选择 `model-agent / model-led`；`src/extension.ts` 删除执行前关键词确认返回 | 已实施 |
| 主模型选择消息或工具 | `src/agent/agentic-loop.ts` 的 `model-led` 模式不再先走 Markdown/simple-file 快捷执行；无工具输出可直接回答，有实际 work tool 才开启工具证据义务 | 已实施 |
| 带噪语言由模型理解 | `src/agent/agentic-system-prompt.ts` 明确保留原始自然语言并恢复错别字、同音字、口语、省略和混合语言 | 已实施 |
| 动作级权限 | `packages/shared/src/coding-tool-authority.ts` 的 `model-led` strategy 暴露动作能力，但具体 scope、risk、confirmation、safety 仍逐项裁决 | 已实施 |
| 当前约束投影到文件动作 | `src/app/agent-file-write-policy.ts` 对 model proposal 放弃关键词写授权，仍保留 containment、显式 exclude、protected/sensitive path 和确认 | 已实施 |
| pending input / steer | `src/agent/write-authority.ts`、`src/intent/intent-revision-lineage.ts` 保存最新修订；`agentic-loop.ts` 在采样前后 drain，纠偏到达后丢弃旧未执行工具提案并重新采样 | 已实施 |
| 动态 TaskContract owner | `packages/shared/src/coding-task-contract-revision.ts` 保存有序、不可变、幂等的 revision receipt；`coding-kernel.ts` 向运行时暴露同一 revision session | 2.0.22 已实施 |
| 修订后重算派生契约 | `coding-change-plan-revision.ts` 在 TaskContract hash 变化时重建 ContextGraph、Requirements、Design 和 ChangePlan，工具权限只读取最新 scope | 2.0.22 已实施 |
| 旧动作/证据失效 | `coding-tool-authority.ts`、`coding-verification.ts`、`coding-verifier-selection.ts` 绑定 TaskContract hash；旧 action、未执行 receipt 和旧验证不能授权或结算新要求 | 2.0.22 已实施 |
| 结构化最新 scope | `packages/vscode-extension/src/app/coding-kernel-execution.ts`、`coding-kernel-task-contract.ts` 将 steer 投影为权威 target/exclude/strict-scope，不再从纠正句历史片段中复活旧目标 | 2.0.22 已实施 |
| 可配置的确定性语言证据 | `operational-language-lexicon.ts` 统一持有 correction/negation/reauthorization 等语言组并支持 JSON 动态追加；`intent-revision-lineage.ts` 只消费该边界 | 2.0.22 已实施 |
| 用户仿真 | `model-led-intent-boundary.test.mjs`、`model-led-user-simulation.test.mjs` 覆盖多语言噪声、直接问答、精确简单请求、真实写入/readback 和中途改目标 | 已实施 |

关键词与多语言配置仍可用于确定性证据提取、显式禁止项和兼容诊断，但不得决定主模型是否运行、是否必须调用工具或是否拥有执行权限。Claude Code 核心未公开，因此后续实现继续以本地 Codex 快照为源码主基线，Claude Code 只作为公开行为和插件层的补充证据。
