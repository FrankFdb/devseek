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
import { ChatMessage } from './llm/types';
import { AgentTask, getAgentTaskDisplayTarget, readFileContentSafe, readFileContentFull } from './agent-task-decomposer';
import { fenceLangForFile, roughLineDiff } from './utils';
import { findWorkspaceFolderForRelativePath } from './workspace-roots';
import { applyGeneratedArtifactPathWithPrompt } from './workspace-applier';
import { runLocalExecution, LocalExecutionPlan, planLocalExecution } from './execution-planner';
import { McpToolRef } from './mcp/client';
import { getProjectRulesSync, wrapRulesAsContext, getProjectMemorySync, wrapMemoryAsContext } from './project-rules';
import { getCommandHints } from './agent-learner';
import {
  findFirstToolCallStart,
} from './agent/fake-tool-parser';
import { chatViaProvider, chatWithMessages, consumeUserSteerMessages } from './agent/loop-chat';
import {
  buildAgenticHistoryText,
  buildAgenticQualityGateForHistory,
  type AgenticHistoryTodoStatus,
} from './agent/agentic-history';
import {
  classifyTerminalEvidenceCommand,
  buildTerminalFailureRepairFeedback,
  findBlockingTerminalFailureEvidence,
  requiresRuntimeValidation,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './agent/completion-evidence';
import { tryExecuteDeterministicCreateTask } from './agent/deterministic-task-executor';
import {
  buildTaskTerminalFailureDetail,
  withTaskTerminalEvidence,
  type TaskExecutionResult,
} from './agent/task-execution-result';
import type { AgentLoopCallbacks, AgentLoopResult } from './agent/loop-types';
import {
  analyzeTerminalEvidence,
  executeFakeToolsForLoop,
} from './agent/tool-loop';
import { selectTaskWriteEvidence } from './agent/task-write-evidence';
import {
  buildTaskSettlementFailureStatus,
  createAgentTaskTodoLedger,
  isReadOnlyAgentTaskAction,
} from './agent/task-todo-ledger';
import { tryRunSimpleFileTask } from './agent/simple-file-task';
import { WorkspaceEditService } from './workspace/edit-service';
import type { CppValidationPolicy } from './validation-planner';
import type { ExecutionMode } from './intent/intent-types';

// ----------------------------------------------------------------
// Reporter types (passed in from extension.ts)
// ----------------------------------------------------------------

// ── L-2/L-3: AI 可调用工具类型 ──────────────────────────────────────────────────

const workspaceEditService = new WorkspaceEditService();

function buildLocalRespondTaskMessage(task: AgentTask, userPrompt: string): string {
  if (task.targetKind === 'provider-response') {
    return [
      '已安全阻断上一次损坏响应。',
      '',
      '该内容包含未完成或未验证的工具调用文本，DevSeek 不会补全、规范化或执行它，也不会把内部恢复标识当作文件继续分析。',
      '请重新发送纯文本内容，或将需要展示的工具样本文本放入完整代码块后重试。',
    ].join('\n');
  }
  const promptHint = userPrompt.trim().slice(0, 160);
  return [
    '已停止执行当前恢复任务。',
    '',
    'DevSeek 没有找到足够的可信任务事实来安全续传，因此未读取、搜索或写入工作区文件。',
    promptHint ? `原始请求摘要：${promptHint}${userPrompt.trim().length > 160 ? '…' : ''}` : '',
  ].filter(Boolean).join('\n');
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
export { extractAnalysisFindings } from './agent/analysis-findings';

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
): Promise<TaskExecutionResult> {
  const basename = getAgentTaskDisplayTarget(task);
  const taskToolCallbacks: AgentLoopCallbacks = { ...callbacks, onTodoUpdate: undefined };
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

  if (task.action === 'respond') {
    const response = buildLocalRespondTaskMessage(task, userPrompt);
    callbacks.onDelta(response);
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      taskId: task.id,
      taskFile: basename,
      taskAction: task.action,
      taskDesc: task.desc,
      taskIndex,
      taskTotal: allTasks.length,
      state: 'completed',
      title: task.desc || basename,
      detail: basename,
    });
    return { applied: false, raw: response, taskComplete: true };
  }

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
    const taskTerminalEvidence: TerminalEvidence[] = [];
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
        const loopRes = await executeFakeToolsForLoop(tools, taskToolCallbacks, analyzeWorkdir, {
          currentTaskIndex: taskIndex,
          taskTotal: allTasks.length,
          deferDoneStatus: true,
          userPrompt,
          workspaceRoot: workspaceRoot.fsPath,
        });
        if (loopRes.terminalEvidence?.length) {
          taskTerminalEvidence.push(...loopRes.terminalEvidence);
        }
        const terminalFailure = findBlockingTerminalFailureEvidence(taskTerminalEvidence);
        if (loopRes.taskComplete) {
          if (terminalFailure) {
            execMessages.push({
              role: 'user',
              content: `[验证失败]\n${buildTerminalFailureRepairFeedback(terminalFailure, [])}\n\n请先修复并重新运行验证；不能把当前任务标记为完成。`,
            });
            continue;
          }
          return withTaskTerminalEvidence({ applied: false, raw: analyzeRaw, taskComplete: true }, taskTerminalEvidence);
        }
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
      return withTaskTerminalEvidence({ applied: false, raw: analyzeRaw, networkError: netErr }, taskTerminalEvidence);
    }

    const terminalFailure = findBlockingTerminalFailureEvidence(taskTerminalEvidence);
    if (terminalFailure) {
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'execute',
        taskId: task.id, taskFile: basename, taskAction: task.action,
        taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
        state: 'failed', title: task.desc || basename,
        detail: buildTaskTerminalFailureDetail(terminalFailure),
      });
      return withTaskTerminalEvidence({ applied: false, raw: analyzeRaw }, taskTerminalEvidence);
    }

    await callbacks.onAgentStatus({
      type: 'agentStatus', phase: 'execute',
      taskId: task.id, taskFile: basename, taskAction: task.action,
      taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
      state: 'completed', title: task.desc || basename,
    });
    return withTaskTerminalEvidence({ applied: false, raw: analyzeRaw }, taskTerminalEvidence);
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

  const deterministicCreate = await tryExecuteDeterministicCreateTask({
    task,
    taskIndex,
    taskTotal: allTasks.length,
    workspaceRoot,
    effectiveAbsPath: earlyEffectiveAbsPath,
    callbacks,
  });
  if (deterministicCreate) return deterministicCreate;

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
  const taskTerminalEvidence: TerminalEvidence[] = [];
  const taskWrittenFiles: WrittenFileEvidence[] = [];

  const recordTaskToolWrites = (writtenFiles?: WrittenFileEvidence[]) => {
    if (writtenFiles?.length) taskWrittenFiles.push(...writtenFiles);
  };

  const completeFromTaskToolWrite = async (taskComplete = false): Promise<TaskExecutionResult | undefined> => {
    const evidence = selectTaskWriteEvidence(task, taskWrittenFiles, workspaceRoot.fsPath);
    if (!evidence) return undefined;

    const freshContent = readFileContentFull(evidence.path);
    if (freshContent) {
      contentCache.set(evidence.path, freshContent);
      if (task.absPath) contentCache.set(task.absPath, freshContent);
    }

    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      taskId: task.id,
      taskFile: basename,
      taskAction: task.action,
      taskDesc: task.desc,
      taskIndex,
      taskTotal: allTasks.length,
      state: 'completed',
      title: task.desc || basename,
      detail: `${nodePath.basename(evidence.path)} · 已通过工具写入`,
      linesAdded: evidence.linesAdded,
      linesRemoved: evidence.linesRemoved,
    });

    return withTaskTerminalEvidence({
      applied: true,
      path: evidence.path,
      raw,
      linesAdded: evidence.linesAdded,
      linesRemoved: evidence.linesRemoved,
      ...(taskComplete ? { taskComplete: true } : {}),
    }, taskTerminalEvidence);
  };

  for (let taskRound = 0; taskRound < MAX_TASK_ROUNDS; taskRound++) {
    if (callbacks.signal?.aborted) {
      return withTaskTerminalEvidence({ applied: false, raw }, taskTerminalEvidence);
    }
    try {
      taskMessages.push(...consumeUserSteerMessages(callbacks));
      const { text, tools } = await chatWithMessages(taskMessages, mode, undefined, callbacks.signal, consumeNewSession());
      taskMessages.push({ role: 'assistant', content: text });
      raw = text;

      const loopRes = await executeFakeToolsForLoop(tools, taskToolCallbacks, editorWorkdir, {
        currentTaskIndex: taskIndex,
        taskTotal: allTasks.length,
        deferDoneStatus: true,
        userPrompt,
        workspaceRoot: workspaceRoot.fsPath,
      });
      if (loopRes.terminalEvidence?.length) {
        taskTerminalEvidence.push(...loopRes.terminalEvidence);
      }
      recordTaskToolWrites(loopRes.writtenFiles);
      const writeToolCompletion = await completeFromTaskToolWrite(loopRes.taskComplete);
      if (writeToolCompletion) return writeToolCompletion;
      if (loopRes.taskComplete) {
        // For create/modify tasks: if the AI emitted file content + task_complete
        // in the same response, fall through to the file-writing path instead of
        // returning early (otherwise the file never gets written to disk).
        if ((task.action === 'create' || task.action === 'modify') && raw) { taskCompleteByAI = true; break; }
        return withTaskTerminalEvidence({ applied: false, raw, taskComplete: true }, taskTerminalEvidence);
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
      return withTaskTerminalEvidence({ applied: false, raw, networkError: netErr }, taskTerminalEvidence);
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
          return withTaskTerminalEvidence({
            applied: false,
            raw,
            ...(taskCompleteByAI ? { taskComplete: true } : {}),
          }, taskTerminalEvidence);
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
        return withTaskTerminalEvidence({
          applied: true,
          path: task.absPath,
          raw,
          ...(taskCompleteByAI ? { taskComplete: true } : {}),
        }, taskTerminalEvidence);
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
  const applyTargetPath = effectiveAbsPath
    ? nodePath.relative(workspaceRoot.fsPath, effectiveAbsPath).replace(/\\/g, '/')
    : task.file;
  let applyResult = await applyGeneratedArtifactPathWithPrompt(
    raw,
    applyTargetPath,
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
      await executeFakeToolsForLoop(rTools, taskToolCallbacks, editorWorkdir, {
        currentTaskIndex: taskIndex,
        taskTotal: allTasks.length,
        deferDoneStatus: true,
        userPrompt,
        workspaceRoot: workspaceRoot.fsPath,
      });
    } catch { /* retry failed, fall through */ }

    if (retryRaw) {
      applyResult = await applyGeneratedArtifactPathWithPrompt(
        retryRaw,
        applyTargetPath,
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

  return withTaskTerminalEvidence({
    applied,
    path: applied ? applyResult.changedPaths[0] : undefined,
    raw,
    linesAdded: fullFileDiff?.added,
    linesRemoved: fullFileDiff?.removed,
    ...(taskCompleteByAI ? { taskComplete: true } : {}),
  }, taskTerminalEvidence);
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
  const taskTodoLedger = createAgentTaskTodoLedger(tasks, startFromIndex);

  // Announce execution start
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    title: `开始执行 ${tasks.length} 个任务`,
    detail: tasks.map((t, i) => `${i + 1}. [${t.action}] ${getAgentTaskDisplayTarget(t)} — ${t.desc}`).join('\n'),
    taskTotal: tasks.length,
  });

  // Copilot 规划阶段对齐：执行开始前先展示全部任务（全部 not-started）
  // Copilot 的 AI 在第一轮就调用 manage_todo_list 这样做；这里用框架自动初始化以确保可见性。
  if (callbacks.onTodoUpdate && tasks.length > 0 && startFromIndex === 0) {
    await callbacks.onTodoUpdate(taskTodoLedger.snapshot());
  }

  // ── Consolidated analysis shortcut ───────────────────────────────────────
  // G6: Removed the allReadOnly early-return shortcut that bypassed the tool loop.
  // All tasks — including pure analyze/explain batches — now go through executeTask
  // which runs a multi-round tool loop (G3+G4). This allows AI to actively grep,
  // read related files, and run commands instead of being limited to a single LLM call.
  const isReadOnlyAction = isReadOnlyAgentTaskAction;

  // ── Execute every task individually ───────────────────────────────────────
  // contentCache: tracks the latest written content per absPath so that each
  // subsequent task on the same file sees the result of the previous task.
  // sessionHistory (L-1/L-4): accumulates task summaries so each LLM call
  // knows what was already done in this agent session (cross-round context).
  const contentCache = new Map<string, string>();
  const sessionHistory: ChatMessage[] = [];
  // Accumulate analysis text from read-only tasks to return as analysisText (for findings injection)
  const analysisTexts: string[] = [];
  const allTerminalEvidence: TerminalEvidence[] = [];
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
      await callbacks.onTodoUpdate(taskTodoLedger.startTask(i));
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
      await callbacks.onTaskCheckpoint?.(i, tasks.slice(i), 'paused');
      const failedReason = `网络中断，已在第 ${i + 1}/${tasks.length} 个任务暂停。`;
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'done', state: 'failed',
        title: `网络中断，已在第 ${i + 1}/${tasks.length} 个任务暂停`,
        detail: `已完成 ${tasksApplied} 个任务，剩余 ${tasks.length - i} 个等待续传。重连后可继续。`,
        taskTotal: tasks.length,
      });
      return buildAgentLoopResult({
        tasks,
        tasksApplied,
        tasksFailed: tasksFailed + 1,
        changedPaths,
        userPrompt,
        todos: taskTodoLedger.snapshot(),
        editedFileRecords,
        terminalEvidence: allTerminalEvidence,
        workspaceRoot: workspaceRoot.fsPath,
        failedReason,
        analysisTexts,
      });
    }

    // L-4 / I-3: Append brief task result to session history.
    // G7: Cap based on total char count rather than entry count — avoids both under-
    // trimming (20 short entries) and over-trimming (20 long entries).
    const sessionChars = sessionHistory.reduce((s, m) => s + (m.content?.length ?? 0), 0);
    if (sessionChars > 40000 && sessionHistory.length >= 6) {
      // Preserve index 0-1 (initial-request anchor); drop oldest non-anchor pair.
      sessionHistory.splice(2, 2);
    }
    const taskSettlementInput = {
      action: task.action,
      applied: result.applied,
      path: result.path,
      raw: result.raw,
      taskComplete: result.taskComplete,
      terminalEvidence: result.terminalEvidence,
    };
    if (result.terminalEvidence?.length) {
      allTerminalEvidence.push(...result.terminalEvidence);
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
      analysisTexts.push(`## ${getAgentTaskDisplayTarget(task)}\n${result.raw}`);
      // Keep analysis context but limit its size to avoid token overflow
      sessionHistory.push({
        role: 'assistant',
        content: `已分析 ${getAgentTaskDisplayTarget(task)}：${result.raw.slice(0, 1200)}${result.raw.length > 1200 ? '…' : ''}`,
      });
    } else if (!isReadOnlyAction(task.action)) {
      sessionHistory.push({
        role: 'assistant',
        content: `任务 ${i + 1}/${tasks.length} 失败：${getAgentTaskDisplayTarget(task)}（${task.desc}）`,
      });
    }

    const taskSettlement = taskTodoLedger.settleTask(i, taskSettlementInput);
    if (taskSettlement.failed) {
      tasksFailed += 1;
      await callbacks.onAgentStatus(buildTaskSettlementFailureStatus(task, i + 1, tasks.length, result));
      if (isReadOnlyAction(task.action)) {
        sessionHistory.push({
          role: 'assistant',
          content: `任务 ${i + 1}/${tasks.length} 验证失败：${getAgentTaskDisplayTarget(task)}（${task.desc}）`,
        });
      }
    }

    if (callbacks.onTodoUpdate && tasks.length > 0) {
      await callbacks.onTodoUpdate(taskSettlement.todos);
    }

    // Only emit responseMeta for generation tasks (modify/create/delete).
    if (result.raw && !isReadOnlyAction(task.action)) {
      await callbacks.onResponseMeta(result.raw);
    }

    // Update checkpoint after each successful task so a future network error
    // only re-runs from the NEXT task, not from the beginning.
    if (i + 1 < tasks.length) {
      await callbacks.onTaskCheckpoint?.(i + 1, tasks.slice(i + 1), 'progress');
    }

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
  await callbacks.onTaskCheckpoint?.(null, [], 'completed');

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
    appendValidationEvidence(allTerminalEvidence, validationOutcome);

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
        await callbacks.onTodoUpdate(taskTodoLedger.repairSnapshot(
          `修复验证失败：${nodePath.basename(repairTarget)}`,
          tasks.length + repairRound,
        ));
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
        await callbacks.onTaskCheckpoint?.(tasks.length, [], 'paused');
        const failedReason = `网络中断，验证修复第 ${repairRound} 轮暂停。`;
        await callbacks.onAgentStatus({
          type: 'agentStatus',
          phase: 'done',
          state: 'failed',
          title: `网络中断，验证修复第 ${repairRound} 轮暂停`,
          detail: '修复任务已暂停，重连后可重新发起验证。',
          taskTotal: tasks.length,
        });
        return buildAgentLoopResult({
          tasks,
          tasksApplied,
          tasksFailed: tasksFailed + 1,
          changedPaths,
          userPrompt,
          todos: taskTodoLedger.snapshot(),
          editedFileRecords,
          terminalEvidence: allTerminalEvidence,
          workspaceRoot: workspaceRoot.fsPath,
          failedReason,
          analysisTexts,
        });
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
      appendValidationEvidence(allTerminalEvidence, validationOutcome);
    }
  }
  const validationFailed = validationOutcome ? !validationOutcome.ok : false;
  if (validationFailed && callbacks.onTodoUpdate && tasks.length > 0) {
    await callbacks.onTodoUpdate(taskTodoLedger.markValidationFailure());
  }

  void hadTaskComplete;
  const finalFailed = tasksFailed + (validationFailed ? 1 : 0);
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: finalFailed === 0 ? 'completed' : 'failed',
    title: finalFailed === 0
      ? `全部 ${tasks.length} 个任务已完成`
      : validationFailed
        ? `完成 ${tasksApplied}，验证失败`
        : `完成 ${tasksApplied}，失败 ${tasksFailed}`,
    detail: changedPaths.length > 0
      ? `已写入：${changedPaths.join('、')}${validationFailed ? `\n验证失败：${validationOutcome?.reason || 'validation-failed'}${validationOutcome?.detail ? `\n${validationOutcome.detail.slice(0, 400)}` : ''}` : ''}`
      : undefined,
    taskTotal: tasks.length,
    ...(editedFileRecords.length > 0 ? { editedFiles: editedFileRecords } : {}),
  });

  const historyFailedReason = buildAgentLoopHistoryFailedReason({
    tasksFailed,
    validationFailed,
    validationOutcome,
  });
  return buildAgentLoopResult({
    tasks,
    tasksApplied,
    tasksFailed: finalFailed,
    changedPaths,
    userPrompt,
    todos: taskTodoLedger.snapshot(),
    editedFileRecords,
    terminalEvidence: allTerminalEvidence,
    workspaceRoot: workspaceRoot.fsPath,
    failedReason: historyFailedReason,
    summary: finalFailed === 0 ? `全部 ${tasks.length} 个任务已完成。` : undefined,
    analysisTexts,
  });
}

