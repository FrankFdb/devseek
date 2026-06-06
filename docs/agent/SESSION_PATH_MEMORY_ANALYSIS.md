# DeepSeek 插件记忆体架构设计

> 版本：2026-05-26 v9（§十五 官方文档核实修订）
> 定位：为"顶级编程智能体 AI"设计完整的记忆体系统
> 参照系：GitHub Copilot Edits 与 Claude Code CLI 的完整记忆实现对比（官方文档版）

---

## 零、记忆体分层框架（修订版）

```
┌──────────────────────────────────────────────────────────────────┐
│  Layer 4: 外部记忆（External）                                    │
│  代码索引、语义搜索、符号数据库                                    │
│  特点：海量、只读、需要构建索引                                    │
├──────────────────────────────────────────────────────────────────┤
│  Layer 3: 持久记忆（Persistent）                                  │
│  项目规则、用户偏好、AI 学习到的知识                               │
│  特点：跨 session 永久保留，最重要的是 AI 可自主写入              │
├──────────────────────────────────────────────────────────────────┤
│  Layer 2: 会话记忆（Session）                                     │
│  文件路径字典、任务上下文、分析结论                                │
│  特点：workspaceState 持久化，重启恢复，session 结束时清空        │
├──────────────────────────────────────────────────────────────────┤
│  Layer 1b: 压缩记忆（Summarized）          ← 本次新增             │
│  历史对话的关键摘要（决策 / 改动 / 错误 / 当前状态）              │
│  特点：进程关闭时压缩持久化，恢复 session 时作为"历史背景"注入    │
├──────────────────────────────────────────────────────────────────┤
│  Layer 1a: 易失记忆（Volatile）                                   │
│  当前对话的近 N 轮完整历史、loop 内编辑缓冲、任务队列             │
│  特点：进程内存，不可能全部持久化，但近几轮要保留                 │
└──────────────────────────────────────────────────────────────────┘
```

**关键修订**：L1 拆为 L1a（近期完整）和 L1b（远期压缩摘要）。
"关闭即消失"不等于"不需要"——打开历史 session 时，用户需要 AI 记住：做了什么、改了哪些文件、遇到了什么错误、现在在哪一步。这正是 L1b 的职责。

---

## 一、GitHub Copilot 的完整记忆实现

### L1a — 近期完整对话（VS Code Chat API 托管）

Copilot 的对话历史由 **VS Code Chat API** 自动管理，不需要插件自己实现持久化：

```typescript
// VS Code Chat API 自动传入每轮完整历史
vscode.chat.createChatParticipant('copilot', async (request, context, stream, token) => {
  // context.history 包含本次会话的所有历史轮次（VS Code 自动持久化到 workspaceState）
  const history: vscode.ChatContext = context.history;
  // history.turns[] 中每条包含：用户消息 + 助手消息 + 引用的文件列表
});
```

**Copilot 的 Session ID 机制**：
- 每个 Chat Panel 实例一个 `chatSessionId`（UUID）
- Session ID 存于 `workspaceState['copilot.chat.sessions']`，是已知 session 的 UUID 数组
- 每条 turn 保留引用文件的 `vscode.Uri`（绝对 URI）副本
- **Copilot 不允许用户手动切换 session**：每个 Editor 内置对话绑定独立的 session

**VS Code Chat API 自动做了什么**：
- 每轮对话存入 `workspaceState`（VS Code 内部管理）
- 重启 VS Code 后历史自动恢复
- 每条 turn 保留引用文件的 `vscode.Uri`（绝对 URI）

### L1b — 上下文超限时的截断策略

Copilot 没有专门的"摘要压缩"机制。当历史过长时：
- VS Code Chat API 自动截断最老的轮次
- **只截断，不摘要**：被截断的上下文直接丢弃

这是 Copilot 的局限—— session 超长后，早期的重要决策会被静默丢弃。

### L2 — Working Set（会话记忆）

```typescript
// workspaceState 持久化的文件集合，重启自动恢复
// key = fsPath，value = vscode.Uri（绝对路径）
context.workspaceState.update('github.copilot.workingSet', [...uris.keys()]);

// 启动时恢复
const saved = context.workspaceState.get<string[]>('github.copilot.workingSet', []);
```

- 跨轮次不清空，用户手动增删
- 工具参数永远是 `fsPath`（绝对路径），AI 不计算相对路径

### L3 — 持久记忆

- `.github/copilot-instructions.md`：项目规则，每次对话注入 system prompt
- `settings.json`：用户偏好
- **无 AI 可写机制**：Copilot 不能自主修改记忆文件

---

## 二、Claude Code 的完整记忆实现

### L1a — 近期完整对话（进程内存）

```typescript
// claude code 内部（简化）
interface ConversationTurn {
  role: 'user' | 'assistant';
  content: ContentBlock[];  // ContentBlock 可以是 text / tool_use / tool_result
}

let conversationHistory: ConversationTurn[] = [];
// 每次 LLM 请求携带完整历史（无截断，直到上下文超限触发自动 compact）
```

**注意**：Claude Code 不截断历史，而是用 **compact（压缩）** 来处理超长上下文。

**Claude Code Session 文件格式**（持久化到磁盘）：
```json
// ~/.claude/sessions/<uuid>.json
{
  "sessionId": "a3f82b...",
  "messages": [
    { "role": "user",      "content": "...", "timestamp": 1700000000 },
    { "role": "assistant", "content": "...", "timestamp": 1700000010 }
  ],
  "summary": "紧凑摘要文本",
  "recentFiles": {
    "main.cpp": "/home/user/project/src/main.cpp",
    "agent-loop.ts": "/home/user/ext/src/agent-loop.ts"
  },
  "workingDir": "/home/user/project"
}
```

**重启恢复 CLI 标志**：
```bash
claude --continue                # 恢复上次的 session
claude --resume a3f82b...        # 指定 session ID 恢复
claude --list-sessions           # 列出所有保存的 session
```

### L1b — 压缩记忆（Compact 机制）— Claude Code 的核心差异

这是 Claude Code 相较 Copilot 最重要的设计：

```
触发条件：
  - 用户手动执行 /compact 命令
  - 上下文 token 超过阈值时自动触发

压缩过程：
  1. 把整个 conversationHistory 发给 LLM
  2. 提示词："请将以下对话压缩为结构化摘要，保留：
              - 已完成的任务和结果
              - 已修改的文件列表（绝对路径）
              - 遇到的错误和解决方案
              - 未完成的任务和当前状态
              - 关键决策和原因"
  3. LLM 返回一段摘要文本
  4. 用这段摘要替换整个 conversationHistory（压缩成1条 assistant 消息）

恢复后的历史格式：
  [
    { role: 'assistant', content: '【对话摘要】\n已完成：...\n已修改文件：...\n当前进度：...' },
    { role: 'user', content: <新消息> }
  ]
```

**关键洞察**：
- 摘要保留了"做了什么"但不保留"怎么做的细节"
- AI 在读到摘要后，能理解工作背景，继续推进
- 摘要天然过滤掉了中间过程的噪音，只留关键节点

CLI 重启后如何恢复摘要：
- Claude Code 提供 `--resume` 标志，可以从 `~/.claude/session/` 恢复上次 session
- session 文件里存的就是 compact 后的摘要 + 文件记忆状态

### L2 — recentFiles 字典（进程内存，不持久化）

```typescript
// Map<basename.toLowerCase(), FileRecord>
const recentFiles = new Map<string, { absPath: string; lastAccessed: number }>();

// 四级路径解析
function resolveFilePath(input: string): string {
  if (path.isAbsolute(input)) return input;                               // P1
  const r = recentFiles.get(path.basename(input).toLowerCase());
  if (r) return r.absPath;                                               // P2
  const fromCwd = path.resolve(cwd, input);
  if (fs.existsSync(fromCwd)) return fromCwd;                            // P3
  for (const r of modifiedPaths)
    if (path.basename(r) === path.basename(input)) return r;             // P4
  throw new Error('File not found');
}
```

**⚠️ Claude Code 的 L2 不持久化**：进程退出即丢失。这是 CLI 场景的合理选择，
但对 VS Code 扩展（用户期望重启后恢复工作）是设计缺陷，需要补充 `workspaceState`。

### L3 — CLAUDE.md 持久记忆

```
项目根/CLAUDE.md       ← 项目规则，用户写，注入每次对话 system prompt
~/.claude/CLAUDE.md    ← 用户个人偏好，跨项目生效
~/.claude/memory/      ← AI 自主写入的知识库
  facts.md             ← 项目特定知识（编译命令、依赖、架构）
  preferences.md       ← AI 观察到的用户偏好
```

