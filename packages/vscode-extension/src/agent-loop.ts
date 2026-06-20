/**
 * Agent Loop — Phase-1 executor (Editor role)
 *
 * Architecture: Two-phase Agent Loop (Architect + Editor), matching how
 * Aider, Cursor Agent, and Copilot Edits work internally.
 *
 *   Phase-0 (Architect): decomposeTask() → structured JSON plan of AgentTask[]
 *   Phase-1 (Editor):    runAgentLoop()  → execute each task with a focused,
 *                                          single-file structured prompt
 *
 * Key improvements over the previous version:
 * ─────────────────────────────────────────────────────────────────
 * 1. FILE CONTENT INJECTION
 *    Every editor/analyze prompt now includes the CURRENT file content read
 *    directly from the local filesystem.  The LLM never has to guess what is
 *    already in the file — it always edits from ground truth.
 *
 * 2. SEARCH/REPLACE BLOCKS (Aider/Cursor style)
 *    For modify tasks the editor is asked to output targeted change blocks:
 *
 *      <<<<<<< SEARCH
 *      exact current code
 *      =======
 *      new code
 *      >>>>>>> REPLACE
 *
 *    This is far more reliable than full-file replacement: the LLM writes only
 *    the CHANGED parts, hallucination is lower, and the parser is deterministic.
 *    Full-file output is still accepted as a fallback when no blocks are found.
 *
 * 3. CONSOLIDATED ANALYSIS
 *    When all tasks are analyze/explain, a single LLM call analyzes every file
 *    together (content injected) and streams one organized markdown response.
 *    This replaces N separate streaming calls that flooded the chat bubble.
 *
 * 4. RETRY ON APPLY FAILURE
 *    If the first edit attempt produces no recognized change, one retry is made
 *    with the explicit current file content and a simplified prompt.
 *
 * 5. COMPILE VALIDATION (C/C++ only)
 *    Unchanged: runs after all modify tasks, skipped for analyze/explain.
 */

import * as nodePath from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getActiveProvider } from './llm/provider-router';
import { ChatMessage } from './llm/types';
import { AgentTask, AgentTaskAction, readFileContentSafe, readFileContentFull } from './agent-task-decomposer';
import { fenceLangForFile, roughLineDiff } from './utils';
import { findWorkspaceFolderForRelativePath } from './workspace-roots';
import { applyGeneratedArtifactsWithPrompt } from './workspace-applier';
import { runLocalExecution, LocalExecutionPlan, planLocalExecution } from './execution-planner';
import { McpToolRef } from './mcp/client';
import { getProjectRulesSync, wrapRulesAsContext, getProjectMemorySync, wrapMemoryAsContext } from './project-rules';
import { getCommandHints } from './agent-learner';
import {
  findFirstToolCallStart,
  parseFakeToolCalls,
  stripToolCallBlocks,
  type FakeTool,
} from './agent/fake-tool-parser';
import {
  getTerminalRecoveryProtocol,
  makeTerminalCmdSignature,
} from './agent/write-guard';
import {
  coalesceWrittenFileEvidence,
  getMissingCompletionEvidence,
  isExplicitlyReadOnlyRequest,
  requiresCommandEvidence,
  requiresFileChangeEvidence,
  requiresReadEvidence,
  requiresRuntimeValidation,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './agent/completion-evidence';
import { buildAgenticHistoryText, buildAgenticQualityGateForHistory } from './agent/agentic-history';
import { runAgentAutoValidationForWrites } from './agent/auto-validation';
import {
  buildMissingEvidenceRecoveryInstruction,
  inferInitialAgenticTodos,
  markMissingEvidenceTodosIncomplete,
  markValidationFailureTodos,
  type TodoItem,
} from './agent/evidence-recovery';
import type { AgentLoopCallbacks, AgentLoopResult } from './agent/loop-types';
import {
  agentAnnouncementKey,
  cleanAgentFinalSummaryForUser,
  normalizeAgentUserAnnouncement,
} from './agent/agentic-summary';
import {
  analyzeTerminalEvidence,
  applyMarkdownFileArtifactsForLoop,
  describeAgentToolActivity,
  executeFakeToolsForLoop,
  normalizeVisibleTodos,
} from './agent/tool-loop';
import { WorkspaceEditService } from './workspace/edit-service';
import type { CppValidationPolicy } from './validation-planner';
import type { ExecutionMode } from './intent/intent-types';

// ----------------------------------------------------------------
// Reporter types (passed in from extension.ts)
// ----------------------------------------------------------------

// ── L-2/L-3: AI 可调用工具类型 ──────────────────────────────────────────────────

const workspaceEditService = new WorkspaceEditService();

function extractPlanningTodoItems(text: string): TodoItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex((line) => /(规划任务|任务规划|任务清单|待办清单|计划任务|规划如下|计划如下|todos?|tasks?)(：|:)?$/i.test(line));
  if (startIndex < 0) return [];
  const sourceLines = lines.slice(startIndex + 1);

  const items: string[] = [];
  for (const rawLine of sourceLines) {
    if (!/^\s*(?:[-*•]|\d+[.)、])\s+/.test(rawLine)) {
      if (items.length > 0) break;
      continue;
    }
    const line = rawLine
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+[.)、]\s*/, '')
      .trim();

    if (!line) continue;
    if (/^(<tool_call>|\[TOOL:|```|\{|\}|我来|让我|下面是|以下是|请开始|开始执行|让我开始)/i.test(line)) break;
    if (/^(规划任务|任务规划|任务清单|待办清单|计划任务|规划如下|计划如下)$/i.test(line)) continue;
    if (/^[，。,。.；;：:]+$/.test(line)) continue;
    items.push(line);
  }

  const uniqueItems: string[] = [];
  for (const item of items) {
    if (!uniqueItems.includes(item)) uniqueItems.push(item);
  }

  if (uniqueItems.length === 0) return [];
  return uniqueItems.slice(0, 8).map((title, index) => ({
    id: index + 1,
    title,
    status: index === 0 ? 'in-progress' : 'not-started',
  }));
}

/**
 * I-2: 系统提示词工程 — 生成上下文感知的工具调用指导。
 *
 * G8 (simplified): workflow hints describe capabilities, not rigid orchestration steps.
 * The AI decides when it has completed its task. For multi-task plans, each Editor
 * call is scoped to ONE task — external loop in runAgentLoop handles sequencing.
 */
function buildToolsSuffix(taskIndex: number, taskTotal: number, mcpTools?: McpToolRef[], taskWorkdir?: string): string {
  const isFirst = taskIndex === 1;
  const isLast  = taskIndex === taskTotal;
  const isSingle = taskTotal === 1;

  // For multi-task plans each Editor call covers exactly ONE task; the outer loop in
  // runAgentLoop advances to the next task automatically.  task_complete is therefore
  // only meaningful (and advertised) for the very last task — intermediate tasks must
  // NOT call it, otherwise the loop breaks prematurely and later tasks never run.
  const workflowHint = isSingle || isLast
    ? `
【完成信号】
完成本文件修改后，调用 task_complete 工具，附上完成报告（包含：1)修改了哪些文件及关键改动；2)为什么这样改；3)需注意的副作用或潜在问题）。
过程中可用 manage_todo_list 跟踪进度（只将当前任务标为 in-progress，未完成任务保持 not-started）。
`
    : isFirst
    ? `
【当前任务】第 ${taskIndex}/${taskTotal} 个任务（序列计划第一步）
完成本文件内容输出后停止，系统会自动推进到下一个任务。
`
    : `
【当前任务】第 ${taskIndex}/${taskTotal} 个任务
完成本文件内容输出后停止，系统会自动推进到下一个任务。
`;

  // P3-5: Append MCP tools section if any servers are connected
  let mcpSection = '';
  if (mcpTools && mcpTools.length > 0) {
    const toolLines = mcpTools.map((ref) => {
      const schema = JSON.stringify(ref.tool.inputSchema ?? {});
      return `  [TOOL:${ref.fakeName} ${schema}]  — ${ref.tool.description || ref.tool.name}`;
    }).join('\n');
    mcpSection = `

## MCP 外部工具（通过相同格式调用）

以下工具由外部 MCP server 提供。调用格式与上方相同：
[TOOL:mcp__<server>__<tool> {"param":"value"}]

可用工具：
${toolLines}

调用 MCP 工具后，结果将作为下一轮输入附上。`;
  }

  return `
## 可用工具（通过文本格式调用）

格式严格如下（JSON 必须完整，不省略花括号）：
${isSingle || isLast ? `
更新任务列表（全量替换，每次必须包含所有任务）：
[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"任务标题","status":"in-progress"},{"id":2,"title":"另一任务","status":"not-started"}]}]

标记全部完成（仅最后一个任务才可调用）：
[TOOL:task_complete {"summary":"完成报告：1)修改内容（文件名+关键改动）；2)修改原因；3)注意事项或潜在影响（如有）"}]
` : ''}
执行终端命令（输出将在下轮可见，可用于编译验证、运行测试等）：
[TOOL:run_terminal {"command":"npm run build","workdir":"${taskWorkdir ?? '/可选/绝对/路径'}"}]

读取工作区文件内容（路径相对于工作区根，或绝对路径）：
[TOOL:read_file {"path":"src/foo.ts"}]

搜索工作区文件内容（支持正则，可指定目录路径）：
[TOOL:grep_search {"pattern":"className|funcName","path":"src/","isRegexp":true}]

按 glob 模式查找文件名（不读取内容）：
[TOOL:file_search {"glob":"src/**/*.ts"}]

语义化搜索工作区代码（按意图/概念，自动提取关键词）：
[TOOL:semantic_search {"query":"用户登录验证处理函数"}]

列出目录内容（相对于工作区根目录）：
[TOOL:list_dir {"path":"src/utils/"}]

获取当前 VS Code 编译/诊断错误（类型错误、语法错误等）：
[TOOL:get_errors {}]

将重要发现写入项目记忆（由 DevSeek MemoryService 管理，供未来 session 使用）。
触发时机：发现架构规律、非显而易见的约定、反复出现的错误原因时主动写入：
[TOOL:memory_write {"content":"关键记录内容（100字以内）"}]

查看当前工作区 git 变更摘要（已修改/新增/已删除文件列表及 diff）：
[TOOL:get_changed_files {}]

创建目录（含父级目录，相对于工作区根或绝对路径）：
[TOOL:create_directory {"path":"src/utils/helpers"}]

获取网页内容（用于查阅文档、API 参考、错误信息等；仅支持 http/https）：
[TOOL:fetch_webpage {"url":"https://example.com/docs"}]

查找某个符号（函数/类/变量/接口）在整个代码库中的所有引用位置（使用语言服务器语义分析，比 grep 更精确；可跳过注释和字符串误匹配）：
[TOOL:vscode_listCodeUsages {"symbol":"FunctionName","filePath":"src/foo.ts"}]

