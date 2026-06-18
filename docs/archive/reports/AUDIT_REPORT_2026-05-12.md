# 文档审计报告

> 审计对象：`COPILOT_DISPLAY_STYLE_REFERENCE.md` + `DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md`  
> 审计日期：2026-05-12  
> 审计依据：
> - `/usr/share/code/resources/app/out/vs/workbench/workbench.desktop.main.js`（VS Code 1.112.0）
> - `/usr/share/code/resources/app/out/nls.messages.json`（17,946 条 NLS 字符串）
> - `/home/ff/.vscode/extensions/github.copilot-chat-0.40.1/dist/extension.js`
> - 直接代码执行验证（Python 提取 + grep）

---

## 一、NLS 字符串验证（全部通过）

以下 NLS ID 均经过直接读取 `nls.messages.json` 列表验证，全部正确：

| NLS ID | 内容 | 两份文档中的使用 |
|--------|------|----------------|
| 7416 | `"Finished Working"` | ✅ 正确 |
| 7417 | `"Finished with {0} step{1}"` | ✅ 正确 |
| 7418 | `"Working"` | ✅ 正确 |
| 7442 | `"Clear all todos"` | ✅ 正确 |
| 7444 | `"Collapse Todos"` | ✅ 正确 |
| 7446 | `"Expand Todos"` | ✅ 正确 |
| 7448 | `"completed"` | ✅ 正确 |
| 7449 | `"in progress"` | ✅ 正确 |
| 7450 | `"not started"` | ✅ 正确 |
| 7451 | `"Todos"` | ✅ 正确 |
| 7452 | `"Todos ({0}/{1})"` | ✅ 存在（见下方说明）|

---

## 二、COPILOT_DISPLAY_STYLE_REFERENCE.md 审计

### ✅ 经源码确认正确的内容

| 内容 | 来源确认方式 |
|------|------------|
| thinking box CSS 类名（`chat-thinking-active`, `chat-thinking-streaming`）| workbench.js grep |
| 完成标题 NLS 7416/7417 | nls.messages.json 直接读取 |
| `setFallbackTitle()` 调用时图标变 `codicon-check` | workbench.js 分析 |
| 完成后移除 `chat-thinking-active` | workbench.js 分析 |
| Todo widget 在 input area（`.chat-todo-list-widget-container`）| workbench.js 分析 |
| Todo 状态颜色 `var(--vscode-charts-green/blue/foreground)` | workbench.js `getStatusIconColor()` |
| `progressTask` 是流式响应中的独立机制（非 todo）| workbench.js `ypi` 类分析 |
| NLS 7442/7444/7446/7448/7449/7450/7451 | nls.messages.json 直接读取 |
| 操作图标规则（`codicon-pencil/terminal/sparkle/error`）| workbench.js 分析 |

---

### ⚠️ 发现的问题（共 4 项）

#### 问题 D1-1：【轻微缺失】Section 3.1 未提 Todo 标题进度格式
- **位置**：第三节 3.1，"标题 `Todos` (NLS 7451)"
- **现状**：只提到 NLS 7451（`"Todos"`），未说明 NLS 7452（`"Todos ({0}/{1})"`）
- **实际行为**：当 Todo 列表中有已完成项时，标题可能切换为 `"Todos (2/4)"` 进度格式
- **影响**：低——DeepSeek 参考时可能忽略进度格式的实现
- **建议**：在 3.1 补充："也存在进度格式 `Todos ({done}/{total})`（NLS 7452），当 widget 内有已完成项时显示"

---

#### 问题 D1-2：【推断无声明】Section 1 / Section 5 / Section 7 缺少推断声明
- **位置**：Section 1（气泡布局）、Section 5（代码块）、Section 7（交互行为）
- **现状**：这三节均基于界面观察/推断，但没有像 Section 6 颜色表格那样标注"推断"
- **实际影响**：用到具体值的地方（如 `var(--vscode-chat-requestBackground)`）在使用时需核查
- **建议**：在各节开头加注：`> 本节基于界面观察，非源码验证`

---

#### 问题 D1-3：【潜在错误】Section 4.3 失败情况的标题描述可能不准确
- **位置**：Section 4.3（失败情况）
- **现状**：描述为 "标题不变（仍显示最后的 `Working: ...`）"
- **实际行为**：`setFallbackTitle()` 在流结束时**无条件调用**（包括失败/中断情况）。若执行阶段已追加了工具行（`appendedItemCount > 0`），失败后标题依然会变为 `"Finished with N step(s)"`，而非保持 `"Working: ..."`
- **仅当**流在有工具调用前被中断，且没有追加任何工具行时，才会变为 `"Finished Working"`
- **建议**：修改为："失败的工具行显示 `codicon-error`（红色 ✗）图标；thinking box 标题依然由 `setFallbackTitle()` 更新（`Finished with N step(s)` 或 `Finished Working`），不会停留在 `Working: ...`"

