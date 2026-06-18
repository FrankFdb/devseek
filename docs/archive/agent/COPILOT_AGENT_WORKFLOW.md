# Copilot Agent 执行流程参考手册

> 目的：描述 GitHub Copilot Chat Agent 模式的完整执行流程，用于 DeepSeek 插件对齐参照  
> 来源：`workbench.desktop.main.js`（VS Code 1.112.0）对照分析 + NLS strings + 官方文档（code.visualstudio.com 2026-05-26）  
> 创建日期：2026-05-13 · 最近更新：2026-05-26（新增 §八：Agent 类型体系、Permission Levels、文件编辑模型、Checkpoint、Queue/Steer、Memory、未实现功能优先级；新增 §九：LLM 内部推理流程与视觉叙事四阶段模型）  
> **关联文档**：
> - [COPILOT_DISPLAY_STYLE_REFERENCE.md](./COPILOT_DISPLAY_STYLE_REFERENCE.md) — 显示风格参照（thinking box、Todo widget 等）
> - [DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md](./DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md) — 差距分析与修复记录

---

## 一、整体执行流程图

```
用户发送请求
    │
    ▼
[意图识别]
  - 判断是否为 agent 模式
  - 若 intentMode=agent → _runLoop()
  - 若普通对话 → 单轮 chat()
    │
    ▼
[Agent 规划阶段（可选）]
  - AI 调用 manage_todo_list(todoList=[...]) 创建任务清单
  - Todo widget 出现在输入框上方
    │
    ▼
[_runLoop：多轮执行]
  ┌─────────────────────────────────────────────────────┐
  │  for (round = 0; round < toolCallLimit; round++)    │
  │    if (taskCompleted) → break                       │
  │    if (yieldRequested && !autopilot) → break        │
  │                                                     │
  │    result = await runOne(turn, round)               │
  │      1. buildPrompt2(context, tools, todoContext)   │
  │      2. llm.stream(prompt) → streaming response    │
  │      3. for each toolCall in response:              │
  │           executeToolCall(toolCall)                 │
  │           追加工具行到 thinking box                 │
  │           结果追加到 sessionHistory                 │
  │      4. 无工具调用 → 隐式完成 → break              │
  │      5. task_complete 调用 → 显式完成 → break      │
  └─────────────────────────────────────────────────────┘
    │
    ▼
[完成阶段]
  - setFallbackTitle() 无条件调用
  - thinking box 折叠：标题 → "Finished with N step(s)"
  - AI prose 正文（下方大字）

工具调用上限：toolCallLimit ≈ 25（autopilot 模式可达 200）

**DeepSeek 实现**：✅ `AGENTIC_ROUNDS_NORMAL = 25`（普通模式）/ `AGENTIC_ROUNDS_AUTOPILOT = 200`（autopilot 模式），通过 `callbacks.autopilot` 动态切换；`MAX_TASK_ROUNDS` 同步从 5 → 20（autopilot 模式）
```

---

## 二、各阶段详细说明

### 2.1 意图识别

Copilot 在接收用户消息后先判断是否应进入 agent 模式：
- 参数 `permissionLevel`：`"autopilot"` / `"autoApprove"` / `"singleFile"` / `"none"`
- `shouldUseAgentMode()` 检查用户意图（文字分析 + 配置）

DeepSeek 当前实现：
- ✅ `shouldUseAgentMode(prompt, agentEnabled)` 已实现
- ✅ `devseek.agentEnabled` 开关 + 状态栏切换按钮

### 2.2 规划阶段

AI 通过 `manage_todo_list` 工具创建任务清单：

```javascript
// AI 输出（文本格式工具调用）：
[TOOL:manage_todo_list {"todoList": [
  {"id": 1, "title": "分析现有代码结构", "status": "not-started"},
  {"id": 2, "title": "修改核心逻辑", "status": "not-started"},
  {"id": 3, "title": "更新相关测试", "status": "not-started"}
]}]
```

**Copilot 中 Todo Widget 位置**：`chat-todo-list-widget`（输入框区域，独立于响应流）

**DeepSeek 当前实现**：Todo 在响应流内的 `aut-container`（✅ 可用，与 Copilot 不同但功能等效）

### 2.3 执行阶段（每个任务）

每执行一步：
1. AI 调用 `manage_todo_list` 将目标任务状态改为 `"in-progress"`
2. AI 调用工具（read_file / grep / list_dir / run_terminal 等）
3. 每次工具调用 → thinking box 追加一行（`.chat-thinking-tool-wrapper`）
4. 工具结果注入下一轮 prompt
5. AI 调用 `manage_todo_list` 将已完成任务状态改为 `"completed"`

**Working 标题动态更新**：
- 执行中：`Working: {invocationMessage}` 或 `Working: Reading {file}`
- 每次工具调用后实时更新标题

### 2.4 完成阶段

AI 明确完成时：
1. 输出最终摘要 prose（自然语言，下方大字）
2. 调用 `task_complete` 工具（显式完成）或停止调用工具（隐式完成）
3. `setFallbackTitle()` 无条件调用：
   - `appendedItemCount > 0` → `"Finished with N step(s)"`
   - `appendedItemCount === 0` → `"Finished Working"`

**失败/中断时** `setFallbackTitle()` 同样无条件调用——不会停留在 `"Working: ..."` 状态。

### 2.5 Autopilot vs 手动模式

| 模式 | DeepSeek 配置 | 行为 |
|------|-------------|------|
| autopilot 开启 | `devseek.autopilotMode = true` | 执行到 task_complete，自动接受所有文件改动 |
| autopilot 关闭（默认）| `devseek.autopilotMode = false` | Agent 完成后显示 Keep / Undo 确认 |

---

## 三、工具系统

### 3.1 Copilot 原生工具调用（function calling）

Copilot 使用 VS Code LM API 原生 function calling，AI 以结构化 JSON 返回工具调用。

**Copilot 完整内置工具表（官方文档 2026-05-26 确认，工具 ID = 用 `#` 引用的名称）：**