执行 VS Code 编辑器命令（格式化文档、整理 import、运行任务、重启类型检查等；非白名单命令需用户确认）：
[TOOL:run_vscode_command {"command":"editor.action.formatDocument"}]
[TOOL:run_vscode_command {"command":"workbench.action.tasks.runTask","args":["Build"]}]
${isSingle || isLast ? `\n状态枚举："not-started" | "in-progress" | "completed"` : ''}
${workflowHint}${mcpSection}`;
}
export type { AgentLoopCallbacks, AgentLoopResult, AgentStatusMessage } from './agent/loop-types';

function consumeUserSteerMessages(callbacks: AgentLoopCallbacks): ChatMessage[] {
  const items = callbacks.onUserSteer?.() ?? [];
  return items
    .map(text => String(text || '').trim())
    .filter(Boolean)
    .map(text => ({
      role: 'user' as const,
      content: [
        '【用户实时补充/纠偏】',
        text,
        '',
        '请将以上内容作为当前任务的最新约束继续执行；如它与旧计划冲突，以这条补充为准。不要从头开启新任务，先调整 todo/后续步骤再继续。',
      ].join('\n'),
    }));
}

// ----------------------------------------------------------------
// Per-task prompt builder (Editor role)
// ----------------------------------------------------------------

// ── L-1/L-4: Provider-aware chat wrapper ─────────────────────────────────────
// Replaces the old `chat()` import from bridge-client.
// Optionally prepends cross-round history to give the LLM context of what
// was already done earlier in this agent session.
// Returns { text, tools } where tools are parsed fake tool calls.

/** Multi-round agentic helper — takes a pre-built messages array instead of prompt+history. */
async function chatWithMessages(
  messages: ChatMessage[],
  mode: 'fast' | 'r1' | undefined,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
  newSession = false,
): Promise<{ text: string; tools: FakeTool[] }> {
  const provider = getActiveProvider();
  const text = await provider.chat({ messages, stream: true, onDelta, mode, signal, newSession });
  return { text, tools: parseFakeToolCalls(text) };
}

async function chatViaProvider(
  prompt: string,
  mode: 'fast' | 'r1' | undefined,
  onDelta?: (delta: string) => void,
  history?: ChatMessage[],
  signal?: AbortSignal,
  newSession = false,
): Promise<{ text: string; tools: FakeTool[] }> {
  const provider = getActiveProvider();
  const messages: ChatMessage[] = [
    ...(history ?? []),
    { role: 'user', content: prompt },
  ];
  const text = await provider.chat({ messages, stream: true, onDelta, mode, signal, newSession });
  const tools = parseFakeToolCalls(text);
  return { text, tools };
}

/** Only C/C++ files need compile validation */
function isCompilableFile(filename: string): boolean {
  return ['.cpp', '.c', '.h', '.hpp', '.cc', '.cxx'].includes(
    nodePath.extname(filename).toLowerCase(),
  );
}

/**
 * Returns true if the error is a transient network / connectivity failure
 * that can be resolved by reconnecting, rather than a permanent logic error.
 * Used to distinguish "网络断了，可以续传" from "代码有 bug，不能续传".
 */
function isNetworkError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  // fetch-level failures
  if (msg.includes('failed to fetch') || msg.includes('fetch failed')) return true;
  // Node.js / OS connection errors
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('econnreset')) return true;
  if (msg.includes('etimedout') || msg.includes('socket hang up')) return true;
  // Browser / VS Code webview network errors
  if (msg.includes('networkerror') || msg.includes('network error')) return true;
  // AbortError caused by our AbortSignal.timeout() (upstream bridge disconnect)
  // Note: user-initiated abort (stop button) has name === 'AbortError' but we
  // should NOT treat that as a network error — it was intentional. We distinguish
  // by checking if the message mentions timeout or connection.
  if (e instanceof Error && e.name === 'AbortError' && (msg.includes('timeout') || msg.includes('timed out'))) return true;
  // DeepSeek bridge-specific error strings
  if (msg.includes('login_required')) return false; // auth failure, not network
  if (msg.includes('http 502') || msg.includes('http 503') || msg.includes('http 504')) return true;
  return false;
}

// ----------------------------------------------------------------
// SEARCH/REPLACE block parser (Aider/Cursor style targeted edits)
// ----------------------------------------------------------------

interface SearchReplaceBlock {
  search: string;
  replace: string;
}

/**
 * Parse SEARCH/REPLACE blocks from LLM output.
 *
 * Expected format (one or more per response):
 *   <<<<<<< SEARCH
 *   exact code to find
 *   =======
 *   new code to replace with
 *   >>>>>>> REPLACE
 */
function parseSearchReplaceBlocks(raw: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  const re = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    blocks.push({ search: match[1], replace: match[2] });
  }
  return blocks;
}

interface ApplyBlocksResult {
  result: string;
  applied: number;
  failed: number;
  errors: string[];
}

/**
 * Apply SEARCH/REPLACE blocks to file content.
 * Tries exact match first, then normalized line-endings as fallback.
 */
function applySearchReplaceBlocks(
  content: string,
  blocks: SearchReplaceBlock[],
): ApplyBlocksResult {
  let result = content;
  let applied = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const block of blocks) {
    if (result.includes(block.search)) {
      // Use indexOf+slice rather than String.replace to avoid regex special chars
      const idx = result.indexOf(block.search);
      result = result.slice(0, idx) + block.replace + result.slice(idx + block.search.length);
      applied++;
    } else {
      // Normalize line endings and retry
      const norm = (s: string) => s.replace(/\r\n/g, '\n');
      const normContent = norm(result);
      const normSearch = norm(block.search);
      if (normContent.includes(normSearch)) {
        const idx2 = normContent.indexOf(normSearch);
        result = normContent.slice(0, idx2) + block.replace + normContent.slice(idx2 + normSearch.length);
        applied++;
      } else {
        failed++;
        errors.push(`未找到匹配文本: "${block.search.slice(0, 80).trim()}"`);
      }
    }
  }

  return { result, applied, failed, errors };
}

// ----------------------------------------------------------------
// Prompt builders — all include current file content
// ----------------------------------------------------------------

/**
 * Detects required compiler/linker flags from C/C++ source content.
 * Used to automatically add -lGL -lGLU -lglut etc. when the AI compiles OpenGL programs.
 */
function scanLibFlagsFromContent(content: string): string {
  const flags = new Set<string>();
  if (/^\s*#include\s+[<"][^>"]*\bGL\/(gl|glu)\.h[>"]/im.test(content))       { flags.add('-lGL'); flags.add('-lGLU'); }
  if (/^\s*#include\s+[<"][^>"]*\bGL\/(glut|freeglut)\.h[>"]/im.test(content)) { flags.add('-lglut'); flags.add('-lGL'); flags.add('-lGLU'); }
  if (/^\s*#include\s+[<"][^>"]*\bGLFW\/glfw3\.h[>"]/im.test(content))        { flags.add('-lglfw'); }
  if (/^\s*#include\s+[<"][^>"]*\bglew\.h[>"]/im.test(content))               { flags.add('-lGLEW'); }
  if (/^\s*#include\s+<(math\.h|cmath)>/im.test(content))                     { flags.add('-lm'); }
  if (/^\s*#include\s+<pthread\.h>/im.test(content))                          { flags.add('-lpthread'); }
  return [...flags].join(' ');
}

/**
 * Prompt for analyze/explain tasks: asks for text analysis, no code output.
 * Current file content is included so the LLM analyses the actual code.
 */
// G3: added taskIndex/taskTotal/mcpTools so all analyze tasks receive tool definitions
// G4: callers now always use multi-round loop regardless of exec intent
function buildAnalyzePrompt(
  userPrompt: string,
  task: AgentTask,
  currentContent: string,
  workdirOverride?: string,
  taskIndex: number = 1,
  taskTotal: number = 1,
  mcpTools?: McpToolRef[],
): string {
  const basename = nodePath.basename(task.file);
  const ext = (basename.split('.').pop() ?? '').toLowerCase();
  const langMap: Record<string, string> = {
    cpp: 'cpp', cc: 'cpp', h: 'c', c: 'c', hpp: 'cpp',
    ts: 'typescript', js: 'javascript', py: 'python', md: 'markdown',
  };
  const lang = langMap[ext] ?? ext;

  const contentSection = currentContent
    ? [`【当前文件内容】`, '```' + lang, currentContent, '```', ''].join('\n')
    : '';

  // Inject project rules + AI memory if present
  const _analyzeRules = getProjectRulesSync();
  const _analyzeMemory = getProjectMemorySync();
  const _analyzeContext = [
    _analyzeRules ? wrapRulesAsContext(_analyzeRules) : '',
    _analyzeMemory ? wrapMemoryAsContext(_analyzeMemory) : '',
  ].filter(Boolean).join('\n\n');

  // Provide a focused hint for compile/run tasks (AI still has run_terminal via buildToolsSuffix)
  const isExecTask = /编译|运行|执行|compile|build|run\b|execute/i.test(task.desc + userPrompt);
  const taskDir = workdirOverride ?? (task.absPath ? nodePath.dirname(task.absPath) : '');
  const workdirHint = taskDir ? `, "workdir":"${taskDir}"` : '';
  const noExt = basename.replace(/\.[^.]+$/, '');
  // Use absolute source/output paths — command is correct even if AI omits workdir
  const srcArg = task.absPath ? `'${task.absPath.replace(/'/g, "'\\''")}'` : basename;
  const exeArg = taskDir ? `'${nodePath.join(taskDir, noExt).replace(/'/g, "'\\''")}'` : noExt;
  // Auto-detect required library flags from #include directives (e.g. -lGL -lGLU -lglut)
  const libFlags = isExecTask ? scanLibFlagsFromContent(currentContent) : '';
  const libFlagsSuffix = libFlags ? ` ${libFlags}` : '';
  let defaultCmd = `gcc ${srcArg} -o ${exeArg}${libFlagsSuffix} && ${exeArg}`;
  if (/\.cpp$|\.cc$/i.test(basename)) defaultCmd = `g++ -std=c++17 ${srcArg} -o ${exeArg}${libFlagsSuffix} && ${exeArg}`;
  else if (/\.py$/i.test(basename)) defaultCmd = `python3 ${srcArg}`;
  else if (/\.js$/i.test(basename)) defaultCmd = `node ${srcArg}`;
  const learnedCmds = isExecTask ? getCommandHints('compile') : '';
  const learnedCmdsSection = learnedCmds
    ? `\n【已知成功命令（优先使用）】\n${learnedCmds}\n`
    : '';
  const execSection = isExecTask
    ? `\n【编译/运行提示】如需执行，可直接使用 run_terminal 工具（命令中必须使用绝对路径，严禁使用相对路径，以确保不同工作目录下路径正确）：\n[TOOL:run_terminal {"command":"${defaultCmd}"${workdirHint}}]\n（命令可按需修改，必须通过工具调用执行，不要只描述步骤）\n${learnedCmdsSection}`
    : '';

  return [
    `你是代码分析智能体，请分析文件 ${basename}。你有完整工具访问权限，可以主动读取相关文件、搜索代码、执行命令。`,
    ``,
    _analyzeContext,
    `【用户需求背景】`,
    userPrompt,
    ``,
    `【本次任务】`,
    `文件: ${basename}`,
    `目标: ${task.desc}`,
    ``,
    contentSection,
    execSection,
    `【分析要求】`,
    `- 若需要查看相关文件、搜索代码引用，请主动调用工具`,
    `- 给出有具体证据的分析（文件路径/行号/函数名）`,
    `- 如有具体问题，明确指出问题位置和改进建议`,
    `- 使用简体中文回复`,
    buildToolsSuffix(taskIndex, taskTotal, mcpTools, taskDir),
  ].join('\n');
}

/**
 * Editor prompt for modify/create tasks.
 *
 * CRITICAL: currentContent is injected directly so the LLM knows the exact
 * current state of the file.  The preferred output format is SEARCH/REPLACE
 * blocks (targeted, reliable).  Full-file output is accepted as fallback.
 */
function buildEditorPrompt(
  userPrompt: string,
  task: AgentTask,
  allTasks: AgentTask[],
  currentContent: string,
  taskIndex: number = 1,
  taskTotal: number = 1,
  mcpTools?: McpToolRef[],
  analysisContext?: string,
  workdirOverride?: string,
  wsRootPath?: string,
): string {
  const basename = nodePath.basename(task.file);
  // Use workspace-relative path (e.g. 'code/3d_sphere.cpp') so the LLM knows the real
  // directory and won't guess a wrong one (e.g. 'src/') in the output file header.
  const displayPath = (wsRootPath && task.absPath && task.absPath.startsWith(wsRootPath))
    ? task.absPath.slice(wsRootPath.length).replace(/^\/|^\\/, '').replace(/\\/g, '/')
    : basename;
  const lang = fenceLangForFile(basename);
  const otherModify = allTasks
    .filter(t => t.id !== task.id && (t.action === 'modify' || t.action === 'create'))
    .map(t => `  - ${nodePath.basename(t.file)}`)
    .join('\n');

  const contentSection = currentContent
    ? [
        `【当前文件完整内容】`,
        '```' + lang,
        currentContent,
        '```',
        '',
      ].join('\n')
    : '';

  // For create action there's no existing content
  const isCreate = task.action === 'create';

  // Prior-round analysis/session context — injected when user issues a follow-up
  // like "按照建议优化代码" or "再添加一个". Without this the Editor has no idea
  // what "建议/再/它" refers to.
  const analysisSection = analysisContext
    ? [`【同一会话上下文 — 实现时必须参考】`, analysisContext.slice(0, 3000), ``].join('\n')
    : '';

  // Project rules from .devseek/rules.md — injected if present
  const projectRules = getProjectRulesSync();
  const projectRulesSection = projectRules ? [wrapRulesAsContext(projectRules), ``].join('\n') : '';
  const projectMemory = getProjectMemorySync();
  const projectMemorySection = projectMemory ? [wrapMemoryAsContext(projectMemory), ``].join('\n') : '';

  return [
    `你是一个专业的编程智能体（Editor 角色），正在执行多文件任务中的一个子任务。`,
    ``,
    projectRulesSection,
    projectMemorySection,
    `【原始用户需求】`,
    userPrompt,
    ``,
    analysisSection,
    `【本次子任务】`,
    `文件: ${displayPath}`,
    `操作: ${task.action}`,
    `任务: ${task.desc}`,
    ``,
    otherModify ? `【本轮其他修改文件（仅供参考，本次不包含）】\n${otherModify}\n` : '',
    isCreate ? '' : contentSection,
    `【输出格式要求（严格遵守）】`,
    isCreate
      ? [
          `请输出新文件 ${displayPath} 的完整内容：`,
          ``,
          `${displayPath}`,
          '```' + lang,
          `// 完整新文件内容`,
          '```',
        ].join('\n')
      : [
          `优先使用 SEARCH/REPLACE 格式输出改动（每个改动一个块）：`,
          ``,
          `<<<<<<< SEARCH`,
          `// 需要替换的原始代码（必须与上方文件内容完全一致）`,
          `=======`,
          `// 替换后的新代码`,
          `>>>>>>> REPLACE`,
          ``,
          `若改动量超过文件 50%，改用完整文件输出：`,
          ``,
          `${displayPath}`,
          '```' + lang,
          `// 完整最终内容（不可省略任何行）`,
          '```',
          ``,
          `规则：`,
          `- SEARCH 块必须与文件中的代码完全一致（包括空格和缩进）`,
          `- 只修改任务要求的部分，保留其余代码不变`,
          `- 禁止在格式块外添加解释性文字`,
        ].join('\n'),
    buildToolsSuffix(taskIndex, taskTotal, mcpTools, workdirOverride ?? (task.absPath ? nodePath.dirname(task.absPath) : undefined)),
  ].filter(Boolean).join('\n');
}

// ----------------------------------------------------------------
// Consolidated analysis: one call for all analyze/explain tasks
// ----------------------------------------------------------------

/**
 * Execute ALL analyze/explain tasks in a single LLM call.
 *
 * Instead of N separate streaming calls that flood the chat bubble, this
 * function embeds all file contents into one prompt and streams a single
 * organized markdown response.  Much faster and cleaner.
 */
