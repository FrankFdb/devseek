# 顶级 AI 编程助手功能需求全景

> 编写日期：2026-05-12  
> 目的：收集并整理 GitHub Copilot、Cursor、Claude Code、Aider、Continue 等顶级 AI 编程助手的核心能力，作为 DeepSeek 插件功能规划的参照与需求基线。  
> 收集来源：Copilot 源码逆向（workbench.desktop.main.js + extension.js）、官方文档、社区评测、产品实测对比。

---

## 一、顶级产品能力矩阵

### 1.1 总体对比

| 能力维度 | Copilot | Cursor | Claude Code | Aider | Continue | DeepSeek 插件（当前） |
|----------|:-------:|:------:|:-----------:|:-----:|:--------:|:-------------------:|
| **内联补全** | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **聊天问答** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **多文件 Agent** | ✅ | ✅ | ✅ | ✅ | ⚠ | ✅ |
| **多轮 Agent 循环** | ✅ | ✅ | ✅ | ✅ | ⚠ | ✅（L-1/L-4，v2.15）|
| **Function Calling** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（伪工具格式，v2.15）|
| **Codebase 语义索引** | ✅ | ✅ | ✅ | ⚠ | ✅ | ❌ |
| **终端工具集成** | ✅ | ✅ | ✅ | ✅ | ⚠ | ✅（run_terminal，v2.15）|
| **Git 集成** | ✅ | ✅ | ✅ | ✅ | ⚠ | ✅（/commit，@git，v2.12）|
| **测试生成/运行** | ✅ | ✅ | ✅ | ⚠ | ⚠ | ✅（/test，P3-4，v2.15）|
| **多模型支持** | ✅ | ✅ | ❌ | ✅ | ✅ | ✅（bridge/API/OpenAI-compat，v2.15）|
| **自定义规则/记忆** | ✅ | ✅ | ✅ | ⚠ | ✅ | ✅（.deepseek/rules.md，v2.15）|
| **MCP 工具扩展** | ✅ | ✅ | ✅ | ❌ | ⚠ | ✅（McpManager，P3-5，v2.15）|
| **manage_todo_list** | ✅ | ❌ | ⚠ | ❌ | ❌ | ✅（L-2，v2.15）|
| **task_complete 工具** | ✅ | ❌ | ⚠ | ❌ | ❌ | ✅（L-3，v2.15）|
| **自动驾驶模式** | ✅ | ✅（Yolo） | ✅ | ✅ | ❌ | ✅（L-5，v2.16）|
| **File Changes 框** | ✅ | ✅ | ✅ | ✅ | ⚠ | ✅（afc-widget，v2.18）|
| **PR 代码审查** | ✅ | ❌ | ⚠ | ❌ | ❌ | ❌ |
| **浏览器/Web 工具** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **自动提交** | ❌ | ⚠ | ⚠ | ✅ | ❌ | ❌ |
| **Shadow 工作区** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **后台/无头 Agent** | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |

