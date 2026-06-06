# Copilot 对话框显示风格参考手册

> 基于 GitHub Copilot Chat（VS Code 插件，`github.copilot-chat-0.40.x`）对话界面的实测观察  
> 整理目的：作为 DeepSeek 插件显示风格对齐的参照标准  
> 更新日期：2026-05-26（新增 §二十四 截图实测审计 + §二十五 三层渐进式披露架构深度分析）  
> 源码依据：`/usr/share/code/resources/app/out/vs/workbench/workbench.desktop.main.js` + `workbench.desktop.main.css` + `nls.messages.json`（VS Code 1.112.0）  
> **本版新增**：§二十四 DevSeek 1.0.0 截图实测审计（2026-05-26）

---

## 一、对话气泡布局（截图实测 2026-05-12）

### 1.1 完整布局结构（截图精确还原）

```
                         ┌─────────────────────────────────────┐
                         │ 用户气泡文字（右对齐，自适应宽度）     │  ← 蓝框
                         └─────────────────────────────────────┘

  Analyzed user's issues with DeepSeek...     ← Working 完成行（小字/灰/可展开）

  先详细分析代码，理解当前问题所在。             ← 中间轮次 AI prose（可有可无）

  Searched for regex and checked lines...     ← 第二个 Working 完成行

  ┌─ Working ────────────────────────────┐
  │  [推理/搜索内容流式输出中...]           │  ← 最后一个 Working（进行中）
  │  ● Considering                       │
  └────────────────────────────────────────┘

  Considered approaches...                   ← 最后 Working 折叠行

  已完成对问题的分析。根本原因是…             ← ⭐ 最终总结性 prose（详见 §12.6）
  具体修复建议如下：                           （大字，完整 Markdown 段落）
  - 问题一：…
  - 问题二：…

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Todos (5/5)                      [≡×]    ← Todos widget（独立）
    ✓ 分析问题根因
    ✓ webview.js 分析子任务单容器修复
    ✓ webview.js 隐藏 agent 模式无意义摘要
    ✓ extension.ts CSS 弱化边框+占满宽度
    ✓ 编译验证
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [用户输入框]
```

### 1.2 用户气泡（蓝框）

**实测特征（截图确认）：**
- **右对齐**，宽度跟随内容自适应（非固定 `max-width: 88%` 的大块）
- 圆角（约 12px），背景色：`var(--vscode-chat-requestBackground)` 或 `input-background` fallback
- **内容换行则气泡变宽/变高，单行则紧凑**
- 无头像，无时间戳，无阴影
- 支持基础 Markdown（粗体、行内代码）

### 1.3 助手回复（prose）
- **无任何外框**：直接在对话流中渲染
- 字体略大于 Working 完成行（约 12–13px）
- 行高约 1.5–1.6，段落间距正常
- 代码块：高亮 + 右上角复制按钮 + 语言标签

---

## 二、工具操作区（Thinking Box）

**这是 Copilot Agent 最核心的显示组件。**

> **源码依据**：CSS 类 `chat-thinking-box`, `chat-thinking-tool-wrapper`, `chat-thinking-active`, `chat-thinking-streaming`

### 2.1 折叠区外观（运行中）

```
  ╷ Working: src/foo.cpp  ⟳        ← 折叠头（标题 + 加载动画）
  ╷   ✏ spray_pre_rotate_controller.hpp   +12 -3
  ╷   📖 spray_flight_state_monitor.hpp
  ╷   ✏ CMakeLists.txt  +1 -0
```

- **左边竖线**：细灰线，不是方框
- **背景**：无背景色（透明感）
- **折叠头标题格式**：`Working: {当前操作文件或动作摘要}`
- 运行中：有加载 shimmer 动画

### 2.2 完成后行为（⭐ 截图实测精确）

完成后 thinking box **变为单行文字**，几乎不可见，但可点击展开：

```
  Analyzed user's issues with DeepSeek plugin functionality   ▸
```

**视觉特征（截图精确）：**
- **无左边竖线**（done 后 `border-left` 消失或透明）
- **无背景、无外框**
- 字体：11px，`opacity: 0.5~0.6`，轻度倾斜感（接近 italic）
- 颜色：`var(--vscode-descriptionForeground)` 或灰白色系
- 右侧有展开箭头 `▸`（`codicon-chevron-right`）
- **极小的垂直占用空间**（`padding: 2px 0`）
- 图标：✓ `codicon-check`，绿色（仅在图标区，不影响文字样式）

**DevSeek 对齐状态（2026-05-26 截图实测确认已全部修复）：**
- ✅ done 后左竖线已隐藏（截图证实）
- ✅ 摘要文字已变小变灰（截图证实）
- ✅ 垂直空间紧凑（截图证实）

### 2.3 操作行格式（`chat-thinking-tool-wrapper`）

每行：`[图标] [invocationMessage 文字]  [diff徽章（可选）]`

| 操作类型 | 图标 | 示例 |
|---------|------|-----|
| 编辑文件 | `codicon-pencil`（✏）| `✏ src/main.cpp  +8 -2` |
| 终端命令 | `codicon-terminal`（⚙）| `⚙ cmake --build .` |
| 其他工具 | `codicon-sparkle`（✦）| `✦ get_errors()` |

**关键：无彩色分类徽章**

### 2.4 diff 徽章
- 格式：`+12 -3`，紧跟文件名后
- 颜色：`+N` 绿色，`-N` 红色
- 仅在编辑操作且有实际改动时显示

### 2.5 完成标题文字（NLS 确认）

- NLS 7417: `"Finished with {0} step{1}"`（N = 工具调用次数）
- NLS 7416: `"Finished Working"`（无工具调用时）
- 图标：`codicon-check`（✓），绿色

---
  - 标题区显示加载 shimmer 动画：`Working: {latest_detail}`

### 2.2 完成后行为（关键！与之前文档描述不同）

1. 调用 `setFallbackTitle()`，标题切换为：
   - **`Finished with N step(s)`**（当 `appendedItemCount > 0` 时，N = 追加的操作行数）
   - **`Finished Working`**（无任何操作行时）
   - 图标切换为 ✓（`codicon-check`）
2. 移除 `chat-thinking-active`，移除 `chat-thinking-streaming`
3. `streamingCompleted = true`
4. 折叠区**自动收起**（collapse button 状态更新），chevron 指向右（可展开）
5. 用户可点击展开查看每步历史

> ⚠️ **修正**：之前文档称完成标题为 "Used N tools"，**实际上是 "Finished with N step(s)"（NLS 7417）或 "Finished Working"（NLS 7416）**

### 2.3 操作行格式（`chat-thinking-tool-wrapper`）

每行：`[图标] [invocationMessage 文字]  [diff徽章（可选）]`

工具行的图标由 workbench 根据工具类型决定：

| 操作类型 | 图标（codicon 图标库） | 示例显示 |
|---------|----------------------|---------|
| 编辑文件（markdownContent） | `codicon-pencil`（✏）| `✏ src/main.cpp  +8 -2` |
| 终端命令（toolSpecificData.kind=terminal）| `codicon-terminal`（⚙）| `⚙ cmake --build .` |
| 终端命令失败 | `codicon-error`（✗）| `✗ cmake --build .` |
| hook 结果 blocked | `codicon-error`（✗）| `✗ blocked action` |
| hook 结果 warning | `codicon-warning`（⚠）| `⚠ warning` |
| 其他工具 | `codicon-sparkle`（✦）| `✦ get_errors()` |

**关键：无彩色分类徽章**（不像 DeepSeek 原版的 `[修改]` `[分析]` 胶囊按钮）

### 2.4 diff 徽章

- 格式：`+12 -3`，紧跟文件名后
- 颜色：`+N` 绿色，`-N` 红色
- 仅在**编辑操作**且有实际改动时显示

### 2.5 单工具调用特殊情况

当 `toolInvocationCount === 1 && hookCount === 0` 时，thinking box 会**直接提升**（"isolate"）该工具的 DOM 节点，不创建包装层，节省空间。

---

## 三、Todo 清单（`chat-todo-list-widget`）

> ⚠️ **重要架构发现**：Copilot 的 Todo 清单**不在响应流中**，而是位于**聊天输入框区域（input area）**，是一个独立 widget。

### 3.1 位置与结构

```
┌─ 聊天输入框 ────────────────────────────────────┐
│  [Todos ▼]                                      │  ← chat-todo-list-widget
│    ○  task 1 (not started)                      │
│    ● task 2 (in progress)                       │
│    ✓  task 3 (completed)                        │
│                                                 │
│  [用户输入框]                                    │
└─────────────────────────────────────────────────┘
```

- Todo widget 挂载在 `.chat-todo-list-widget-container` 内
- 由 `chatTodoListService` 管理，数据通过 `memento` 持久化到 session
- 与响应流（thinking box）**完全分离**
- 标题 `"Todos"` (NLS 7451)，有展开/收起按钮；当列表中有已完成项时切换为进度格式 `"Todos (N/M)"` (NLS 7452)
- 有 **Clear All** 按钮（`codicon-clearAll`），aria-label = `"Clear all todos"` (NLS 7442)

### 3.2 Task 状态系统（`getStatusIconClass` + `getStatusText`）

| 状态值 | 图标 class | 图标颜色 | 显示文字 |
|-------|-----------|---------|---------|
| `"completed"` | `codicon-pass` | `var(--vscode-charts-green)` | `"completed"` (NLS 7448) |
| `"in-progress"` | `codicon-record` | `var(--vscode-charts-blue)` | `"in progress"` (NLS 7449) |
| 其他（not started）| `codicon-circle-outline` | `var(--vscode-foreground)` | `"not started"` (NLS 7450) |

### 3.3 完成后行为

- 任务完成时，状态更新为 `"completed"`（绿色 ✓）
- Todo 列表在 session 内持久化，不会随对话消失
- **不会自动展开到响应流**

---

## 三B. 响应流中的 "进度消息"（`progressTask` / `progressTaskResult`）

> 与 Todo 清单不同，响应流中也有一种轻量进度项。

- 格式：`progressTask` 类型（`kind: "progressTask"`），有 `content` 文字 + `progress` 数组 + `deferred` 异步状态（基于 Promise）
- 每个 progressTask 在 thinking box 内显示为独立行，是一个异步任务
- `progressTaskResult`（`kind: "progressTaskResult"`）向已有 progressTask 项**追加进度文字**，不是追加新行；任务完成后 deferred resolve
- 这与 todo list 是**两套机制**，`progressTask` 是响应内嵌的异步进度项，todo list 是 input area 的持久计划

---

## 四、完成状态显示

### 4.1 Thinking Box 完成标题（源码确认）

完成后 thinking box 折叠，标题自动变为：

```
  ✓  Finished with 4 step(s)        ← N = appendedItemCount（实际追加的工具行数）
```
或（无工具调用时）：
```
  ✓  Finished Working
```

- NLS 7417: `"Finished with {0} step{1}"`（`{1}` 为空或 `"s"`）
- NLS 7416: `"Finished Working"`
- 图标：`codicon-check`（✓），由 `this._collapseButton.icon = R.check` 设置

### 4.2 助手正文摘要（⭐ 核心 UX 模式）

这是 Copilot Agent 显示的**最关键**视觉层次：**上方小字（可折叠详情） + 下方大字（主要摘要）**。

```
  ╷ ✓ Finished with 4 step(s)          ← 小字，可点击展开查看执行明细
      [展开后显示每步工具行]

  已完成修改，共更新了以下文件：        ← 大字（AI Markdown 正文，下方）
  - `src/foo.cpp`：修复了 N 处问题
  - `CMakeLists.txt`：添加了新目标
  ...（AI 详细说明）
```

**视觉层次原则：**
- 小字部分（thinking box）= 技术细节，默认折叠，用户按需查看
- 大字部分（AI prose）= 主要信息，直接可见，用户无需关心 working 过程

**CRITICAL — DOM 顺序要求：**
Copilot 中 AI 的 prose 正文位于 thinking box **下方**，不是上方。
原因：thinking box 在 LLM 流式响应开始时就创建，prose 是工具调用执行完毕后续生成的。

**工具调用文本（`[TOOL:...]`）不显示在 prose 中：**
AI 输出中嵌入的 `[TOOL:task_complete {"summary":"..."}]` 等调用块在展示给用户前需要过滤掉，只保留自然语言部分。

- 单流渲染，无额外"完成卡片"
- 文件变更摘要（`{N} files changed`，`{N} lines added, {M} lines removed`）
  可能由 AI 在正文中描述，或通过 `chat-file-changes` 小组件显示

### 4.3 失败情况

- `setFallbackTitle()` **无条件调用**（包括失败/中断情况）：若已追加工具行（`appendedItemCount > 0`）则标题变为 `Finished with N step(s)`，否则变为 `Finished Working`；**不会停留在 `Working: ...`**
- 失败的工具行会显示 `codicon-error`（红色 ✗）图标
- `chat-hook-outcome-blocked` 类标记被 hook 阻断的操作

---

## 五、代码块显示

> 本节基于界面观察，非源码直接验证。

### 5.1 标准代码块

```
  ┌─ cpp ──────────────────── [复制] [更多▾]
  │ // 代码内容
  │ int main() { ... }
  └────────────────────────────────────────
```

- 圆角方框，背景略深
- 右上角操作按钮：**复制**、**插入到光标位置**、**在新文件中打开**
- 语言标签左上角（小字、dimmed，opacity ≈ .52）
- 工具栏背景：`var(--vscode-textCodeBlock-background)` — 与 pre 内容区一致，无彩色渐变

### 5.1B 长代码块折叠（DeepSeek 实现，2026-05-15）

- **阈值**：> 20 行自动折叠
- **折叠头格式**：`› cpp · 87 行  点击展开`（左竖线 + 语言 + 行数 + 提示）
- **展开后**：`› cpp · 87 行  点击折叠`（图标旋转 90°）
- 折叠状态默认关闭，用户手动展开
- 实现类：`.collapsed-code-block`（webview.js `injectWorkingAreaStyles`）+ `addCodeToolbars` + `toggleCollapsedCode`

### 5.2 内联代码

- 反引号包裹，背景色高亮，字体等宽

---

## 六、颜色与字体规范（源码确认值）

| 元素 | 颜色 / CSS 变量 | 来源 |
|------|----------------|------|
| 工具折叠区左竖线 | `rgba(127,127,127,.28)` 或 `--vscode-editorGroup-border` | 推断 |
| 工具折叠区标题 | `rgba(180,180,180,.75)` 暗淡灰 | 推断 |
| Todo 进行中图标 | `var(--vscode-charts-blue)` | 源码确认（`getStatusIconColor`）|
| Todo 已完成图标 | `var(--vscode-charts-green)` | 源码确认（`getStatusIconColor`）|
| Todo 未开始图标 | `var(--vscode-foreground)` | 源码确认（`getStatusIconColor`）|
| diff `+N` | `var(--vscode-chat-linesAddedForeground)` | **源码确认**（§13.10）；DeepSeek 当前用硬编码 `rgba(100,220,120,.9)` |
| diff `-N` | `var(--vscode-chat-linesRemovedForeground)` | **源码确认**（§13.10）；DeepSeek 当前用硬编码 `rgba(255,110,110,.9)` |
| 完成状态图标 | `codicon-check`（系统图标色）| 源码确认 |

字体：继承 `--vscode-font-family`，字号 11–12px，行高 1.4–1.5。

---

## 七、交互行为规范

> 本节基于界面观察及逻辑推断，非源码直接验证。

| 行为 | Copilot 做法 |
|------|-------------|
| Agent 启动 | 创建 thinking box；Todo widget 在 input 区出现（若有 plan）|
| 每步执行 | thinking box 内追加操作行；todo widget 中对应项变 in-progress |
| 步骤完成 | 操作行显示 diff；todo widget 中对应项变 completed |
| 全部完成 | thinking box 折叠，标题改为 `Finished with N step(s)`；todo widget 全绿 |
| 用户滚动 | 不自动跳到底部（尊重用户阅读位置）|
| 用户点击文件名 | 打开文件（或 diff 视图）|
| 用户点击 thinking box 标题 | 展开/收起工具调用历史 |

---

## 八、DeepSeek 插件对齐差距记录（2026-05-12 更新）

### 8.1 已对齐项（✅ 已完成，2026-05-09）