async function executeAnalysisConsolidated(
  tasks: AgentTask[],
  userPrompt: string,
  mode: 'fast' | 'r1' | undefined,
  callbacks: AgentLoopCallbacks,
  history?: ChatMessage[],
  newSession = false,
): Promise<string> {  // returns full analysis text for findings extraction
  const total = tasks.length;
  // Per-file content limit — prevents context overflow; generous since each call only has ONE file.
  const MAX_FILE_CHARS = 14000; // ~400 lines of code
  // Per-file analysis result buffer (for summary prompt)
  const fileAnalyses: { file: string; text: string }[] = [];
  const langMap: Record<string, string> = {
    cpp: 'cpp', cc: 'cpp', h: 'c', c: 'c', hpp: 'cpp',
    ts: 'typescript', js: 'javascript', py: 'python', md: 'markdown',
  };

  // ── Sequential per-file analysis (Copilot/Claude Code pattern) ───────────
  // Each file gets its own LLM call: no cross-file context overflow, per-file
  // collapsible cards stream in the webview as results arrive.
  for (let i = 0; i < total; i++) {
    const t = tasks[i];
    const basename = nodePath.basename(t.file);
    const lang = langMap[(basename.split('.').pop() ?? '').toLowerCase()] ?? '';

    // Emit analyzeFile:started — webview creates a collapsible streaming card
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'analyzeFile',
      taskId: t.id, taskFile: basename,
      taskAction: t.action, taskDesc: t.desc,
      taskIndex: i + 1, taskTotal: total,
      state: 'started',
      title: t.desc || `分析 ${basename}`,
      detail: basename,
    });
    // Also emit execute:started for Working-box progress row
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      taskId: t.id, taskFile: basename,
      taskAction: t.action, taskDesc: t.desc,
      taskIndex: i + 1, taskTotal: total,
      state: 'started',
      title: t.desc || `分析 ${basename}`,
      detail: basename,
    });

    // Read file content with truncation safeguard
    let rawContent = t.absPath ? readFileContentFull(t.absPath) : '';
    const wasTruncated = rawContent.length > MAX_FILE_CHARS;
    if (wasTruncated) rawContent = rawContent.slice(0, MAX_FILE_CHARS);
    const truncNote = wasTruncated
      ? `\n\n⚠️ 文件内容较长，已截取前 ${MAX_FILE_CHARS} 字符（约 400 行）进行分析。`
      : '';

    const filePrompt = [
      `你是代码分析智能体，请分析以下文件（第 ${i + 1} / ${total} 个）。`,
      ``,
      `【用户需求】`,
      userPrompt,
      ``,
      `【文件】${basename}${truncNote}`,
      rawContent
        ? ['```' + lang, rawContent, '```'].join('\n')
        : `（无法读取 ${basename} 的内容）`,
      ``,
      `【任务说明】${t.desc}`,
      ``,
      `【输出格式】（必须按此格式输出，不要重复文件名作为标题）`,
      `**概述**：（2-4 句描述文件功能和结构）`,
      `**分析**：（针对用户需求，列出关键发现，可用 bullet points，指出关键函数/行号）`,
      `**建议**：（具体改进点，如无则省略）`,
      ``,
      `用简体中文回复，分析要具体，不要空泛。`,
    ].join('\n');

    let fileText = '';
    try {
      const { tools: fTools } = await chatViaProvider(
        filePrompt, mode,
        (delta) => {
          if (delta.startsWith('\x00RESET\x00')) {
            fileText = delta.slice(7); // reset accumulated text
            callbacks.onDelta('\x00AFILE:' + basename + '\x00\x00RESET\x00' + delta.slice(7));
          } else {
            fileText += delta;
            callbacks.onDelta('\x00AFILE:' + basename + '\x00' + delta);
          }
        },
        history,
        callbacks.signal,
        i === 0 ? newSession : false, // only the first file uses newSession
      );
      const analyzeWorkdir = t.absPath ? nodePath.dirname(t.absPath) : undefined;
      await executeFakeToolsForLoop(fTools, callbacks, analyzeWorkdir, {
        currentTaskIndex: i + 1,
        taskTotal: total,
        deferDoneStatus: true,
        userPrompt,
      });
      fileAnalyses.push({ file: basename, text: fileText });

      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'analyzeFile',
        taskId: t.id, taskFile: basename,
        taskAction: t.action, taskDesc: t.desc,
        taskIndex: i + 1, taskTotal: total,
        state: 'completed',
        title: t.desc || basename,
        detail: basename,
      });
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'execute',
        taskId: t.id, taskFile: basename,
        taskAction: t.action, taskDesc: t.desc,
        taskIndex: i + 1, taskTotal: total,
        state: 'completed',
        title: t.desc || basename,
        detail: basename,
      });
    } catch (e) {
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'analyzeFile',
        taskId: t.id, taskFile: basename,
        taskAction: t.action, taskDesc: t.desc,
        taskIndex: i + 1, taskTotal: total,
        state: 'failed',
        title: t.desc || basename,
        detail: (e as Error).message,
      });
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'execute',
        taskId: t.id, taskFile: basename,
        taskAction: t.action, taskDesc: t.desc,
        taskIndex: i + 1, taskTotal: total,
        state: 'failed',
        title: t.desc || basename,
        detail: (e as Error).message,
      });
      if (callbacks.signal?.aborted) break;
    }
  }

  if (fileAnalyses.length === 0) return '';

  // ── Final summary call ────────────────────────────────────────────────────
  // Emit analyzeSummary:started — webview creates the summary card
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'analyzeSummary',
    taskId: 'summary',
    taskFile: '',
    taskIndex: total,
    taskTotal: total,
    state: 'started',
    title: '综合总结',
  });

  // Build summary prompt — truncate each file's analysis to keep total context small
  const MAX_ANALYSIS_CHARS_PER_FILE = 600;
  const analysisList = fileAnalyses
    .map((fa, i) => {
      const snippet = fa.text.length > MAX_ANALYSIS_CHARS_PER_FILE
        ? fa.text.slice(0, MAX_ANALYSIS_CHARS_PER_FILE) + '…'
        : fa.text;
      return `${i + 1}. **${fa.file}**\n${snippet}`;
    })
    .join('\n\n');

  const summaryPrompt = [
    `以下是对 ${total} 个文件的逐一分析摘要：`,
    ``,
    analysisList,
    ``,
    `【用户需求】`,
    userPrompt,
    ``,
    `请给出 3-5 句整体评价，指出最重要的改进方向或共性问题。`,
    `用简体中文，直接输出总结文字，不加标题，不重复文件名。`,
  ].join('\n');

  let summaryText = '';
  try {
    await chatViaProvider(
      summaryPrompt, mode,
      (delta) => {
        if (delta.startsWith('\x00RESET\x00')) {
          summaryText = delta.slice(7);
          callbacks.onDelta('\x00ASUM\x00\x00RESET\x00' + delta.slice(7));
        } else {
          summaryText += delta;
          callbacks.onDelta('\x00ASUM\x00' + delta);
        }
      },
      undefined, // no history for summary — avoid polluting context
      callbacks.signal,
      false,
    );
  } catch (_e) { /* summary failure is non-fatal */ }

  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'analyzeSummary',
    taskId: 'summary',
    taskFile: '',
    taskIndex: total,
    taskTotal: total,
    state: 'completed',
    title: '综合总结',
  });

  const fullAnalysisText = fileAnalyses.map(fa => `## ${fa.file}\n${fa.text}`).join('\n\n')
    + (summaryText ? '\n\n## 综合总结\n' + summaryText : '');
  return fullAnalysisText;
}

// ----------------------------------------------------------------
// Execute a single task
// ----------------------------------------------------------------

