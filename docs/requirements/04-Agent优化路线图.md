---
devseek_governance:
  generator: "devseek-doc-governance/v1"
  status: "historical"
  path: "docs/requirements/04-Agent优化路线图.md"
  source_group: "requirements"
  decision: "keep"
  relationship: "legacy-requirement"
  active_baselines:
    - "docs/requirements/02-顶级编程智能体需求基线.md"
  machine_sources:
    active_selector: "docs/process/devseek-active-baseline-selector.json"
    legacy_inventory: "docs/process/devseek-legacy-doc-inventory.json"
  asserts_gate_pass: false
---

<!-- DEVSEEK-GOVERNANCE-BANNER:START -->
> [!NOTE]
> DevSeek governance: this document is `historical` with decision `keep` and relationship `legacy-requirement`. Current authority: `docs/requirements/02-顶级编程智能体需求基线.md`. Machine source: `docs/process/devseek-legacy-doc-inventory.json`.
<!-- DEVSEEK-GOVERNANCE-BANNER:END -->

# DeepSeek 插件 Agent 模式改进需求文档

> **📌 主迭代入口** — 新会话恢复任务时首先读本文件。完整文档体系见 [docs/README.md](../README.md)。

> 基于对 GitHub Copilot Chat（VS Code 1.112.0，`github.copilot-chat-0.40.1`）深度源码逆向分析
> 分析来源：`workbench.desktop.main.js` + `extension.js`（NLS strings + 业务逻辑）
> 编写日期：2026-05-12
> 文档目的：指导 DeepSeek 插件对齐 Copilot 的智能行为模式与显示逻辑

**关联文档：**
- [02-模型供应商与工具协议架构设计.md](../architecture/02-模型供应商与工具协议架构设计.md) — 多模型能力契约、工具协议和降级策略
- [02-顶级编程智能体需求基线.md](./02-顶级编程智能体需求基线.md) — Claude Code / Codex / Copilot 对标后的 DevSeek 目标需求基线
- [06-记忆体需求.md](./06-记忆体需求.md) — DevSeek 记忆体分层、读写规则、隐私边界和重构推进方式
- [archive/reports/AUDIT_REPORT_2026-05-12.md](../archive/reports/AUDIT_REPORT_2026-05-12.md) — 各文档审计报告（已归档，4 项问题均已解决于 v2.18）

---

## 一、核心架构差距总览

| 维度 | Copilot 实现 | DeepSeek 当前 | 差距程度 |
|------|-------------|--------------|---------|
| **LLM Provider** | `vscode.lm` API（Claude/GPT/Gemini 多模型可选）| ✅ 三种 Provider：bridge网页/deepseek-api/openai-compat | 🟡 逻辑级（无 vscode.lm 原生集成）|
| **Agent 执行模型** | 真正的多轮 LLM 循环（`_runLoop` → `runOne`），每轮可包含多个工具调用 | ✅ 多轮循环已实现（`llm-agent-loop.ts`），跨轮历史传递（`sessionHistory`） | 🟡 逻辑级（无原生 function calling）|
| **工具系统** | 原生 LLM 工具调用（function calling），AI 自主决定使用哪些工具 | ✅ 文本格式工具调用（`[TOOL:name {...}]`），支持 manage_todo_list、task_complete | 🟡 逻辑级（非原生 function calling）|
| **计划生成** | AI 自主规划并通过 `manage_todo_list` 工具写入可持久化的 Todo 列表 | ✅ AI 可通过文本格式调用 manage_todo_list 更新 Todo，前端实时重建行 | 🟢 已对齐（近似方案）|
| **Todo 管理** | AI 在执行过程中动态调用 `manage_todo_list` 更新各项状态 | ✅ `parseFakeToolCalls()` + `handleTodoUpdate()` 实现动态更新 | 🟢 已对齐（近似方案）|
| **完成判断** | AI 主动调用 `task_complete` 工具；非 autopilot 模式下支持中途暂停 | ✅ `task_complete` 工具实现，`processFakeTools()` 触发早退；✅ autopilot 模式切换 | 🟢 已对齐 |
| **上下文传递** | 每轮 `runOne` 携带完整对话历史 + 所有工具结果 | ✅ `sessionHistory: ChatMessage[]` 跨任务传递摘要历史 | 🟡 逻辑级（摘要式非全量）|
| **显示标题** | `Working: {detail}` → 完成后 `Finished with N step(s)` | ✅ 动态标题：`准备(N项)` → `执行中(done/total)` → `已完成N步` | 🟢 已对齐 |
| **data-done 属性** | 完成后 thinking box 移除动画 class | ✅ `setAttribute('data-done','1')` 已补全，停止 wiBlink 动画 | 🟢 已对齐 |
| **Append 式工具行** | 工具行随执行动态追加，无预建占位行 | ✅ F-4 已实现：execute 阶段逐行追加，plan 阶段不预建行 | 🟢 已对齐 |
| **Autopilot 模式** | permissionLevel=autopilot 自动执行到 task_complete | ✅ `devseek.autopilotMode` 设置 + 状态栏切换按钮 + 自动接受改动 | 🟢 已对齐（简化版）|

---

## 二、Copilot Agent 底层逻辑完整解析

### 2.1 多轮 Agent 循环（`_runLoop` + `runOne`）

```
用户发送请求
  ↓
_runLoop() {
  for (round = 0; ; round++) {
    if (round >= toolCallLimit) → 提示"步数已满"或扩展限制 → break
    if (yieldRequested && !autopilot) → break（非 autopilot 模式中途暂停）
    if (taskCompleted) → break

    result = await runOne(turn, round, signal) {
      // 1. 构建 prompt（含对话历史、引用文件、工具列表、todo上下文）
      prompt = buildPrompt2(context, tools)
      // 2. 发送给 LLM（streaming）
      response = await llm.stream(prompt)
      // 3. 执行 response 中的所有工具调用（并行或顺序）
      for (toolCall in response.toolCalls) {
        executeToolCall(toolCall)
        // → 结果追加到对话历史，供下一轮使用
      }
      return { round: {toolCalls, response}, ... }
    }

    if (result.round.toolCalls.length === 0) → break（AI 未调用任何工具，隐式完成；非首选路径，首选通过 `task_complete` 工具显式退出）
    if (task_complete in result.round.toolCalls) → taskCompleted=true → break（首选退出方式）
  }
}
```

