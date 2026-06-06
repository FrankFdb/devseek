# deepseek-netai 智能体架构问题全面分析与重设计方案

> 基于 2026-05-08 实测对话日志及完整源码分析  
> 对标目标：GitHub Copilot Edits / Cursor Agent / Aider  
> 本文档同时作为下一阶段代码重构的实施规范

---

## 目录

1. [核心架构现状](#1-核心架构现状)
2. [实测问题清单（10项）](#2-实测问题清单)
3. [根本性架构缺陷分析](#3-根本性架构缺陷分析)
4. [重设计架构方案](#4-重设计架构方案)
5. [各模块修改规范](#5-各模块修改规范)
6. [实施优先级与路线图](#6-实施优先级与路线图)
7. [Copilot / Cursor 参考实现对标与最优方案评估](#7-copilot--cursor-参考实现对标与最优方案评估)

---

## 1. 核心架构现状

### 1.1 当前数据流

```
用户输入 (prompt + @files)
    │
    ▼
runChat()                              ← extension.ts 单一入口
    │
    ├─ decideChatIntent(prompt)        ← intent-router.ts：评分路由
    │
    ├─[有files] shouldUseAgentMode()
    │      │
    │      ├─[true]  两阶段 Agent Loop
    │      │           Phase-0: decomposeTask()   ← agent-task-decomposer.ts
    │      │           Phase-1: runAgentLoop()    ← agent-loop.ts
    │      │
    │      └─[false] 单轮单次 chat()               ← bridge-client.ts
    │
    ├─ emitResponseMeta(raw)           ← 无条件解析文件候选
    │
    └─ webview.postMessage(endResponse)

webview.js
    │
    └─ endResponse handler
         │
         ├─[isAgentMode] 跳过文件检测
         └─[其他] parseGeneratedArtifacts()  ← 可能误检分析正文
```

### 1.2 关键文件职责

| 文件 | 职责 | 代码量 |
|------|------|--------|
| `extension.ts` | 入口、消息路由、PendingEdits管理 | ~2000行 |
| `agent-loop.ts` | Phase-1执行器（Editor角色） | ~800行 |
| `agent-task-decomposer.ts` | Phase-0规划器（Architect角色） | ~280行 |
| `intent-router.ts` | 意图分类与模式路由决策 | ~180行 |
| `generated-file-parser.ts` | LLM响应→文件候选解析 | ~500行 |
| `workspace-applier.ts` | 文件变更应用、write drift检测 | ~400行 |
| `webview.js` | 聊天UI、Agent状态卡片渲染 | ~大文件 |

---

## 2. 实测问题清单

### 问题 P1（严重）：分析响应污染文件检测管道，导致无意写入文件

**触发场景**：用户请求"分析 lifting/maintenance 目录下所有 .hpp 文件"

**实测现象**：
```
检测到 6 个文件候选
已完成：识别 6 个候选，待确认 6 个文件
8 files changed  +92 -0        ← 纯分析内容被写入磁盘！
```

**根因链**（逐层追踪）：

```
① decideChatIntent("分析...所有.hpp文件")
     → score 偏低（无 ACTION_VERB_RE 强命中）
     → kind='chat' 但 shouldUseAgentMode=true（因有files）
     
② decomposeTask() → Architect 将所有文件分类为 analyze

③ executeAnalysisConsolidated() → 流式分析响应
     响应中含大量 "1. maintenance_data_collector.hpp — 数据采集"
     等序号+文件名格式

④ runAgentLoop 主循环执行 callbacks.onResponseMeta(result.raw)
     ↓（无条件调用）
     emitResponseMeta(raw) → parseGeneratedArtifacts(raw)
     ↓
     PATH_LINE_PATTERNS[1] 匹配 "\d+[.)]\s+文件名" → 提取文件路径
     ↓
     响应正文被识别为"6个文件候选"

⑤ webview.js endResponse handler
     isAgentMode 因消息竞态可能为 false
     → 触发文件面板 → 用户点击 "Keep" → +92 行写入磁盘
```

**波及范围**：每次分析多个文件都会复现，是高频场景。

---

### 问题 P2（严重）：跨 workspace 根目录写入漂移

**触发场景**：分析 `/home/ff/uav/tars/...` 目录文件（第二个 workspaceFolder），在 deepseek_netai 项目中操作

**实测现象**：
```
maintenance_reset_handler.hpp  deepseek_netai •  +45 -0
maintenance_manager.hpp        deepseek_netai   +6 -0
```
文件被写入 `deepseek_netai/deepseek_netai/` 而非原始路径。

**根因**：`workspace-applier.ts` 中 `getWorkspaceRoot()` 固定取 `workspaceFolders[0]`；`preferredAbsolutePaths` 属于第二个 workspace root 时，路径解析基准错误，`detectWriteDrift` 门槛不足以拦截跨根漂移。

---

### 问题 P3（严重）：`runAgentLoop` 对 analyze/explain 任务无条件 emit responseMeta

**根因代码**（[agent-loop.ts](../packages/vscode-extension/src/agent-loop.ts)，主循环末尾）：
```typescript
// 问题：无论 task.action 是什么，都 emit
if (result.raw) {
  await callbacks.onResponseMeta(result.raw);  // ← analyze任务不应emit
}
```

**影响**：混合任务（analyze + modify）场景下，analyze 任务的分析文本再次喂给文件检测管道。

---

### 问题 P4（中）：用户描述目录路径时插件无法拾取文件内容

**触发场景**：
```
"在 tars/huida_uav/src/oam/src/pump_sprayer 目录下分析代码"
```
**实测现象**：未触发 Agent Mode（无 `@file` 附件），LLM 回复"由于您没有提供文件内容，进行推断性分析"，给出虚构代码分析。

**根因**：插件完全依赖 `@file` 面板显式挂载，不识别 prompt 中的目录路径引用。

---

### 问题 P5（中）：`startResponse` 未携带响应类型，webview 靠后续消息推断竞态

**根因代码**（extension.ts）：
```typescript
webview.postMessage({ type: 'startResponse', prompt, expectGeneratedArtifacts: true });
// Agent 状态在之后的 postAgent() 才设置 isAgentMode = true
// 若 endResponse 因异步到达顺序问题先于 agentStatus 消息处理，isAgentMode 仍为 false
```

**影响**：`isAgentMode` 存在竞态窗口，偶发性触发错误的文件检测面板。

---

### 问题 P6（中）："创建+编译+运行"无附件场景未走自动执行路径

**触发场景**：
```
"在 code 目录下编译一个 C++ 程序，打印 hello air，并编译，自动运行给出结果"
```
**实测现象**：LLM 给出步骤说明而非直接执行；最终需要用户手动点 Keep 写文件，未自动编译运行。

**根因**：`shouldPreferLocalExecution` 当 `files.length === 0` 时，须靠 `discoverPromptCandidates` 从 prompt 提取文件路径；但"新建文件"场景文件不存在，`fs.existsSync` 返回 false → `normalized.length === 0` → `localPlan = null`。

---

### 问题 P7（中）：`PATH_LINE_PATTERNS` 序号列表项规则误匹配分析章节标题

**问题正则**：
```typescript
/^\d+[.)]\s+`?([^`\n]+?)`?(?:\s*[-—–:：].*)?$/
```
同时命中：
- 生成意图（期望命中）：`1. Animal.h` / `2. Dog.cpp`
- 分析章节（误命中）：`2. maintenance_data_collector.hpp — 数据采集`

无法在词法层区分两种上下文。

---

### 问题 P8（低）：Phase-0 Architect 使用 `newSession: true` 破坏用户对话连续性

**根因代码**（agent-task-decomposer.ts）：
```typescript
raw = await chat({ prompt: systemPrompt, newSession: true, ... });
// 每次 Phase-0 都清空 DeepSeek 当前对话
```
用户在多轮对话中追问时，历史被破坏。

---

### 问题 P9（低）：`readFileContentSafe` 返回空字符串时静默降级

**根因**：
```typescript
export function readFileContentSafe(absPath: string): string {
  try { ... } catch { return ''; }  // 静默返回空
}
```
`buildAnalyzePrompt` / `buildEditorPrompt` 收到空 `currentContent` 时不报错，LLM 用空内容上下文生成响应，质量大幅下降但用户无感知。

---

### 问题 P10（中）：`emitResponseMeta` 被无条件调用，对 chat/analyze 意图无门卫

**根因代码**（extension.ts，单轮路径末尾）：
```typescript
await emitResponseMeta(webview, finalResponse);  // ← 无论 intent.kind 是什么
```
分析类响应含代码块时，`parseGeneratedArtifacts` 必定提取路径，触发文件面板。

---

## 3. 根本性架构缺陷分析

### 3.1 缺陷一：意图对象未贯穿全流程

`decideChatIntent()` 返回 `ChatIntentDecision`，但该对象只在 `runChat()` 局部使用，**不传递给**：
- `emitResponseMeta()`
- webview 的 `startResponse` 消息
- `workspace-applier` 的 `prepareChanges()`

结果：管道下游各环节各自重新推断意图，形成多处独立判断，必然产生矛盾。

**Copilot 标准做法**：意图对象作为请求上下文 `RequestContext` 贯穿全流程每一个决策点。

---

### 3.2 缺陷二：响应类型由解析结果反推，而非在响应开始时声明

```
当前：startResponse → 流式输出 → endResponse → 解析内容 → 猜测是否有文件
正确：startResponse(responseType='generation'|'analysis') → 流式输出 → endResponse
```

Copilot 在 `startResponse` 时就携带响应类型，webview 从第一帧起就知道该走哪条渲染路径，无竞态。

---

### 3.3 缺陷三：`generated-file-parser` 被过于宽泛地调用

`parseGeneratedArtifacts` 使用了多层 fallback（fence → code-comment → context → last-resort词扫描），设计目的是提高召回率，但在**非生成场景**（分析、解释、聊天）中被调用时，高召回率变成了高误检率。

正确做法：该函数只应在 `responseType === 'generation'` 时被调用。

---

### 3.4 缺陷四：multi-root workspace 支持缺失

`getWorkspaceRoot()` 固定返回 `workspaceFolders[0]`，对于有多个根目录的工作区（这正是 tars + deepseek_netai 两个项目同时打开的场景）完全不可用。

---

### 3.5 缺陷五：Agent Loop 缺少"无附件快速创建"路径

当用户说"帮我在 X 目录新建一个 C++ 程序并运行"时，正确流程应该是：
1. Agent 理解意图 → 生成文件内容
2. 写入磁盘
3. 本地编译运行

当前架构没有这条路径——无附件时跳过 Agent Mode，单轮模式生成文件后还需用户手动点 Keep。

---

## 4. 重设计架构方案

### 4.1 核心设计原则

```
原则一：意图单例（Intent as First-Class Context）
  ChatIntentDecision 在请求生命周期开始时创建，
  贯穿到每个下游决策点：路由、提示词构建、响应解析、Apply 门卫。

原则二：响应类型前置声明（Response Type at startResponse）
  startResponse 消息携带 responseType，webview 从第一帧起走正确路径，
  消除竞态和事后推断。

原则三：文件解析严格门控（Parse-only-when-generating）
  parseGeneratedArtifacts 只在 responseType='generation' 时调用，
  analysis/chat 路径完全绕过文件解析管道。

原则四：workspace root 跟随附件（Root follows attachments）
  文件写入基准 root 由 preferredAbsolutePaths 的所在 workspace root 决定，
  multi-root 场景精确匹配。

原则五：目录感知（Directory awareness）
  识别 prompt 中的目录路径引用，自动枚举并提示用户附加。
```

### 4.2 新数据流架构

```
用户输入 (prompt + @files)
    │
    ▼
buildRequestContext(prompt, files)     ← 新增：构建请求上下文
    │  返回 RequestContext {
    │    intent: ChatIntentDecision,
    │    responseType: 'generation'|'analysis'|'chat',
    │    effectiveFiles: string[],
    │    workspaceRoot: string,        ← 跟随files所在root
    │    mode: ExecutionMode,
    │  }
    │
    ▼
routeRequest(ctx)                      ← 重构：统一路由
    │
    ├─[mode='agent']    runAgentLoop(ctx)
    ├─[mode='local']    runLocalExecution(ctx)
    ├─[mode='create']   runCreateAndExecute(ctx)   ← 新增
    └─[mode='chat']     runSingleTurnChat(ctx)
    │
    ▼ 每条路径都通过 ctx.responseType 声明
    startResponse({ responseType, ... })
    │
    ▼
    流式输出
    │
    ▼
    endResponse
    │
    ├─[responseType='generation']  → parseGeneratedArtifacts() → 文件面板
    ├─[responseType='analysis']    → 纯 Markdown 渲染，不触发文件面板
    └─[responseType='chat']        → 纯 Markdown 渲染
```

### 4.3 新 `RequestContext` 类型定义

```typescript
// 新增：request-context.ts
export type ExecutionMode =
  | 'agent'       // 两阶段 Architect+Editor，≥1文件
  | 'local'       // 本地编译/运行，有可执行文件
  | 'create'      // 无附件但明确创建+运行意图
  | 'chat';       // 单轮对话

export type ResponseType = 'generation' | 'analysis' | 'chat';

export interface RequestContext {
  /** 原始用户输入 */
  prompt: string;
  /** 用于展示的文本（可能含 @file 展开） */
  userDisplay: string;
  /** 意图分类结果 */
  intent: ChatIntentDecision;
  /** 推断的执行模式 */
  mode: ExecutionMode;
  /** 推断的响应类型（在 startResponse 时传递给 webview） */
  responseType: ResponseType;
  /** 有效附件文件（含continuation继承） */
  effectiveFiles: string[];
  /** 文件写入基准 workspaceFolder uri */
  workspaceRoot: vscode.Uri;
  /** DeepSeek 模式 */
  deepseekMode?: 'fast' | 'r1';
  /** 是否续写上轮任务 */
  isContinuation: boolean;
}
```

### 4.4 `buildRequestContext` 实现规范

```typescript
// 新增函数，替换 runChat 开头的多段零散逻辑
async function buildRequestContext(
  prompt: string,
  userDisplay: string,
  newSession: boolean,
  mode?: 'fast' | 'r1',
  files?: string[],
): Promise<RequestContext> {
  const intent = decideChatIntent(prompt);
  const isContinuation = isContinuationPrompt(prompt);

  // 1. 解析有效文件（含续写继承）
  let effectiveFiles = normalizeConversationFiles(files);
  if (effectiveFiles.length === 0 && isContinuation) {
    effectiveFiles = [...lastConversationFiles];
  }
  if (effectiveFiles.length > 0 && !newSession) {
    lastConversationFiles = [...effectiveFiles];
  }

  // 2. 解析 workspaceRoot（跟随附件所在根目录）
  const workspaceRoot = resolveWorkspaceRootForFiles(effectiveFiles)
    ?? vscode.workspace.workspaceFolders?.[0]?.uri
    ?? vscode.Uri.file('/');

  // 3. 推断执行模式
  const mode_: ExecutionMode = inferExecutionMode(intent, effectiveFiles, prompt, workspaceRoot.fsPath);

  // 4. 推断响应类型（在 startResponse 时使用）
  const responseType = inferResponseType(mode_, intent);

  return { prompt, userDisplay, intent, mode: mode_, responseType,
           effectiveFiles, workspaceRoot, deepseekMode: mode,
           isContinuation };
}

function inferExecutionMode(
  intent: ChatIntentDecision,
  files: string[],
  prompt: string,
  workspaceRoot: string,
): ExecutionMode {
  // 有文件 → Agent
  if (files.length > 0) return 'agent';

  // 无文件但有创建+编译意图 → create 路径
  const CREATE_RUN_RE = /(新建|创建|写|生成).{0,20}(编译|运行|执行|g\+\+|gcc|make|cmake)/i;
  if (CREATE_RUN_RE.test(prompt)) return 'create';

  // 无文件但有本地执行意图（prompt 中有真实存在的文件路径）
  if (shouldPreferLocalExecution(prompt, [], workspaceRoot)) return 'local';

  return 'chat';
}

function inferResponseType(mode: ExecutionMode, intent: ChatIntentDecision): ResponseType {
  if (mode === 'chat') return 'chat';
  if (mode === 'create' || mode === 'local') return 'generation';
  // agent 模式：根据 intent 细分
  if (intent.kind === 'code-change') return 'generation';
  // analyze/explain → analysis
  return 'analysis';
}

// 新增：根据附件列表解析最合适的 workspace root
function resolveWorkspaceRootForFiles(files: string[]): vscode.Uri | undefined {
  if (files.length === 0) return undefined;
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const file of files) {
    for (const folder of folders) {
      if (file.startsWith(folder.uri.fsPath)) return folder.uri;
    }
  }
  return undefined;
}
```

### 4.5 `startResponse` 消息协议修改

**修改前**：
```typescript
webview.postMessage({ type: 'startResponse', prompt, expectGeneratedArtifacts: true });
```

**修改后**：
```typescript
webview.postMessage({
  type: 'startResponse',
  prompt,
  responseType: ctx.responseType,          // 'generation' | 'analysis' | 'chat'
  expectGeneratedArtifacts: ctx.responseType === 'generation',
  agentMode: ctx.mode === 'agent',          // webview 同步设置 isAgentMode，消除竞态
});
```

**webview.js 对应修改**：
```javascript
case 'startResponse':
  isAgentMode = msg.agentMode === true;       // 同步设置，无竞态
  currentResponseType = msg.responseType ?? 'chat';
  // ...
```

---

## 5. 各模块修改规范

### 5.1 `generated-file-parser.ts` — `shouldSkipFileCandidate` 增强

**位置**：`shouldSkipFileCandidate()` 函数

**新增规则**：
```typescript
// 规则：分析段落上下文中的序号列表项不视为文件生成
function isAnalysisSectionContext(prefixText: string): boolean {
  const ANALYSIS_CONTEXT_RE = /(?:✅|⚠️|❌|评价|评分|\*\*分析\*\*|建议|总结|说明|概述|职责|功能|特性)/;
  const lines = prefixText.split('\n').slice(-12);
  return lines.some(l => ANALYSIS_CONTEXT_RE.test(l));
}

function shouldSkipFileCandidate(
  path: string, content: string, language: string | undefined,
  source: CandidatePathSource, prefixText: string,
): boolean {
  // ...existing rules...

  // 新规则：序号列表项 + 分析上下文 → 跳过
  if (source === 'context' && isAnalysisSectionContext(prefixText)) return true;

  return false;
}
```

**`findPathBefore` last-resort 词扫描收紧**：
```typescript
// 修改前（问题根源）：任意含扩展名的词都提取
for (const word of line.split(/\s+/)) {
  const clean = word.replace(...);
  if (clean && FILE_EXT_RE.test(clean) && !clean.includes('://')) {
    // 直接提取
  }
}

// 修改后：同行必须含创建/写入动词才采信
const hasCreateVerb = /创建|新建|生成|写入|create|write|generate|output/i.test(line);
for (const word of line.split(/\s+/)) {
  const clean = word.replace(...);
  if (clean && FILE_EXT_RE.test(clean) && !clean.includes('://') && hasCreateVerb) {
    // 只在有写入动词时提取
  }
}
```

---

### 5.2 `agent-loop.ts` — responseMeta emit 门控

**修改位置**：`runAgentLoop` 主循环

**修改前**：
```typescript
if (result.raw) {
  await callbacks.onResponseMeta(result.raw);
}
```

**修改后**：
```typescript
// 只有 modify/create 任务的响应才 emit responseMeta
if (result.raw && (task.action === 'modify' || task.action === 'create')) {
  await callbacks.onResponseMeta(result.raw);
}
```

---

### 5.3 `workspace-applier.ts` — multi-root 路径解析

**新增函数**：
```typescript
/**
 * 给定 preferredAbsolutePaths，找到包含这些文件的 workspace folder。
 * 用于 multi-root 场景下正确设置写入基准路径。
 */
export function resolveWorkspaceRootFromPaths(
  paths?: string[],
): vscode.WorkspaceFolder | undefined {
  if (!paths?.length) return undefined;
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const p of paths) {
    const match = folders.find(f => p.startsWith(f.uri.fsPath + nodePath.sep)
                                  || p.startsWith(f.uri.fsPath + '/'));
    if (match) return match;
  }
  return undefined;
}
```

**`getWorkspaceRoot` 修改**：
```typescript
function getWorkspaceRoot(prompt?: string, preferredAbsolutePaths?: string[]): string | undefined {
  // 优先：跟随附件所在 workspace root
  const fromPaths = resolveWorkspaceRootFromPaths(preferredAbsolutePaths);
  if (fromPaths) return fromPaths.uri.fsPath;

  // 其次：从 prompt 中提取路径中推断
  // ...existing logic...
}
```

**`detectWriteDrift` 收紧**：
```typescript
// 新增：跨 workspace root 漂移检测
function detectWriteDrift(
  prepared: PreparedChange[],
  root: string | undefined,
  pathContext: PathResolutionContext | undefined,
): string | undefined {
  // ...existing checks...

  // 新增：检测是否有任何 prepared change 的 targetUri 落在错误的 workspace root
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const change of prepared) {
    const targetFolder = folders.find(f =>
      change.targetUri.fsPath.startsWith(f.uri.fsPath));
    const preferredFolder = resolveWorkspaceRootFromPaths(pathContext?.preferredPaths);
    if (preferredFolder && targetFolder && targetFolder.uri.fsPath !== preferredFolder.uri.fsPath) {
      return `文件 ${change.relPath} 将被写入 ${targetFolder.name}，但附件来自 ${preferredFolder.name}。已阻止跨工作区写入。`;
    }
  }
  return undefined;
}
```

---

### 5.4 `extension.ts` — `emitResponseMeta` 增加意图门卫

**修改前**：
```typescript
await emitResponseMeta(webview, finalResponse);
```

**修改后**：
```typescript
// 只在生成意图时解析文件候选
if (ctx.responseType === 'generation') {
  await emitResponseMeta(webview, finalResponse);
} else {
  // 分析/聊天：明确告知 webview 无文件候选
  webview.postMessage({ type: 'responseMeta', hasGeneratedArtifacts: false, generatedPaths: [] });
}
```

---

### 5.5 `extension.ts` — 新增 `runCreateAndExecute` 路径

```typescript
/**
 * 无附件但用户明确想创建+运行文件的场景。
 * 例："在 code 目录下新建 hello.cpp，编译并运行"
 *
 * 流程：
 * 1. 构建创建提示词（要求 LLM 输出完整文件 + 编译命令）
 * 2. 获取 LLM 响应（按 generation responseType）
 * 3. 应用文件变更（auto apply）
 * 4. 从 LLM 响应提取编译/运行命令 → planLocalExecution
 * 5. 执行并展示结果
 */
async function runCreateAndExecute(
  webview: vscode.Webview,
  ctx: RequestContext,
): Promise<void> {
  webview.postMessage({
    type: 'startResponse',
    prompt: ctx.prompt,
    responseType: 'generation',
    expectGeneratedArtifacts: true,
    agentMode: false,
  });

  // 构建带目录约束的创建提示词
  const dirMatch = ctx.prompt.match(/(?:在|到|at|in)\s+([\w/.-]+(?:\/[\w/.-]+)*)\s*(?:目录|下|里|folder|dir|directory)?/i);
  const targetDir = dirMatch ? dirMatch[1] : 'code';
  const createPrompt = buildCreateAndRunPrompt(ctx.prompt, targetDir);

  let finalResponse = '';
  try {
    finalResponse = await chat({
      prompt: createPrompt,
      newSession: false,
      mode: ctx.deepseekMode,
      stream: true,
      onDelta: (delta) => webview.postMessage({ type: 'delta', text: delta }),
    });
  } catch (e) {
    webview.postMessage({ type: 'error', text: (e as Error).message });
    webview.postMessage({ type: 'endResponse' });
    return;
  }

  webview.postMessage({ type: 'endResponse' });

  // 自动应用文件变更
  const result = await applyGeneratedArtifactsWithPrompt(
    finalResponse, createPrompt,
    async s => webview.postMessage({ type: 'workflowStatus', ...s }),
    true, // autoApply
    async c => registerPendingEditChange(webview, c),
  );

  if (result.applied && result.changedPaths.length > 0) {
    // 尝试本地编译运行
    const localPlan = planLocalExecution(ctx.prompt, result.changedPaths, ctx.workspaceRoot.fsPath);
    if (localPlan) {
      lastLocalExecutionPlan = localPlan;
      await runAndReportLocalExecution(webview, localPlan, ctx.deepseekMode);
    }
  }

  await emitResponseMeta(webview, finalResponse);
}
```

---

### 5.6 `agent-task-decomposer.ts` — Phase-0 会话隔离

**问题**：`newSession: true` 破坏用户对话历史。

**修改方案**：Phase-0 携带完整的独立系统提示，使用 `newSession: false` 发送，LLM 凭 system prompt 的强约束（"只输出JSON"）自然忽略历史对话。

```typescript
// 修改前
raw = await chat({ prompt: systemPrompt, newSession: true, mode, stream: false });

// 修改后：不清除历史，但提示词以高优先度约束限定输出格式
raw = await chat({
  prompt: systemPrompt,
  newSession: false,     // 保留用户历史上下文
  mode,
  stream: false,
  // 加前置声明防止 LLM 延续上轮话题
});
```

> **注**：若 DeepSeek bridge 支持 system role，应将架构规划 prompt 放入 system role 而非 user role，天然隔离上下文干扰。

---

### 5.7 `readFileContentSafe` — 空内容时提前失败

**修改位置**：`agent-loop.ts` 中 `executeTask`

```typescript
// 对 modify/create 任务，文件路径存在但无法读取时 → 立即报错，不浪费 LLM 请求
if ((task.action === 'modify') && task.absPath) {
  const currentContent = readFileContentSafe(task.absPath);
  if (!currentContent && fs.existsSync(task.absPath)) {
    await callbacks.onAgentStatus({
      type: 'agentStatus', phase: 'execute',
      taskId: task.id, taskFile: basename,
      taskAction: task.action, taskDesc: task.desc,
      taskIndex, taskTotal: allTasks.length,
      state: 'failed',
      title: `${basename} — 无法读取文件内容`,
      detail: `路径 ${task.absPath} 存在但内容为空或无读取权限，已跳过此任务。`,
    });
    return { applied: false };
  }
}
```

---

### 5.8 目录路径感知（渐进式实现）

**Phase 1（快速修复）**：在 `runChat` 入口检测到目录引用时，弹出提示：

```typescript
// 在 buildRequestContext 中
const DIR_REF_RE = /(?:目录|directory|dir|folder)\s*下|\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\//g;
const dirRefs = prompt.match(DIR_REF_RE);
if (dirRefs && effectiveFiles.length === 0) {
  // 提示用户使用 @file 面板附加该目录
  vscode.window.showInformationMessage(
    `检测到目录引用：${dirRefs[0]}。建议使用 @file 面板将目录文件附加到对话中以获得精准分析。`,
    '知道了',
  );
}
```

**Phase 2（完整实现）**：自动枚举目录文件：

```typescript
async function tryDiscoverDirectoryFiles(
  prompt: string,
  workspaceFolders: readonly vscode.WorkspaceFolder[],
): Promise<string[]> {
  // 提取 prompt 中的绝对路径或以 src/、tars/、./、../开头的相对路径
  const ABS_PATH_RE = /\/[A-Za-z0-9_/.-]{10,}/g;
  const paths = [...(prompt.match(ABS_PATH_RE) ?? [])];

  for (const candidate of paths) {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
      if (stat.type === vscode.FileType.Directory) {
        // 枚举目录内匹配扩展名的文件（最多50个，最深3层）
        const files = await enumerateDirectory(candidate, 3, 50);
        if (files.length > 0) {
          const pick = await vscode.window.showInformationMessage(
            `检测到目录引用 ${candidate}，包含 ${files.length} 个代码文件，是否全部附加到本次对话？`,
            '全部附加', '取消',
          );
          if (pick === '全部附加') return files;
        }
      }
    } catch { /* 路径不存在，忽略 */ }
  }
  return [];
}
```

---

## 6. 实施优先级与路线图

### P0 — 立即修复（当前版本存在数据损坏风险）

| # | 问题 | 修改文件 | 代码量 |
|---|------|---------|--------|
| 1 | P1/P3: analyze任务 emit responseMeta | `agent-loop.ts` | 3行 |
| 2 | P2: multi-root 写入漂移 | `workspace-applier.ts` | 30行 |
| 3 | P5: startResponse 携带 responseType+agentMode | `extension.ts` + `webview.js` | 15行 |
| 4 | P7: PATH_LINE_PATTERNS 分析段落误匹配 | `generated-file-parser.ts` | 20行 |
| 5 | P10: emitResponseMeta 意图门卫 | `extension.ts` | 5行 |

**预计工时**：0.5天，影响最大，风险最低。

---

### P1 — 本Sprint（架构重构）

| # | 问题 | 修改文件 | 代码量 |
|---|------|---------|--------|
| 6 | 新增 `RequestContext` + `buildRequestContext` | `extension.ts`（可拆new file） | 100行 |
| 7 | 路由逻辑收拢到 `routeRequest()` | `extension.ts` | 重构 |
| 8 | P6: 新增 `runCreateAndExecute` 路径 | `extension.ts` | 80行 |
| 9 | P8: Phase-0 会话隔离 | `agent-task-decomposer.ts` | 2行 |
| 10 | P9: 空内容提前失败 | `agent-loop.ts` | 15行 |

**预计工时**：1天。

---

### P2 — 下Sprint（体验提升）

| # | 功能 | 说明 |
|---|------|------|
| 11 | 目录感知 Phase 1 | 检测目录引用，提示用户附加 |
| 12 | 目录感知 Phase 2 | 自动枚举目录文件（含用户确认） |
| 13 | Phase-0 会话槽隔离 | 若bridge支持system role则使用之 |
| 14 | `inferResponseType` 精化 | 混合任务（analyze+modify）的正确responseType |

---

### 验证方案

每个 P0 修改完成后，用以下三个场景验证：

```bash
# 场景1：纯分析场景（不应产生任何文件候选）
用户输入: "分析 tars/.../maintenance 目录下所有 .hpp 文件"
期望: 流式分析输出，文件面板无候选，磁盘无写入

# 场景2：多根工作区写入（不应漂移）
用户输入: "@file /home/ff/uav/tars/.../xxx.hpp  帮我优化这个文件"
期望: 文件写回原始路径，不出现在 deepseek_netai 工作区

# 场景3：无附件创建运行
用户输入: "在 code 目录下创建 hello.cpp 打印 hello world 并编译运行"
期望: 文件写入 code/hello.cpp，自动编译，终端输出 hello world
```

---

## 附录：消息协议变更对照表

| 消息类型 | 字段变更 | 说明 |
|---------|---------|------|
| `startResponse` | 新增 `responseType: 'generation'\|'analysis'\|'chat'` | webview 同步设置渲染模式 |
| `startResponse` | 新增 `agentMode: boolean` | 替代事后靠 agentStatus 推断 |
| `responseMeta` | 无变更，但调用时机受意图门控 | analysis/chat 路径直接发送空数组 |
| `agentStatus` | 无变更 | 保持兼容 |

---

## 7. Copilot / Cursor 参考实现对标与最优方案评估

> 本节系统梳理 GitHub Copilot Edits、Cursor Agent、Aider 对同类问题的实际处理策略，  
> 并逐一评估我们当前方案与对标最优方案的差距，给出明确的"采纳/升级/替换"建议。

---

### 7.1 整体架构对比

#### GitHub Copilot Edits（VS Code 原生）

Copilot 最关键的架构决策是**UI 层分离**：

```
Copilot Chat 面板      →  ChatRequestType.chat    →  纯对话管道
Copilot Edits 面板     →  ChatRequestType.edit    →  编辑管道
Inline Chat            →  ChatRequestType.inline  →  行内编辑管道
```

三个入口**物理隔离**，不存在"需要从响应内容猜测意图"的问题。每条管道在请求开始时就持有确定的 `RequestType`，下游无歧义。

关键内部机制：
- **`WorkspaceEdit` 作为唯一输出格式**：Copilot Edits 的 LLM 输出被解析为 VS Code 原生的 `vscode.WorkspaceEdit`（包含 `TextEdit[]`），通过 `vscode.workspace.applyEdit()` 应用。无需自定义文件写入逻辑，undo/redo 天然由 VS Code 管理。
- **流式 diff 渲染**：通过 `vscode.workspace.registerTextDocumentContentProvider` 注册虚拟文档，在 LLM 生成过程中实时展示 diff，无需等待响应完成。
- **`getWorkspaceFolder(uri)` 精确定位**：每个文件操作都调用 `vscode.workspace.getWorkspaceFolder(uri)` 确定所属根目录，完全支持 multi-root。
- **意图分类由模型完成**：Copilot 对于边界模糊的请求（"分析这段代码有没有 bug"）通过一次廉价的分类调用（GPT-4o-mini 级别）确定 `intent: 'explain' | 'fix' | 'refactor'`，不依赖纯正则评分。

#### Cursor Agent

Cursor 的核心差异在于**工具调用（Function Calling）**：

```
用户输入
    │
    ▼
模型（claude-3.5-sonnet）调用工具：
    ├─ read_file(path)         → 返回文件内容
    ├─ write_file(path, content) → 直接写入
    ├─ list_directory(path)    → 列出目录
    ├─ search_files(query)     → 语义/关键字搜索
    └─ run_terminal(cmd)       → 执行命令
    │
    ▼
模型自主决定调用顺序和次数（真正的 Agentic Loop）
```

关键特性：
- **无需解析 LLM 输出格式**：工具调用是结构化 API，不存在"解析 SEARCH/REPLACE 块"这类脆弱操作。
- **目录感知是内置工具**：`list_directory` + `search_files` 使 LLM 可以自主发现文件，不依赖用户手动 `@file` 附加。
- **SEARCH/REPLACE 是 write_file 的格式约定**：Cursor 的 `write_file` 内部实现即为 SEARCH/REPLACE 语义，但由工具 API 保证格式正确性，LLM 不会输出格式错误的块。
- **Codebase Index**：Cursor 对工作区建立向量索引，`@codebase` 查询走语义搜索，不是遍历文件。
- **多根工作区**：Cursor 将所有 workspaceFolders 扁平化为统一命名空间，用最长路径前缀匹配定位具体根目录。

#### Aider

Aider 是我们两阶段架构（Architect+Editor）的原型来源：

```
Architect (claude-opus) → 规划 JSON 任务列表（不输出代码）
Editor   (claude-sonnet) → 对每个文件输出 SEARCH/REPLACE 块
```

关键机制：
- **Git 提交保护**：每次成功写入前自动 `git add + git commit`，undo 等价于 `git revert`，彻底解决误写问题。
- **`.aiderignore`**：不允许 LLM 操作的文件通过 ignore 文件显式排除，避免越权写入。
- **Lint/compile 门控**：写入后立即运行 linter/compiler，失败则不提交，进入自动修复循环（最多 N 轮）。
- **Token 预算管理**：超过上下文窗口时自动切割，用摘要替换旧历史，保证长任务不失败。

---

### 7.2 各问题对标最优解

#### P1 + P3：分析响应污染文件管道

| | 我们当前 | Copilot | Cursor | 最优方案 |
|---|---------|---------|--------|---------|
| 如何防止误写 | `isAgentMode` 标志（竞态） | 物理管道隔离（Chat≠Edits） | 工具调用无需解析 | `responseType` 前置声明（我们的P0修复）+ `emitResponseMeta` 门控 |
| 文件候选提取 | 无条件 `parseGeneratedArtifacts` | 只在 Edits 管道运行 | 不存在（工具调用） | 仅在 `responseType='generation'` 时调用 |
| 实现最优性 | ❌ 根因未修 | ✅ 物理隔离最优 | ✅ API层最优 | 我们的方案在约束下是最优近似解 |

**我们的方案评估**：在单一 UI 入口的约束下，用 `responseType` 前置声明 + `emitResponseMeta` 门控是最接近 Copilot 物理隔离的软件方案。**无需架构重建即可达到同等效果。**

**升级建议**：长期（P2阶段），参考 Copilot 增加"编辑模式"切换按钮，让用户手动切换 Chat/Edit 面板，从根本上消除歧义。

---

#### P2：multi-root 写入漂移

| | 我们当前 | Copilot | Cursor | 最优方案 |
|---|---------|---------|--------|---------|
| 根目录解析 | 固定 `workspaceFolders[0]` | `getWorkspaceFolder(uri)` per-file | 路径最长前缀匹配 | 跟随附件 abs path 解析 root |
| 越界写入防护 | `detectWriteDrift`（弱） | VS Code API 层拦截 | 工具 API 层拦截 | 按附件 root 解析 + 强 drift 检测 |

**最优实现**（我们应采用 Copilot 方式）：
```typescript
// 对每个目标文件，用 VS Code 原生 API 确定其所属 workspaceFolder
function getWorkspaceFolderForFile(absPath: string): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absPath));
}
// 写入时：targetUri 必须和 preferredAbsPath 在同一 workspaceFolder
```

**当前方案升级点**：用 `vscode.workspace.getWorkspaceFolder()` 替换自定义前缀匹配逻辑，这是 VS Code 官方 API，处理符号链接、大小写不敏感等边缘情况。

---

#### P4：目录感知

| | 我们当前 | Copilot | Cursor | 最优方案 |
|---|---------|---------|--------|---------|
| 目录引用检测 | 无 | `@workspace` 触发全局搜索 | `list_directory` 工具调用 | Phase1: 检测+提示；Phase2: 自动枚举 |
| 文件发现 | 仅 `@file` 显式挂载 | `vscode.workspace.findFiles(glob)` | LLM 自主调用工具 | `vscode.workspace.findFiles()` 枚举目录 |

**Copilot 的 `@workspace` 机制**值得我们参考：用户输入 `@workspace` 触发全局语义搜索（底层是 VS Code 的 `vscode.workspace.findTextInFiles`）。我们可以实现简化版：检测到绝对路径目录后，用 `vscode.workspace.findFiles(new RelativePattern(dir, '**/*.{hpp,cpp,h,ts,py}'))` 枚举。

**Phase2 最优实现**：
```typescript
// 在 buildRequestContext 中调用
const discovered = await tryDiscoverFilesFromPrompt(prompt, workspaceFolders);
// 使用 VS Code 原生 findFiles（支持 .gitignore 等规则）
const files = await vscode.workspace.findFiles(
  new vscode.RelativePattern(dirUri, '**/*.{hpp,cpp,h,c,ts,js,py}'),
  null, 50,
);
```

---

#### P5：startResponse 竞态

| | 我们当前 | Copilot | Cursor | 最优方案 |
|---|---------|---------|--------|---------|
| 响应类型传递 | 靠 `agentStatus` 消息后验推断 | `RequestType` 在请求对象中前置 | 工具调用无此问题 | `startResponse` 携带 `responseType`+`agentMode`（我们已设计） |

**完全采纳**。这是代价最低、收益最高的修复。

---

#### P6：无附件创建+运行

| | 我们当前 | Copilot | Cursor | 最优方案 |
|---|---------|---------|--------|---------|
| 无附件写文件 | 需手动 Keep | Copilot Edits 自动apply | write_file 工具直接写 | `runCreateAndExecute` 路径 |
| 自动编译运行 | 不自动 | 不自动（需手动触发终端） | `run_terminal` 工具自动 | 写入后自动 `planLocalExecution` |

**我们的 `runCreateAndExecute` 方案**在这一场景接近 Cursor 的体验（全自动），比 Copilot 更进一步（Copilot Edits 不自动运行）。**方案最优，继续实施。**

---

#### P7：PATH_LINE_PATTERNS 误匹配

| | 我们当前 | Copilot | Cursor | 最优方案 |
|---|---------|---------|--------|---------|
| 文件路径提取 | 多层正则 fallback（高召回高误检） | 不需要（工具调用输出结构化数据） | 不需要（工具 API） | 正则保留，但加上下文判定门控 |

**分析**：Copilot/Cursor 根本不存在这个问题（他们不解析自由格式文本提取路径）。我们的约束是无法用工具调用，必须解析自由文本。最优近似解：
1. 保留当前正则召回能力
2. 在 source=`context` 路径增加"分析段落"识别门控（已在5.1节设计）
3. 长期：引导 LLM 在生成响应时必须使用带 fence 的标准格式（`source=fence` 精确度远高于 `source=context`）

---

#### 意图分类：正则评分 vs 模型分类

这是我们与 Copilot 最大的方法论差距：

**Copilot 方式**：用一次廉价 LLM 调用（GPT-4o-mini，<100ms）分类意图，准确率接近100%。

**我们当前方式**：基于正则规则的评分系统，对"分析附件"、"解释一下"这类语义丰富的请求容易误判。

**中间方案（最适合我们的约束）**：

```typescript
// 方案A：规则系统 + 置信度兜底（当前方式改进版）
// 对 confidence < 0.5 的边界情况，增加一次快速 DeepSeek 分类调用
async function classifyIntentWithFallback(
  prompt: string,
  files: string[],
): Promise<ChatIntentDecision> {
  const ruleResult = decideChatIntent(prompt);
  
  // 高置信度直接返回
  if (ruleResult.confidence >= 0.65 || files.length === 0) return ruleResult;
  
  // 低置信度 + 有附件：做一次轻量分类调用
  const classify = await chat({
    prompt: `判断用户意图类型，只回复一个词：
modify（修改代码）/ analyze（分析代码）/ explain（解释代码）/ chat（聊天）
用户说：${prompt.slice(0, 200)}`,
    newSession: false, mode: 'fast', stream: false,
  });
  const kind = classify.trim().toLowerCase();
  const isChange = kind === 'modify' || kind === 'create';
  return { ...ruleResult, kind: isChange ? 'code-change' : 'chat' };
}
```

**方案B（最优，需bridge支持）**：DeepSeek function calling API 直接返回 `{intent: 'modify'|'analyze'|'explain'|'chat'}`，完全替代正则评分。

---

### 7.3 我们未实现但值得参考的 Copilot/Cursor 机制

#### 7.3.1 Git 提交保护（来自 Aider）

**问题**：当前任何 modify 操作都直接 `fs.writeFile`，一旦 LLM 生成有问题的内容，恢复需要用户手动 Undo。

**Aider 做法**：写入成功后立即 `git commit -m "aider: <task_desc>"`，undo 等价于 `git revert HEAD`，无需复杂的 PendingEdit 状态机。

**适合我们的实现**：
```typescript
// 在 executeTask 写入成功后
if (applied && vscode.workspace.getConfiguration('deepseek').get('autoCommit', false)) {
  await runLocalExecution({ command: `git add -A && git commit -m "deepseek: ${task.desc.slice(0,60)}"`, cwd: workspaceRoot.fsPath, ... });
}
```
建议作为可选配置项（默认 off）。

---

#### 7.3.2 Token 预算与上下文截断（来自 Aider/Cursor）

**问题**：当前文件内容注入无 token 预算控制，8个大文件同时分析时 prompt 可能超出模型上下文窗口（DeepSeek V3 = 64K tokens）。

**Cursor 做法**：根据模型上下文窗口动态决定注入多少文件内容，超过预算时优先保留：
1. 当前编辑文件的完整内容
2. 其他文件的摘要（函数签名 + 注释，不含实现）
3. 最近修改过的位置周围 ±50 行

**实现要点**：
```typescript
const TOKEN_BUDGET = 40000; // 保留 ~24K 给响应
function buildContextWithBudget(tasks: AgentTask[], budget: number): string {
  let used = 0;
  return tasks.map(t => {
    const content = readFileContentSafe(t.absPath ?? '', 400);
    const tokens = Math.ceil(content.length / 3.5); // 粗估：3.5字符/token
    if (used + tokens > budget) {
      // 降级：只注入文件签名（前30行通常含头部声明）
      const summary = content.split('\n').slice(0, 30).join('\n') + '\n// ... (已截断)';
      used += Math.ceil(summary.length / 3.5);
      return summary;
    }
    used += tokens;
    return content;
  }).join('\n\n');
}
```

---

#### 7.3.3 流式 diff 渲染（来自 Copilot Edits）

**问题**：当前修改任务是"等 LLM 响应完成 → 解析 → 写入 → 显示结果"，用户需要等待全部完成。

**Copilot 做法**：使用 VS Code 的 `vscode.workspace.registerTextDocumentContentProvider` 注册虚拟文档，在 streaming 过程中实时渲染 diff。用户能看到文件逐行被修改的过程。

**简化实现方案**（不需要注册虚拟文档provider）：
- 在 `onDelta` 回调中，每当收到包含 `>>>>>>> REPLACE` 完整块时，立即 apply 该块并 postMessage 更新进度
- 用户看到的是"每个 SEARCH/REPLACE 块完成即立即写入"，而非等全部完成

---

#### 7.3.4 Lint/Compile 门控写入（来自 Aider）

**当前问题**：我们的 compile validation 在写入**之后**运行，如果编译失败，文件已经被修改了。

**Aider 做法**：compile → 通过 → 写入（原始内容写入 → 临时 apply → 编译 → 成功才 commit）。

**适合我们的实现**：目前的 Pending Edit 机制已经提供了"写入但未确认"的语义，可以在此基础上：
- 写入后立即对 C/C++ 文件做 `g++ -fsyntax-only` 检查（< 1s）
- 失败时自动进入修复循环（已有），不需要用户手动确认
- 只有编译通过后才在 pendingEdits 中标记为"可 Keep"

---

### 7.4 实现最优性总评

| 问题 | 我们的方案 | 对标最优 | 差距 | 结论 |
|------|-----------|---------|------|------|
| P1 响应污染 | responseType 门控 | Copilot 物理隔离 | 软件层 vs 架构层 | **采纳，约束下最优** |
| P2 路径漂移 | 跟随附件root | `getWorkspaceFolder(uri)` | 自定义逻辑 vs VS Code API | **升级：改用原生API** |
| P3 analyse emit | action 类型过滤 | 物理管道隔离 | 同P1 | **采纳，最简修复** |
| P4 目录感知 | findFiles枚举+询问 | Cursor list_directory工具 | 手动枚举 vs LLM工具调用 | **阶段性最优，Phase2升级** |
| P5 竞态 | startResponse前置声明 | RequestType构造时确定 | 消息 vs 对象 | **采纳，等效实现** |
| P6 无附件创建 | runCreateAndExecute | Cursor write_file工具 | 等效 | **采纳，已超Copilot** |
| P7 路径误提取 | 上下文门控 | 不存在此问题（工具调用） | 根本差距 | **修复误判，长期靠格式约束** |
| 意图分类 | 正则评分 | LLM分类调用 | 准确率差距 | **新增低置信度兜底调用** |
| Git保护 | PendingEdit手动撤销 | Aider自动commit | 明显差距 | **推荐增加为可选配置** |
| Token预算 | 简单截断 | 动态预算+降级摘要 | 策略差距 | **P2阶段实现** |
| 流式diff | 等待完成后显示 | Copilot实时渲染 | 体验差距 | **P2阶段：SEARCH/REPLACE块级流式** |

---

### 7.5 与顶级编程智能体的本质差距及路线图

**短期无法填平的根本差距**（受限于浏览器自动化架构）：

1. **工具调用（Function Calling）**  
   Cursor 的最大优势来自模型可以自主调用 `read_file`/`write_file`/`run_terminal`，无需解析自由格式文本。我们使用浏览器自动化无法使用 DeepSeek API 的 function calling，只能通过 prompt 工程模拟。  
   **当 DeepSeek 官方 API 可用时，这是第一优先级迁移项。**

2. **Codebase 语义索引**  
   Copilot 的 `@codebase` 和 Cursor 的全局语义搜索基于向量数据库（本地 embeddings）。我们可以用 VS Code 内置的 `vscode.workspace.findTextInFiles`（关键字搜索）作为替代，但语义相关性远低于向量搜索。

3. **模型质量**  
   Cursor 默认用 claude-3.5-sonnet（编程能力最强），我们用 DeepSeek V3（编程能力次之但接近）。质量层面差距有限，主要差距在架构而非模型。

**可以做到与 Copilot/Cursor 同等水平的部分**（通过本文档的改造）：

- ✅ 响应类型前置声明 → 消除误写风险（Copilot同等）
- ✅ multi-root 精确路径解析 → 消除漂移（Copilot同等）  
- ✅ 无附件创建+运行 → 超过 Copilot，接近 Cursor
- ✅ 两阶段 Architect+Editor → 接近 Cursor Agent 质量
- ✅ SEARCH/REPLACE 块格式 → Aider 同等质量
- ✅ 目录感知 Phase1 → 接近 Copilot `@workspace`

---

## 8. 多轮对话实测检讨（2026-05-08 专项）

> 本节基于"分析附件代码 → 优化"两轮连续对话的 DeepSeek 网页原始内容分析，
> 针对多轮、多文件、多任务场景新增 5 个问题项（P11–P15）及对应对策。

### 8.1 新增问题清单

#### 问题 P11（高）：文件内容在每轮中全量重发，同一文件发送 7+ 次

**触发场景**：2 个文件 + "分析" + "优化" 两轮对话，共 8 个 DeepSeek 请求

| 请求轮次 | 文件内容发送数 |
|---------|------------|
| Round 1 Architect（分析） | 2 |
| Round 2 Analysis（executeAnalysisConsolidated） | 2（重复）|
| Round 3 Architect（优化） | 2（重复）|
| Round 4-8 Editor（5 个子任务各自） | 1×5（每次重复）|

`spray_pre_rotate_controller.hpp`（513行）被发送 **7 次**，内容完全相同。

**根因**：`buildDecomposeSystemPrompt` 和 `buildEditorPrompt` 每次都 embed 完整文件内容；`newSession: false` 虽然保留了 DeepSeek 会话，但仍在新 prompt 中重复插入。

**对标 Copilot**：Copilot 通过 VS Code API `workspace.fs` 按需读取，不在 prompt 中重复携带文件全文；对于多轮对话，只携带 diff 或 changed range。

**修复方案**：
- Architect 保留文件内容嵌入（规划需要，但减少到 150 行上限）
- Analysis consolidated 已经在同一请求内 embed 一次，不再重复
- 多轮时：后续 Architect 请求不再重嵌已在会话中出现过的文件；只更新 changed 文件的内容

---

#### 问题 P12（高）：Editor 收到截断文件（400行限制），SEARCH 块无法匹配文件下半部

**触发场景**：`spray_pre_rotate_controller.hpp`（513行）被截断为 400 行后送给 Editor

**实测现象**：
```
// ... (文件过长，已截断，仅显示前 400/513 行)
```
Editor 生成的 SEARCH 块引用了第 291 行附近的代码，而第 291 行在截断范围内，但如果 SEARCH 块恰好引用 401+ 行的代码 → 匹配失败 → apply 报错/超时

**根因**：`readFileContentSafe` 的 `READ_MAX_LINES = 400` 对 Architect（规划）合理，但对 Editor（需要精确改代码）则过于严格。

**对标 Copilot**：Copilot Editor 工具调用 `read_file(startLine, endLine)` 精确读取目标范围，不截断；或使用 semantic chunking 只发送相关函数上下文。

**修复方案**：
- 新增 `readFileContentFull(absPath)` 函数，无行数限制
- Editor prompt 使用 `readFileContentFull`，Architect 继续使用 `readFileContentSafe(200行)`
- 超过 1000 行的文件，Editor 按 task.desc 提示的函数名做 function-level 定位读取

---

#### 问题 P13（高）：多任务修改同一文件时，后续任务使用原始快照，丢失已应用的修改

**触发场景**：t3/t4/t5 同时修改 `spray_pre_rotate_controller.hpp`，三者均收到原始文件内容

**根因**：`executeTask` 在任务开始时调用 `readFileContentSafe(task.absPath)` 读磁盘，但：
- t3 通过 SEARCH/REPLACE 写入磁盘后，t4 理论上应读到更新后内容
- 但若 t3 走了 fallback（`applyGeneratedArtifactsWithPrompt`），写入路径不同，磁盘状态不确定
- 三个 Editor 任务收到同一 `allTasks` 列表，传入 `buildEditorPrompt` 的 `currentContent` 是同一原始版本

**对标 Copilot**：Copilot 每次 tool call `read_file` 都读取磁盘最新版本；Agent 循环中每个步骤执行完毕后文件状态已更新，下一步自然获得最新版本。

**修复方案**：
- 在 `runAgentLoop` 中维护 `contentCache: Map<absPath, string>`
- `executeTask` 优先取 cache，再 fallback 读磁盘
- 任意写入成功后，更新 cache 中该文件的最新内容
- 下一个 task 收到已经包含前一个 task 改动的内容

---

#### 问题 P14（中）：Analyze → Plan 两轮断联，分析发现的 Bug 未进入修复计划

**触发场景**：Round 2 Analysis 找到 `idle_rpm <= 800009` 笔误，Round 3 Plan 的 5 个 task 未包含此修复

**根因**：
- Analysis（executeAnalysisConsolidated）只流式输出文本到 chat bubble，不将结果传回 `runAgentLoop`
- 下次 Architect 请求（`decomposeTask`）重新开始，不接收上轮分析发现
- `newSession: false` 保留了 DeepSeek 会话历史，但 Architect prompt 的 system 角色消息会覆盖上下文焦点

**对标 Copilot**：Copilot Agent 的 Analyze 步骤将结果结构化（diagnostics list），直接作为 next Plan 步骤的输入，是同一个 agent loop 内的连续操作。

**修复方案**：
- `executeAnalysisConsolidated` 返回结构化 `AnalysisFindings` 对象（包含发现的 bug 列表）
- `decomposeTask` 新增可选参数 `priorAnalysisFindings`，注入 Architect prompt
- 当 findings 非空时，Architect prompt 头部增加"【已发现问题，请确保修复计划包含以下项目】"

---

#### 问题 P15（低）：无 Apply 后验证门控，单任务失败不阻断后续任务

**触发场景**：t3 SEARCH 块 match 失败 → t4/t5 继续执行但操作的是未经 t3 修改的文件

**对标 Copilot**：Copilot 每步操作后调用 `get_errors()` 检查语法；如有错误则当场 retry，不进入下一步。

**修复方案**：
- C/C++ 文件 apply 成功后，调用 VS Code diagnostics API 检查语法错误（零延迟，不用编译）
- 若检测到 error 级 diagnostic，触发单次 auto-retry（告知 LLM 具体错误位置）
- 编译验证保留在最终阶段（全部 task 完成后）

---

### 8.2 修复优先级（按影响面排序）

| 优先级 | 问题 | 影响 | 修复难度 | 状态 |
|--------|------|------|---------|------|
| P0 | P12：Editor 截断 → SEARCH 失败 | 直接导致 apply 失败率高 | 低 | ✅ 已实现 |
| P0 | P13：多任务同文件快照不更新 | 后续任务覆盖前任务修改 | 低 | ✅ 已实现 |
| P1 | P14：Analyze 不反哺 Plan | Bug 被发现但未被修复 | 中 | ✅ 已实现 |
| P1 | P11：文件全量重发 | Token 浪费，上下文污染 | 中 | 部分优化 |
| P2 | P15：无逐任务验证 | 失败叠加扩大 | 低 | 架构预留 |

---

### 8.3 已实施代码变更（2026-05-08）

#### 变更 C1：`agent-task-decomposer.ts` — 新增 `readFileContentFull`

```typescript
// 无行数限制，专供 Editor/Analysis 使用
export function readFileContentFull(absPath: string): string {
  try { return fs.readFileSync(absPath, 'utf8'); }
  catch { return ''; }
}
```

Architect 继续使用 `readFileContentSafe(absPath, 150)` 限制 token 用量；
Editor 改用 `readFileContentFull` 确保精确 SEARCH 匹配。

#### 变更 C2：`agent-loop.ts` — 任务间内容缓存（contentCache）

```typescript
// runAgentLoop 中初始化
const contentCache = new Map<string, string>();

// executeTask 中：优先读缓存
const currentContent = contentCache.get(task.absPath!) 
  ?? (task.absPath ? readFileContentFull(task.absPath) : '');

// 写入成功后更新缓存
contentCache.set(task.absPath, srResult.result);
```

#### 变更 C3：`agent-task-decomposer.ts` — Analysis findings 注入 Plan

```typescript
export interface AnalysisFindings {
  issues: string[];  // e.g. ["idle_rpm 上界 800009 疑似笔误", "STAGE_TARGET_WAIT 无超时保护"]
}

// decomposeTask 新增参数
export async function decomposeTask(
  userPrompt: string,
  attachedFiles: string[],
  mode: 'fast' | 'r1' | undefined,
  onProgress: (text: string) => void,
  priorFindings?: AnalysisFindings,  // ← 新增
): Promise<DecomposeResult>
```

---

*文档版本：v2.1 — 2026-05-08（新增第8节：多轮实测检讨与 P11-P15 问题项）*  
*作者：架构分析基于实测对话日志 + 完整源码 review + Copilot/Cursor/Aider 公开技术资料*

---

## 第9节：第二轮实测检讨与 P16-P18 问题项（对标 Copilot 显示优化）

### 9.1 测试背景

第二轮测试：两轮智能体工作流，同两个 C++ 文件（`spray_pre_rotate_controller.hpp` / `spray_flight_state_monitor.hpp`）。
- **Round 1**：分析（6 项改进点）
- **Round 2**：按建议修改（t1–t5 共 5 个子任务）

测试后发现 3 个新 bug（P16–P18）及 Copilot 显示对标差距。

---

### 9.2 新增问题项

#### 问题 P16（严重）：SEARCH/REPLACE 标记被错误提取为文件路径

**触发场景**：  
DeepSeek 模型对 t3（`update()` 重构）采用 SEARCH/REPLACE 格式输出，但 SEARCH 块匹配失败后，代码回退到全文件解析器（`applyGeneratedArtifactsWithPrompt`）。全文件解析器调用 `findPathBefore()`，扫描代码块前 8 行作为路径候选。前缀行中包含 `SEARCH/REPLACE/spray_pre_rotate_controller.hpp` 或类似模型输出文本，被 PATH_LINE_PATTERNS 或 `natural` 正则识别为合法路径（含 `.hpp`），最终在 workspace 根目录下创建 `SEARCH/REPLACE/spray_pre_rotate_controller.hpp`。

**证据**：`/home/ff/uav/tars/SEARCH/REPLACE/` 目录实际写入到磁盘。

**对标 Copilot**：  
Copilot 使用结构化 JSON tool call（`str_replace_editor`，`create_file`）发送文件路径，路径由 LLM 直接在 JSON field 中指定，不经过文本解析，不存在此问题。

**修复方案（已实施）**：  
`generated-file-parser.ts` → `normalizeCandidatePath()`：
```typescript
// 拒绝包含 git 冲突标记或 SEARCH/REPLACE 段名的路径
if (p.split('/').some((seg) => seg === 'SEARCH' || seg === 'REPLACE')) return undefined;
if (/^[<=>]{7}/.test(p)) return undefined;
```

---

#### 问题 P17（高）：SEARCH/REPLACE 成功路径已正确调用 onAppliedChange

**状态**：经代码审查确认，`callbacks.onAppliedChange` 在 SEARCH/REPLACE 成功路径（`agent-loop.ts` ~line 581）已被正确调用。该问题在上一轮修复中已解决，本轮测试无复现。✅

---

#### 问题 P18（中）：全文件回退路径不发送终态任务状态

**触发场景**：  
SEARCH/REPLACE 匹配失败后走全文件解析器（`applyGeneratedArtifactsWithPrompt`）。该路径的 `executeTask` 函数：
- 在开始时发送 `state: 'started'`
- SEARCH/REPLACE 成功路径自行发送 `state: 'completed'` 后 `return`
- 全文件路径执行完毕后**没有**发送 `state: 'completed'` 或 `state: 'failed'`
- 导致任务行永远卡在 ⚡ 图标状态

**对标 Copilot**：  
Copilot 每个工具调用（`str_replace_editor`、`create_file`）返回后都有明确的成功/失败状态，进度条始终准确反映真实状态，不存在状态悬挂。

**修复方案（已实施）**：  
`agent-loop.ts` → `executeTask()` 末尾（全文件 return 之前）添加：
```typescript
// P18: 全文件回退路径发送终态状态（SEARCH/REPLACE 路径已提前 return，不会重复发送）
await callbacks.onAgentStatus({
  type: 'agentStatus', phase: 'execute',
  taskId: task.id, taskFile: basename, taskAction: task.action,
  taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
  state: applied ? 'completed' : 'failed',
  title: applied ? `${basename} — 已修改` : `${basename} — 未能应用`,
});
```

---

### 9.3 Copilot 显示对标改进

| 差距 | Copilot 表现 | DeepSeek 之前 | DeepSeek 修复后 |
|------|------------|-------------|--------------|
| 任务行图标动效 | ⟳ 旋转动画指示进行中 | ⚡ 静态无动效 | ⚡ 脉冲动画（wiBlink） |
| 执行容器完成收折 | 完成后自动收起步骤列表 | 永远展开 | done 消息到达时自动收起 |
| 完成标题更新 | "✓ X steps completed" | 标题不变 | 更新为 "✓ 执行完成" / "✗ 执行结束（有失败）" |
| 任务状态终态 | 每步始终有明确终态 | 全文件路径卡在 ⚡ | P18 修复后终态正确 |

**已实施代码变更（`media/webview.js`）**：
```javascript
// 1. 进行中图标脉冲动画
'.agent-exec-row.state-started .agent-row-icon { display:inline-block; animation: wiBlink 1s ease-in-out infinite; }',

// 2. done 时收折 + 更新标题
if (agentExecContainer && agentExecContainer.isConnected) {
  var execDets = agentExecContainer.querySelector('details');
  if (execDets) execDets.removeAttribute('open');
  var execTitle = agentExecContainer.querySelector('.agent-exec-summary-title');
  if (execTitle) execTitle.textContent = msg.state === 'failed' ? '✗ 执行结束（有失败）' : '✓ 执行完成';
}
```

---

### 9.4 P14 连接（Analysis → Plan 融合）

P14 的代码实现在上一轮已完成（`extractAnalysisFindings` + `decomposeTask` 新参数），但 `extension.ts` 中未做连线。本轮补充：

1. `extension.ts` 增加 `let lastAnalysisText = ''` 模块变量（`newSession` 时重置）
2. `runAgentLoop` 改为捕获返回值，若含 `analysisText` 则保存
3. 下轮 `decomposeTask` 调用时注入 `priorFindings = extractAnalysisFindings(lastAnalysisText)`

效果：第一轮分析发现"idle_rpm 上界 800009 疑似笔误"，第二轮 Plan 阶段会将此列入修复清单，不再遗漏。

---

### 9.5 修复优先级汇总（v2.2）

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P0 | P16：SEARCH/REPLACE 路径误创建文件 | ✅ v2.2 已修复 |
| P0 | P18：全文件路径任务状态悬挂 | ✅ v2.2 已修复 |
| P1 | P14：Analysis findings 未注入 Plan | ✅ v2.2 已连线 |
| P2 | 显示：进行中图标无动效 | ✅ v2.2 已改进 |
| P2 | 显示：执行容器完成不收折 | ✅ v2.2 已改进 |

---

*文档版本：v2.2 — 2026-05-08（新增第9节：P16/P17/P18 + Copilot 显示对标）*