async function executeTask(
  task: AgentTask,
  taskIndex: number,
  allTasks: AgentTask[],
  userPrompt: string,
  mode: 'fast' | 'r1' | undefined,
  workspaceRoot: vscode.Uri,
  callbacks: AgentLoopCallbacks,
  contentCache: Map<string, string>,
  history?: ChatMessage[],
  analysisContext?: string,
  newSession = false,
): Promise<{ applied: boolean; path?: string; raw?: string; taskComplete?: boolean; linesAdded?: number; linesRemoved?: number; networkError?: boolean }> {
  const basename = nodePath.basename(task.file);
  // Only the very first LLM call for this task uses newSession; subsequent
  // rounds (retries, tool-feedback loops) continue in the same session.
  let firstCall = true;
  const consumeNewSession = () => { const ns = firstCall && newSession; firstCall = false; return ns; };

  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    taskId: task.id,
    taskFile: basename,
    taskAction: task.action,
    taskDesc: task.desc,
    taskIndex,
    taskTotal: allTasks.length,
    state: 'started',
    title: task.desc || `执行 ${basename}`,
    detail: basename,
  });

  // Read current file content — prefer contentCache (updated by prior tasks in this
  // same loop) over disk read, so multi-task edits on the same file properly chain.
  // Use readFileContentFull: Editor needs the COMPLETE file for exact SEARCH matching.
  const currentContent = (task.absPath && contentCache.has(task.absPath))
    ? (contentCache.get(task.absPath) ?? '')
    : (task.absPath ? readFileContentFull(task.absPath) : '');

  // Pre-compute effectiveAbsPath early — needed by both analyze and editor paths.
  let earlyEffectiveAbsPath = task.absPath;
  if (!earlyEffectiveAbsPath && task.file) {
    const relNorm = task.file.replace(/\\/g, '/').replace(/^\.\//, '');
    // For modify/create: try to locate file in all workspace folders before falling back.
    // This handles multi-root workspaces where workspaceRoot may point to the wrong folder.
    if (!nodePath.isAbsolute(relNorm)) {
      for (const wf of (vscode.workspace.workspaceFolders ?? [])) {
        const candidate = nodePath.join(wf.uri.fsPath, ...relNorm.split('/'));
        if (fs.existsSync(candidate)) { earlyEffectiveAbsPath = candidate; break; }
      }
    }
    if (!earlyEffectiveAbsPath && task.action === 'create') {
      // For new files: prefer the directory of sibling tasks so the new file lands in
      // the same project folder, not at the workspace root.
      // Apply to both bare filenames and paths with subdirectories (e.g. "test/run_tests.sh"):
      //   sibling in code/3d_demo/ + relNorm "test/run_tests.sh" → code/3d_demo/test/run_tests.sh
      const siblingDirs = allTasks
        .filter(t => t !== task && t.absPath)
        .map(t => nodePath.dirname(t.absPath!));
      if (siblingDirs.length > 0) {
        const dirCounts = new Map<string, number>();
        siblingDirs.forEach(d => dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1));
        const contextDir = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        earlyEffectiveAbsPath = nodePath.join(contextDir, relNorm);
      }
      if (!earlyEffectiveAbsPath) {
        const folder = findWorkspaceFolderForRelativePath(relNorm);
        earlyEffectiveAbsPath = nodePath.join(
          (folder ?? { uri: workspaceRoot }).uri.fsPath,
          ...relNorm.split('/'),
        );
      }
    }
  }

  // ──── analyze / explain ────────────────────────────────────────
  // These run individually when called from runAgentLoop in mixed-action mode.
  // (All-analyze batches previously had a consolidated shortcut — G6 removed it
  //  so all analyze tasks now get the full multi-round tool loop.)
  if (task.action === 'analyze' || task.action === 'explain' || task.action === 'explore') {
    const analyzeWorkdir = earlyEffectiveAbsPath ? nodePath.dirname(earlyEffectiveAbsPath) : undefined;
    // G3: pass taskIndex/taskTotal/mcpTools so the prompt includes full tool definitions
    const analyzePrompt = buildAnalyzePrompt(userPrompt, task, currentContent, analyzeWorkdir, taskIndex, allTasks.length, callbacks.mcpToolRefs);
    let analyzeRaw = '';

    // G4+G5: unified multi-round tool loop for ALL analyze/explain/explore tasks.
    // Removed keyword-gated isExecTask branch — AI now autonomously decides when to use tools.
    // MAX_ANALYZE_ROUNDS=8 gives enough depth for investigative tasks without runaway loops.
    const MAX_ANALYZE_ROUNDS = 8;
    const execMessages: ChatMessage[] = [
      ...(history ?? []),
      { role: 'user', content: analyzePrompt },
    ];
    // G-analy-display: Route streaming text into the Working box analysis body (Copilot
    // inline style). Using \x00AFILE:basename\x00 prefix ensures content appears per-task
    // directly inside each Working box, regardless of whether the AI produces streaming
    // prose or puts all analysis in task_complete.summary.
    const AFX = '\x00AFILE:' + basename + '\x00';
    try {
      for (let r = 0; r < MAX_ANALYZE_ROUNDS; r++) {
        if (callbacks.signal?.aborted) break;
        execMessages.push(...consumeUserSteerMessages(callbacks));
        const { text, tools } = await chatWithMessages(
          execMessages, mode,
          (delta) => {
            if (delta.startsWith('\x00RESET\x00')) {
              // Preserve RESET semantic inside AFILE prefix so analysis body resets cleanly
              callbacks.onDelta(AFX + '\x00RESET\x00' + delta.slice(7));
            } else {
              analyzeRaw += delta;
              callbacks.onDelta(AFX + delta);
            }
          },
          callbacks.signal,
          consumeNewSession(),
        );
        execMessages.push({ role: 'assistant', content: text });
        // Pass analyzeWorkdir so run_terminal defaults to task directory when AI omits workdir.
        const loopRes = await executeFakeToolsForLoop(tools, callbacks, analyzeWorkdir, {
          currentTaskIndex: taskIndex,
          taskTotal: allTasks.length,
          deferDoneStatus: true,
          userPrompt,
          workspaceRoot: workspaceRoot.fsPath,
        });
        if (loopRes.taskComplete) { return { applied: false, raw: analyzeRaw, taskComplete: true }; }
        if (!loopRes.toolCallsMade) break;
        execMessages.push({
          role: 'user',
          content: `[工具执行结果]\n${loopRes.feedbackForAI}\n\n请继续。`,
        });
      }
    } catch (e) {
      const netErr = isNetworkError(e);
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'execute',
        taskId: task.id, taskFile: basename, taskAction: task.action,
        taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
        state: 'failed', title: task.desc || basename,
        detail: (e as Error).message,
      });
      return { applied: false, raw: analyzeRaw, networkError: netErr };
    }

    await callbacks.onAgentStatus({
      type: 'agentStatus', phase: 'execute',
      taskId: task.id, taskFile: basename, taskAction: task.action,
      taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
      state: 'completed', title: task.desc || basename,
    });
    return { applied: false, raw: analyzeRaw };
  }

  // ──── modify / create / delete ────────────────────────────────
  // P9: Early-fail when the task is 'modify' but the target file can't be read.
  // Proceeding without content forces the LLM to hallucinate the full file from
  // scratch, which almost always produces a garbled or wrong result.
  if (task.action === 'modify' && task.absPath && !currentContent) {
    await callbacks.onAgentStatus({
      type: 'agentStatus', phase: 'execute',
      taskId: task.id, taskFile: basename, taskAction: task.action,
      taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
      state: 'failed',
      title: `${basename} — 读取文件失败，跳过修改`,
      detail: `路径 ${task.absPath} 不存在或无法读取。请确认文件路径正确后重试。`,
    });
    return { applied: false };
  }

  // Build editor prompt with current file content injected.
  const editorWorkdir = earlyEffectiveAbsPath ? nodePath.dirname(earlyEffectiveAbsPath) : undefined;
  const editorPrompt = buildEditorPrompt(
    userPrompt, task, allTasks, currentContent, taskIndex, allTasks.length,
    callbacks.mcpToolRefs, analysisContext, editorWorkdir, workspaceRoot.fsPath,
  );

  // ── Multi-round mini-loop (Copilot/Cursor style) ──────────────
  // The AI can call tools (read_file, grep_search, list_dir, get_errors,
  // run_terminal) to explore the codebase, then output SEARCH/REPLACE edits.
  // Each tool call result is fed back as the next user message, allowing the
  // AI to reason with the data before deciding what to change.
  // Autopilot: 20 rounds/task (matches Copilot's higher per-task budget).
  const MAX_TASK_ROUNDS = callbacks.autopilot ? 20 : 5;
  const taskMessages: ChatMessage[] = [
    ...(history ?? []),
    { role: 'user', content: editorPrompt },
  ];
  let raw = '';
  // True when the AI called task_complete alongside file content in a create/modify task.
  // The break path falls through to write the file but must still propagate taskComplete.
  let taskCompleteByAI = false;

  for (let taskRound = 0; taskRound < MAX_TASK_ROUNDS; taskRound++) {
    if (callbacks.signal?.aborted) { return { applied: false, raw }; }
    try {
      taskMessages.push(...consumeUserSteerMessages(callbacks));
      const { text, tools } = await chatWithMessages(taskMessages, mode, undefined, callbacks.signal, consumeNewSession());
      taskMessages.push({ role: 'assistant', content: text });
      raw = text;

      const loopRes = await executeFakeToolsForLoop(tools, callbacks, editorWorkdir, {
        currentTaskIndex: taskIndex,
        taskTotal: allTasks.length,
        deferDoneStatus: true,
        userPrompt,
        workspaceRoot: workspaceRoot.fsPath,
      });
      if (loopRes.taskComplete) {
        // For create/modify tasks: if the AI emitted file content + task_complete
        // in the same response, fall through to the file-writing path instead of
        // returning early (otherwise the file never gets written to disk).
        if ((task.action === 'create' || task.action === 'modify') && raw) { taskCompleteByAI = true; break; }
        return { applied: false, raw, taskComplete: true };
      }

      // AI output SEARCH/REPLACE blocks → exit mini-loop and apply
      if (parseSearchReplaceBlocks(text).length > 0) { break; }

      // No data-fetching tool called → AI gave final answer (full-file or plain text)
      if (!loopRes.toolCallsMade) { break; }

      // Feed tool results back for the next AI round
      taskMessages.push({
        role: 'user',
        content: `[工具执行结果]
${loopRes.feedbackForAI}

请根据以上结果继续完成修改。`,
      });
    } catch (e) {
      const netErr = isNetworkError(e);
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'execute',
        taskId: task.id, taskFile: basename, taskAction: task.action,
        taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
        state: 'failed', title: task.desc || basename,
        detail: (e as Error).message,
      });
      return { applied: false, raw, networkError: netErr };
    }
  }

  // ── Try SEARCH/REPLACE blocks first ───────────────────────────
  const srBlocks = parseSearchReplaceBlocks(raw);
  if (srBlocks.length > 0 && currentContent && task.absPath) {
    const srResult = applySearchReplaceBlocks(currentContent, srBlocks);
    if (srResult.applied > 0 && srResult.failed === 0) {
      // P-SEC: check with extension before writing (sensitive file protection)
      if (callbacks.onBeforeFileWrite) {
        const allowed = await callbacks.onBeforeFileWrite(task.absPath);
        if (!allowed) {
          await callbacks.onAgentStatus({
            type: 'agentStatus',
            phase: 'execute',
            taskId: task.id, taskFile: basename, taskAction: task.action,
            taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
            state: 'failed',
            title: `跳过 ${basename}（用户拒绝写入敏感文件）`,
          });
          return { applied: false, raw, ...(taskCompleteByAI ? { taskComplete: true } : {}) };
        }
      }
      // Write through the workspace edit service so Agent write paths stay centralized.
      try {
        workspaceEditService.writeTextFileSync(task.absPath, srResult.result);
        // Update cache so subsequent tasks on the same file see this result
        contentCache.set(task.absPath, srResult.result);
        await callbacks.onAppliedChange({
          // Use absPath-relative path for display; fall back to task.file which was
          // already sanitized in parseTaskPlan.
          path: task.absPath
            ? nodePath.relative(workspaceRoot.fsPath, task.absPath).replace(/\\/g, '/')
            : task.file,
          existed: true,
          oldContent: currentContent,
          newContent: srResult.result,
        });
        const srDiff = roughLineDiff(currentContent, srResult.result);
        await callbacks.onAgentStatus({
          type: 'agentStatus',
          phase: 'execute',
          taskId: task.id, taskFile: basename, taskAction: task.action,
          taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
          state: 'completed',
          title: task.desc || basename,
          detail: `${basename} · ${srResult.applied} 处改动`,
          linesAdded: srDiff.added,
          linesRemoved: srDiff.removed,
        });
        return { applied: true, path: task.absPath, raw, ...(taskCompleteByAI ? { taskComplete: true } : {}) };
      } catch (writeErr) {
        // Fall through to full-file parser
      }
    } else if (srResult.failed > 0) {
      // SEARCH blocks didn't match — fall through to full-file parser with a log
      void srResult.errors; // consumed below in retry
    }
  }

  // ── Fall back to full-file parser ─────────────────────────────
  // For modify/create tasks where task.absPath is not yet known, resolve the correct
  // workspace folder before passing absFiles to workspace-applier. Without this, the
  // applier falls back to the first workspace folder which may be wrong in multi-root setups.
  let effectiveAbsPath = task.absPath;
  if (!effectiveAbsPath && task.file) {
    const relNorm = task.file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!nodePath.isAbsolute(relNorm)) {
      // Try to find an existing file across all workspace folders first
      for (const wf of (vscode.workspace.workspaceFolders ?? [])) {
        const candidate = nodePath.join(wf.uri.fsPath, ...relNorm.split('/'));
        if (fs.existsSync(candidate)) { effectiveAbsPath = candidate; break; }
      }
      // If still not found (e.g. create action), prefer the directory of sibling tasks
      // so the new file lands in the same project folder, not at the workspace root.
      // Apply to both bare filenames and paths with subdirectories.
      if (!effectiveAbsPath) {
        const siblingDirsEff = allTasks
          .filter(t => t !== task && t.absPath)
          .map(t => nodePath.dirname(t.absPath!));
        if (siblingDirsEff.length > 0) {
          const dirCountsEff = new Map<string, number>();
          siblingDirsEff.forEach(d => dirCountsEff.set(d, (dirCountsEff.get(d) ?? 0) + 1));
          const contextDirEff = [...dirCountsEff.entries()].sort((a, b) => b[1] - a[1])[0][0];
          effectiveAbsPath = nodePath.join(contextDirEff, relNorm);
        }
        if (!effectiveAbsPath) {
          const folder = findWorkspaceFolderForRelativePath(relNorm);
          effectiveAbsPath = nodePath.join(
            (folder ?? { uri: workspaceRoot }).uri.fsPath,
            ...relNorm.split('/'),
          );
        }
      }
    }
  }
  const absFiles = effectiveAbsPath ? [effectiveAbsPath] : [];
  let applyResult = await applyGeneratedArtifactsWithPrompt(
    raw,
    editorPrompt,
    async (status) => { await callbacks.onWorkflowStatus(status); },
    true,
    async (change) => { await callbacks.onAppliedChange(change); },
    absFiles,
  );

  // ── Retry once if nothing was applied ─────────────────────────
  if (!applyResult.applied || applyResult.changedPaths.length === 0) {
    const lang = fenceLangForFile(basename);
    const retryPrompt = [
      `你是编程智能体。任务：${task.desc}`,
      ``,
      `文件 ${basename} 当前内容：`,
      '```' + lang,
      currentContent || '（空文件）',
      '```',
      ``,
      `请输出修改后的完整文件内容，格式如下（不要省略任何行）：`,
      ``,
      `${basename}`,
      '```' + lang,
      `// 完整内容`,
      '```',
    ].join('\n');

    let retryRaw = '';
    try {
      const { text: rText, tools: rTools } = await chatViaProvider(retryPrompt, mode, undefined, history, callbacks.signal, false);
      retryRaw = rText;
      await executeFakeToolsForLoop(rTools, callbacks, editorWorkdir, {
        currentTaskIndex: taskIndex,
        taskTotal: allTasks.length,
        deferDoneStatus: true,
        userPrompt,
        workspaceRoot: workspaceRoot.fsPath,
      });
    } catch { /* retry failed, fall through */ }

    if (retryRaw) {
      applyResult = await applyGeneratedArtifactsWithPrompt(
        retryRaw,
        retryPrompt,
        async (status) => { await callbacks.onWorkflowStatus(status); },
        true,
        async (change) => { await callbacks.onAppliedChange(change); },
        absFiles,
      );
      if (applyResult.applied) raw = retryRaw;
    }
  }

  const applied = applyResult.applied && applyResult.changedPaths.length > 0;

  // Update cache if full-file write succeeded, so next task on same file chains correctly
  let fullFileDiff: { added: number; removed: number } | undefined;
  if (applied && task.absPath) {
    const freshContent = readFileContentFull(task.absPath);
    if (freshContent) {
      contentCache.set(task.absPath, freshContent);
      if (currentContent) fullFileDiff = roughLineDiff(currentContent, freshContent);
    }
  }

  // P18: full-file fallback path never sent a terminal task status.
  // SEARCH/REPLACE path returns early after sending its own 'completed'/'failed';
  // only this code path reaches here, so we emit terminal status unconditionally.
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    taskId: task.id, taskFile: basename, taskAction: task.action,
    taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
    state: applied ? 'completed' : 'failed',
    title: task.desc || (applied ? `${basename} — 已修改` : `${basename} — 未能应用`),
    ...(fullFileDiff ? { linesAdded: fullFileDiff.added, linesRemoved: fullFileDiff.removed } : {}),
  });

  return {
    applied,
    path: applied ? applyResult.changedPaths[0] : undefined,
    raw,
    linesAdded: fullFileDiff?.added,
    linesRemoved: fullFileDiff?.removed,
    ...(taskCompleteByAI ? { taskComplete: true } : {}),
  };
}

// ----------------------------------------------------------------
// Analysis findings extractor (P14 fix: Analyze → Plan fusion)
// ----------------------------------------------------------------

/**
 * Extract actionable bug/issue descriptions from a prior analysis response.
 * Looks for bullet-point lines that contain keywords indicating problems.
 * Returns an AnalysisFindings object suitable for injecting into decomposeTask().
 */
export function extractAnalysisFindings(analysisText: string): import('./agent-task-decomposer').AnalysisFindings {
  const ISSUE_KEYWORDS = /\b(笔误|错误|bug|问题|缺陷|越界|typo|wrong|issue|改进|建议|修复|不一致|漏掉|遗漏|溢出|补全|增加|考虑|优化|重构|改为|改用|避免|确认|验证)\b/i;
  const issues: string[] = [];

  for (const line of analysisText.split('\n')) {
    const trimmed = line.replace(/^[-*•\d.)\s]+/, '').trim();
    if (trimmed.length > 10 && trimmed.length < 200 && ISSUE_KEYWORDS.test(trimmed)) {
      issues.push(trimmed);
    }
  }

  // Deduplicate and limit
  const seen = new Set<string>();
  const unique = issues.filter(i => {
    if (seen.has(i)) return false;
    seen.add(i);
    return true;
  }).slice(0, 20);

  return { issues: unique };
}

// ----------------------------------------------------------------
// Compile validation helper
// ----------------------------------------------------------------

interface ValidationOutcome {
  ran: boolean;
  ok: boolean;
  command?: string;
  detail?: string;
  reason?: string;
}

function getAgentAutoFixRounds(): number {
  const configured = vscode.workspace.getConfiguration('devseek').get<number>('autoFixRounds', 6);
  return Math.max(0, Math.min(6, configured));
}

function selectValidationRepairTarget(validation: ValidationOutcome, modifiedPaths: string[]): string | undefined {
  const haystack = `${validation.command ?? ''}\n${validation.detail ?? ''}`;
  const mentioned = modifiedPaths.find((filePath) => haystack.includes(nodePath.basename(filePath)));
  return mentioned ?? modifiedPaths[0];
}

