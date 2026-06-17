# DevSeek 重构迭代 002：同 Session 续作上下文

日期：2026-06-17

## 1. 问题

截图中的失败模式是：

```text
同一个 DevSeek session 中，用户追加纠偏或新要求：
"为什么不在原来的 .../shape_manager 中的代码中修改，而单独重新写了一个程序呢"

实际表现：
模型把这句话当成新的独立请求，要求用户重新提供原代码，或倾向重新生成示例程序。
```

这不是单纯的 DeepSeek 网页会话是否复用问题。插件侧也必须在后续请求中恢复可执行上下文：上一轮用户目标、上一轮涉及文件、最近对话摘要、Agent 状态和最近文件记忆。

## 2. 官方行为确认

### GitHub Copilot

GitHub Copilot Chat 官方说明中，Copilot 生成回答时会使用当前文件、聊天历史等额外上下文；用户可以在下一条请求中引用上一条回答，或保留建议后要求修改。

参考：

- <https://docs.github.com/en/copilot/concepts/prompting/prompt-engineering>
- <https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent>

关键结论：

- 同一 conversation 中，后续请求应能引用前文。
- Copilot cloud agent 从 Chat 启动时会携带聊天上下文，运行中仍可在同一 conversation 继续追问进度。
- 需要保持 history 相关性；不相关上下文应删除或新开 conversation。

### Claude Code

Claude Code 官方说明中，CLI 支持继续最近 conversation 或按 session 恢复；VS Code 集成支持从 session history 恢复，并加载完整 message history；SDK 文档也说明可复用 session id，继续时保留文件读取、分析和 conversation history。

参考：

- <https://code.claude.com/docs/en/cli-reference>
- <https://code.claude.com/docs/en/ide-integrations>
- <https://code.claude.com/docs/en/agent-sdk/overview>
- <https://code.claude.com/docs/en/memory>

关键结论：

- `claude -c` / `claude -r` 表达的是继续或恢复，而不是新开任务。
- VS Code 侧恢复会加载 full message history。
- 每个新 session 是 fresh context window；跨 session 需要 `CLAUDE.md` 或 auto memory，但同 session/恢复 session 应保留历史。

### OpenAI Codex

Codex 官方 prompting 文档说明：thread 是单个 session，包含用户 prompt、模型输出和 tool calls；一个 thread 可以包含多个 prompts，后续 prompt 可以要求添加测试；Codex 也会从文件内容、工具输出、已做和待做记录中继续收集上下文。

参考：

- <https://developers.openai.com/codex/prompting>
- <https://developers.openai.com/codex/guides/agents-md>

关键结论：

- 同一 thread 多轮 prompt 是一等模型。
- 后续 prompt 应基于 thread 内历史和工具活动继续。
- 长任务可以 compact，但 compact 后仍应保留相关摘要。
- `AGENTS.md` 适合放稳定项目规则，不替代 thread 内的任务历史。

## 3. DevSeek 最适合的方式

DevSeek 当前是 VS Code 插件 + DeepSeek Web Bridge + 本地 Agent Loop 的组合，不能只依赖 DeepSeek 网页本身的历史。最佳方案是三层同时工作：

| 层 | 职责 | 本轮处理 |
| --- | --- | --- |
| DeepSeek 网页 session | 保持浏览器页面会话，不主动新开 | 已有 `newSession: false` 路径保留 |
| 插件 session history | 保存主聊天 user/assistant 历史，支持重启恢复和摘要 | 本轮让 bridge 主聊天也写入插件侧 history |
| Agent session context | 保存上一轮目标、摘要、涉及文件、最近文件记忆 | 本轮扩展续作检测，并同时注入 Agent 与普通 chat prompt |

设计原则：

- 不把所有新请求都强行绑定旧任务。
- 只在用户话术明显是续作、纠偏、追问、基于已有代码修改时注入上下文。
- 注入内容必须短，优先保留文件路径、上一轮目标、执行状态、最近对话摘要。
- 如果用户点击新对话或显式新 session，清空本轮上下文。

## 4. 本轮代码变更

新增：

```text
packages/vscode-extension/src/app/session-continuation.ts
packages/vscode-extension/test/unit/session-continuation.test.mjs
```

更新：

```text
packages/vscode-extension/src/extension.ts
packages/vscode-extension/src/llm-agent-loop.ts
packages/vscode-extension/test/run-all.mjs
```

### 4.1 续作判断

新增纯逻辑模块，识别这些后续话术：

- `继续/上次/刚才/上一轮/在 ... 基础上`
- `原来的/原有/已有/现有/之前`
- `不要重写/不要重新写/另写了一个`
- `为什么不在原来的代码中修改`

截图中的 prompt 已纳入单测。

### 4.2 Agent 与普通 Chat 共用上下文注入

原先只有 Agent 路径在少数命中词下会拼接：

```text
【同一会话续作上下文】
...
```

本轮改为：

- Agent decomposer / editor prompt 使用同一续作判断。
- 普通 chat 路径也会在命中续作且存在真实 session context 时注入。
- 没有 session context 时不注入，避免误伤新任务。

### 4.3 Bridge 主聊天记录插件侧历史

原先 `routeChat()` 遇到 bridge provider 会直接 `return chat()`，主聊天不会写入 `nonBridgeChatHistory`，导致插件侧缺少可恢复 history。

本轮改为：

- bridge provider 返回后也调用统一的 `recordTrackedChatHistory()`。
- 非 bridge provider 继续使用同一个记录函数。
- session 保存、40 条压缩、summary primer 逻辑保持一致。

### 4.4 LLM Agent Loop 首轮用户消息入历史

`runLLMAgentLoop()` 原先初始化空 history，第一轮只在 messages 里临时加 user prompt，随后只把 assistant 输出追加到 history。

本轮改为：

- 初始化 history 时写入首轮 user prompt。
- 后续自动轮能看到原始任务和 assistant 输出，而不是只看到 assistant 输出。

## 5. 验证

已通过：

```bash
npm run compile --workspace=packages/vscode-extension
node --test test/unit/session-continuation.test.mjs
node --test test/unit/chat-controller.test.mjs
node --test test/unit/llm-agent-loop.test.mjs
```

## 6. 后续建议

- 增加一个 extension-level harness：模拟 `newSession=false`，第一轮生成/修改文件，第二轮发送截图同类纠偏话术，断言 `effectiveFiles` 自动恢复。
- 将 `nonBridgeChatHistory` 改名为 `sessionChatHistory`，因为它现在同时服务 bridge 和非 bridge provider。
- 后续拆 `extension.ts` 时，把 session restore、recent files、agent state、summary compact 收敛到独立 SessionContextService。
