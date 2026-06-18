# 智能编程 Agent 路径解析策略深度分析

> 创建日期：2026-05-25  最后更新：2026-05-25  
> 目的：系统对比 GitHub Copilot、Claude Code、Cursor 的路径解析机制，
> 总结 DevSeek 现有问题的根因，记录已实施修复，指导后续改进。

---

## 一、核心问题陈述

路径问题的本质是一个**"AI 知道文件叫什么，但不知道文件在哪"**的歧义消解问题：

```
用户说：  "修改 main.cpp"
AI 猜：   main.cpp  ──→  哪个 main.cpp？
           ├── /workspace/code/3d_demo/src/main.cpp  ✓（正确）
           ├── /workspace/packages/bridge/src/main.cpp
           └── /workspace/src/main.cpp
```

在 monorepo / 多子项目工作区，这个问题尤其严重。

---

## 二、GitHub Copilot 的路径解析策略

### 2.1 核心原则：绝对路径 + 永不计算相对路径

Copilot 的根本策略是**从源头消灭歧义**：工具调用参数永远使用 `vscode.Uri`（绝对路径），
AI 从不需要"猜"文件在哪里。

```typescript
// Copilot 工具调用约定（简化）
// 读文件：传绝对 URI
const doc = await vscode.workspace.openTextDocument(
  vscode.Uri.file('/absolute/path/to/file.ts')  // 永远绝对路径
);

// 保存 Working Set：也存 fsPath
context.workspaceState.update('github.copilot.workingSet', [
  '/absolute/path/to/file1.ts',
  '/absolute/path/to/file2.ts',
]);
```

**关键**：Copilot 使用 VS Code 原生 API `getWorkspaceFolder(uri)` **按文件逐个**解析所在项目：

```typescript
// Copilot：每个文件调用一次，不假设所有文件属于 workspaceFolders[0]
const folder = vscode.workspace.getWorkspaceFolder(uri);
// folder.uri.fsPath = "/workspace/code/3d_demo"  ← 精确到子项目
```

### 2.2 Working Set（L2 会话记忆）

Copilot 维护一个 **Working Set**：当前会话中所有已打开/修改的文件集合，
用 `vscode.Uri` 存储，持久化到 `workspaceState`：

```typescript
// 工作集: basename → absolute Uri
const workingSet = new Map<string, vscode.Uri>();
// 每次用户开启文件、AI 读取文件，都加入 Working Set
workingSet.set('main.cpp', Uri.file('/workspace/code/3d_demo/src/main.cpp'));

// 路径解析流程（简化）
function resolveFile(name: string): vscode.Uri {
  // 1. 精确匹配（含路径）
  // 2. basename 匹配 Working Set
  // 3. VS Code workspace file search API
  // 4. 失败：直接报错，不猜测
}
```

**行为特征**：
- 有文件 → 从 Working Set 用绝对路径；无文件 → 用 VS Code 搜索 API 找，再加入 Working Set
- 新建文件时，AI 输出完整绝对路径，然后宿主层用 `vscode.Uri.file()` 创建
- **从不推断目录**：如果 AI 没给路径，Copilot 会向用户询问，而不是猜

### 2.3 Active Editor 作为上下文锚

当用户没有显式指定文件时，Copilot 使用 `vscode.window.activeTextEditor` 作为**上下文锚**：

```typescript
// 仅当没有 Working Set 文件时使用
const anchor = vscode.window.activeTextEditor?.document.uri;
// 推导项目根 = getWorkspaceFolder(anchor).uri
```

**与 DevSeek 的区别**：Copilot 只用 active editor 推导"项目根"（workspace folder level），
不再向下细分到子目录。而 DevSeek 曾经用 active editor 推导到 `media/docs/` 这样的子目录，
这是错误的。

---

## 三、Claude Code 的路径解析策略

### 3.1 核心原则：CWD + 四级回退解析

Claude Code 是 CLI 工具，不依赖 IDE API。它的路径解析以 **当前工作目录（CWD）** 为基础，
配合四级回退策略：

```
用户在 /home/user/code/3d_demo/ 运行 claude
  ↓
所有 AI 生成的相对路径都相对于这个 CWD 解析
```

四级路径解析函数（`resolveFilePath`）：