function buildValidationRepairContext(
  baseContext: string | undefined,
  validation: ValidationOutcome,
  repairRound: number,
  maxRepairRounds: number,
  modifiedPaths: string[],
): string {
  const validationContext = [
    '【自动验证失败，需要继续修复】',
    `修复轮次: ${repairRound}/${maxRepairRounds}`,
    `失败原因: ${validation.reason ?? 'validation-failed'}`,
    validation.command ? `失败命令: ${validation.command}` : '',
    '失败输出:',
    '```text',
    (validation.detail || '（无输出）').slice(0, 6000),
    '```',
    '',
    '请像 Claude Code/Codex 的闭环执行一样处理：先根据失败输出定位根因，再最小修改相关源码，修改后系统会自动重新编译/运行验证。',
    '不要只解释原因，不要把失败状态标记为完成。',
    modifiedPaths.length > 0
      ? `本轮已变更的可验证文件: ${modifiedPaths.map((p) => nodePath.basename(p)).join('、')}`
      : '',
  ].filter(Boolean).join('\n');
  return [baseContext, validationContext].filter(Boolean).join('\n\n');
}

function makeValidationRepairTask(
  absPath: string,
  workspaceRoot: vscode.Uri,
  validation: ValidationOutcome,
  repairRound: number,
): AgentTask {
  const rel = nodePath.relative(workspaceRoot.fsPath, absPath).replace(/\\/g, '/');
  return {
    id: `validation-repair-${repairRound}`,
    file: rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel) ? rel : nodePath.basename(absPath),
    absPath,
    action: 'modify',
    desc: `修复自动验证失败（${validation.reason ?? 'validation-failed'}）`,
  };
}

function buildTerminalFailureRepairFeedback(failure: TerminalEvidence, missing: string[]): string {
  return [
    '【系统反馈】刚才的终端验证没有通过，不能结束任务。',
    `缺少: ${missing.join('、')}`,
    `失败命令: ${failure.command}`,
    `exitCode: ${failure.exitCode ?? 'unknown'}`,
    failure.detail ? `诊断: ${failure.detail}` : '',
    '',
    '请继续执行真实修复流程：read_file / grep_search / get_errors 定位根因，使用 create_file / write_file 或 SEARCH/REPLACE 修改文件，然后重新 run_terminal 编译/运行/测试。',
  ].filter(Boolean).join('\n');
}

async function runValidation(
  changedPaths: string[],
  workspaceRoot: vscode.Uri,
  callbacks: AgentLoopCallbacks,
  /**
   * Whether to also run the program after successful compilation.
   * Derived from decomposed task actions (any analyze task with run_terminal in desc),
   * NOT from keyword-matching the raw user prompt.
   */
  wantRun = false,
  sessionHistory?: ChatMessage[],
): Promise<ValidationOutcome> {
  // Only C/C++ files need compile validation; Python, MD, etc. are skipped
  const compilable = changedPaths.filter(p => isCompilableFile(p));
  if (compilable.length === 0) return { ran: false, ok: true, reason: 'no-compilable-files' };

  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'validate',
    state: 'started',
    title: wantRun ? '正在编译并运行' : '正在执行编译验证',
    detail: `验证 ${compilable.length} 个 C/C++ 文件`,
  });

  // Always compile-only for validation first; if run requested we run separately
  const compilePlan = planLocalExecution('编译', compilable, workspaceRoot.fsPath) as LocalExecutionPlan | null;
  if (!compilePlan) {
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: 'skipped',
      title: '未找到构建命令，跳过编译验证',
      detail: '未识别到 CMakeLists.txt 或 C++ 源文件。',
    });
    return { ran: false, ok: false, reason: 'no-build-plan' };
  }

  const compileResult = await runLocalExecution(compilePlan);

  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'validate',
    state: compileResult.ok ? 'completed' : 'failed',
    title: compileResult.ok ? '编译验证通过 ✓' : '编译验证失败',
    detail: compileResult.ok
      ? `命令: ${compilePlan.command}  exitCode: 0`
      : compileResult.output.slice(0, 400),
  });
  if (!compileResult.ok) {
    return {
      ran: true,
      ok: false,
      command: compilePlan.command,
      detail: compileResult.output.slice(0, 1200),
      reason: 'compile-failed',
    };
  }

  // If compilation succeeded and user wants to run — execute in terminal
  if (wantRun && callbacks.onTerminalCommand) {
    // Build a run-only command from the compile plan's output binary.
    // Pass '运行' to planLocalExecution so it enables the run step (compile-run mode).
    const runPlan = planLocalExecution('运行', compilable, workspaceRoot.fsPath) as LocalExecutionPlan | null;
    const runCmd = runPlan?.mode === 'compile-run'
      ? runPlan.command       // planner already includes run step
      : compilePlan.command;  // fallback: reuse compile command
    try {
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'started',
        title: '正在执行程序',
        detail: `终端运行: ${runCmd}`,
      });
      const output = await callbacks.onTerminalCommand(runCmd, compilePlan.cwd);
      const evidence = analyzeTerminalEvidence(runCmd, output, compilePlan.cwd);
      // G-4: truncate and feed output back into sessionHistory so LLM sees actual results
      const truncated = output.length > 2000
        ? output.slice(0, 2000) + `\n[输出已截断，共 ${output.length} 字符]`
        : output;
      if (sessionHistory) {
        sessionHistory.push({
          role: 'assistant',
          content: `程序执行输出：\n\`\`\`\n${truncated}\n\`\`\``,
        });
      }
      if (!evidence.ran || !evidence.evidence.ok) {
        const detail = [
          evidence.evidence.detail,
          `exitCode=${evidence.evidence.exitCode ?? 'unknown'}`,
          truncated,
        ].filter(Boolean).join('\n');
        await callbacks.onAgentStatus({
          type: 'agentStatus',
          phase: 'validate',
          state: 'failed',
          title: '执行失败',
          detail: detail.slice(0, 1200),
        });
        return {
          ran: true,
          ok: false,
          command: runCmd,
          detail,
          reason: evidence.evidence.kind === 'compile-run' ? 'compile-run-failed' : 'run-failed',
        };
      }
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'completed',
        title: '执行完成 ✓',
        detail: truncated.slice(0, 400),
      });
    } catch (e) {
      const detail = (e as Error).message;
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'failed',
        title: '执行失败',
        detail,
      });
      return {
        ran: true,
        ok: false,
        command: runCmd,
        detail,
        reason: 'run-failed',
      };
    }
  }

  return {
    ran: true,
    ok: true,
    command: compilePlan.command,
    reason: wantRun ? 'compile-and-run-passed' : 'compile-passed',
  };
}

// ----------------------------------------------------------------
// Main entry: run the full Agent Loop
// ----------------------------------------------------------------

export async function runAgentLoop(
  tasks: AgentTask[],
  userPrompt: string,
  mode: 'fast' | 'r1' | undefined,
  workspaceRoot: vscode.Uri,
  callbacks: AgentLoopCallbacks,
  analysisContext?: string,
  startFromIndex = 0,
): Promise<AgentLoopResult> {
  const changedPaths: string[] = [];
  const editedFileRecords: Array<{ path: string; basename: string; linesAdded?: number; linesRemoved?: number; action: string }> = [];
  let tasksApplied = 0;
  let tasksFailed = 0;

  // Announce execution start
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    title: `开始执行 ${tasks.length} 个任务`,
    detail: tasks.map((t, i) => `${i + 1}. [${t.action}] ${nodePath.basename(t.file)} — ${t.desc}`).join('\n'),
    taskTotal: tasks.length,
  });

  // Copilot 规划阶段对齐：执行开始前先展示全部任务（全部 not-started）
  // Copilot 的 AI 在第一轮就调用 manage_todo_list 这样做；这里用框架自动初始化以确保可见性。
  if (callbacks.onTodoUpdate && tasks.length > 0 && startFromIndex === 0) {
    await callbacks.onTodoUpdate(tasks.map((t, j) => ({
      id: j + 1,
      title: t.desc,
      status: 'not-started' as const,
    })));
  }

  // ── Consolidated analysis shortcut ───────────────────────────────────────
  // G6: Removed the allReadOnly early-return shortcut that bypassed the tool loop.
  // All tasks — including pure analyze/explain batches — now go through executeTask
  // which runs a multi-round tool loop (G3+G4). This allows AI to actively grep,
  // read related files, and run commands instead of being limited to a single LLM call.
  const isReadOnlyAction = (a: AgentTaskAction) => a === 'analyze' || a === 'explain' || a === 'explore';

  // ── Execute every task individually ───────────────────────────────────────
  // contentCache: tracks the latest written content per absPath so that each
  // subsequent task on the same file sees the result of the previous task.
  // sessionHistory (L-1/L-4): accumulates task summaries so each LLM call
  // knows what was already done in this agent session (cross-round context).
  const contentCache = new Map<string, string>();
  const sessionHistory: ChatMessage[] = [];
  // Accumulate analysis text from read-only tasks to return as analysisText (for findings injection)
  const analysisTexts: string[] = [];
  // Internal execute tasks should NOT create new DeepSeek web conversations.
  // The user controls session switching via the '新对话' button.
  let needsNewSession = false;
  // Track whether the AI called task_complete (to suppress duplicate phase:done).
  let hadTaskComplete = false;

  for (let i = startFromIndex; i < tasks.length; i++) {
    const task = tasks[i];

    // Reset todo states to ground-truth at the start of each task so any premature
    // "all completed" marking by earlier AI calls doesn't mislead the UI.
    if (callbacks.onTodoUpdate && tasks.length > 1) {
      await callbacks.onTodoUpdate(tasks.map((t, j) => ({
        id: j + 1,
        title: t.desc,
        status: (j < i ? 'completed' : j === i ? 'in-progress' : 'not-started') as 'completed' | 'in-progress' | 'not-started',
      })));
    }

    sessionHistory.push(...consumeUserSteerMessages(callbacks));

    const result = await executeTask(
      task,
      i + 1,
      tasks,
      userPrompt,
      mode,
      workspaceRoot,
      callbacks,
      contentCache,
      sessionHistory.length > 0 ? [...sessionHistory] : undefined,
      analysisContext,
      needsNewSession,
    );
    needsNewSession = false; // Only first task starts a new session

    // ── Network-error detection: save checkpoint and abort loop ──────────
    // If the task failed due to a network error (fetch failed, ECONNREFUSED,
    // AbortError from upstream timeout, etc.) there is no point executing the
    // remaining tasks — they will all fail for the same reason.
    // Save a checkpoint so the user can resume from this task after reconnecting.
    if (result.networkError) {
      callbacks.onTaskCheckpoint?.(i, tasks.slice(i));
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'done', state: 'failed',
        title: `网络中断，已在第 ${i + 1}/${tasks.length} 个任务暂停`,
        detail: `已完成 ${tasksApplied} 个任务，剩余 ${tasks.length - i} 个等待续传。重连后可继续。`,
        taskTotal: tasks.length,
      });
      return { tasksTotal: tasks.length, tasksApplied, tasksFailed: tasksFailed + 1, changedPaths };
    }

    // L-4 / I-3: Append brief task result to session history.
    // G7: Cap based on total char count rather than entry count — avoids both under-
    // trimming (20 short entries) and over-trimming (20 long entries).
    const sessionChars = sessionHistory.reduce((s, m) => s + (m.content?.length ?? 0), 0);
    if (sessionChars > 40000 && sessionHistory.length >= 6) {
      // Preserve index 0-1 (initial-request anchor); drop oldest non-anchor pair.
      sessionHistory.splice(2, 2);
    }
    if (result.applied && result.path) {
      changedPaths.push(result.path);
      tasksApplied += 1;
      editedFileRecords.push({
        path: result.path,
        basename: nodePath.basename(result.path),
        linesAdded: result.linesAdded,
        linesRemoved: result.linesRemoved,
        action: task.action,
      });
      sessionHistory.push({
        role: 'assistant',
        content: `已完成任务 ${i + 1}/${tasks.length}：修改 ${nodePath.basename(result.path)}（${task.desc}）`,
      });
    } else if (isReadOnlyAction(task.action) && result.raw) {
      // Collect analysis text for findings injection into next round
      analysisTexts.push(`## ${nodePath.basename(task.file)}\n${result.raw}`);
      // Keep analysis context but limit its size to avoid token overflow
      sessionHistory.push({
        role: 'assistant',
        content: `已分析 ${nodePath.basename(task.file)}：${result.raw.slice(0, 1200)}${result.raw.length > 1200 ? '…' : ''}`,
      });
    } else if (!isReadOnlyAction(task.action)) {
      tasksFailed += 1;
      sessionHistory.push({
        role: 'assistant',
        content: `任务 ${i + 1}/${tasks.length} 失败：${nodePath.basename(task.file)}（${task.desc}）`,
      });
    }

    if (callbacks.onTodoUpdate && tasks.length > 0) {
      const currentCompleted = result.applied
        || result.taskComplete
        || (isReadOnlyAction(task.action) && !!result.raw);
      const currentFailed = !currentCompleted && !isReadOnlyAction(task.action);
      await callbacks.onTodoUpdate(tasks.map((t, j) => ({
        id: j + 1,
        title: t.desc,
        status: (j < i
          ? 'completed'
          : j === i
          ? (currentFailed ? 'failed' : currentCompleted ? 'completed' : 'in-progress')
          : 'not-started') as 'completed' | 'in-progress' | 'not-started' | 'failed',
      })));
    }

    // Only emit responseMeta for generation tasks (modify/create/delete).
    if (result.raw && !isReadOnlyAction(task.action)) {
      await callbacks.onResponseMeta(result.raw);
    }

    // Update checkpoint after each successful task so a future network error
    // only re-runs from the NEXT task, not from the beginning.
    callbacks.onTaskCheckpoint?.(i + 1, tasks.slice(i + 1));

    // task_complete from the AI means "I finished this task".
    // Record the task result first, then stop only when it was the final task.
    // Otherwise the final file edit can bypass editedFiles/validation summaries.
    if (result.taskComplete) {
      if (i === tasks.length - 1) {
        hadTaskComplete = true;
        break;
      }
      // Intermediate task: advance to the next task automatically.
    }
  }

  // All tasks completed — clear the checkpoint (null signals "done, nothing to resume").
  callbacks.onTaskCheckpoint?.(null, []);

  // Compile validation — C/C++ modify tasks only
  const modifiedPaths = tasks
    .filter(t => !isReadOnlyAction(t.action) && t.absPath && isCompilableFile(t.file))
    .map(t => t.absPath!);
  let validationOutcome: ValidationOutcome | undefined;
  if (modifiedPaths.length > 0) {
    // Derive wantRun from both the user's explicit request and task plan.
    // If the user asked to run/execute, validation must include runtime failures
    // such as exitCode=139/Segmentation fault instead of stopping at compile-only.
    const wantRun = tasks.some(
      t => t.action === 'analyze' && /run_terminal|运行程序|执行程序|compile.*run|build.*run/i.test(t.desc)
    ) || requiresRuntimeValidation(userPrompt);
    validationOutcome = await runValidation(modifiedPaths, workspaceRoot, callbacks, wantRun, sessionHistory);

    const maxRepairRounds = getAgentAutoFixRounds();
    for (let repairRound = 1;
      validationOutcome && !validationOutcome.ok && repairRound <= maxRepairRounds && !callbacks.signal?.aborted;
      repairRound += 1) {
      const repairTarget = selectValidationRepairTarget(validationOutcome, modifiedPaths);
      if (!repairTarget) break;

      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'repair',
        state: 'started',
        title: `第 ${repairRound} 轮自动修复验证失败`,
        detail: `命令: ${validationOutcome.command ?? 'unknown'}\n${(validationOutcome.detail ?? '').slice(0, 1200)}`,
        taskTotal: tasks.length,
      });

      if (callbacks.onTodoUpdate && tasks.length > 0) {
        await callbacks.onTodoUpdate([
          ...tasks.map((t, j) => ({
            id: j + 1,
            title: t.desc,
            status: 'completed' as const,
          })),
          {
            id: tasks.length + repairRound,
            title: `修复验证失败：${nodePath.basename(repairTarget)}`,
            status: 'in-progress' as const,
          },
        ]);
      }

      const repairTask = makeValidationRepairTask(repairTarget, workspaceRoot, validationOutcome, repairRound);
      const repairContext = buildValidationRepairContext(
        analysisContext,
        validationOutcome,
        repairRound,
        maxRepairRounds,
        modifiedPaths,
      );
      const repairResult = await executeTask(
        repairTask,
        1,
        [repairTask],
        userPrompt,
        mode,
        workspaceRoot,
        callbacks,
        contentCache,
        sessionHistory.length > 0 ? [...sessionHistory] : undefined,
        repairContext,
        false,
      );

      if (repairResult.networkError) {
        callbacks.onTaskCheckpoint?.(tasks.length, []);
        await callbacks.onAgentStatus({
          type: 'agentStatus',
          phase: 'done',
          state: 'failed',
          title: `网络中断，验证修复第 ${repairRound} 轮暂停`,
          detail: '修复任务已暂停，重连后可重新发起验证。',
          taskTotal: tasks.length,
        });
        return { tasksTotal: tasks.length, tasksApplied, tasksFailed: tasksFailed + 1, changedPaths };
      }

      if (repairResult.raw) {
        await callbacks.onResponseMeta(repairResult.raw);
      }

      if (repairResult.applied && repairResult.path) {
        if (!changedPaths.includes(repairResult.path)) changedPaths.push(repairResult.path);
        tasksApplied += 1;
        editedFileRecords.push({
          path: repairResult.path,
          basename: nodePath.basename(repairResult.path),
          linesAdded: repairResult.linesAdded,
          linesRemoved: repairResult.linesRemoved,
          action: 'modify',
        });
        sessionHistory.push({
          role: 'assistant',
          content: `第 ${repairRound} 轮自动修复已修改 ${nodePath.basename(repairResult.path)}，准备重新验证。`,
        });
      } else {
        tasksFailed += 1;
        sessionHistory.push({
          role: 'assistant',
          content: `第 ${repairRound} 轮自动修复未能应用到 ${nodePath.basename(repairTarget)}。`,
        });
        await callbacks.onAgentStatus({
          type: 'agentStatus',
          phase: 'repair',
          state: 'failed',
          title: '自动修复未产出可应用变更',
          detail: `目标文件: ${nodePath.basename(repairTarget)}`,
          taskTotal: tasks.length,
        });
        break;
      }

      validationOutcome = await runValidation(modifiedPaths, workspaceRoot, callbacks, wantRun, sessionHistory);
    }
  }
  const validationFailed = validationOutcome ? !validationOutcome.ok : false;
  if (validationFailed && callbacks.onTodoUpdate && tasks.length > 0) {
    const validationIndex = tasks.findIndex(
      t => /编译|构建|运行|测试|compile|build|run|test/i.test(t.desc || t.file),
    );
    const failedIndex = validationIndex >= 0 ? validationIndex : tasks.length - 1;
    await callbacks.onTodoUpdate(tasks.map((t, j) => ({
      id: j + 1,
      title: t.desc,
      status: (j === failedIndex ? 'failed' : j < tasks.length ? 'completed' : 'not-started') as 'completed' | 'in-progress' | 'not-started' | 'failed',
    })));
  }

  void hadTaskComplete;
  const finalFailed = tasksFailed + (validationFailed ? 1 : 0);
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: finalFailed === 0 ? 'completed' : 'failed',
    title: finalFailed === 0
      ? `全部 ${tasksApplied} 个修改任务已完成`
      : validationFailed
        ? `完成 ${tasksApplied}，验证失败`
        : `完成 ${tasksApplied}，失败 ${tasksFailed}`,
    detail: changedPaths.length > 0
      ? `已写入：${changedPaths.join('、')}${validationFailed ? `\n验证失败：${validationOutcome?.reason || 'validation-failed'}${validationOutcome?.detail ? `\n${validationOutcome.detail.slice(0, 400)}` : ''}` : ''}`
      : undefined,
    taskTotal: tasks.length,
    ...(editedFileRecords.length > 0 ? { editedFiles: editedFileRecords } : {}),
  });

  return {
    tasksTotal: tasks.length,
    tasksApplied,
    tasksFailed: finalFailed,
    changedPaths,
    // G6: return collected analysis text so extension.ts can use it for findings injection
    ...(analysisTexts.length > 0 ? { analysisText: analysisTexts.join('\n\n') } : {}),
  };
}