| 工具集 | 工具 ID | 功能 |
|--------|---------|------|
| `#todos` | manage_todo_list 等效 | 追踪任务清单进度 |
| `#read` (tool set) | — | 读取工作区文件 |
| `#read/readFile` | read_file | 读取文件内容 |
| `#read/problems` | get_errors | 获取 Problems 面板中的问题 |
| `#read/terminalLastCommand` | terminal_last_command | 获取最近终端命令及输出 |
| `#read/terminalSelection` | terminal_selection | 获取终端当前选中内容 |
| `#read/getNotebookSummary` | copilot_getNotebookSummary | 获取 Notebook 摘要 |
| `#search` (tool set) | — | 搜索工作区 |
| `#search/textSearch` | grep_search | 文本搜索（支持正则）|
| `#search/codebase` | semantic_search | 代码语义搜索 |
| `#search/fileSearch` | file_search | 按 glob 搜索文件 |
| `#search/listDirectory` | list_dir | 列出目录内容 |
| `#search/usages` | vscode_listCodeUsages | 查找引用 / 跳转定义 |
| `#search/changes` | get_changed_files | 获取源码变更列表 |
| `#edit` (tool set) | — | 修改工作区 |
| `#edit/editFiles` | edit_file / write_file | 编辑或创建文件 |
| `#edit/createFile` | create_file | 创建新文件 |
| `#edit/createDirectory` | create_directory | 创建目录 |
| `#execute` (tool set) | — | 执行代码/命令 |
| `#execute/runInTerminal` | run_in_terminal / run_terminal | 在集成终端运行命令 |
| `#execute/getTerminalOutput` | get_terminal_output | 获取终端命令输出 |
| `#execute/createAndRunTask` | create_and_run_task | 创建并运行工作区任务 |
| `#vscode/runCommand` | run_vscode_command | 运行 VS Code 命令 |
| `#vscode/installExtension` | install_extension | 安装 VS Code 扩展 |
| `#vscode/askQuestions` | vscode_askQuestions | 向用户提出澄清问题 |
| `#web/fetch` | fetch_webpage | 获取网页内容 |
| `#agent/runSubagent` | runSubagent | 在独立 subagent 中运行任务 |
| `#githubRepo` | github_repo | 语义搜索 GitHub 仓库 |

> ⚠️ **架构说明**：Copilot 通过 VS Code LM API 的 native function calling 调用这些工具（结构化 JSON），不是文本嵌入格式。工具上限：每次请求最多 128 个工具。

### 3.2 DeepSeek 文本格式工具调用

DeepSeek 使用文本嵌入格式（非原生 function calling），由 `parseFakeToolCalls()` 解析：

```
[TOOL:tool_name {"param": "value"}]
```

支持的工具（DevSeek 工具名 → 对应 Copilot 工具）：

> ⚠️ **实现位置更正**：所有工具处理器均在 `agent-loop.ts`（`executeFakeToolsForLoop()`），**不是** `llm-agent-loop.ts`（该文件是独立的轻量级单步 chat 封装，不含工具系统）。

| DevSeek 工具名 | 对应 Copilot 工具 ID | 功能 | 实现位置 | 状态 |
|---------------|---------------------|------|---------|------|
| `manage_todo_list` | `#todos` | 创建/更新任务清单（全量替换） | `agent-loop.ts` L329 → `onTodoUpdate` callback | ✅ |
| `task_complete` | （自定义，无对应）| 显式完成 agent 循环 | `agent-loop.ts` L337 → 设置 `taskComplete=true` | ✅ |
| `read_file` | `#read/readFile` | 读取文件内容（绝对/相对路径，最多 8KB）| `agent-loop.ts` L362 → `onReadFile` callback | ✅ |
| `list_dir` | `#search/listDirectory` | 列出目录内容 | `agent-loop.ts` L381 → `onListDir` callback | ✅ |
| `grep_search` | `#search/textSearch` | 文本/正则搜索工作区文件 | `agent-loop.ts` L395 → `onGrepSearch` callback | ✅ |
| `file_search` | `#search/fileSearch` | glob 模式搜索文件路径 | `agent-loop.ts` → `onFileSearch` callback | ✅ |
| `semantic_search` | `#search/codebase` | 语义代码搜索（关键词 OR 宽泛搜索）| `agent-loop.ts` → 内部调用 `onGrepSearch` | ✅ |
| `run_terminal` | `#execute/runInTerminal` | 执行终端命令（非 autopilot 模式需用户确认） | `agent-loop.ts` L266 → `onTerminalCommand` callback | ✅ |
| `get_errors` | `#read/problems` | 获取 VS Code 编译/诊断错误 | `agent-loop.ts` L412 → `onGetErrors` callback | ✅ |
| `memory_write` | （自定义，近似 `#memory`）| 向 `.devseek/memory.md` 写入持久记录 | `agent-loop.ts` L420 → `onMemoryWrite` callback | ✅ |
| `mcp__*` | （动态 MCP 工具）| 路由到外部 MCP server | `agent-loop.ts` L433 → `onMcpToolCall` callback | ✅ |
| `edit_file` / `write_file` | `#edit/editFiles` | **文件编辑通过 SEARCH/REPLACE 块实现**，参见下方说明 | `agent-loop.ts` L1189 `applySearchReplaceBlocks()` | ✅ |

> ⚠️ **文件编辑说明**：DevSeek 不使用 `[TOOL:edit_file ...]` 格式进行文件编辑，而是 AI 在响应文本中输出 SEARCH/REPLACE 格式的代码块：
> ```
> <<<<<<< SEARCH
> 旧代码
> =======
> 新代码
> >>>>>>> REPLACE
> ```
> 这些块由 `applySearchReplaceBlocks()` 解析并应用。这与 Aider/Cursor 的实现方式相同，是文件编辑的实际工作机制。

### 3.3 工具调用过滤

`[TOOL:...]` 文本块不显示在 prose 正文中：
- ✅ `stripToolCallBlocks()` 过滤调用文本，只保留自然语言部分

---

## 四、上下文管理

### 4.1 多轮历史传递

Copilot：每轮携带完整对话历史（全量）

DeepSeek（`sessionHistory: ChatMessage[]`）：
- ✅ 跨任务传递摘要式历史（非全量，但包含关键结果）
- ✅ `priorFindings` 摘要注入 Decomposer prompt
- ✅ `analysisContext` 注入 Editor prompt（2026-05-12）

### 4.2 Todo 上下文注入

Copilot：`getCurrentTodoContext()` 在每轮 build prompt 时自动注入当前 todo 状态

DeepSeek：
- ✅ `agentTasks[]` 数组传递给 `buildDecomposerPrompt`
- ✅ AI 可通过 `manage_todo_list` 动态更新状态

### 4.3 跨轮记忆建议（最佳实践）

当用户说"按照上面的建议" / "根据之前的分析"时：
- ✅ `lastAnalysisText` 通过 `analysisContext` 参数注入 Editor prompt（2026-05-12）
- AI 知道上轮建议内容，不会输出空泛修改

---

## 五、DeepSeek 执行流程（当前实现）

```
用户发送消息
    │
    ▼
extension.ts: handleChatMessage()
    │
    ├─[普通对话] → routeChat() → LLM provider → 流式渲染
    │
    └─[Agent 模式] → shouldUseAgentMode() = true
         │
         ▼
    decomposeTask(prompt, files, chatFn)   ← chatFn 通过 routeChat 路由到配置 provider
         │ 返回 AgentTask[]
         ▼
    runAgentLoop(tasks, options)
         │
         ├── 为每个 task 调用 executeTask(task, ...)
         │     ├── buildEditorPrompt(task, analysisContext)
         │     ├── routeChat({ prompt, stream: true, onDelta })
         │     │     ├─[bridge 模式] → bridge/deepseek-agent.ts
         │     │     ├─[API 模式]   → deepseek-api.ts (useStream = !!onDelta)
         │     │     └─[兼容模式]   → openai-compat.ts (useStream = !!onDelta)
         │     ├── parseFakeToolCalls() → handleTodoUpdate() / file edits
         │     └── postMessage('agentToolActivity', {activityKind, activityLabel})
         │
         └── task_complete 调用 → 早退（processFakeTools）
    │
    ▼
webview.js: 渲染
    - agentToolActivity → .aut-steps-list 追加 .aut-step 行
    - Working 标题动态更新：Reading…(N)
    - 完成后：'Finished with N step(s)'，data-done 停止动画
```