**关键特性：**
- 每轮都是一次完整的 LLM 调用，包含**全部历史对话**
- AI 自主决定调用哪些工具，可以在一轮中并行调用多个工具
- `toolCallLimit` 默认值约为 25，但 autopilot 模式可扩展到 200

### 2.2 Todo 列表生命周期

```
AI 规划阶段：
  AI 调用 manage_todo_list(todoList=[{id:1,title:"...",status:"not-started"}, ...])
  → 提供完整 todoList 数组（全量替换，无 operation 参数）
  → chatTodoListService 持久化；chat-todo-list-widget 显示在输入框区域（不在响应流中）

每步执行：
  AI 调用 manage_todo_list(todoList=[..., {id:N,title:"...",status:"in-progress"}, ...])
  → 提供全部项（含已完成项），将目标项 status 改为 "in-progress"
  → widget 中该项状态变蓝（codicon-record）

步骤完成：
  AI 调用 manage_todo_list(todoList=[..., {id:N,title:"...",status:"completed"}, ...])
  → 提供全部项，将完成项 status 改为 "completed"
  → widget 中该项变绿（codicon-pass）

下一轮 prompt 构建时：
  getCurrentTodoContext() 通过内部 operation="read" 查询当前 todo 状态并注入 prompt
  → AI 知道哪些任务还未完成
```

**todo item 状态枚举（工具参数实际值，连字符格式；源码确认）：**
- `"not-started"` → `codicon-circle-outline` + foreground 色（NLS 显示文字: "not started"）
- `"in-progress"` → `codicon-record` + `var(--vscode-charts-blue)`（NLS 显示文字: "in progress"）
- `"completed"` → `codicon-pass` + `var(--vscode-charts-green)`

### 2.3 Task Complete 机制

```javascript
// Copilot system prompt 中的关键指令（源码提取）：
"Keep working autonomously until the task is truly finished, then call task_complete."

// AI 必须同时做到：
// 1. 输出一段简洁的文字摘要（"what was accomplished"）
// 2. 然后调用 task_complete 工具

// 非 autopilot 模式下：
if (yieldRequested && !taskCompleted) break; // 每轮后暂停等待用户确认

// Autopilot 模式下的保护机制：
if (taskCompleted已有记录) → 停止并提示
if (autopilotIterationCount >= MAX_AUTOPILOT_ITERATIONS) → 强制停止
else → 发送 reminder prompt: "你还没有调用 task_complete，继续完成任务"
```

### 2.4 Thinking Box（工具操作折叠区）

Copilot 的 `chat-thinking-box` 是 VS Code 核心渲染的组件，**不由 extension 直接操控 DOM**，而是通过 `stream.progress()` / `stream.toolCall()` 等 VS Code API 驱动：

```
AI 流式输出中包含工具调用
  → VS Code 核心检测到工具调用响应
  → 创建/更新 chat-thinking-box DOM
  → 工具结果返回后追加操作行（chat-thinking-tool-wrapper）

完成后：
  setFallbackTitle() 被调用
  → title = "Finished with N step(s)" 或 "Finished Working"
  → 图标变 codicon-check
  → 移除 chat-thinking-active class（停止动画）
  → streamingCompleted = true
```

**title 在运行时的更新规则：**
- 从工具调用的 `invocationMessage` 字段提取（如 `"Reading src/main.cpp"`）
- 或从 markdown 内容中的文件 URI 提取（格式: `Edited {filename}` / `Edited file`）
- 实时更新：`Working: {最新操作描述}`（带 shimmer 动画）

### 2.5 单工具调用优化

当 `toolInvocationCount === 1 && hookCount === 0` 时，thinking box 会将唯一的工具行节点**直接提升**至容器，避免多余包装层。这使得单步操作更简洁。

### 2.6 Autopilot vs 手动模式

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| `autopilot` | permissionLevel = "autopilot" | 自动继续到 task_complete，无需用户确认 |
| `autoApprove` | permissionLevel = "autoApprove" | 自动批准工具但可能暂停 |
| 手动 | 默认 | 每轮工具执行后等待用户确认（`yieldRequested` 机制）|

---

## 三、UI 显示体系完整规范

### 3.1 整体布局（一次 Agent 响应）

```
┌─ 聊天流（左对齐）─────────────────────────────────────────┐
│                                                            │
│  [thinking box — chat-thinking-box]                        │
│  ╷ Working: Reading src/main.cpp  ⟳                       │  ← 进行中：shimmer + 动画
│  ╷   ✏ main.cpp  +8 -2                                    │
│  ╭   ✶ get_file_contents  Animal.h                        │
│  ╭   ⚙ grep "absPath"                                      │
│      ↓ 完成后折叠 ↓                                       │
│  ✓ Finished with 3 step(s)  ›                             │  ← 完成：codicon-check，可展开
│                                                            │
│  [AI 正文（MarkdownPart）]                                 │
│  已完成修改，共更新了 2 个文件...                           │
│                                                            │
│  [代码块（五有圆角框）]                                    │
│  ┌─ cpp ─────────────── [复制] [插入]                     │
│  │ // 代码                                                 │
│  └──────────────────────────────────────────────          │
└────────────────────────────────────────────────────────────┘

┌─ 聊天输入框区域（底部）────────────────────────────────────┐
│  [chat-todo-list-widget — Todos 折叠] ← 与响应流分离！    │
│    ✓  task 1 (completed)                                   │
│    ✓  task 2 (completed)                                   │
│  [用户输入框]                                              │
└────────────────────────────────────────────────────────────┘
```

### 3.2 Thinking Box 状态机

```
                    ┌─────────────┐
                    │  初始状态   │
                    │ (创建 box)  │
                    └──────┬──────┘
                           ↓
               class: chat-thinking-active
               class: chat-thinking-streaming
               title: "Working: {detail}"  (shimmer 动画中)
               icon: 旋转中...
                           ↓
               [工具行追加] 每调用一个工具追加一行
               appendedItemCount++
                           ↓
               [AI 完成所有工具调用]
                           ↓
               setFallbackTitle() called:
               - appendedItemCount > 0 → "Finished with N step(s)"
               - appendedItemCount = 0 → "Finished Working"
               icon: codicon-check
               remove: chat-thinking-active
               remove: chat-thinking-streaming
               streamingCompleted = true
               折叠（collapse button 关闭）
```