| 维度 | Copilot 标准 | DeepSeek 当前实现 |
|------|-------------|------------------|
| 助手回复外框 | 无 border/background | `.assistant-bubble` → 无边框无背景，`padding: 2px 0` |
| 用户气泡背景色 | `--vscode-chat-requestBackground` | 已使用该变量 + `--vscode-input-background` 作 fallback |
| 用户气泡前景色 | `--vscode-foreground`（非按钮白） | `color: --vscode-foreground` |
| 用户气泡圆角 | 全四角均匀（约 12px） | `border-radius: 12px`（已去掉右下切角） |
| 页面背景装饰 | 无渐变 | 已移除 `radial-gradient` 装饰背景 |
| 工具区外框 | 左线条，无方框，无背景 | `.aut-container` → `border-left: 2px solid` + `background: none` |
| 操作行彩色胶囊 | 无 | analysis/execution 路径已去掉 `[修改]` `[分析]` 彩色 badge；⚠️ **file-edit 折叠标题行仍使用文件名 badge**（见 §24.2 偏差1）|
| 操作图标区分 | ✏/⚙/✦/✗ 按操作类型 | `aut-ficon` 按 action 输出不同 emoji |
| 进行中指示 | 动画脉冲（`codicon-record` 蓝色）| `.aut-row.state-started .aut-icon` 有 `wiBlink` 动画 |
| diff `+N` 颜色 | 绿色（`var(--vscode-charts-green)` 同系）| `.aut-added { color: rgba(100,220,120,.9) }` |
| diff `-N` 颜色 | 红色 | `.aut-removed { color: rgba(255,120,120,.85) }` |
| 工具区统一面板 | 单个 thinking box，无分离 | `aut-container` 统一展示 |
| 完成摘要样式 | 单行内嵌文字，无卡片 | `agent-done-line` → `display:flex; font-size:11px; padding:2px 0` |
| agent 模式队列卡片 | 不显示 | `addQueueReadySummaryCard()` 在 agent 模式直接 `return` |
| 折叠区完成自动收起 | 是 | done 阶段 `details.removeAttribute('open')` |
| 任务描述副文字 | 行内 opacity 淡显 | `.aut-desc` opacity `.45`，进行中变蓝加粗 |

### 8.2 架构级差异（源码分析确认，2026-05-12 → 均已解决）

以下差异记录在源码分析时存在，均已通过后续迭代对齐：

| 维度 | Copilot 实际架构 | DeepSeek 解决方案 | 状态 |
|------|----------------|-----------------|------|
| **Todo 清单位置** | **input 区域**独立 widget | ✅ `#agent-todos-widget`，挂载于 input 区域上方，持久化 | ✅ 2026-05-13 |
| **折叠区标题** | `Working:` → `Finished with N step(s)` | ✅ `buildFinishedLabel()`：动作前缀 + 任务描述 + step 数 | ✅ 2026-05-13 |
| **工具行生成方式** | 追加式（无预建占位行） | ✅ F-4：`.aut-step` 行在 execute 阶段逐个追加 | ✅ 2026-05-13 |
| **完成后标题** | `Finished with N step(s)` 自动计数 | ✅ `buildFinishedLabel()` 计算并显示 | ✅ 2026-05-13 |
| **File Changes 框** | input 区域上方独立 widget | ✅ `#agent-file-changes-widget`，done 阶段渲染，含文件列表+diff | ✅ 2026-05-12 |

### 8.3 已完成项（2026-05-12 全部对齐）

| 维度 | Copilot 标准 | DeepSeek 当前 | 状态 |
|------|-------------|--------------|------|
| working 完成后 prose 位置 | thinking box **下方** | 已修复（deferred bubble 模式） | ✅ 2026-05-11 |
| `[TOOL:...]` 文本不显示 | prose 只含自然语言 | 已修复（stripToolCallBlocks）| ✅ 2026-05-11 |
| codicon 图标字体 | `<i class="codicon ...">` 渲染 | 已修复（codicon.css/ttf 加入 media/，CSP 更新）| ✅ 2026-05-11 |
| 折叠区标题文字 | `Working: {file}` → `Finished with N step(s)` | 已修复 | ✅ 2026-05-10 |
| `data-done` 属性 | 完成后停止动画 | 已修复 | ✅ 2026-05-10 |
| 主题颜色 | `var(--vscode-charts-green)` 等语义变量 | 已修复 | ✅ 2026-05-10 |
| 工具活动显示方式 | 每次工具调用追加一行（不是聚合胶囊）| 已修复（chips → `.aut-step` 逐行追加）| ✅ 2026-05-13 |
| API 模式 "响应解析失败" | 请求 body 的 `stream` 字段与响应处理方式一致 | 已修复（`useStream = opts.stream !== false && !!opts.onDelta`，`deepseek-api.ts` + `openai-compat.ts`）| ✅ 2026-05-13 |
| 网页模式长生成超时 | deadline 随内容增长滚动延伸 | 已修复（`deepseek-agent.ts` `pollForStreamingResponse` 中每次文本增长重置 deadline）| ✅ 2026-05-13 |
| 完成标题有意义 | task 描述/文件名（非通用 "Finished Working"）| 已修复（`buildFinishedLabel()`：动作前缀 + 任务描述，截断至 42 字符）| ✅ 2026-05-13 |
| Todos 框持久显示 | input 区域上方，agent 完成后不消失 | 已修复（`#agent-todos-widget`：生命周期独立于响应流，`userMessage` 才清除）| ✅ 2026-05-13 |
| File Changes 框 | input 区域上方，agent done 后显示已编辑文件+diff | 已实现（`#agent-file-changes-widget`：`AgentStatusMessage.editedFiles`，`renderFileChangesWidget()`，`afc-*` CSS）| ✅ 2026-05-12 |

---

## 九、待优化项（2026-05-15 更新）

### 9.0 已完成新增项（2026-05-15）

| # | 内容 | 状态 |
|---|------|------|
| P-R | **代码块可折叠** — >20 行的代码块自动折叠，点击展开；折叠头显示语言标签+行数；实现：`addCodeToolbars` 末尾 `collapsed-code-block` 封装 | ✅ 2026-05-15 |
| P-S | **代码块工具栏颜色** — 去掉蓝橙渐变背景，改为 `var(--vscode-textCodeBlock-background)` 匹配 VSCode 主题；`.code-lang` opacity 降至 .52，颜色用 `--vscode-descriptionForeground` | ✅ 2026-05-15 |
| P-M | **分析模式 Working box 无链接行** — 移除 `createAnalyzeFileCard` af-card，分析内容通过 `routeAnalysisToWorkingBox` 流入 Working box 内部 | ✅ 2026-05-15 |
| P-N | **无大蓝色任务卡片** — 废弃 `af-container`/`af-card` 系统；`analyzeFile`/`analyzeSummary` phase 不再创建独立卡片 | ✅ 2026-05-15 |
| P-O | **Working box 底部 `● Status` 状态词** — `startWorkingShimmer` 插入 `.aut-spinner-row`（`codicon-circle-filled` + shimmer label），`finalizeExecContainer` 移除；CSS：`.aut-spinner-label` shimmer 动画 | ✅ 2026-05-15 |
| P-P | **分析完成折叠格式** — `data-analyze` 属性标记分析容器；CSS：`[data-done][data-analyze]` 移除所有边框+icon，纯文字 `Analyzed X`（11px，opacity 0.42） | ✅ 2026-05-15 |
| P-Q | **Working box 内部结构** — 移除 `isAnalysisSubTask` 共享容器逻辑；每个文件分析独立 Working box；`\x00AFILE:` delta 路由到 `routeAnalysisToWorkingBox`（写入 `.aut-analysis-body`）；`\x00ASUM\x00` delta 路由到 `currentRaw` → 触发 deferred 推理气泡 | ✅ 2026-05-15 |

### 9.1 已知显示偏差（截图实测确认，2026-05-12 → 全部已修复 2026-05-15）

以下偏差基于截图实测，已全部对齐 Copilot 风格：

| # | 问题 | Copilot 正确 | 修复方案 | 状态 |
|---|------|------------|----------|------|
| P-L | **isAgentMode 被 resetWorkingArea() 覆盖** | agentMode 在 reset 后设定 | `isAgentMode` 在 `resetWorkingArea()` 后同步设定 | ✅ 2026-05-12 |
| P-M | **分析模式 Working box 内出现链接行** | 无链接行 | 废弃 `createAnalyzeFileCard`；内容通过 `routeAnalysisToWorkingBox` 流入 Working box | ✅ 2026-05-15 |
| P-N | **分析模式出现大蓝色任务卡片** | 无任务卡片 | 废弃 `af-container`/`af-card`；`analyzeFile` phase 不再创建独立卡片 | ✅ 2026-05-15 |
| P-O | **Working box 内无底部 `● Status` 状态词** | `● Analyzing` / `● Considering`（斜体灰色 11px）| `.aut-spinner-row`：`codicon-circle-filled` + shimmer label；`startWorkingShimmer` 插入，`finalizeExecContainer` 移除 | ✅ 2026-05-15 |
| P-P | **分析完成折叠格式不匹配** | `Analyzed [描述]`（纯文字行，无框）| `data-analyze` 属性 + CSS：`[data-done][data-analyze]` → `border:none`，icon 隐藏，label opacity 0.42 | ✅ 2026-05-15 |
| P-Q | **Working box 内容区结构不匹配** | 推理文字 + 代码块混排（AI prose 风格）| 移除 `isAnalysisSubTask` 共享逻辑；每文件独立 Working box；`\x00AFILE:` delta → `.aut-analysis-body` 内 markdown 渲染 | ✅ 2026-05-15 |

> 详见 §12 的完整规范说明。

### 历史已完成（P-J / P-K）

1. **P-J — 跨轮上下文注入（"按照建议" 类请求）**
   - **修复**：`runAgentLoop` 新增 `analysisContext` 参数 → `buildEditorPrompt` 注入上轮分析
   - **状态**：✅ 已修复（2026-05-12）

2. **P-K — `extractAnalysisFindings` 关键词扩展**
   - **修复**：正则扩展 + 上限从 10 条升至 20 条
   - **状态**：✅ 已修复（2026-05-12）

---

## 十二、分析/推理模式 Working Box 精确视觉规范（截图实测 2026-05-12）

> **背景**：现有 §2 描述的是文件修改型 Working box（✏ file +12 -3 格式）。  
> 本节专门记录**分析/搜索/推理**场景下 Copilot 的 Working 呈现方式，截图来源为 Copilot 实际运行截图（2026-05-12 沟通确认版）。  
> ⚠️ **当前 DeepSeek 实现与此有重大偏差，尚未对齐。**

---

### 12.1 激活状态（streaming，Working 进行中）

**实测截图特征（screenshot 2 第三个框）：**

```
┌─ Working ──────────────────────────────────────────────────┐
│                                                             │
│   if (msg.phase === 'execute') {                           │  ← 代码块（文件读取输出）
│     if (!msg.taskFile && !msg.taskId) return;             │
│     // ← RETURNS EARLY if no taskFile/taskId!             │
│   }                                                         │
│                                                             │
│   So the "开始执行" message is silently ignored by         │  ← AI 推理文字
│   the webview. Then executeAnalysisConsolidated            │    （与代码块交替出现）
│   sends started for task[0] with taskFile and             │
│   taskIndex, which triggers the Working container.        │
│   But here's the critical issue: agentPlanDone is still   │
│                                                             │
│  ● Considering                                             │  ← 底部状态行
└─────────────────────────────────────────────────────────────┘
```

**元素明细：**

| 元素 | 位置 | 视觉特征 |
|------|------|---------|
| 标题 `Working` | 左上角 | 纯文字，无冒号，无文件名，无 ⟳ 图标（注意：不是 "Working: filename"）|
| 内容区 | 中间区域 | **代码块 + 推理文字混排**，与正常 AI 输出完全相同的渲染风格 |
| 代码块 | 内容区 | 标准 markdown 代码块，有语法高亮，等宽字体 |
| 推理文字 | 内容区 | 普通 prose，行内代码用反引号样式 |
| 底部状态行 | 最底部 | `● [状态词]`，**这是关键特征**，见 12.2 |

**⚠️ 与文件编辑模式的区别**（文件编辑模式见 §2.1）：
- 无 `✏ filename +12 -3` 类型的操作行
- 无彩色 badge/胶囊（`[analyze]`, `[1/1]` 之类完全不存在）
- 无任务卡片（`[1/1] hello_ai_programmer.c 分析...` 类型的大蓝框 **绝对不应出现**）
- 无链接行（`hello_ai_programmer.c 分析 hello_ai_programmer.c` 行 **绝对不应出现**）

---

### 12.2 底部状态词（`● Status word`）— 核心特征

Working box 底部固定有一个轻量状态行，全程跟随：

```
● Analyzing      ← 正在分析（截图1底部实测）
● Considering    ← 正在推理（截图2第三框底部实测）
● Searching      ← 正在搜索（推断）
● Reading        ← 正在读文件（推断）
```

**视觉规范：**
- 格式：圆点 `●` + 空格 + 单个英文状态词（首字母大写）
- 字体：**italic（斜体）**，font-size ≈ 11–12px
- 颜色：`rgba(180,180,180,0.65)` 灰色系（与正文明显降调）
- 圆点颜色：同灰色，或略带蓝色 — **非醒目颜色**（不是绿色/黄色）
- 位置：Working box 内最底部，独立一行
- 随 AI 当前状态动态更新（不固定为同一个词）

**当前 DeepSeek 实现差距**：
- ❌ 无此底部状态词（`Analyzing` / `Considering`）
- ❌ 有 `● Analyzing` 类样式但位置/格式不匹配（在 aut-rows 里而非底部）

---

### 12.3 完成后折叠态（collapsed，Working 结束）

**实测截图特征（screenshot 2 第一、二框）：**

```
Analyzed screenshot layout and user expectations           ← 第一个完成的 Working session
```
```
Searched for regex and checked webview.js lines 2841-2920  ← 第二个完成的 Working session
```

**⚠️ 极其重要的特征——无方框、无左线：**
- 不是 `┌─ Analyzed... ─┐` 包裹的方框
- 不是 `╷ ✓ Analyzed...` 带左竖线的样式
- **就是一行普通文字**，比正文小、比正文暗
- screenshot 2 中的绿色矩形是**用户手动标注的注释框**，不是真实 UI 元素

**标题格式（`[动词] [描述]`）：**

| 状态词 | 格式示例 |
|-------|---------|
| 分析完成 | `Analyzed screenshot layout and user expectations` |
| 搜索完成 | `Searched for regex and checked webview.js lines 2841-2920` |
| 读文件完成 | `Read hello_ai_programmer.c` |
| 推理完成 | `Considered approaches to the problem` |

标题文字规则：
- **第一个词是动词的过去式**（Analyzed / Searched / Read / Considered）
- 后跟描述内容的短语
- 描述来自 AI 当次操作内容（非固定模板，是 AI 生成或工具调用摘要）

**视觉规范：**
- 字体大小：**11px**（比正文 12–13px 更小）
- 字体颜色：`var(--vscode-descriptionForeground)` 或 `rgba(180,180,180,0.60)`
- 字重：normal（非 bold）
- 行高：`1.3–1.4`，`padding: 2px 0`（极小垂直占用）
- **无 `▸` 展开箭头**（至少在截图中不明显，可有可无）
- **无前缀 ✓ 图标**（分析模式下；文件编辑模式下才有 `✓ Finished with N step(s)`）

**与文件编辑模式完成态对比：**

| 模式 | 完成后标题 | 有无框 |
|------|----------|-------|
| 文件编辑模式 | `✓ Finished with N step(s)` | 有左竖线（`border-left`）|
| **分析/推理模式** | `Analyzed [描述]` / `Searched for [描述]` | **无框，纯文字行** |

---

### 12.4 多轮 Working Session 布局（截图实测）

一次 Copilot 响应中，多个 Working session 依次出现的完整布局：

```
  [ 用户消息 ]

  Analyzed screenshot layout and user expectations         ← 第1个 session，已折叠（小字）

  仔细分析截图问题，先读相关代码：                           ← 第1个 session 的 AI prose（紧跟折叠行下方）

  Searched for regex and checked webview.js lines 2841-2920  ← 第2个 session，已折叠（小字）

  看截图中问题的根本原因，需要追踪完整的分析模式消息流：     ← 第2个 session 的 AI prose

  ┌─ Working ──────────────────────────────────────┐
  │  [code block 和推理文字流式输出中...]             │      ← 第3个 session，进行中（大框）
  │  ● Considering                                 │
  └─────────────────────────────────────────────────┘
```

**布局规则：**
1. 每个 Working session 完成后，**立即折叠**为一行小字摘要
2. 该 session 的 AI prose **在折叠行正下方**流出（不是上方）
3. 下一个 Working session 在 prose 之后追加，创建新的大框
4. 多个折叠行 + 大框构成"分析进度列"

---

### 12.5 当前 DeepSeek 实现的主要偏差（截图1直接说明）