---

## 六、关键对齐状态（2026-05-13）

| 流程环节 | Copilot 标准 | DeepSeek | 状态 |
|---------|------------|---------|------|
| 多轮 Agent 循环 | `_runLoop` → `runOne` | `runAgentLoop` → `executeTask` | ✅ 对齐 |
| 工具调用解析 | 原生 function calling | `parseFakeToolCalls()` 文本解析 | ✅ 等效 |
| manage_todo_list | AI 主动调用，全量替换 todoList | ✅ 同等行为 | ✅ 对齐 |
| task_complete | AI 调用后 break 循环 | ✅ `processFakeTools()` 早退 | ✅ 对齐 |
| 上下文传递 | 全量历史 | 摘要式历史 | 🟡 近似 |
| 每步 thinking box 追加 | 每次工具调用追加一行 | ✅ `.aut-step` 行逐步追加 | ✅ 对齐 |
| 每任务独立 Working 框 | 每轮 LLM 新框 | ✅ per-task container（2026-05-13）| ✅ 对齐 |
| Working 标题 | `Working: {detail}` 实时更新 | ✅ `Reading…(N)` 等 | ✅ 对齐 |
| 完成标题有意义 | task 描述/文件名 | ✅ `buildFinishedLabel()`（2026-05-13）| ✅ 对齐 |
| 完成标题 | `Finished with N step(s)` | ✅ 任务描述 + step 数 | ✅ 对齐 |
| Todos 框持久显示 | input 区域上方，agent 完成后保留 | ✅ `#agent-todos-widget`（2026-05-13）| ✅ 对齐 |
| Todos 主文字为描述 | 任务意图描述（非文件名）| ✅ desc-first（2026-05-26 修复）| ✅ 对齐 |
| Todos 无图标动画 | 进行中图标无 blink | ✅ 移除 `wiBlink`（2026-05-26 修复）| ✅ 对齐 |
| setFallbackTitle 无条件 | 失败时也调用 | ✅ done/fail 均触发 | ✅ 对齐 |
| prose 在 thinking box 下方 | ✅ DOM 顺序 | ✅ deferred bubble 模式 | ✅ 对齐 |
| autopilot 模式 | permissionLevel=autopilot | ✅ `devseek.autopilotMode` | ✅ 对齐 |
| API 模式流式一致性 | stream body 与处理方式统一 | ✅ `useStream = !!onDelta`（2026-05-13）| ✅ 对齐 |
| 长生成超时保护 | deadline 不固定 | ✅ 文本增长时重置 deadline（2026-05-13）| ✅ 对齐 |
| VS Code LM API 集成 | `vscode.lm.*` 原生调用 | 无（自建 provider 体系）| 🔴 架构差异 |
| 原生 function calling | JSON 结构化工具调用 | 文本格式 `[TOOL:...]` | 🟡 逻辑等效 |

## 七、顺序嵌套 Working 框（Copilot 核心 UX 模式）

### 7.1 每轮 Working 框时序

每一轮 LLM 调用（`runOne()`）生成一个独立的 Working 框：

```
round 1                          round 2
┌──────────────────────────┐    ┌──────────────────────────────┐
│ ⟳ Working: Reading X      │ → │ ⟳ Working: Editing main.cpp  │
│   🔍 Searched for ...     │    │   📄 Read CMakeLists.txt     │
│   📄 Read foo.hpp         │    │   ✏  Edited main.cpp +8 -2  │
└──────────────{ done }─────┘    └──────────────{ done }────────┘
│                                │
▼                                ▼
✓ Reviewed 4 files  ›             ✓ Finished with 2 step(s)  ›
                                 AI prose: "已完成修改..."
```

**完成时序**：
1. 工具调用结束 → `setFallbackTitle()` 被调用
2. 折叠区 `open` 属性移除（自动收起）
3. 标题变为 `Finished with N step(s)`（N = 该轮工具调用数）
4. 下一轮开始 → 在下方追加新的 Working 框（`open` 状态）

### 7.2 DeepSeek 当前实现差距

| 特性 | Copilot | DeepSeek 当前 | 目标 |
|------|---------|-------------|------|
| 每任务独立 Working 框 | ✅ 每轮 LLM 独立 | ✅ 已实现（2026-05-13）| ✅ 已对齐 |
| 前一框完成自动折叠 | ✅ 新轮开始时前轮关闭 | ✅ 已实现（2026-05-13）| ✅ 已对齐 |
| 完成标题有意义 | 自定义（invocationMessage）| ✅ `buildFinishedLabel()`：动作前缀 + 任务描述（2026-05-13）| ✅ 已对齐 |
| 每框独立计步 N | ✅ 该轮的 appendedItemCount | ✅ `agentActivityCounts` 每任务重置 | ✅ 已对齐 |
| Todos 框持久显示 | ✅ input 区域上方，独立 | ✅ `#agent-todos-widget`，用户发新消息才清除（2026-05-13）| ✅ 已对齐 |
| Todos 框关闭按钮 | ✅ 有 Clear All | ✅ `[×]` 关闭按钮 | ✅ 已对齐 |
| File Changes 框 | ✅ input 区域上方，独立 | ✅ `#agent-file-changes-widget`，按文件列表+diff计数，用户发新消息才清除（2026-05-12）| ✅ 已对齐 |

### 7.3 实现方案（已规划）

通过 `finalizeExecContainer()` + 每次 `execute:started` 新任务时创建新容器实现：

```
execute:started taskIndex=1 → 关闭上一个容器(plan容器) → 创建 task-1 容器
[agentToolActivity × N]    → 步骤追加到 task-1 容器的 aut-steps-list
execute:completed taskIndex=1 → task-1 容器保持（等下一个任务触发折叠）
execute:started taskIndex=2 → 关闭 task-1 容器 → 创建 task-2 容器
...
agentStatus done → 关闭最后一个容器
```

---

*本文档描述执行流程，显示风格详见 [COPILOT_DISPLAY_STYLE_REFERENCE.md](./COPILOT_DISPLAY_STYLE_REFERENCE.md)*

---

## 八、Copilot 最新架构（官方文档 2026-05-26 确认）

> **本节补充当前文档中缺失或描述不准确的架构信息，均基于官方文档实测확认。**

### 8.1 Agent 类型体系（2026 年大幅扩展）

Copilot 现在有**四种 Agent 类型**，不只是之前文档中描述的单一"local agent"：

| Agent 类型 | 运行环境 | 交互方式 | 适用场景 |
|-----------|---------|---------|---------|
| **Local** | VS Code 本地 | 交互式 Chat view | 当前工作区内的交互式编码 |
| **Copilot CLI** | 本地后台 | 后台运行，可选 Git worktree | 不中断工作的后台任务 |
| **Cloud** | GitHub 远程 | 异步，PR 协作 | 创建 PR、分配 GitHub Issue |
| **Third-party** | 本地或云端 | 独立（Anthropic/OpenAI SDK）| Claude Claude Code, OpenAI Codex |