**AI 可写工具 `memory_write`**：
```typescript
// Claude Code 的工具定义（LLM 可调用）
{
  name: 'memory_write',
  description: '将重要信息写入持久记忆，供未来 session 使用',
  input_schema: {
    file: { type: 'string', enum: ['facts', 'preferences'] },
    content: { type: 'string' }
  }
}

// 实现
async function memoryWrite({ file, content }) {
  const path = `~/.claude/memory/${file}.md`;
  fs.appendFileSync(path, `\n## ${new Date().toISOString()}\n${content}\n`);
}
```

AI 写入时机：
- 发现反复出现某个错误并找到解法 → 写入 `facts.md`
- 用户多次纠正某个编程习惯 → 写入 `preferences.md`
- 了解到特殊的编译依赖或环境需求 → 写入 `facts.md`

---

## 三、DeepSeek 插件的现状诊断

### 当前实现清单（v7 更新）

| 层次 | 变量/机制 | 存储 | 重启后 | 状态 |
|------|----------|------|--------|------|
| L1a | `nonBridgeChatHistory` (≤ 40条) | 进程内存 | ✅ workspaceState恢复 | **已实现** |
| L1a | `sessionHistory` (loop内，任务摘要) | 进程内存 | N/A | 普通 |
| L1a | `contentCache` (loop内，编辑缓冲) | 进程内存 | N/A | 普通 |
| L1b | `compactAndSaveHistory()` 摘要 | workspaceState | ✅ 恢复时注入 | **已实现** |
| L1b | T3 自动触发（历史 ≥ 40条时 compact） | workspaceState | ✅ | **已实现** |
| L1b | Agent 模式历史保存 | workspaceState | ✅ | **已实现** |
| L2 | `sessionRecentFiles` 字典 (basename→absPath) | workspaceState | ✅ | **已实现** |
| L2 | `lastAnalysisText` 分析结论持久化 | workspaceState | ✅ | **已实现** |
| L2 | `lastAgentChangedPaths` 改动路径注册 | sessionRecentFiles | ✅ | **已实现** |
| L3 | `.deepseek/rules.md` 项目规则 | 文件系统 | ✅ | **已实现** |
| L3 | `.deepseek/memory.md` AI 可写记忆 | 文件系统 | ✅ | **已实现（v5）** |
| L3 | `memory_write` 工具 (AI 自主写入) | 文件系统 | ✅ | **已实现（v5）** |
| L3 | memory.md 注入 prompt (非 agent 路径) | 每轮注入 | ✅ | **已实现（v5）** |
| L3 | memory.md 注入 prompt (agent editor/analyze) | 每任务注入 | ✅ | **已实现（v5）** |
| L4 | bridge `/index/file` 按路径读取文件 | 进程内 | 重建 | **已实现（v6）** |
| L4 | bridge `/index/search` 按文件名搜索 | 进程内 | 重建 | **已实现（v6）** |
| 学习 | `shouldUseAgentMode` → Plan A（默认 agent）| — | — | **已实现（v7）** |
| 学习L0 | Session habits（内存 Map，当前 session）| 进程内存 | ✗ | **已实现（v7）** |
| 学习L1 | Workspace habit cache（项目级）| workspaceState | ✅ | **已实现（v7）** |
| 学习L2 | Global habit memory（插件级，跨项目）| globalState | ✅ 跨项目 | **已实现（v7）** |

### `workspaceState` / `globalState` key 完整清单（v7）

```typescript
// ── Session 记忆 (workspaceState) ─────────────────────────────────
'deepseek.activeSessionId'                    ← 当前活跃 session ID
'deepseek.sessions'                           ← SessionMeta[] 列表（最多 100 条）
`deepseek.session.${id}.history`              ← ChatMessage[] 近 40 条完整历史
`deepseek.session.${id}.files`                ← Record<string,string> 文件路径字典
`deepseek.session.${id}.summary`              ← string LLM 生成的核心摘要
`deepseek.session.${id}.analysisText`         ← string 上次分析结论（注入下次计划）

// ── 学习模块 (workspaceState — 项目级 L1) ──────────────────────────
'deepseek.intentHabits'                       ← HabitRecord[] 项目级习惯缓存（最多 200 条）

// ── 学习模块 (globalState — 插件级 L2) ────────────────────────────
'deepseek.globalIntentHabits'                 ← HabitRecord[] 跨项目全局习惯（最多 500 条）
```

---


### 关键问题：`workspaceState` 从未被使用

```typescript
// extension.ts activate() — context 对象从未存为全局！
export function activate(context: vscode.ExtensionContext): void {
  extensionUriGlobal = context.extensionUri;  // 只存了 Uri
  // context.workspaceState  ← 完全没有调用过
  // context.globalState     ← 完全没有调用过
}
```

VS Code 提供了完善的持久化 API，但插件一次也没用，所有 L1/L2 记忆重启即丢。

### 关于 L1 现有的裁剪机制（非摘要）

```typescript
// nonBridgeChatHistory：超 40 条时直接截断尾部
if (nonBridgeChatHistory.length > 40) {
  nonBridgeChatHistory = nonBridgeChatHistory.slice(-40);  // 丢弃最老的
}

// sessionHistory（agent loop 内）：超 40K 字符时 splice 删除中间条目
if (sessionChars > 40000 && sessionHistory.length >= 6) {
  sessionHistory.splice(2, 2);  // 保留前2锚点，删第3-4条
}
```

两处都是**直接截断/删除**，被删除的内容彻底丢失。没有 Claude Code 的压缩摘要机制。

---

## 四、DeepSeek 插件目标记忆架构

**选型**：数据结构 ← Claude Code，持久化 ← Copilot `workspaceState`，
压缩摘要 ← Claude Code compact 机制，AI 可写 ← Claude Code `memory_write`

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 4: 外部记忆（bridge 索引 — 现有，无需改动）                  │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 3: 持久记忆（文件系统）                                       │
│  .deepseek/rules.md     已有  用户写，注入每次 prompt               │
│  .deepseek/memory.md    新增  AI 自主写入的项目知识                  │
│  globalState            远期  用户个人偏好（跨工作区）               │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2: 会话记忆（workspaceState 持久化）                         │
│  sessionRecentFiles     新增  Map<basename, absPath>                │
│  lastAgentChangedPaths  改造  存 absPath（现在存相对路径）           │
│  lastAnalysisText       改造  持久化到 workspaceState               │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 1b: 压缩记忆（workspaceState 持久化）                        │
│  sessionSummary         新增  关闭/切换 session 时由 LLM 生成摘要   │
│                               字段：做了什么 / 改了哪些文件 /        │
│                                     遇到什么错误 / 现在在哪一步      │
│  恢复方式：作为 system 消息前置注入，不还原完整历史                  │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 1a: 易失记忆（进程内存，workspaceState 备份近期 N 轮）        │
│  nonBridgeChatHistory   近 10 轮完整历史，workspaceState 备份        │
│  sessionHistory         loop 内任务摘要（现有，无需改动）            │
│  contentCache           loop 内编辑缓冲（现有，无需改动）            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 五、L1b 压缩摘要的设计规范

### 5.1 摘要生成时机

```
触发条件（任一满足）：
  T1. 用户点击"保存 session"按钮
  T2. 用户切换到另一个 session
  T3. nonBridgeChatHistory 超过阈值（如 30 条）→ 自动压缩最老的 20 条
  T4. sessionHistory 超过 40K 字符时（增强现有裁剪逻辑）
```

### 5.2 摘要 Prompt（LLM 生成）

```typescript
const COMPACT_PROMPT = `
你是一个对话摘要助手。请将以下 AI 编程助手的对话历史压缩为结构化摘要。
摘要必须包含以下信息（如果没有相关信息则写"无"）：

【已完成的工作】
- 列出所有已成功完成的任务

【已修改/创建的文件】
- 列出文件绝对路径，以及修改内容的一句话描述

【遇到的错误与解决方案】
- 描述遇到的问题及如何解决的

【当前状态与未完成工作】
- 描述目前进展到哪一步，还有什么没做完

【关键技术决策】
- 列出重要的技术选择和原因

请保持摘要简洁，总字数不超过 800 字。
---
${conversationHistory}
`;