截图1（screenshot 1）明确标注出 DeepSeek 当前的错误显示：

| 问题 | DeepSeek 当前（❌ 错误）| Copilot 正确 |
|------|----------------------|-------------|
| 4. 链接行 | 显示 `hello_ai_programmer.c 分析 hello_ai_programmer.c`（可点击链接行）| **不应存在**，无文件链接行 |
| 5. 大蓝色任务卡片 | 显示 `[1/1] hello_ai_programmer.c 分析...`（蓝色大卡片）| **不应存在**，无任务卡片 |
| 6. 期望行为 | — | Working 框顶部 spinner，分析完成后折叠为小斜体行 |
| 底部状态词 | 无或格式不符 | `● Analyzing` 或 `● Considering`（斜体，11px，灰色）|
| 完成折叠 | 保留大框或 `Finished with N step(s)` | `Analyzed [描述]`（纯文字行，无框）|

**核心结论（需实现）：**  
分析模式下 Working box 不应有 `aut-row`（✏ 文件行）、不应有任务卡片。Working box 内部应只有：
1. AI 推理内容（代码块 + prose 混排）
2. 底部 `● Status` 状态词

### 12.6 最终总结性 prose（⭐ 全部任务完成后）

**触发时机**：所有 Working session 均已折叠完成，AI 最后一轮输出结束时。

**这是 Copilot Agent 响应的"收尾段"**，在最后一个 Working 折叠行的正下方出现，以正常 AI prose 形式渲染。

**内容特征（因 case 不同而异）：**

| Case 类型 | 典型内容 |
|----------|--------|
| 代码分析 | 总结分析发现、指出根本原因、给出具体建议 |
| 代码修改 | 说明做了哪些改动、改动原因、影响范围 |
| 编译/运行 | 报告执行结果、错误信息摘要、修复建议 |
| 搜索/查找 | 汇报找到的关键信息、引用原文 |
| 交互需求 | 向用户提问（「需要我继续修改 X 吗？」）|
| 混合场景 | 以上组合，无固定格式 |

**视觉规范（与普通 AI prose 完全相同）：**
- **无外框、无背景、无左竖线**
- 字体：继承正文，12–13px，行高 1.5–1.6
- 支持完整 Markdown：标题（`##`）、列表（`-`）、代码块（` ``` `）、**粗体**、`行内代码`
- 颜色：`var(--vscode-foreground)`（与正文相同，非灰色降调）
- 段落数量不限，内容长短完全由 AI 决定

**与中间轮次 prose 的区别：**

| | 中间轮次 prose | 最终总结 prose |
|---|---|---|
| 位置 | 某个 Working 折叠行正下方（非最后）| **最后一个** Working 折叠行正下方 |
| 内容 | 局部过渡信息（「接下来分析…」）| **完整总结**：结论 + 建议 + 可能的互动 |
| 长度 | 通常较短（1–3 句）| 通常较长（多段落，可含列表/代码块）|
| 是否必须存在 | 可无（纯工具调用轮次无 prose）| **几乎必有**（Agent 有义务告知最终结果）|

**DOM 位置（完整响应末尾）：**
```
  [最后一个 Working 折叠行]  ← Considered approaches...

  [最终总结 prose]           ← 此处是 currentBubble 的内容正文
                               agentPlanDone=true 后流出，完整 Markdown 渲染

  ━━━━ Todos widget ━━━━
  ━━━━ File Changes widget ━━━━
  ━━━━ 输入框 ━━━━
```

**关键实现要求（对 DeepSeek 的影响）：**
- `agentPlanDone = true` 后的 delta 必须正常流入 `currentBubble`（已支持）
- `currentBubble` 的 prose turn 必须紧跟最后一个 Working 折叠行**之后**（deferred bubble 机制保证 DOM 顺序）
- `endResponse` 时 `currentBubble` 正常渲染完整 Markdown，**不得被清空或隐藏**
- `stripToolCallBlocks()` 仅过滤 `[TOOL:...]` 块，保留全部 AI 自然语言输出

---

## 十、顺序嵌套 Working 框架构（2026-05-13 深度分析）

### 10.0 核心架构：每轮 LLM 调用独立一个 Working 框

Copilot Agent 的每一次 `runOne()`（即一轮 LLM 调用）都产生一个独立的 `chat-thinking-box`（Working 框）。多任务时呈现顺序嵌套效果：

```
┌──────────────────────────────────────────────────────────────┐
│ ✓ Reviewed 6 files          › ← 第一轮完成后折叠（可展开）    │
└──────────────────────────────────────────────────────────────┘

  AI 正文摘要（第一轮结果，大字）

┌──────────────────────────────────────────────────────────────┐
│  ⟳ Working: Reading foo.cpp    ← 第二轮进行中（当前打开）     │
│   🔍 Searched for useState                                   │
│   📄 Read src/App.tsx                                        │
└──────────────────────────────────────────────────────────────┘
```

**关键规则**：
- 每轮执行完成 → 该轮 Working 框折叠 → 标题变为 `Finished with N step(s)`
- 下一轮开始 → 新 Working 框（展开状态）追加在上一个的下方
- 每个 Working 框独立计步（N = 该轮的工具调用次数）
- 每个 Working 框下方可以有该轮的 AI prose（如果 AI 在那一轮输出了文字）

### 10.1 Todos 框（独立，位于编辑框上方）

**位置**：`chat-todo-list-widget`，挂载在聊天输入框一方的 **input 区域**，与响应流 (`chat-thinking-box`) 完全分离。

```
↑ 聊天响应流（Working 框 + prose）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Todos (2/4)              [×]    ← 独立 widget，仅显示任务条目；× 关闭
  ✓ 分析问题根因
  ● 修改核心逻辑
  ○ 更新测试
  ○ 验证构建
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [用户输入框]
```

**生命周期**：
- AI 调用 `manage_todo_list` 时**创建/更新**，始终显示（即使 agent 完成执行后）
- 用户**发送新消息**时才清除（重新开始新对话轮次）
- 用户也可点击 **[×]** 手动关闭
- 不随 `startResponse` 重置（与完成状态无关）

**外观特征**：
- 信息极简：只有任务名称 + 状态图标
- 不显示任务描述、进度详情
- 状态：`○`(not-started), `●blue`(in-progress), `✓green`(completed)
- 完成项显示删除线 + 绿色

### 10.2 File Changes 框（独立，位于编辑框上方）

当 Agent 修改了文件，完成后在 **input 区域上方**出现一个 `file-changes` 小组件：

```
  Files changed (3)   +14 -3      [×]
  ✏  main.cpp   +8 -2
  ✏  CMakeLists.txt  +1
  ✏  foo.hpp  +5 -1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [用户输入框]
```

**DeepSeek 实现状态**：✅ 已实现（2026-05-12）

**实现架构**：

| 层 | 关键点 |
|---|---|
| 协议 | `AgentStatusMessage.editedFiles?` 数组，在 `done` 阶段由 `runAgentLoop` 填充 |
| 执行层 | `executeTask` 返回 `linesAdded`/`linesRemoved`（来自 `roughLineDiff`） |
| 编排层 | `runAgentLoop` 累积 `editedFileRecords[]`，写入 final done 消息 |
| UI DOM | `#agent-file-changes-widget` div，插入在 `inputAreaEl` 之前 |
| UI 函数 | `renderFileChangesWidget(editedFiles)` — done 阶段触发渲染 |
| 生命周期 | `userMessage` 清除；`[×]` 按钮手动关闭 |
| CSS | `afc-*` 类族，与 `aut-*`/`pe-*` 同等设计风格 |

**CSS 类族**：

| Class | 说明 |
|-------|------|
| `#agent-file-changes-widget` | 容器，`border-top` 分隔线，`background:sideBar` |
| `.afc-header` | 头部行（标题 + 总计 diff + 关闭按钮）|
| `.afc-title` | `Files changed (N)` 标题，11px 粗体 |
| `.afc-stats` | `+X -Y` 总计行，10px |
| `.afc-added` / `.afc-removed` | 绿色 / 红色 diff 数字 |
| `.afc-close` | `[×]` 关闭按钮 |
| `.afc-list` | 文件列表容器 |
| `.afc-row` | 单文件行（icon + 文件名 + diff）|
| `.afc-row-name` | 文件名，蓝色链接色，ellipsis |
| `.afc-row-stat` | 每文件 `+X -Y` |

---

## 十一、工具活动显示设计参考（2026-05-13）

### 11.1 Copilot 工具行模式（已对齐）

每次工具调用实时追加一个 `.chat-thinking-tool-wrapper` 行（无预建占位）：

| 工具类型 | Copilot 图标 | DeepSeek 图标 | 描述格式 |
|---------|-------------|--------------|---------|
| 读文件 | `codicon-file-text` | `codicon-file-text` | `Read <code>filename</code>` |
| 搜索 | `codicon-search` | `codicon-search` | `Searched for <code>query</code>` |
| 列目录 | `codicon-list-flat` | `codicon-list-flat` | `Listed <code>path</code>` |
| 终端命令 | `codicon-terminal` | `codicon-terminal` | `Ran <code>cmd</code>` |

### 11.2 Working 标题动态更新规则

- **执行中**：`{操作类型}…({累计次数})`，例：`Reading…(3)`、`Searching…(1)`
- **完成后**：`Finished with N step(s)`（`appendedItemCount > 0`）或 `Finished Working`
- **setFallbackTitle() 无条件调用**：无论成功/失败/中断，都会更新标题

### 11.3 步骤列表容器（`.aut-steps-list`）

- 在 execute 阶段 plan box 创建时同步创建（`insertBefore` 到 `.aut-rows` 前）
- 若 `agentToolActivity` 先到达（lazy），则在容器内动态创建
- `max-height: 130px; overflow-y: auto` — 超出时滚动显示

---

---

## 十三、CSS 源码精确数值（workbench.desktop.main.css 直接提取，2026-05-12）

> **来源**：`/usr/share/code/resources/app/out/vs/workbench/workbench.desktop.main.css`（VS Code 1.112.0）  
> **NLS 字符串来源**：`/usr/share/code/resources/app/out/nls.messages.json`  
> **所有数值均为直接提取，非推断。**
>
> **✅ GitHub 公开源码交叉验证**（2026-05-13）：  
> 已通过 `microsoft/vscode` main 分支源码 `src/vs/workbench/contrib/chat/browser/widget/media/chat.css`（112,137 bytes 未混淆源码）确认本节所有数值。  
> 确认结论：§13.1 字号变量、§13.3 工具行 padding、§13.5 shimmer keyframes、§13.8 HC 边框规则、§13.9 Todos CSS、§13.10 diff 颜色变量、§13.11 inline code 样式均**与 GitHub 源码完全吻合**。  
> 补充修正见 §13.12。

---

### 13.1 CSS 字号变量（`.interactive-session` 根节点定义）

```css
--vscode-chat-font-size-body-xs:  0.846em   /* 最小：inline code, 次要标签 */
--vscode-chat-font-size-body-s:   0.923em   /* 工具内容行、spinner 标签 */
--vscode-chat-font-size-body-m:   1.000em   /* 标准正文（相对根字号 100%）*/
--vscode-chat-font-size-body-l:   1.077em
--vscode-chat-font-size-body-xl:  1.231em
--vscode-chat-font-size-body-xxl: 1.538em
```

**用户名（头部）**：`font-size: 13px; font-weight: 600`（硬编码，独立于变量体系）

**detail-container（Working 框等附属容器）**：
```css
font-family: var(--vscode-chat-font-family, inherit);
font-size: var(--vscode-chat-font-size-body-s);   /* 0.923em */
```

---

### 13.2 Working 框整体容器（`.chat-used-context-list.chat-thinking-collapsible`）

```css
.chat-used-context-list.chat-thinking-collapsible {
  border: 1px solid var(--vscode-chat-requestBorder);
  border-radius: var(--vscode-cornerRadius-medium);
  margin-bottom: 0;
  position: relative;
  overflow: hidden;
}
```

> **注**：此规则来自本地 `workbench.desktop.main.css` 中针对 `.chat-thinking-collapsible` 复合选择器的精确提取。  
> GitHub `chat.css` 中有一条**通用分组规则**覆盖若干容器元素（含 `.chat-used-context-list`），该规则使用 `border-radius: 4px`（硬编码）——但优先级低于本复合选择器，实际 `.chat-thinking-collapsible` 渲染时由本节规则生效：
> ```css
> /* chat.css 通用分组规则（优先级低于复合选择器）*/
> .interactive-response-progress-tree,
> .chat-notification-widget,
> .chat-summary-list,
> .chat-used-context-list,      /* ← 在此无 chat-thinking-collapsible 复合 */
> .chat-quota-error-widget,
> .chat-rate-limited-widget {
>   border: 1px solid var(--vscode-chat-requestBorder);
>   border-radius: 4px;           /* 硬编码，低优先级 */
>   margin-bottom: 8px;
> }
> ```

**Streaming（进行中）状态**：
```css
.chat-thinking-collapsible.chat-thinking-streaming {
  max-height: none;
  overflow: visible;
  display: block;
}
```

**Collapsed（折叠/完成）状态**：
```css
/* 收缩通过 JS 控制 DOM 类 `.chat-used-context-collapsed` 实现 */
/* 含 .chat-used-context-collapsed 时，collapsible 本身被 display:none */
.chat-used-context-collapsed .chat-used-context-list.chat-thinking-collapsible:not(.chat-thinking-streaming) {
  display: none;
}
```

**分析模式（`chat-subagent-part`）覆盖规则**：
```css
.chat-thinking-fixed-mode.chat-subagent-part {
  /* 非 streaming：完全可见（不受 collapsed 限制）*/
  .chat-thinking-collapsible { max-height: none; overflow: visible; }
  /* streaming 中：受限高度（默认 200px，用 CSS 变量调控）*/
  .chat-thinking-collapsible.chat-thinking-streaming {
    max-height: var(--chat-subagent-last-item-height, 200px);
    overflow: hidden;
    display: block;
  }
}
```

---

### 13.3 工具行内部布局

**每行容器（`.chat-tool-invocation-part`）**：
```css
padding: 4px 12px 4px 18px;
position: relative;
```

**内容行（`.chat-thinking-item.markdown-content`）**：
```css
padding: 6px 12px 6px 24px;
position: relative;
font-size: var(--vscode-chat-font-size-body-s);   /* 0.923em */
```

**spinner 行（`.chat-thinking-spinner-item`）**：
```css
padding: 6px 12px 6px 24px;
font-size: var(--vscode-chat-font-size-body-s);
```

---

### 13.4 左侧竖线（连接各工具行的装饰线）

应用于：`.chat-thinking-item.markdown-content` 和 `.chat-thinking-spinner-item`

```css
position: relative;
&:before {
  content: "";
  position: absolute;
  left: 10.5px;
  top: 0; bottom: 0; width: 1px;
  border-radius: 0;
  background-color: var(--vscode-chat-requestBorder);
  /* 默认：上端短淡入，下端短淡出（中间行） */
  mask-image: linear-gradient(to bottom, #000 0 5px, transparent 5px 25px, #000 24px 100%);
}
/* 第一行：顶部无线（透明淡入更长） */
&:first-child:before {
  mask-image: linear-gradient(to bottom, transparent 0 25px, #000 25px 100%);
}
/* 最后一行：底部无线 */
&:last-child:before {
  mask-image: linear-gradient(to bottom, #000 0 5px, transparent 5px 100%);
}
/* 唯一行：无线（完全透明） */
&:only-child:before {
  background: none;
  mask-image: none;
}
```

**工具行图标（`.chat-thinking-icon`）**：
```css
position: absolute;
left: 5px; top: 9px;
width: 12px; height: 12px;
font-size: 12px; line-height: 12px;
text-align: center;
color: var(--vscode-descriptionForeground);
```

---

### 13.5 Spinner 状态标签（Working 框底部 `● [词]`）

**DOM 结构**（源码直接确认）：
```js
let icon = codicon(Codicon.circleFilled);   // → span.codicon.codicon-circle-filled ●
this.workingSpinnerLabel = T("span.chat-thinking-spinner-label");
this.workingSpinnerLabel.textContent = this.getRandomWorkingMessage("thinking");
this.workingSpinnerElement.appendChild(icon);
this.workingSpinnerElement.appendChild(this.workingSpinnerLabel);
```

**`●` 符号来源**：`codicon-circle-filled`（非文字字符，是 codicon 图标字体）

**`getRandomWorkingMessage(category)` 词库**（NLS keys，源码直接确认）：