**Local agent 三种内置模式**：

| 模式 | 名称 | 用途 |
|------|------|------|
| `agent` | **Agent** | 自主规划 + 多文件编辑 + 工具调用 + 自我修正 |
| `plan` | **Plan** | 生成结构化实施计划，再移交 Agent 实施 |
| `ask` | **Ask** | 代码问答/分析，不修改文件 |

> ⚠️ **Note**: `Edit mode` 已在 2026 版本中被废弃（deprecated），所有多文件修改应使用 `Agent` 模式。

**DeepSeek 差距**：
- 🔴 无 cloud agent / CLI agent 概念
- 🟡 Local Agent 模式部分对应 (`runAgentLoop` ≈ `Agent` 模式；分析模式 ≈ `Ask` 模式)
- 🔴 无专用 `Plan` 模式（Decomposer 有类似功能但无独立交互式计划）

---

### 8.2 Permission Levels（权限级别 — ⚠️ 已更新，非旧版 autopilot）

旧文档仅提 `autopilot on/off`。官方文档显示此系统已进化为三级：

| 级别 | 设置名 | 工具审批行为 | 澄清问题行为 |
|------|--------|-----------|------------|
| **Default Approvals** | （默认）| 按 VS Code 设置，危险工具需确认 | AI 会主动提问 |
| **Bypass Approvals** | `chat.permissions.default` | 自动批准所有工具调用，无确认对话框 | AI 会主动提问 |
| **Autopilot** (Preview) | `chat.permissions.default` | 自动批准所有工具调用 | **自动回复**，无需用户 |

`chat.permissions.default` 可跨 session 持久化首选级别。

**DeepSeek 当前实现**：`devseek.autopilotMode` = true/false，对应 Bypass Approvals 和 Default Approvals 两档，缺少 **Autopilot（持续自主迭代）** 第三档。

---

### 8.3 文件编辑模型（⚠️ 重要修正 — 非纯内存 staging）

旧文档暗示文件改动在内存中 staging，用户 Keep/Undo 才写入。**实际机制**：

```
AI 调用 #edit/editFiles
    │
    ▼
文件立即写入磁盘（直接保存，非 staging）
    │
    ▼
VS Code 追踪"待审查"(pending)状态：
  - Chat view 显示 changed files 列表（带 × 按钮）
  - Explorer 视图 + 编辑器标签页显示 ⬝（squared-dot）指示图标
  - 打开文件时内联 diff 视图（可 Up/Down 导航各个 diff hunk）
    │
    ▼
用户审查选项（每个 diff hunk 独立）：
  - Keep（单个 hunk）← 编辑器 overlay 控件
  - Undo（单个 hunk）← 编辑器 overlay 控件
  - 也可 Keep All / Undo All（来自 Chat view 底部操作）
    │
    ▼
Source Control staging → 自动接受所有 pending 改动
或 Discard → 自动放弃所有 pending 改动
```

相关设置：
- `chat.editing.revealNextChangeOnResolve` — 接受/拒绝一个 hunk 后自动跳到下一个（默认开启）
- `chat.editing.autoAccept` — 可选：N 秒倒计时后自动接受所有改动
- `chat.tools.edits.autoApprove` — glob 模式控制哪些文件修改需要审批（用于保护 `.env`、`.vscode/` 等敏感文件）

**DevSeek 差距（已更新 — 纠正旧描述）**：
- ⚠️ **DevSeek 文件写入机制**：`applySearchReplaceBlocks()` 解析 SEARCH/REPLACE 块 → 直接写入磁盘（`vscode.workspace.fs.writeFile()`），**不是**内存 staging
- ✅ `#pending-edits-area` + Keep/Undo 按钮：Undo **真正还原文件内容**（写回 `oldContent`），Keep 保留新内容 — 与 Copilot 行为完全等效
- ✅ **编辑器内联 diff 视图 + CodeLens Keep/Undo 按钮**（`DiffDecorationManager` in `src/diff-decorator.ts`，2026-05-27）
  - 每个 hunk 上方 CodeLens 显示 `$(check) 保留改动` / `$(discard) 撤销改动` + 行数统计 `[+N -M]`
  - 绿色高亮（纯增行）/ 黄色高亮（修改行）使用 VS Code 主题色 token
  - Keep/Undo 后自动滚动到下一个待决 hunk（`revealNextPendingHunk`）
  - Overview ruler 指示（右侧滚动条高亮）
- ✅ Explorer / 标签页的 ⬝ 指示图标（`PendingEditDecorationProvider`, 2026-05-27）
- ✅ Hunk 级 Keep/Undo：webview 面板 + 编辑器 overlay CodeLens 双通道（2026-05-27）
- ✅ `devseek.editAutoAcceptDelay` 自动接受机制（N 秒后自动 Keep All, 2026-05-27）
- ✅ `devseek.protectedFiles` glob 列表（**超越 Copilot**：硬阻断，不只是审批流程控制，2026-05-27）

---

### 8.4 Checkpoint 系统（⚠️ 2026 新功能，文档中 §19.3 描述不完整）

Copilot 的 checkpoint 系统实现如下：

```
用户发送 prompt
    │
    ▼
VS Code 自动创建 checkpoint（每个 chat request 前快照受影响文件）
    │
    ▼
AI 执行（可能改多个文件）
    │
    ▼
用户可对任意 checkpoint：
  - Restore Checkpoint → 回滚到该时刻的所有文件状态 + 删除后续 chat history
  - Redo → 恢复 restore 操作
  - Fork Conversation → 基于该 checkpoint 创建新的独立 session
```

相关设置：
- `chat.checkpoints.enabled` — 开启 checkpoint 功能（opt-in）
- `chat.checkpoints.showFileChanges` — 在每个 chat request 末尾显示变更文件列表+行数

**DevSeek 当前实现**（`extension.ts` L193-L201）：
- ✅ 存在 `saveAgentCheckpoint()` / `loadAgentCheckpoint()` 机制，保存 `AgentTaskCheckpoint`（当前任务 index + 剩余任务列表）
- ✅ **网络断线续传**：当 `isNetworkError(err)` 时，从上次完成的任务 index 恢复，而不需要重新运行整个 agent
- ✅ Webview banner：`agentCheckpointAvailable` 消息类型，向用户显示断点恢复选项
- ⚠️ **与 Copilot checkpoint 的关键区别**：
  - DevSeek 保存的是「任务进度」（哪个任务完成了），**不是文件状态快照**
  - 不支持"回滚到过去某个时间点的文件状态"
  - 不支持 Fork Conversation
  - 本质是「断线续传」而非「历史状态恢复」

---

### 8.5 Queue/Steer Messages（⚠️ 新功能，文档未提及）

Copilot 允许用户**在 agent 工作过程中**发送后续消息，有三种处理方式：

| 模式 | 行为 |
|------|------|
| **Queue** | 排队等待当前请求完成后再处理 |
| **Steer** | 将新消息注入当前运行中的 agent，改变其方向 |
| **Stop and send** | 停止当前 agent run，立即以新消息重新开始 |

