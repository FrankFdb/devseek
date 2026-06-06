# DeepSeek 插件 Investigate 模式设计报告

> 版本：v1.0  
> 日期：2026-05-18  
> 背景：用户发现 DeepSeek 插件在"为什么/排查/日志分析"类问题上远弱于 Copilot/Claude Code，无法主动探索项目信息

---

## 一、现状差距精确分析

### 1.1 当前架构（文件驱动 / 两阶段）

```
用户问题
  ↓
decomposeTask()   ← Architect: 必须产出 [{file, action}] 列表
  ↓
runAgentLoop()    ← Editor: 按文件列表逐一执行
  ↓
  analyze task → buildAnalyzePrompt() → 单次 LLM call（无工具迭代）
  modify task  → buildEditorPrompt()  → SEARCH/REPLACE + 最多1次重试
```

**致命问题**：  
- `decomposeTask` 是规划瓶颈：输入必须是"已知文件"，无法产出"先探索再决定"的计划  
- `analyze` 任务只有 `编译/运行` 关键词才进多轮工具循环；排查类问题走单轮，没有工具调用机会  
- `grep_search` 只搜索 workspace 内的 TypeScript/C++ 等代码文件，不支持日志文件/绝对路径

### 1.2 Copilot Agent 架构（工具驱动 / 连续循环）

参考：
- GitHub Next 博客 "How GitHub Copilot Edits works" (2024)  
- anthropic Model Spec 中关于 claude code 工具使用章节  
- VS Code 源码 `workbench.desktop.main.js` chat agent 相关片段  
- Claude Code 官方文档 "How Claude Code uses tools" (2025)

```
用户问题
  ↓
[无预规划] 直接进入工具循环
  Agent (System prompt): "你有以下工具：bash, read_file, grep, write_file..."
  ↓
Round 1: AI 输出工具调用 (bash: ls / find / grep ...)
Round 2: 工具结果 → AI 继续调用
Round N: AI 判断信息足够 → 输出最终答案
  ↓
prose 答案展示给用户
```

**Copilot 关键机制**：
1. **无预规划** — System prompt 直接给出工具列表，AI 自主决定调用顺序
2. **无轮次上限** — 循环直到 AI 判断"我已有足够信息"（或超时/用户终止）
3. **"thinking box" 与答案分离** — 工具调用过程在 Working box 显示，不污染主答案流  
4. **跨轮上下文累积** — 所有工具调用+结果都保留在 messages history 中，AI 随时可回顾

**Claude Code 关键机制**：
1. `bash` 工具无限制：任何 shell 命令都可执行，输出截断至 ~200KB  
2. **ReAct 模式**（Reason+Act）：每轮 AI 先输出"思考"（不可见），再输出工具调用  
3. **Agentic loop 不分析/修改阶段**：只有一个统一的 tool-use 循环  
4. **自动 compact**：上下文超过阈值时自动压缩历史，保留关键信息  

### 1.3 差距对比表

| 维度 | DeepSeek 当前 | Copilot/Claude Code | 差距影响 |
|------|-------------|---------------------|---------|
| 任务触发方式 | 预规划（需已知文件名）| 直接开始工具链 | 排查类问题直接失败 |
| 工具调用轮次 | analyze: 1轮；exec: 4轮 | 无上限（100+轮）| 深度调查时中途截止 |
| 工具输出可见性 | 注入主对话流（刷屏）| Working box 单行紧凑 | 用户体验极差 |
| grep 覆盖范围 | workspace 代码文件 only | 任意文件+绝对路径 | 无法搜日志文件 |
| 工具结果上下文 | 每任务独立，不保留 | 全程累积在 messages | AI 无法回顾之前发现 |
| 终止条件 | 工具调用后无新调用即停 | AI 调用 `task_complete` | 过早停止 |
| 问题意图分类 | modify/analyze/create 三类 | 单一 agentic 模式 | 缺少 investigate 分支 |

---

## 二、路由策略：Copilot/Claude Code 的真实做法 vs 当前误区

### 2.1 Copilot/Claude Code 根本不做意图识别

这是设计上最重要的一点。**Copilot 和 Claude Code 在 agent 内部完全没有 `INVESTIGATE_PATTERNS` 这样的 regex 路由层**。

**Copilot Agent 的实际路由机制**：

```
用户提交 prompt
  ↓
是否在 Copilot Edits 模式（有 Working Set）？
  ├── YES → 进入 agent loop，Working Set 文件作为初始上下文
  └── NO  → 进入 chat 模式，不调用工具

Working Set 内的 agent loop（无论 prompt 是"调查"还是"修改"）：
  System prompt 直接包含全部工具列表
  ↓
  LLM 第一轮输出 → 模型自己决定：调 grep 探索 or 直接输出 SEARCH/REPLACE
  ↓
  循环，直到模型停止调工具
```

**核心结论**：Copilot 的"路由"只有一个维度 —— **用户是否提供了 Working Set（目标文件）**。文字内容（问的是"为什么"还是"怎么修"）对路由没有任何影响。模型自主判断该探索还是该编辑。

**Claude Code 更极端**：

```
所有用户输入
  ↓
直接进入统一 tool-use 循环（无任何前置分类）
  System prompt: "你有 bash, read_file, write_file, grep... 工具，自行决定"
  ↓
Round 1: 如果需要探索 → 调 bash/grep；如果问题明确 → 直接回答或写代码
Round N: 直到模型输出无工具调用的最终文字
```

Claude Code 的 system prompt 中只有工具定义和行为约束，**没有任何"什么情况下调查 vs 什么情况下修改"的逻辑**。这些决策完全由 LLM 基于上下文自主判断。

---

### 2.2 正确推论：DeepSeek 插件的最优设计

既然路由不应该基于 prompt 内容的文字，那应该基于什么？

**答案：基于"是否有已知目标文件"**

| 状态 | 含义 | 最优处理 |
|------|------|---------|
| 用户附着了代码文件（.cpp/.ts/.py）| 目标明确，已知操作对象 | 进入现有 Architect+Editor 两阶段流程 |
| 用户附着了日志/数据文件（.log/.csv）| 证据文件，需要分析 | **进入统一工具循环**，不做预规划 |
| 用户未附着任何文件 | 目标未知，需先探索 | **进入统一工具循环**，让 LLM 自行发现文件 |

这与 Copilot 的逻辑完全一致：**有 Working Set（代码文件）→ 编辑模式；无 Working Set → 自由探索模式**。

**不再需要 `INVESTIGATE_PATTERNS`**。正确的判断是：

```typescript
// ✅ 正确：基于文件状态路由，不解析 prompt 文字
const hasCodeFiles = attachedFiles.some(f => /\.(cpp|c|h|hpp|ts|js|py|rs|go|java|cs)$/i.test(f));

if (hasCodeFiles) {
  // 现有流程：decomposeTask → runAgentLoop（Architect + Editor）
  await runExistingAgentLoop(prompt, attachedFiles, ...);
} else {
  // 新流程：直接进入统一工具循环（无预规划，类 Claude Code）
  await runAgenticLoop(prompt, attachedFiles, workspaceRoot, ...);
}
```