| 类别 | 触发时机 | 词库（随机取一个，取后移除不重复）|
|------|---------|--------------------------------|
| `"thinking"` | 分析推理时（Working box 底部）| Thinking, Reasoning, **Considering**, **Analyzing**, Evaluating |
| `"terminal"` | 执行终端命令 | **Executing**, Running, Processing |
| `"tool"`（default）| 工具调用（读文件/搜索等）| Processing, Preparing, Loading, **Analyzing**, Evaluating |

注：粗体为截图中已实测观察到的词。

**重要机制**：词语是随机的，每次取出后从池中移除（不重复），池耗尽后重新补充。  
用户还可通过 `chat.agent.thinking.phrases` 配置项自定义追加或替换词库。

**Shimmer 动画 CSS**（`.chat-thinking-spinner-label` shimmer 效果）：
```css
.chat-thinking-spinner-item .chat-thinking-spinner-label {
  background: linear-gradient(90deg,
    var(--vscode-descriptionForeground) 0%,
    var(--vscode-descriptionForeground) 30%,
    var(--vscode-chat-thinkingShimmer) 50%,        /* 高光扫过 */
    var(--vscode-descriptionForeground) 70%,
    var(--vscode-descriptionForeground) 100%
  );
  background-size: 400% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: chat-thinking-shimmer 2s linear infinite;
}
/* 颜色实际值（dark 主题）：*/
/* --vscode-chat-thinkingShimmer: #ffffff（dark）/ #000000（light）*/
```

> **GitHub 源码补充确认**：`chat.css` 中 shimmer 动画同样应用于 `.progress-container.shimmer-progress` 内的 `.rendered-markdown.progress-step > p`：
> ```css
> .interactive-item-container .progress-container {
>   &.shimmer-progress > .codicon { display: none; }   /* 隐藏旋转 spinner 图标 */
>   &.shimmer-progress .rendered-markdown.progress-step > p {
>     background: linear-gradient(90deg, /* 同上渐变 */);
>     background-size: 400% 100%;
>     background-clip: text;
>     -webkit-background-clip: text;
>     -webkit-text-fill-color: transparent;
>     animation: chat-thinking-shimmer 2s linear infinite;
>     will-change: background-position;
>   }
> }
> ```
> 即 shimmer 在 `progress-container` 中应用于**段落文字**，在 thinking widget 中应用于 **spinner label 文字**，两处均用相同关键帧。

---

### 13.6 Working 框标题文本规则（源码确认）

**默认标题**：NLS `7418` = `"Working"`（无参数时的回退）

**动态标题格式**（工具返回 title 时）：
```js
let o = `Working: ${e}`;   // → "Working: Analyzed screenshot layout..."
```

**完成后标题**（源码直接找到的 NLS 字符串）：

| NLS key | 文本 |
|---------|------|
| 7415 | `Edited file` |
| 7416 | `Finished Working` |
| 7417 | `Finished with {0} step{1}` |

**标题生成策略（`chat.agent.thinking.generateTitles` 配置）**：
- 默认开启：通过 LLM 调用自动生成描述性标题（如 `"Analyzed screenshot layout and user expectations"`）
- 关闭时调用 `setFallbackTitle()`，使用固定回退文本

---

### 13.7 容器布局与间距

**`interactive-item-container`（每轮对话行容器）**：
```css
padding: 12px 16px;
display: flex;
flex-direction: column;
color: var(--vscode-interactive-session-foreground);
```

**头部行（`.header`）**：
```css
margin-bottom: 8px;
display: flex;
align-items: center;
justify-content: space-between;
```

**最大内容宽度**：`max-width: 950px`（居中布局，`margin: auto`）

---

### 13.8 用户消息气泡边框规则（重要纠正）

**正常主题（非高对比度）**：`.interactive-request` **没有** border——
```css
/* 普通模式下：无样式 */
```

**仅高对比度模式下**才有边框：
```css
.hc-black .interactive-request,
.hc-light  .interactive-request {
  border-left:  3px solid var(--vscode-chat-requestBorder);
  border-right: 3px solid var(--vscode-chat-requestBorder);
}
```

---

### 13.9 Todos 小组件精确 CSS

```css
.chat-todo-list-widget {
  padding: 4px 3px;
  box-sizing: border-box;
  border: 1px solid var(--vscode-input-border, transparent);
  background-color: var(--vscode-editor-background);
  border-bottom: none;
  border-radius: var(--vscode-cornerRadius-large) var(--vscode-cornerRadius-large) 0 0;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}
```

**Todo 条目（`.todo-item`）**：
```css
display: flex;
align-items: center;
gap: 6px;
scroll-snap-align: start;
min-height: 22px;
font-size: var(--vscode-chat-font-size-body-m);   /* 1em 标准字号 */
padding: 0 3px;
border-radius: 2px;
cursor: pointer;
```

**输入框与 Todo 融合**（TODO widget 存在时，输入框顶角变直）：
```css
.interactive-input-part:has(
  .chat-todo-list-widget-container > .chat-todo-list-widget.has-todos
) .chat-input-container {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
```

---

### 13.10 Diff 颜色变量（确认为语义变量，非硬编码）

```css
span.label-added   { color: var(--vscode-chat-linesAddedForeground); }
span.label-removed { color: var(--vscode-chat-linesRemovedForeground); }
```

**不是** `rgba(100,220,120,...)` 等硬编码颜色——使用主题变量，由主题决定具体颜色值。

---

### 13.11 inline code 样式（Working box 内部）

```css
[data-code] {
  background-color: var(--vscode-textPreformat-background);
  padding: 1px 3px;
  border-radius: 4px;
  border: 1px solid var(--vscode-textPreformat-border);
}
```

（适用于 `.chat-thinking-item.markdown-content` 内的行内代码）

---

### 13.12 GitHub 源码特有发现（chat.css，2026-05-13 交叉验证补充）

> 以下内容来自 `microsoft/vscode` main 分支 `src/vs/workbench/contrib/chat/browser/widget/media/chat.css` 未混淆源码，补充本地混淆版未能明确的细节。

#### 13.12.1 输入框 Working 边框光束动画（`chat-input-container.working`）

当 Agent 正在工作时，输入框四周有一个等宽彗星扫圈动画（"border beam"）：

```css
@property --chat-input-anim-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 135deg;
}

@keyframes chat-input-working-border-spin {
  from { --chat-input-anim-angle: 135deg; }
  to   { --chat-input-anim-angle: 495deg; }
}

/* 光束（::before）：锐利彗星头，约 40° 亮弧 */
.chat-input-container::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  background: conic-gradient(from var(--chat-input-anim-angle),
    transparent 0deg,
    color-mix(in srgb, var(--vscode-chat-inputWorkingBorderColor1) 90%, transparent) 20deg,
    var(--vscode-chat-inputWorkingBorderColor1) 30deg,
    color-mix(in srgb, var(--vscode-chat-inputWorkingBorderColor1) 60%, transparent) 50deg,
    transparent 90deg,
    transparent 360deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;                          /* 默认隐藏 */
  transition: opacity 350ms ease;
  pointer-events: none;
  z-index: 2;
}

/* 发光环（::after）：2px 模糊光晕 */
.chat-input-container::after {
  /* 同上布局，filter: blur(1.5px)，opacity: 0 默认 */
}

/* 启用态：.working 类激活动画 */
.chat-input-container.working::before {
  opacity: 1;
  animation: chat-input-working-border-spin var(--chat-input-anim-duration) linear infinite;
}
.chat-input-container.working::after {
  opacity: 1;
  animation: chat-input-working-border-spin var(--chat-input-anim-duration) linear infinite;
}
```

- 动画时长由 `--chat-input-anim-duration`（默认 `4s`）控制，`ChatInputPart#layout` 根据输入框宽度动态调整（保持彗星线速度恒定）
- 颜色变量：`--vscode-chat-inputWorkingBorderColor1`（主题定义）
- 支持 `prefers-reduced-motion: reduce`：动画完全禁用

#### 13.12.2 用户气泡精确规则（panel/editor 无边框 widget 上下文）

在标准 panel 视图（非 inline chat/quick chat）中：

```css
/* 仅在 :not(.chat-widget > .interactive-session) 上下文生效 */
.interactive-item-container.interactive-request .value .rendered-markdown {
  background-color: var(--vscode-chat-requestBubbleBackground);
  border-radius: var(--vscode-cornerRadius-xLarge);  /* ← xLarge，比 large 更大 */
  padding: 8px 12px;
  max-width: 90%;
  margin-left: auto;
  width: fit-content;
  margin-bottom: 5px;
  position: relative;
}
```

- 气泡右对齐（`margin-left: auto`），最大占宽 90%
- 圆角为 `xLarge`（比 todo widget 的 `large` 更圆）
- hover 态：`background-color: var(--vscode-chat-requestBubbleHoverBackground)`
- HC 模式：额外 `border: 1px dotted var(--vscode-focusBorder)`

#### 13.12.3 Todo 列表高度限制（精确值）

```css
.chat-todo-list-widget .todo-list-container {
  max-height: calc(6.5 * 21px);    /* = 136.5px，显示 6.5 个条目（半行留白提示更多）*/
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-behavior: smooth;
  scroll-padding-top: 24px;        /* 半条目高度，显示上方部分条目 */
  scroll-padding-bottom: 24px;
}

.chat-todo-list-widget .todo-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  scroll-snap-type: y proximity;
}
```

#### 13.12.4 progress-container 精确布局（Working 框内进度条父容器）

```css
.interactive-item-container .progress-container {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 14px 0;       /* 下方保留 14px 间距 */
  font-size: 13px;
  padding-top: 2px;

  > .codicon[class*='codicon-'] {
    font-size: 12px;
    &::before { font-size: 12px; }
  }
  > .codicon.codicon-check { display: none; }  /* 完成勾默认隐藏 */

  .rendered-markdown.progress-step {
    white-space: normal;
    &.chat-working-progress-step {
      display: flex;
      align-items: baseline;
      gap: 0.3em;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum";
      & > span {
        color: var(--vscode-descriptionForeground);
        font-size: var(--vscode-chat-font-size-body-s);
      }
    }
    & > p {
      color: var(--vscode-descriptionForeground);
      font-size: var(--vscode-chat-font-size-body-s);
      margin: 0;
      code { font-size: var(--vscode-chat-font-size-body-xs); }
    }
  }
}

/* 完成后显示 check 图标 */
.show-checkmarks .progress-container > .codicon.codicon-check,
.progress-container.show-checkmarks > .codicon.codicon-check {
  display: inline-flex;
  margin-left: 4px;
}
```

#### 13.12.5 shimmer keyframes 精确值（与本地提取一致）

```css
@keyframes chat-thinking-shimmer {
  0%   { background-position: 120% 0; }
  100% { background-position: -120% 0; }
}
```

---

## 十四、DeepSeek 插件当前改动记录（2026-05-15 后）

### 14.1 终端命令确认卡片重设计（compact terminal confirm group）

**改动日期**：2026-05-XX  
**文件**：`media/webview.js`

#### 旧设计（已废弃）

每条待确认命令占用一个大框：
```
┌─────────────────────────────────────────┐
│ ⬡ AI 想要执行终端命令                     │  ← 8px 上下 padding 的大头
│ ┌───────────────────────────────────────┐│
│ │ gcc code/hello.c -o hello && ./hello  ││  ← 命令 body（max-height:80px）
│ └───────────────────────────────────────┘│
│ [允许 ▾] [跳过]                           │  ← 操作按钮行
└─────────────────────────────────────────┘
```

- CSS 类：`.terminal-confirm-card`、`.tc-header`、`.tc-body`、`.tc-actions`
- 每条命令独立一个 `turn assistant-turn` wrapper
- 多条命令 = 多个大框，占用大量垂直空间

#### 新设计（当前）

所有连续命令合并到一个紧凑分组框中，每条命令一行：
```
┌ ⬡ AI 想要执行终端命令 ──────────────────────────────────────────┐
│ $ gcc /abs/path/code/hello.c -o /abs/path/code/hello  [允许▾][跳过] │
│ $ ls /abs/path/                                       ✓ 已允许      │
└──────────────────────────────────────────────────────────────────┘
```

**合并规则**：新命令到达时，若 `messagesEl` 最后一个 child 已有 `.tc-group-wrap` class，则直接追加新 `.tc-row` 行（不创建新 wrapper）。

**CSS 类对应关系**：

| 旧类 | 新类 | 说明 |
|------|------|------|
| `.terminal-confirm-card` | `.tc-group` | 分组容器（带 border） |
| `.tc-header` | `.tc-group-hdr` | 分组标题行（细背景） |
| `.tc-body` | `.tc-cmd-preview` | 截断命令预览（单行 ellipsis） |
| `.tc-actions` | `.tc-btns` | 按钮容器（attached to row） |
| n/a | `.tc-row` | 每条命令的单行容器 |
| n/a | `.tc-row-pfx` | 美元符 `$` 前缀 |

**决定后状态**：点击 [允许] / [跳过] 后，`.tc-btns` 内容替换为 `<span class="tc-decided">✓ 已允许</span>`，行不消失。

**全宽对齐**：`.tc-group` 使用 `width:100%`，无 `max-width` 限制。

---

### 14.2 会话历史显示范围扩大

**改动日期**：2026-05-XX  
**文件**：`src/extension.ts`

#### 旧行为

- 切换/加载 session 时，向 webview 只发送最近 30 条消息（`loadedHistory.slice(-30)`）
- 用户在 UI 中只看到对话的最后 30 条，无法回溯更早历史

#### 新行为

- 切换/加载 session 时，发送全部历史消息（不 slice）
- 影响的代码路径：
  - `getHistory` 消息处理（初次加载时的 `_restoreHistory.slice(-30)` → 无限制）
  - `loadSession` 消息处理（`loadedHistory.slice(-30)` → `loadedHistory`）

**注意**：LLM 上下文（`nonBridgeChatHistory`）仍受 auto-compact 机制管理（每 40 条自动摘要），这是独立于 UI 显示的优化，不受此改动影响。

---

### 14.3 编译/运行命令强制绝对路径

**改动日期**：2026-05-XX  
**文件**：`src/agent-loop.ts`，`buildAnalyzePrompt` 函数

#### 旧提示词

```
【编译/运行提示】如需执行，可直接使用 run_terminal 工具：
[TOOL:run_terminal {"command":"gcc '/abs/path/file.c' -o '/abs/path/file'"}]
（命令可按需修改，必须通过工具调用执行，不要只描述步骤）
```

#### 新提示词

```
【编译/运行提示】如需执行，可直接使用 run_terminal 工具（命令中必须使用绝对路径，严禁使用相对路径，以确保不同工作目录下路径正确）：
[TOOL:run_terminal {"command":"gcc '/abs/path/file.c' -o '/abs/path/file'"}]
（命令可按需修改，必须通过工具调用执行，不要只描述步骤）
```

**背景**：AI 有时会忽略建议的命令，自行生成 `gcc code/hello.c` 等相对路径命令，在 `cwd` 不匹配时导致"文件找不到"错误。强调禁止相对路径后可降低此概率。

---

*此文档为 Copilot 显示风格参照，基于实测行为推断，非官方源码文档。*  
*每次 DeepSeek 插件对齐后，请在第八节"差距记录"中更新状态。*

---

## 十五、完整 NLS 字符串表（2026-05-22 源码精确提取）

> **来源**：`/usr/share/code/resources/app/out/nls.messages.json`（VS Code 1.112.0）  
> **提取方式**：Python 直接解析 JSON，按 message index 读取，非推断。

### 15.1 Agent/Working 相关字符串（NLS 7340–7590 区间）

| NLS# | 字符串 | 用途 |
|------|--------|------|
| 7342 | `{0} lines added, {1} lines removed` | 操作行 diff 摘要 |
| 7343 | `Changed {0} files` | 文件变更摘要 |
| 7344 | `Changed 1 file` | 单文件变更摘要 |
| 7345 | `Open Changes` | 查看变更按钮 |
| 7346 | `File Changes` | 文件变更组件标题 |
| 7347 | `Waiting for tool '{0}' to respond...` | 等待工具响应状态 |
| 7348 | `Working` | Working 框标题（活跃态）|
| 7388 | `{0} lines added, {1} lines removed` | 同 7342，另一处使用 |
| 7391 | `Used {0} references` | 引用计数（复数）|
| 7392 | `Used {0} reference` | 引用计数（单数）|
| 7398 | `Running subagent...` | 子 agent 运行中 |
| 7412 | `Making changes was aborted.` | 操作中止 |
| 7413 | `Made changes.` | 操作完成 |
| 7414 | `Edited {0}` | 已编辑某文件 |
| 7415 | `Edited file` | 已编辑文件（无路径）|
| **7416** | **`Finished Working`** | **完成标题（无步骤）** |
| **7417** | **`Finished with {0} step{1}`** | **完成标题（有步骤，`{1}` = `''` 或 `'s'`）** |
| 7418 | `Working` | Working 框 heading 标题 |
| 7419 | `Thinking` | Working 框 heading 备选标题 |
| 7484 | `{0} files changed` | 文件变更 widget 标题（复数）|
| 7485 | `All Changes` | 查看全部变更 |
| 7486 | `{0} lines added, {1} lines removed` | 变更行数摘要 |
| 7487 | `{0}, {1} lines added, {2} lines removed` | 含文件名的变更摘要 |
| 7488 | `1 file changed` | 单文件变更 widget 标题 |
| 7489 | `View All Changes` | 查看全部变更按钮 |
| 7507 | `Ran ` | 终端命令"已运行"前缀 |
| 7508 | `Running ` | 终端命令"正在运行"前缀 |
| 7560 | `Checkpoint Restored` | 检查点已恢复（Copilot 支持 checkpoint 回滚）|
| 7572 | `Queued` | 消息排队状态 |
| 7573 | `Queued messages will be sent after the current request completes` | 排队说明 |
| 7582 | `Working` | Working 框备用标题 |