**DevSeek 实现状态**：✅ **已完整实现**（2026-05-13，webview.js §8.5 Queue/Steer 节）

| 功能 | DevSeek 实现方式 | webview.js 位置 |
|------|----------------|---------------|
| **Queue** | `queuedAgentMsg` 变量保存后续消息，等 `endResponse` 后自动发送 | L72（声明）, L882（赋值）|
| **Steer** | 点击"⏩ 中断发送"按钮：调用 `stopCurrentAgent()` 再立即发送排队消息 | L898-L924 |
| **UI 指示器** | `#agent-queue-indicator`：显示"已排队"提示 + "⏩ 中断发送"按钮 | L898-L907 |
| **endResponse 钩子** | `endResponse` 消息触发时检测 `queuedAgentMsg` 并自动发送 | L4269-L4271 |

> ✅ 此功能已完整实现，与 Copilot 的 Queue/Steer 行为功能等效。

---

### 8.6 Agent Memory（⚠️ 新功能，文档未提及）

Copilot 提供跨 session 持久记忆：
- 由 `#todos` + 专用记忆工具在对话间保存笔记
- `github.copilot.chat.tools.memory.enabled` — 开关
- `Chat: Show Memory Files` 命令可查看存储内容
- Plan agent 使用记忆来跨 session 维护任务上下文

**DevSeek 实现状态**：🟡 **部分实现**

- ✅ `memory_write` 工具已实现（`agent-loop.ts` L420；写入 `.devseek/memory.md`）
- ✅ AI 可在对话中调用 `[TOOL:memory_write {...}]` 写入持久记录
- ✅ `.devseek/memory.md` 在每次 agent 调用的 system prompt 中读取注入，实现单工作区持久记忆
- ✅ `devseek.showMemoryFiles` 命令：在编辑器中打开 `.devseek/memory.md`（直接对应 Copilot `Chat: Show Memory Files`，2026-05-27）
- 🔴 跨工作区/跨 VS Code 实例的全局持久记忆尚未实现（Copilot 记忆存储在用户账户层面）

---

### 8.7 Sessions 持久化（当前 DevSeek 部分实现）

| 特性 | Copilot | DevSeek | 状态 |
|------|---------|---------|------|
| Session 持久化到磁盘 | ✅ 关闭 VS Code 后 session 继续 | ✅ `sessions-panel` + 历史列表 | 🟡 部分对齐 |
| Sessions list UI | ✅ 独立侧边栏面板，带进度/统计 | ✅ `sessions-panel` 实现 | 🟡 部分对齐 |
| 远程 agent session | ✅ 可在浏览器/手机监控 | 🔴 无 | 🔴 架构差距 |
| Session handoff | ✅ 可移交给 CLI/Cloud agent | 🔴 无 | 🔴 架构差距 |

---

### 8.8 未实现功能优先级建议（2026-05-27 更新）

| 优先级 | 功能 | 实现复杂度 | 对用户价值 | 状态 |
|--------|------|-----------|-----------|------|
| ~~P1~~ | ~~**Queue/Steer messages**（agent 运行中发消息）~~ | ~~中~~ | ~~高~~ | ✅ 已实现 |
| ~~P2~~ | ~~**敏感文件保护**（autoApprove glob 规则）~~ | ~~低~~ | ~~中~~ | ✅ 已实现（`devseek.protectedFiles` 硬阻断 glob, 2026-05-27）|
| ~~P3~~ | ~~**跨 session 记忆**（memory_write 工具）~~ | ~~高~~ | ~~中~~ | ✅ 已实现（工作区级） |
| ~~P3b~~ | ~~**记忆文件查看命令**~~ | ~~低~~ | ~~低~~ | ✅ `devseek.showMemoryFiles`（2026-05-27）|
| ~~P1~~ | ~~**编辑器内联 diff 视图**（diff hunk 导航）~~ | ~~高~~ | ~~极高~~ | ✅ 已实现（`DiffDecorationManager` + CodeLens Keep/Undo + `revealNextPendingHunk`，2026-05-27）|
| P2 | **Checkpoint restore**（回滚文件状态能力）| 高 | 高 | 🔴 |
| P2 | **Agentic free-explore 模式**（无代码文件时的 Claude Code 风格循环） | 中 | 高 | ✅ 已实现（`runAgenticLoop`）|
| P3 | **Plan 模式**（规划 → 执行 分离）| 中 | 中 | 🔴 |
| P4 | **后台 terminal**（Continue in Background）| 中 | 低 | 🔴 |

---

## 九、LLM 内部推理流程与视觉叙事四阶段模型（2026-05-26 截图实证分析）

> **本节基于 DevSeek 1.0.0 截图（会话「针对整理的copilot显示风格，针对截图，请对md文档进行确认审计」）与 Copilot 源码 + 官方文档的交叉验证，精确描述 LLM 处理一次 agent 请求时内部流程与屏幕上可见内容的完整对应关系。**

---

### 9.1 截图与阶段对应关系（用户分析验证）

用户对截图中四个色块的判断如下，下表给出精确验证：

| 色块 | 用户描述 | 精确描述 | 正确性 |
|------|---------|---------|-------|
| **红框 1** `Analyzed Copilot display behavior and updated COPILOT_DISPLAY_STYLE_REFERENCE.md` | 从用户输入信息，收集所有完整 input 信息 | ✅ 基本正确。这是第一轮 `runOne()` 完成后**自动折叠**的摘要行（层级 2）。折叠行内部（展开后可见）包含 LLM 读取文件、理解任务的完整推理链（层级 3）。折叠摘要≠过程本身，过程在折叠框内部。 | 🟡 大方向对，细节：摘要行是结果，推理过程在折叠框内部 |
| **红框 2** `Now I have enough context... Let me add a dedicated section:` | 收集完信息后，告诉用户接下来要做的事情 | ✅ 完全正确。这是**过渡性 prose**（transitional prose），位于第一个折叠行正下方。是 LLM 自然语言输出的桥接段，宣告下一步动作。 | ✅ 准确 |
| **红框 3** `Reviewed and updated COPILOT_DISPLAY_STYLE_REFERENCE.md` + `Now update the document header...` | 推理过程 | 🟡 部分正确。「Reviewed and updated」是第二轮执行 session 的**折叠摘要**（实际写入文件的阶段）。「Now update...」是该轮之后的过渡性 prose。推理+执行全在折叠框内部，折叠摘要只是行动总结。 | 🟡 折叠行是执行结果摘要，推理在内部 |
| **蓝框** `文档已更新（2265→2615行）... 本节分析总结：...` | 整个对话的分析、推理、行动总结 | ✅ 完全正确。这是**最终总结 prose**（层级 1 结论层），包含完整答案、结果数据、关键发现表格，是用户最应首先阅读的部分。 | ✅ 准确 |

**总体结论：用户分析框架正确，四个阶段的功能划分准确。细节补充：折叠框（红框1/3）本身是完成后的摘要行，完整推理过程在折叠框内部（需点击展开查看）。**

---

### 9.2 LLM 内部处理的四阶段完整模型