### 3.3 操作行图标规则

| 条件 | 图标（codicon）|
|------|--------------|
| `toolSpecificData.kind === "terminal"` 且 exitCode = 0 | `codicon-terminal` |
| `toolSpecificData.kind === "terminal"` 且 exitCode ≠ 0 | `codicon-error` |
| `chat-hook-outcome-blocked` class | `codicon-error` |
| `chat-hook-outcome-warning` class | `codicon-warning` |
| `markdownContent`（文件编辑） | `codicon-pencil` |
| 其他工具 | `codicon-sparkle` |

### 3.4 NLS 字符串（VS Code 官方文案）

| NLS ID | 字符串 | 用途 |
|--------|--------|------|
| 7416 | `"Finished Working"` | thinking box 完成标题（无工具行时）|
| 7417 | `"Finished with {0} step{1}"` | thinking box 完成标题（有 N 步时）|
| 7418 | `"Working"` | 默认初始 title |
| 7442 | `"Clear all todos"` | Todo widget 清空按钮 |
| 7444 | `"Collapse Todos"` | Todo widget 折叠 |
| 7446 | `"Expand Todos"` | Todo widget 展开 |
| 7448 | `"completed"` | Todo item 状态文字 |
| 7449 | `"in progress"` | Todo item 状态文字 |
| 7450 | `"not started"` | Todo item 状态文字 |
| 7451 | `"Todos"` | Todo widget 标题 |
| 7452 | `"Todos ({0}/{1})"` | Todo widget 标题带进度 |

---

## 四、DeepSeek 插件具体优化需求

### F-1【UI 高优】修复折叠区标题文字

**当前问题：** `aut-label` 始终显示 `Todos`，语义错误。

**目标行为：**
```
计划阶段（phase=plan）:    "计划中…"  或 "准备 (N 项)"
执行阶段（phase=execute）: "执行中 ({done}/{total})"  — 每步更新
完成（phase=done）:        "已完成 {N} 步"  （对齐 Copilot "Finished with N step(s)"）
失败（phase=error）:       "执行失败 ({done}/{total})"
```

**改动位置：** `media/webview.js`
- plan 阶段：初始化 `aut-label` 文字为 `"准备 (N 项)"`
- execute 阶段每步完成后：更新 `aut-label` 文字为 `"执行中 (done/total)"`
- done 阶段：写入 `"已完成 {count} 步"`

**计数变量需要：**
```javascript
var autTotalTasks = 0;      // plan 阶段设定
var autDoneTasks = 0;       // 每步 state=done 时 +1
```

---

### F-2【UI 高优】补全 `data-done` 属性，停止动画

**当前问题：** CSS 规则 `.aut-details[data-done] .aut-status-icon { animation: none }` 已存在，但 done 阶段代码未写入该属性，`wiBlink` 脉冲动画在完成后持续。

**改动位置：** `media/webview.js`，done/error 阶段，紧跟 `removeAttribute('open')` 之后

```javascript
if (autDets) {
  autDets.removeAttribute('open');
  autDets.setAttribute('data-done', '1');  // ← 补充这行
}
```

---

### F-3【UI 中优】颜色改用 VS Code 语义变量

**当前问题：** 使用硬编码 `rgba(100,220,120,.9)` 绿色，在浅色主题下对比度差。

**目标：** 对齐 Copilot `getStatusIconColor()` 使用的变量：
```css
/* 完成色 */
--vscode-charts-green

/* 进行中色 */
--vscode-charts-blue

/* 错误色 */
--vscode-errorForeground  （或 --vscode-minimap-errorHighlight）
```

**改动位置：** `extension.ts` 内联 CSS 中的 `.aut-icon`, `.aut-added`, `.aut-removed`, `.agent-done-line`

---

### F-4【逻辑中优】追加式工具行（去掉预建占位行）

**当前问题：** plan 阶段预创建所有任务行（pending 状态），这与 Copilot 的**追加式**不同。预建的好处是可以预览任务列表，但当实际执行和计划偏差时会出现残留行。

**两种方案对比：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 保持预建式 | 用户可提前看到任务列表 | 计划vs实际偏差时有视觉混乱 |
| B. 改为追加式（Copilot 方式）| 始终反映真实情况 | 没有提前预览 |
| C. 混合式：计划折叠 + 执行追加 | 最清晰 | 实现复杂 |

**建议：短期选 A（维持现状），中期实现 C（两阶段展示）**

---

### L-1【逻辑高优】多轮 Agent 循环（最大架构改进）

**现状问题：**
- DeepSeek 将任务在后端分解为固定列表，每任务独立一次 LLM 调用
- 各任务之间没有共享对话历史
- LLM 不能自主决定需要哪些工具/行动

**目标：** 实现真正的 Agentic Loop，对齐 Copilot `_runLoop` 模式

```typescript
// 伪代码 — 目标架构
async function runAgentLoop(userPrompt: string, tools: Tool[], callbacks: Callbacks) {
  const history: Message[] = [{ role: 'user', content: userPrompt }];
  const maxRounds = 25;

  for (let round = 0; round < maxRounds; round++) {
    // 注入当前 todo 上下文
    const todoContext = getCurrentTodoItems();

    // 调用 LLM（携带完整历史 + 工具定义）
    const response = await callLLM({
      messages: history,
      tools,
      stream: true,
      onDelta: callbacks.onDelta,
    });

    // 执行本轮所有工具调用
    const toolResults = [];
    for (const toolCall of response.toolCalls) {
      callbacks.onAgentStatus({ phase: 'execute', toolName: toolCall.name });
      const result = await executeTool(toolCall);
      toolResults.push({ toolCallId: toolCall.id, content: result });

      // 特殊处理
      if (toolCall.name === 'task_complete') {
        callbacks.onAgentStatus({ phase: 'done' });
        return;
      }
      if (toolCall.name === 'manage_todo_list') {
        updateTodoWidget(toolCall.input);
      }
    }

    // 无工具调用 = AI 认为完成
    if (response.toolCalls.length === 0) break;

    // 将本轮结果追加到历史
    history.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
    history.push({ role: 'tool', content: toolResults });
  }
}
```