---

### 2.3 统一工具循环设计（runAgenticLoop）

#### 2.3.1 架构图

```
用户输入（无代码文件附加，或仅附加日志文件）
  ↓
runAgenticLoop() —— 类 Claude Code 单阶段 ReAct 循环
  │
  ├── System prompt: 所有工具定义 + 工作区路径 + "自行决定调用顺序"
  │
  ├── Round 1: LLM 自主选择
  │     ├── 探索型问题 → list_dir / grep_search / read_file / run_terminal
  │     └── 明确问题  → 直接给出回答（0 工具调用 → 循环立即结束）
  │
  ├── Round 2..N: 工具结果注入 messages history → LLM 继续
  │
  └── 终止条件（任一）：
        - LLM 本轮无工具调用（已给出最终答案）
        - LLM 调用 [TOOL:task_complete]
        - roundCount >= MAX_ROUNDS（硬停止，触发强制总结）
        - AbortSignal（用户点停止）
  ↓
最终答案 → 主 prose 气泡
工具活动  → Working box（紧凑行，不污染答案）
```

#### 2.3.2 System Prompt（最小约束，最大自主）

```typescript
function buildAgenticSystemPrompt(
  workspaceRoot: string,
  logFiles: string[],   // 附着的日志/数据文件
  mcpTools?: McpToolRef[],
): string {
  const logSection = logFiles.length > 0
    ? `\n【已附加文件】\n${logFiles.map(f => `- ${f}`).join('\n')}\n`
    : '';

  return `
你是一个拥有完整工具访问权限的编程智能体，运行在 VS Code 中。

【工作区根目录】${workspaceRoot}
${logSection}
【可用工具】

读取文件（代码文件、日志文件、配置文件，支持绝对路径）：
[TOOL:read_file {"path":"/absolute/path/to/any/file.log"}]
[TOOL:read_file {"path":"src/relative/path.cpp"}]

搜索文件内容（支持正则表达式，支持绝对路径，不限文件类型）：
[TOOL:grep_search {"pattern":"关键词|regex","path":"/any/dir/","isRegexp":true}]

列出目录（支持绝对路径）：
[TOOL:list_dir {"path":"/any/absolute/path/"}]

执行 shell 命令（最强大：grep/awk/find/cat/head/wc 等均可）：
[TOOL:run_terminal {"command":"grep -n 'error' /path/to/mc.log | tail -30"}]

标记完成并给出结论（每次对话最多调用一次）：
[TOOL:task_complete {"summary":"结论摘要"}]

【行为准则】
- 先思考"需要哪些信息"，再决定调用哪些工具
- 一轮内可调用多个工具（同时输出多个 [TOOL:...] 块）
- 工具结果会在下一轮作为上下文提供给你
- 信息足够时，停止工具调用，直接给出结论
- 结论需包含：证据（文件路径/行号/具体数值）
- 使用简体中文
`.trim();
}
```

#### 2.3.3 核心循环实现

```typescript
const MAX_AGENTIC_ROUNDS = 30;

export async function runAgenticLoop(
  userPrompt: string,
  attachedLogFiles: string[],   // .log/.csv 等非代码文件
  workspaceRoot: string,
  mode: 'fast' | 'r1' | undefined,
  callbacks: AgentLoopCallbacks,
): Promise<void> {

  const systemPrompt = buildAgenticSystemPrompt(
    workspaceRoot, attachedLogFiles, callbacks.mcpToolRefs
  );

  // 全程积累的 messages（类 Claude Code 的 conversation history）
  const messages: ChatMessage[] = [
    { role: 'user', content: systemPrompt + '\n\n' + userPrompt }
  ];

  let roundCount = 0;
  let totalChars = systemPrompt.length + userPrompt.length;

  await callbacks.onAgentStatus({
    type: 'agentStatus', phase: 'execute', taskId: 'agentic',
    taskFile: '', taskAction: 'analyze', taskIndex: 1, taskTotal: 1,
    state: 'started', title: 'Working...', detail: userPrompt.slice(0, 60),
  });

  while (roundCount < MAX_AGENTIC_ROUNDS) {
    if (callbacks.signal?.aborted) break;
    roundCount++;

    // 上下文过长时压缩（保留首条 + 最近 6 条）
    if (totalChars > 80000 && messages.length > 8) {
      const head = messages.slice(0, 1);
      const tail = messages.slice(-6);
      messages.splice(0, messages.length, ...head, ...tail);
    }

    const { text, tools } = await chatWithMessages(
      messages, mode,
      (delta) => {
        // 工具调用块静默（不推送给用户）；推理文字推送到 Working box
        const isToolBlock = /^\s*\[TOOL:/.test(delta);
        if (!isToolBlock) {
          callbacks.onDelta('\x00AFILE:agentic\x00' + delta);
        }
      },
      callbacks.signal,
      roundCount === 1,   // 第一轮才 newSession
    );

    messages.push({ role: 'assistant', content: text });
    totalChars += text.length;

    // 执行工具调用（静默模式：结果不流给用户，只注入 messages）
    const loopRes = await executeFakeToolsForLoop(tools, callbacks, true /* silentMode */);

    // 终止条件
    if (loopRes.taskComplete) break;
    if (!loopRes.toolCallsMade) break;  // AI 给出最终答案，无工具调用

    // 工具结果注入下一轮
    const feedback = `[工具结果 - Round ${roundCount}]\n${loopRes.feedbackForAI}`;
    messages.push({ role: 'user', content: feedback });
    totalChars += feedback.length;

    // 更新 Working box 状态行
    await callbacks.onAgentStatus({
      type: 'agentStatus', phase: 'execute', taskId: 'agentic',
      taskFile: `Round ${roundCount} · ${tools.length} tools`,
      taskAction: 'analyze', taskIndex: 1, taskTotal: 1,
      state: 'started', title: 'Working...',
    });
  }

  // 完成
  await callbacks.onAgentStatus({
    type: 'agentStatus', phase: 'done', taskId: 'agentic',
    taskFile: '', taskAction: 'analyze', taskIndex: 1, taskTotal: 1,
    state: 'completed', title: `Done (${roundCount} rounds)`,
  });
}
```

### 2.4 工具层必要修改（支持跨 workspace 文件）

#### 2.4.1 `onGrepSearch` — 移除 workspace 限制，改为安全黑名单