// 持久化
const summary = await routeChat({ prompt: COMPACT_PROMPT, mode: 'fast' });
extContext.workspaceState.update(`deepseek.session.${sessionId}.summary`, summary);
```

### 5.3 摘要恢复时的注入方式

```typescript
// session 恢复时，不还原完整历史，只注入摘要作为首条 assistant 消息
function restoreSession(sessionId: string) {
  const summary = extContext.workspaceState.get<string>(`deepseek.session.${sessionId}.summary`);
  if (summary) {
    // 作为第一条 assistant 消息
    nonBridgeChatHistory = [
      { role: 'assistant', content: `【上次 session 摘要】\n${summary}` },
    ];
  }
  // 再恢复 L2（文件路径字典）
  const files = extContext.workspaceState.get<Record<string,string>>(
    `deepseek.session.${sessionId}.recentFiles`, {}
  );
  sessionRecentFiles.clear();
  for (const [k, v] of Object.entries(files)) sessionRecentFiles.set(k, v);
}
```

效果：AI 读到摘要后立刻知道"上次做了什么、现在在哪步"，可以无缝继续。

---

## 六、其他层的完整设计规范

### 6.1 `workspaceState` key 命名规范

```typescript
const WS_KEYS = {
  // L1b 压缩摘要（按 sessionId 隔离）
  summary:      (id: string) => `deepseek.session.${id}.summary`,
  recentHistory:(id: string) => `deepseek.session.${id}.recentHistory`, // 近 10 轮

  // L2 文件路径字典
  recentFiles:  (id: string) => `deepseek.session.${id}.recentFiles`,   // Record<string,string>
  analysisText: (id: string) => `deepseek.session.${id}.analysisText`,  // string

  // 全局
  activeSessionId: 'deepseek.activeSessionId',
} as const;
```

### 6.2 `sessionRecentFiles` 完整设计（Claude Code 数据结构 + Copilot 持久化）

```typescript
// 全局变量
let extContext: vscode.ExtensionContext;       // activate() 时保存
const sessionRecentFiles = new Map<string, string>(); // basename/relPath → absPath

// activate() 里恢复
export function activate(context: vscode.ExtensionContext) {
  extContext = context;
  const saved = context.workspaceState.get<Record<string,string>>(
    WS_KEYS.recentFiles(activeSessionId), {}
  );
  for (const [k, v] of Object.entries(saved)) sessionRecentFiles.set(k, v);
}

// 注册（agent 执行后 + 用户附件时）
function registerToMemory(absPath: string) {
  sessionRecentFiles.set(nodePath.basename(absPath).toLowerCase(), absPath);
  sessionRecentFiles.set(vscode.workspace.asRelativePath(absPath), absPath);
  extContext.workspaceState.update(
    WS_KEYS.recentFiles(activeSessionId),
    Object.fromEntries(sessionRecentFiles)
  );
}

// onReadFile 四级查找
onReadFile: async (filePath, workDir?) => {
  // P0: 字典精确匹配（basename 或相对路径）
  const abs = sessionRecentFiles.get(filePath)
           ?? sessionRecentFiles.get(nodePath.basename(filePath).toLowerCase());
  if (abs) { try { if (statSync(abs).isFile()) return readFileSync(abs,'utf8').slice(0,8000); } catch {} }

  // P1: workDir 相对（path.resolve 处理 ../ 情形）
  if (workDir && !nodePath.isAbsolute(filePath)) {
    const r = nodePath.resolve(workDir, filePath);
    if (isWithinWorkspace(r)) { try { return readFileSync(r,'utf8').slice(0,8000); } catch {} }
  }

  // P2: 绝对路径
  if (nodePath.isAbsolute(filePath)) { try { return readFileSync(filePath,'utf8').slice(0,8000); } catch {} }

  // P3: bridge + VS Code API fallback
  const content = await readWorkspaceFile(filePath, []);
  if (!content) throw new Error(`找不到文件：${filePath}`);
  return content.slice(0, 8000);
},
```

### 6.3 `.deepseek/memory.md` — AI 可写持久记忆（对标 Claude Code）

```typescript
// agent-loop.ts 新增工具
{
  name: 'memory_write',
  description: '将重要项目知识写入持久记忆（.deepseek/memory.md），供未来 session 使用。适用于：发现特殊编译依赖、解决反复出现的错误、记录架构决策等。',
  parameters: {
    content: { type: 'string', description: '要记录的知识，100字以内' }
  }
}

onMemoryWrite: async (content: string) => {
  const memPath = nodePath.join(wsRoot.fsPath, '.deepseek', 'memory.md');
  const entry = `\n## ${new Date().toISOString().slice(0,10)}\n${content.slice(0,500)}\n`;
  fs.appendFileSync(memPath, entry, 'utf8');
},
```

`.deepseek/memory.md` 与 `rules.md` 一起在每次 `buildAnalyzePrompt` 时自动注入，AI 写入的知识自动回馈到下次对话。

---

## 七、实施优先级（v5 更新 — 实现状态）

| 优先级 | 功能 | 状态 |
|--------|------|------|
| P0 | 修复 `onReadFile` `..` 路径崩溃 | ✅ 已实现 |
| P1 | `sessionRecentFiles` + `workspaceState` 接入 | ✅ 已实现 |
| P1 | `initOrRestoreSession` 重启恢复 | ✅ 已实现 |
| P2 | L1b `compactAndSaveHistory()` (新开 session 触发) | ✅ 已实现 |
| P2 | T3 自动触发（历史 ≥ 40条 刷最老 20 + compact） | ✅ **v5 新实现** |
| P3 | `.deepseek/memory.md` 文件创建/读取 | ✅ **v5 新实现** |
| P3 | `memory_write` 工具 (agent-loop) | ✅ **v5 新实现** |
| P3 | memory.md 注入非 agent prompt | ✅ **v5 新实现** |
| P3 | memory.md 注入 buildEditorPrompt | ✅ **v5 新实现** |
| P3 | memory.md 注入 buildAnalyzePrompt | ✅ **v5 新实现** |
| P3 | `lastAnalysisText` workspaceState 持久化 | ✅ **v5 新实现** |
| P3 | Agent 模式写入 session 历史记录 | ✅ **v4 新实现** |
| P3 | Session reload 后自动恢复到 webview | ✅ **v4 新实现** |
| P3 | `sessionLoaded` 摘要与消息流分离显示 | ✅ **v4 新实现** |
| P5 | 多 Session 切换 UI | ✅ 已实现 |
| L4 | bridge `/index/file` 文件读取路由 | ✅ **v6 新实现** |
| L4 | bridge `/index/search` 文件名搜索路由 | ✅ **v6 新实现** |
| L4 | `WORKSPACE_ROOT` env 传递给 bridge | ✅ **v6 新实现** |
| 学习 | Plan A：`shouldUseAgentMode` 默认 agent | ✅ **v7 新实现** |
| 学习 | `intent-learner.ts`：三级习惯记忆（session/项目/插件）| ✅ **v7 新实现** |
| 学习 | `lookupLearnedIntent` + `recordIntentOutcome` 集成 | ✅ **v7 新实现** |
| L4 | 真正语义搜索（DeepSeek LLM 辅助检索） | 🔵 v8 计划 |
| 远期 | 学习模块 UI（查看/删除已学习的 habits）| 🔵 v8 计划 |

---

## 八、Copilot vs Claude Code vs DeepSeek 目标方案对比

| 维度 | Copilot | Claude Code | DeepSeek 目标 |
|------|---------|-------------|--------------|
| **L1a 近期历史** | VS Code Chat API 自动管理，`workspaceState` | 进程内存 `conversationHistory[]` | `nonBridgeChatHistory` + `workspaceState` 备份近 10 轮 |
| **L1b 压缩摘要** | 无（直接截断） | `/compact` 命令 + 自动压缩 | **`compactSession()` 函数，LLM 生成结构化摘要** |
| **L2 文件路径** | Working Set (`vscode.Uri`，持久化) | `recentFiles` Map（仅内存） | `sessionRecentFiles` Map + `workspaceState`（混合方案）|
| **L2 路径解析** | 遍历 Working Set 匹配 | 四级优先级 resolveFilePath | 四级优先级 `onReadFile`（对标 Claude Code）|
| **L3 规则** | `.github/copilot-instructions.md` | `CLAUDE.md` | `.deepseek/rules.md`（已有）|
| **L3 AI 可写** | 无 | `memory_write` → `~/.claude/memory/` | `memory_write` → `.deepseek/memory.md` |
| **多 session** | 单工作区单 Working Set | 无（每次 CLI 调用新进程） | 每个 sessionId 独立 `workspaceState` key |
| **重启恢复** | ✅ VS Code Chat API 自动 | ❌ 不支持 | ✅ `workspaceState` + 摘要注入 |
| **上下文超限** | 直接截断（丢失历史） | compact 压缩摘要（保留要点） | **compact 压缩摘要（对标 Claude Code）** |
| **Intent 路由** | 独立 UI 入口（Edit/Chat/Inline）| 无路由（全部进 agent）| **Plan A：默认 agent，`NO_CHANGE_RE` 例外 ← Claude Code** |
| **习惯学习** | 无（用户手工维护 instructions.md）| 无（AI 按需写 CLAUDE.md）| **三级自动频次学习（Session/项目/插件）← 超越两者** |

**结论**：Copilot 的优势在持久化基础设施（VS Code API 托管），劣势在超限直接截断、无自动学习。
Claude Code 的优势在 compact 压缩和 AI 可写记忆，劣势在不持久化、无习惯学习。
DeepSeek v7 目标方案取两者之长，并在 **Intent 路由** 和 **习惯学习** 方面超越两者。

---

## 九、原始路径问题复现记录（历史参考）

```
第一轮：@code/3D/main.cpp → agent 执行成功
        lastAgentChangedPaths = ["code/3D/main.cpp"]  ← 相对路径（旧行为）