// ----------------------------------------------------------------
// Agentic free-explore loop (Claude Code style)
// Used when user has no code file attachments — skips Architect+Editor
// two-phase pipeline and lets the LLM drive exploration directly.
// ----------------------------------------------------------------

/** Normal mode ≈ Copilot's toolCallLimit ~25; autopilot mode ≈ Copilot's ~200. */
const AGENTIC_ROUNDS_NORMAL   = 25;
const AGENTIC_ROUNDS_AUTOPILOT = 200;

function buildAgenticSystemPrompt(
  workspaceRoot: string,
  dataFiles: string[],
  mcpTools?: McpToolRef[],
  projectRulesText?: string,
  projectMemoryText?: string,
  workflowMode: ExecutionMode = 'edit',
): string {
  const rulesSection = projectRulesText ? `\n${wrapRulesAsContext(projectRulesText)}\n` : '';
  const memSection  = projectMemoryText ? `\n${wrapMemoryAsContext(projectMemoryText)}\n` : '';
  const filesSection = dataFiles.length > 0
    ? `\n【已附加文件】\n${dataFiles.map(f => `- ${f}`).join('\n')}\n`
    : '';

  let mcpSection = '';
  if (mcpTools && mcpTools.length > 0) {
    const toolLines = mcpTools.map(ref => {
      const schema = JSON.stringify(ref.tool.inputSchema ?? {});
      return `  [TOOL:${ref.fakeName} ${schema}]  — ${ref.tool.description || ref.tool.name}`;
    }).join('\n');
    mcpSection = `\n【MCP 外部工具】\n${toolLines}\n`;
  }

  const workflowModeSection = workflowMode === 'inspect'
    ? `\n【当前工作流模式】inspect / 只读检查\n- 用户要求只读、检查、显示或分析时，禁止创建、修改、覆盖或删除文件。\n- 不要调用 create_file；不要用 run_terminal 的 python/echo/tee/cat 重定向写文件。\n- 检查文件是否存在时，可以使用 list_dir 或 test/ls/stat/file；显示文件内容时必须使用 read_file，或只读 run_terminal 的 cat/head/sed。\n- test/ls 只能证明路径存在，不能满足“显示文件内容”。\n- 只读任务的完成证据是读取/检查结果，不是文件修改结果。\n`
    : workflowMode === 'plan'
      ? `\n【当前工作流模式】plan / 只读计划\n- 只生成计划和分析，不写文件，不执行会修改工作区的命令。\n- 需要查看文件时使用 read_file/list_dir/grep_search 等只读工具。\n`
      : `\n【当前工作流模式】${workflowMode}\n- 可以在权限允许时修改工作区；所有写入必须走 create_file 或受控文件工具，并提供真实验证证据。\n`;

  return `你是一个拥有完整工具访问权限的编程智能体，运行在 VS Code 中。

【工作区根目录】${workspaceRoot}
${rulesSection}${memSection}${filesSection}${workflowModeSection}
【可用工具】

读取文件（代码文件、日志文件、配置文件，支持绝对路径）：
[TOOL:read_file {"path":"/absolute/path/to/file"}]

搜索文件内容（支持正则表达式，支持绝对路径）：
[TOOL:grep_search {"pattern":"关键词","path":"src/","isRegexp":true}]

按 glob 模式查找文件路径（不读取内容）：
[TOOL:file_search {"glob":"src/**/*.ts"}]

语义化搜索（按意图/概念，自动扩展为关键词搜索）：
[TOOL:semantic_search {"query":"用户登录验证处理函数"}]

列出目录内容：
[TOOL:list_dir {"path":"src/utils/"}]

执行 shell 命令（最强大：grep/awk/find/cat/head/wc/编译/运行等）：
[TOOL:run_terminal {"command":"grep -n 'error' /path/file.log | tail -30"}]

将重要发现写入项目记忆（由 DevSeek MemoryService 管理）：
[TOOL:memory_write {"content":"关键记录内容（100字以内）"}]

创建或完整覆写文件（提供绝对路径或相对 workspaceRoot 的路径）：
[TOOL:create_file {"path":"code/hello.cpp","content":"文件全部内容"}]

记录并追踪任务进度（第一轮先用此工具列出子任务；每步开始标 in-progress，完成标 completed）：
[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"任务描述","status":"in-progress"},{"id":2,"title":"另一任务","status":"not-started"}]}]

标记完成并给出结论（每次对话仅调用一次）：
[TOOL:task_complete {"summary":"结论摘要（包含证据：文件路径/行号/具体数值）"}]
${mcpSection}
【行为准则】
- 第一轮必须先输出 1-2 句面向用户的自然语言：说明你理解了什么、将如何处理；不要使用固定模板，不要只输出工具调用
- 开始前先用 manage_todo_list 列出所有子任务（Copilot 规划阶段）
- 每个子任务开始时标为 in-progress，完成时标为 completed
- memory_write / 项目记忆属于智能体内部能力，不要放进 manage_todo_list，也不要作为用户可见任务展示
- 创建/修改文件必须调用 create_file 工具并提供完整 content；“我正在创建/将创建/现在创建”这类自然语言不算执行；不要用 run_terminal 里的 python/echo/tee/cat 重定向写文件
- 用户指定“code 目录/code目录”时，必须把源码写到 ${workspaceRoot}/code/ 下；不要只描述创建，也不要把文件写到扩展目录或临时目录
- 你已经拥有 run_terminal/read_file/create_file 等工具；禁止声称“无法执行命令/无法访问文件/只是对话模式”。需要执行时必须调用 run_terminal，并以真实退出码和输出作为证据
- 只有实际写入目标文件后，才能把“创建/修改文件”类子任务标为 completed；只有代码/程序任务需要编译/运行/测试结果；文档/配置写入任务用文件存在和内容证据即可
- 先思考"需要哪些信息"，再决定调用哪些工具
- 一轮内可输出多个 [TOOL:...] 块（并行调用）
- 工具结果会在下一轮作为上下文提供给你
- 信息足够时，停止工具调用，直接给出结论
- 结论需包含：证据（文件路径/行号/具体数值）
- 使用简体中文`.trim();
}

/**
 * Agentic free-explore loop — Claude Code style single-phase ReAct cycle.
 *
 * Routing decision (extension.ts):
 *   - hasCodeFiles → run Architect+Editor two-phase pipeline (runAgentLoop)
 *   - !hasCodeFiles → run this function (free exploration / investigation)
 *
 * Key design differences vs runAgentLoop:
 *   - No Architect phase: LLM drives tool use directly
 *   - Tool results are fed back into messages history (NOT streamed to chat)
 *   - AI reasoning text (non-tool-call deltas) flows into Working box
 *   - Loop continues until AI calls task_complete or MAX_AGENTIC_ROUNDS
 */