**当前代码**（extension.ts ~L1427，错误设计）：
```typescript
// ❌ 当前：白名单逻辑，拒绝所有 workspace 外路径
const rawDir = path ? nodePath.join(wsRoot.fsPath, path) : wsRoot.fsPath;
const searchDir = nodePath.resolve(rawDir);
if (!searchDir.startsWith(nodePath.resolve(wsRoot.fsPath))) {
  throw new Error('grep_search: path outside workspace');  // 日志文件被拒绝
}
const exts = ['ts','tsx','js','jsx','cpp','c','h','hpp','py','java','go','rs','cs'];
const includes = exts.map(e => `--include='*.${e}'`).join(' ');
// 只搜代码文件，日志 .log/.csv 被排除
```

**修改后**（黑名单逻辑 + 支持所有文件类型）：
```typescript
// ✅ 修改后：黑名单逻辑，只拒绝系统敏感目录
onGrepSearch: async (pattern: string, path?: string, isRegexp?: boolean) => {
  const { runCommand } = await import('./tools/terminal');
  let searchDir: string;
  if (path && nodePath.isAbsolute(path)) {
    searchDir = path;   // 支持绝对路径（日志文件目录）
  } else {
    searchDir = path ? nodePath.join(wsRoot.fsPath, path) : wsRoot.fsPath;
  }
  // 安全黑名单（系统目录）
  const FORBIDDEN = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/'];
  if (FORBIDDEN.some(f => searchDir.startsWith(f))) {
    throw new Error(`禁止搜索系统目录: ${searchDir}`);
  }
  const esc = pattern.replace(/'/g, "'\\''").slice(0, 200);
  const escDir = searchDir.replace(/'/g, "'\\''");
  // 不限文件类型（.log .csv .txt 均可搜索）
  const cmd = `grep -r -n -E '${esc}' '${escDir}' 2>/dev/null | head -80`;
  const result = await runCommand({ command: cmd, timeoutMs: 20000 });
  return result.stdout.slice(0, 6000) || '（无匹配结果）';
},
```

#### 2.4.2 `onReadFile` — 支持绝对路径

```typescript
// ✅ 修改后：绝对路径直接读，相对路径通过 workspace API
onReadFile: async (filePath: string) => {
  const MAX = 12000;
  if (nodePath.isAbsolute(filePath)) {
    const { readFile } = await import('fs/promises');
    const content = await readFile(filePath, 'utf-8').catch(e => {
      throw new Error(`读取失败 ${filePath}: ${e.message}`);
    });
    return content.slice(0, MAX);
  }
  const content = await readWorkspaceFile(filePath, []);
  if (!content) throw new Error(`找不到文件：${filePath}`);
  return content.slice(0, MAX);
},
```

#### 2.4.3 `executeFakeToolsForLoop` — 增加 `silentMode` 参数

当前所有工具结果都通过 `callbacks.onDelta()` 注入主对话流（刷屏）。增加 `silentMode=true` 时只注入 `messages`，不推送给用户：

```typescript
// 函数签名增加参数
async function executeFakeToolsForLoop(
  tools: FakeTool[],
  callbacks: AgentLoopCallbacks,
  silentMode = false,   // ← 新增，agentic loop 传 true
): Promise<ToolLoopResult>

// 在每个工具处理块中：
if (!silentMode) {
  callbacks.onDelta(`\n\n**[终端] $ \`${command}\`**\n\`\`\`\n${output}\n\`\`\`\n`);
}
parts.push(`[run_terminal: ${command}]\n${output.slice(0, 4000)}`);  // 硬截断
```  

---

## 三、用户界面信息分层

### 3.1 分层原则（对标 Copilot）

| 信息类型 | 在哪里显示 | 原因 |
|---------|-----------|------|
| AI 推理过程（"我在分析..."）| Working box 内容区（streaming）| 让用户感知 AI 在做什么 |
| 工具调用摘要（"Read X · Searched Y"）| Working box 紧凑一行 | 进度感知，不刷屏 |
| 工具原始输出（grep 结果、awk 输出）| **不显示**（只注入 messages） | 避免几千行输出刷屏 |
| 最终结论 | 主 prose 气泡 | 用户真正需要的答案 |
| 完成状态 | "Done (N rounds)" 折叠行 | 让用户知道调查深度 |

> **与现有 agent 模式的关键区别**：现有 `run_terminal` / `grep_search` / `read_file` 工具结果
> 通过 `callbacks.onDelta()` 直接推送到主对话气泡（刷屏）。`runAgenticLoop` 中
> `silentMode=true` 使工具结果只进 `messages history`，不触发 `onDelta`。

### 3.2 Working box 效果

```
┌─ Working... ─────────────────────────────────────────────┐
│                                                           │
│  我来查找 cmdmotorspeed 降为零的原因。先从源码入手...      │  ← AI 推理流
│                                                           │
│  ✦ Searched "cmdmotorspeed" in src/oam/                  │  ← 工具活动行
│  ✦ Read spray_pre_rotate_controller.hpp                  │
│  ✦ Ran: grep -n "uav_flying" /path/mc.log | head -30     │
│                                                           │
│  在日志中发现高度值为 0.93m，低于 1.0m 阈值...           │  ← AI 继续推理
│                                                           │
│  ● Round 4/30                                            │  ← 底部状态行
└──────────────────────────────────────────────────────────┘
```

### 3.3 最终答案（完全分离，不含工具调用过程）

```
**根本原因**：`getUavFlying()` 使用 1.0m 高度阈值，但换行飞行时
实际高度为 0.93m，触发"未飞行"判断，导致 `cmdmotorspeed → 0`。

**证据**：
- `spray_pre_rotate_controller.hpp:L47`：`if (alt < 1.0f) return false;`
- `mcmjob_147.csv row=3131`：`alt=0.93, pwm→900`
- `mc.log:16:37:09.989`：`uav_flying=0`
```

---

## 四、入口路由（extension.ts 改动）

### 4.1 路由逻辑

```typescript
// extension.ts — 在现有 decomposeTask 调用之前插入
const hasCodeFiles = effectiveFiles.some(
  f => /\.(cpp|c|h|hpp|ts|js|py|rs|go|java|cs|tsx|jsx)$/i.test(f)
);

if (!hasCodeFiles) {
  // 无代码文件 → 统一工具循环（类 Copilot 无 Working Set 时的 free explore）
  const logFiles = effectiveFiles.filter(
    f => /\.(log|csv|txt|json|yaml|yml)$/i.test(f)
  );
  await runAgenticLoop(prompt, logFiles, wsRoot.fsPath, mode, {
    ...agentCallbacks,
    // agentic loop 需要支持绝对路径的工具实现（见下文）
  });
  webview.postMessage({ type: 'endResponse' });
  return;
}