> **更新记录**：  
> 2026-05-12 — 将 v2.15/v2.16/v2.18 已上线功能从 ❌ 更新为 ✅；新增 manage_todo_list、task_complete、自动驾驶、File Changes 行。  
> 2026-05-26 — 语义化意图路由、任务分类规则全面重构（详见 [§5 意图路由架构](#五意图路由架构--semantic-intent-routing)）。

---

## 五、意图路由架构 — Semantic Intent Routing

> 本节记录 2026-05-26 重构：彻底去除固定词语关键词匹配，对齐 Copilot / Claude Code 做法。

### 核心原则

**Copilot / Claude Code 的设计原则（来自源码逆向）：**
- 不使用词汇表/关键词列表推断用户意图（brittle, language-dependent）
- 所有提示默认进入 Agent 循环，LLM（Architect/Phase-0）是意图的权威判断者
- 唯一的前置过滤：明确的"不要修改"命令（这是结构性指令，不是词汇推断）

### 重构前问题

旧版 `intent-router.ts` 有 8 个中英文关键词正则，用评分系统判断意图：

```typescript
// ❌ 旧做法：中英文关键词打分，language-dependent，易误判
const META_DISCUSSION_RE = /(插件|流程|策略|检讨|方案|是否|怎么|为何|原理)/i;
const ACTION_VERB_RE = /(修复|优化|重构|实现|新增|add|modify|fix|create)/i;
// 8个RE组合打分 → 决定是否进入agent模式
```

问题：用户说"**分析**附件代码，**需要优化**3D显示"，`分析`匹配 `META_DISCUSSION_RE` 导致降分，生成 14 个 analyze 任务，什么都没改。

### 重构后方案

**`intent-router.ts`（结构性信号，无词汇匹配）：**
```typescript
// ✅ 新做法：默认 code-change，LLM决定；只拦截明确的"不改"命令
const NO_CHANGE_RE = /(不要修改|无需修改|only discuss|just explain)/i; // 结构性命令，非词汇推断
export function decideChatIntent(prompt: string): ChatIntentDecision {
  if (NO_CHANGE_RE.test(text)) return { kind: 'chat', ... };
  // Default: code-change — the LLM (decomposer) decides the real plan
  return { kind: 'code-change', autoApplyEligible: true, ... };
}
```

**`agent-task-decomposer.ts`（LLM语义问答，取代词汇匹配）：**

LLM必须回答三个语义问题，再输出任务计划（与Copilot的self-evaluation模式一致）：

```
Q1: 所有任务完成后，用户期望存在什么？（changed code → modify; 分析报告 → analyze）
Q2: 如果只阅读+输出结论，不改文件，用户会满意吗？（No → 必须生成modify任务）
Q3: 附件是"待修改的目标"还是"阅读上下文"？（目标 → 直接modify; 未知 → explore first）
```

**`agent-loop.ts`（任务驱动，取代提示关键词）：**
```typescript
// ❌ 旧：RUN_INTENT_RE.test(userPrompt) — prompt关键词决定是否run
// ✅ 新：从任务计划推断（LLM已在Phase-0决定是否需要运行）
const wantRun = tasks.some(
  t => t.action === 'analyze' && /run_terminal|运行程序|compile.*run/i.test(t.desc)
);
```

**`extension.ts`（结构性条件，取代错误关键词）：**
```typescript
// ❌ 旧：/错误|报错|error|fix|修复|编译/i.test(prompt) 才注入诊断上下文
// ✅ 新：只要活跃文件有实际诊断错误就注入（让LLM决定是否相关）
const diagCtx = getDiagnosticsContext('active');
if (diagCtx) { finalPrompt = diagCtx + '\n\n' + finalPrompt; }
```

### 哪些关键词匹配是合理的（不应该删除）

以下是**技术性/结构性**判断，不是用户意图推断，保留合理：

| 用途 | 示例 | 理由 |
|------|------|------|
| 文件类型判断 | `/\.cpp\|\.py\|\.js$/i` | 文件名是客观事实，无歧义 |
| `#include` 库检测 | `/glut\.h/` → 添加 `-lglut` | 代码结构分析，非意图推断 |
| 网络错误分类 | `msg.includes('ECONNREFUSED')` | 错误码是机器产生的结构信号 |
| LLM协议信号 | `/\[TASK_COMPLETE\]/` | LLM主动输出的结构化信号 |
| 安全防护 | `SERVER_COMMAND_RE`, `SUDO_PASSWORD_RE` | 系统安全必要检查 |
| JSON结构检测 | `body.startsWith('{')` | 格式检测，非意图推断 |



### 2.1 GitHub Copilot（v0.40+）

**产品定位：** VS Code + IDE 原生集成；订阅制（$10/月）。

#### 核心能力

| 功能 | 说明 |
|------|------|
| **内联补全** | Ghost text 单行/多行补全，基于文件上下文 + 工作区语义 |
| **Inline Chat** | 选中代码后 `Ctrl+I` 调出内联 AI，直接编辑/解释/重构 |
| **侧边栏 Chat** | 完整对话界面，支持 `@workspace`、`@file`、`#symbol` 引用 |
| **Agent 模式（Edits）** | 多文件 agent，`_runLoop` 多轮循环，manage_todo_list 工具，task_complete 终止 |
| **Autopilot 模式** | 全自动执行到完成（toolCallLimit=200），无需用户每步确认 |
| **Subagent** | 可派生子 agent 处理特定文件/任务（`runSubagent` 工具） |
| **Tool System** | 原生 function calling：read_file、grep_search、replace_string_in_file、run_in_terminal、get_errors 等 30+ 工具 |
| **MCP 支持** | 通过 VS Code MCP 协议接入第三方工具服务器 |
| **Codebase 索引** | `@workspace` 语义搜索，向量化代码库，快速定位相关文件 |
| **Git 集成** | 自动生成 commit message；PR 描述生成；inline PR review comment |
| **Think 模式** | Claude Sonnet 4.6 支持 extended thinking（reasoning tokens） |
| **多模型支持** | Claude Sonnet 4.6、GPT-4o、Gemini 2.5 Pro 等，用户可选 |
| **自定义指令** | `.github/copilot-instructions.md`；`.instructions.md`；SKILL.md；AGENTS.md |
| **Notebook 支持** | Jupyter Notebook 内 AI 辅助（run_notebook_cell 工具）|
| **错误修复** | `get_errors` 工具实时检测，AI 自动修复编译错误 |
| **安全检查** | 输出过滤（OWASP）、内容政策执行 |

#### 架构关键点
- 通过 `vscode.lm` API 接入模型，模型由 VS Code 平台管理
- Agent 工具通过 VS Code 核心注册（非扩展直接定义），安全性高
- Todo widget 在 input area，与响应流分离

---

### 2.2 Cursor（v0.45+）

**产品定位：** VS Code Fork，深度改造；订阅制（$20/月 Pro）。

#### 核心能力

| 功能 | 说明 |
|------|------|
| **Composer（Agent 模式）** | 多文件 agent，自动应用 diff，Yolo 模式（全自动）|
| **Background Agent** | 在云端 / Shadow Workspace 中后台运行，不阻塞用户 |
| **Shadow Workspace** | 在虚拟空间预执行所有改动，用户确认后才应用到真实工作区 |
| **@ 引用系统** | `@file`、`@folder`、`@web`、`@docs`、`@git`、`@notepad`、`@recent`、`@errors` |
| **Cursor Rules** | `.cursorrules` / `.cursor/rules/*.mdc` 定义项目级 AI 行为规则 |
| **Notepads** | 持久化 AI 背景知识（跨会话），可插入任意对话 |
| **Codebase 索引** | 全项目语义索引（向量 DB），与 `@codebase` 结合深度搜索 |
| **多模型选择** | GPT-4o、Claude Sonnet/Opus、Gemini 2.5 Pro、DeepSeek R1、o3 mini 等 |
| **BugBot** | GitHub 集成，PR 自动 review，检测潜在 bug |
| **终端集成** | AI 可直接运行终端命令，自动读取错误输出并修复 |
| **Tab 键冲突** | 补全冲突自动解决（Next Edit Suggestion）|
| **MCP 支持** | 通过 `.cursor/mcp.json` 配置 MCP 服务器 |
| **Privacy 模式** | 代码不发送到训练服务器（Enterprise）|
| **隐式上下文** | 自动检测当前打开的文件/光标位置作为上下文 |

#### 架构关键点
- VS Code Fork（非扩展），可修改编辑器底层行为
- diff 应用采用"预览 → 用户确认"工作流
- Shadow Workspace 通过 Git 分支 + 进程隔离实现

---

### 2.3 Claude Code（Anthropic，命令行）

**产品定位：** CLI 工具（`claude` 命令），嵌入终端和 Agentic 工作流；需 Anthropic API。

#### 核心能力

| 功能 | 说明 |
|------|------|
| **Bash 工具** | 直接执行 shell 命令，读取 stdout/stderr，理解 exit code |
| **完整文件系统工具** | Read/Write/Edit 带行号精确编辑，支持大文件 |
| **多 Agent 网络** | Agent 可 spawn 子 Agent 处理并行子任务 |
| **MCP 服务器** | 通过 `.claude_mcp_config.json` 接入任意工具服务（浏览器、数据库等）|
| **Computer Use** | 截图 + 点击操作 GUI（实验性）|
| **Extended Thinking** | Claude 3.7 Sonnet extended thinking，内部推理 token |
| **Memory（CLAUDE.md）** | 项目级规则文件，持久化 AI 记忆（可分层：全局/项目/本地）|
| **Cost Tracking** | 实时显示 token 消耗和估算费用 |
| **Compact Mode** | 对话历史压缩（`/compact`），节省 context window |
| **无头模式** | `claude -p "..." --output json` CI/CD 集成，非交互自动化 |
| **自定义 Slash 命令** | `.claude/commands/*.md` 定义可复用的 prompt 模板 |
| **Hooks** | PreToolUse / PostToolUse / Stop 等生命周期钩子，用于安全审计 |
| **Permissions 模型** | 细粒度工具权限（`allowedTools`），可允许/拒绝特定操作 |
| **会话持久化** | `--resume {session-id}` 恢复历史对话 |

#### 架构关键点
- 真正的 agentic loop + function calling（Anthropic 原生 tool_use 格式）
- `CLAUDE.md` 在每轮 prompt 中自动注入（类 Copilot `.instructions.md`）
- 工具结果作为 `tool_result` 消息追加到历史，供下轮感知

---

### 2.4 Aider（开源命令行）

**产品定位：** Git-first AI 编程助手，命令行，支持多种模型；GitHub Stars 20k+。

#### 核心能力

| 功能 | 说明 |
|------|------|
| **Architect/Editor 分离** | Architect 分析需求生成编辑计划；Editor 执行具体 SEARCH/REPLACE |
| **SEARCH/REPLACE 块** | 精确文件编辑格式，避免大模型全量重写 |
| **Git 自动提交** | 每次成功编辑自动 `git commit -m "AI: ..."` |
| **多模型支持** | DeepSeek、Claude、GPT-4o、Gemini、Ollama 等 100+ 模型 |
| **Map 模式** | 生成 repo map（函数/类摘要）作为上下文，支持超大代码库 |
| **语音输入** | `aider --voice` 语音转文字编程 |
| **Lint/Test 自动运行** | 改动后自动运行 linter 和测试，失败时自动修复 |
| **Watch 模式** | 监听文件变化中的 AI 注释（`# AI!`），自动响应 |
| **配置文件** | `.aider.conf.yml`、`CONVENTIONS.md` 项目规则 |
| **Benchmark 驱动** | Aider Polyglot Benchmark —— 最常用的 AI 编程基准之一 |

---

### 2.5 Continue.dev（开源 VS Code 扩展）

**产品定位：** 开源、完全本地可运行，支持自定义模型；GitHub Stars 25k+。

#### 核心能力

| 功能 | 说明 |
|------|------|
| **Slash 命令** | `/edit`、`/comment`、`/test`、`/share` 可扩展的命令体系 |
| **@ 上下文提供者** | `@file`、`@repo`、`@terminal`、`@docs`、`@issue` 等 |
| **自定义 Model** | `config.json` 配置任意 LLM（Ollama、Anthropic、OpenAI、Together 等）|
| **MCP 支持** | 接入任意 MCP 工具服务器 |
| **Docs 索引** | 将文档网站爬取并向量化，供 `@docs` 检索 |
| **RAG（Retrieval）** | 基于语义搜索的上下文检索，支持全代码库 |

---

## 三、功能分类需求详解

### 3.1 代码理解与检索（Context Intelligence）

**需求描述：** AI 在回答问题前，能主动理解代码库结构，找到相关文件和函数。

**关键功能：**

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **代码库语义索引** | 将整个工作区向量化，支持自然语言查询 "找到处理登录的代码" | 🔴 高 |
| **符号感知** | 理解函数、类、变量的定义/引用关系（基于 LSP/TS Language Server）| 🔴 高 |
| **智能上下文选择** | 自动判断哪些文件与当前问题相关，无需用户手动 `@file` | 🟡 中 |
| **Repo Map** | 生成代码库摘要图谱（类 Aider 的 repo map）| 🟡 中 |
| **Git 历史感知** | 理解最近的代码变更（`git diff`、`git log`）| 🟡 中 |

**DeepSeek 当前状态：** ❌ 无自动语义索引；agent 靠前端 preattach 文件（手动）

**实现路径：**
1. 使用 `vscode.workspace.findFiles` + `vscode.languages.getLanguages` 枚举代码库
2. 集成 `@vscode/vscode-languagedetection` 分类文件
3. 轻量级：使用 file 路径 + 函数签名 + 前 N 行的摘要（无需向量 DB）
4. 重量级：引入 `hnswlib-node` 或远程 embedding API 做语义索引

---

### 3.2 多文件 Agent 执行

**需求描述：** AI 能独立规划并执行跨多文件的复杂任务，无需用户每步指导。

**关键功能：**

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **多轮 agent 循环** | AI 多次 LLM 调用，每轮理解工具反馈，动态调整计划 | 🔴 高（L-1）|
| **真正的 function calling** | AI 自主决定调用哪些工具，不依赖预分解 | 🔴 高（L-1）|
| **SEARCH/REPLACE 精确编辑** | 避免全文件重写，对大文件尤其重要 | ✅ 已实现 |
| **多文件并行编辑** | 同一轮 LLM 响应中对多个文件并行发出编辑指令 | 🟡 中 |
| **编辑 Preview（Shadow）** | 类 Cursor Shadow Workspace，先预览再确认 | 🟢 低 |
| **Autopilot 模式** | 全自动执行到 task_complete，无需每步确认 | 🟡 中（L-5）|

**DeepSeek 当前状态：** ✅ SEARCH/REPLACE 已实现；❌ 无多轮循环；❌ 无真正 function calling

---

### 3.3 终端与构建系统集成

**需求描述：** AI 能执行命令、读取输出、根据错误自动修复。

**关键功能：**

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **run_in_terminal 工具** | AI 可执行 shell 命令（cmake、npm、pytest 等）| 🔴 高 |
| **错误捕获与自动修复** | 读取 stderr/exit code，触发下一轮 LLM 修复 | 🔴 高 |
| **编译错误集成** | 对接 VS Code Diagnostics API（`vscode.languages.getDiagnostics`）| ✅ 已实现（P5-2）|
| **测试运行与报告** | 执行测试框架，解析测试失败信息 | 🟡 中 |
| **后台任务支持** | 长时间构建任务不阻塞 AI 交互界面 | 🟡 中 |

**DeepSeek 当前状态：** ❌ 无任何终端/构建集成

---

### 3.4 Git 与代码审查集成

**需求描述：** AI 理解 Git 上下文，能自动提交、生成 PR 描述、审查代码变更。

**关键功能：**

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **Commit Message 生成** | 分析 `git diff --staged` 自动撰写 commit message | 🔴 高 |
| **PR 描述生成** | 基于代码变更摘要生成 PR title + body | 🟡 中 |
| **代码变更审查** | 对 diff 进行 AI review，发现潜在问题 | 🟡 中 |
| **自动 git commit（Aider 风格）** | 每次编辑后自动 `git add + commit`，保留 AI 操作历史 | 🟢 低 |
| **Branch 感知** | 理解当前分支、未合并变更 | 🟢 低 |

**DeepSeek 当前状态：** ❌ 无 Git 集成

**实现参考：**
```typescript
// 使用 VS Code Git 扩展 API
const gitExt = vscode.extensions.getExtension('vscode.git')?.exports;
const repo = gitExt?.getAPI(1).repositories[0];
const diff = await repo?.diff(true); // staged diff
```

---

### 3.5 内联代码补全

**需求描述：** 在输入时实时提供代码补全建议（Ghost text / Tab 补全）。

**关键功能：**

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **单行/多行补全** | 基于当前文件上下文预测后续代码 | 🔴 高 |
| **Tab 键接受** | 按 Tab 接受全部，→ 接受单词 | 🔴 高 |
| **Inline Chat（`Ctrl+I`）** | 选中代码后内联 AI 编辑 | 🔴 高 |
| **Next Edit Suggestion** | AI 预测下一处可能需要修改的位置 | 🟡 中 |
| **FIM（Fill In the Middle）** | 基于前后文补全中间代码 | 🟡 中 |

**DeepSeek 当前状态：** ❌ 无内联补全（当前仅侧边栏聊天 UI）

**实现路径：**
- 注册 `vscode.languages.registerInlineCompletionItemProvider`
- 触发器：typing 500ms 防抖；选中代码时触发
- 调用 LLM（推荐 DeepSeek API 因延迟低）
- 返回 `vscode.InlineCompletionItem`

---

### 3.6 项目规则与持久记忆

**需求描述：** AI 记住项目约定（代码风格、架构规则、禁忌事项），在每次对话中自动应用。

**关键功能：**

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **项目规则文件** | `.deepseek/rules.md` 或 `DEEPSEEK.md`（类 Cursor Rules / CLAUDE.md）| 🔴 高 |
| **全局用户偏好** | `~/.config/deepseek/instructions.md` 跨工作区生效 | 🟡 中 |
| **会话记忆注入** | 每轮 prompt 自动注入规则文件内容 | 🔴 高 |
| **动态记忆更新** | AI 在对话中发现项目规律后，主动写入记忆文件 | 🟡 中 |
| **Notepads** | 用户创建的持久化背景知识片段，可随时插入对话（类 Cursor Notepads）| 🟢 低 |

**DeepSeek 当前状态：** ❌ 无项目规则；每次对话从零开始

---

### 3.7 MCP 工具扩展体系

**需求描述：** 通过 Model Context Protocol（MCP）接入第三方工具服务器，无限扩展 AI 能力。

**关键功能：**

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **MCP 客户端** | 实现 MCP Client，连接本地/远程 MCP Server | 🟡 中 |
| **工具发现** | 动态获取 MCP Server 提供的工具列表 | 🟡 中 |
| **Browser MCP** | 通过 playwright-mcp 让 AI 操作网页 | 🟢 低 |
| **Database MCP** | AI 直接查询数据库（Postgres/SQLite）| 🟢 低 |
| **配置文件** | `.deepseek/mcp.json`（类 `.cursor/mcp.json`）| 🟡 中 |

**规范参考：** `modelcontextprotocol.io`

---

### 3.8 UI / 交互体验

**需求描述：** 界面设计符合 Copilot 标准，操作流畅，反馈及时。

**关键功能：**

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **动态 thinking box** | 实时显示 `Working: {detail}`，完成后 `Finished with N step(s)` | 🔴 高（F-1）|
| **文件 diff 内联显示** | 点击工具行查看 diff（+N -M 徽章）| ✅ 已实现 |
| **撤销/保留** | Keep / Undo 应用的每个文件变更 | ✅ 已实现 |
| **多轮对话界面** | 支持多轮 Q&A，历史上下滚动 | ✅ 已实现 |
| **文件引用（@file）** | 用户可 @file 手动添加上下文文件 | ✅ 已实现（preattach）|
| **模型选择器** | 状态栏/下拉选择 LLM Provider 和模型 | 🔴 高（新需求）|
| **Token / 费用显示** | 显示本次消耗 token 数和估算费用（API 模式）| ✅ 已实现（P4-2）|
| **思考过程显示** | 展示 R1 DeepThink / extended thinking 的推理过程 | ✅ 已实现 |
| **代码复制/插入** | 代码块一键复制、插入光标位置、在新文件中打开 | 🟡 中 |
| **对话导出** | 导出当前对话为 Markdown / JSON | 🟢 低 |

---

### 3.9 安全与权限体系

**需求描述：** 用户对 AI 的操作有完整控制权，防止意外破坏。

**关键功能：**

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **操作确认提示** | 删除文件、执行命令等危险操作需用户确认 | 🔴 高 |
| **终端命令审查** | AI 执行 shell 命令前显示命令内容，用户批准 | ✅ 已实现（P4-1）|
| **Hooks 机制** | PreToolUse 钩子可阻止/修改工具调用（类 Claude Code）| 🟡 中 |
| **只读模式** | 可配置仅允许 AI 读取，禁止写入 | 🟢 低 |
| **操作日志** | 记录所有 AI 文件操作，便于审计 | 🟢 低 |

---

### 3.10 测试与质量保证

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **测试生成** | 根据代码自动生成单元测试 | 🟡 中 |
| **测试运行集成** | 执行测试框架（Jest/pytest/cargo test），读取结果 | 🟡 中 |
| **错误自动修复循环** | 测试失败 → AI 分析 → 修复 → 重新测试 | 🟡 中 |
| **覆盖率分析** | 读取覆盖率报告，建议补充测试 | 🟢 低 |

---

## 四、DeepSeek 插件差距分析与优先级路线图

### 4.1 与顶级产品的核心差距

**差距一（🔴 阻断级）：无真正的 Agentic Loop**
- 当前：预分解任务 + 逐任务单轮调用，无跨轮上下文
- 影响：AI 无法动态应对执行中的意外情况，无法进行真正的探索性解决问题
- 对标：Copilot `_runLoop`、Cursor Composer、Claude Code 主循环

**差距二（🔴 阻断级）：无内联补全**
- 当前：仅侧边栏聊天，无 Ghost text 补全
- 影响：日常编码体验落后，不能替代 Copilot 基础功能
- 对标：Copilot Tab 补全、Cursor Tab

**差距三（🔴 阻断级）：无终端/构建集成**
- 当前：AI 无法执行命令、无法读取编译错误
- 影响：无法完成"修改 + 编译 + 修复错误"的自动化循环
- 对标：Claude Code bash 工具、Copilot run_in_terminal

**差距四（🔴 高优）：单一 LLM Provider**
- 当前：只能使用 DeepSeek 网页，不支持 API / 其他模型
- 影响：功能天花板（无 function calling）；用户无选择权
- 对标：Cursor 多模型选择器、Continue.dev Provider
- 优先级策略：🥇 DeepSeek 网页（默认保持）→ 🥈 DeepSeek API（有 API Key 时推荐）→ 🥉 其他模型（扩展支持）
- 详见：[LLM_PROVIDER_ARCHITECTURE.md](./LLM_PROVIDER_ARCHITECTURE.md)

**差距五（🟡 中优）：无代码库语义索引**
- 当前：手动 @file 添加上下文
- 影响：大型代码库使用体验差
- 对标：Copilot `@workspace`、Cursor `@codebase`

**差距六（🟡 中优）：无项目规则/记忆**
- 当前：每次对话从零开始
- 影响：用户需反复解释项目背景
- 对标：Claude Code CLAUDE.md、Cursor Rules、Copilot `.instructions.md`

---

### 4.2 完整优先级路线图

#### 🔴 P1 阶段（短期，1~4 周）

| 编号 | 功能 | 说明 | 文件 |
|------|------|------|------|
| **P1-1** | LLM Provider 抽象 + DeepSeek API 接入 | 解锁 function calling，降低启动延迟 | `llm/types.ts`, `llm/providers/` |
| **P1-2** | 模型选择器 UI | 状态栏下拉，切换 Provider | `extension.ts`, `webview.js` |
| **P1-3** | F-1 标题动态化 | thinking box 标题 Working→Finished | `webview.js` |
| **P1-4** | F-2 完成后停动画 | data-done 属性 | `webview.js` |
| **P1-5** | 项目规则文件支持 | 读取 `.deepseek/rules.md`，注入 prompt | `agent-loop.ts` |

#### 🔴 P2 阶段（中短期，1~2 月）

| 编号 | 功能 | 说明 | 文件 |
|------|------|------|------|
| **P2-1** | 多轮 Agent 循环 | `_runLoop` 架构，跨轮历史 | `agent-loop.ts` |
| **P2-2** | manage_todo_list + task_complete | AI 工具（DeepSeek API 模式启用） | `agent-loop.ts`, `webview.js` |
| **P2-3** | run_in_terminal 工具 | AI 执行 shell 命令 + 读取输出 | 新增 `tools/terminal.ts` |
| **P2-4** | get_errors 工具 | 对接 VS Code Diagnostics | 新增 `tools/diagnostics.ts` |
| **P2-5** | OpenAI 兼容 Provider | 支持 GPT-4o / Claude / Ollama | `llm/providers/openai-compatible.ts` |
| **P2-6** | Commit Message 生成 | Git diff → AI 生成 commit | 新增 `tools/git.ts` |

#### 🟡 P3 阶段（中期，2~3 月）

| 编号 | 功能 | 说明 |
|------|------|------|
| **P3-1** | 内联代码补全 | `InlineCompletionItemProvider` 注册 |
| **P3-2** | 代码库轻量索引 | 文件摘要 + 函数签名索引，`@workspace` 查询 |
| **P3-3** | Inline Chat（`Ctrl+I`）| 选中代码内联编辑 |
| **P3-4** | 测试生成与运行 | `/test` slash 命令 + 测试框架集成 |
| **P3-5** | MCP 客户端 | 基础 MCP 协议支持 |

#### 🟢 P4 阶段（长期，3~6 月）

| 编号 | 功能 | 说明 |
|------|------|------|
| **P4-1** | VS Code LM API Provider | Copilot 模型复用 |
| **P4-2** | Shadow Workspace | 预览改动后确认应用 |
| **P4-3** | 后台 Agent | 非阻塞长任务执行 |
| **P4-4** | PR 代码审查 | GitHub PR review 集成 |
| **P4-5** | 向量语义索引 | 全项目 embedding + 语义检索 |
| **P4-6** | 多 Agent 并行 | 复杂任务 spawn 子 Agent |

---

## 五、功能实现参考

### 5.1 内联补全注册

```typescript
// packages/vscode-extension/src/inline-completion.ts

export function registerInlineCompletion(ctx: vscode.ExtensionContext, router: ProviderRouter) {
  const provider = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },  // 所有文件类型
    {
      async provideInlineCompletionItems(document, position, context, token) {
        if (context.triggerKind !== vscode.InlineCompletionTriggerKind.Automatic) return;

        // 提取前后文（各 50 行）
        const prefix = document.getText(new vscode.Range(
          new vscode.Position(Math.max(0, position.line - 50), 0), position));
        const suffix = document.getText(new vscode.Range(position,
          new vscode.Position(Math.min(document.lineCount - 1, position.line + 10), 0)));

        // 调用 LLM（DeepSeek API 低延迟模式）
        let completion = '';
        await router.stream({
          messages: [{ role: 'user', content: `Complete the code:\n${prefix}<FILL>${suffix}` }],
          onDelta: d => completion += d,
          signal: token,
        });

        return [new vscode.InlineCompletionItem(completion)];
      }
    }
  );
  ctx.subscriptions.push(provider);
}
```

### 5.2 项目规则读取

```typescript
// packages/vscode-extension/src/project-rules.ts

export async function getProjectRules(): Promise<string> {
  const candidates = ['.deepseek/rules.md', 'DEEPSEEK.md', '.cursorrules', 'CLAUDE.md'];
  for (const candidate of candidates) {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, candidate);
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      return `\n\n<project_rules>\n${new TextDecoder().decode(content)}\n</project_rules>`;
    } catch { continue; }
  }
  return '';
}
```

### 5.3 终端工具

```typescript
// packages/vscode-extension/src/tools/terminal.ts

export async function runInTerminal(command: string, onDelta: (d: string) => void): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const terminal = vscode.window.createTerminal({ name: 'AI Task', hideFromUser: false });
    // 使用 shellIntegration API（VS Code 1.93+）获取输出
    terminal.show();
    terminal.sendText(command);
    // ... 监听 shellIntegration.onDidEndTerminalShellExecution
  });
}
```

---

## 六、竞品动态监控清单

> 每月检查以下产品的更新，及时同步重要新功能到 DeepSeek 插件需求。

| 产品 | 监控地址 | 关注重点 |
|------|---------|---------|
| GitHub Copilot | `github.blog/changelog` | Agent 工具新增、模型更新 |
| Cursor | `cursor.com/changelog` | Composer 改进、新 @ 提供者 |
| Claude Code | `docs.anthropic.com/en/release-notes` | 工具新增、MCP 进展 |
| Aider | `aider.chat/CHANGELOG.md` | 新模型支持、编辑格式改进 |
| Continue.dev | `github.com/continuedev/continue/releases` | 新 Provider、MCP 支持 |
| VS Code | `code.visualstudio.com/updates` | LM API 变化、新 Agent 基础设施 |

---

*本文档为 DeepSeek 插件功能规划的参照基线，应随竞品发展持续更新。*  
*每项需求实现后在路线图中标记 ✅ 和实现日期。*