```typescript
function resolveFilePath(input: string, workDir?: string): string {
  // P0: 检查 recentFiles 字典（basename.toLowerCase() → absPath）
  const dictResult = recentFiles.get(path.basename(input).toLowerCase());
  if (dictResult) return dictResult.absPath;

  // P1: workDir 相对解析（tool call 继承任务的工作目录，非 workspace 根）
  if (workDir && !path.isAbsolute(input)) {
    const r = path.resolve(workDir, input);
    if (fs.existsSync(r)) return r;
  }

  // P2: 绝对路径直接使用
  if (path.isAbsolute(input)) return input;

  // P3: CWD 相对解析（fallback）
  const fromCwd = path.resolve(cwd, input);
  if (fs.existsSync(fromCwd)) return fromCwd;

  // P4: 在已修改文件中按 basename 搜索
  for (const modPath of modifiedPaths) {
    if (path.basename(modPath) === path.basename(input)) return modPath;
  }

  throw new Error(`File not found: ${input}`);
}
```

### 3.2 recentFiles 字典（L2 会话记忆）

Claude Code 维护一个**近期访问文件字典**，在文件读写时自动更新：

```typescript
const recentFiles = new Map<string, { absPath: string; lastAccessed: number }>();

// 每次 read_file / write_file 工具调用后自动注册
function registerFile(absPath: string) {
  recentFiles.set(path.basename(absPath).toLowerCase(), { absPath, lastAccessed: Date.now() });
  recentFiles.set(path.relative(cwd, absPath).toLowerCase(), { absPath, lastAccessed: Date.now() });
}
```

这意味着：AI 第一次用 `read_file` 读了 `src/main.cpp`，
此后只写 `main.cpp` 也能正确解析到 `/project/src/main.cpp`。

**⚠️ 局限**：`recentFiles` 是进程内存，重启即丢失。
DeepSeek 用 `workspaceState` 解决了这个问题（Claude Code 的 CLI 场景不需要持久化）。

### 3.3 工具调用继承工作目录

Claude Code 的工具调用有 `workDir` 参数，每个任务可以有独立的工作目录：

```typescript
// AI 调用 read_file 时可附带工作目录
{
  tool: "read_file",
  input: { path: "Camera3D.h", workDir: "/project/code/3d_demo/src" }
}
// → 解析为 /project/code/3d_demo/src/Camera3D.h  ✓
// → 而不是 /project/Camera3D.h  ✗
```

### 3.4 CLAUDE.md 中的项目路径约定

Claude Code 通过 CLAUDE.md 让 AI 在 session 开始就了解项目结构：

```markdown
# CLAUDE.md（项目根）
## 目录结构
- src/       核心源码
- test/      测试套件
- docs/      文档

## 注意事项
- 所有新文件必须放在 src/ 目录下
- 测试文件放在 test/ 对应子目录
```

**关键洞察**：Claude Code 不只是解析路径，还通过约定文件**预防**路径错误。
AI 在 system prompt 中已知道"新文件应该去哪"，不需要事后纠正。

---

## 四、Cursor 的路径解析策略

### 4.1 Composer Agent：基于文件树的显式路径

Cursor 的 Composer Agent 在每轮执行前构建完整的工作区文件树，
并注入 system prompt：

```
项目结构（注入 AI 上下文）：
code/3d_demo/
  src/
    Camera3D.h
    Camera3D.cpp
    OrbitController.h
  ...

请在修改/创建文件时使用完整相对路径（相对于工作区根）。
```

AI 在输出时被要求使用完整相对路径（`code/3d_demo/src/Camera3D.h`），
宿主层直接用 `workspaceRoot + relativePath` 定位。

**优点**：AI 看到的路径和实际路径一致，减少歧义。  
**缺点**：大型工作区文件树很大，消耗 token。

### 4.2 Cursor 的 "Follow" 功能

用户在编辑器中打开文件时，Composer 自动"Follow"（追踪）该文件，加入上下文。
这类似 Copilot 的 Active Editor 机制，但 Cursor 更激进：
会自动加入同一目录的相关文件。

---

## 五、各工具对比矩阵

| 维度 | GitHub Copilot | Claude Code | Cursor | DevSeek |
|------|---------------|-------------|--------|---------|
| **路径类型** | 永远绝对路径 | CWD + 四级回退 | 完整相对路径 | 相对路径 + 解析 |
| **新文件锚** | `getWorkspaceFolder(activeEditor)` | CWD（启动目录） | 工作区根 + AI 输出全路径 | 提示词解析 + 附件推导 |
| **路径字典** | Working Set（Uri Map） | recentFiles（basename→abs） | 文件树（全量） | sessionRecentFiles（basename→abs） |
| **字典持久化** | workspaceState ✓ | 进程内存 ✗ | 进程内存 ✗ | workspaceState ✓ |
| **工具调用继承workDir** | 否（绝对路径不需要） | 是 ✓ | 否 | 是 ✓（onReadFile + onGrepSearch 均传 workDir） |
| **grep 默认搜索范围** | 不适用 | CWD 级别 | 不适用 | ✅ 任务目录 > 工作区根（已修复） |
| **Architect prompt 路径约束** | 始终绝对路径 | CWD 提示 | 全量文件树 | ✅ 注入【工作目录约束】块（已实现） |
| **promptDir 检测逻辑** | 不需要 | 不需要 | 不需要 | ✅ 提取为 detectPromptDir() 共享函数 |
| **防错约定文件** | copilot-instructions.md | CLAUDE.md ✓ | .cursorrules | .deepseek/rules.md ✓ |
| **AI 可写记忆** | 否 ✗ | memory_write ✓ | 否 ✗ | memory_write ✓ |
| **明确路径时** | 比较稳健 | 非常稳健 | 非常稳健 | ✅ 稳健（修复后） |
| **隐式路径时** | 中等（Working Set） | 稳健（四级回退） | 中等（需显式） | ✅ 稳健（系统提示约束 + confine 兜底） |