// 有代码文件 → 现有 Architect+Editor 流程（不变）
const decomposeResult = await decomposeTask(...);
const loopResult = await runAgentLoop(...);
```

### 4.2 为 agentic loop 提供增强版工具

```typescript
// onGrepSearch：黑名单安全策略（移除 workspace 白名单限制）
onGrepSearch: async (pattern, path, isRegexp) => {
  if (path && nodePath.isAbsolute(path)) {
    const FORBIDDEN = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/'];
    if (FORBIDDEN.some(f => path.startsWith(f))) throw new Error('禁止搜索系统目录');
    // 直接搜索绝对路径，不限文件类型
    const esc = pattern.replace(/'/g, "'\\''").slice(0, 200);
    const cmd = `grep -r -n -E '${esc}' '${path.replace(/'/g, "'\\''")}' 2>/dev/null | head -80`;
    const result = await runCommand({ command: cmd, timeoutMs: 20000 });
    return result.stdout.slice(0, 6000) || '（无匹配结果）';
  }
  // 相对路径：原有逻辑
  return existingOnGrepSearch(pattern, path, isRegexp);
},

// onReadFile：支持绝对路径
onReadFile: async (filePath) => {
  if (nodePath.isAbsolute(filePath)) {
    const { readFile } = await import('fs/promises');
    return (await readFile(filePath, 'utf-8')).slice(0, 12000);
  }
  return existingOnReadFile(filePath);
},
```

---

## 五、风险与安全

| 风险 | 程度 | 对策 |
|------|------|------|
| 循环无法终止 | 中 | 硬限制 `MAX_AGENTIC_ROUNDS=30`，超出后直接 `break` |
| 工具输出超大（日志 MB 级）| 高 | `read_file` 截 12000 字，`run_terminal` 截 4000 字；注明"已截断" |
| 绝对路径安全 | 中 | 黑名单：`/etc/ /proc/ /sys/ /dev/ /boot/` |
| API 上下文窗口溢出 | 高 | 超 80K 字符时保留 head(1) + tail(6) 条 messages |
| agentic 模式误触发（用户想改代码）| 低 | 路由条件是"文件类型"，附着代码文件即走编辑模式 |
| run_terminal 写文件 | 中 | agentic loop 的 `onTerminalCommand` 拦截写操作命令 |

```typescript
// agentic 模式 onTerminalCommand 安全包装（只读操作）
const agenticTerminal = async (command: string, workdir?: string) => {
  const WRITE_OPS = /\b(rm|mv|cp|mkdir|touch|chmod|chown|dd|tee)\b|>\s*\w|>>/;
  if (WRITE_OPS.test(command)) {
    return `（agentic 只读模式：此命令涉及写操作，已跳过：${command}）`;
  }
  return callbacks.onTerminalCommand!(command, workdir);
};
```

---

## 六、实施路线图

### 阶段一（P0，1-2天）：最小可行版

**目标**：无代码文件时问题直接进 agentic 工具循环

**改动**：
1. `src/agent-loop.ts` — 新增 `runAgenticLoop()` + `buildAgenticSystemPrompt()`（~150行）
2. `src/agent-loop.ts` — `executeFakeToolsForLoop` 增加 `silentMode` 参数（~10行）
3. `src/extension.ts` — 路由判断 + 增强版工具回调（~60行）

**不改动**：`decomposeTask`、`runAgentLoop`、现有 analyze/modify 流程

**验收**：用户问"为什么 cmdmotorspeed 变0"（不附着代码文件）→ AI 自动 grep 10-20 轮 → 有证据的结论

### 阶段二（P1，3-5天）：完善工具与 UI

**目标**：Working box 展示更完整，工具更健壮

**改动**：
1. Working box 实时显示 AI 推理文字（streaming 到 `\x00AFILE:agentic\x00` 频道）
2. "Round N/30" 状态行更新
3. `grep_search` 对代码文件也可搜索绝对路径（现有编辑模式同样受益）

### 阶段三（P2，一周）：上下文智能压缩

**目标**：支持超过 30 轮的深度调查

**改动**：
1. `compactMessages()`：保留 head+tail，中间轮次只保留工具名+关键行（去掉大块输出）
2. Working box 显示 token 用量估算

---

## 七、对标结论

| 能力 | Copilot | Claude Code | DeepSeek P0后 | DeepSeek P2后 |
|------|---------|-------------|--------------|--------------|
| 无预规划直接工具循环 | ✅ | ✅ | ✅ | ✅ |
| 工具不污染主答案流 | ✅ | ✅ | ✅ | ✅ |
| 绝对路径/日志文件 | ✅ | ✅ | ✅ | ✅ |
| 路由基于文件非 regex | ✅ | ✅（无路由）| ✅ | ✅ |
| 上下文全程积累 | ✅ | ✅ | ✅ | ✅ |
| 上下文智能压缩 | ✅ | ✅ | ❌ | ✅ |
| 并行工具调用 | ✅ | ✅ | ❌ | ✅ |
| 轮次上限 | 无限 | 无限 | 30轮 | 30轮+ |

**最大改进**：从"必须预知文件名才能工作" → "无文件也能自主探索"，对标 Copilot 的 Working Set 为空时的行为。

---

## 附录 A：必改文件清单

| 文件 | 改动 | 预计行数 |
|------|------|---------|
| `src/agent-loop.ts` | 新增 `runAgenticLoop()` + `buildAgenticSystemPrompt()`；`executeFakeToolsForLoop` 增 `silentMode` | +160 行 |
| `src/extension.ts` | 入口路由；增强版 `onGrepSearch`/`onReadFile`；agentic 安全包装 | +70 行 |

**总计约 230 行新增，现有 modify/analyze 流程零改动。**

---

## 附录 B：参考来源

1. GitHub Copilot Edits 技术博客（2024）  
   https://github.blog/ai-and-ml/github-copilot/how-github-copilot-edits-works/

2. Anthropic Claude Code 文档 - How Claude Code uses tools  
   https://docs.anthropic.com/claude/docs/tool-use

3. Anthropic Model Spec（tool-first, ReAct 推理）  
   https://www.anthropic.com/claude/model-spec

4. OpenAI Assistants API — parallel_tool_calls  
   https://platform.openai.com/docs/assistants/tools

---

> 版本：v2.0（修订）  
> 修订说明：移除 `INVESTIGATE_PATTERNS` regex 路由方案（与 Copilot/Claude Code 实际机制不符），
> 改为基于"是否附着代码文件"的结构化路由，与 Copilot Working Set 逻辑对齐。

*备份路径：backups/v1.14-2026-05-18-111304/*

---

## 八、全面架构审计 — 预设路径问题精确列表

> **审计范围**：`agent-loop.ts`、`agent-task-decomposer.ts`、`extension.ts`、`intent-router.ts`  
> **已在 §2/§4 详述** 的问题（路由策略、grep/read工具限制、工具输出污染）在本节仅做引用。  
> **本节新增**：在之前报告中未详细记录的 13 个独立预设路径问题。

### 8.0 完整问题汇总表

| ID | 文件 | 代码位置 | 问题摘要 | 严重度 | 已覆盖 |
|----|------|---------|---------|--------|--------|
| G-route | intent-router.ts + extension.ts | `shouldUseAgentMode()` | 路由基于文件类型（正确），但仍缺 investigate 分支 | P0 | §2.2 |
| G-grep | extension.ts | `onGrepSearch` L1427 | workspace 白名单 + 代码文件扩展名过滤 | P0 | §2.4.1 |
| G-read | extension.ts | `onReadFile` L1421 | 8000 字符硬截断 | P0 | §2.4.2 |
| G-silent | agent-loop.ts | `executeFakeToolsForLoop` L282 | 工具输出注入主对话流（刷屏） | P0 | §2.4.3 |
| **G1** | agent-task-decomposer.ts | L6 | `AgentTaskAction` 5个固定值，无 `explore`/`investigate` | P1 | ❌ |
| **G2** | agent-task-decomposer.ts | L141 | Architect 每个文件只读 **150行**（非400行）| P0 | ❌ |
| **G3** | agent-loop.ts | `buildAnalyzePrompt` L573 | analyze/explain 任务提示词**不含任何工具定义**——AI 无法调用工具 | P0 | ❌ |
| **G4** | agent-loop.ts | `executeTask` L1014 | 多轮工具循环被正则关键词门控（仅 compile/run 才用多轮）| P0 | ❌ |
| **G5** | agent-loop.ts | L1022 | `MAX_EXEC_ROUNDS=4` 硬编码——即使 exec 任务 4 轮后强制停止 | P1 | ❌ |
| **G6** | agent-loop.ts | L1500 | `allReadOnly` 快捷路径：全分析任务直接跳过工具循环 | P1 | ❌ |
| **G7** | agent-loop.ts | L1559 | `sessionHistory` cap=20，激进 splice，跨任务上下文丢失 | P2 | ❌ |
| **G8** | agent-loop.ts | `buildToolsSuffix` L126 | Workflow hints 基于任务位置（first/middle/last），AI被外部协调 | P2 | ❌ |
| **G9** | extension.ts | `onListDir` L1445 | 只用 `vscode.workspace.fs` API，不支持 workspace 外绝对路径 | P1 | ❌ |
| **G10** | extension.ts | `onTerminalCommand` | 非 autopilot 模式：60秒无响应自动拒绝，工具调用沉默失败 | P1 | ❌ |
| **G11** | agent-task-decomposer.ts | `inferTasksFromFiles` | Fallback 用正则决定 action 类型（modify vs analyze）| P2 | ❌ |
| **G12** | agent-loop.ts | `executeFakeToolsForLoop` | 工具串行执行（`for...of`），无并行 | P2 | ❌ |
| **G13** | intent-router.ts | `decideChatIntent` | 意图打分用 9 个 regex，`ChatIntentKind` 只有2类——缺 explore/investigate | P1 | ❌ |

---

### 8.1 [G1] `AgentTaskAction` 静态枚举——任务类型被预先固定

**问题代码**（`agent-task-decomposer.ts` L6）：

```typescript
export type AgentTaskAction = 'modify' | 'analyze' | 'create' | 'delete' | 'explain';
// ← 5 个固定字面量，无 'explore'、'investigate'、'search'
```

**预设路径本质**：Architect 在 LLM 输出任务计划之前，AI 必须声明每个任务是哪种动作。这意味着"先探索，再决定怎么做"无法被表达——JSON 格式在构建系统提示时就已要求输出 `action` 字段。

**Copilot/Claude Code 对标**：
- Copilot：Working Set 内的所有操作都是同一个 tool-use 循环，模型自己选工具（read/grep/edit），没有外部动作类型约束。
- Claude Code：只有 bash/read/write 工具，**没有** `action` 这个概念层。AI 自主决定"用 bash 探索还是直接写文件"。

**修复方向**：
```typescript
// ✅ 增加 'explore' 类型，允许 Architect 产出探索性首任务
export type AgentTaskAction = 'modify' | 'analyze' | 'create' | 'delete' | 'explain' | 'explore';

// Architect prompt 中增加规则：
// "若需要先探索目录结构再决定修改计划，可输出 action=explore，
//  desc 写明用 list_dir/grep_search 发现哪些文件，
//  Editor 会先执行工具调用，再将结果传回 Architect 做二次规划。"
```

---

### 8.2 [G2] Architect 每文件只读 150 行

**问题代码**（`agent-task-decomposer.ts` L141）：

```typescript
const content = readFileContentSafe(absPath, 150);  // ← 硬编码 150 行
// 注释说 "Architect only needs 150 lines to plan"
```

**预设路径本质**：人为假设"150行就够规划用"，但实际上：
- 一个 C++ 实现文件通常 300-800 行，150 行只看到头部声明，看不到函数实现
- Architect 据此输出"修改 pump_adjust.cpp 第52行"——但根本没读到第52行
- 导致 Editor 收到错误的 `desc` 指令，无从下手

**Copilot/Claude Code 对标**：
- Copilot：Working Set 内所有文件**完整内容**传给模型——Copilot 的上下文窗口就是用来装这些的。
- Claude Code：用 `read_file` 工具，模型自主决定读到第几行（bash 的 `head -n 300` 或完整 `cat`）。

**修复方向**：
```typescript
// ✅ Architect 读 400 行（已有 READ_MAX_LINES=400 常量，直接用）
const content = readFileContentSafe(absPath, READ_MAX_LINES);  // 400 行

// 或：对小文件（<300行）完整读取，大文件读400行
const content = readFileContentSafe(absPath, Math.max(READ_MAX_LINES, 300));
```

---

### 8.3 [G3] `buildAnalyzePrompt` 不含工具定义——分析 AI 无法调工具

**问题代码**（`agent-loop.ts` L573-637）：

```typescript
function buildAnalyzePrompt(userPrompt, task, currentContent, workdirOverride) {
  // ... 构建分析提示词
  // ❌ 注意：整个函数中没有任何 buildToolsSuffix() 调用
  return [
    `你是代码分析智能体，请分析文件 ${basename}。`,
    contentSection,
    execSection,  // ← 仅 compile/run 任务才有工具调用格式提示
    `【要求】`,
    // ...
  ].join('\n');
}
```

**对比 `buildEditorPrompt`**（同文件 L727）：
```typescript
function buildEditorPrompt(userPrompt, task, currentContent, taskIndex, taskTotal, ...) {
  return [
    // ...
    buildToolsSuffix(taskIndex, taskTotal, mcpTools, workdir),  // ← Editor 有工具定义
  ].join('\n');
}
```

**预设路径本质**：
- **"分析"和"修改"被预先区分为不同能力等级**。
- analyze 任务的 AI 在系统提示里看不到 `read_file`、`grep_search`、`list_dir` 的格式，因此即使想用也不知道调用语法。
- 结果：analyze 任务只能给出"纸上分析"，无法主动读取其他相关文件。

**Copilot/Claude Code 对标**：
- 所有轮次的系统提示都包含完整工具列表。**没有"只分析不调工具"的限制**。
- Claude Code 的系统提示从不变化（总是包含 bash/read/write/grep），AI 在"分析"阶段同样可以 `read_file` 相关文件。

**修复（直接在 `buildAnalyzePrompt` 末尾追加工具 suffix）**：

```typescript
function buildAnalyzePrompt(userPrompt, task, currentContent, workdirOverride, taskIndex = 1, taskTotal = 1, mcpTools?) {
  // ... 现有内容不变 ...
  return [
    // ... 现有内容 ...
    buildToolsSuffix(taskIndex, taskTotal, mcpTools, taskDir),  // ← 新增：让分析 AI 也能调工具
  ].join('\n');
}
```

---

### 8.4 [G4] 多轮工具循环被关键词正则门控

**问题代码**（`agent-loop.ts` L1014–1018）：

```typescript
const isExecTask = /编译|运行|执行|compile|build|run\b|execute/i.test(task.desc + userPrompt);
// ↑ 只有这 7 个关键词才触发多轮工具循环

if (isExecTask) {
  // 多轮 mini-loop（MAX_EXEC_ROUNDS=4）
} else {
  // chatViaProvider() ← 单次 LLM call，没有工具迭代机会
}
```

**预设路径本质**：
- "分析一个 bug"、"查看文件 X 的逻辑"这类排查请求，因为没有"compile/run"关键词，直接走单次 LLM call。
- AI 的第一个回复如果包含工具调用（`[TOOL:read_file ...]`），**这些工具调用会被静默忽略**——没有 `executeFakeToolsForLoop` 来处理它们。
- AI 只能凭 buildAnalyzePrompt 注入的静态内容给出回答。

**Copilot/Claude Code 对标**：
- **无 `isExecTask` 判断**。所有任务都进同一个 while 循环，AI 自主决定是否继续调工具。
- 终止条件只有两个：AI 停止输出工具调用（内容充足），或用户终止。

**修复（移除关键词门控，所有 analyze 任务进工具循环）**：

```typescript
// ✅ 移除 isExecTask 分支，所有 analyze/explain 任务都进多轮循环
if (task.action === 'analyze' || task.action === 'explain') {
  const analyzePrompt = buildAnalyzePrompt(userPrompt, task, currentContent, analyzeWorkdir, taskIndex, tasks.length, mcpTools);
  const MAX_ANALYZE_ROUNDS = 8;  // analyze 任务上限略低于 exec
  const execMessages: ChatMessage[] = [...(history ?? []), { role: 'user', content: analyzePrompt }];
  for (let r = 0; r < MAX_ANALYZE_ROUNDS; r++) {
    const { text, tools } = await chatWithMessages(execMessages, mode, onDelta, signal, consumeNewSession());
    execMessages.push({ role: 'assistant', content: text });
    const loopRes = await executeFakeToolsForLoop(tools, callbacks);
    if (loopRes.taskComplete || !loopRes.toolCallsMade) break;
    execMessages.push({ role: 'user', content: `[工具执行结果]\n${loopRes.feedbackForAI}\n\n请继续。` });
  }
}
```

---

### 8.5 [G5] `MAX_EXEC_ROUNDS = 4` 硬编码

**问题代码**（`agent-loop.ts` L1022）：

```typescript
const MAX_EXEC_ROUNDS = 4;  // ← 即使对于"编译→报错→修复→再编译→运行"流程也只有4轮
for (let r = 0; r < MAX_EXEC_ROUNDS; r++) { ... }
```

**预设路径本质**：典型的 C++ 编译→修复循环可能需要：
1. 编译 → 报错（1轮）
2. AI 分析错误，grep 源码（2轮）
3. 修复并再编译（3轮）
4. 链接报错（4轮）→**循环退出，修复未完成**

**Copilot/Claude Code 对标**：
- Copilot：执行任务无固定轮次上限，用户可随时点 Stop，否则持续循环。
- Claude Code：bash 工具链可以运行任意复杂的 shell pipeline，没有轮次概念。

**修复**：
```typescript
// ✅ 区分任务类型的上限（而不是统一的硬编码）
const MAX_EXEC_ROUNDS = 12;   // exec 任务：允许多轮编译→修复循环
const MAX_ANALYZE_ROUNDS = 8;  // analyze 任务：够用
// 真正的停止条件依赖 AI 不再调工具 + task_complete
```

---

### 8.6 [G6] `allReadOnly` 快捷路径——全分析任务完全绕过工具循环

**问题代码**（`agent-loop.ts` L1500–1522）：

```typescript
const allReadOnly = tasks.length > 0 && tasks.every(t => isReadOnlyAction(t.action));
const hasExecIntent = /编译|运行|执行|compile|build|run\b|execute/i.test(userPrompt + ' ' + tasks.map(...));

if (allReadOnly && !hasExecIntent) {
  // ← 直接走 executeAnalysisConsolidated()，完全跳过工具循环
  const analysisText = await executeAnalysisConsolidated(tasks, userPrompt, mode, callbacks, [], false);
  return { ... };  // 提前 return，不进 for (const task of tasks) 循环
}
```

**预设路径本质**：
- 当所有任务都是 analyze/explain 时，系统直接把所有文件内容拼成一个超大提示词，单次调用 LLM。
- **这意味着 AI 没有机会调用工具来读取额外文件、查找相关代码、执行命令**。
- 这是"效率优化"压过了"AI 自主性"的典型预设路径决策。

**Copilot/Claude Code 对标**：
- 没有"全分析快捷路径"。每次都是完整工具循环，AI 如果发现提供的文件内容不够，可以自己 grep 更多文件。

**修复方向**：
```typescript
// 方案一：去掉 allReadOnly 快捷路径，让 analyze 任务也进工具循环（推荐）
// 方案二：保留快捷路径，但在 executeAnalysisConsolidated 内部也提供工具定义
//         让 AI 第一轮可以决定是直接分析还是先 grep
```

---

### 8.7 [G7] `sessionHistory` cap=20，激进 splice

**问题代码**（`agent-loop.ts` L1554–1561）：

```typescript
if (sessionHistory.length >= 20) {
  sessionHistory.splice(2, 2);  // 删除第 2~3 条（最旧的非锚点对）
}
```

**预设路径本质**：
- 以固定的"条目数"而不是"token 数"来管理上下文——20 条任务摘要可能只有5千token，也可能有50千token，不一致。
- `splice(2,2)` 总是删两条（一对 user/assistant），可能在中途删掉关键的"文件创建"记录，导致后续任务找不到之前创建的文件路径。

**Copilot/Claude Code 对标**：
- Claude Code：基于 token 数触发自动 compact（运行一个"总结之前对话"的 LLM call），并非简单截断。
- Copilot：使用 VS Code 内置的对话上下文 API，由平台管理 token 预算。

**修复方向**：
```typescript
// ✅ 基于字符数而非条目数
const MAX_SESSION_CHARS = 40000;
const totalChars = sessionHistory.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
if (totalChars > MAX_SESSION_CHARS && sessionHistory.length >= 6) {
  sessionHistory.splice(2, 2);  // 只在真正超出 token 预算时才裁剪
}
```

---

### 8.8 [G8] Workflow hints 基于任务位置（first/middle/last）

**问题代码**（`agent-loop.ts` `buildToolsSuffix` L126–165）：

```typescript
function buildToolsSuffix(taskIndex, taskTotal, ...) {
  const isFirst = taskIndex === 1;
  const isLast  = taskIndex === taskTotal;
  const isSingle = taskTotal === 1;

  const workflowHint = isSingle
    ? `【任务工作流】这是唯一的任务（1/1）。调用 manage_todo_list → 修改文件 → 调用 task_complete`
    : isFirst
    ? `【任务工作流（第 ${taskIndex}/${taskTotal} 个任务）】... 不要调用 task_complete，后续任务会继续`
    : isLast
    ? `【任务工作流（第 ${taskIndex}/${taskTotal} 个任务，最后一步）】... 最后必须调用 task_complete`
    : `【任务工作流（第 ${taskIndex}/${taskTotal} 个任务）】... 不要调用 task_complete，等待后续任务`;
  // ...
}
```

**预设路径本质**：
- 外部逻辑（`buildToolsSuffix`）控制 AI 的工作流程编排（什么时候调 `task_complete`、什么时候不调）。
- 这是把"多任务协调"的决策从 AI 手中夺走，用固定脚本来控制。
- 实际副作用：如果 Architect 输出了 3个任务，但第2个任务完成后 AI 发现问题已经解决，它无法提前 `task_complete`——因为 hint 明确说"不要调用 task_complete，等待后续任务"。

**Copilot/Claude Code 对标**：
- Claude Code：只有一个系统提示，AI 自己管理任务状态（用自己的 todo list 工具，不由外部注入）。
- **外部不干预"何时完成"的决定**——AI 基于当前上下文判断。

**修复方向**（简化 hint，只描述工具用途，不指令编排）：
```typescript
// ✅ 移除位置性指令，改为能力描述性 hint
const workflowHint = `
【任务完成信号】
- 完成所有修改后，调用 task_complete 工具，说明做了什么。
- 如果有多个文件需要修改，逐一修改完后再调用 task_complete（一次即可）。
- 过程中可用 manage_todo_list 跟踪进度（可选）。
`.trim();
// 去掉"第N/M个任务"、"不要调 task_complete"等外部编排指令
```

---

### 8.9 [G9] `onListDir` 只支持 workspace 相对路径

**问题代码**（`extension.ts` `onListDir`）：

```typescript
const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(target));
// target 是通过 path.join(wsRoot.fsPath, listPath) 构建的
// ← 即使 AI 传入绝对路径，也被忽略或拼到 workspace 根下
```

**预设路径本质**：`vscode.workspace.fs` API 沙箱化地只看 workspace 内容。如果 AI 想 `list_dir /home/ff/logs/` 来查找日志文件，这个调用会静默失败或返回空结果。

**Copilot/Claude Code 对标**：
- Claude Code 的 bash 工具：`ls /any/path/` 没有任何限制。
- 根据 `onReadFile` 已有绝对路径支持的准则（§2.4.2），`onListDir` 也应支持。

**修复**：
```typescript
onListDir: async (listPath: string) => {
  let target: string;
  if (nodePath.isAbsolute(listPath)) {
    target = listPath;
    // 安全检查：禁止系统目录
    const FORBIDDEN = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/'];
    if (FORBIDDEN.some(f => target.startsWith(f))) throw new Error(`禁止列出系统目录: ${target}`);
  } else {
    target = nodePath.join(wsRoot.fsPath, listPath);
  }
  const { readdirSync, statSync } = require('fs');
  try {
    return readdirSync(target).map((name: string) => {
      const full = nodePath.join(target, name);
      try { return statSync(full).isDirectory() ? name + '/' : name; } catch { return name; }
    }).join('\n');
  } catch (e) {
    throw new Error(`list_dir 失败: ${(e as Error).message}`);
  }
},
```

---

### 8.10 [G10] `onTerminalCommand` 非 autopilot 时 60 秒自动拒绝

**问题代码**（`extension.ts` `onTerminalCommand` 内部）：

```typescript
// 需要用户确认模式（非 autopilot）
return new Promise((resolve) => {
  // 发送确认弹窗给 webview，等待用户点击
  webview.postMessage({ type: 'confirmCommand', command });
  const timer = setTimeout(() => resolve({ allow: false }), 60000);  // 60s 超时 → 自动拒绝
  pendingCommandConfirm = { resolve, timer };
});
```

**预设路径本质**：
- 当模型在工具循环中调用 `run_terminal`，用户没有在 60 秒内点确认时，工具返回**拒绝**——AI 不知道命令没执行，可能继续按照假设执行了命令的前提推进，导致逻辑错误。
- 这是把"用户确认"变成了"工具失败"的隐藏路径。

**Copilot/Claude Code 对标**：
- Copilot：有明确的 autopilot/trust policy 设置，默认 autopilot 可以直接执行指定范围内的命令。
- Claude Code：默认 autopilot（在用户初始化时设置权限边界），超出边界的命令才询问。

**修复方向**：
```typescript
// ✅ 超时时返回明确错误说明（而不是静默拒绝）
const timer = setTimeout(() => {
  resolve({
    allow: false,
    reason: '用户未在 60 秒内确认，命令未执行。如需自动允许，请在设置中开启 autopilot 模式。',
  });
}, 60000);