**实现路径（渐进式）：**
1. **阶段 P1**（当前→2周）：保持现有架构，做 F-1/F-2/F-3 UI 修复
2. **阶段 P2**（~1月）：在 `agent-loop.ts` 中实现基础多轮循环，支持历史传递
3. **阶段 P3**（~2月）：引入原生工具调用 function calling，让 AI 自主选择工具

---

### L-2【逻辑高优】真正的 Todo 工具

**现状问题：** Todo 列表由前端 JS 根据任务进度控制，不是 AI 主动管理。

**目标：** 将 `manage_todo_list` 作为 AI 可调用的真实工具

```typescript
// 工具定义（function calling schema）— 基于 workbench.js ODi() 实际 schema
{
  name: "manage_todo_list",
  description: "管理结构化 todo 列表以追踪任务进度...",
  parameters: {
    todoList: {
      type: "array",
      description: "完整 todo 列表。必须包含所有项（已有项 + 新增项），每次全量替换。",
      items: { id: number, title: string, status: "not-started" | "in-progress" | "completed" }
    }
    // ⚠️ 无 operation 参数，无 taskId 参数
    // AI 每次调用提供完整的 todoList 数组（全量替换当前状态）
    // "read" 操作是 extension 内部用于 getCurrentTodoContext()，不暴露给 AI
  }
}

// 工具处理器
function handleManageTodoList(input) {
  // 全量替换（AI 总是发送完整列表）
  todoItems = input.todoList;
  renderTodoWidget(todoItems);  // 重新渲染整个列表
  return "";  // 不需要返回内容给 AI
}
```

---

### L-3【逻辑中优】task_complete 工具实现

**目标：** AI 通过调用 `task_complete` 而不是"遍历完任务"来标志完成

```typescript
// 工具定义
{
  name: "task_complete",
  description: "标志任务全部完成。调用前必须输出完成摘要文字。",
  parameters: {
    summary: { type: "string", description: "任务完成摘要" }
  }
}

// 处理器
function handleTaskComplete(input) {
  callbacks.onAgentStatus({ phase: 'done', summary: input.summary });
  agentLoop.terminate();
}
```

---

### L-4【逻辑中优】上下文传递（跨轮记忆）

**当前问题：** 每个任务调用独立 prompt，无法感知其他任务的执行结果。

**目标：**
1. 每轮 `runOne` 的输出（AI 文本 + 工具结果）追加到 `messageHistory`
2. 下一轮 `buildPrompt` 时包含完整 `messageHistory`
3. 对话历史做**压缩**以节省 token（只保留最近 N 轮，或压缩工具结果为摘要）

---

### L-5【逻辑低优】Autopilot vs 手动模式

**目标：** 实现两种执行模式

| 模式 | 行为 |
|------|------|
| **交互式**（当前） | 每步执行前显示确认，用户可暂停/跳过 |
| **自动驾驶** | 自动继续到 `task_complete`，不需要用户每步确认 |

---

## 四常、DeepSeek Webview 对照 Copilot 可行性分析

> DeepSeek 插件 UI 运行在 VS Code Webview **隔离沙箋**中（`media/webview.js`），无法访问 VS Code 核心 DOM。Copilot 的 UI 由 VS Code 核心直接渲染。以下分析基于此前提。

### 可完全对照实现（仅改 webview.js / extension.ts）

| 对照项 | Copilot 标准 | DeepSeek 当前 | 对照方式 | 复杂度 |
|---------|-------------|--------------|---------|--------|
| 折叠区标题动态文字 | `Working: ...` 运行中；`Finished with N step(s)` 完成 | 始终 `Todos` | 修改 `aut-label` 赋値逻辑 | 低 |
| 完成后停动画 | 移除 `chat-thinking-active` | CSS 规则存在但 `data-done` 未写入 | `autDets.setAttribute('data-done','1')` | 极低 |
| 状态颜色语义化 | `--vscode-charts-green/blue` | 硬编码 rgba | 改 CSS 变量 | 极低 |
| Todo 状态图标 | `codicon-pass/record/circle-outline` | 自定义 emoji | 在 webview 内加载 codicons + `<i class="codicon ...">` | 低 |
| diff 徽章颜色 | `--vscode-charts-green/red` 同系 | 近似的硬编码值 | 改用 `var(--vscode-charts-green)` | 极低 |

### 可近似实现（需修改 bridge-client.ts / agent-loop.ts）

| 对照项 | Copilot 方式 | DeepSeek 限制 | 可行替代方案 | 风险 |
|---------|-------------|--------------|----------|------|
| 多轮对话历史 | 每轮 `runOne` 包含完整消息历史 | 每任务独立 prompt，无跨任务历史 | 在 `agent-loop.ts` 维护 `messageHistory[]` | 中（token 消耗增加） |
| 追加式工具行 | 每工具调用实时追加行 | 预建占位行，执行时更新状态 | 改为“执行时追加”模式，删除 plan 阶段预建逻辑 | 低 |
| 实时标题更新 | `Working: {invocationMessage}` 每步更新 | 无实时更新 | 每步执行时通过 `postMessage` 更新标题 | 低 |

### 存在架构障碍（无法直接对照，需系统性改造）

#### 障碍 A：`manage_todo_list` 工具无法作为真正的 AI 工具调用

**Copilot**：VS Code 核心提供 为原生工具，通过 `vscode.lm` API 传递给 LLM，LLM 原生 function calling 调用它。

**DeepSeek 架构**：`webview.js → bridge-client.ts → HTTP /chat → 本地 bridge server (port:3721) → DeepSeek API`

实现路径：
- **方案一（强）：** 改造 bridge server 支持 `tools` 参数 + 解析 `tool_calls` 响应 → 路由回 extension 处理
- **方案二（轻）：** 将 `manage_todo_list` 指令写入系统提示词，让 AI 输出结构化 `[TOOL:manage_todo_list {...}]` 格式， extension 解析该格式执行 todo 更新（无需改动 bridge server）

#### 障碍 B：VS Code 原生 Todo Widget 无法在 Webview 中复用

**Copilot**：Todo widget 是 VS Code 核心 UI 组件，挂载在 input area。

**DeepSeek**：Webview 沙箋无法访问 VS Code 核心 DOM。**建议保留 `.aut-container` 方案**，通过 CSS 将其定位到 webview 底部以视觉模拟 Copilot 展示位置。

#### 障碍 C：Webview 内 codicon 可用性