```
用户发送请求（含附件文件 + 图片 + 历史上下文）
         │
         ▼
╔════════════════════════════════════════════════════════════════╗
║  阶段 A：输入理解与分析（Information Gathering）               ║
║                                                                ║
║  LLM 内部行为（第一轮 runOne()）：                            ║
║    1. 读取用户消息全文（含附件引用、截图描述）                  ║
║    2. 调用 read_file / grep_search 读取相关文件内容            ║
║    3. 在流式输出中写出完整推理链（"The user wants me to...     ║
║       Looking at the attachment... I notice that..."）        ║
║    4. 调用 manage_todo_list 创建任务清单（可选）               ║
║                                                                ║
║  完成后 setFallbackTitle()：Working 框折叠为小字摘要行         ║
║  → 视觉：「Analyzed [描述]」灰色 11px 单行（可展开）           ║
╚════════════════════════════════════════════════════════════════╝
         │
         ▼  （折叠行下方出现）
╔════════════════════════════════════════════════════════════════╗
║  阶段 B：行动宣告（Transitional Announcement Prose）           ║
║                                                                ║
║  LLM 输出方式：不通过工具调用，直接在 currentBubble 流式输出   ║
║  内容模式：                                                    ║
║    - 首句：总结已获得的关键信息（"Now I have enough context")  ║
║    - 次句：宣告下一步行动（"Let me add a dedicated section:") ║
║    - 可含行内 Markdown（**粗体**、`代码`）                    ║
║                                                                ║
║  → 视觉：正常字号 prose 段落，无外框，1-3 句，future-oriented  ║
╚════════════════════════════════════════════════════════════════╝
         │
         ▼  （prose 之后，新 Working 框创建）
╔════════════════════════════════════════════════════════════════╗
║  阶段 C：执行（Execution Sessions，可多轮）                    ║
║                                                                ║
║  每轮 runOne() 创建一个 Working 框：                          ║
║    1. 展开状态：内容区流式渲染（代码块 + 推理文字 + 工具行）    ║
║    2. 工具调用 → 追加 .chat-thinking-tool-wrapper 行           ║
║         ✏ file.ts  +7 -0（文件编辑）                          ║
║         ⚙ npm run compile（终端命令）                         ║
║         🔍 Searched for "keyword"（搜索）                     ║
║    3. 完成 → setFallbackTitle() → 自动折叠                    ║
║         → 「Reviewed/Edited/Executed/Searched [描述]」        ║
║                                                                ║
║  每轮执行完成后：可选输出过渡性 prose（"Now update...")        ║
║  多轮执行串行排列，构成「分析进度列」                           ║
╚════════════════════════════════════════════════════════════════╝
         │
         ▼  （所有执行轮次完成后）
╔════════════════════════════════════════════════════════════════╗
║  阶段 D：最终总结（Final Summary Prose，层级 1）               ║
║                                                                ║
║  LLM 输出：最后一轮 runOne() 结束后，AI 流式输出综合结论       ║
║  内容构型：                                                    ║
║    - 首句：直接结论（"文档已更新（2265→2615行）"）             ║
║    - 中段：关键数据、原理说明、变更摘要                         ║
║    - 末段（可选）：后续建议或互动问题                           ║
║    - 完整 Markdown：**粗体**、表格、列表、`代码`               ║
║                                                                ║
║  → 视觉：大字 prose，无外框，字号 12-13px，深色前景色          ║
║    这是用户最应首先阅读的部分—答案直接可见                     ║
╚════════════════════════════════════════════════════════════════╝
```

---

### 9.3 阶段 A — 输入理解的内部机制（源码验证）

阶段 A 触发条件：`shouldUseAgentMode()` = true → `_runLoop()` 调用第一轮 `runOne()`

**LLM 在阶段 A 的实际行为（Copilot 源码 `runOne()` + 公开文档确认）：**

```javascript
// 第一轮 runOne() 大致逻辑（workbench.desktop.main.js 推断）
async function runOne(turn, round) {
  const prompt = buildPrompt2({
    // 注入全部上下文
    userMessage,          // 用户输入原文
    attachedFiles,        // 附件文件内容（#file 引用）
    chatHistory,          // 对话历史
    todoContext,          // 当前 todo 状态
    workspaceContext,     // 已打开的文件、diagnostics
    pastedImages,         // 粘贴的截图（vision 模型）
  });
  
  // 流式 LLM 调用
  for await (const delta of llm.stream(prompt)) {
    // 推理文字 → 流入 Working 框内容区（层级 3）
    // 工具调用 → 执行 + 追加工具行
  }
  // 完成 → setFallbackTitle() → 折叠
}
```

**从用户请求中收集的信息类型：**

| 信息来源 | Copilot 机制 | 信息内容 |
|---------|------------|--------|
| 用户文字 | prompt 直接注入 | 请求意图、问题描述、约束条件 |
| `#file` 引用 | `readFile()` 实时读取 | 文件内容（至上下文长度限制）|
| 粘贴图片 | vision 模型 attachment | 截图内容（UI 元素、文字、布局）|
| 对话历史 | `chatHistory[]` 全量注入 | 前N轮的用户消息 + AI 回复 |
| workspace diagnostics | `#read/problems` 工具 | 编译错误、lint 警告 |
| 已打开的文件 | implicit context | 当前激活的编辑器内容 |
| todo 状态 | `getCurrentTodoContext()` | 进行中的任务列表 |

**阶段 A 的推理链内容（层级 3 展开内容为此）：**
- LLM 以第一人称写出完整分析过程（"The user wants me to..."）
- 逐条观察用户提供的信息（"Looking at the screenshot..."、"I can see that..."）
- 中途修正思路（"I'm realizing that..."、"Wait, let me reconsider..."）
- 最终形成行动方案（"I should update section X with..."）
- 这些文字**直接流入 Working 框内容区**，不经过二次处理或概括

---

### 9.4 阶段 B — 过渡性 prose 的生成规律

**触发时机**：阶段 A 的 Working 框折叠后，LLM 在下一个工具调用之前输出普通文字。

**Copilot 源码机制**（`workbench.desktop.main.js` 分析）：
- LLM 流式输出中，非 `[TOOL:...]` 的文字片段 → `onDelta()` → 追加到 `currentBubble`
- 在两个 Working session 之间，`currentBubble` 就是这个过渡 prose 区域
- 过渡 prose 随 Working 框的 DOM 插入位置——在上一折叠行**正下方**，下一 Working 框**正上方**

**内容规律（基于截图实证 + 多次观察归纳）：**

| 过渡场景 | 典型表达 | 句数 |
|---------|---------|-----|
| 分析完成 → 开始编辑 | `"Now I have enough context. Let me [动作]:"` | 2句 |
| 一轮编辑完成 → 下一轮 | `"Now [下一步动作]:"` | 1句 |
| 搜索完成 → 分析结果 | `"I found [N] relevant items. Let me examine..."` | 1-2句 |
| 全部完成 → 最终总结 | （无明显过渡句，直接进入 Final Summary）| — |