// 且在 executeFakeToolsForLoop 中处理 allow=false 的反馈：
if (!allow) {
  parts.push(`[run_terminal: ${command}]\n⚠️ 命令被拒绝（${reason}）。如需继续，请说明为何需要执行此命令。`);
}
// 而不是在工具结果中产生误导性的空输出
```

---

### 8.11 [G11] `inferTasksFromFiles` fallback 用正则决定 action

**问题代码**（`agent-task-decomposer.ts` `inferTasksFromFiles`）：

```typescript
export function inferTasksFromFiles(attachedFiles, userPrompt) {
  const isModifyIntent = /(修改|修正|优化|修复|重构|更新|完善|改进|implement|fix|update|refactor|optimi[sz]e)/i.test(userPrompt);
  const action: AgentTaskAction = isModifyIntent ? 'modify' : 'analyze';
  // ← 所有文件统一分配同一个 action，基于正则打分
```

**预设路径本质**：fallback 路径（LLM 规划失败时）用关键词正则来决定所有文件的操作类型。一旦 JSON 解析失败，所有任务都变成 `modify` 或 `analyze` 这个非此即彼的选择，无法区分"某个文件要修改，某个要分析"的混合意图。

**修复方向**：由于这是 fallback，可以统一用 `analyze`（最安全），让 Editor 再根据文件内容和用户 prompt 决定实际操作，而不是强行猜修改还是分析。

---

### 8.12 [G12] 工具串行执行（`for...of` 无并行）

**问题代码**（`agent-loop.ts` `executeFakeToolsForLoop` L229）：

```typescript
for (const tool of tools) {
  // 每个工具等上一个执行完才开始
  if (tool.name === 'run_terminal') { ... }
  else if (tool.name === 'read_file') { ... }
  else if (tool.name === 'grep_search') { ... }
}
```

**预设路径本质**：当 AI 在一轮内输出 3 个 `read_file` 调用时（`[TOOL:read_file {"path":"A.cpp"}]`、`[TOOL:read_file {"path":"B.cpp"}]`、`[TOOL:read_file {"path":"C.cpp"}]`），这 3 个本可以并发执行的读操作被串行化了。

**Copilot/Claude Code 对标**：
- OpenAI Assistants API：支持 `parallel_tool_calls`，多个工具同时执行。
- Claude Code：bash 命令天然可以并行（`cat A & cat B & cat C &`），或模型自己合并成一个 `bash` 调用。

**修复（只读工具并行化）**：

```typescript
// ✅ 只读工具并行执行
const readOnlyTools = tools.filter(t => t.name === 'read_file' || t.name === 'grep_search' || t.name === 'list_dir');
const writeTools = tools.filter(t => t.name !== 'read_file' && t.name !== 'grep_search' && t.name !== 'list_dir');

// 并行执行只读工具
const readResults = await Promise.all(readOnlyTools.map(tool => executeOneTool(tool, callbacks, silentMode)));

// 串行执行写/危险工具
for (const tool of writeTools) { await executeOneTool(tool, callbacks, silentMode); }
```

---

### 8.13 [G13] `decideChatIntent` regex 打分——意图路由仍是预设路径

**问题代码**（`intent-router.ts` `decideChatIntent` L30–120）：

```typescript
const META_DISCUSSION_RE = /(插件|流程|策略|检讨|对策|方案|是否|怎么|为何|原理|说明|比较|区别|总结|评审|架构)/i;
const EXPLAIN_ONLY_RE = /(解释|讲解|说明|为什么|原理|区别|比较|总结|介绍|评估|讨论)/i;
// ... 共 9 个 regex 规则 ...

// 打分决策
const codeChange = blockers.length === 0 && score >= 3;
return { kind: codeChange ? 'code-change' : 'chat' };
// ChatIntentKind = 'chat' | 'code-change'  ← 只有2种
```

**预设路径本质**：
1. 9 个 regex 互相覆盖，边界情况多（"解释一下编译错误"命中 EXPLAIN_ONLY_RE，但用户其实想修复）
2. `ChatIntentKind` 只有 `chat` 和 `code-change`——没有 `explore`（探索工作区）、`investigate`（排查问题）等类型
3.  实际上，`shouldUseAgentMode()` 把 `code-change` 直接映射到 agent mode，因此 intent 分类的错误直接影响是否使用工具

**Copilot/Claude Code 对标**：
- 意图路由只有**结构化条件**：有 Working Set 文件 → agent mode；没有 → chat。prompt 文字不影响路由。
- 具体"是在修改文件还是探索还是解释"由 AI 在 agent loop 内自主判断。

**与 §2.2 的关系**：§2.2 描述了最优路由策略（基于文件类型），本条是代码层面的验证——`decideChatIntent` 中的 regex 打分仍存在，但 `shouldUseAgentMode()` 已经将 `code-change` 直接路由到 agent，所以这层 regex 的实际影响主要在**是否触发 agent mode（当没有文件时）**。

**修复方向**：保留 `decideChatIntent` 的 score 逻辑用于有文件时的通用路由，但将纯"排查/探索"类请求也归入 `code-change` bucket，避免被 `EXPLAIN_ONLY_RE` 降分：

```typescript
// ✅ 增加：排查/日志分析类请求不受 EXPLAIN_ONLY_RE 惩罚
const INVESTIGATE_RE = /(排查|调查|查找原因|找出原因|分析日志|看日志|日志里|为什么.*出错|为什么.*崩|怎么.*报错)/i;
if (INVESTIGATE_RE.test(text)) {
  score += 4;  // 强制进入 agent mode（有工具才能分析日志）
  signals.push('investigate-intent');
}
```

---

## 九、优先级与实施建议

### 9.1 P0 级（立即影响核心功能）

| 改动 | 文件 | 预计行数 | 说明 |
|------|------|---------|------|
| 移除 `buildAnalyzePrompt` 中的 `isExecTask` 分支，统一进工具循环（G3+G4）| `agent-loop.ts` | ~30 行 | 最高收益：所有分析任务都能调工具 |
| `buildAnalyzePrompt` 末尾追加 `buildToolsSuffix()` 调用（G3）| `agent-loop.ts` | ~5 行 | 让 AI 知道有哪些工具可用 |
| Architect 文件读取改为 `READ_MAX_LINES`（400行，G2）| `agent-task-decomposer.ts` | 1 行 | 修复规划失准问题 |
| `onListDir` 支持绝对路径（G9）| `extension.ts` | ~15 行 | 让 `runAgenticLoop` 能探索任意目录 |

### 9.2 P1 级（改善体验）

| 改动 | 文件 | 预计行数 |
|------|------|---------|
| `MAX_EXEC_ROUNDS` 从 4 改为 12（G5）| `agent-loop.ts` | 1 行 |
| 去掉 `allReadOnly` 快捷路径（G6）| `agent-loop.ts` | ~5 行 |
| `onTerminalCommand` 超时返回明确错误（G10）| `extension.ts` | ~5 行 |
| `AgentTaskAction` 增加 `'explore'`（G1）| `agent-task-decomposer.ts` | 变更类型 + 更新 prompt ~10 行 |
| `decideChatIntent` 增加 INVESTIGATE_RE（G13）| `intent-router.ts` | ~4 行 |

### 9.3 P2 级（精益求精）

| 改动 | 文件 |
|------|------|
| `sessionHistory` 改基于字符数截断（G7）| `agent-loop.ts` |
| Workflow hints 去掉位置性编排（G8）| `agent-loop.ts` |
| 只读工具并行执行（G12）| `agent-loop.ts` |
| `inferTasksFromFiles` fallback 改为统一 `analyze`（G11）| `agent-task-decomposer.ts` |

---

> 版本：v3.0（全面架构审计版）  
> 新增：§八 全面架构审计13个预设路径问题（G1–G13），§九 优先级路线图  
> 前置：§一 至 §七 及附录保持 v2.0 内容不变