**Copilot**：直接使用 VS Code 核心 codicon 字体。

**DeepSeek Webview**：需要在 webview HTML 中加载 codicons.css + 字体文件：
```typescript
// extension.ts createWebviewPanel 时：
localResourceRoots: [..., vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons')]
// webview HTML 中：
<link href="${codiconsUri}" rel="stylesheet" />
```
`@vscode/codicons` 是标准 VS Code 扩展依赖，可行。

### 无法对照实现（架构级限制）

| 项目 | 原因 | 建议 |
|------|------|------|
| Copilot 原生 `chat-thinking-box` CSS 渲染 | 由 VS Code 核心直接渲染，居于主 DOM，非 webview | 保留 `.aut-container` 近似方案 |
| `vscode.lm` API 原生工具调用 | DeepSeek 使用 HTTP bridge，不接入 `vscode.lm` | 需改造 bridge-client 支持 function calling |
| autopilot 权限模型 | Copilot 与 VS Code 核心权限系统深度集成 | 可实现简化版（设置项控制“自动/手动”模式） |

---

## 五、系统提示词（System Prompt）改进

Copilot 的 agent system prompt 关键规则（源自逆向分析，可参考采用）：

```
1. 深入理解问题 — 仔细阅读需求，思考全面计划再动手
2. 代码库探索 — 探索相关文件和目录，搜索关键函数
3. 制定详细计划 — 分解为可操作步骤，使用 manage_todo_list 工具展示
4. 递增式实现 — 每次小步改动，可测试
5. 调试 — 使用工具检查错误，找根因而非治标
6. 频繁测试 — 每次改动后验证
7. 迭代到通过全部测试
8. 反思验证 — 测试通过后再次确认符合原始意图

关键约束：
- 每轮结束前：更新 todo list，标记已完成/跳过/阻塞项
- 最终结束：先输出完成摘要文字，再调用 task_complete
- 永远不要只输出计划而不执行
- 调用工具前先 read 相关文件内容
```

**DeepSeek 当前缺失：** 没有对 AI 的行为约束（系统提示词），任务执行依赖后端预分解而非 AI 自主规划。

---

## 六、优先级路线图

### 短期（当前 sprint，1~2 周）— UI 层修复 + Provider 基础

| 编号 | 需求 | 文件 | 预计工时 |
|------|------|------|---------|
| ✅ F-1 | 折叠区标题改为动态文字 | `webview.js` | ✅ 2026-05-09 |
| ✅ F-2 | 补全 `data-done` 属性 | `webview.js` | ✅ 2026-05-09 |
| ✅ F-3 | 颜色改用语义变量（`webview.js` CSS） | `webview.js` | ✅ 2026-05-09 |
| ✅ F-4 | 追加式工具行（去掉预建占位行） | `webview.js` | ✅ 2026-05-10 |
| ✅ **P1-1** | **LLM Provider 抽象层** | `llm/types.ts`, `llm/provider-router.ts` | ✅ 2026-05-09 |
| ✅ **P1-2** | **DeepSeek API Provider** | `llm/providers/deepseek-api.ts`, `llm/providers/bridge.ts` | ✅ 2026-05-09 |
| ✅ **P1-3** | **模型选择器 UI（状态栏）** | `llm/provider-router.ts`, `extension.ts` | ✅ 2026-05-09 |
| ✅ **P1-4** | **项目规则文件读取**（`.deepseek/rules.md`） | `project-rules.ts`, `extension.ts` | ✅ 2026-05-09 |

### 中期（1~2 月）— 逻辑层对齐

| 编号 | 需求 | 文件 | 预计工时 |
|------|------|------|---------|
| ✅ L-1 | 多轮 agent 循环（`llm-agent-loop.ts` + `runAgentLoop` 历史传递） | `agent-loop.ts`, `llm-agent-loop.ts` | ✅ 2026-05-09 |
| ✅ L-2 | manage_todo_list 工具集成（AI 文本格式调用，前端实时重建行） | `agent-loop.ts`, `webview.js` | ✅ 2026-05-09 |
| ✅ L-3 | task_complete 工具（AI 调用后提前终止循环） | `agent-loop.ts` | ✅ 2026-05-09 |
| ✅ L-4 | 跨轮上下文传递（`sessionHistory: ChatMessage[]`） | `agent-loop.ts` | ✅ 2026-05-09 |
| ✅ L-5 | Autopilot 模式（状态栏切换按钮 + 自动接受改动） | `webview.js`, `extension.ts`, `package.json` | ✅ 2026-05-10 |
| ✅ **P2-3** | **run_in_terminal 工具** | `tools/terminal.ts`, `extension.ts` | ✅ 2026-05-09 |
| ✅ **P2-4** | **get_errors / 编译错误集成** | `context-builder.ts` `getDiagnosticsContext` | ✅ 2026-05-09 |
| ✅ **P2-5** | **OpenAI 兼容 Provider** | `llm/providers/openai-compat.ts` | ✅ 2026-05-09 |
| ✅ **P2-6** | **Commit Message 生成（改用 LLMProvider 抽象）** | `commands/index.ts` | ✅ 2026-05-09 |

### 长期（2~3 月）— 智能层提升