第二轮：无附件跟进 → lastConversationFiles 清空
        basenameMap 为空 → task.absPath = undefined
        workdir 绝对路径注入 → AI 计算 "../../code/3D/main.cpp"
        normalizeRelPath 拒绝 ".." → "找不到文件"

P0+P1 修复链：
  onReadFile("../../code/3D/main.cpp")
    → P0: sessionRecentFiles.get("main.cpp") → "/home/ff/.../code/3D/main.cpp"
    → 直接 readFileSync，不经过 normalizeRelPath → ✅
```

---

## 十、Session 历史记录三个 Bug 诊断与修复（2026-05-19 v4）

### 10.1 问题描述

| # | 现象 | 影响 |
|---|------|------|
| 1 | 多次对话后点击「新对话」，历史记录面板为空 | 用户无法回溯 agent 任务执行历史 |
| 2 | Reload Window 后看不到上次 session 内容 | 每次重启都是空白状态，体验差 |
| 3 | 点击历史 session 后内容显示异常 | compact 摘要被渲染成 assistant 气泡，混入正常消息流 |

### 10.2 根因分析

#### Bug 1 根因：Agent 模式从不更新 nonBridgeChatHistory

```
非 agent 路径：routeChat(trackHistory:true)
  → nonBridgeChatHistory.push(user, assistant)
  → saveCurrentSession()
  → session 有历史 ✅

Agent 路径：runAgentLoop(...)
  → loop 内部 routeChat(trackHistory:false)
  → runChat() 直接 return（无任何 history 写入）
  → nonBridgeChatHistory.length === 0
  → saveCurrentSession() guard: length===0 → return ❌
  → 新建 session 时 compactAndSaveHistory: histSnap.length < 4 → 不压缩 ❌
  → getSessions() 中该 session 的 history 始终空 ❌
```

额外问题：`initOrRestoreSession()` 从零创建 session 时不调用 `saveSessionMeta()`，
所以 session 在 `getSessions()` 列表中不存在，直到 `routeChat` 的 `length===2` 分支触发。
Agent 模式从不触发该分支 → session 永远不在列表里。

#### Bug 2 根因：ready 处理器不还原 session 到 webview

```typescript
case 'ready':
  this._ready = true;
  pushUiSettings(wv);
  postPendingEdits(wv);
  this._flushQueue();
  // 从来没有发 sessionLoaded ← 缺失！
  break;
```

`initOrRestoreSession()` 在 `activate()` 末尾已经把历史恢复到 `nonBridgeChatHistory`，
但 webview 重载后是空白的，所有历史只在内存里，不会主动推送到 UI。

#### Bug 3 根因：sessionLoaded 把 compact 摘要混入聊天消息流

```typescript
// loadSession handler（旧代码）
nonBridgeChatHistory = summary
  ? [{ role: 'assistant', content: `【上次 session 摘要】\n${summary}` }, ...history.slice(-10)]
  : history.slice(-10);
wv.postMessage({ type: 'sessionLoaded', id, history: nonBridgeChatHistory });
//                                                    ^^^^^^^^^^^^^^^^^^^^^^^^
// nonBridgeChatHistory[0] = 摘要，作为 assistant 气泡渲染，混入聊天流 ❌
```

LLM 上下文需要摘要（让 AI 知道上次做了什么），但 UI 不应该把摘要渲染成聊天气泡。
两者应分离：`nonBridgeChatHistory`（含摘要，供 LLM）vs `displayHistory`（不含摘要，供 UI）。

### 10.3 修复方案

#### Fix 1 — Agent 模式：补充 history 写入和 session 保存

在 `runChat` agent 路径的 try/catch 之后、`endResponse` 之前：

```typescript
// try 块外声明
let agentHistoryText = '';

// if (wsRoot) 块末尾，autopilot 之后
const _agentChangedNames = lastAgentChangedPaths.length > 0
  ? '已修改文件：' + lastAgentChangedPaths.slice(0, 5).map(p => nodePath.basename(p)).join(', ')
  : '';
agentHistoryText = [loopResult.analysisText?.slice(0, 500), _agentChangedNames]
  .filter(Boolean).join('\n\n') || `[Agent] 已完成 ${tasks.length} 个子任务`;

// catch 块末尾
agentHistoryText = agentHistoryText || `[Agent 执行出错] ${msg.slice(0, 200)}`;

// try/catch 之后
if (agentHistoryText) {
  nonBridgeChatHistory.push({ role: 'user', content: userDisplay });
  nonBridgeChatHistory.push({ role: 'assistant', content: agentHistoryText });
  if (nonBridgeChatHistory.length > 40) nonBridgeChatHistory = nonBridgeChatHistory.slice(-40);
  const meta = getSessions().find(s => s.id === activeSessionId);
  if (meta) { saveSessionMeta({ ...meta, updatedAt: Date.now() }); }
  else { saveSessionMeta({ id: activeSessionId, title: userDisplay.slice(0, 50), createdAt: Date.now(), updatedAt: Date.now() }); }
  saveCurrentSession();
}
```

#### Fix 2 — ready 处理器：自动恢复最近 session 到 webview（Copilot 模式）

```typescript
case 'ready':
  this._ready = true;
  pushUiSettings(wv);
  postPendingEdits(wv);
  this._flushQueue();
  // 恢复上次 session（summary 与 history 分离发送）
  if (nonBridgeChatHistory.length > 0 && activeSessionId) {
    let _display = nonBridgeChatHistory;
    let _summary = '';
    if (_display[0].role === 'assistant' && _display[0].content.startsWith('【上次 session 摘要】\n')) {
      _summary = _display[0].content.slice('【上次 session 摘要】\n'.length);
      _display = _display.slice(1);
    }
    wv.postMessage({ type: 'sessionLoaded', id: activeSessionId, history: _display, summary: _summary });
  }
  break;
```

#### Fix 3 — sessionLoaded 分离摘要与消息流

**extension.ts `loadSession` handler**：
```typescript
// 旧：history: nonBridgeChatHistory（含摘要 prefix）
// 新：history: loadedHistory.slice(-10)（纯聊天消息），summary: loadedSummary（单独字段）
wv.postMessage({ type: 'sessionLoaded', id, history: loadedHistory.slice(-10), summary: loadedSummary });
```

**webview.js `loadSessionMessages(history, summary)`**：
```javascript
// summary 单独渲染为 .session-summary-box（有样式标识），不混入聊天气泡
if (summary) {
  summaryBox.innerHTML = '<div class="session-summary-label">上次 session 摘要</div>' +
    '<div class="session-summary-content">' + escapeHtml(summary) + '</div>';
}
// history 渲染为正常聊天消息
history.forEach(m => { ... });
```

### 10.4 Copilot vs Claude Code vs DeepSeek（更新后）Session 行为对比

| 行为 | Copilot | Claude Code | DeepSeek（修复后）|
|------|---------|-------------|-----------------|
| agent 模式保存历史 | VS Code Chat API 自动 | `/compact` 命令 | **Fix 1: push user+assistant summary** |
| reload 后恢复 | ✅ VS Code Chat API | ❌ 进程重启丢失 | **Fix 2: ready 时发 sessionLoaded** |
| 摘要与消息分离 | API 内部处理 | N/A（无 UI）| **Fix 3: summary 字段单独渲染** |
| session 列表 | VS Code 侧边栏管理 | 无 | `.session-summary-box` CSS 标识 |


---

## 十一、v5 新增功能详细记录（2026-05-19）

### 11.1 P3 全链路：`.deepseek/memory.md` + `memory_write` 工具

本次 v5 实现了 Claude Code 的 `memory_write` 全链路，覆盖三个文件：

#### `project-rules.ts` 新增导出

```typescript
const MEMORY_FILENAME = '.deepseek/memory.md';
const MAX_MEMORY_CHARS = 3000;

// 读取 .deepseek/memory.md（同 rules.md 一样，搜索工作区根）
export function getProjectMemorySync(): string | null

// 包裹为 prompt 上下文段落
export function wrapMemoryAsContext(memory: string): string