---

#### 问题 D1-4：【轻微缺失】Section 3B progressTask 描述不完整
- **位置**：Section 三B
- **现状**："正在执行时，会在 thinking box 内追加一个 `progressTask` 行"——这表述不够准确
- **实际行为**：`progressTask` 是响应流中的独立 kind（`"progressTask"`），有 `content`、`progress` 数组、`deferred` 异步状态；`progressTaskResult` 追加进度到已有 progressTask 项，而非追加新行；两者在 thinking box 里渲染为独立行
- **影响**：低——描述大体正确，细节有偏差
- **建议**：补充说明 progressTask 是异步完成的（基于 deferred promise），`progressTaskResult` 只是向已有项追加进度文字

---

## 三、DEEPSEEK_AGENT_IMPROVEMENT_REQUIREMENTS.md 审计

### ✅ 经源码确认正确的内容

| 内容 | 来源确认方式 |
|------|------------|
| NLS 7416–7452 全部正确 | nls.messages.json 直接读取 |
| thinking box 状态机（active → 移除 active → check 图标）| workbench.js |
| `task_complete` 作为循环终止信号 | extension.js 分析 |
| `getCurrentTodoContext()` 向 LLM 注入 todo 状态 | extension.js 分析 |
| `_runLoop` / `runOne` 多轮架构 | extension.js 分析 |
| `toolCallLimit` 约 25，autopilot 可扩展 | extension.js 分析 |
| `yieldRequested` 非 autopilot 中途暂停机制 | extension.js 分析 |
| TodoWrite 适配层（Claude 专用）| extension.js `processTodoWriteTool()` |

---

### 🔴 发现的问题（共 5 项，含 2 项重大错误）

#### 问题 D2-1：【🔴 重大错误】manage_todo_list 操作参数完全错误

> **这是文档中最严重的错误，会导致 L-2 需求实现方向错误。**

- **位置**：Section 2.2（Todo 生命周期），Section 四 L-2（工具 schema）
- **文档描述**：
  ```
  AI 调用 manage_todo_list(operation="create", items=[...])
  AI 调用 manage_todo_list(operation="update", taskId, status="in-progress")
  ```
- **实际源码**（workbench.desktop.main.js，`ODi()` 函数）：
  ```
  参数 schema 只有一个字段：
  todoList: {
    type: "array",
    description: "Complete array of all todo items. Must include ALL items - both existing and new.",
    items: { id, title, status }
  }
  ```
  **没有 `operation` 参数，没有 `taskId` 参数。**
- **实际调用方式**：AI 每次调用时提供**全量 todoList**，替换当前状态。无论是"创建"还是"更新"，都是同一个调用——提交包含全部已有和新增项的完整列表。
- **内部 `operation`**：`"write"` / `"read"` 是 extension.js 调用 VS Code 核心 API 时的内部字段，**AI 不可见**。`"read"` 用于 `getCurrentTodoContext()` 内部查询，不暴露给 AI。
- **Claude 特殊路径**：Claude Sonnet 使用其原生 `TodoWrite` 工具（状态值：`"pending"/"in_progress"/"completed"`），extension.js 的 `processTodoWriteTool()` 自动将其映射为 `manage_todo_list` write 调用。
- **需要修正的文档内容**：
  - Section 2.2 生命周期伪代码
  - Section 四 L-2 中的工具 schema（`parameters.operation` 和 `parameters.items` 字段均应删除）

---

#### 问题 D2-2：【🔴 重大错误】manage_todo_list 状态枚举值拼写错误

- **位置**：Section 2.2 "todo item 状态枚举" 列表
- **文档描述**：`"not started"` (空格，与 NLS 显示文字混淆)
- **实际 schema 枚举**（workbench.js `ODi()`）：
  ```json
  "enum": ["not-started", "in-progress", "completed"]
  ```
  **连字符，不是空格。**
- **说明**：NLS 7450 `"not started"` 是界面**显示文字**；工具参数实际接受的是 `"not-started"`（连字符）。`"in-progress"` 写法正确，`"completed"` 写法正确。
- **需要修正**：Section 2.2、Section 四 L-2 中的 `"not started"` → `"not-started"`

---

#### 问题 D2-3：【🟡 不准确】Section 3.1 布局中使用了 📖 emoji