**视觉特征**（与最终总结 prose 相同渲染方式，但内容更短）：
- 字号：12-13px（正常 prose 字号）
- 无外框、无背景
- future-oriented 时态（"Let me..."、"Now I will..."）
- 完整 Markdown 支持（行内代码、**粗体**均可出现）
- 通常 1-3 句，不超过一段

---

### 9.5 阶段 C — 执行 session 的内部结构

每个执行 Working 框（`chat-thinking-box`）的内容分三层：

```
┌─ Working ─────────────────────────── [▸折叠按钮] ─┐
│                                                    │
│  [推理层] LLM 流式文字                              │  ← 层级 3 展开可见
│  "I need to replace the old description with..."  │    （代码块 + prose 混排）
│                                                    │
│  [工具层] 工具调用追加行                             │  ← 层级 3 展开可见
│    ✏ COPILOT_DISPLAY_STYLE_REFERENCE.md  +7 -0    │    （codicon图标 + 文件名 + diff）
│    ⚙ npm run compile                              │
│                                                    │
│  [状态层] 底部实时状态（分析模式有，文件编辑可选）     │  ← 层级 3 展开可见
│    ● Considering                                  │    （斜体 11px 灰色）
└────────────────────────────────────────────────────┘
         ↓ setFallbackTitle() + 折叠
  Reviewed and updated COPILOT_DISPLAY_STYLE_REFERENCE.md  ▸  ← 层级 2（点击展开）
```

**折叠摘要行的内容来源**：
- **分析类**：AI 在该轮输出的首句或最后一句推理文字（由 `buildFinishedLabel()` 提取）
- **读文件类**：`"Reviewed [文件名] lines X to Y"`（工具调用的 invocationMessage）
- **搜索类**：`"Searched for [关键词]"`（工具调用的 invocationMessage）
- **编辑类**：`"Edited [文件名] +N -M"`（diff 统计）
- **终端类**：`"Executed [命令]"`（工具调用的 invocationMessage）

---

### 9.6 阶段 D — 最终总结 prose 的信息构型规律

**与过渡性 prose 的本质区别**：

| 维度 | 过渡性 prose（阶段 B）| 最终总结 prose（阶段 D）|
|------|--------------------|---------------------|
| 信息密度 | 低（1-3 句导航性描述）| 高（完整答案 + 数据 + 建议）|
| 时态 | 未来（"Let me..."）| 完成（"Done."、"Updated."）|
| Markdown 结构 | 纯段落 | 表格、列表、代码块均可 |
| 用户必读性 | 可跳过 | ⭐ 核心答案所在 |
| 长度 | 1-3 句 | 2-20 句（视任务复杂度）|

**最终总结的标准信息构型（截图实例）：**
```
文档已更新（2265 → 2615 行，新增§二十五 共 263 行）。    ← ① 首句：量化结论

本节分析总结：                                           ← ② 结构引导（可选 ## 标题）

Copilot 响应的三层信息架构（...）：                      ← ③ 核心内容

| 层级 | 内容 | 默认可见 | 目标读者 |              ← ④ 辅助表格（可选）
|------|------|---------|---------|  
| 层级1—结论层 | 最终 prose | ✅ | 所有用户 |
...

**关键新发现**（§25.2）：展开折叠框后...              ← ⑤ 补充说明（可选 **粗体** 引导）
```

---

### 9.7 四阶段视觉叙事的设计意图（UX 原理）

Copilot 这种设计解决的核心问题：**让不同需求层次的用户都能快速得到价值**。

```
用户类型A（只关心结论）
  → 直接看蓝框（阶段 D）= 完整答案，无需阅读上方任何内容

用户类型B（想确认做了什么）
  → 看折叠摘要行（阶段 A/C 的折叠行）= 步骤概览
  → 可选：看过渡性 prose（阶段 B）= 连接逻辑

用户类型C（需要验证细节/调试）
  → 点击展开折叠行 = 完整推理链，包括：
      - 读了哪些文件的哪些行
      - 推理中途的假设和修正
      - 工具调用的具体参数和结果
```

**工程实现要求**（对 DevSeek 的影响）：

| 要求 | Copilot 实现 | DevSeek 状态 |
|------|------------|-------------|
| 阶段A折叠框内保留完整推理链 | `chat-thinking-content` div 完整保留流内容 | ✅ `.aut-analysis-body` 保存推理内容 |
| 阶段B过渡 prose 位于折叠行下方 | `deferred bubble` DOM 顺序保证 | ✅ deferred bubble 机制 |
| 阶段C工具行实时追加 | `appendedItemCount++` 每次工具调用 | ✅ `.aut-step` 行逐步追加 |
| 阶段C折叠摘要有意义文字 | `buildFinishedLabel()` 提取操作摘要 | ✅ `buildFinishedLabel()` |
| 阶段D最终 prose 完整输出 | `endResponse()` 完整渲染 `currentBubble` | ✅ 已实现 |
| `[TOOL:...]` 不在 prose 中显示 | `stripToolCallBlocks()` 过滤 | ✅ 已实现 |
| 折叠行可展开查看层级3内容 | `<details>` HTML 原生折叠 | ✅ `details[data-done]` |
| 图片/截图作为 input 注入 | Vision 模型 attachment | ✅ 已实现：粘贴图片→base64→`pendingImages[]`→`msg.images`→`runChat()`→LLM provider（2026-05-27）|

---

## 十、DevSeek vs Copilot 完整差异对照表（2026-05-27 最终状态）

> 本节汇总 DevSeek 与 Copilot 的所有已知差距，按影响程度分级。  
> **绿色 ✅ = DevSeek 已对齐或超越；黄色 🟡 = 近似/部分实现；红色 🔴 = 尚未实现**

---

### 10.1 核心 Agent 流程（已全部对齐）

| 功能 | Copilot | DevSeek | 状态 |
|------|---------|---------|------|
| 多轮 Agent 循环（最多 25/200 轮）| `_runLoop` + tool call limit | `runAgentLoop` + `AGENTIC_ROUNDS_*` | ✅ 完全对齐 |
| 工具调用解析 | Native function calling (JSON) | `parseFakeToolCalls()` 文本格式 | ✅ 逻辑等效（架构不同，行为相同）|
| Todo 任务清单 | `manage_todo_list` tool | ✅ 同等行为 + `#agent-todos-widget` | ✅ 完全对齐 |
| 显式完成（`task_complete`）| 工具调用后 break 循环 | `processFakeTools()` 早退 | ✅ 完全对齐 |
| 隐式完成（无工具调用）| 停止工具调用 | ✅ 同等行为 | ✅ 完全对齐 |
| Working 框折叠/展开 | `setFallbackTitle()` + `<details>` | ✅ `details[data-done]` + `buildFinishedLabel()` | ✅ 完全对齐 |
| Autopilot 模式 | `permissionLevel=autopilot` | `devseek.autopilotMode` | ✅ 完全对齐 |
| 过渡性 prose（阶段B）| `currentBubble` 在两 Working 框间 | ✅ deferred bubble 机制 | ✅ 完全对齐 |
| Queue/Steer 消息 | Agent 运行中排队/调向 | ✅ `queuedAgentMsg` + 中断发送按钮 | ✅ 完全对齐 |