function appendValidationEvidence(target: TerminalEvidence[], validation: ValidationOutcome | undefined): void {
  if (!validation?.ran || !validation.command) return;
  target.push({
    command: validation.command,
    kind: classifyTerminalEvidenceCommand(validation.command),
    ok: validation.ok,
    exitCode: validation.ok ? 0 : null,
    detail: validation.detail,
  });
}

function buildAgentLoopHistoryFailedReason(input: {
  tasksFailed: number;
  validationFailed: boolean;
  validationOutcome?: ValidationOutcome;
}): string | undefined {
  if (input.validationFailed) {
    const reason = input.validationOutcome?.reason || 'validation-failed';
    const detail = input.validationOutcome?.detail?.trim().split(/\r?\n/)[0]?.trim();
    return [`自动验证未通过：${reason}`, detail].filter(Boolean).join('。');
  }
  if (input.tasksFailed > 0) return `${input.tasksFailed} 个子任务缺少完成证据或执行失败。`;
  return undefined;
}

function buildAgentLoopResult(input: {
  tasks: AgentTask[];
  tasksApplied: number;
  tasksFailed: number;
  changedPaths: string[];
  userPrompt: string;
  todos: Array<{ id: number | string; title: string; status: string }>;
  editedFileRecords: Array<{ path: string; basename: string; linesAdded?: number; linesRemoved?: number; action: string }>;
  terminalEvidence: TerminalEvidence[];
  workspaceRoot: string;
  failedReason?: string;
  summary?: string;
  analysisTexts?: string[];
}): AgentLoopResult {
  const historyWrittenFiles = coalesceEditedFileRecordsForHistory(input.editedFileRecords, input.workspaceRoot);
  const historyQualityGate = buildAgenticQualityGateForHistory({
    failedReason: input.failedReason,
    writtenFiles: historyWrittenFiles,
    terminalEvidence: input.terminalEvidence,
  });
  const historyText = buildAgenticHistoryText({
    label: 'Agent',
    countLabel: `${input.tasksApplied}/${input.tasks.length} 个任务`,
    userPrompt: input.userPrompt,
    roundCount: input.tasks.length,
    completed: input.tasksFailed === 0,
    failedReason: input.failedReason,
    summary: input.summary,
    todos: input.todos.map(todo => ({
      id: todo.id,
      title: todo.title,
      status: normalizeHistoryTodoStatus(todo.status),
    })),
    writtenFiles: historyWrittenFiles,
    terminalEvidence: input.terminalEvidence,
    qualityGate: historyQualityGate,
    workspaceRoot: input.workspaceRoot,
  });

  return {
    tasksTotal: input.tasks.length,
    tasksApplied: input.tasksApplied,
    tasksFailed: input.tasksFailed,
    changedPaths: input.changedPaths,
    // G6: return collected analysis text so extension.ts can use it for findings injection
    ...(input.analysisTexts?.length ? { analysisText: input.analysisTexts.join('\n\n') } : {}),
    historyText,
  };
}

function coalesceEditedFileRecordsForHistory(
  records: Array<{ path: string; basename: string; linesAdded?: number; linesRemoved?: number; action: string }>,
  workspaceRoot: string,
): WrittenFileEvidence[] {
  return records.map(record => ({
    path: record.path,
    basename: record.basename,
    linesAdded: record.linesAdded ?? 0,
    linesRemoved: record.linesRemoved ?? 0,
    action: record.action,
  })).map(record => ({
    ...record,
    path: nodePath.isAbsolute(record.path)
      ? record.path
      : nodePath.join(workspaceRoot, record.path),
  }));
}

function normalizeHistoryTodoStatus(status: string): AgenticHistoryTodoStatus {
  return status === 'completed' || status === 'failed' || status === 'in-progress'
    ? status
    : 'not-started';
}