export async function runAgenticLoop(
  userPrompt: string,
  dataFiles: string[],          // non-code files attached by user (.log/.csv/etc.)
  workspaceRoot: string,
  mode: 'fast' | 'r1' | undefined,
  callbacks: AgentLoopCallbacks,
  sessionContextText = '',
  workflowMode: ExecutionMode = 'edit',
): Promise<AgentLoopResult> {
  const rules  = getProjectRulesSync();
  const memory = getProjectMemorySync();

  const systemPrompt = buildAgenticSystemPrompt(
    workspaceRoot,
    dataFiles,
    callbacks.mcpToolRefs,
    rules ?? undefined,
    memory ?? undefined,
    workflowMode,
  );

  const promptIsReadOnly = isExplicitlyReadOnlyRequest(userPrompt);
  const promptRequiresTools =
    requiresReadEvidence(userPrompt)
    || requiresFileChangeEvidence(userPrompt)
    || requiresCommandEvidence(userPrompt)
    || (!promptIsReadOnly && /(?:创建|新建|修改|生成|修复|添加|删除|更新|改造|重构|看(?:一下)?(?:运行|执行)?结果|看到(?:运行|执行)?结果|输出效果|效果|create|write|modify|fix|implement)/i.test(userPrompt));
  const cppValidationPolicy = vscode.workspace
    .getConfiguration('devseek')
    .get<CppValidationPolicy>('cppValidationPolicy', 'conservative');
  const isWorkTool = (name: string) => !['manage_todo_list', 'task_complete', 'memory_write'].includes(name);

  const sessionContextSection = sessionContextText.trim()
    ? `\n\n【同一会话上下文】\n${sessionContextText.trim()}\n\n【当前用户消息】\n${userPrompt}`
    : `\n\n${userPrompt}`;

  // Full conversation history (Claude Code pattern: accumulate all rounds)
  const messages: ChatMessage[] = [
    { role: 'user', content: systemPrompt + sessionContextSection },
  ];

  let roundCount = 0;
  let totalChars = systemPrompt.length + sessionContextSection.length;
  let hadTaskComplete = false;
  let completeSummary = '';
  let failedReason = '';
  let noToolRounds = 0;
  let sawWorkTool = false;
  const allTerminalEvidence: TerminalEvidence[] = [];
  let currentTodos: TodoItem[] = [];
  let lastMissingEvidence: string[] = [];
  const announcedProseKeys = new Set<string>();
  const allReadEvidencePaths = new Set<string>();
  // Whether the AI has called manage_todo_list yet.
  let todoEverSet = false;
  let fallbackTodosVisible = false;
  // Accumulate files written across all rounds for the phase:done editedFiles payload.
  const allWrittenFiles: Array<{path: string; basename: string; linesAdded: number; linesRemoved: number; action: string}> = [];
  let autoValidatedWriteCount = 0;

  // Announce Working box to webview — neutral action (not 'analyze') so the
  // container doesn't get data-analyze and won't auto-collapse, regardless of
  // whether the agent ends up analyzing or creating files.
  const _shortPrompt = userPrompt.trim().replace(/\n+/g, ' ');
  const _agentLabel = _shortPrompt.length > 38 ? _shortPrompt.slice(0, 36) + '…' : _shortPrompt;
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    taskId: 'agentic',
    taskFile: '',
    taskAction: 'explore',  // triggers "Exploring " prefix in webview for clear intent
    taskIndex: 1,
    taskTotal: 1,
    state: 'started',
    title: _agentLabel,
    detail: '',
  });

  // Infer fallback todos for internal evidence tracking. Do not show them before
  // work begins; if DeepSeek starts real tools without calling manage_todo_list,
  // the first work-tool round below reveals these fallback todos at the point
  // where a task list is actually needed.
  if (promptRequiresTools) {
    const initialTodos = inferInitialAgenticTodos(userPrompt);
    if (initialTodos.length > 0) {
      currentTodos = initialTodos;
    }
  }

  const maxAgenticRounds = callbacks.autopilot ? AGENTIC_ROUNDS_AUTOPILOT : AGENTIC_ROUNDS_NORMAL;
  // Track terminal command signatures across rounds to detect and break stuck loops
  const seenTerminalCmdSignatures = new Map<string, { count: number; lastProgressEpoch: number }>();
  let progressEpoch = 0;
  while (roundCount < maxAgenticRounds) {
    if (callbacks.signal?.aborted) break;
    roundCount++;

    // Context window management: keep first message (system+prompt) + recent 6
    if (totalChars > 80000 && messages.length > 8) {
      const head = messages.slice(0, 1);
      const tail = messages.slice(-6);
      messages.splice(0, messages.length, ...head, ...tail);
    }

    // ── Streaming delta: early manage_todo_list detection ───────────────────
    // As DeepSeek streams its response, detect the first completed manage_todo_list
    // block and fire onTodoUpdate immediately so todos appear in real-time rather
    // than waiting for the full response. Threshold-based to avoid calling
    // parseFakeToolCalls on every single character delta.
    let sAccum = '';
    let sNextCheck = 80;
    let sEarlyFired = false;
    let sNextSpinnerUpdate = 200; // update spinner label every ~200 chars to show progress
    let sLastEarlyToolCheck = 0;
    const sEarlyToolsEmitted = new Set<string>();
    const roundStreamDelta = (delta: string) => {
      // Bridge may send \x00RESET\x00 + fullText to replace accumulated content.
      // Reset sAccum to the new full text instead of appending the corrupt prefix.
      if (delta.startsWith('\x00RESET\x00')) {
        sAccum = delta.slice(7);
        if (!sEarlyFired) sNextCheck = Math.min(sNextCheck, sAccum.length + 1);
      } else {
        sAccum += delta;
      }
      // Show thinking progress in Working box spinner label so user sees DeepSeek is active.
      // This prevents the "no activity" perception while waiting for the full response.
      if (callbacks.onToolActivity && sAccum.length >= sNextSpinnerUpdate) {
        sNextSpinnerUpdate = sAccum.length + 300;
        callbacks.onToolActivity('label', `思考中 (${sAccum.length} 字符)…`);
      }
      if (!sEarlyFired && callbacks.onTodoUpdate && sAccum.length >= sNextCheck) {
        sNextCheck = sAccum.length + 150; // check again in 150 chars
        const earlyTools = parseFakeToolCalls(sAccum);
        const firstTodo = earlyTools.find(t => t.name === 'manage_todo_list');
        if (firstTodo) {
          const earlyItems = normalizeVisibleTodos((firstTodo.input.todoList ?? []) as TodoItem[]);
          if (Array.isArray(earlyItems) && earlyItems.length > 0) {
            if (earlyItems.every(item => item.status === 'completed')) return;
            sEarlyFired = true; // stop checking — already fired
            todoEverSet = true;
            currentTodos = earlyItems;
            void callbacks.onTodoUpdate(earlyItems);
          }
        }
      }
      // Early tool activity: emit activity rows as soon as complete tool blocks are detected
      // in the streaming accumulation — before tools are actually executed.
      // The webview deduplicates by actKind:label, so re-emitting at execution time is safe.
      if (callbacks.onToolActivity && sAccum.length > sLastEarlyToolCheck + 100 && sAccum.includes('[TOOL:')) {
        sLastEarlyToolCheck = sAccum.length;
        const earlyTools = parseFakeToolCalls(sAccum);
        for (const t of earlyTools) {
          if (t.name === 'manage_todo_list') continue; // handled by the todo-detection block above
          const actKey = t.name + ':' + JSON.stringify(t.input ?? {}).slice(0, 50);
          if (!sEarlyToolsEmitted.has(actKey)) {
            sEarlyToolsEmitted.add(actKey);
            const earlyAct = describeAgentToolActivity(t);
            if (earlyAct) {
              callbacks.onToolActivity(earlyAct.kind as Parameters<typeof callbacks.onToolActivity>[0], earlyAct.label);
            }
          }
        }
      }
    };

    // Copilot/Claude Code ReAct pattern:
    // - Intermediate rounds (AI calls tools): suppress LLM prose — tool activity
    //   chips in the Working box are enough. Prose reasoning is internal scaffolding.
    // - Final round (no tools called): route AI answer to prose bubble via ASUM.
    // This avoids showing the same content in both working box AND bubble.
    messages.push(...consumeUserSteerMessages(callbacks));
    const { text, tools } = await chatWithMessages(
      messages,
      mode,
      roundStreamDelta,  // stream delta for early todo detection
      callbacks.signal,
      roundCount === 1,
    );

    messages.push({ role: 'assistant', content: text });
    totalChars += text.length;

    const firstToolIndex = findFirstToolCallStart(text);
    const preToolProse = firstToolIndex >= 0 ? stripToolCallBlocks(text.slice(0, firstToolIndex)).trim() : '';
    const userAnnouncement = normalizeAgentUserAnnouncement(preToolProse);
    const userAnnouncementKey = agentAnnouncementKey(userAnnouncement);

    if (userAnnouncement && userAnnouncementKey && !announcedProseKeys.has(userAnnouncementKey)) {
      announcedProseKeys.add(userAnnouncementKey);
      // Route AI's pre-tool intent to the Working box label (Copilot style: no chat bubble).
      // The first sentence of the reasoning becomes "Working: <intent>" in the header.
      const firstSentence = userAnnouncement.split(/[。！\n]/)[0].slice(0, 60).trim();
      if (firstSentence && callbacks.onToolActivity) {
        callbacks.onToolActivity?.('label', firstSentence);
      }
      // Do NOT call onAgentAnnouncement — no chat bubble for pre-tool rounds.
    }

    if (!tools.length) {
      const artifactApply = promptRequiresTools
        ? await applyMarkdownFileArtifactsForLoop(text, userPrompt, workspaceRoot, callbacks, {
          requireReadBeforeOverwrite: true,
          readEvidencePaths: allReadEvidencePaths,
        })
        : { feedbackForAI: '', writtenFiles: [] as WrittenFileEvidence[] };
      if (artifactApply.writtenFiles.length > 0) {
        sawWorkTool = true;
        noToolRounds = 0;
        allWrittenFiles.push(...artifactApply.writtenFiles);
        progressEpoch++;
        const autoValidation = await runAgentAutoValidationForWrites(
          allWrittenFiles.slice(autoValidatedWriteCount),
          workspaceRoot,
          userPrompt,
          callbacks,
          cppValidationPolicy,
        );
        autoValidatedWriteCount = allWrittenFiles.length;
        if (autoValidation.evidence) allTerminalEvidence.push(autoValidation.evidence);
        if (autoValidation.repairBlockedReason) {
          if (callbacks.onTodoUpdate && currentTodos.length > 0) {
            currentTodos = markValidationFailureTodos(currentTodos);
            await callbacks.onTodoUpdate(currentTodos);
          }
          failedReason = autoValidation.repairBlockedReason;
          break;
        }
        const validationFeedback = autoValidation.feedbackForAI ? `\n\n${autoValidation.feedbackForAI}` : '';
        const missingAfterArtifact = getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence, [...allReadEvidencePaths]);
        const continueMessage = missingAfterArtifact.length > 0
          ? `【系统反馈】已从你输出的文件代码块落地文件，但仍缺少${missingAfterArtifact.join('、')}。请继续调用实际工具修复或补充验证，完成后再 task_complete。\n${artifactApply.feedbackForAI}${validationFeedback}`
          : `【系统反馈】已从你输出的文件代码块落地文件。请根据工具结果更新 todo，并在必要时调用 task_complete。\n${artifactApply.feedbackForAI}${validationFeedback}`;
        messages.push({ role: 'user', content: continueMessage });
        totalChars += continueMessage.length;
        continue;
      }
      const fallbackTodos = normalizeVisibleTodos(extractPlanningTodoItems(text));
      if (fallbackTodos.length > 0) {
        todoEverSet = true;
        currentTodos = fallbackTodos;
        if (callbacks.onTodoUpdate) {
          await callbacks.onTodoUpdate(fallbackTodos);
        }
        const continueMessage = '【系统反馈】任务清单已收到，请立即开始执行第一个任务，不要只停留在规划。';
        messages.push({
          role: 'user',
          content: continueMessage,
        });
        totalChars += continueMessage.length;
        continue;
      }
      const stripped = stripToolCallBlocks(text).trim();
      if (!callbacks.signal?.aborted && promptRequiresTools && !sawWorkTool && noToolRounds < 2) {
        noToolRounds++;
        const userAnnouncement = normalizeAgentUserAnnouncement(stripped);
        const userAnnouncementKey = agentAnnouncementKey(userAnnouncement);
        if (userAnnouncement && userAnnouncementKey && !announcedProseKeys.has(userAnnouncementKey)) {
          announcedProseKeys.add(userAnnouncementKey);
          // No-tool round: route to Working box label (not a bubble) — AI said something but used no tools.
          // This keeps the chat clean; user sees the intent in the Working box header.
          const firstSentence = userAnnouncement.split(/[。！\n]/)[0].slice(0, 60).trim();
          if (firstSentence && callbacks.onToolActivity) {
            callbacks.onToolActivity('label', firstSentence);
          }
        }
        const retryMessage = '【系统反馈】本轮没有检测到任何工具调用，不能把需要创建/修改/运行的任务标记为完成。请继续执行：先更新 manage_todo_list，然后调用 read_file/list_dir/create_file/run_terminal 等实际工具；完成前必须提供可验证的文件或命令结果。';
        messages.push({ role: 'user', content: retryMessage });
        totalChars += retryMessage.length;
        continue;
      }
      const missingWithoutTools = promptRequiresTools
        ? getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence, [...allReadEvidencePaths])
        : [];
      if (!callbacks.signal?.aborted && missingWithoutTools.length > 0 && noToolRounds < 4) {
        noToolRounds++;
        const retryMessage = `【系统反馈】不能停在检查目录或说明阶段。当前缺少${missingWithoutTools.join('、')}。${buildMissingEvidenceRecoveryInstruction(missingWithoutTools)}不要把 memory_write/项目记忆列为用户 todo。`;
        messages.push({ role: 'user', content: retryMessage });
        totalChars += retryMessage.length;
        continue;
      }
      if (promptRequiresTools && !sawWorkTool) {
        failedReason = stripped || '模型没有执行任何工具调用，任务未实际完成。';
      }
      // Final answer — no more tool calls. Route prose to bubble via ASUM.
      if (!hadTaskComplete && !completeSummary) {
        const visibleStripped = cleanAgentFinalSummaryForUser(stripped);
        if (visibleStripped) completeSummary = visibleStripped;
      }
      break;
    }

    const roundHasWorkTools = tools.some(t => isWorkTool(t.name));
    if (roundHasWorkTools) {
      sawWorkTool = true;
      noToolRounds = 0;
    }

    // Track whether the AI proactively supplied a usable todo list. Merely
    // mentioning manage_todo_list is not enough; malformed/empty payloads should
    // not suppress the fallback todos when real work starts.
    const roundHasVisibleTodoUpdate = tools.some(t =>
      t.name === 'manage_todo_list'
      && normalizeVisibleTodos((t.input.todoList ?? []) as TodoItem[]).length > 0
    );
    if (roundHasVisibleTodoUpdate) todoEverSet = true;
    if (roundHasWorkTools && !todoEverSet && !fallbackTodosVisible && currentTodos.length > 0 && callbacks.onTodoUpdate) {
      await callbacks.onTodoUpdate(currentTodos);
      fallbackTodosVisible = true;
    }

    const missingBeforeTools = promptRequiresTools
      ? getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence, [...allReadEvidencePaths])
      : [];

    const hasExplicitFileWriteTool = tools.some(t => t.name === 'create_file' || t.name === 'write_file');
    const artifactApply = !hasExplicitFileWriteTool
      ? await applyMarkdownFileArtifactsForLoop(text, userPrompt, workspaceRoot, callbacks, {
        requireReadBeforeOverwrite: true,
        readEvidencePaths: allReadEvidencePaths,
      })
      : { feedbackForAI: '', writtenFiles: [] as WrittenFileEvidence[] };
    if (artifactApply.writtenFiles.length > 0) {
      allWrittenFiles.push(...artifactApply.writtenFiles);
      progressEpoch++;
    }

    const blockedRepeatedTerminalToolIndexes = new Set<number>();
    const loopWarnings: string[] = [];
    const hasFileWriteIntentThisRound = hasExplicitFileWriteTool || artifactApply.writtenFiles.length > 0;
    tools.forEach((tool, toolIndex) => {
      if (tool.name !== 'run_terminal') return;
      const command = typeof tool.input.command === 'string' ? tool.input.command.trim() : '';
      if (!command) return;
      const sig = makeTerminalCmdSignature(command);
      const seen = seenTerminalCmdSignatures.get(sig);
      if (seen && seen.lastProgressEpoch === progressEpoch && !hasFileWriteIntentThisRound) {
        blockedRepeatedTerminalToolIndexes.add(toolIndex);
        loopWarnings.push(getTerminalRecoveryProtocol(command, seen.count + 1));
        callbacks.onToolActivity?.('terminal', `跳过重复命令: ${sig.slice(0, 50)}`);
      }
    });
    const toolsToExecute = blockedRepeatedTerminalToolIndexes.size > 0
      ? tools.filter((_, toolIndex) => !blockedRepeatedTerminalToolIndexes.has(toolIndex))
      : tools;

    // Execute tools — full callbacks so file creation/edits register as pending edits
    const loopRes = await executeFakeToolsForLoop(
      toolsToExecute,
      callbacks,
      workspaceRoot,
      {
        currentTaskIndex: Number.MAX_SAFE_INTEGER,
        taskTotal: 1,
        deferDoneStatus: true,
        requireWorkBeforeComplete: missingBeforeTools.length > 0,
        userPrompt,
        workspaceRoot,
        requireReadBeforeOverwrite: true,
        readEvidencePaths: [...allReadEvidencePaths],
      },
    );

    if (loopRes.todoItems?.length) {
      currentTodos = loopRes.todoItems;
    }
    if (loopRes.writtenFiles?.length) {
      allWrittenFiles.push(...loopRes.writtenFiles);
      progressEpoch++;
    }
    if (loopRes.readFiles?.length) {
      for (const readPath of loopRes.readFiles) allReadEvidencePaths.add(readPath);
    }
    if (loopRes.terminalEvidence?.length) {
      allTerminalEvidence.push(...loopRes.terminalEvidence);
    }
    const autoValidation = await runAgentAutoValidationForWrites(
      allWrittenFiles.slice(autoValidatedWriteCount),
      workspaceRoot,
      userPrompt,
      callbacks,
      cppValidationPolicy,
    );
    autoValidatedWriteCount = allWrittenFiles.length;
    if (autoValidation.evidence) {
      allTerminalEvidence.push(autoValidation.evidence);
    }
    if (autoValidation.repairBlockedReason) {
      if (callbacks.onTodoUpdate && currentTodos.length > 0) {
        currentTodos = markValidationFailureTodos(currentTodos);
        await callbacks.onTodoUpdate(currentTodos);
      }
      failedReason = autoValidation.repairBlockedReason;
      break;
    }
    const autoValidationFeedback = autoValidation.feedbackForAI ?? '';

    // Loop detection: track terminal command signatures across rounds.
    // If the same command is executed 2+ times without making progress, inject
    // a targeted override so the AI is forced to change strategy.
    for (const cmd of loopRes.terminalCommands ?? []) {
      const sig = makeTerminalCmdSignature(cmd);
      const prev = seenTerminalCmdSignatures.get(sig);
      const nextCount = (prev?.count ?? 0) + 1;
      seenTerminalCmdSignatures.set(sig, { count: nextCount, lastProgressEpoch: progressEpoch });
      if (prev && prev.lastProgressEpoch === progressEpoch && nextCount >= 2) {
        loopWarnings.push(getTerminalRecoveryProtocol(cmd, nextCount));
      }
    }
    // Clear any ASUM delta that task_complete may have emitted during this round.
    // Each round's summary is intermediate — only the definitive post-loop ASUM
    // should appear in the prose bubble (Copilot/Claude Code pattern).
    if (roundHasWorkTools) {
      callbacks.onDelta('\x00PROSE_CLEAR\x00');
    }

    const missingAfterTools = promptRequiresTools
      ? getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence, [...allReadEvidencePaths])
      : [];
    lastMissingEvidence = missingAfterTools;

    if (!callbacks.signal?.aborted && promptRequiresTools && sawWorkTool && missingAfterTools.length === 0) {
      if (loopRes.completeSummary !== undefined) {
        completeSummary = loopRes.completeSummary ?? '';
      }
      break;
    }

    if ((loopRes.taskComplete || loopRes.allTodosCompleted) && missingAfterTools.length > 0 && !callbacks.signal?.aborted) {
      noToolRounds++;
      if (callbacks.onTodoUpdate && currentTodos.length > 0) {
        currentTodos = markMissingEvidenceTodosIncomplete(currentTodos, missingAfterTools);
        await callbacks.onTodoUpdate(currentTodos);
      }
      const retryMessage = `【系统反馈】不能结束任务。当前仍缺少可验证的${missingAfterTools.join('、')}。请继续调用实际工具完成缺失项：需要读取时用 read_file/list_dir/只读 run_terminal；需要代码时用 create_file/write_file 写入源码；需要验证时用合适的验证命令，文档/配置只需文件存在和内容证据，代码才需要编译/运行/测试。完成后再调用 task_complete，summary 必须只基于真实工具结果。${autoValidationFeedback ? `\n\n${autoValidationFeedback}` : ''}`;
      messages.push({ role: 'user', content: retryMessage });
      totalChars += retryMessage.length;
      continue;
    }

    if (loopRes.taskComplete) {
      if (promptRequiresTools && !sawWorkTool && noToolRounds < 2 && !callbacks.signal?.aborted) {
        noToolRounds++;
        const retryMessage = '【系统反馈】你调用了 task_complete，但还没有执行任何实际工具。请继续完成任务：更新 todo 状态，并调用必要的文件/终端工具后再完成。';
        messages.push({ role: 'user', content: retryMessage });
        totalChars += retryMessage.length;
        continue;
      }
      if (promptRequiresTools && !sawWorkTool) {
        failedReason = cleanAgentFinalSummaryForUser(loopRes.completeSummary || '') || '模型未执行任何实际工具就结束，任务未完成。';
      }
      hadTaskComplete = true;
      completeSummary = loopRes.completeSummary ?? '';
      break;
    }

    // ── Implicit completion: AI marked all todos as completed ────────────────
    // Common in DeepSeek web mode where the AI delivers the full workflow
    // (plan + execute + verify) in a single response without calling task_complete.
    // Treat all-todos-completed as an equivalent signal to avoid a redundant
    // round-2 request that often causes DeepSeek to repeat all tools again.
    if (loopRes.allTodosCompleted && (!promptRequiresTools || sawWorkTool)) {
      break;
    }
    if (loopRes.allTodosCompleted && promptRequiresTools && !sawWorkTool && noToolRounds < 2 && !callbacks.signal?.aborted) {
      noToolRounds++;
      const retryMessage = '【系统反馈】todo 被标记为完成，但还没有任何实际文件/命令工具执行记录。请继续执行真实工作，不要只更新 todo。';
      messages.push({ role: 'user', content: retryMessage });
      totalChars += retryMessage.length;
      continue;
    }

    if (!loopRes.toolCallsMade && loopWarnings.length === 0) {
      const missingNow = promptRequiresTools
        ? getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence, [...allReadEvidencePaths])
        : [];
      const lastFailedTerminal = [...allTerminalEvidence]
        .reverse()
        .find(e => !e.ok && e.kind !== 'other');
      if (lastFailedTerminal && missingNow.length > 0 && noToolRounds < 2 && !callbacks.signal?.aborted) {
        noToolRounds++;
        const retryMessage = buildTerminalFailureRepairFeedback(lastFailedTerminal, missingNow);
        messages.push({ role: 'user', content: retryMessage });
        totalChars += retryMessage.length;
        continue;
      }
      break;
    }

    // Inject tool results into next round
    const combinedFeedback = [artifactApply.feedbackForAI, loopRes.feedbackForAI, autoValidationFeedback, ...loopWarnings].filter(Boolean).join('\n\n');
    const feedback = `[工具结果 Round ${roundCount}]\n${combinedFeedback}`;
    messages.push({ role: 'user', content: feedback });
    totalChars += feedback.length;
  }

  const finalMissingEvidence = promptRequiresTools
    ? getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence, [...allReadEvidencePaths])
    : [];
  if (!failedReason && finalMissingEvidence.length > 0) {
    failedReason = `实际执行证据不足：缺少${finalMissingEvidence.join('、')}。`;
    if (callbacks.onTodoUpdate && currentTodos.length > 0) {
      currentTodos = markMissingEvidenceTodosIncomplete(currentTodos, finalMissingEvidence);
      await callbacks.onTodoUpdate(currentTodos);
    }
  } else if (!failedReason && lastMissingEvidence.length > 0) {
    failedReason = `实际执行证据不足：缺少${lastMissingEvidence.join('、')}。`;
  }
  if (!failedReason && !callbacks.signal?.aborted && callbacks.onTodoUpdate && currentTodos.length > 0) {
    currentTodos = currentTodos.map(item => ({ ...item, status: 'completed' as const }));
    await callbacks.onTodoUpdate(currentTodos);
  }

  // Emit done phase from runAgenticLoop itself so editedFiles includes files
  // accumulated across all rounds and task_complete cannot race endResponse.
  // Use 'failed' state when aborted cleanly (signal fired between iterations rather than
  // during an LLM call) so the Working box shows ✗ instead of misleading green ✓.
  const cleanAbort = callbacks.signal?.aborted ?? false;
  const visibleCompleteSummary = cleanAgentFinalSummaryForUser(completeSummary);
  const finalWrittenFiles = coalesceWrittenFileEvidence(allWrittenFiles, workspaceRoot);
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: cleanAbort || failedReason ? 'failed' : 'completed',
    title: cleanAbort ? `已中断（${roundCount} 轮）` : (failedReason || visibleCompleteSummary || `完成（${roundCount} 轮）`),
    taskTotal: 1,
    ...(finalWrittenFiles.length > 0 ? { editedFiles: finalWrittenFiles } : {}),
  });

  // Route final answer to prose bubble.
  // Always emit — PROSE_CLEAR may have cleared any intermediate task_complete summary
  // so we must always send the definitive post-loop ASUM. If no summary exists,
  // emit a minimal completion notice so the user sees the agent finished.
  {
    const fileSummary = finalWrittenFiles.length > 0
      ? `已完成，修改 ${finalWrittenFiles.length} 个文件：${finalWrittenFiles.map(f => `${f.basename} (+${f.linesAdded} -${f.linesRemoved})`).join('、')}。`
      : '';
    const finalMsg = failedReason
      ? `任务没有完成：${failedReason}`
      : (visibleCompleteSummary || fileSummary || '任务已完成。');
    callbacks.onDelta('\x00ASUM\x00' + finalMsg);
  }

  callbacks.onTaskCheckpoint?.(null, []);

  const historyText = buildAgenticHistoryText({
    userPrompt,
    roundCount,
    completed: !(cleanAbort || failedReason),
    failedReason: cleanAbort ? '用户中断。' : failedReason,
    summary: visibleCompleteSummary,
    todos: currentTodos,
    writtenFiles: finalWrittenFiles,
    terminalEvidence: allTerminalEvidence,
    qualityGate: buildAgenticQualityGateForHistory({
      failedReason: cleanAbort ? '用户中断。' : failedReason,
      writtenFiles: finalWrittenFiles,
      terminalEvidence: allTerminalEvidence,
    }),
    workspaceRoot,
  });

  return {
    tasksTotal: 1,
    tasksApplied: finalWrittenFiles.length > 0 ? 1 : 0,
    tasksFailed: cleanAbort || failedReason ? 1 : 0,
    changedPaths: [...new Set(finalWrittenFiles.map(f => f.path))],
    historyText,
  };
}