---

### 10.2 文件编辑模型（已全部对齐，部分超越）

| 功能 | Copilot | DevSeek | 状态 |
|------|---------|---------|------|
| 文件立即写入磁盘 | `#edit/editFiles` → 直接写盘 | `applySearchReplaceBlocks()` → `vscode.workspace.fs.writeFile()` | ✅ 完全对齐 |
| Keep/Undo（文件级）| Chat view 按钮 | ✅ `#pending-edits-area` + `keepPendingEdit` / `undoPendingEdit` | ✅ 完全对齐 |
| Keep/Undo（Hunk 级）| 编辑器 overlay 控件 | ✅ webview 面板 + **编辑器 CodeLens（2026-05-27）** | ✅ 完全对齐 |
| 编辑器内联 diff 高亮 | 绿色/红色 diff hunk 背景 | ✅ `DiffDecorationManager`：绿色（纯增行）/ 黄色（修改行），2026-05-27 | 🟡 颜色方案略不同（Copilot 用红/绿，DevSeek 用绿/黄） |
| CodeLens Keep/Undo 按钮 | 编辑器 hunk 上方 overlay | ✅ `_devseek.diffKeepHunk` / `_devseek.diffUndoHunk` CodeLens，2026-05-27 | ✅ 完全对齐 |
| 自动跳到下一 hunk | `revealNextChangeOnResolve` | ✅ `revealNextPendingHunk()`，2026-05-27 | ✅ 完全对齐 |
| Explorer/标签页 ⬝ 指示 | ⬝ badge on pending files | ✅ `PendingEditDecorationProvider` | ✅ 完全对齐 |
| 自动接受（倒计时）| `chat.editing.autoAccept` | ✅ `devseek.editAutoAcceptDelay` | ✅ 完全对齐 |
| 保护文件（glob 过滤）| `chat.tools.edits.autoApprove` + 审批流 | ✅ `devseek.protectedFiles` **硬阻断**，比 Copilot 更严格 | ✅ **超越 Copilot** |

---

### 10.3 上下文与记忆（部分对齐）

| 功能 | Copilot | DevSeek | 状态 |
|------|---------|---------|------|
| 对话历史传递 | 全量 `chatHistory[]` | 摘要式历史（`priorFindings` + `analysisContext`）| 🟡 近似，上下文长度受限 |
| 工作区级持久记忆 | `memory` 工具 + 账户存储 | ✅ `memory_write` → `.devseek/memory.md` + system prompt 注入 | ✅ 工作区级完全对齐 |
| 全局跨工作区记忆 | 存储在用户账户 | 🔴 无（仅工作区级）| 🔴 架构差距 |
| 记忆文件查看 | `Chat: Show Memory Files` 命令 | ✅ `devseek.showMemoryFiles` 命令，2026-05-27 | ✅ 完全对齐 |
| Vision 图片输入 | 粘贴截图 → vision attachment | ✅ 粘贴图片 → base64 → `pendingImages[]` → `msg.images` → LLM，2026-05-27 | ✅ 完全对齐 |

---

### 10.4 Checkpoint 系统（尚未对齐）

| 功能 | Copilot | DevSeek | 状态 |
|------|---------|---------|------|
| 每次 chat request 前文件快照 | `chat.checkpoints.enabled` | 🔴 无文件状态快照 | 🔴 |
| Restore Checkpoint（回滚到历史文件状态）| ✅ 回滚文件 + 删除后续 chat history | 🔴 无 | 🔴 |
| Fork Conversation | ✅ 基于 checkpoint 分叉 session | 🔴 无 | 🔴 |
| 断线续传 | `chat.checkpoints`（可选）| ✅ `saveAgentCheckpoint()` / `loadAgentCheckpoint()` — 任务进度续传 | 🟡 仅进度续传，非文件状态快照 |

---

### 10.5 Agent 类型（架构级差距）

| Agent 类型 | Copilot | DevSeek | 状态 |
|-----------|---------|---------|------|
| Local Agent（交互式）| ✅ `agent` / `plan` / `ask` 三模式 | ✅ `runAgentLoop`（≈ agent）+ 分析模式（≈ ask）| 🟡 功能等效，无 `plan` 独立模式 |
| Plan 模式 | 规划 → 执行 分离，可中间审查 | 🔴 无独立 Plan 模式（Decomposer 有类似功能但无交互式计划 UI）| 🔴 |
| Copilot CLI Agent | 本地后台，Git worktree | 🔴 无 | 🔴 架构差距 |
| Cloud Agent（GitHub）| 异步 PR 协作 | 🔴 无 | 🔴 架构差距 |
| Third-party Agent | Claude Code / OpenAI Codex | 🔴 无 | 🔴 架构差距 |
| 后台 terminal（Continue in Background）| ✅ | 🔴 无 | 🔴 |

---

### 10.6 Session 管理（部分对齐）

| 功能 | Copilot | DevSeek | 状态 |
|------|---------|---------|------|
| Session 持久化到磁盘 | ✅ | ✅ `sessions-panel` + 历史列表 | 🟡 部分对齐 |
| Session 统计（消息数/文件数）| ✅ | ✅ `messageCount` / `fileCount` | ✅ 完全对齐 |
| 远程监控 Session | ✅ 浏览器/手机可查 | 🔴 无 | 🔴 |
| Session Handoff（移交给 CLI/Cloud）| ✅ | 🔴 无 | 🔴 |

---

### 10.7 工具体系（近似对齐）

| 维度 | Copilot | DevSeek | 状态 |
|------|---------|---------|------|
| 工具调用格式 | JSON function calling（VS Code LM API）| 文本 `[TOOL:name {...}]`，`parseFakeToolCalls()` 解析 | 🟡 格式不同，功能等效 |
| 工具数量 | 25+ 内置工具 | 12 核心工具 + MCP 动态扩展 | 🟡 核心工具已覆盖，但缺少 `runSubagent`、`vscode_askQuestions` 等 |
| MCP 外部工具 | 🔴 无（Copilot 不支持 MCP）| ✅ `McpManager` 动态加载 `.devseek/mcp.json` | ✅ **超越 Copilot** |
| 工具上限 | 128 工具/请求 | 无硬限制（软限 AGENTIC_ROUNDS）| 🟡 机制不同 |

---

### 10.8 剩余高优先级差距（未来工作）

| 优先级 | 功能 | 预计影响 | 说明 |
|--------|------|---------|------|
| P2 | **Checkpoint restore** — 回滚文件状态 | 高 | 需要在每次 agent run 前对受影响文件做 `oldContent` 快照，并支持按时间点恢复 |
| P3 | **Plan 模式** — 规划 → 执行 分离 | 中 | 需要独立的 Plan UI：AI 输出结构化步骤列表，用户可编辑后再执行 |
| P4 | **后台 terminal** — Continue in Background | 低 | 需要 VS Code Task API + background process management |
| P5 | **全局跨工作区记忆** | 低 | 需要 VS Code `globalState` 或外部存储 |
| P5 | **Cloud/CLI Agent** | 低 | 架构级改造，需 GitHub API 集成 |