| 编号 | 需求 | 说明 |
|------|------|------|
| ✅ I-1 | ~~原生 function calling~~ | 文本格式 fake tool call 已满足近期需求 |
| ✅ I-2 | 系统提示词工程 | `buildToolsSuffix(taskIndex,taskTotal)` 上下文感知工作流指导；`detectTaskComplete` 支持 `[TOOL:task_complete]`；`buildSystemPrompt` 三阶段强制工作流 ✅ 2026-05-09 |
| ✅ I-3 | 上下文压缩 | `estimateTokens()` CJK感知token估算；`compressHistory` 改用token预算(4000)替代字符阈值；摘要改用`role:'system'`避免破坏交替结构；`sessionHistory` 上限20条 ✅ 2026-05-09 |
| I-4 | subagent 支持 | 复杂任务可调用子 agent（类 Copilot subagent）|
| I-5 | 原生 function calling（完整版）| 接入真正的 OpenAI function calling API，AI 自主选工具 |
| **P3-1** | **内联代码补全** | ✅ 迁移到 `getActiveProvider()`（不再依赖 bridge `ping()`/`chat()`）；`AbortController` 联动取消令牌；cacheKey 加路径前缀；`completionTriggerDelay` 默认改 800ms ✅ 2026-05-09 |
| **P3-2** | **代码库轻量索引** | ✅ `@workspace` / `@ws` 注入工作区文件树（3层深，跳过 build/node_modules/hidden）；`@problems` 别名支持；输入框 @ 补全提示 ✅ 2026-05-09 |
| **P3-3** | **Inline Chat（`Ctrl+I`）** | ✅ 基础实现 + diff预览：应用后注册为 Pending Edit，自动打开 Diff 视图，可在侧边栏撤销；已修复 bridge ping 依赖 ✅ 2026-05-09 |
| **P3-4** | **测试生成与运行** | ✅ `detectTestFramework()` 自动检测测试框架（jest/vitest/pytest/cargo/go）；`genTest()` 框架感知 prompt；`deepseek.runTests` 命令在终端运行测试；webview `/test` slash 命令；`dispatch()` 和 `applyDiff()` 移除 bridge 依赖 ✅ 2026-05-09 |
| **P3-5** | **MCP 客户端** | ✅ `McpStdioClient`（JSON-RPC 2.0 over stdio，MCP 2024-11-05协议）；`McpManager` 读取 `.deepseek/mcp.json`（兼容 Cursor 格式）；工具列表注入到 `buildToolsSuffix()` 系统提示，`processFakeTools()` 处理 `mcp__server__tool` 调用，结果反注入对话；extension.ts 自动激活 McpManager；`@git` diff 注入（AT_CMDS 新增，resolveFile 处理）；`sendExplicitPrompt` 补全 `/test` 分支 ✅ 2026-05-09 |

### Bug Fixes（会话级修复，非需求项）

| 编号 | 问题 | 根因 | 文件 | 修复日期 |
|------|------|------|------|----------|
| B-1 | webview.js 全功能失效（卡"连接中"、无法发消息） | `renderTodosContent` 函数体被意外重复，产生游离 `}`，整体 SyntaxError | `media/webview.js` | 2026-05-09 |
| B-2 | 选择 DeepSeek API 后仍走网页路径 | 6 处 `chat()` hard-code import from `bridge-client`，绕过 provider 路由 | `extension.ts` | 2026-05-09 |
| B-3 | API Key 401 无法更新密钥 | `_ensureApiKey` 有 key 时直接 return；缺少 401 错误传播链 | `deepseek-api.ts`, `provider-router.ts`, `extension.ts` | 2026-05-09 |
| B-4 | `code/agent/` 文件被误判为路径漂移 | `alignRelPathToScope` 对多级路径强制 remap 到 scopedDirs（活跃编辑器位于旧 Agent 文档目录） | `workspace-applier.ts` | 2026-05-09 |
| B-5 | Inline Chat 在 API 模式下报"Bridge 未运行" | `deepseek.inlineChat` 使用 `await ping()` 而非 provider 可用性检查 | `extension.ts` | 2026-05-09 |
| B-6 | API 模式多轮对话丢失上下文 | `routeChat` 对非 bridge provider 每次只发单条消息，无历史记忆 | `extension.ts` | 2026-05-09 |
| B-7 | 右键菜单命令在 API 模式下全部失效 | `dispatch()` 调用 `ping()` 强依赖 bridge；`applyDiff()` 同样硬编码 `chat()` | `commands/index.ts` | 2026-05-09 |

---

## 七、参考：Copilot 与 DeepSeek 显示对比快照

### 进行中状态

```
Copilot:
  ╷ Working: Reading src/main.cpp  ⟳
  ╷   ✏ main.cpp  +8 -2
  ╭   ✶ get_file_contents  Animal.h

DeepSeek（当前）:
  ● Todos  0/3
  │ ● ✏ main.cpp          修复 idle_rpm 上界笔误
  │ ○ ✏ tests.cpp         添加用例
  │ ○ 📖 README.md        更新文档
```

### 完成后状态

```
Copilot:
  ✓ Finished with 3 step(s)  ›   （可点击展开）

DeepSeek（当前）:
  ✓ Todos  3/3   （动画可能仍在跑，标题未变）
```

### Todo Widget（Copilot — 在输入框区域）

```
  [Todos ▽]
    ✓  修复 idle_rpm 上界笔误    (codicon-pass, --vscode-charts-green)
    ✓  添加工况验证              (codicon-pass, --vscode-charts-green)
    ●  更新文档                  (codicon-record, --vscode-charts-blue)

  [清空 ✕]
```

---

| B-7 | `@workspace` 不生效（resolveFile 无特殊分支） | `resolveFile` handler 直接调 `readWorkspaceFile`，无 `workspace` 特判 | `extension.ts` | 2026-05-09 |

*本文档基于 VS Code 1.112.0 / github.copilot-chat-0.40.1 源码逆向分析。*
*每次实现改进后在第六节路线图中更新状态。最后更新：2026-05-09（P3-2 @workspace，P3-3 diff 预览，B-6 对话历史）*

---

## 八、Copilot 执行全链路对标差距分析（v2.17，截图逆向）

> 基于 7 张截图 + 源码比对，补充截图分析阶段识别的 6 项实现差距。每项包含：差距描述、Copilot 实际行为、当前插件状态、优先级。

### 差距总览

| ID | 名称 | 当前状态 | 优先级 | 实现成本 |
|----|------|---------|-------|--------|
| G-1 | 规划推理 Bullet 可见化 | ✅ 已实现（2026-05-15）| P2 | 小 |
| G-2 | 终端确认内联卡片 | ✅ 已实现（2026-05-15）| P1 | 中 |
| G-3 | "Ran 命令"独立行 | ✅ 已实现（2026-05-15）| P3 | 小 |
| G-4 | 程序输出内联嵌入响应 | ✅ 已实现（2026-05-15）| P1 | 小 |
| G-5 | 编辑器标题 Keep/Undo 覆层 | ✅ 已实现（状态栏方案 A）| P3 | 中-大 |
| G-6 | Allow 下拉多级权限选项 | ✅ 已实现（tc-allow-group + alwaysAllow）| P2 | 小 |

---

### G-1 规划推理 Bullet 可见化

**Copilot 行为（截图 1）**：
- Working 区内第一个元素是纯文本推理句，不带图标、不计入 N 步计数
- 内容来自 AI 输出中第一个工具调用块之前的纯文字段落
- 格式：`The user wants to {目标}. Let me {下一步动作}.`