### 15.2 Todo 相关字符串（NLS 7440–7455）

| NLS# | 字符串 | 用途 |
|------|--------|------|
| 7442 | `Clear all todos` | 清除所有 Todo 按钮 aria-label |
| 7443 | `Cannot clear todos while a task is in progress` | 任务进行中禁止清除 |
| 7444 | `Collapse Todos` | 折叠 Todos |
| 7445 | `{0} ({1}/{2})` | Todos 标题格式（带完成计数）|
| 7446 | `Expand Todos` | 展开 Todos |
| 7447 | `{0}, {1}` | 组合格式 |
| **7448** | **`completed`** | Todo 状态文字：已完成 |
| **7449** | **`in progress`** | Todo 状态文字：进行中 |
| **7450** | **`not started`** | Todo 状态文字：未开始 |
| **7451** | **`Todos`** | Todos widget 标题 |
| **7452** | **`Todos ({0}/{1})`** | Todos widget 带进度标题 |
| 7453 | `Chat Todo List` | 辅助功能描述 |
| 7457 | `Created []({0})` | 文件创建描述 |
| 7458 | `` Deleted `{0}` `` | 文件删除描述 |
| 7459 | `Renamed {0} to []({1})` | 文件重命名描述 |

### 15.3 设置/配置相关字符串

| NLS# | 字符串 | 用途 |
|------|--------|------|
| 6221 | `Controls whether to use an LLM to generate summary titles for thinking sections.` | **⭐ 关键**：Copilot 有 LLM 智能标题生成功能 |
| 6224 | `Custom loading messages to show during thinking, terminal, and tool operations.` | 可自定义 loading 消息列表 |
| 6225 | `When enabled, terminal tool calls are displayed inside the thinking dropdown with a simplified view.` | 终端调用折叠进 thinking 框 |
| 6226 | `Thinking parts will be collapsed by default.` | thinking 默认折叠 |
| 6227 | `Thinking parts will be expanded first, then collapse once we reach a part that is not thinking.` | thinking 先展开后折叠 |
| 6228 | `Show thinking in a fixed-height streaming panel that auto-scrolls; click header to expand to full height.` | Fixed-height streaming 模式 |
| 6338 | `Controls whether to show the todo list widget above the chat input.` | Todo widget 显示开关 |
| 5886 | `Working...` | Copilot 状态栏显示文字 |
| 6630 | `{0} - Working...` | 带文件名的状态栏文字 |

---

## 十六、Working 消息池 — 完整列表（源码精确提取 + 架构纠正）

> **来源**：workbench.desktop.main.js 直接提取，变量名 `eXo`/`tXo`/`iXo`，函数 `getRandomWorkingMessage(category)`  
> **重要纠正**：之前版本描述的"全部词随机选"是**错误的**。实际上是 **3 个独立分类池**，词的更换是**事件驱动**而非计时器驱动。

### 16.1 正确机制：3 分类池 + 事件驱动

**触发时机**：spinner 标签文字在**每个新内容项被追加到 Working 框时更新**（不是计时器轮询），根据追加内容的类型选择不同的池：

| 触发条件 | 池变量 | 词列表 (NLS) | 语义 |
|----------|--------|-------------|------|
| Working 框首次创建 → 初始标签 | `eXo` | Thinking、Reasoning、Considering、Analyzing、Evaluating | LLM 正在思考中 |
| LLM 推理 token (thinking block) 追加 | `eXo` | 同上 | 推理/分析阶段 |
| `toolSpecificData.kind === "terminal"` 工具调用 | `tXo` | Executing、Running、Processing | 执行终端命令 |
| 其他工具调用（读文件/搜索/列目录等） | `iXo` | Processing、Preparing、Loading、Analyzing、Evaluating | 一般工具操作 |

```
eXo 池 (thinking)：Thinking(7423) · Reasoning(7424) · Considering(7425) · Analyzing(7426) · Evaluating(7427)
tXo 池 (terminal)：Executing(7420) · Running(7421) · Processing(7422)
iXo 池 (tool)：    Processing(7428) · Preparing(7429) · Loading(7430) · Analyzing(7431) · Evaluating(7432)
```

> NLS 7419 (`Thinking`) 用于 accessibility 通知（`verboseChatProgressUpdates`），不在 spinner 循环词池里。

### 16.2 精确 JS 代码（已从混淆源码提取）

```javascript
// workbench.desktop.main.js 精确代码（变量名已还原）
var eXo = [d(7423,null), d(7424,null), d(7425,null), d(7426,null), d(7427,null)];  // thinking
var tXo = [d(7420,null), d(7421,null), d(7422,null)];                              // terminal
var iXo = [d(7428,null), d(7429,null), d(7430,null), d(7431,null), d(7432,null)];  // tool (default)

getRandomWorkingMessage(category = "tool") {
  let pool = this.availableMessagesByCategory.get(category);
  if (!pool || pool.length === 0) {
    switch (category) {
      case "thinking": pool = [...eXo]; break;
      case "terminal": pool = [...tXo]; break;
      default:         pool = [...iXo]; break;  // "tool"
    }
    // 支持 chat.agent.thinking.phrases 自定义词（append 或 replace 模式）
    const custom = this.configurationService.getValue("chat.agent.thinking.phrases");
    if (custom?.phrases?.length > 0)
      pool = custom.mode === "replace" ? [...custom.phrases] : [...pool, ...custom.phrases];
    this.availableMessagesByCategory.set(category, pool);
  }
  const idx = Math.floor(Math.random() * pool.length);
  return pool.splice(idx, 1)[0];  // 无替换抽样（用尽再填充）
}

// 调用路径：
// initContent() → getRandomWorkingMessage("thinking")                  ← 框创建时
// setupThinkingContainer() → getRandomWorkingMessage("thinking")       ← LLM 推理 block
// appendItem(toolInvocation, ...) → {
//   category = toolSpecificData?.kind === "terminal" ? "terminal" : "tool";
//   workingSpinnerLabel.textContent = getRandomWorkingMessage(category);
// }
```

### 16.3 无替换抽样机制

每个池采用**无替换随机抽样**（shuffle-deck 风格）：
- 随机取出一个词（`splice` 移除）
- 池耗尽时重新填充完整列表
- 效果：避免同一词连续重复出现，词循环更均匀

### 16.4 与之前分析的差异

| 之前错误描述 | 正确行为 |
|-------------|---------|
| 所有词在一个大池里随机选 | 3 个独立分类池，按内容类型选择 |
| 计时器周期性更换词（每 N 秒） | 事件驱动：每次新工具/thinking item 追加时更换 |
| 10 个词全混用 | thinking 5 词 / terminal 3 词 / tool 5 词（有交叉但分开管理）|
| NLS 7419 在池中 | 7419 用于 accessibility，池从 7423 开始 |

### 16.5 DevSeek 修复（2026-05-22）

**修复前（错误）**：`WORKING_WORDS` 单数组 + 3200ms 计时器轮询  
**修复后（正确）**：3 分类池 + 事件驱动（`agentToolActivity` 触发时据 `actKind` 选池）

---

## 十七、完成信息与总结机制（2026-05-22 深度分析）

> 这是用户反馈"缺少总结信息"的核心机制，也是 DevSeek 与 Copilot 差距最大的地方。

### 17.1 Copilot 完成信息架构

Copilot Agent 响应结束时，用户看到以下信息层次（从上到下）：

```
  ┌─ ✓ Finished with 4 step(s) ──── ▸ ┐   ← Working 框折叠行（可展开看工具调用）
  └─────────────────────────────────────┘

  I've analyzed your issue and made the following changes:   ← ⭐ 最终总结 prose
  
  **Root cause**: The session isolation was broken because...
  
  **Files modified**:
  - `extension.ts` — removed old history injection
  - `webview.js` — added lazy injection on first message
  
  This should fix the cross-session contamination issue. Let me know if...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Todos (3/3)                   [× ≡]   ← Todos widget 持久显示
  ✓ Fix session isolation
  ✓ Improve task labels
  ✓ Compile and install
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  3 files changed  +24 -8             [×]   ← File Changes widget
  ✏ extension.ts        +18 -5
  ✏ webview.js          +6 -3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [用户输入框]
```

**关键特点**：
1. **最终总结 prose 由 AI 自己生成** — 不是固定格式卡片，而是 LLM 根据任务内容生成的自然语言总结
2. **总结 prose ALWAYS 出现** — Copilot 的 LLM prompt 要求在完成后必须输出总结
3. **Working 框折叠** — 只显示一行摘要，但可展开看工具调用历史
4. **Todos widget 持久** — 任务完成后，Todos widget 留在 input 区域上方直到用户发新消息
5. **File Changes widget** — 显示所有修改的文件及diff统计

### 17.2 LLM 标题生成（⭐ 关键机制）

NLS 6221 确认：Copilot 有设置控制是否用 **LLM 来生成 thinking 折叠标题**。  
当启用时，LLM 分析本次执行的工具调用内容，生成一个有意义的一行摘要作为 thinking box 折叠后的标题（如 `Analyzed user's issues with DeepSeek plugin functionality`），而非固定的 `Finished with N step(s)`。

**DevSeek 对应功能**：`buildFinishedLabel()` — 目前用 `agentCurrentTaskLabel` 生成，未使用 LLM。

### 17.3 DevSeek 原有问题（2026-05-22 修复前）

| 问题 | 表现 | 原因 |
|------|------|------|
| 无完成总结 | Agent 完成后没有 prose bubble | LLM 未生成时直接删除 bubble |
| File Changes 不显示 | widgets 空白 | `renderFileChangesWidget()` 从未被调用（bug！）|
| 步骤完成即消失 | Working box 折叠后无法轻易看到步骤 | `finalizeExecContainer` 移除 `open` 属性 |

### 17.4 DevSeek 修复内容（2026-05-22）

| 修复 | 实现 |
|------|------|
| **自动补全总结 prose** | `buildAgentAutoSummary()` — 当 LLM 未生成 prose 时，从 `agentTodos` + `agentLastEditedFiles` 自动生成 Markdown 完成摘要 |
| **修复 File Changes bug** | `addAgentStatus` done 阶段新增调用 `renderFileChangesWidget(msg.editedFiles)` + 存储到 `agentLastEditedFiles` |
| **步骤历史持久** | `finalizeExecContainer` 不再调用 `removeAttribute('open')` — 完成后步骤列表保持可见 |
| **步骤列表样式** | CSS 新增 `.aut-details[data-done] .aut-steps-list { max-height:none; overflow:visible; opacity:.7; }` |

**`buildAgentAutoSummary()` 输出格式示例**：
```markdown
Completed 3 tasks:

✓ Add shared library target to CMakeLists.txt
✓ Update function signature in src/interface.h
✓ Compile and verify changes

**3 files modified — +18 -5 lines:** `CMakeLists.txt` (+3 -0), `src/interface.h` (+8 -2), `build/output.txt` (+7 -3)
```

### 17.5 Checkpoint 机制（NLS 7560：已发现）

Copilot 支持 **checkpoint（检查点）回滚机制**（NLS 7560: `Checkpoint Restored`）。用户可以回滚到某个操作之前的状态。这与 DevSeek 的 pending edits/keep/undo 机制类似，但 Copilot 是全会话级别的 checkpoint，DevSeek 是 hunk 级别的。

---

## 十八、CSS 精确值补充（2026-05-22 workbench.desktop.main.css 再次确认）

> 补充上文 §13 未覆盖的精确值。

### 18.1 TODO Widget CSS（完整规则）

```css
/* 容器 */
.interactive-input-part > .chat-todo-list-widget-container {
  margin-bottom: -4px;
  width: 100%;
  position: relative;
}

/* Widget 本体 */
.chat-todo-list-widget {
  padding: 4px 3px;
  box-sizing: border-box;
  border: 1px solid var(--vscode-input-border, transparent);
  background-color: var(--vscode-editor-background);
  border-bottom: none;
  border-radius: var(--vscode-cornerRadius-large) var(--vscode-cornerRadius-large) 0 0;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

/* 标题行 */
.todo-list-expand .todo-list-title-section {
  padding-left: 3px;
  display: flex;
  align-items: center;
  flex: 1;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 22px;
}

/* 标题中的图标 */
.todo-list-title-section .codicon {
  font-size: 16px;
  line-height: 22px;
  flex-shrink: 0;
}
```

### 18.2 Tool Call 图标选择逻辑（workbench.desktop.main.js 确认）

```javascript
// Copilot 根据工具名称选择图标（实际代码逻辑）
function getThinkingToolIcon(toolName) {
  if (toolName.includes("search") || toolName.includes("list") || 
      toolName.includes("find") || toolName.includes("grep"))
    return R.search;
  if (toolName.includes("read") || toolName.includes("file") || 
      toolName.includes("get_file") || toolName.includes("problems"))
    return R.book;
  if (toolName.includes("edit") || toolName.includes("create") || 
      toolName.includes("replace"))
    return R.pencil;
  if (toolName.includes("terminal"))
    return R.terminal;
  return R.tools;  // default
}
```

| 匹配关键词 | 图标（codicon）| DeepSeek aut-step 对应 |
|-----------|--------------|----------------------|
| search/list/find/grep | `codicon-search` | `codicon-search` ✅ |
| read/file/get_file/problems | `codicon-book` | `codicon-file-text` ✅ |
| edit/create/replace | `codicon-pencil` | （执行阶段 aut-row）✅ |
| terminal | `codicon-terminal` | `codicon-terminal` ✅ |
| 其他 | `codicon-tools` | `codicon-terminal` (fallback) |

### 18.3 Shimmer 动画精确 keyframes（源码确认）

```css
@keyframes chat-thinking-shimmer {
  0% { background-position: 120% 0 }
  /* 只有一帧！background-size:400% 100% 使渐变在整个动画宽度内移动 */
}
```

**关键细节**：只有 `0%` 关键帧（到 `100%` 时 `background-position` 自动回到初始），配合 `animation: 2s linear infinite`。

**DevSeek 实现**（`autShimmer`）：
```css
@keyframes autShimmer {
  0% { background-position: 120% 0 }
  100% { background-position: -120% 0 }
}
```
✅ 对齐（等效，方向相同）

### 18.4 Subagent Part 覆盖规则（`.chat-thinking-fixed-mode.chat-subagent-part`）

Copilot 有 subagent 模式（将会话转发给外部 coding agent），在此模式下 Working 框行为有所不同：
- 折叠时 `max-height` 使用 CSS 变量 `--chat-subagent-last-item-height`
- 取消溢出限制，内容完整可见

**DevSeek**：不使用 subagent 模式，此规则不适用。

---

## 十九、代码编辑审查系统（2026-05-22 官方文档 + 源码双重确认）