// 通用文件搜索 helper（替代原 _findRulesFile 内联逻辑）
function _findFile(filename: string): string | null
```

#### `agent-loop.ts` 三处变更

1. **`buildToolsSuffix`** — 新增 `memory_write` 工具描述：
```
将重要发现写入项目记忆（.deepseek/memory.md，供未来 session 使用）：
[TOOL:memory_write {"content":"关键记录内容（100字以内）"}]
```

2. **`buildAnalyzePrompt`** — 补充 rules+memory 注入（之前完全缺失！）：
```typescript
const _analyzeRules   = getProjectRulesSync();
const _analyzeMemory  = getProjectMemorySync();
const _analyzeContext = [
  _analyzeRules  ? wrapRulesAsContext(_analyzeRules)   : '',
  _analyzeMemory ? wrapMemoryAsContext(_analyzeMemory) : '',
].filter(Boolean).join('\n\n');
// → 注入到 prompt 数组首位
```

3. **`executeFakeToolsForLoop`** — `memory_write` handler：
```typescript
} else if (tool.name === 'memory_write' && callbacks.onMemoryWrite) {
  const content = typeof tool.args?.content === 'string' ? tool.args.content : JSON.stringify(tool.args);
  await callbacks.onMemoryWrite(content);
  parts.push(`[memory_write] 已写入记忆：${content.slice(0, 80)}`);
  callbacks.onDelta('\n*[已将关键信息写入项目记忆]*\n');
}
```

`AgentLoopCallbacks` 新增：`onMemoryWrite?: (content: string) => Promise<void>`

#### `extension.ts` — `onMemoryWrite` 实现

```typescript
onMemoryWrite: async (content: string) => {
  const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsPath) return;
  const dir = nodePath.join(wsPath, '.deepseek');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const memPath = nodePath.join(dir, 'memory.md');
  const date = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(memPath, `\n## ${date}\n${content}\n`, 'utf8');
},
```

memory.md 同时注入到：
- 非 agent 的 `finalPrompt`（每轮对话）
- `buildEditorPrompt`（agent editor 阶段）
- `buildAnalyzePrompt`（agent analyze 阶段）

### 11.2 `lastAnalysisText` workspaceState 持久化

分析结论（agent 第一阶段生成的任务计划）现在跨重启保留：

```typescript
// workspaceState key：deepseek.session.${activeSessionId}.analysisText

// 保存（agent run 完成后）
extContext?.workspaceState.update(
  `deepseek.session.${activeSessionId}.analysisText`,
  lastAnalysisText
);

// 恢复（initOrRestoreSession）
const savedAnalysis = extContext?.workspaceState.get<string>(
  `deepseek.session.${savedId}.analysisText`
);
if (savedAnalysis) lastAnalysisText = savedAnalysis;

// 清除（deleteSession）
extContext?.workspaceState.update(`deepseek.session.${id}.analysisText`, undefined);
```

效果：重启 VS Code 后，AI 仍能将上次的分析结论注入下一次任务计划生成，保持任务连贯性。

### 11.3 T3 自动压缩触发

之前 P2 只实现了"新开 session 时触发 compact"，T3（历史过长时自动触发）在 v5 补充：

```typescript
// routeChat() 中，saveCurrentSession() 之前
if (nonBridgeChatHistory.length >= 40 && activeSessionId) {
  const _compactId = activeSessionId;
  const _toCompact = nonBridgeChatHistory.slice(0, 20);
  nonBridgeChatHistory = nonBridgeChatHistory.slice(20);  // 保留最新 20 条
  void (async () => {
    await compactAndSaveHistory(_toCompact, _compactId);
    // 压缩完成后，将新摘要 prefix 注入内存历史
    const freshSummary = extContext?.workspaceState.get<string>(
      `deepseek.session.${_compactId}.summary`
    );
    if (freshSummary && _compactId === activeSessionId) {
      nonBridgeChatHistory.unshift({ role: 'assistant', content: `【历史摘要】\n${freshSummary}` });
    }
  })();
}
```

触发后：
- 最新 20 条完整历史保留在 `nonBridgeChatHistory`（供下轮 LLM 上下文）
- 最老 20 条压缩为摘要，存入 `workspaceState`
- 摘要 prefix 异步回注到 `nonBridgeChatHistory[0]`（让 AI 知道更早期的背景）

### 11.4 本次 v5 编译结果

- 编译命令：`npm run compile`
- 输出：`dist/extension.js 333.7kb ⚡ Done in 97ms`
- 状态：✅ 零错误，零警告


---

## 十二、v6 L4 基础文件索引实现（2026-05-19）

### 12.1 实现内容

#### 问题诊断

`bridge-client.ts` 调用 `GET /index/file?path=...`，但 bridge `server.ts` 从未实现该路由，
导致每次调用都抛异常，静默 fallback 到 VS Code API 读文件。

#### 修复内容

**`bridge-client.ts`** — spawn bridge 时传入 `WORKSPACE_ROOT`：
```typescript
_bridgeProc = cp.spawn('node', [serverJs], {
  cwd: bridgeDir,
  env: { ...process.env, HEADLESS: 'true', WORKSPACE_ROOT: wsRoot },
  ...
});
```

**`bridge/src/server.ts`** — 新增两个路由：

```typescript
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? process.cwd();

// 安全检查：防止路径遍历攻击
function safeResolve(relOrAbs: string): string | null {
  const abs = nodePath.isAbsolute(relOrAbs)
    ? nodePath.normalize(relOrAbs)
    : nodePath.resolve(WORKSPACE_ROOT, relOrAbs);
  return abs.startsWith(WORKSPACE_ROOT + nodePath.sep) ? abs : null;
}

// GET /index/file?path=<rel-or-abs>   — 读文件内容（≤ 512KB）
app.get('/index/file', (req, res) => { ... });

// GET /index/search?q=<name>&limit=20 — 按文件名片段搜索工作区
app.get('/index/search', (req, res) => { ... });
```

`/index/search` 递归遍历工作区，跳过 `node_modules/.git/dist/build` 等目录，
按 `relPath.toLowerCase().includes(query)` 匹配，返回 `{ files: string[] }`。

### 12.2 关于"真正的 L4"（语义搜索）

#### DeepSeek API 有没有 Embeddings？

**没有**。DeepSeek 公开 API 只有 `/v1/chat/completions`，没有 `/v1/embeddings` 端点，
无法用传统向量数据库实现语义搜索。

#### 用 DeepSeek Chat API 实现 LLM 辅助检索（v7 计划）

思路：利用 LLM 本身的理解能力，替代向量相似度排名。

```
Phase 1：建立轻量文件 index（后台扫描）
  每个文件提取：
    - 文件路径 + 语言类型
    - 顶层符号名（regex 提取：function/class/interface/export const）
    - 前 500 字符（文件头注释 / 导入）
  存储到 .deepseek/file-index.json（每次 VS Code 启动后台更新）

Phase 2：agent 需要相关文件时，调用 DeepSeek
  prompt:
    "给定以下任务描述：${task}
     下面是工作区文件索引（路径 + 顶层符号）：
     ${JSON.stringify(index.slice(0, 200))}
     请列出最相关的 5 个文件路径（只返回 JSON 数组）"
  LLM 返回 ["src/extension.ts", "src/agent-loop.ts", ...]

Phase 3：把这些文件内容注入 agent 上下文
  通过已有的 onReadFile 读取，注入 buildAnalyzePrompt
```

这方案的优势：
- 不需要向量库，完全基于现有 DeepSeek Chat API
- 文件索引是纯文本 JSON，轻量、可读、可 git 管理
- LLM 理解语义比关键字匹配精准得多

**v7 预计实现的新文件：**
- `src/file-indexer.ts` — 扫描 + 维护 `.deepseek/file-index.json`
- `src/semantic-search.ts` — 调用 DeepSeek API 做 LLM 辅助检索
- 在 `buildAnalyzePrompt` 中注入检索到的相关文件内容

### 12.3 v6 编译结果

- bridge 编译：`tsc` 零错误
- 扩展编译：`dist/extension.js 333.8kb ⚡ Done in 80ms`
- 安装：✅ 成功

---

## 十三、Intent 路由重构 + 三级习惯学习（2026-05-20 v7）

### 13.1 背景：regex 路由的根本缺陷

原有 `shouldUseAgentMode` 依赖 `ACTION_VERB_RE + CODE_NOUN_RE` 打分来判断是否进入 agent 模式。
这种方式有根本性缺陷：中文动词/名词无穷无尽，任何正则都需要手工维护以追上用户表达。

**Copilot 的方案**：独立 UI 入口（Edit / Chat / Inline），用户选择入口 = 声明 intent，无需推断。  
**Claude Code 的方案**：所有请求一律进 agent loop，LLM 自己决定调哪些工具。  
**本插件的约束**：无独立 UI 入口 → 选择接近 Claude Code 的「默认 agent」方案（Plan A）。

### 13.2 Plan A 实现（`intent-router.ts`）

```typescript
// 修改前：复杂 regex 打分 + 多条件路由（需要手工维护动词表）
export function shouldUseAgentMode(intent, files): boolean {
  if (intent.kind === 'code-change' && !intent.blockers.includes('explicit-no-change')) return true;
  if (files.length === 0) return false;
  ...
}