**当前插件状态**：Working 区直接从任务行开始，无规划推理文字展示。

**实现路径**：
1. `agent-loop.ts`：检测 AI 首轮输出中工具调用块之前的纯文字 → `postAgent({ planningText })`
2. `media/webview.js`：渲染 `.aut-plan-bullet`（第 0 项，不计数）
3. 若无纯文字前缀，静默跳过

**优先级**：P2（用户体验提升，展示 AI 推理过程的透明度）

---

### G-2 终端确认内联卡片

**Copilot 行为（截图 3-4）**：
- 确认卡片是聊天流中的内联消息，不是模态对话框
- 位于 `Finished with N steps ∨` 折叠块下方
- 包含：标题行（目录路径）+ 完整命令代码块 + `Allow ∨` + `Skip` 按钮
- Allow/Skip 后卡片保持可见，按钮变灰

**当前插件状态**：使用 `vscode.window.showWarningMessage`（`extension.ts` line 1206）—— 弹出阻塞全局的 VS Code modal。

**实现路径**（完整规格见 [03-Agent运行时与工作流重构设计.md](../architecture/03-Agent运行时与工作流重构设计.md) 的工具执行与权限设计）：
1. `extension.ts`：`onTerminalCommand` 回调改为：发 `terminalConfirm` 消息 + await Promise（by confirmId）
2. `media/webview.js`：处理 `terminalConfirm` → 在聊天流末尾插入 `.terminal-confirm-card`
3. 用户点击 Allow/Skip → 发 `terminalConfirmReply` → extension resolve Promise
4. 卡片更新为已操作状态（按钮灰化）

**优先级**：P1（当前 modal 体验极差，是最高频用户痛点之一）

---

### G-3 "Ran 命令"独立行

**Copilot 行为（截图 5）**：
- 命令执行后，在 `Finished with N steps ∨` 下方、AI 响应正文之前出现独立行
- 格式：`[terminal icon]  Ran  {截断命令}`
- 成功：绿色 terminal icon；失败：红色 error icon

**当前插件状态**：终端执行状态通过 agentStatus 卡片展示在 Working 区，无独立 "Ran" 行样式。

**实现路径**：
1. `extension.ts`：命令执行完成后（无论 Allow/Skip），发 `{ type: 'terminalRanNotice', command, exitCode }`
2. `media/webview.js`：在当前响应区末尾插入 `.ran-command-row`（含截断命令文字 + 状态图标）

**优先级**：P3（视觉完整度，非阻塞功能）

---

### G-4 程序输出内联嵌入响应

**Copilot 行为（截图 6）**：
- AI 最终响应文字包含程序输出（代码块形式）
- 因为 tool_result 包含了 `./hello_deepseek` 的实际输出，AI 可在响应中引用

**当前插件状态**：`runValidation()` 中的执行输出仅通过 agentStatus 传送到 Working 区，未回传给 LLM，AI 最终响应不包含实际程序输出。

**关键代码位置**：`agent-loop.ts` `runValidation()`（约 line 1308-1330）

**实现路径**：
1. `runValidation()` 中执行命令后，将 `output` 追加到 `callbacks.sessionHistory`，使 LLM 下一轮感知
2. 或：直接把程序输出附加进 `compilePlan` 结果返回给调用方，在 `runAgentLoop()` 的最终 LLM 消息中包含
3. output > 2000 字符时截断

**优先级**：P1（用户希望看到程序实际运行结果，这是"写 + 运行"任务的核心闭环体验）

---

### G-5 编辑器标题栏 Keep/Undo 覆层

**Copilot 行为（截图 7）**：
- Diff 编辑器标题栏叠加 Keep/Undo/复制按钮行（与文件名同行）
- 独立于底部 pe-panel 存在，两处操作入口语义一致

**当前插件状态**：pe-panel（底部 L1 层）已有全局 Keep All / Undo All；编辑器标题覆层（L0）未实现。

**实现路径**（两方案，完整规格见 [03-Agent运行时与工作流重构设计.md](../architecture/03-Agent运行时与工作流重构设计.md) 的文件变更与事件协议设计）：
- 方案 A（快速）：`vscode.window.createStatusBarItem` 模拟，监听活跃编辑器变化，显示 Keep/Undo 入口
- 方案 B（完整）：`package.json` `menus.editor/title` contribution point + `deepseek.hasPendingEdit` context key

**优先级**：P3（视觉完整度；pe-panel 已覆盖基本用例，标题覆层属于体验升级）

---

### G-6 Allow 下拉多级权限选项

**Copilot 行为（截图 3-4）**：
- Allow 按钮右侧有 `∨` 下拉，选项：Allow once（默认）/ Always allow in workspace / Manage terminal permissions
- "Always allow" 等价于切换到 autopilot 模式

**当前插件状态**：Allow 无下拉，`executionApproval=confirm` 时直接弹模态确认。

**实现路径**（依赖 G-2 内联卡片）：
1. G-2 卡片中添加 `.tc-allow-group`（split button）+ `.tc-dropdown` 下拉区域
2. 点击 `∨` chevron 展开下拉选项
3. "Always allow" 动作 → `terminalConfirmReply { alwaysAllow: true }` → extension 持久化配置

**优先级**：P2（在 G-2 基础上小成本实现，提升权限管理体验）

---

### 实现路线图（v2.17 新增）

| 阶段 | 涵盖 Gap | 状态 |
|------|---------|------|
| **Sprint G-A（P1 优先）** | G-2（内联确认卡片）+ G-4（程序输出内联）| ✅ 已完成（2026-05-15）|
| **Sprint G-B（P2）** | G-1（推理 bullet）+ G-6（Allow 下拉）| ✅ 已完成（2026-05-15）|
| **Sprint G-C（P3）** | G-3（Ran 行）+ G-5（标题覆层方案 A）| ✅ 已完成（2026-05-15）|
| **Sprint G-D（可选）** | G-5 方案 B（完整编辑器标题）| ⏸ 暂缓（方案 A 已满足用例）|

---

## 九、架构债务（§2.14/§2.15 审计结果，2026-05-12）

### 已修复（本轮完成）