- **位置**：Section 3.1，thinking box 示例布局中有 `📖 Animal.h`
- **问题**：`📖` emoji 是 **DeepSeek 当前实现**的显示，**不是 Copilot 的显示**。Copilot 对所有非编辑、非终端工具用 `codicon-sparkle`（✦），文件读取操作也是 `codicon-sparkle`，不是书本。
- **影响**：中——该节标注为 Copilot 布局示意，却混入了 DeepSeek 的表示法，可能引起误导
- **建议**：将 `📖 Animal.h` 改为 `✦ get_file_contents  Animal.h` 以正确反映 Copilot 行为

---

#### 问题 D2-4：【🟡 不完整】Section 2.1 循环退出条件描述不完整

- **位置**：Section 2.1，`_runLoop` 伪代码注释 "AI 没有调用任何工具，表示完成"
- **问题**：这只是**次要退出路径**（fallback）。首选退出方式是 AI 显式调用 `task_complete` 工具（设置 `taskCompleted=true`）。"无工具调用"作为退出是隐式约定，可靠性低于 `task_complete`。
- **建议**：注释改为 "AI 未调用任何工具（隐式完成，非首选）；首选通过 `task_complete` 工具显式结束"

---

#### 问题 D2-5：【🔴 重大缺失】无 DeepSeek 网页形式对照分析

- **问题**：文档完全没有分析"DeepSeek 网页形式（webview）哪些可以完全对照 Copilot，哪些存在架构问题"
- **这是用户的核心需求之一**（"基于 deepseek 网页形式，那些可以完全对照，那些可能存在问题"）
- **见本报告第四节**——补充完整的对照分析

---

## 四、DeepSeek 网页形式（Webview）对照 Copilot 分析

> DeepSeek 插件的 UI 运行在 VS Code Webview **隔离沙箱**中（`packages/vscode-extension/media/webview.js`），不能访问 VS Code 核心 DOM。Copilot 的 UI 是 VS Code 核心直接渲染的。以下分析基于此前提。

### 4.1 可完全对照实现（仅改 webview.js / extension.ts）

| 对照项 | Copilot 标准 | DeepSeek 当前 | 对照方式 | 复杂度 |
|-------|-------------|--------------|---------|--------|
| 折叠区标题动态文字 | `Working: ...` 运行中；`Finished with N step(s)` 完成 | 始终 `Todos` | 修改 `aut-label` 赋值逻辑 | 低 |
| 完成后停动画 | 移除 `chat-thinking-active` | CSS 规则存在但 `data-done` 未写入 | `autDets.setAttribute('data-done','1')` | 极低 |
| 状态颜色语义化 | `--vscode-charts-green/blue` | 硬编码 rgba | 改 CSS 变量 | 极低 |
| Todo 状态图标语义 | `codicon-pass`/`codicon-record`/`codicon-circle-outline` | 自定义 emoji | 在 webview 中使用 `<i class="codicon codicon-xxx">` （需加载 codicons.css）| 低 |
| 完成 diff 徽章格式 | `+N -M` 绿/红 | 已有，颜色接近 | 改用 `--vscode-charts-green` | 极低 |

**结论**：以上 5 项均可在 `webview.js` 层完成，无需改架构。

---

### 4.2 可近似实现（需修改 bridge-client.ts + agent-loop.ts）

| 对照项 | Copilot 方式 | DeepSeek 限制 | 可行替代方案 | 风险 |
|-------|-------------|--------------|------------|------|
| 多轮对话历史 | 每轮 `runOne` 包含完整消息历史 | 每任务独立 prompt，无跨任务历史 | 在 `agent-loop.ts` 中维护 `messageHistory[]`，每次 `callLLM` 传递 | 中（token 消耗增加，需对话压缩）|
| 追加式工具行 | 每工具调用实时追加行 | 预建所有占位行，执行时更新 | 修改为"执行时追加"模式（删除 plan 阶段预建逻辑）| 低 |
| 实时标题更新 | `Working: {invocationMessage}` 每步更新 | 无实时更新，始终显示 `Todos` | 每步执行时通过 `postMessage` 更新标题 | 低 |

---

### 4.3 存在架构障碍（无法直接对照，需系统性改造）

#### 障碍 A：`manage_todo_list` 工具无法作为真正的 AI 工具调用

**Copilot 架构**：VS Code 核心提供 `manage_todo_list` 作为原生工具，通过 `vscode.lm` API 传递给 LLM，LLM 原生 function calling 调用它。