// 修改后：Plan A，默认 agent，只有明确「不要改」才 chat
export function shouldUseAgentMode(intent, _files): boolean {
  if (intent.blockers.includes('explicit-no-change')) return false; // 用户明确不要改
  return true;  // 其余一切进 agent，LLM Architect 自己决定是否读写文件
}
```

**效果**：彻底消除「`更新`、`添加` 漏判」等 regex 无法穷举的问题。  
**副作用**：纯闲聊也会走 agent loop — 但 Architect 阶段会决定「只回答，不改文件」，行为正确，仅多一次 LLM round-trip。

### 13.3 三级 Intent 习惯学习架构

#### 设计理念对比

| 工具 | 学习机制 | 学习触发 | 持久化 |
|------|---------|---------|-------|
| Copilot | 无自动学习 | 用户手工维护 `.github/copilot-instructions.md` | 文件系统 |
| Claude Code | AI 按需以 `memory_write` 写 CLAUDE.md | 用户纠正 AI 时 AI 自主写入 | 文件系统 |
| DeepSeek v7 | **自动频次学习** | 每次 turn 结束后自动记录、自动升档 | workspaceState + globalState |

本方案超越 Copilot/Claude Code：**使用即学习**，不需要用户手工维护，AI 也不需要主动触发。

#### 三级层次（用户设想的精准实现）

```
┌────────────────────────────────────────────────────────────────────────────┐
│  级别        存储位置                  生命周期        升档条件             │
├────────────────────────────────────────────────────────────────────────────┤
│  L0 Session  进程内存 Map              当前 session    —                    │
│              新 session 时调用                                               │
│              clearSessionHabits() 清空                                     │
├────────────────────────────────────────────────────────────────────────────┤
│  L1 项目级   workspaceState            同一项目跨session  L0 同 pattern     │
│              `deepseek.intentHabits`   重启后自动恢复     ≥2次一致命中      │
├────────────────────────────────────────────────────────────────────────────┤
│  L2 插件级   globalState               跨项目永久生效   L1 跨≥3个不同       │
│              `deepseek.globalIntentHabits`               session 一致       │
└────────────────────────────────────────────────────────────────────────────┘
```

**查找顺序**：L2（插件级）→ L1（项目级）→ L0（session 级）→ Plan A 兜底

#### 防歧义机制

```typescript
// 同一 patternKey 在同一 session 内出现相互矛盾的 kind（有时 code-change / 有时 chat）
// → rec.conflicts++ → 该 session 内不允许升档
// 保障：只有「稳定一致」的 intent 才会被持久化
```

#### Pattern Key 设计（无 LLM 调用，O(n) 扫描）

```
"更新 code 目录下的 cpp 程序"  → patternKey = "更新+程序"
"修复 Fighter.cpp 中的 bug"   → patternKey = "修复+cpp"
"帮我看看这段代码"             → patternKey = "代码"
```

#### 新增文件：`src/intent-learner.ts`

```typescript
export function clearSessionHabits(): void           // 新 session 时清空 L0
export function lookupLearnedIntent(prompt, ctx): LearnedKind | null  // L2→L1→L0 查找
export function recordIntentOutcome(prompt, kind, sessionId, ctx): void  // 记录+自动升档
export function getLearnedHabitsSummary(ctx): string // 调试用：查看学习状态
```

### 13.4 extension.ts 集成点

```typescript
// ① 新 session 时清空 L0
clearSessionHabits();

// ② 每次 chat 开始：学习结果优先于 regex
let intent = decideChatIntent(prompt);
const _learnedKind = extContext ? lookupLearnedIntent(prompt, extContext) : null;
if (_learnedKind !== null) {
  intent = { ...intent, kind: _learnedKind, signals: ['learned-habit', ...intent.signals] };
}

// ③a Agent 完成后记录 code-change
recordIntentOutcome(prompt, 'code-change', activeSessionId, extContext);

// ③b Chat finally 块记录实际 kind
recordIntentOutcome(prompt, intent.kind, activeSessionId, extContext);
```

### 13.5 用户设想检讨：三级是否正确？

用户提出：`session级别 → 项目级别 → deepseek插件级别`

| 用户设想 | 实现对应 | 评价 |
|---------|---------|------|
| session 级别（单次 session 内都能用）| L0：`_sessionHabits` 内存 Map，当前 session 立即生效 | ✅ 正确，最快 |
| 项目级别（同一项目都能用）| L1：`workspaceState` `deepseek.intentHabits`，当前 workspace 持久 | ✅ 正确，项目隔离 |
| deepseek 插件级别（其他项目都能用）| L2：`globalState` `deepseek.globalIntentHabits`，全部 workspace 共享 | ✅ 正确，跨项目 |

**为什么三级而不是两级更好**：  
若只有「session + 全局」两级，一次偶发的误判就可能污染全局记忆。  
L1 项目级作为中间缓冲层，确保 pattern 在「同一项目多个 session 中一致确认」后才升级为全局习惯。  
这是软件设计「分级验证」的经典思路 — Claude Code 的 `memory_write` 分 `facts.md` / `preferences.md` 也是类似逻辑，按重要程度分层隔离。

### 13.6 v7 编译结果

- 编译：`dist/extension.js 340.7kb ⚡ Done in 91ms`
- 安装：✅ `~/.vscode/extensions/deepseek-netai.deepseek-netai-0.2.0/dist/extension.js`
- 新增文件：`src/intent-learner.ts`
- 修改文件：`src/intent-router.ts`（`shouldUseAgentMode` 精简），`src/extension.ts`（三处集成）

---

## 十四、Universal Learning Bus — 全维度自动学习架构（2026-05-20 v8）

### 14.1 背景：意图学习只是冰山一角

v7 的 `intent-learner.ts` 只学习了一个维度：用户的意图路由（code-change vs chat）。  
一个真正达到顶级水平的 AI 编程助手，应当能从**所有可观测的 agent 事件**中持续学习：

| 维度 | 学习什么 | 如何使用 |
|------|---------|---------|
| A · 工具调用 | 哪些工具在哪类请求中成功率高 | 未来偏向已验证的工具链 |
| B · Shell 命令 | 哪些命令在本项目中成功执行 | 下次编译/运行优先推荐 |
| C · 错误→修复 | 相同错误指纹对应什么修复策略 | 注入历史修复参考到修复提示词 |
| D · 文件共变 | 哪些文件经常一起被修改 | 提示 AI 关注同组文件 |

### 14.2 对标分析：主流智能体的学习机制

| 系统 | 学习机制 | 学习范围 | 自动程度 |
|------|---------|---------|---------|
| **GitHub Copilot** | 无自动学习。用户手写 `.github/copilot-instructions.md` | 仅 prompt context | 手动 ❌ |
| **Claude Code** | AI 主动调用 `memory_write` 工具写入 `CLAUDE.md` | facts + preferences | 被动（需 AI 主动触发）⚠️ |
| **Cursor** | `.cursorrules` 文件 + 从 pain-points 自动建议添加规则 | Cursor Rules | 半自动 ⚠️ |
| **Windsurf / Cascade** | "Memories" 功能，自动捕获项目特定事实 | 项目 + 全局 | 自动 ✅ |
| **Devin** | Organizational Memory + Runbooks，团队级知识库 | 团队级、最丰富 | 自动 ✅ |
| **本插件 v8** | 频次驱动自动晋升，覆盖全 4 维度，三级存储 | session/project/plugin | 全自动 ✅✅ |

**关键差异**：Copilot/Claude Code/Cursor 本质上都是**被动/手动**的 — 需要用户或 AI 主动触发写入。  
Windsurf Cascade Memories 最接近我们的模型，但覆盖维度有限。  
本插件 v8 是**频次自动晋升 + 4 维度全覆盖**，设计完整度超过现有主流方案。

### 14.3 架构设计：Event Bus + 三级存储

```
┌─────────────────────────────────────────────────────────┐
│              Agent 可观测事件（4 维度）                   │
│                                                         │
│  shell 命令成功                文件集合共变              │
│  ─────────────             ─────────────────           │
│  command_succeeded          files_cochanged             │
│                                                         │
│  错误被修复成功              工具调用结果                 │
│  ──────────────             ───────────────            │
│  error_fixed                tool_called                 │
└──────────────────────┬──────────────────────────────────┘
                       │ emitLearningEvent(event)
                       ▼
┌─────────────────────────────────────────────────────────┐
│           Universal Learning Bus (agent-learner.ts)     │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   L0：RAM    │  │  L1: WS.     │  │  L2: Global  │  │
│  │  session 级  │→ │  project 级  │→ │  plugin 级   │  │
│  │  Map<cmd,n>  │  │  wsSta       │  │  globalState │  │
│  │  (立即可用)   │  │  te keys     │  │  (跨项目)    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                  晋升条件：≥3 个不同 session 成功        │
└──────────────────────┬──────────────────────────────────┘
                       │ Query API
                       ▼