> **来源**：VS Code 官方文档 [review-code-edits](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)、[chat-checkpoints](https://code.visualstudio.com/docs/copilot/chat/chat-checkpoints)、NLS 6562–6618

### 19.1 Copilot 编辑审查架构

```
Agent 执行 → 文件直接保存到磁盘（立即生效）
  ↓
文件显示 pending 状态（squared-dot 图标在 Explorer 和编辑器 tab）
  ↓
用户打开文件 → 内联 diff 视图
  ↓
编辑器叠加控件（editor overlay）：
  [↑] [↓]   导航 편 edit
  [Keep]    接受当前 edit（NLS 6562/6599/6605）
  [Undo]    拒绝当前 edit 并还原（NLS 6609/6618）
  ↓
全局操作（Chat view 顶部）：
  [Keep All Edits]  接受全部（NLS 6564/6601/6602）
  [Undo All Edits]  拒绝全部（NLS 6593/6611）
```

**关键特点**：
- 文件修改直接写入磁盘（不是 draft），用户 review 后 keep 即"确认"
- Keep/Undo 是 editor-level 操作，不在聊天 panel 内
- `chat.editing.revealNextChangeOnResolve: true`（默认）：keep/undo 后自动跳转到下一个 edit
- `chat.editing.autoAccept`：可配置 N 秒后自动 accept（默认 0 = 禁用）

### 19.2 代码块 Pill（`chat-codeblock-pill-container`）

在 agent 模式流式写入代码时，每个代码块下方显示一个 **pill 状态指示器**：

```
┌─ javascript ──────────────────────────────┐
│ const x = 1;                              │  ← code block
│ ...                                       │
└───────────────────────────────────────────┘
  ○ Generating edits...   ←── pill（NLS 7330）
  —— 变为 ——
  ✏ filename.ts           ←── pill（显示文件名，NLS 7414 "Edited {0}"）
  —— 完成后 ——
  ✓ filename.ts           ←── pill（show-checkmarks 模式）
```

**CSS 类**：
```css
.chat-codeblock-pill-container {            /* wrapper */
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--vscode-chat-font-size-body-s);
  color: var(--vscode-descriptionForeground);
  margin-bottom: 16px;
}
.status-indicator-container { display:flex; align-items:center; gap:7px; }
.status-icon { display:inline-flex; align-items:center; line-height:1em; 
               color: var(--vscode-icon-foreground) !important; }
.status-icon::before { font-size: 12px; }
.status-icon.codicon-check { display:none; }    /* 默认隐藏勾 */
.show-checkmarks .codicon-check { display:inline-flex; }  /* accessibility 设置启用时显示 */
.status-label { color: var(--vscode-descriptionForeground); white-space: nowrap; }
```

**JS 逻辑**：
- 代码块生成中：`status-icon` = `codicon-loading aut-spin`，`status-label` = `"Generating edits..."` (NLS 7330) 或 `"Applying edits (45%)..."` (NLS 7325 + 7326)
- 完成后：`status-icon` = `codicon-check`（若 accessibility.chat.showCheckmarks 启用），`status-label` = `"Edited filename.ts"` (NLS 7414)
- pill 中文件名使用 `labelService.getUriBasenameLabel()` 获取（短路径显示）

**DevSeek 现状**：🔴 无此 pill 机制，代码块下无文件状态指示。DevSeek 用 pe-file-card 在输入框上方显示，不在代码块附近。

### 19.3 Checkpoint 系统（与 DevSeek pending edits 对比）

| 特性 | Copilot Checkpoint | DevSeek Pending Edits |
|------|-------------------|-----------------------|
| 粒度 | 每个 chat request 一个快照（文件级） | 每个 hunk（代码块级） |
| 操作位置 | Chat view 悬停 → Restore Checkpoint | Chat view inline Keep/Undo 按钮 |
| 恢复范围 | 该 request 和之后所有 request 的所有文件修改 | 单个 hunk 或整个文件的修改 |
| NLS | 7560 `Checkpoint Restored` / 6583 `Restores workspace and chat to this point` | N/A |
| Fork | 支持从 checkpoint fork 到新 session | 不支持 |
| Git 关系 | 独立于 Git，是临时会话快照 | 类似 Git diff hunk 操作 |

### 19.4 NLS 完整编辑审查字符串表

| NLS# | 字符串 | 用途 |
|------|--------|------|
| 6562/6563 | `Keep` / `Keep` | editor overlay Keep 按钮（两处） |
| 6564 | `Keep All Edits` | 全接受 |
| 6598 | `Keep Chat Edits` | 命令名 |
| 6599/6600/6601/6602/6603 | Keep 系列 | 各粒度的 Keep 命令 |
| 6604/6605 | `Keep this Change` / `Keep` | hover 单个 hunk |
| 6591/6592 | `Undo` / `Undo` | editor undo 按钮 |
| 6593 | `Undo All Edits` | 全撤销 |
| 6608/6609/6610/6611 | Undo Chat Edits 系列 | 各粒度 Undo 命令 |
| 6617/6618 | `Undo this Change` / `Undo` | hover 单个 hunk |
| 7325 | `Applying edits` | 代码块 pill 进度前缀 |
| 7326 | `({0}%)...` | 进度百分比 |
| 7329 | `Edited` | 已编辑状态（无文件名） |
| 7330 | `Generating edits...` | 代码块 pill 生成中 |
| 7414 | `Edited {0}` | 已编辑带文件名 |

---

## 二十、Thinking 样式模式（2026-05-22 源码确认）

> **来源**：NLS 6226–6229，`chat.agent.thinkingStyle` 配置项，workbench.desktop.main.js 逻辑

### 20.1 三种模式

Copilot Working 框支持 3 种渲染样式（`chat.agent.thinkingStyle` 设置）：

| 模式 | 配置值 | 行为 | 相关 CSS 类 |
|------|--------|------|------------|
| **折叠** | `"collapsed"` | 工具调用展开显示，LLM 推理块默认折叠 | （默认） |
| **预览折叠** | `"collapsedPreview"` | 流式期间展开，完成后折叠（便于用户追踪） | — |
| **固定高度滚动** | `"fixedScrolling"` | 固定高度的自动滚动面板，点击标题展开全高 | `.chat-thinking-fixed-mode` |

**NLS**：
- 6226: `Thinking parts will be collapsed by default.`（collapsed）
- 6227: `Thinking parts will be expanded first, then collapse once we reach a part that is not thinking.`（collapsedPreview）
- 6228: `Show thinking in a fixed-height streaming panel that auto-scrolls; click header to expand to full height.`（fixedScrolling）

### 20.2 固定高度模式（fixedScrolling）CSS

```css
/* .chat-thinking-fixed-mode 类添加到 Working 框时 */
.chat-thinking-fixed-mode {
  /* 固定高度滚动面板；通过 JS 动态设置 max-height */
}

/* DevSeek 目前仅有 expanded 一种模式（同 Copilot collapsedPreview 效果） */
```

### 20.3 工具调用折叠位置（`chat.agent.terminalToolCallsInThinking`）

NLS 6225: 当启用时，终端工具调用**嵌入**到 Working 框里显示（`chat-terminal-thinking-collapsible`），而不是单独显示。

```
Working: Running test_suite.sh...         ← Working box header
  ├─ 推理文字（LLM thinking）
  └─ [$ pytest tests/ --tb=short]         ← 内嵌终端 widget（chat-terminal-thinking-collapsible）
       ▸ (output collapsed, can expand)
```

**CSS 类**：
```css
.chat-used-context.chat-terminal-thinking-collapsible {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.chat-used-context-list.chat-terminal-thinking-content {
  border: none;
  padding: 0;
  margin-bottom: 2px;
  overflow: hidden;
}
```

**DevSeek 现状**：终端命令以 tc-confirm-group 或 aut-step terminal 行显示，不嵌入 Working 框。

### 20.4 工具调用显示模式（`chat.agent.toolCallsInThinking`）

NLS 6217–6220：三种工具调用显示方式：
| 配置 | 行为 |
|------|------|
| `"alwaysCollapsed"` | 工具调用总是折叠（NLS 6218） |
| `"showSeparately"` | 工具调用单独显示，不折叠进 thinking（NLS 6219） |
| `"collapseWhenThinking"` | 仅当有 thinking 时才折叠进去（NLS 6220，**默认**） |

---

## 二十一、已知文档勘误记录（2026-05-22）

> 纠正之前版本中的具体错误描述。

### 21.1 §12.2 完成后折叠（⚠️ 之前描述错误）

**之前错误描述**：Working 框完成后会折叠到只显示一行摘要——用户需要点击才能展开。

**正确行为（2026-05-22 修复后）**：
- Copilot 实际上 **不按配置来决定**——而是根据 `thinkingStyle` 设置  
- `collapsed` 模式（默认）：完成后折叠  
- `collapsedPreview`：流式时展开，完成后折叠  
- DevSeek 修复后：**保持展开**（`finalizeExecContainer` 不再调 `removeAttribute('open')`），步骤列表以 `opacity:0.7` 显示为已完成状态

### 21.2 §16 Working 消息池（⚠️ 之前描述错误）

**之前错误描述**：所有 10 个词合并成一个大池随机抽取，更换由计时器驱动。

**正确描述**（§16 已更新）：3 个独立分类池（eXo/tXo/iXo），更换由工具项追加事件驱动。参见 §16 最新内容。

### 21.3 §17.5 Checkpoint 机制（⚠️ 描述不完整）

之前仅提到 NLS 7560。已在 §19.3 补全完整 checkpoint 系统文档（官网确认）。

### 21.4 §2.2 / §12.3 步骤折叠（⚠️ 不完整）

当时描述"Working 框完成后折叠"——实际上 Copilot 有 3 种模式（§20.1），默认 `collapsed` 才折叠。DevSeek 选择不折叠（步骤历史持久可见），是有意设计，非 bug。

---

## 二十二、Todos Widget 显示优化（2026-05-26 截图审计）

### 22.1 背景：三框重叠问题

2026-05-26 截图审计发现 DevSeek UI 中三个区域均以**文件名为主显示**，造成视觉冗余：

| 区域 | 旧行为 | Copilot 正确行为 |
|------|--------|-----------------|
| **aut-container（Working box）** | 标题 = 任务描述，行 = `✏ filename +N -M` | ✅ 描述优先，文件名在操作行 |
| **pending-edits-area（Keep/Undo）** | 每行显示文件名 + Keep/Undo 按钮 | ✅ 文件名即用途，correct |
| **agent-todos-widget（任务清单）** | 主文字 = **文件名**（basename），副文字 = 描述 | ❌ 应与 Copilot 一致：主文字 = 描述，副文字 = 文件名 |

根本原因：`handleTodoUpdate` 三个调用点均以 `fname || desc` 顺序设置 `title` 字段，导致当文件名存在时文件名覆盖描述成为主显示文字。

### 22.2 Copilot Todos Widget 实际行为（参考）

- **主文字（`.agent-todo-fname` slot）**：任务的 **意图描述**（"Edit config file to add X"），不是文件名
- **副文字（`.agent-todo-subdesc` slot）**：文件名（等宽字体，次要视觉权重）
- **进行中图标**：无动画（Working box 的 `autShimmer`/`autSpin` 已足够指示活动状态）
- **动画原则**：每次只有一处动画（活跃的 Working box header shimmer）

### 22.3 修复内容（2026-05-26 已应用）

**JS 修改（`webview.js` 中 `handleTodoUpdate` 三处调用点）**：

```js
// 修复前（文件名优先）
{ title: fname2 || desc2, desc: desc2 }
{ title: basename(t.file || '') || t.desc, desc: t.desc }

// 修复后（描述优先）
{ title: desc2 || fname2, desc: fname2 }
{ title: t.desc || basename(t.file || ''), desc: basename(t.file || '') }
```

三处：plan 阶段（~line 1958）、execute 阶段（~line 2185）、done 阶段（~line 2301）均已更改。

**CSS 修改（todos widget block，`webview.js` ~line 2588）**：

| 选择器 | 属性 | 旧值 | 新值 |
|--------|------|------|------|
| `.agent-todo-fname` | `font-weight` | `600` | `500` |
| `.agent-todo-subdesc` | `font-family` | （未设置）| `monospace` |
| `.agent-todo-subdesc` | `letter-spacing` | （未设置）| `-.01em` |
| `.state-started .agent-todo-icon` | `animation` | `wiBlink 1s ease-in-out infinite` | **移除** |
| `.state-started .agent-todo-fname` | `font-weight` | `700` | `600` |

### 22.4 修复后效果

- Todos widget 主文字 = 当前任务的**意图**（用户关心"做什么"）
- 副文字 = 文件名（等宽字体，辅助定位）
- 三框不再视觉冗余：todos = 意图清单；working box = 执行过程；file-changes = 成果汇总
- 全局同时只有一处动画（正在执行的 Working box header shimmer）

---

## 二十三、官方文档全面审计修正（2026-05-26）

> **本节基于 code.visualstudio.com 官方文档（2026-05-26 实时抓取）与本地观察的综合分析，记录现有文档中的错误、不足与新增内容。**

---

### 23.1 ⚠️ 工具调用 UI 折叠行为（官方设置确认）

**官方文档原文**：
> "By default, tool call details are collapsed in the chat conversation. You can uncollapse them by selecting the tool summary line in chat, or change the default behavior with the `chat.agent.thinking.collapsedTools` setting (experimental)."

**修正/补充**：

| 项目 | 之前描述 | 官方确认 |
|------|---------|---------|
| 工具调用默认状态 | 描述为"运行中可见，完成后折叠" | **默认折叠**（collapsed）— 用户点击展开 |
| 折叠控制设置 | 未提及设置名 | `chat.agent.thinking.collapsedTools`（experimental）|
| 折叠粒度 | 描述为整个 thinking box | **每个工具调用行独立**可折叠/展开 |

**UI 示意**（默认折叠状态）：
```
  ✦ Searched codebase for "auth handler"   ▸    ← 默认折叠（点击展开详情）
  ✏ Edited src/auth.ts  +12 -3                  ← 操作行（始终可见）
```

**DevSeek 差距**：DevSeek 目前工具行 `.aut-step` **始终展开**，未实现折叠功能。可增加 `data-collapsible` + 点击展开行为。

---

### 23.2 文件编辑 pending changes UI（⚠️ 之前文档不精确）

**官方文档原文**：
> "Once the AI has made changes to your files, they are directly applied and saved to disk. VS Code keeps track of which files have pending edits and lets you review them individually or all at once."
>
> "Files with pending edits also have an indicator in the Explorer view and editor tabs with a squared-dot icon."

**重要修正**：

1. 文件改动**立即写入磁盘**（不是内存 staging），用户看到的是已写入的文件
2. pending 状态 = "已写入，等待 accept/reject"，不是"等待写入"
3. 指示图标是 `⬝`（squared-dot，类似 ◻）显示在资源管理器 + 编辑器标签

**完整 pending changes 交互设计**：

```
┌── Chat view ──────────────────────────────┐
│  Files changed:                           │    ← Chat view 中显示变更文件列表
│    ⬝ src/auth.ts       +12 -3 lines      │      （带 ⬝ pending 图标）
│    ⬝ src/types.d.ts     +5 -0 lines      │
│  [Keep All]  [Undo All]                   │    ← Chat view 底部批量操作
└──────────────────────────────────────────┘

编辑器内（打开 src/auth.ts 时）：
┌── src/auth.ts ──────────────────────────┐
│  function handleLogin(user: User) {       │
│ + const token = generateJWT(user.id);    │  ← 绿色 + 号行（新增）
│ - const token = oldAuth(user);           │  ← 红色 - 号行（删除）
│    return token;                         │
│  }                                        │
│  [↑] [↓]  [Keep] [Undo]                 │  ← 编辑器 overlay 控件
└──────────────────────────────────────────┘
  Ctrl+Shift+Alt+N → next edit
  Ctrl+Shift+Alt+P → prev edit
```

**设置参考**：
```json
"chat.editing.revealNextChangeOnResolve": true,   // accept/reject 后自动跳下一处
"chat.editing.autoAccept": 10,                     // 10秒后自动接受所有（秒数，0=禁用）
"chat.tools.edits.autoApprove": {
  "**/*": true,                          // 默认允许编辑所有文件
  "**/.vscode/*.json": false,            // 保护 vscode 配置
  "**/.env": false                       // 保护环境变量文件
}
```

**DevSeek 差距对照**：

| 特性 | Copilot | DevSeek 当前 | 状态 |
|------|---------|-------------|------|
| 文件写入时机 | 立即写入磁盘 | 立即写入（apply_diff / direct write）| ✅ 对齐 |
| Chat view 变更文件列表 | ✅ 带行数 diff 统计 | ✅ `#agent-file-changes-widget` | ✅ 对齐 |
| 编辑器标签 ⬝ 图标 | ✅ squared-dot | 🔴 无 | 🔴 未实现 |
| 资源管理器 ⬝ 图标 | ✅ squared-dot | 🔴 无 | 🔴 未实现 |
| 编辑器内联 diff 视图 | ✅ With hunk navigation | 🔴 无（只有 webview 内 pe-hunk）| 🔴 未实现 |
| Diff hunk 级精细操作 | ✅ Keep/Undo per hunk | 🟡 文件级 Keep/Undo | 🟡 近似 |
| 自动跳到下一处变更 | ✅ `revealNextChangeOnResolve` | 🔴 无 | 🔴 未实现 |
| 自动接受计时 | ✅ `autoAccept` 设置 | 🔴 无 | 🔴 未实现 |
| 敏感文件保护 | ✅ `autoApprove` glob | 🔴 无 | 🔴 未实现 |
| Source control 集成 | ✅ staging → accept all | 🔴 无 | 🔴 未实现 |

---

### 23.3 Checkpoint 系统 UI（⚠️ §19.3 描述不完整）

**官方文档确认的完整交互设计**：

```
Chat view 中的 checkpoint 显示：

  [用户消息 1]                             ← chat request 1
  ────────────────────────────────────
  Working: ...
  Edited auth.ts, types.d.ts
  📄 auth.ts +12 -3  📄 types.d.ts +5 -0   ← chat.checkpoints.showFileChanges 启用时显示
  [Restore Checkpoint] [Fork Conversation] ← hover 显示控件
  
  [AI 回答]
  ────────────────────────────────────
  [用户消息 2]
  ...
```

**Restore Checkpoint 流程**：
1. Hover over chat request → 出现 `Restore Checkpoint` 按钮
2. 确认 → 工作区文件回滚到该时刻 + 后续 chat history 删除
3. `Redo` 按钮出现 → 可恢复此次 restore（一次性）

**Fork Conversation**：
- 基于某个 checkpoint 创建新独立 session
- 完整继承 checkpoint 前的 conversation history
- 用于探索不同的实现路径

**设置**：
```json
"chat.checkpoints.enabled": true,          // 开启 checkpoint
"chat.checkpoints.showFileChanges": true   // 显示每个 request 改变的文件
```

**DevSeek 差距**：🔴 完全未实现。DevSeek 的 `断点续传` 仅是上次挂起后恢复，不是 per-request snapshot + restore。

---

### 23.4 Queue/Steer Messages UI（⚠️ 官方新功能，文档未记录）

**官方文档原文**：
> "You can send follow-up messages while the agent is working. Queue messages for later, steer the current request, or stop and send immediately."

**UI 设计**（agent 运行时输入区）：
```
┌─ 输入框（agent 运行中）───────────────────────────┐
│  [你的新消息...]                                  │
│                                                    │
│  [Queue]  [Steer]  [Stop and Send]  [×Cancel]     │  ← 三种发送模式选择器
└───────────────────────────────────────────────────┘
```

| 按钮 | 行为 |
|------|------|
| **Queue** | 排队到当前 agent run 完成后处理 |
| **Steer** | 向正在运行的 agent 注入新指令（改变方向但不中断）|
| **Stop and Send** | 停止当前 run，立即以新消息重新开始 |

**DevSeek 差距**：🔴 输入框在 agent 运行时被完全禁用（无法发送任何消息）。

---

### 23.5 Permission Level Picker UI（⚠️ 描述需更新）

旧文档将权限描述为 `devseek.autopilotMode` 的 on/off。官方 Copilot 现在是三级下拉选择器：

**UI 位置**：Chat view 输入框旁边（与工具 picker、发送按钮同一行）

```
┌─ Chat input area ──────────────────────────────────────────┐
│  [用户输入框]                                               │
│  [🔧 Configure Tools]  [🔒 Default Approvals ▾]  [发送→]  │
└────────────────────────────────────────────────────────────┘
```

点击权限下拉后：
```
  ○ Default Approvals     ← 按 VS Code 设置（read-only 工具自动批准，危险工具弹확认）
  ● Bypass Approvals      ← 自动批准所有，agent 可能提问
  ○ Autopilot (Preview)   ← 自动批准 + 自动回复澄清问题 + 持续迭代直至完成
```

**DevSeek 实现**：状态栏 autopilot 按钮 = Bypass/Default 两档（缺少 Autopilot 持续迭代逻辑）。

---

### 23.6 Terminal Commands UI（官方新特性补充）

**官方文档对终端命令 inline 显示的描述**：
```
  ⚙ npm install                                   ← 命令行
  [Show Output >]  [Show Terminal]                 ← 折叠/展开输出
  
  ▼ Output:
    added 142 packages in 3.2s
    ...
```

新特性：
1. **Continue in Background** — 长命令（如 `npm start`）可推到后台
   - Chat view 内出现 `Continue in Background` 按钮
   - 后台运行的终端在终端面板自动清理（command 完成后）
   - `Show` 链接可显示并保留后台终端

2. **output 位置可配置**：`chat.tools.terminal.outputLocation` — inline in chat 或 terminal 面板

3. **自动审批终端命令**：`chat.tools.terminal.autoApprove` — 允许/拒绝特定命令的正则列表

**DevSeek 差距**：
- 🟡 终端命令在 working box 中显示（等效）
- 🔴 无 "Continue in Background" 功能
- 🔴 无 output 折叠/展开
- 🔴 无自动审批终端命令规则

---

### 23.7 工具数量限制（⚠️ 官方确认技术约束）

**官方文档**：每次 chat request 最多 **128 个工具**：
> "A chat request can have a maximum of 128 tools enabled at a time."

超过时出现 "Cannot have more than 128 tools per request" 错误。解决方案：
- 通过 tools picker 禁用不需要的工具/MCP server
- 开启 `github.copilot.chat.virtualTools.threshold` 自动管理

**DevSeek 参考**：DeepSeek 当前工具数量较少，不存在此约束。若未来支持 MCP Server，需注意此限制。

---

### 23.8 DevSeek vs Copilot UI 完整差距矩阵（2026-05-26 综合）

以下从**用户可见的 UI 角度**对齐比较：

| UI 组件 | Copilot 设计 | DevSeek 当前 | 差距说明 |
|---------|-------------|-------------|---------|
| **Working box** | 左竖线 + 折叠展开 | ✅ `.aut-container` 左竖线 | ✅ 对齐 |
| **工具行折叠** | 默认折叠，点击展开 | 🔴 始终展开 | 差距：缺少折叠 |
| **完成后折叠行** | 11px 灰色小字，可展开 | ✅ `data-done` + 小字样式 | ✅ 接近对齐 |
| **终端命令显示** | 折叠输出 + Continue in BG | 🟡 显示命令，无折叠输出 | 🟡 近似 |
| **Todos widget** | desc-first，无图标动画 | ✅ 已修复（2026-05-26）| ✅ 对齐 |
| **待审文件列表** | Chat view 中 + 批量操作 | ✅ `#agent-file-changes-widget` | ✅ 近似对齐 |
| **编辑器内联 diff** | ✅ hunk 级 Keep/Undo | 🔴 无（webview 外无操作）| 🔴 未实现 |
| **资源管理器/标签 ⬝ 图标** | ✅ squared-dot pending 指示 | 🔴 无 | 🔴 未实现 |
| **Checkpoint 控件** | ✅ Restore + Fork / hover | 🔴 完全无 | 🔴 未实现 |
| **Queue/Steer 输入** | ✅ agent 运行时可发消息 | 🔴 输入框锁定 | 🔴 未实现 |
| **权限级别 picker** | ✅ 三级下拉（input 区旁）| 🟡 状态栏 autopilot 按钮 | 🟡 近似 |
| **Sessions list** | ✅ 持久 session 侧边栏 | ✅ `sessions-panel` | ✅ 近似对齐 |
| **Context window 指示** | ✅ token 用量 hover 显示 | 🔴 无 | 🔴 未实现 |
| **Memory files** | ✅ 跨 session 记忆面板 | 🔴 无 | 🔴 未实现 |
| **Plan 模式 UI** | ✅ 独立规划对话风格 | 🔴 无（Decomposer 集成）| 🔴 未实现 |

---

## 二十四、截图实测审计报告（2026-05-26 DevSeek 1.0.0）

> **截图来源**：DevSeek 1.0.0 插件真实运行截图，会话标题 "优化DEVSEEK项目的反馈与建议"  
> **审计方法**：对截图中每个可见 UI 元素逐一与本文档规范比对

---

### 24.1 ✅ 已对齐确认项（截图直接验证）

| UI 元素 | 截图观察 | 文档规范出处 | 状态 |
|---------|---------|------------|------|
| **分析型折叠框** | "Reviewed package.json and analyzed viewsContainers configuration" — 纯灰色小字，无左竖线，无外框，紧凑单行 | §12.3 分析完成折叠：11px 灰色，无框，纯文字行 | ✅ 完全对齐 |
| **执行型折叠框** | "Executed multiple grep commands and read extension.ts files" — 同上样式 | §12.3 | ✅ 完全对齐 |
| **终端型折叠框** | "Executed terminal commands for extension management" — 同上样式 | §2.2 完成后 thinking box 折叠为单行文字 | ✅ 完全对齐 |
| **折叠框无左竖线** | 所有已完成的 Working 框均无可见左竖线 | §2.2 "done 后 border-left 消失或透明" | ✅ 已修复 |
| **prose 位于折叠框下方** | AI 文字正文紧跟在折叠框行的下方 | §4.2 "CRITICAL — DOM 顺序：prose 在 thinking box 下方" | ✅ 对齐 |
| **Todos (N/M) 格式** | "Todos (6/6)" 标题 | §3.1 NLS 7452 "Todos (N/M)" | ✅ 对齐 |
| **Todo 已完成图标** | 6 个条目全部显示绿色 ✅ 图标 | §3.2 `codicon-pass` + `var(--vscode-charts-green)` | ✅ 对齐 |
| **Todos 主文字 = 描述** | 条目主文字显示任务意图描述（非文件名） | §22.3 修复：`desc-first` 顺序 | ✅ 2026-05-26 修复已生效 |
| **Todos widget 位置** | 位于输入框上方，独立区域 | §3.1 "挂载在 input 区域，与响应流完全分离" | ✅ 对齐 |
| **Todos 按钮** | 右上角 "≡×" 按钮（清除 + 折叠） | §3.1 "Clear All 按钮 (codicon-clearAll)" | ✅ 对齐 |
| **inline code 渲染** | `` `devseek-netai.devseek-netai` ``、`` `activate()` `` 等内联代码有正确背景高亮 | §5.2 "反引号包裹，背景色高亮，字体等宽" | ✅ 对齐 |
| **键盘快捷键 badge** | `Ctrl+Shift+P` 显示为特殊键盘样式 badge | §5.2 | ✅ 对齐 |

---

### 24.2 ⚠️ 发现的剩余偏差（截图新发现）

#### 偏差1：文件编辑折叠态仍使用彩色 badge（关键）

**截图中观察**：
```
Edited  [⊞ extension.ts]  +7 -0
         ↑
         带蓝色边框/背景的文件名 badge（pill 形状）
```

**文档规范** (§2.3)：
```
✏ extension.ts  +7 -0
```
无彩色外框、无 pill/badge 包裹，图标 + 文件名明文 + diff 数字。

**状态**：❌ 未对齐  
**根因**：文件编辑完成折叠后，标题行渲染路径（`buildFinishedLabel()` → 折叠头）仍使用了 `aut-ficon`/`aut-file-badge` 类型的 styled badge 渲染文件名，而非明文。  
**Copilot 正确渲染**：折叠后整行是纯文字 `✓ Finished with N step(s)` 或 `Edited extension.ts`，文件名为普通文字而非 badge。  
**对文档的修正**：§8.1 中"彩色胶囊已去掉（✅）"的描述**过于乐观**——execution/analysis 路径已去掉，但 **file-edit 折叠态的文件名 badge 尚未去掉**。

---

#### 偏差2：§8.2 状态描述中有旧版问题描述未清理

**截图证实已解决的**（§2.2 对比框中的旧问题列表仍在文档中）：
```
**对比当前 DeepSeek 问题：**        ← §2.2 末尾还残留这段
- ❌ done 后仍有绿色左竖线（应隐藏）
- ❌ 摘要文字偏大偏白
- ❌ 占据过多垂直空间
```
截图证实这三个问题已全部解决。文档 §2.2 末尾的"对比当前 DeepSeek 问题"列表已过时，应标注为 `（已修复，2026-05-26 截图确认）`。

---

### 24.3 文档精确度评估（总体）

| 文档节 | 精确度 | 备注 |
|-------|-------|------|
| §2.2 完成后折叠样式 | 🟡 | 主要规范正确，末尾旧问题列表已过时需清理 |
| §2.3 操作行格式 | 🟡 | Copilot 规范正确；但 §8.1 file-edit badge 状态标注有误 |
| §3 Todos 位置/格式 | ✅ | 截图实测完全吻合 |
| §10.1 Todos 生命周期 | ✅ | 截图实测吻合 |
| §12.3 分析模式折叠样式 | ✅ | 截图实测完全吻合 |
| §22.3 Todos desc-first 修复 | ✅ | 截图确认修复已生效 |
| §23 官方文档差距矩阵 | ✅ | 基本准确，长期路线图正确 |

---

### 24.4 待修正项（基于截图审计）

| # | 位置 | 修正内容 | 优先级 |
|---|------|---------|-------|
| A | §2.2 末尾 "对比当前 DeepSeek 问题" | 追加"已修复，2026-05-26 截图确认" | 文档整洁 |
| B | §8.1 "操作行彩色胶囊" 行 | 注明：analysis/execution 路径已去掉；file-edit 折叠-title badge 仍存在 | 准确性 |
| C | webview.js 实现 | 文件编辑折叠态：移除文件名外的 badge 样式，改为明文 `✏ filename` | 🔴 P2 UI 修复 |

---

## 二十五、三层渐进式披露架构（2026-05-26 截图深度分析）

> **本节分析 Copilot Agent 响应的信息架构核心设计——三层渐进式披露（Progressive Disclosure）。**  
> 来源：基于截图中折叠框展开内容（LLM 推理全文）+ 多轮对话布局的实测分析。  
> **这是 §4.2 的深度扩展，专门覆盖折叠框内部内容和最终总结的信息构型。**

---

### 25.1 三层信息架构总览

Copilot Agent 完成一次响应后，信息按三个层次呈现，用户可按需深入：

```
┌─────────────────────────────────────────────────────────────────────┐
│ 层级 1：结论层（Final Prose，大字，默认可见）                          │
│                                                                       │
│  审计完成。以下是核心结论：                                             │  ← 正常 prose 字号 12-13px
│                                                                       │
│  ✅ 截图确认已对齐（12 项）：                                          │  ← Markdown 渲染：粗体、列表
│    • 所有分析/执行型折叠框 = 纯灰色小字...                             │
│                                                                       │
│  ⚠️ 新发现的 1 个剩余偏差（§24.2）：                                  │
│    • 文件编辑折叠态仍有彩色 badge...                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 层级 2：过程层（Collapsed Summary Lines，小字，点击展开）              │
│                                                                       │
│  Analyzed discrepancies in COPILOT_DISPLAY_STYLE_REFERENCE.md   ▸   │  ← 11px 灰色，可展开
│  Executed multiple grep commands and read extension.ts files    ▸   │
│  Reviewed COPILOT_DISPLAY_STYLE_REFERENCE.md lines 1964-2265    ▸   │
│  Edited  [⊞ extension.ts]  +7 -0                                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 层级 3：细节层（Expanded Box Content，点击展开后可见，富文本）          │
│                                                                       │
│ ▾ Analyzed discrepancies in COPILOT_DISPLAY_STYLE_REFERENCE.md      │  ← 展开后
│                                                                       │
│  The user wants me to audit the COPILOT_DISPLAY_STYLE_REFERENCE.md  │  ← AI 全部推理文字
│  document against the screenshot provided. Let me carefully          │  ← 段落格式
│  analyze the screenshot to identify any discrepancies...             │
│                                                                       │
│  What I can see in the screenshot:                                   │
│  • Collapsed thinking boxes displaying as small italic gray text...  │  ← Markdown 列表
│  • File edit operations with diff badges showing changes...          │
│  ...（完整的 LLM 推理链，可达数百词）                                  │
└─────────────────────────────────────────────────────────────────────┘
```

**用户视角的阅读路径**：
- **快速阅读**：只看层级 1（结论层），直接得到完整答案
- **过程核查**：看层级 2（过程层）的折叠摘要行，确认执行了哪些步骤
- **细节验证**：点击展开层级 3，查看 AI 的完整推理分析

---

### 25.2 层级 3 内容：展开的折叠框中的富文本（⭐ 本节核心）

这是文档此前**未详细记录**的部分。点击折叠行 `▸` 后展开的内容是什么？

**来源**：对话请求中 Copilot 的第一个折叠框，展开后内容如下（截图精确还原）：

```
▾ Analyzed discrepancies in COPILOT_DISPLAY_STYLE_REFERENCE.md

  The user wants me to audit the COPILOT_DISPLAY_STYLE_REFERENCE.md
  document against the screenshot provided. Let me carefully analyze
  the screenshot to identify any discrepancies with the documented
  style.

  Looking at the screenshot carefully:

  Chat interface shown: This is the DevSeek plugin UI (not Copilot),
  showing the DevSeek chat panel.

  What I can see in the screenshot:
  • Tab bar: "CHAT" and "DEVSEEK" tabs
  • A conversation with title "优化DEVSEEK项目的反馈与建议"
  • Working/Reviewed items shown as collapsed summaries...
  • Collapsed thinking boxes displaying as small italic gray text...
  • File edit operations with diff badges showing changes like "+7 -0"
  • A Todos widget at the bottom displaying "Todos (6/6)"...

  Looking at the implementation details, I notice the "Edited" indicator
  uses a styled badge for the filename rather than the pencil icon
  format described in the spec...

  This is a clear mismatch between what DevSeek is currently displaying
  and what the documentation requires. I'm realizing...
```

**展开内容的本质**：这是 LLM 在该轮次产生的**全部文字输出流**（包括工具调用前的思考过程），而非事后生成的摘要。

#### 展开内容的三种形态

| 折叠行类型 | 展开内容 | 内容特征 |
|-----------|---------|---------|
| **分析型** (`Analyzed...`) | LLM 全部推理文字 | 段落 + 列表 + 内联代码，接近自由文本，可达数百到千词 |
| **执行型** (`Executed...`) | 工具调用列表 + 输出 | `⚙ npm run compile` + 终端输出片段（被截断至合理长度）|
| **读文件型** (`Reviewed...`) | 文件内容摘要 + 具体行号 | `Read file.ts lines 100-200`，可含代码片段 |
| **搜索型** (`Searched...`) | 搜索词 + 匹配文件列表 | grep 结果或 semantic search 摘要 |
| **编辑型** (`Edited...`) | diff 视图或变更说明 | `+7 -0` diff，文件路径 |

**关键特征**：
- 展开后**无额外外框**：内容区直接在折叠行下方渲染（`details > summary + content-div` DOM 结构）
- 内容使用**标准 Markdown 渲染**（与 prose 相同），支持代码块、列表、粗体
- 字号与 prose 相同（12-13px），不是小字
- 用户可**反复折叠/展开**，内容保留不丢失
- 多段落自然语言 = LLM 在该轮次自由输出的推理过程，**不经过二次概括**

#### 展开/折叠的 DOM 结构

```html
<details class="chat-thinking-box" data-done>
  <summary class="chat-thinking-summary">
    <!-- 折叠时可见：11px 灰色摘要行 -->
    Analyzed discrepancies in COPILOT_DISPLAY_STYLE_REFERENCE.md
    <i class="codicon codicon-chevron-right"></i>   <!-- ▸ 展开指示 -->
  </summary>
  <div class="chat-thinking-content">
    <!-- 展开后可见：完整 Markdown 渲染内容 -->
    <p>The user wants me to audit...</p>
    <ul>
      <li>Looking at the screenshot carefully...</li>
    </ul>
    <!-- 工具操作行（若有）-->
    <div class="chat-thinking-tool-wrapper">
      <i class="codicon codicon-file-text"></i>
      <span>Read extension.ts</span>
    </div>
  </div>
</details>
```

---

### 25.3 多轮响应的完整布局（截图精确还原）

多个 Working session 完成后的完整屏幕布局，从上到下：

```
用户消息气泡（右对齐蓝色背景）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Analyzed discrepancies in COPILOT_DISPLAY_STYLE_REFERENCE.md  ▸   ← session 1，已折叠
                                                                     11px 灰色，点击展开推理全文
Let me read the current document state...                           ← session 1 的 prose（过渡语）

Reviewed COPILOT_DISPLAY_STYLE_REFERENCE.md lines 1964 to 2265  ▸ ← session 2，已折叠

Now I have everything I need. Let me prepare and add §二十四...    ← session 2 的 prose（过渡语）

Reviewed and updated COPILOT_DISPLAY_STYLE_REFERENCE.md   ▸       ← session 3，已折叠（编辑动作）

Now append §二十四 at the end of the document:                     ← session 3 的 prose

Reviewed and updated COPILOT_DISPLAY_STYLE_REFERENCE.md   ▸       ← session 4，已折叠

Now fix the two stale descriptions...                              ← session 4 的 prose

Edited  [⊞ extension.ts]  +7 -0                                   ← session 5【文件编辑】折叠

Now rebuild, uninstall current, and reinstall:                     ← session 5 的 prose

Executed terminal commands for extension management   ▸            ← session 6，已折叠（终端）

Done. After reloading VS Code (Ctrl+Shift+P → "Reload Window"),   ← ⭐ 最终总结 prose
the DevSeek icon will automatically appear pinned in the          （层级1：结论层，正常字号）
activity bar — no "+" click needed...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Todos (6/6)  [≡×]                                                  ← Todos widget（input 区域）
  ✅ Fix C: Remove stream:false from decomposeTask
  ✅ Fix A: Fix 62s non-stream AbortSignal timeout
  ✅ Fix B: Increase waitForGenerationDone startup to 30s
  ✅ Fix D: Todo widget use codicons instead of text chars
  ✅ Fix E: Session restore inject raw history when no summary
  ✅ Build and verify compilation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Describe what to build...]                                        ← 输入框
```

**布局规律**：
1. 每个 session 完成后 → 折叠为小字摘要行（层级 2）
2. 每个摘要行下方 → 该轮次的过渡性 prose（1–3 句，引导下一步动作）
3. 最后一个 session 下方 → **最终总结 prose**（层级 1，完整结论，无字号降调）
4. 最终 prose 之后 → Todos / FileChanges widget
5. 最底部 → 输入框

---

### 25.4 最终总结 prose 的信息构型（层级 1 的内部结构）

最终总结不是简单一段文字，而是有结构的 Markdown 文档内容：

```
Done. After reloading VS Code (Ctrl+Shift+P → "Reload Window"),    ← 首句：直接结论（1-2 句）
the DevSeek icon will automatically appear pinned in the
activity bar — no "+" click needed.

This only fires once on first install (the `devseek.activatedBefore`  ← 次要解释（补充细节）
global state flag prevents it from forcing open on every
subsequent startup).
```

**信息构型规律**：

| 位置 | 内容类型 | 字号/样式 | 视觉权重 |
|------|---------|---------|---------|
| **首句/首段** | 直接结论（"Done."、"Fixed."、"Here's what changed:"）| 正常 prose | ★★★★★ |
| **中段** | 解释说明、原理阐述、方案分析 | 正常 prose | ★★★☆☆ |
| **列表项** | 逐条说明（文件名、方案步骤、差距项）| Markdown 列表 | ★★★★☆ |
| **行内代码** | 具体配置键、函数名、文件路径 | `` `monospace` `` 高亮 | ★★★★☆ |
| **键盘快捷键** | VS Code badge 样式（Ctrl+Shift+P）| 特殊 badge 渲染 | ★★★★☆ |
| **末句（可选）** | 后续建议或确认问题 | 正常 prose | ★★☆☆☆ |

**关键原则**：
- **最高优先级信息放首句** — 用户第一眼看到的是结论，不是过程
- **细节在后** — 实现原理、原因分析放后（用户可以不读）
- **自然语言优先** — 不用标题（`##`）切割，保持对话感
- **工具调用文本被过滤** — `[TOOL:task_complete {"summary":"..."}]` 内容不出现在 prose 中

---

### 25.5 过渡性 prose vs 最终总结 prose 的区别

前述 §12.6 已列出两者区别，本节从信息架构角度补充：

| 维度 | 中间轮次过渡性 prose | 最终总结 prose |
|------|-------------------|--------------| 
| **认知目的** | 让用户感知"下一步要做什么" | 让用户得到**完整答案** |
| **时态** | 未来导向（"Let me now..."、"I'll check..."）| 过去完成 + 现状（"Done."、"The issue was..."）|
| **长度** | 通常 1–2 句 | 通常 2–8 句，可含列表 |
| **Markdown 结构** | 纯文本段落 | 可含粗体、列表、代码块 |
| **是否必须** | 可无（纯工具调用轮次无 prose）| ⭐ **几乎必须**（用户期望明确结论）|
| **折叠关系** | 自身紧跟某个折叠行下方 | 在所有折叠行之后 |

---

### 25.6 对 DevSeek 实现的指导意义

基于以上分析，DevSeek 需要重点确保的三个实现点：

#### (A) 展开内容完整性（层级 3）

折叠框展开时，**完整的 LLM 输出流**（包括工具调用前的纯文字推理段落）必须被保留在 `.aut-analysis-body` 或等效容器中：
- ✅ 已实现：`routeAnalysisToWorkingBox()` 将 delta 写入 `.aut-analysis-body`
- ⚠️ 待确认：推理段落（非工具调用行）是否也被写入（还是被 `stripToolCallBlocks()` 误过滤）

#### (B) 展开/折叠交互（层级 2 ↔ 层级 3）

折叠行必须可点击展开：
- ✅ 已实现：`details[data-done]` + `summary` 的 HTML `<details>` 折叠机制
- ⚠️ 待确认：展开后内容区的渲染是否使用 Markdown（非明文），保证代码块高亮等

#### (C) 最终总结的完整输出（层级 1）

最终 prose 必须是 AI 全文，不得被截断：
- ✅ 已实现：`endResponse` 时 `currentBubble` 正常完成 Markdown 渲染
- ✅ 已实现：`stripToolCallBlocks()` 仅过滤 `[TOOL:...]`，保留全部自然语言
- ✅ 对照截图验证：截图中最终总结文字完整且字号正确，无截断

---

## 二十六、Working 区域固定高度滚动 + 最新活动自动追踪（2026-05-30 新增）

> 基于用户提供的 Copilot 任务执行过程截图（2026-05-30）实测观察。

### 26.1 截图描述（用户原话还原）

**截图1（任务执行中）：**
- **红色框**：AI 反馈信息内容（prose 文字，正常字号，在主聊天流中）
- **蓝色框**：Todos 信息（input 区域上方，持久显示）
- **绿色区**：Files Changed 区域（已编辑文件列表，done 阶段出现）

**截图2（Working 区域特写）：**
- **蓝色框**：中间反馈信息（过渡性 prose，普通文字，大字）
- **Working 区域**：AI 真正执行中反馈的信息
  - 信息按**向上滚动**方式显示（新条目追加到底部，整体向上推）
  - Working 区域**高度固定**，不随内容增加而无限增高
  - 内部滚动，不影响整体聊天页面的滚动位置
- **执行完成后**：反馈信息的最后是**总结信息**，涵盖用户关心的要点，以及 AI 做了什么

### 26.2 Working 区域固定高度 + 内部滚动（核心 UX 特征）

```
  ╷ Working: Creating programmer_reality.cpp   ⟳
  ╷  ┌───────────────────────────────────────┐  ← 固定高度内容区（约 160–200px）
  ╷  │  Read programmer_reality.cpp           │  ← 旧条目（向上移）
  ╷  │  Searched for #include <algorithm>     │  ← 中间条目
  ╷  │  $ g++ -std=c++17 code/progr… [✓ ok]  │  ← 较新条目
  ╷  │  Wrote programmer_reality.cpp          │  ← 最新条目（始终可见）
  ╷  └───────────────────────────────────────┘  ← 超出部分在内部滚动
  ╷  ● Writing...                              ← 底部状态词
```

**关键行为规则：**

| 规则 | 描述 |
|------|------|
| **固定高度** | Working 内容区有 `max-height` 约束，不随条目数量无限扩张 |
| **内部滚动** | 超出高度的条目通过 `overflow-y: auto` 在容器内滚动，**不影响** 聊天页面整体滚动 |
| **自动追踪最新** | 每次新条目追加时，内容区自动 `scrollTop = scrollHeight`，始终显示最新活动 |
| **向上推进感** | 用户看到的效果是信息不断向上移动，最新的始终在底部可见 |
| **不压占主对话** | Working 区域高度固定，prose 和 Working 框之间无大量空白，聊天流紧凑 |

### 26.3 分区布局（截图完整结构还原）

```
┌─ 聊天消息流 ─────────────────────────────────────────┐
│                                                       │
│  在code目录下，编写一个C++程序，体现程序员现状        │  ← 用户消息（右对齐）
│                                                       │
│  ╷ Working: Creating programmer_reality.cpp ⟳        │  ← Working 框（激活中）
│  ╷  ┌────────────────────────────────────┐           │
│  ╷  │  Read programmer_reality.cpp       │  ← 内容区  │
│  ╷  │  Searched for sort, algorithm      │  （有界、  │
│  ╷  │  Wrote programmer_reality.cpp      │   内滚）   │
│  ╷  └────────────────────────────────────┘           │
│  ╷  ● Writing...                                     │
│                                                       │
│  收到反馈，我来编译并运行这个程序，验证它确实能体现    │  ← 中间过渡 prose（蓝色框）
│  程序员现状。                                          │
│                                                       │
│  编译出错了，缺少 #include <algorithm> 头文件。        │  ← 反馈信息（红色框区）
│  我来修复这个问题。                                    │
│                                                       │
└──────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Todos (2/2)                     [≡×]    ← Todos（蓝色框，input 区上方）
  ✓ 创建/更新代码文件
  ✓ 编译/运行并验证结果
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [用户输入框]
```

**绿色区域（Files Changed）** 在 done 阶段出现，位于 Todos 下方、输入框上方：
```
  ├─ 1 file changed   +219 -0           ← 文件变更摘要行
  │  ✓ code/programmer_reality.cpp  +219 │
  │  [Keep]  [Undo]                      │  ← 操作按钮（inline）
```

### 26.4 完成后总结 prose 的用户关注点（新实测标准）

完成后的总结 prose 不只是"做了什么"，**还需要明确告知用户应当关注的要点**：

```
以下是程序的核心功能说明：

- 🐛 `bugTracker()`：使用 `sort()` 对 bug 列表排序，体现"代码写一行，bug
  改一天"的程序员日常
- 💻 `codeReview()`：模拟代码审查中的技术讨论
- ☕ `dailyRoutine()`：涵盖开会、喝咖啡、加班等场景
- ✅ 编译验证：程序可以正常编译运行（若出现错误会在上方告知）
- 📁 文件位置：`code/programmer_reality.cpp`
```

**总结 prose 信息构型标准（截图实测 2026-05-30）：**

| 信息层级 | 内容 | 优先级 |
|---------|------|--------|
| **执行状态** | 编译/运行是否成功，若有错误明确指出 | ★★★★★ |
| **文件位置** | 用户可直接找到的文件路径 | ★★★★☆ |
| **核心功能说明** | 程序/代码实际做了什么（用户最关心）| ★★★★★ |
| **设计亮点** | 关键实现思路，帮助用户理解 | ★★★☆☆ |
| **后续建议** | 用户可以如何进一步使用/测试 | ★★☆☆☆ |

**与 §25.4 "信息构型"的补充关系：**
- §25.4 描述了通用结构（首句结论 → 细节 → 列表 → 后续）
- §26.4 **新增**：总结必须包含**编译/运行结果**（即使 AI 认为成功，也应明确告知）
- §26.4 **新增**：总结必须包含**可执行程序路径或验证方式**（用户需要知道在哪里找到产出）

### 26.5 对 DevSeek 的实现要求（2026-05-30 新增）

| # | 项目 | Copilot 行为 | DeepSeek 当前 | 优先级 |
|---|------|------------|--------------|--------|
| A | **aut-steps-list 自动滚动** | 每次追加新步骤后滚动到底部，始终显示最新 | ❌ 无自动滚动（停在顶部）| P0 |
| B | **aut-steps-list 高度** | 约 160–200px（约 6–8 行可见）| ⚠️ 130px（约 4–5 行可见，偏小）| P1 |
| C | **aut-rows 内容区约束** | aut-rows 内容超出时内部滚动，不无限扩张 | ❌ aut-rows 无高度约束，可以无限增高 | P1 |
| D | **终端输出自动滚动** | 终端输出块追加时滚动到最新 | ❌ 无自动滚动 | P1 |
| E | **总结包含执行结果** | 明确说明编译是否成功、可执行文件位置 | ⚠️ 依赖 AI 输出，无结构化保证 | P2（后端提示词） |
| F | **整体聊天自动跟踪** | 追加活动时 `maybeScrollToBottom()` 确保最新内容在视口 | ✅ 已实现 | 已完成 |

**实现方案（A、B、C 最高优先）：**

```javascript
// A: 每次追加步骤后自动滚到底
actRow.appendChild(stepEl);
actRow.scrollTop = actRow.scrollHeight;  // ← 新增

// B: 提高 max-height
'.aut-steps-list { max-height:180px; ... }'  // 130 → 180

// C: aut-rows 加高度约束
'.aut-rows { max-height:200px; overflow-y:auto; ... }'  // 新增
```