**DeepSeek 架构**：
```
webview.js → bridge-client.ts → HTTP /chat → 本地 bridge server (port:3721) → DeepSeek API
```

实现 `manage_todo_list` 作为 AI 工具调用需要：
1. Bridge server 支持向 DeepSeek API 传递 `tools` 参数（DeepSeek API 支持 OpenAI 格式 function calling）
2. Bridge server 解析响应中的 `tool_calls` 字段并路由回 extension
3. Extension 的 `onToolCall` 回调执行工具逻辑并将结果返回 LLM

**可行替代方案（推荐）**：
- 通过系统提示词指示 AI 输出结构化的 `[TOOL:manage_todo_list {...}]` 格式
- Extension 解析该格式，在 `agent-loop.ts` 中执行 todo 更新，无需 bridge server 改动
- 这是 "poor man's function calling"，不如原生 function calling 可靠，但避免改动 bridge server

---

#### 障碍 B：VS Code 原生 Todo widget 无法在 Webview 中复用

**Copilot 架构**：Todo widget 是 VS Code 核心 UI 组件（`createChatTodoWidget`），通过内部 API 挂载在 input area。

**DeepSeek 架构**：Webview 沙箱无法访问 VS Code 核心 DOM，也无法调用 `createChatTodoWidget` API（即使该 API 公开，webview JS 也无权限）。

**可行替代方案（推荐）**：
- 在 webview 内保留 `.aut-container` 方案（当前设计）
- 通过 CSS 定位将 aut-container 固定在 webview 底部，视觉上模拟 Copilot 的"input area todo widget"位置
- 语义上与 Copilot 不同，但用户体验可接近

---

#### 障碍 C：Webview 内 codicon 可用性

**Copilot**：直接使用 VS Code 核心的 codicon 字体，无障碍。

**DeepSeek Webview**：需要在 webview HTML 中加载 codicons.css + 字体文件。Extension 需要：
```typescript
// extension.ts 中 createWebviewPanel 时：
localResourceRoots: [..., vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons')]
// webview HTML 中：
<link href="${codiconsUri}" rel="stylesheet" />
```
**是否可行**：可行，但需要验证路径配置正确。`@vscode/codicons` 包已是标准 VS Code 扩展依赖。

---

### 4.4 无法对照实现（架构级限制）

| 项目 | 原因 | 建议 |
|------|------|------|
| Copilot 原生 `chat-thinking-box` CSS 渲染 | 该组件由 VS Code 核心直接渲染，生存在主 DOM，非 webview | 使用 `.aut-container` 近似仿造 |
| `vscode.lm` API 原生工具调用 | DeepSeek 使用 HTTP bridge，不接入 `vscode.lm` | 需改造 bridge-client 以支持 function calling |
| autopilot 权限模型（`permissionLevel`）| Copilot 与 VS Code 核心权限系统深度集成 | 可实现简化版（设置项控制"自动/手动"模式）|

---

## 五、总结与建议

### 5.1 需立即修正的文档错误

| 优先级 | 错误 | 修正内容 |
|--------|------|---------|
| 🔴 P0 | D2-1: manage_todo_list 操作参数错误 | 删除 `operation`/`taskId`；改为"AI 每次提供完整 `todoList` 数组" |
| 🔴 P0 | D2-2: `"not started"` → `"not-started"` | 状态枚举值全局替换 |
| 🔴 P0 | D2-5: 缺少 DeepSeek 网页对照分析 | 根据本报告第四节补充 |
| 🟡 P1 | D1-3: 失败情况标题描述有误 | 修正为"setFallbackTitle() 无条件调用" |
| 🟡 P1 | D2-3: 布局中 📖 emoji 混淆 | 改为 `codicon-sparkle` 描述 |
| 🟢 P2 | D1-1: NLS 7452 进度格式遗漏 | 在 3.1 补充说明 |
| 🟢 P2 | D1-2: 推断内容无声明 | 加"非源码验证"注释 |
| 🟢 P2 | D2-4: 循环退出条件不完整 | 补充 `task_complete` 是首选退出 |

### 5.2 技术结论

**可立即实施（1~3 小时，仅改 webview.js）**：
- P-F 标题动态化、P-G data-done、P-H 颜色语义化

**需设计的改造（1~5 天）**：
- 多轮对话历史（bridge-client.ts + agent-loop.ts）
- Function calling 支持（bridge server 改造或系统提示词方案）
- Codicons 加载（extension.ts webview 配置）

**不可直接对照，只能近似**：
- Todo widget 位置（保持 webview 内方案）
- Copilot 原生 thinking box CSS（保持 `.aut-container` 方案）