┌─────────────────────────────────────────────────────────┐
│              注入到 LLM 提示词                           │
│                                                         │
│  getCommandHints()   → 编译/运行提示词【已知成功命令】   │
│  getErrorFixHint()   → 修复提示词【历史同类错误修复参考】 │
│  getCoChangedFiles() → 任务分解【相关文件提示】          │
│  getLearnerSummary() → 诊断面板显示                     │
└─────────────────────────────────────────────────────────┘
```

### 14.4 四维度存储键设计

| 存储键 | 层级 | 数据形状 | 描述 |
|--------|------|---------|------|
| `deepseek.learn.toolStats` | L1 workspaceState | `ToolStatRecord[]` | 工具调用成功/失败统计 |
| `deepseek.learn.commandLib` | L1 workspaceState | `CommandRecord[]` | 项目成功命令库 |
| `deepseek.learn.filePairs` | L1 workspaceState | `FilePairRecord[]` | 文件共变对 |
| `deepseek.learn.errorFixes` | L1 workspaceState | `ErrorFixRecord[]` | 错误指纹→修复摘要 |
| `deepseek.learn.global.commandLib` | L2 globalState | `CommandRecord[]` | 跨项目稳定命令（≥3 session） |

### 14.5 晋升逻辑（命令库为例）

```
Session S1: npm run compile 成功 → L0 sessionCmds++，L1 commandLib[sessionCount=1]
Session S2: npm run compile 成功 → L1 commandLib[sessionCount=2]
Session S3: npm run compile 成功 → sessionCount=3 ≥ GLOBAL_PROMOTE_THRESHOLD
                                  → 自动晋升到 L2 globalState commandLib
                                  → 其他项目也能受益于该命令
```

### 14.6 集成点清单（extension.ts / agent-loop.ts）

| 集成位置 | 调用 | 作用 |
|---------|------|------|
| `activate()` | `initAgentLearner(context)` | 初始化，绑定 ExtensionContext |
| 新 session 块（`clearSessionHabits()` 旁） | `clearLearnerSession()` | 清空 L0 session 缓存 |
| `localResult.ok` 成功分支 | `emitLearningEvent({type:'command_succeeded',...})` | 记录成功命令 |
| `lastAgentChangedPaths` 赋值后 | `emitLearningEvent({type:'files_cochanged',...})` | 记录共变文件 |
| `runClosedLoopRepair` 验证 ok 时 | `emitLearningEvent({type:'error_fixed',...})` | 记录错误修复模式 |
| `buildAnalyzePrompt`（exec 任务）| `getCommandHints('compile')` 注入 | AI 优先使用已验证命令 |
| `buildExecutionRepairPrompt` 调用前 | `getErrorFixHint(localResult.output)` 注入 | AI 参考历史修复经验 |

### 14.7 错误指纹算法

```typescript
// 从错误输出中提取关键行（去掉路径/行号等噪声）形成稳定指纹
export function fingerprintError(output: string): string {
  const lines = output.split('\n');
  const keyLines = lines
    .filter(l => /error:|fatal:|undefined reference|cannot find/i.test(l))
    .map(l => l.replace(/\/[^\s:]+:\d+:\d*/g, '<loc>').trim()) // 去路径/行号
    .filter(Boolean)
    .slice(0, 3);           // 最多取 3 行作为指纹
  return keyLines.join(' | ') || output.slice(0, 80);
}
```

同一类编译错误（如 `undefined reference to main`）在不同项目产生相同指纹，修复经验可跨 session 复用。

### 14.8 v8 编译结果

- 新增文件：`src/agent-learner.ts`
- 修改文件：`src/extension.ts`（6 处集成），`src/agent-loop.ts`（1 处注入）
- 编译：`dist/extension.js 348.1kb ⚡ Done in 283ms`
- 安装：✅ `~/.vscode/extensions/deepseek-netai.deepseek-netai-0.2.0/dist/extension.js`

---

## 十五、参照系官方文档核实修订（2026-05-26 v9）

> **背景**：本节依据 2026 年官方文档（code.visualstudio.com/docs/copilot + code.claude.com/docs）
> 对 §一（Copilot）和 §二（Claude Code）的内容进行系统性核实与修订。
> 原有章节保留历史价值，本节提供 2026 年官方权威实现对比。

---

### 15.1 GitHub Copilot 记忆体系统（2026 官方实现）

#### L1a — 对话历史（VS Code Chat API 自动管理）

与 §一 描述基本一致，但细节更准确：
- VS Code Chat API 自动将每轮 turn 存入内部 `workspaceState`（VS Code 自管理）
- **重启后历史依然存在**，多 session 并发（已成为标准功能）
- Session List 视图列出所有 session，按时间分组（Today / Last Week 等）

#### L1b — 上下文压缩（⚠️ §一原文错误：Copilot 已有 compact 机制）

**§一 原文谬误**："Copilot 没有专门的摘要压缩机制，只截断，不摘要"—— **此说法已过时**

**官方现状（code.visualstudio.com，2026）**：

```
自动压缩（github.copilot.chat.summarizeAgentConversationHistory.enabled，默认 true）：
  - 上下文窗口满时，VS Code 自动摘要较早的对话消息
  - 透明地在后台进行，不打断对话

手动压缩（/compact 命令，与 Claude Code 同名！）：
  - /compact                              # 直接压缩
  - /compact focus on database schema     # 附加指令，指导摘要方向
  - 点击输入框中的上下文窗口指示器 → "Compact Conversation"

上下文窗口可视化指示器（2026 新增）：
  - 输入框显示已用 token / 总 token（如 15K/128K）
  - hover 显示按分类的详细 token 分配
  - 不同模型总量不同（模型越大上限越高）
```

#### L2 — Session 管理（⚠️ §一"Working Set"描述已过时）

**§一 原文谬误**：描述 `workspaceState.update('github.copilot.workingSet', ...)` 是 Copilot Edits 内部旧 API，
当前版本的 session/context 机制如下：

**官方 Session 管理（2026 完整功能）**：

| 功能 | 说明 | 操作方式 |
|------|------|----------|
| 新建 Session | 独立上下文窗口，可选 agent/permission level | New Chat (+) 或 Ctrl+N |
| Session List | 按时间分组，显示状态/文件变更 | Chat view 侧边栏 |
| Archive | 归档（非删除），可随时取消归档 | hover → Archive |
| Delete | 永久删除（不可撤销） | 右键 → Delete |
| Fork Session | 从整个 session 或某 checkpoint 派生新 session | `/fork` 或 checkpoint 处 Fork 按钮 |
| Export JSON | 导出完整对话为 JSON 文件 | Chat: Export Chat... |
| Save as Prompt | 保存为 `.prompt.md` 可复用提示词模板 | `/savePrompt` |
| Queue/Steer/Stop | 运行中额外发消息：排队/引导/终止+重发 | Send 按钮下拉菜单 |
| Session 状态指示器 | 标题栏显示未读/进行中 badge | `chat.agentsControl.enabled` |
| Session 持久性 | sessions 跨重启：每个 workspace 独立 session 列表 | 自动 |

**Session 间完全隔离**：每个 session 独立上下文，不跨 session 共享历史

#### L3 — 持久记忆

与 §一 基本一致：
- `.github/copilot-instructions.md`：项目规则，每次 session 注入 system prompt
- `settings.json`：用户偏好配置
- **仍无 AI 可写机制**：Copilot 不能自主修改记忆文件（2026 确认未变）

---

### 15.2 Claude Code 记忆体系统（2026 官方实现）

> 数据来源：code.claude.com/docs/en/memory（2026-05-26 官方文档）

#### 两大记忆系统对照

| 属性 | CLAUDE.md（用户撰写）| Auto Memory（Claude 自主）|
|------|--------------------|-----------------------------|
| 谁写 | 用户 | Claude |
| 内容 | 指令和规则 | 学习到的模式和知识 |
| 作用域 | 项目/用户/组织 | 按 git 仓库（跨 worktree 共享）|
| 加载时机 | 每次 session 完整加载 | 每次 session 加载 MEMORY.md 前 200 行或 25KB |
| 适用场景 | 编码规范、工作流、架构说明 | 编译命令、调试洞见、Claude 发现的偏好 |

#### CLAUDE.md 文件 4 级作用域（⚠️ §二原文只描述了 2 级）

```
优先级（由低→高，越靠近工作目录优先级越高）：

1. 组织级 policy（IT 管理，无法被用户排除）：
   macOS:  /Library/Application Support/ClaudeCode/CLAUDE.md
   Linux:  /etc/claude-code/CLAUDE.md

2. 用户级（跨所有项目）：
   ~/.claude/CLAUDE.md
   ~/.claude/rules/preferences.md  （用户级规则目录）

3. 项目级（团队共享，提交版本控制）：
   ./CLAUDE.md  或  ./.claude/CLAUDE.md

4. 本地个人项目级（加入 .gitignore）：
   ./CLAUDE.local.md
```

加载顺序：从文件系统根到工作目录，所有文件**合并**（不覆盖）注入上下文。
子目录中的 CLAUDE.md 不在 startup 加载——当 Claude 读取该子目录文件时才触发。

#### .claude/rules/ 路径作用域规则（§二完全未提及）

```markdown
# .claude/rules/api-security.md  ← path-scoped 示例
---
paths:
  - "src/api/**/*.ts"
  - "src/**/*.{ts,tsx}"