| # | 问题 | 修复方式 | 状态 |
|---|------|---------|------|
| C-4 | `onGrepSearch` `searchDir` 未转义 — shell 注入风险（OWASP A3）| 路径 resolved + 工作区边界校验 + `'\''` 转义 | ✅ |
| H-1 | `processFakeTools` 是 `executeFakeToolsForLoop` 的冗余子集（~70行死代码）| 删除，3 处调用点改用 `executeFakeToolsForLoop` | ✅ |
| H-4 | `injectWorkingAreaStyles` 中 `.agent-todos-card` 等 legacy CSS（16条死规则）| 删除 | ✅ |
| C-1 | 无 `src/utils.ts`；`fenceLangForFile`/`fenceLangForPath` 重复；`roughLineDiff` 单点 | 创建 `src/utils.ts`，合并两处重复函数，两文件改为 import | ✅ |

### 待处理架构债务（已追踪，下一 Sprint）

#### A-1: `extension.ts` 规模失控（§2.15 规则 4）

**问题**：Pending-edits 子系统（`PendingEditRecord`/hunk/LCS/apply/keep/undo/diff view，约 400 行）内联在 `extension.ts` 中。`runChat` 约 600 行，同时处理：①会话状态管理、②目录探索、③bridge检查、④Agent 路径、⑤直接聊天路径，违反单一职责。

**计划**：
1. **Sprint A-1a**：提取 `src/pending-edits.ts`，暴露公共 API（`registerPendingEditChange`、`keepPendingEdit`、`undoPendingEdit`、`postPendingEdits`、`openPendingEditDiff`、`pendingEdits: Map`）；`extension.ts` 只调用公共 API。需要同步抽出 `DiffOp`、`PendingEditRecord`、`PendingEditHunk` 类型。
2. **Sprint A-1b**：`runChat` 拆分为 `runAgentModeChat()` + `runDirectChat()`，Agent 工具回调提取为 `buildAgentToolCallbacks(wsRoot, webview, signal)` 工厂函数。

**前置条件**：`openPendingEditDiff` 使用 `originalContentProvider`、`makeOriginalUri`、`resolveWorkspaceFileUri`，需确认这些依赖可随模块一起迁移或通过参数注入。

**优先**：高（阻碍 `extension.ts` 的可测试性与可维护性）

#### A-2: `sendMessage`/`sendExplicitPrompt` 重复 slash/@ 路由（webview.js）

**问题**：两函数各自包含一套 `/commit`、`/test`、`/shell`、`#problems`、`@atMatch` 分支。新增 slash 命令须改两处。

**计划**：提取 `dispatchPromptToExtension(text, prompt, newSession, mode)` 统一入口；两函数负责自身 flag 管理后委托。

**优先**：中

#### A-3: 历史上下文裁剪策略不健壮 ✅ 已修复（2026-05-15）

**问题**：`sessionHistory.splice(0, 2)` 丢弃最老的消息对，但初始用户上下文通常是最重要的锚点，被丢弃后后续任务可能失去方向感。

**修复**：`agent-loop.ts` 改为 `sessionHistory.splice(2, 2)`——始终保留 index 0、1（初始请求锚点），从 index 2 起删除最老的非锚点消息对。

**优先**：✅（已完成）

---

## 十、近期修复记录（2026-05-19 ~ 2026-05-20）

### B-1: 显示三重修复（体验退化 → 已修复，2026-05-19）

#### B-1a: 编译命令 3 次重复显示 ✅

`terminalRanNotice` 无论是否存在 tc-group 都追加 ran-command-row；`validate` 总是创建独立验证卡片，导致同一命令在 UI 中显示 3 次。

**修复**：
- `terminalRanNotice`：若 `.tc-group-wrap` 已存在则跳过追加 ran-command-row
- `validate` handler：若 tc-group 存在则原地更新最后 tc-row 的 `.tc-decided` 文字，不新建 standalone 卡片

#### B-1b: 无关 TS 诊断注入 Agent 上下文 ✅

`getDiagnosticsContext('active')` 在 Agent 执行 UAV C++ 任务时，若活跃编辑器是 `extension.ts`，会将 DevSeek 插件自身 TS 错误注入到 C++ 任务 prompt。

**修复**：`src/extension.ts` 在调用前检查 `activeFile`，若为 `packages/vscode-extension/src` 或 `node_modules` 则跳过注入。

#### B-1c: 工具栏 "DevSeek" 标签与图标重复 ✅

侧边栏已有 "DEVSEEK" 标签，toolbar 还额外渲染 `<span class="title">DevSeek</span>`，双重冗余。

**修复**：删除 `<span class="title">DevSeek</span>` 及对应 `.title` CSS 规则；sessions-btn 改为 `[图标] 历史对话`。

---

### B-2: 多根工作区路径 BUG ✅ 已修复（2026-05-20）

#### 问题

双根工作区下（`deepseek_netai` = folders[0]，`uav/tars` = folders[1]），请求修改 `tars` 工程文件时，文件被创建到 `deepseek_netai/huida_uav/...`（错误根）而非 `uav/tars/huida_uav/...`（正确根）。

**根本原因**：`findWorkspaceFolderForRelativePath`、`executeTask earlyEffectiveAbsPath`、`effectiveAbsPath` 三处均将 `folders[0]` 作为 fallback，文件不存在时一律返回 `deepseek_netai`。

#### 修复

| 文件 | 改动 |
|------|------|
| `src/workspace-roots.ts` | `findWorkspaceFolderForRelativePath`：文件不存在时改为**目录前缀渐进匹配**（1~3 层），选择路径树最吻合的工作区文件夹 |
| `src/agent-task-decomposer.ts` | `parseTaskPlan`：新增绝对路径直接识别，AI 输出绝对路径时不再截断后与错误根拼接 |
| `src/agent-loop.ts` | `executeTask`：新增 `fs` 和 `findWorkspaceFolderForRelativePath` import；`earlyEffectiveAbsPath`/`effectiveAbsPath` 改为遍历所有工作区文件夹，`create` 任务使用 `findWorkspaceFolderForRelativePath` 选最佳根 |

#### 验证

- 请求修改 `uav/tars/huida_uav/src/oam/src/pump_sprayer/spray_pre_rotate_controller.hpp` → 文件正确写入 `uav/tars` 下
- 单根工作区行为不受影响
- 路径前缀不匹配任何已知目录时仍 fallback 到 folders[0]（兼容原有行为）