---

## 六、DevSeek 路径问题根因分析（历史记录）

### Bug 1：Pattern 1 要求空格（`\s+`）

**触发条件**：`都在/home/.../code/3d_demo目录下进行`（中文词紧跟路径，无空格）

```typescript
// 旧代码（有 bug）
const labeledRe = /(?:在|到|...)\s+`?([path])/  // \s+ 要求 ≥1 个空格

// 用户实际写法："都在/path"  ← 0 个空格
```

**修复**：`\s+` → `\s*`

### Bug 2：Pattern 2 前缀字符集不含汉字

**触发条件**：`在/home/...` 中，`在` 是前缀字符但不在 `[\s，。！？：；]` 集合中

```typescript
// 旧代码（有 bug）
const bareAbsRe = /(?:^|[\s，。！？：；`'"])(\/(...))/g
// ↑ 前缀集合不含 CJK 字符，所以 "在/path" 无法匹配

// 修复：加入 \u4e00-\u9fff（汉字范围）
const bareAbsRe = /(?:^|[\s，。！？：；`'"\u4e00-\u9fff\u3000-\u303f])(\/(...))/g
```

### Bug 3：Anchor 优先级错误（最根本的设计问题）

**触发条件**：用户附加 14 个 `3d_demo` 文件，但恰好 active editor 是 `media/docs/README.md`

```typescript
// 旧代码（有 bug）：active editor 优先于附件
const anchorFile = activeEditorFile ?? attachedFiles[0];
// → anchorFile = "media/docs/README.md"
// → promptDir = "media/docs/"
// → 新文件全部写到 media/docs/！

// 修复：附件优先于 active editor
const anchorFile = attachedFiles.length > 0 ? attachedFiles[0] : activeEditorFile;
// → anchorFile = "code/3d_demo/src/Camera3D.h"（附件中的第一个文件）
// → walk-up SRC_LIKE: src → stop at 3d_demo
// → promptDir = "code/3d_demo/"  ✓
```

**设计原则：用户主动附加文件 = 声明工作上下文，必须比被动打开的 active editor 优先级更高。**

---

## 七、Copilot vs Claude Code 的设计哲学差异

### Copilot 哲学：**IDE 原生，委托给 VS Code**

- 路径问题交给 IDE API 解决：`getWorkspaceFolder(uri)` 返回精确项目根
- Working Set 存的是 `vscode.Uri`，不存 string，绝不产生歧义
- 代价：强依赖 VS Code 运行时，不能单独运行

### Claude Code 哲学：**CLI 自立，多级回退兜底**

- 没有 IDE 依赖，必须自己解决路径问题
- 用 CWD 作为基准，recentFiles 字典作为 L2 缓存
- 通过 `workDir` 参数让工具调用继承正确的工作目录
- 代价：进程内存不持久化，重启后字典丢失

### DeepSeek 的位置：**两者结合，需要补全**

DevSeek 是 VS Code 插件但不使用 VS Code 文件 API（用 bridge + AI 自己写文件）。
结合了 Copilot 的 workspaceState 持久化 和 Claude Code 的四级回退字典，
但路径推导逻辑（promptDir detection）需要更健壮的实现：

| 问题 | Copilot 怎么避免 | Claude Code 怎么避免 | DevSeek 现状 |
|------|----------------|---------------------|-------------|
| 新文件去哪 | AI 输出完整绝对路径 | 相对 CWD 直接解析 | ✅ Architect prompt 注入【工作目录约束】块 |
| 汉字路径 | 不存在（英文 UI） | 不存在（CLI） | ✅ 已修复 Pattern 1/2 |
| Active editor 干扰 | 只取 workspace folder 级别 | 不存在（无 IDE） | ✅ 已修复 anchor 优先级 |
| 多子项目混淆 | getWorkspaceFolder per-file | CWD 固定 | ✅ promptDir 约束 + basenameMap 过滤 |
| grep 搜噪声 | 不适用 | CWD 级别 | ✅ 已修复：默认搜索任务目录而非工作区根 |
| promptDir 逻辑重复 | 不适用 | 不适用 | ✅ 提取 detectPromptDir() 消除冗余 |

---

## 八、改进路线图

### 第一轮（已完成）
- ✅ Pattern 1：`\s+` → `\s*`，支持无空格前缀
- ✅ Pattern 2：前缀加汉字字符范围 `\u4e00-\u9fff`
- ✅ Anchor：附件优先于 active editor

### 第二轮（已完成，2026-05-25）

**Fix 4：Architect System Prompt 注入工作目录约束**（Cursor 方案 B，已实施）

在 `buildDecomposeSystemPrompt` 中，调用 `detectPromptDir()` 得到 `promptDirRel`，
然后注入一个 `【工作目录约束】` 块到系统提示：

```
【工作目录约束（最高优先级）】
本次任务的目标目录：code/3d_demo/
file 字段必须写相对于 workspace 根的完整路径。
正确示例：code/3d_demo/docs/design.md
错误示例：design.md  （只写文件名，禁止）
```

同时将 `"file"` 字段说明升级为：
```
"file": "文件的完整相对路径（相对于 workspace 根，如 code/3d_demo/main.cpp；explore 任务填目标搜索目录）"
```

**效果**：AI 在 JSON plan 中直接输出 `code/3d_demo/docs/design.md`，
不再输出裸文件名 `design.md`，confine 块只作为兜底而非主要依赖。

**Fix 5：`onGrepSearch` 改为默认搜索任务目录**（已实施）

```typescript
// extension.ts — 修复前：始终从 wsRoot 搜索
const rawDir = path ? nodePath.join(wsRoot.fsPath, path) : wsRoot.fsPath;

// 修复后：优先级 explicit path > task workDir > wsRoot
let rawDir: string;
if (path) {
  rawDir = nodePath.isAbsolute(path) ? path : nodePath.join(wsRoot.fsPath, path);
} else if (workDir) {
  rawDir = workDir;   // 任务目录（如 code/3d_demo/）
} else {
  rawDir = wsRoot.fsPath;
}
```

同步更新了 `AgentLoopCallbacks.onGrepSearch` 签名（加 `workDir?: string` 参数），
并在 `executeFakeToolsForLoop` 调用时透传 `defaultWorkdir`。

**效果**：AI 在 `code/3d_demo/` 项目任务中用 `grep_search` 搜索 `Camera3D`，
结果只来自该项目，不再包含 `packages/bridge/src/` 等无关目录。

**Fix 6：提取 `detectPromptDir()` 共享函数（重构）**

将 `parseTaskPlan` 中约 100 行的内联 promptDir 检测逻辑提取为独立函数，
同时被 `buildDecomposeSystemPrompt`（Fix 4）和 `parseTaskPlan`（confine 块）调用，
确保两处逻辑永远保持一致，消除历史上「提示已注入某目录但解析用另一目录」的分叉异常。

### 长期（对齐 Copilot）

引入 `projectRootRegistry`（类 Copilot Working Set）：
将附件中的每个文件注册到 `Map<filename, { projectRoot, absPath }>`，
此后所有同项目的新文件直接用 `projectRoot + AI输出的相对路径` 定位，
不再依赖 promptDir 字符串解析。

当前剩余已知局限（低优先级）：
- `onReadFile` P0 按 basename 查字典，同名文件跨项目时末注册者覆盖先注册者；
  可用 `workDir` + 路径前缀过滤优化，但实际冲突场景极少。
- `sessionRecentFiles` 恢复后用 `workspaceFolders[0]`，多根工作区可能偏移；
  当前单根工作区无影响。

---

## 九、参考材料

| 来源 | 说明 |
|------|------|
| [SESSION_PATH_MEMORY_ANALYSIS.md](./SESSION_PATH_MEMORY_ANALYSIS.md) | DeepSeek 记忆架构全文（v8），含 Copilot/Claude Code 对比 |
| [COPILOT_AGENT_WORKFLOW.md](./COPILOT_AGENT_WORKFLOW.md) | Copilot Agent 执行流程参考手册 |
| [agent-task-decomposer.ts](../../packages/vscode-extension/src/agent-task-decomposer.ts) | 当前 promptDir 检测+confine 实现 |
| VS Code 源码 `workbench.desktop.main.js` | Copilot Working Set / getWorkspaceFolder 实现参考 |
| Claude Code CLI 公开文档 + 逆向分析 | recentFiles 字典、四级回退、CLAUDE.md 格式 |