---

# API 开发规范
- 所有端点必须包含输入校验
- 使用标准错误响应格式
```

- **无 `paths:` frontmatter**：每次 session 启动加载（≈ 等同 CLAUDE.md）
- **有 `paths:`**：只在 Claude 读到匹配路径文件时才加载（节省 token）
- 用户级规则：`~/.claude/rules/`目录下所有 `.md`，优先级低于项目规则
- `/init` 命令：分析代码库自动生成初始 CLAUDE.md

#### Auto Memory（⚠️ §二 L3 描述严重错误）

**§二 原文谬误**：
```
// 错误描述：
~/.claude/memory/
  facts.md       ← AI 写入
  preferences.md ← AI 写入

// 错误的 tool 格式：
[TOOL:memory_write {"content":"..."}]
```

**实际实现（Claude Code v2.1.59+，官方 2026）**：

```
存储路径（按 git repo 隔离）：
~/.claude/projects/<git-repo-derived-path>/memory/
  MEMORY.md          ← 主入口 index，每次 session 加载前 200 行/25KB
  debugging.md       ← Claude 自主创建的主题文件（按需读取，非 startup 加载）
  api-conventions.md ← Claude 自主创建的主题文件
  ...                ← 其他 Claude 自主创建的文件

关键特性：
  - Claude 用标准文件工具（Read/Write）读写 MEMORY.md
  - Claude 自主决定何时写入，不需要用户触发
  - MEMORY.md 为 index 文件；详细内容拆分到主题文件（按需读取）
  - 主题文件读取是 on-demand（非 session startup 全量加载）
  - 机器级本地存储，不跨机器同步
  - 同一 git repo 所有 worktrees 共享同一 memory 目录

/memory 命令：
  - 列出本次 session 加载的所有 CLAUDE.md、rules、auto memory 文件
  - 切换 autoMemoryEnabled 开关
  - 提供 auto memory 文件夹链接以供编辑
```

**Auto Memory 开关**：
```json
// .claude/settings.json（或用户 ~/.claude/settings.json）
{ "autoMemoryEnabled": false }

// 环境变量
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
```

#### Session 持久化与 CLI 标志

**§二 原文 JSON 格式**是简化推测，以下为官方 CLI 实现：

```bash
# ─── 基本 session 管理 ────────────────────────────────────
claude                          # 新建交互 session
claude -c                       # 继续当前目录最近的 session（--continue）
claude -r "session-name"        # 按名称或 session ID 恢复（--resume）
claude -n "my-feature"          # 命名启动，后续 -r my-feature 恢复（--name）
claude --fork-session -r name   # 恢复时创建 fork，不修改原 session

# ─── 后台 session ─────────────────────────────────────────
claude --bg "task description"  # 后台非交互 session，返回 session ID
claude agents                   # 监控所有后台 session 的面板
claude agents --json            # JSON 输出（用于脚本集成）
claude attach <id>              # 附加到后台 session 的终端
claude logs <id>                # 查看后台 session 输出
claude stop <id>                # 停止后台 session

# ─── session 数据清理 ─────────────────────────────────────
claude project purge [path]     # 删除项目所有本地 AI 状态：
                                # transcript、task list、debug log、
                                # file-edit history、prompt history
claude project purge --dry-run  # 预览删除内容（不实际删除）
```

#### Compaction 后内容存活规则

```
存活（从磁盘重新注入）：
  ✅ 系统 prompt 和 output style：不在消息历史中，不受 compact 影响
  ✅ 项目根 CLAUDE.md + 无 paths: 的规则：从磁盘重新 inject
  ✅ Auto memory (MEMORY.md)：从磁盘重新 inject

部分存活（有条件）：
  ⚠️ Skill 内容：重注入，但每 skill ≤5000 token，总 ≤25000 token

压缩后丢失（需等触发条件才重加载）：
  ❌ path-scoped 规则：等 Claude 读到匹配文件时才重加载
  ❌ 子目录 CLAUDE.md：等 Claude 读该子目录文件时才重加载
```

---

### 15.3 原文主要错误清单

| 章节 | 原文错误 | 2026 官方实际情况 |
|------|---------|-----------------|
| §一 L1b | "Copilot 没有专门的摘要压缩机制，只截断，不摘要" | 有 `/compact` 手动压缩 + `summarizeAgentConversationHistory` 自动压缩 |
| §一 L2 | `workspaceState.update('github.copilot.workingSet', ...)` | 该 API 属旧 Copilot Edits 内部细节，已不适用当前描述；当前 Copilot 用 Session List + #-mentions |
| §二 L3 | `~/.claude/memory/facts.md` 和 `preferences.md` | 实际：`~/.claude/projects/<git-root>/memory/MEMORY.md` + topic 文件 |
| §二 L3 | `memory_write` 是显式工具调用格式 `[TOOL:memory_write {...}]` | Claude Code 用**标准文件操作工具**读写 MEMORY.md，无显式 memory_write 工具 |
| §二 L1a | 展示了推测性 JSON session 文件格式 | 官方未公开 session 存储格式；通过 CLI 标志管理（`-c`/`-r`/`-n`）|
| §二 — | 未提及 CLAUDE.md 4 级作用域 | 实际有：组织级/用户级/项目级/本地级 4 级 |
| §二 — | 未提及 `.claude/rules/` path-scoped 规则 | 这是 Claude Code 重要的 context 节省机制 |
| §十四 表 | "Claude Code: AI 主动调用 `memory_write` 工具写入 CLAUDE.md" | 写入的是 **MEMORY.md**（auto memory），工具是标准文件操作，非专属 memory_write |

---

### 15.4 Copilot vs Claude Code vs DeepSeek 对照表（2026 修订版）

| 维度 | GitHub Copilot（官方 2026）| Claude Code（官方 2026）| DeepSeek v8（当前）|
|------|--------------------------|------------------------|-------------------|
| **L1a 历史** | VS Code Chat API 托管，多 session 并发 | 进程内存；`-c`/`-r` 持久到磁盘 | `nonBridgeChatHistory` + `workspaceState` |
| **L1b 压缩** | ✅ 自动（满时摘要）+ 手动 `/compact` | ✅ 手动 `/compact` + 自动（满时）；rules/memory 自动重注入 | `compactAndSaveHistory()` LLM 摘要，≥40 条自动触发 |
| **L2 文件上下文** | #-mentions + workspace 自动索引；session 隔离 | 进程内 `recentFiles`（不持久）；工作目录解析 | `sessionRecentFiles` Map + `workspaceState` 持久 |
| **L3 用户规则** | `.github/copilot-instructions.md`；无 path-scoped | CLAUDE.md **4 级作用域** + `.claude/rules/`（**path-scoped**）| `.deepseek/rules.md`（单级，无 path-scoped）|
| **L3 AI 可写** | ❌ 无 | ✅ **Auto Memory**（v2.1.59+）：自主写 MEMORY.md + 主题文件，startup 加载头 200 行/25KB | `.deepseek/memory.md`（`memory_write` 工具触发 append）|
| **Compact 恢复** | 对话摘要；无精确 reload 机制 | ✅ project-root CLAUDE.md + Auto Memory 从磁盘精确重注入 | 摘要注入 history[0] 作为背景，不 reload rules |
| **多 session** | ✅ 完整 Session List，archive/fork(`/fork`)/export | CLI `-n` 命名，`-r` 恢复，`--bg` 后台，`agents` 面板 | workspaceState 多 session UI |
| **重启恢复** | ✅ VS Code Chat API 自动 | ✅ CLI `-c`/`-r` 恢复完整 transcript | ✅ `initOrRestoreSession()` |

---

### 15.5 DeepSeek 插件与 Claude Code 的关键差距

| 差距项 | Claude Code 实现 | DeepSeek 现状 | 建议优先级 |
|--------|-----------------|--------------|-----------|
| **Auto Memory 目录隔离** | 按 `git-root` 隔离到 `~/.claude/projects/<p>/memory/`；MEMORY.md 为 index + 主题文件 | 单文件 `.deepseek/memory.md`（append 模式，无 index）| P2 |
| **CLAUDE.md 4 级作用域** | 组织/用户/项目/本地，按层级合并 | 仅项目级 `.deepseek/rules.md` | P3 |
| **Path-scoped 规则** | `.claude/rules/*.md` + YAML `paths:` frontmatter，节省 token | 无 | P3 |
| **Compact 后 rules 重注入** | project-root rules/memory 从磁盘重读，始终最新 | 摘要一次注入，不 reload rules | P2 |
| **Session 命名与恢复** | `claude -n "name"` 命名，`-r name` 精确恢复 | session 用时间戳 ID，UI 中仅前 50 字 title | P2 |
| **后台 session** | `claude --bg`，daemon 管理，`agents` 面板并发监控 | 无 | P4 |
