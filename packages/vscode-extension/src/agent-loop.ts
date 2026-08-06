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
import { createDevSeekTraceLogger } from '@devseek-netai/shared';
import { ChatMessage } from './llm/types';
import { AgentTask, getAgentTaskDisplayTarget, readFileContentSafe, readFileContentFull } from './agent-task-decomposer';
import { fenceLangForFile, roughLineDiff } from './utils';
import { findWorkspaceFolderForRelativePath } from './workspace-roots';
import { applyGeneratedArtifactPathWithPrompt } from './workspace-applier';
import { resolveWorkspaceWritePath } from './workspace/path-resolver';
import { McpToolRef } from './mcp/client';
import { getProjectRulesSync, wrapRulesAsContext, getProjectMemorySync, wrapMemoryAsContext } from './project-rules';
import {
  findFirstToolCallStart,
} from './agent/fake-tool-parser';
import { chatViaProvider, chatWithMessages } from './agent/loop-chat';
import type { WriteAuthority } from './agent/write-authority';
import { buildLocalRespondTaskMessage, buildToolsSuffix } from './agent/agent-prompt-builder';
import { isNetworkError } from './agent/network-error';
import {
  classifyTerminalEvidenceCommand,
  buildTerminalFailureRepairFeedback,
  findBlockingTerminalFailureEvidence,
  requiresRuntimeValidation,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './agent/completion-evidence';
import { tryExecuteDeterministicCreateTask } from './agent/deterministic-task-executor';
import { tryExecuteMarkdownDeliverableTask } from './agent/markdown-deliverable-task';
import { authorizeAgentFileWriteContract } from './agent/task-contract';
import {
  isTargetExactIsolatedArtifactWriteScope,
  isTargetInsideIsolatedArtifactWriteScope,
} from './agent/isolated-artifact-write-scope';
import {
  buildTaskTerminalFailureDetail,
  type TaskExecutionResult,
} from './agent/task-execution-result';
import { createTaskConvergenceGuard } from './agent/task-convergence-guard';
import { normalizeToolCall } from './agent/tool-call-normalizer';
import type { AgentLoopCallbacks, AgentLoopResult, ExecutionScopedAgentLoopCallbacks } from './agent/loop-types';
import {
  analyzeTerminalEvidence,
  buildAgentMetaOnlyToolFeedback,
  executeFakeToolsForLoop,
  type ToolLoopResult,
} from './agent/tool-loop';
import {
  isExistingDirectory,
  taskWorkdirFromResolvedPath,
  tryExecuteDeterministicAnalyzeExecution,
} from './agent/deterministic-analyze-execution';
import { selectTaskWrittenFileEvidence } from './agent/task-write-evidence';
import { buildAnalyzeToolWriteSettlement } from './agent/analyze-tool-write-settlement';
import {
  buildTaskSettlementCompletionStatus,
  buildTaskSettlementFailureStatus,
  createAgentTaskTodoLedger,
  isReadOnlyAgentTaskAction,
} from './agent/task-state-machine';
import { enforceAgentTaskExecutionPolicy } from './agent/task-execution-policy';
import { tryRunSimpleFileTask } from './agent/simple-file-task';
import { runAgentAutoValidationForWrites, type AgentAutoValidationResult } from './agent/auto-validation';
import { shouldRequestManualReviewForRun } from './agent/manual-review-validation';
import { decideAgentRuntimeTurn } from './agent/agent-runtime-turn-policy';
import { WorkspaceEditService, type WorkspaceTextFileBaseline } from './workspace/edit-service';
import { VsCodeWorkspaceMutationAdapter } from './workspace/coding-workspace-mutation-adapter';
import { buildTaskShapeGuidancePrompt } from './agent/task-shape';
import { routeTaskIntent, routeTaskSemanticContract } from './task-intent-router';
import type { TaskSemanticContract } from './task-semantic-contract';
import { createSemanticExecutionWriteAuthority } from './agent/semantic-execution-context';
import { VerificationPlanner, shouldRunCppValidation } from './app/verification-planner';
import { VsCodeVerificationAdapter } from './app/coding-verification-adapter';
import { normalizeRepairRoundBudget } from './app/bounded-repair-policy';
import { ValidationService } from './workspace/validation-service';
import { buildAnalyzeTaskPrompt } from './agent/analyze-task-prompt';
import { ArtifactGroundingCollector } from './agent/artifact-grounding-lifecycle';
import { buildAgentLoopResult } from './agent/agent-loop-result';
import {
  appendTaskExecutionEvidence,
  appendVerificationReceipt,
  createAgentLoopExecutionEvidence,
  TaskExecutionEvidenceCollector,
} from './agent/agent-loop-execution-evidence';
import {
  applySearchReplaceBlocks,
  parseSearchReplaceBlocks,
} from './agent/search-replace';
import {
  autoValidationResultToValidationOutcome,
  combineFinalValidationOutcomes,
  emitLegacyValidationQualityGateStatus,
  type ValidationOutcome,
} from './agent/agent-loop-validation-outcome';
import {
  collectToolReadEvidence,
  ToolReadEvidenceRecorder,
} from './agent/tool-read-evidence';
import {
  appendAgentLoopWrittenFiles,
  buildWrittenFileEvidenceForPaths,
  collectTaskResultWrittenFiles,
  countByValue,
  summarizeWrittenFileBasenames,
  uniquePaths,
  uniqueStringValues,
} from './agent/agent-loop-written-files';
// buildAgenticHistoryText composition lives behind buildAgentLoopResult's history boundary.

// ----------------------------------------------------------------
// Reporter types (passed in from extension.ts)
// ----------------------------------------------------------------

const workspaceEditService = new WorkspaceEditService();
const workspaceMutation = new VsCodeWorkspaceMutationAdapter(workspaceEditService);
const legacyVerification = new VsCodeVerificationAdapter();
let searchReplaceMutationSequence = 0;
export type { AgentLoopCallbacks, AgentLoopResult, AgentStatusMessage } from './agent/loop-types';
export { extractAnalysisFindings } from './agent/analysis-findings';

/** Only C/C++ files need compile validation */
function isCompilableFile(filename: string): boolean {
  return ['.cpp', '.c', '.h', '.hpp', '.cc', '.cxx'].includes(
    nodePath.extname(filename).toLowerCase(),
  );
}

function isJavaScriptValidationFile(filename: string): boolean {
  return ['.js', '.mjs', '.cjs'].includes(nodePath.extname(filename).toLowerCase());
}

function isPythonValidationFile(filename: string): boolean {
  return nodePath.extname(filename).toLowerCase() === '.py';
}

function isLegacyAutoValidationFile(filename: string): boolean {
  return isCompilableFile(filename) || isJavaScriptValidationFile(filename) || isPythonValidationFile(filename);
}

function shouldRunGeneralAutoValidationForFile(file: WrittenFileEvidence): boolean {
  return !isLegacyAutoValidationFile(file.path) && !isLegacyAutoValidationFile(file.basename);
}

function shouldDeferRecoverableTaskValidationFailure(input: {
  action: AgentTask['action'];
  applied?: boolean;
  failedReason?: string;
  writtenFiles?: WrittenFileEvidence[];
  terminalEvidence?: TerminalEvidence[];
}): boolean {
  if (isReadOnlyAgentTaskAction(input.action) || !input.applied || input.failedReason) return false;
  const writtenFiles = input.writtenFiles ?? [];
  if (writtenFiles.length === 0) return false;
  if (!findBlockingTerminalFailureEvidence(input.terminalEvidence)) return false;
  return writtenFiles.some(file => isLegacyAutoValidationFile(file.path || file.basename));
}

const AGENT_LOOP_MESSAGE_TOTAL_CHAR_BUDGET = 52_000;
const AGENT_LOOP_TASK_PROMPT_CHAR_BUDGET = 32_000;
const AGENT_LOOP_TOOL_FEEDBACK_CHAR_BUDGET = 7_000;
const AGENT_LOOP_ASSISTANT_HISTORY_CHAR_BUDGET = 6_000;
const AGENT_LOOP_USER_HISTORY_CHAR_BUDGET = 8_000;

function messageContentLength(content: ChatMessage['content']): number {
  if (typeof content === 'string') return content.length;
  return JSON.stringify(content).length;
}

function truncateAgentLoopHistoryText(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return [
    text.slice(0, maxChars),
    '',
    `[DevSeek 上下文压缩] ${label} 已截断 ${omitted} 字符，避免 Provider prompt 过大；如需更多细节，请继续用 read_file/grep_search 精确读取。`,
  ].join('\n');
}

function isAgentLoopTaskPrompt(content: string): boolean {
  return /【本次子任务】|【本次任务】/.test(content);
}

function isAgentLoopToolFeedback(content: string): boolean {
  return /^\s*\[(?:工具执行结果|验证失败)\]/.test(content);
}

function messageHistoryBudgetFor(message: ChatMessage): number {
  if (typeof message.content !== 'string') return Number.POSITIVE_INFINITY;
  if (isAgentLoopTaskPrompt(message.content)) return AGENT_LOOP_TASK_PROMPT_CHAR_BUDGET;
  if (isAgentLoopToolFeedback(message.content)) return AGENT_LOOP_TOOL_FEEDBACK_CHAR_BUDGET;
  if (message.role === 'assistant') return AGENT_LOOP_ASSISTANT_HISTORY_CHAR_BUDGET;
  return AGENT_LOOP_USER_HISTORY_CHAR_BUDGET;
}

function totalAgentLoopMessageChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + messageContentLength(message.content), 0);
}

function compactAgentLoopMessageHistory(messages: ChatMessage[]): void {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (typeof message.content !== 'string') continue;
    const maxChars = messageHistoryBudgetFor(message);
    const nextContent = truncateAgentLoopHistoryText(
      message.content,
      maxChars,
      message.role === 'assistant' ? '上一轮模型输出' : '上一轮工具反馈',
    );
    if (nextContent !== message.content) {
      messages[index] = { ...message, content: nextContent };
    }
  }

  if (totalAgentLoopMessageChars(messages) > AGENT_LOOP_MESSAGE_TOTAL_CHAR_BUDGET) {
    throw new Error('agent-loop-boundary:canonical-context-compaction-required');
  }
}


// ----------------------------------------------------------------
// Prompt builders — all include current file content
// ----------------------------------------------------------------

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
  semanticContract?: TaskSemanticContract,
  projectRulesText?: string,
): string {
  const taskIntent = semanticContract
    ? routeTaskSemanticContract(semanticContract)
    : routeTaskIntent(userPrompt);
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
  const projectRules = projectRulesText ?? getProjectRulesSync();
  const projectRulesSection = projectRules ? [wrapRulesAsContext(projectRules), ``].join('\n') : '';
  const projectMemory = getProjectMemorySync({
    prompt: userPrompt,
    relatedPaths: [task.absPath ?? task.file, workdirOverride].filter((pathValue): pathValue is string => Boolean(pathValue)),
  });
  const projectMemorySection = projectMemory ? [wrapMemoryAsContext(projectMemory), ``].join('\n') : '';

  return [
    `你是一个专业的编程智能体（Editor 角色），正在执行多文件任务中的一个子任务。`,
    ``,
    projectRulesSection,
    projectMemorySection,
    buildTaskShapeGuidancePrompt(userPrompt),
    ``,
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
          `如果本任务属于既有大项目/正式项目，且当前缺少源项目事实、通信链路、主入口或修改锚点证据，先调用 read_file/list_dir/grep_search/file_search 收集证据；不要直接臆造新文件内容。`,
          ``,
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
    buildToolsSuffix(taskIndex, taskTotal, mcpTools, workdirOverride ?? (task.absPath ? nodePath.dirname(task.absPath) : undefined), {
      taskIntent,
    }),
  ].filter(Boolean).join('\n');
}


async function executeTask(
  task: AgentTask,
  taskIndex: number,
  allTasks: AgentTask[],
  changedPaths: string[],
  writeAuthority: WriteAuthority,
  mode: 'fast' | 'r1' | undefined,
  workspaceRoot: vscode.Uri,
  callbacks: AgentLoopCallbacks,
  contentCache: Map<string, string>,
  history?: ChatMessage[],
  analysisContext?: string,
  newSession = false,
  readEvidenceRecorder?: ToolReadEvidenceRecorder,
): Promise<TaskExecutionResult> {
  const basename = getAgentTaskDisplayTarget(task);
  const taskToolCallbacks: AgentLoopCallbacks = { ...callbacks, onTodoUpdate: undefined };
  let firstCall = true;
  const consumeNewSession = () => { const ns = firstCall && newSession; firstCall = false; return ns; };
  const taskReadEvidence: import('./agent/evidence-grounding').EvidenceRef[] = [];
  const taskEvidence = new TaskExecutionEvidenceCollector(taskReadEvidence);
  const withTaskTerminalEvidence = <T extends Omit<
    TaskExecutionResult,
    'terminalEvidence' | 'verificationReceipts' | 'toolExecutionReceipts' | 'changeReceipts'
  >>(
    result: T,
    evidence: TerminalEvidence[],
  ): TaskExecutionResult => taskEvidence.attach(result, evidence);

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
    const response = buildLocalRespondTaskMessage(task, writeAuthority.currentPrompt);
    const nonRecoverableProviderRecovery = isNonRecoverableProviderRecoveryRespondTask(task);
    recordLocalAgentResponsePayload(callbacks, response);
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
      state: nonRecoverableProviderRecovery ? 'failed' : 'completed',
      title: task.desc || basename,
      detail: nonRecoverableProviderRecovery ? response : basename,
    });
    return nonRecoverableProviderRecovery
      ? { applied: false, raw: response, taskComplete: false, failedReason: response }
      : { applied: false, raw: response, taskComplete: true };
  }

  // Read current file content — prefer contentCache (updated by prior tasks in this
  // same loop) over disk read, so multi-task edits on the same file properly chain.
  // Use readFileContentFull: Editor needs the COMPLETE file for exact SEARCH matching.
  let currentContent = (task.absPath && contentCache.has(task.absPath))
    ? (contentCache.get(task.absPath) ?? '')
    : (task.absPath && !isExistingDirectory(task.absPath) ? readFileContentFull(task.absPath) : '');
  let directWriteBaseline: WorkspaceTextFileBaseline | undefined;
  if ((task.action === 'create' || task.action === 'modify') && task.absPath) {
    try {
      directWriteBaseline = workspaceEditService.captureTextFileBaseline(task.absPath, workspaceRoot.fsPath);
      // The baseline is the authoritative read used to construct an edit. A stale
      // in-memory cache must never become a blind overwrite of newer disk content.
      currentContent = directWriteBaseline.snapshot.content;
    } catch (error) {
      const failedReason = error instanceof Error ? error.message : String(error);
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'execute',
        taskId: task.id,
        taskFile: basename,
        taskAction: task.action,
        taskDesc: task.desc,
        taskIndex,
        taskTotal: allTasks.length,
        state: 'failed',
        title: task.desc || basename,
        detail: failedReason,
      });
      return { applied: false, path: task.absPath, raw: '', failedReason };
    }
  }

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
    if (!earlyEffectiveAbsPath && task.action !== 'create') {
      const fallbackDirs = allTasks
        .filter(t => t !== task && t.absPath)
        .map(t => nodePath.dirname(t.absPath!));
      const fallbackDir = fallbackDirs.length > 0
        ? [...countByValue(fallbackDirs).entries()].sort((a, b) => b[1] - a[1])[0][0]
        : undefined;
      const resolved = resolveWorkspaceWritePath(relNorm, {
        requestPrompt: writeAuthority.currentPrompt,
        workspaceRootFsPath: workspaceRoot.fsPath,
        defaultWorkdir: fallbackDir,
      });
      if (resolved && fs.existsSync(resolved.absPath)) {
        earlyEffectiveAbsPath = resolved.absPath;
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
    const analyzeWorkdir = taskWorkdirFromResolvedPath(earlyEffectiveAbsPath);
    const deterministicResult = await tryExecuteDeterministicAnalyzeExecution({
      task,
      taskIndex,
      taskTotal: allTasks.length,
      userPrompt: writeAuthority.currentPrompt,
      workspaceRoot,
      callbacks,
      workdir: analyzeWorkdir,
    });
    if (deterministicResult) return deterministicResult;

    // G3: pass taskIndex/taskTotal/mcpTools so the prompt includes full tool definitions
    const analyzePrompt = buildAnalyzeTaskPrompt(
      writeAuthority.currentPrompt,
      task,
      currentContent,
      analyzeWorkdir,
      taskIndex,
      allTasks.length,
      callbacks.mcpToolRefs,
      callbacks.executionMode,
      writeAuthority.semanticContract,
      writeAuthority.projectInstructionsText,
    );
    let analyzeRaw = '';

    // G4+G5: unified multi-round tool loop for ALL analyze/explain/explore tasks.
    // Removed keyword-gated isExecTask branch — AI now autonomously decides when to use tools.
    // MAX_ANALYZE_ROUNDS=8 gives enough depth for investigative tasks without runaway loops.
    const MAX_ANALYZE_ROUNDS = 8;
    const MAX_ANALYZE_NO_TOOL_RECOVERY_ATTEMPTS = 2;
    const execMessages: ChatMessage[] = [
      ...(history ?? []),
      { role: 'user', content: analyzePrompt },
    ];
    const taskTerminalEvidence: TerminalEvidence[] = [];
    const taskWrittenFiles: WrittenFileEvidence[] = [];
    const analyzeConvergenceGuard = createTaskConvergenceGuard();
    let exhaustedWithPendingTools = false;
    let noToolRecoveryAttempts = 0;
    let lastAnalyzeRoundText = '';
    const recordTaskToolWrites = (writtenFiles?: WrittenFileEvidence[]) => {
      if (writtenFiles?.length) taskWrittenFiles.push(...writtenFiles);
    };
    const completeFromAnalyzeToolWrite = async (reason?: string): Promise<TaskExecutionResult | undefined> => {
      const settlement = buildAnalyzeToolWriteSettlement({
        task,
        promptText: writeAuthority.currentPrompt,
        writtenFiles: taskWrittenFiles,
        workspaceRoot: workspaceRoot.fsPath,
        rawText: analyzeRaw || lastAnalyzeRoundText,
        reason,
      });
      if (!settlement) return undefined;

      const freshContent = readFileContentFull(settlement.evidence.path);
      if (freshContent) {
        contentCache.set(settlement.evidence.path, freshContent);
        if (task.absPath) contentCache.set(task.absPath, freshContent);
      }

      return withTaskTerminalEvidence({
        applied: true,
        path: settlement.evidence.path,
        raw: settlement.raw,
        linesAdded: settlement.evidence.linesAdded,
        linesRemoved: settlement.evidence.linesRemoved,
        writtenFiles: settlement.writtenFiles,
        taskComplete: true,
      }, taskTerminalEvidence);
    };
    const recordTaskToolResult = (result: ToolLoopResult): ToolLoopResult => {
      const loopResult = collectToolReadEvidence(taskReadEvidence, result);
      taskEvidence.appendToolLoop(loopResult);
      if (loopResult.terminalEvidence?.length) {
        taskTerminalEvidence.push(...loopResult.terminalEvidence);
      }
      recordTaskToolWrites(loopResult.writtenFiles);
      return loopResult;
    };
    // G-analy-display: Route streaming text into the Working box analysis body (Copilot
    // inline style). Using \x00AFILE:basename\x00 prefix ensures content appears per-task
    // directly inside each Working box, regardless of whether the AI produces streaming
    // prose or puts all analysis in task_complete.summary.
    const AFX = '\x00AFILE:' + basename + '\x00';
    try {
      for (let r = 0; r < MAX_ANALYZE_ROUNDS; r++) {
        if (callbacks.signal?.aborted) break;
        execMessages.push(...writeAuthority.takePendingAndDrain());
        compactAgentLoopMessageHistory(execMessages);
        const { text, tools } = await chatWithMessages(
          execMessages, mode,
          (delta) => {
            if (delta.startsWith('\x00RESET\x00')) {
              // Preserve RESET semantic inside AFILE prefix so analysis body resets cleanly
              analyzeRaw = delta.slice(7);
              callbacks.onDelta(AFX + '\x00RESET\x00' + delta.slice(7));
            } else {
              analyzeRaw += delta;
              callbacks.onDelta(AFX + delta);
            }
          },
          callbacks.signal,
          consumeNewSession(),
          callbacks.traceRunId,
          callbacks.traceWorkspaceRoot,
          callbacks.traceEvidenceParticipantToken,
          callbacks.onTraceEvidenceError,
        );
        const postProviderSteers = writeAuthority.drainAfterProvider();
        lastAnalyzeRoundText = text;
        execMessages.push({ role: 'assistant', content: text }, ...postProviderSteers);
        // Pass analyzeWorkdir so run_terminal defaults to task directory when AI omits workdir.
        const loopRes = recordTaskToolResult(await executeFakeToolsForLoop(tools, taskToolCallbacks, analyzeWorkdir, {
          currentTaskIndex: taskIndex,
          taskTotal: allTasks.length,
          deferDoneStatus: true,
          userPrompt: writeAuthority.currentPrompt,
          workspaceRoot: workspaceRoot.fsPath,
          readEvidenceRecorder,
        }));
        const terminalReview = findLatestManualReviewTerminalEvidence(taskTerminalEvidence);
        if (terminalReview) {
          const detail = terminalReview.detail || '图形或交互式程序已启动，运行效果需要人工确认。';
          await callbacks.onAgentStatus({
            type: 'agentStatus', phase: 'execute',
            taskId: task.id, taskFile: basename, taskAction: task.action,
            taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
            state: 'completed', title: '程序已启动，等待人工确认',
            detail,
          });
          return withTaskTerminalEvidence({
            applied: false,
            raw: analyzeRaw || detail,
            taskComplete: true,
          }, taskTerminalEvidence);
        }
        const terminalFailure = findBlockingTerminalFailureEvidence(taskTerminalEvidence);
        if (loopRes.taskComplete) {
          if (terminalFailure) {
            const reviewEvidence = classifyTaskTerminalManualReview(
              terminalFailure,
              taskTerminalEvidence,
              writeAuthority.currentPrompt,
              changedPaths,
            );
            if (reviewEvidence) {
              return withTaskTerminalEvidence({
                applied: false,
                raw: analyzeRaw || reviewEvidence.detail,
                taskComplete: true,
              }, reviewEvidence.evidence);
            }
            execMessages.push({
              role: 'user',
              content: `[验证失败]\n${buildTerminalFailureRepairFeedback(terminalFailure, [])}\n\n请先修复并重新运行验证；不能把当前任务标记为完成。`,
            });
            continue;
          }
          const writeToolCompletion = await completeFromAnalyzeToolWrite();
          if (writeToolCompletion) return writeToolCompletion;
          return withTaskTerminalEvidence({ applied: false, raw: analyzeRaw || text, taskComplete: true }, taskTerminalEvidence);
        }
        if (!loopRes.toolCallsMade) {
          exhaustedWithPendingTools = false;
          const recovery = decideAgentRuntimeTurn({
            taskAction: task.action,
            toolCallsMade: false,
            aggregateRaw: analyzeRaw || text,
            roundRaw: text,
            taskTitle: task.desc || basename,
            recoveryAttempts: noToolRecoveryAttempts,
            maxRecoveryAttempts: MAX_ANALYZE_NO_TOOL_RECOVERY_ATTEMPTS,
          });
          if (recovery.kind === 'tool-results') continue;
          if (recovery.kind === 'final-answer') break;
          if (recovery.kind === 'recover') {
            noToolRecoveryAttempts += 1;
            await callbacks.onAgentStatus({
              type: 'agentStatus', phase: 'execute',
              taskId: task.id, taskFile: basename, taskAction: task.action,
              taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
              state: 'started',
              title: '模型未输出分析结论，继续要求工具调用或最终答复',
              detail: task.desc || basename,
            });
            execMessages.push({ role: 'user', content: recovery.feedback });
            continue;
          }
          return withTaskTerminalEvidence({
            applied: false,
            raw: analyzeRaw || text,
            failedReason: recovery.failedReason,
          }, taskTerminalEvidence);
        }
        exhaustedWithPendingTools = r >= MAX_ANALYZE_ROUNDS - 1;
        const metaOnlyToolFeedback = !loopRes.workToolCallsMade
          ? buildAgentMetaOnlyToolFeedback(task.desc || basename)
          : '';
        const feedbackForNextRound = [loopRes.feedbackForAI, metaOnlyToolFeedback].filter(Boolean).join('\n\n');

        const convergence = analyzeConvergenceGuard.observe({
          tools: tools.map(tool => normalizeToolCall(tool, 'fake-tool')),
          feedbackForAI: feedbackForNextRound,
          rawText: text,
          writtenFiles: loopRes.writtenFiles,
          terminalEvidence: loopRes.terminalEvidence,
        });
        if (convergence.kind === 'blocked') {
          const failedReason = convergence.detail;
          await callbacks.onAgentStatus({
            type: 'agentStatus', phase: 'execute',
            taskId: task.id, taskFile: basename, taskAction: task.action,
            taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
            state: 'failed',
            title: '停止重复执行：' + (task.desc || basename),
            detail: failedReason,
          });
          return withTaskTerminalEvidence({ applied: false, raw: analyzeRaw || lastAnalyzeRoundText, failedReason }, taskTerminalEvidence);
        }

        execMessages.push({
          role: 'user',
          content: `[工具执行结果]\n${feedbackForNextRound}${convergence.feedbackSuffix ? `\n\n${convergence.feedbackSuffix}` : ''}\n\n请继续。`,
        });
      }
    } catch (e) {
      const netErr = isNetworkError(e);
      const failedReason = (e as Error).message;
      const writeToolCompletion = netErr
        ? await completeFromAnalyzeToolWrite(failedReason)
        : undefined;
      if (writeToolCompletion) {
        await callbacks.onAgentStatus({
          type: 'agentStatus', phase: 'execute',
          taskId: task.id, taskFile: basename, taskAction: task.action,
          taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
          state: 'completed',
          title: '已根据本地写盘证据完成任务',
          detail: `Provider 后续确认请求失败：${failedReason}\n已保留写入证据：${summarizeWrittenFileBasenames(writeToolCompletion.writtenFiles || [])}`,
        });
        return writeToolCompletion;
      }
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'execute',
        taskId: task.id, taskFile: basename, taskAction: task.action,
        taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
        state: 'failed', title: task.desc || basename,
        detail: failedReason,
      });
      return withTaskTerminalEvidence({ applied: false, raw: analyzeRaw || lastAnalyzeRoundText, networkError: netErr, failedReason }, taskTerminalEvidence);
    }

    const terminalFailure = findBlockingTerminalFailureEvidence(taskTerminalEvidence);
    if (exhaustedWithPendingTools) {
      const failedReason = `已达到 ${MAX_ANALYZE_ROUNDS} 轮分析上限，但模型仍在请求工具，尚未输出最终结论。`;
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'execute',
        taskId: task.id, taskFile: basename, taskAction: task.action,
        taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
        state: 'failed', title: '分析工具调用未收敛：' + (task.desc || basename),
        detail: failedReason,
      });
      return withTaskTerminalEvidence({ applied: false, raw: analyzeRaw || lastAnalyzeRoundText, failedReason }, taskTerminalEvidence);
    }
    if (terminalFailure) {
      const reviewEvidence = classifyTaskTerminalManualReview(
        terminalFailure,
        taskTerminalEvidence,
        writeAuthority.currentPrompt,
        changedPaths,
      );
      if (reviewEvidence) {
        await callbacks.onAgentStatus({
          type: 'agentStatus', phase: 'execute',
          taskId: task.id, taskFile: basename, taskAction: task.action,
          taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
          state: 'completed', title: '程序已启动，等待人工确认',
          detail: reviewEvidence.detail,
        });
        return withTaskTerminalEvidence({
          applied: false,
          raw: analyzeRaw || lastAnalyzeRoundText || reviewEvidence.detail,
          taskComplete: true,
        }, reviewEvidence.evidence);
      }
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'execute',
        taskId: task.id, taskFile: basename, taskAction: task.action,
        taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
        state: 'failed', title: task.desc || basename,
        detail: buildTaskTerminalFailureDetail(terminalFailure),
      });
      return withTaskTerminalEvidence({ applied: false, raw: analyzeRaw || lastAnalyzeRoundText }, taskTerminalEvidence);
    }

    const finalNoToolRecovery = decideAgentRuntimeTurn({
      taskAction: task.action,
      toolCallsMade: false,
      aggregateRaw: analyzeRaw || lastAnalyzeRoundText,
      roundRaw: lastAnalyzeRoundText,
      taskTitle: task.desc || basename,
      recoveryAttempts: MAX_ANALYZE_NO_TOOL_RECOVERY_ATTEMPTS,
      maxRecoveryAttempts: MAX_ANALYZE_NO_TOOL_RECOVERY_ATTEMPTS,
    });
    if (finalNoToolRecovery.kind !== 'final-answer' && finalNoToolRecovery.kind !== 'tool-results') {
      return withTaskTerminalEvidence({
        applied: false,
        raw: analyzeRaw || lastAnalyzeRoundText,
        failedReason: finalNoToolRecovery.kind === 'recover'
          ? '模型仍未输出分析结论。'
          : finalNoToolRecovery.failedReason,
      }, taskTerminalEvidence);
    }

    const writeToolCompletion = await completeFromAnalyzeToolWrite();
    if (writeToolCompletion) return writeToolCompletion;

    return withTaskTerminalEvidence({ applied: false, raw: analyzeRaw || lastAnalyzeRoundText }, taskTerminalEvidence);
  }

  // ──── modify / create / delete ────────────────────────────────
  if ((task.action === 'create' || task.action === 'modify') && earlyEffectiveAbsPath) {
    const targetAuthorization = authorizeAgentFileWriteContract({
      promptText: writeAuthority.currentPrompt,
      targetPath: earlyEffectiveAbsPath,
      workspaceRoot: workspaceRoot.fsPath,
      allowScopedSourceArtifact: isTargetInsideIsolatedArtifactWriteScope(
        writeAuthority.currentPrompt,
        earlyEffectiveAbsPath,
        workspaceRoot.fsPath,
      ),
      allowExactScopedArtifact: isTargetExactIsolatedArtifactWriteScope(
        writeAuthority.currentPrompt,
        earlyEffectiveAbsPath,
        workspaceRoot.fsPath,
      ),
    });
    if (!targetAuthorization.allowed) {
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'execute',
        taskId: task.id, taskFile: basename, taskAction: task.action,
        taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
        state: 'failed',
        title: `${basename} — 当前请求未授权写入`,
        detail: targetAuthorization.reason || 'Markdown 目标不在当前用户请求允许范围内。',
      });
      return {
        applied: false,
        path: earlyEffectiveAbsPath,
        failedReason: targetAuthorization.reason || 'Markdown artifact write is not authorized',
      };
    }
  }
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
    userPrompt: writeAuthority.currentPrompt,
    semanticContract: writeAuthority.semanticContract,
    callbacks,
  });
  if (deterministicCreate) {
    const { changeReceipt, ...result } = deterministicCreate;
    return {
      ...result,
      ...(changeReceipt ? { changeReceipts: [changeReceipt] } : {}),
    };
  }

  const markdownDeliverable = await tryExecuteMarkdownDeliverableTask({
    task,
    taskIndex,
    taskTotal: allTasks.length,
    userPrompt: writeAuthority.currentPrompt,
    workspaceRoot,
    effectiveAbsPath: earlyEffectiveAbsPath,
    callbacks,
    semanticContract: writeAuthority.semanticContract,
    chat: async (messages) => {
      const { text } = await chatWithMessages(
        messages,
        mode,
        undefined,
        callbacks.signal,
        consumeNewSession(),
        callbacks.traceRunId,
        callbacks.traceWorkspaceRoot,
        callbacks.traceEvidenceParticipantToken,
        callbacks.onTraceEvidenceError,
      );
      writeAuthority.drainAfterProvider();
      return text;
    },
  });
  if (markdownDeliverable) {
    if (markdownDeliverable.applied && markdownDeliverable.path) {
      try {
        contentCache.set(markdownDeliverable.path, fs.readFileSync(markdownDeliverable.path, 'utf8'));
      } catch {
        // Best-effort cache refresh; write verification already happened in the executor.
      }
    }
    return markdownDeliverable;
  }

  // Build editor prompt with current file content injected.
  const editorWorkdir = earlyEffectiveAbsPath ? nodePath.dirname(earlyEffectiveAbsPath) : undefined;
  const editorPrompt = buildEditorPrompt(
    writeAuthority.currentPrompt, task, allTasks, currentContent, taskIndex, allTasks.length,
    callbacks.mcpToolRefs, analysisContext, editorWorkdir, workspaceRoot.fsPath,
    writeAuthority.semanticContract,
    writeAuthority.projectInstructionsText,
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
  const taskConvergenceGuard = createTaskConvergenceGuard();

  const recordTaskToolWrites = (writtenFiles?: WrittenFileEvidence[]) => {
    if (writtenFiles?.length) taskWrittenFiles.push(...writtenFiles);
  };

  const recordTaskToolResult = (result: ToolLoopResult): ToolLoopResult => {
    const loopResult = collectToolReadEvidence(taskReadEvidence, result);
    taskEvidence.appendToolLoop(loopResult);
    if (loopResult.terminalEvidence?.length) {
      taskTerminalEvidence.push(...loopResult.terminalEvidence);
    }
    recordTaskToolWrites(loopResult.writtenFiles);
    return loopResult;
  };

  const completeFromTaskToolWrite = async (taskComplete = false): Promise<TaskExecutionResult | undefined> => {
    const writtenFiles = selectTaskWrittenFileEvidence(task, taskWrittenFiles, workspaceRoot.fsPath);
    const evidence = writtenFiles[0];
    if (!evidence) return undefined;

    const freshContent = readFileContentFull(evidence.path);
    if (freshContent) {
      contentCache.set(evidence.path, freshContent);
      if (task.absPath) contentCache.set(task.absPath, freshContent);
    }

    return withTaskTerminalEvidence({
      applied: true,
      path: evidence.path,
      raw,
      linesAdded: evidence.linesAdded,
      linesRemoved: evidence.linesRemoved,
      writtenFiles,
      ...(taskComplete ? { taskComplete: true } : {}),
    }, taskTerminalEvidence);
  };

  for (let taskRound = 0; taskRound < MAX_TASK_ROUNDS; taskRound++) {
    if (callbacks.signal?.aborted) {
      return withTaskTerminalEvidence({ applied: false, raw }, taskTerminalEvidence);
    }
    try {
      taskMessages.push(...writeAuthority.takePendingAndDrain());
      compactAgentLoopMessageHistory(taskMessages);
      const { text, tools } = await chatWithMessages(taskMessages, mode, undefined, callbacks.signal, consumeNewSession(), callbacks.traceRunId, callbacks.traceWorkspaceRoot, callbacks.traceEvidenceParticipantToken, callbacks.onTraceEvidenceError);
      const postProviderSteers = writeAuthority.drainAfterProvider();
      taskMessages.push({ role: 'assistant', content: text }, ...postProviderSteers);
      raw = text;

      const loopRes = recordTaskToolResult(await executeFakeToolsForLoop(tools, taskToolCallbacks, editorWorkdir, {
        currentTaskIndex: taskIndex,
        taskTotal: allTasks.length,
        deferDoneStatus: true,
        userPrompt: writeAuthority.currentPrompt,
        workspaceRoot: workspaceRoot.fsPath,
        readEvidenceRecorder,
      }));
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
      const metaOnlyToolFeedback = !loopRes.workToolCallsMade
        ? buildAgentMetaOnlyToolFeedback(task.desc || basename)
        : '';
      const feedbackForNextRound = [loopRes.feedbackForAI, metaOnlyToolFeedback].filter(Boolean).join('\n\n');

      const convergence = taskConvergenceGuard.observe({
        tools: tools.map(tool => normalizeToolCall(tool, 'fake-tool')),
        feedbackForAI: feedbackForNextRound,
        rawText: text,
        writtenFiles: loopRes.writtenFiles,
        terminalEvidence: loopRes.terminalEvidence,
      });
      if (convergence.kind === 'blocked') {
        const failedReason = convergence.detail;
        await callbacks.onAgentStatus({
          type: 'agentStatus',
          phase: 'execute',
          taskId: task.id,
          taskFile: basename,
          taskAction: task.action,
          taskDesc: task.desc,
          taskIndex,
          taskTotal: allTasks.length,
          state: 'failed',
          title: '停止重复执行：' + (task.desc || basename),
          detail: failedReason,
        });
        return withTaskTerminalEvidence({ applied: false, raw, failedReason }, taskTerminalEvidence);
      }

      // Feed tool results back for the next AI round
      taskMessages.push({
        role: 'user',
        content: `[工具执行结果]
${feedbackForNextRound}${convergence.feedbackSuffix ? `\n\n${convergence.feedbackSuffix}` : ''}

请根据以上结果继续完成修改。`,
      });
    } catch (e) {
      const netErr = isNetworkError(e);
      const failedReason = (e as Error).message;
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'execute',
        taskId: task.id, taskFile: basename, taskAction: task.action,
        taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
        state: 'failed', title: task.desc || basename,
        detail: failedReason,
      });
      return withTaskTerminalEvidence({ applied: false, raw, networkError: netErr, failedReason }, taskTerminalEvidence);
    }
  }

  // ── Try SEARCH/REPLACE blocks first ───────────────────────────
  const srBlocks = parseSearchReplaceBlocks(raw);
  if (srBlocks.length > 0 && currentContent && task.absPath && directWriteBaseline) {
    const srResult = applySearchReplaceBlocks(currentContent, srBlocks);
    if (srResult.applied > 0 && srResult.failed === 0) {
      // P-SEC: check with extension before writing (sensitive file protection)
      if (callbacks.onBeforeFileWrite) {
        const allowed = await callbacks.onBeforeFileWrite(task.absPath, {
          purpose: 'workspace-edit',
          userRequested: true,
          taskAction: task.action,
          displayName: task.file,
          requestPrompt: writeAuthority.currentPrompt,
        });
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
      searchReplaceMutationSequence += 1;
      const mutationSequence = searchReplaceMutationSequence;
      const mutation = await workspaceMutation.executeTextFileWrite({
        runId: callbacks.traceRunId?.trim() || `vscode-agent-loop-invocation-${mutationSequence}`,
        sequence: mutationSequence,
        actionId: `search-replace-${task.id}-${mutationSequence}`,
        absPath: task.absPath,
        workspaceRoot: workspaceRoot.fsPath,
        content: srResult.result,
        baseline: directWriteBaseline,
        applyOptions: {
          validateSourceSanity: true,
          repairSourceTransportEscapes: true,
        },
        evidenceRefs: [`search-replace:${task.id}:authorized`],
      });
      taskEvidence.appendChange(mutation.receipt);
      const committedEdit = mutation.receipt.status === 'committed'
        ? mutation.receipt.result
        : undefined;
      if (committedEdit) {
        const writeResult = committedEdit.result;
        const committedContent = committedEdit.commitToken.after.snapshot.content;
        // Subsequent tasks must consume the normalized content that actually committed.
        contentCache.set(task.absPath, committedContent);
        await callbacks.onAppliedChange({
          // Use absPath-relative path for display; fall back to task.file which was
          // already sanitized in parseTaskPlan.
          path: task.absPath
            ? nodePath.relative(workspaceRoot.fsPath, task.absPath).replace(/\\/g, '/')
            : task.file,
          ...writeResult,
        });
        const srDiff = roughLineDiff(writeResult.oldContent, writeResult.newContent);
        const writtenFiles = buildWrittenFileEvidenceForPaths([task.absPath], task.action, workspaceRoot.fsPath, srDiff);
        return withTaskTerminalEvidence({
          applied: true,
          path: task.absPath,
          raw,
          linesAdded: srDiff.added,
          linesRemoved: srDiff.removed,
          writtenFiles,
          ...(taskCompleteByAI ? { taskComplete: true } : {}),
        }, taskTerminalEvidence);
      } else {
        const failedReason = `SEARCH/REPLACE 写入未提交：${mutation.receipt.errorCode ?? mutation.receipt.status}`;
        await callbacks.onAgentStatus({
          type: 'agentStatus',
          phase: 'execute',
          taskId: task.id,
          taskFile: basename,
          taskAction: task.action,
          taskDesc: task.desc,
          taskIndex,
          taskTotal: allTasks.length,
          state: 'failed',
          title: `未能提交 ${basename}`,
          detail: failedReason,
        });
        return withTaskTerminalEvidence({ applied: false, raw, failedReason }, taskTerminalEvidence);
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
  const authorizeFullFileApply = async (): Promise<boolean> => Boolean(
    effectiveAbsPath
    && (!callbacks.onBeforeFileWrite || await callbacks.onBeforeFileWrite(effectiveAbsPath, {
      purpose: 'workspace-edit',
      userRequested: true,
      taskAction: task.action,
      displayName: task.file,
      requestPrompt: writeAuthority.currentPrompt,
    })),
  );
  const fullFileWriteBlocked = async (): Promise<TaskExecutionResult> => {
    const failedReason = effectiveAbsPath
      ? 'Full-file write blocked by the current user authority or file policy'
      : 'Full-file write blocked because the target path is unresolved';
    await callbacks.onAgentStatus({
      type: 'agentStatus', phase: 'execute', state: 'failed',
      taskId: task.id, taskFile: basename, taskAction: task.action,
      taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
      title: `${basename} — 当前请求未授权写入`, detail: failedReason,
    });
    return withTaskTerminalEvidence({ applied: false, raw, path: effectiveAbsPath, failedReason }, taskTerminalEvidence);
  };
  if (!(await authorizeFullFileApply())) return fullFileWriteBlocked();
  let applyResult = await applyGeneratedArtifactPathWithPrompt(
    raw,
    applyTargetPath,
    editorPrompt,
    async (status) => { await callbacks.onWorkflowStatus(status); },
    true,
    async (change) => { await callbacks.onAppliedChange(change); },
    absFiles,
    {
      validationCommandRunner: callbacks.onValidationCommand,
      ...(callbacks.traceRunId ? { mutationRunId: callbacks.traceRunId } : {}),
      mutationSequence: taskIndex * 2 + 1,
      mutationActionId: `agent-task-${taskIndex + 1}-full-file-primary`,
    },
  );
  taskEvidence.appendVerification(applyResult.verificationReceipt);
  taskEvidence.appendChanges(applyResult.changeReceipts);

  // ── Retry once if nothing was applied ─────────────────────────
  if (!applyResult.applied || applyResult.changedPaths.length === 0) {
    const lang = fenceLangForFile(basename);
    const retryDisplayPath = applyTargetPath || task.file || basename;
    const retryPrompt = [
      `你是编程智能体。任务：${task.desc}`,
      ``,
      applyResult.failureDetail ? `上次应用失败：${applyResult.failureDetail}` : '',
      applyResult.blockedChangePaths?.length
        ? `上次检测到的非目标候选文件：${applyResult.blockedChangePaths.join('、')}`
        : '',
      ``,
      `目标文件（必须只输出这个路径）：${retryDisplayPath}`,
      ``,
      `文件 ${retryDisplayPath} 当前内容：`,
      '```' + lang,
      currentContent || '（空文件）',
      '```',
      ``,
      `请输出修改后的完整文件内容，格式如下（不要省略任何行）：`,
      ``,
      `${retryDisplayPath}`,
      '```' + lang,
      `// 完整内容`,
      '```',
    ].filter(Boolean).join('\n');

    let retryRaw = '';
    try {
      const { text: rText, tools: rTools } = await chatViaProvider(retryPrompt, mode, undefined, history, callbacks.signal, false, callbacks.traceRunId, callbacks.traceWorkspaceRoot, callbacks.traceEvidenceParticipantToken, callbacks.onTraceEvidenceError);
      writeAuthority.drainAfterProvider();
      retryRaw = rText;
      recordTaskToolResult(await executeFakeToolsForLoop(rTools, taskToolCallbacks, editorWorkdir, {
        currentTaskIndex: taskIndex,
        taskTotal: allTasks.length,
        deferDoneStatus: true,
        userPrompt: writeAuthority.currentPrompt,
        workspaceRoot: workspaceRoot.fsPath,
        readEvidenceRecorder,
      }));
    } catch { /* retry failed, fall through */ }

    if (retryRaw) {
      if (!(await authorizeFullFileApply())) return fullFileWriteBlocked();
      applyResult = await applyGeneratedArtifactPathWithPrompt(
        retryRaw,
        applyTargetPath,
        retryPrompt,
        async (status) => { await callbacks.onWorkflowStatus(status); },
        true,
        async (change) => { await callbacks.onAppliedChange(change); },
        absFiles,
        {
          validationCommandRunner: callbacks.onValidationCommand,
          ...(callbacks.traceRunId ? { mutationRunId: callbacks.traceRunId } : {}),
          mutationSequence: taskIndex * 2 + 2,
          mutationActionId: `agent-task-${taskIndex + 1}-full-file-retry`,
        },
      );
      taskEvidence.appendVerification(applyResult.verificationReceipt);
      taskEvidence.appendChanges(applyResult.changeReceipts);
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

  const writtenFiles = applied
    ? buildWrittenFileEvidenceForPaths(
      applyResult.changedPaths,
      task.action,
      workspaceRoot.fsPath,
      fullFileDiff,
    )
    : [];

  return withTaskTerminalEvidence({
    applied,
    path: applied ? writtenFiles[0]?.path ?? applyResult.changedPaths[0] : undefined,
    raw,
    linesAdded: fullFileDiff?.added,
    linesRemoved: fullFileDiff?.removed,
    writtenFiles,
    ...(taskCompleteByAI ? { taskComplete: true } : {}),
  }, taskTerminalEvidence);
}

function isNonRecoverableProviderRecoveryRespondTask(task: AgentTask): boolean {
  return task.action === 'respond'
    && task.targetKind === 'agent-session'
    && /(?:无法从可信任务事实恢复|已停止执行)/.test(task.desc || '');
}

function recordLocalAgentResponsePayload(callbacks: AgentLoopCallbacks, response: string): void {
  const traceRunId = callbacks.traceRunId?.trim();
  const traceWorkspaceRoot = callbacks.traceWorkspaceRoot?.trim();
  if (!traceRunId || !traceWorkspaceRoot || !response.trim()) return;
  try {
    createDevSeekTraceLogger({
      workspaceRoot: traceWorkspaceRoot,
      source: 'vscode-extension.agent',
      runId: traceRunId,
      level: 'debug',
    }).payload('provider', 'extension.response.raw', response);
  } catch (error) {
    callbacks.onTraceEvidenceError?.(error);
  }
}

// ----------------------------------------------------------------
// Compile validation helper
// ----------------------------------------------------------------


function getAgentAutoFixRounds(): number {
  const configured = vscode.workspace.getConfiguration('devseek').get<number>('autoFixRounds', 6);
  return normalizeRepairRoundBudget(configured);
}

let legacyValidationOperationSequence = 0;

function nextLegacyValidationOperationId(changedPaths: readonly string[]): string {
  legacyValidationOperationSequence += 1;
  const scope = changedPaths.join('|').replace(/[^0-9A-Za-z._/-]+/g, '-').slice(0, 160) || 'workspace';
  return `legacy-validation-${legacyValidationOperationSequence}-${scope}`.slice(0, 512);
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
  userPrompt = '',
  sessionHistory?: ChatMessage[],
): Promise<ValidationOutcome> {
  // Keep the legacy loop on the same validation authority as the agentic loop
  // for safe local targets. Unknown code types still stay out of scope here.
  const validationTargets = changedPaths.filter(p => isLegacyAutoValidationFile(p));
  if (validationTargets.length === 0) return { ran: false, ok: true, reason: 'no-auto-validation-files' };

  const workspaceRootFsPath = workspaceRoot.fsPath;
  const workspaceRelativeValidationTargets = validationTargets.map(filePath => {
    const absPath = nodePath.isAbsolute(filePath) ? filePath : nodePath.join(workspaceRootFsPath, filePath);
    return nodePath.relative(workspaceRootFsPath, absPath).replace(/\\/g, '/');
  });
  const compileEvidenceOperationId = nextLegacyValidationOperationId(workspaceRelativeValidationTargets);
  const toolExecutionReceipts: NonNullable<ToolLoopResult['toolExecutionReceipts']> = [];
  const finishValidationOutcome = async (
    evidenceOperationId: string,
    outcome: ValidationOutcome,
  ): Promise<ValidationOutcome> => {
    await emitLegacyValidationQualityGateStatus(callbacks, evidenceOperationId, outcome);
    const observationStatus = !outcome.ran
      ? 'unverified'
      : outcome.reviewRequired
        ? 'unverified'
        : outcome.ok
          ? 'passed'
          : 'failed';
    const verification = await legacyVerification.verify({
      runId: callbacks.traceRunId?.trim() || 'vscode-legacy-validation',
      sequence: legacyValidationOperationSequence,
      actionId: evidenceOperationId,
      scopePaths: workspaceRelativeValidationTargets,
      acceptance: [{
        id: 'workspace-validation',
        statement: 'Applicable workspace validation and quality checks pass.',
      }],
      evidenceRefs: [`legacy-verification:${evidenceOperationId}:planned`],
      verifier: 'vscode-legacy-validation',
      observe: async () => ({
        status: observationStatus,
        summary: outcome.detail || outcome.reason || (outcome.ok ? 'Legacy validation passed.' : 'Legacy validation failed.'),
        ...(outcome.command ? { command: outcome.command } : {}),
        ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
        evidenceRefs: uniqueStringValues([
          `legacy-verification:${evidenceOperationId}:${observationStatus}`,
          ...(outcome.toolExecutionReceipts ?? []).flatMap(receipt => receipt.evidenceRefs),
        ]),
      }),
    });
    return {
      ...outcome,
      evidenceOperationId,
      verificationReceipt: verification.receipt,
      ...(toolExecutionReceipts.length > 0 ? { toolExecutionReceipts: [...toolExecutionReceipts] } : {}),
    };
  };
  const hasCppTargets = validationTargets.some(p => isCompilableFile(p));
  const effectiveWantRun = wantRun || (hasCppTargets && shouldRunCppValidation(userPrompt));

  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'validate',
    state: 'started',
    evidenceOperationId: compileEvidenceOperationId,
    title: effectiveWantRun && hasCppTargets ? '正在编译并运行' : '正在执行自动验证',
    detail: `验证 ${validationTargets.length} 个本地变更文件`,
  });

  // ValidationService is the sole compile/QualityGate execution boundary. The
  // interactive run below asks the same VerificationPlanner for its run plan.
  const compileResult = await new ValidationService({
    commandRunner: callbacks.onValidationCommand,
  }).validateWorkspaceChanges({
    changedPaths: workspaceRelativeValidationTargets,
    rootFsPath: workspaceRootFsPath,
    requestPrompt: userPrompt,
    cppValidationPolicy: 'conservative',
    runCpp: false,
  });
  if (!compileResult) {
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: 'failed',
      evidenceOperationId: compileEvidenceOperationId,
      title: '未找到可执行验证计划',
      detail: '未识别到可自动验证的本地变更文件。',
    });
    return finishValidationOutcome(compileEvidenceOperationId, { ran: false, ok: false, reason: 'no-validation-plan' });
  }
  if (compileResult.command) callbacks.onToolActivity?.('terminal', `自动验证: ${compileResult.command}`);

  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'validate',
    state: compileResult.ok ? 'completed' : 'failed',
    evidenceOperationId: compileEvidenceOperationId,
    title: compileResult.ok
      ? '自动验证通过 ✓'
      : compileResult.status === 'blocked' ? '自动验证被质量门禁阻止' : '自动验证失败',
    detail: compileResult.ok
      ? `命令: ${compileResult.command}  exitCode: 0`
      : compileResult.output.slice(0, 400),
  });
  if (!compileResult.ok) {
    return finishValidationOutcome(compileEvidenceOperationId, {
      ran: compileResult.ran,
      ok: false,
      command: compileResult.command,
      detail: compileResult.output.slice(0, 1200),
      exitCode: compileResult.exitCode,
      reason: compileResult.reason || (compileResult.status === 'blocked' ? 'validation-blocked' : 'compile-failed'),
    });
  }

  let runCommandForEvidence: string | undefined;
  if (effectiveWantRun && hasCppTargets && !callbacks.onPrepareTerminalCommand) {
    const detail = '当前入口没有可用终端执行能力，已完成编译，但运行效果需要人工确认。';
    return finishValidationOutcome(compileEvidenceOperationId, {
      ran: true,
      ok: true,
      command: compileResult.command,
      detail,
      reason: 'runtime-validation-unavailable',
      exitCode: 0,
      reviewRequired: true,
      reviewReason: detail,
    });
  }

  // If compilation succeeded and user wants to run — execute in terminal
  if (effectiveWantRun && hasCppTargets && callbacks.onPrepareTerminalCommand) {
    const runEvidenceOperationId = nextLegacyValidationOperationId([...workspaceRelativeValidationTargets, 'run']);
    const runPlan = new VerificationPlanner().planWorkspaceChanges({
      changedPaths: workspaceRelativeValidationTargets,
      rootFsPath: workspaceRootFsPath,
      requestPrompt: userPrompt,
      cppValidationPolicy: 'conservative',
      runCpp: true,
    });
    if (runPlan.kind === 'blocked') {
      const detail = [`运行验证计划被阻止：${runPlan.reason}`, ...runPlan.risks].join('\n');
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'started',
        evidenceOperationId: runEvidenceOperationId,
        title: '正在规划运行验证',
        detail: detail.slice(0, 1200),
      });
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'failed',
        evidenceOperationId: runEvidenceOperationId,
        title: '无法生成运行验证计划',
        detail: detail.slice(0, 1200),
      });
      return finishValidationOutcome(runEvidenceOperationId, { ran: false, ok: false, command: compileResult.command, detail, reason: runPlan.reason });
    }
    const runCmd = runPlan.command;
    runCommandForEvidence = runCmd;
    try {
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'started',
        evidenceOperationId: runEvidenceOperationId,
        title: '正在执行程序',
        detail: `终端运行: ${runCmd}`,
      });
      const toolResult = await executeFakeToolsForLoop(
        [{ name: 'run_terminal', input: { command: runCmd, workdir: runPlan.cwd } }],
        callbacks,
        runPlan.cwd,
        {
          currentTaskIndex: 0,
          taskTotal: 1,
          userPrompt,
          workspaceRoot: workspaceRootFsPath,
          plannedTerminalValidation: { command: runCmd, workdir: runPlan.cwd },
        },
      );
      if (toolResult.toolExecutionReceipts?.length) {
        toolExecutionReceipts.push(...toolResult.toolExecutionReceipts);
      }
      const terminalOutput = toolResult.terminalOutputs?.find(item => item.command === runCmd);
      if (!terminalOutput) {
        const detail = toolResult.toolFailures?.[0]?.reason
          ?? toolResult.feedbackForAI
          ?? '运行验证未产生已结算的终端输出。';
        throw new Error(detail.slice(0, 1200));
      }
      const output = terminalOutput.output;
      const evidence = {
        ran: toolResult.terminalCommands?.includes(runCmd) === true,
        evidence: toolResult.terminalEvidence?.find(item => item.command === runCmd)
          ?? analyzeTerminalEvidence(runCmd, output, runPlan.cwd).evidence,
      };
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
        const manualReview = shouldRequestManualReviewForRun({
          userPrompt,
          command: runCmd,
          output,
          changedPaths,
          terminalEvidence: evidence.evidence,
        });
        if (manualReview) {
          await callbacks.onAgentStatus({
            type: 'agentStatus',
            phase: 'validate',
            state: 'completed',
            evidenceOperationId: runEvidenceOperationId,
            title: '程序已启动，等待人工确认',
            detail: manualReview.detail,
          });
          sessionHistory?.push({
            role: 'assistant',
            content: `运行验证需要人工确认：${manualReview.detail}`,
          });
          return finishValidationOutcome(runEvidenceOperationId, {
            ran: true,
            ok: true,
            command: runCmd,
            detail: manualReview.detail,
            reason: manualReview.reason,
            exitCode: evidence.evidence.exitCode,
            reviewRequired: true,
            reviewReason: manualReview.detail,
          });
        }
        await callbacks.onAgentStatus({
          type: 'agentStatus',
          phase: 'validate',
          state: 'failed',
          evidenceOperationId: runEvidenceOperationId,
          title: '执行失败',
          detail: detail.slice(0, 1200),
        });
        return finishValidationOutcome(runEvidenceOperationId, {
          ran: true,
          ok: false,
          command: runCmd,
          detail,
          exitCode: evidence.evidence.exitCode,
          reason: evidence.evidence.kind === 'compile-run' ? 'compile-run-failed' : 'run-failed',
        });
      }
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'completed',
        evidenceOperationId: runEvidenceOperationId,
        title: '运行验证完成 ✓',
        detail: truncated.slice(0, 400),
      });
    } catch (e) {
      const detail = (e as Error).message;
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'failed',
        evidenceOperationId: runEvidenceOperationId,
        title: '执行失败',
        detail,
      });
      return finishValidationOutcome(runEvidenceOperationId, {
        ran: true,
        ok: false,
        command: runCmd,
        detail,
        exitCode: null,
        reason: 'run-failed',
      });
    }
  }

  return finishValidationOutcome(compileEvidenceOperationId, {
    ran: true,
    ok: true,
    command: runCommandForEvidence ?? compileResult.command,
    exitCode: 0,
    reason: runCommandForEvidence ? 'compile-and-run-passed' : compileResult.reason || 'validation-passed',
  });
}

// ----------------------------------------------------------------
// Main entry: run the full Agent Loop
// ----------------------------------------------------------------

export async function runAgentLoop(
  tasks: AgentTask[],
  userPrompt: string,
  mode: 'fast' | 'r1' | undefined,
  workspaceRoot: vscode.Uri,
  callbacks: ExecutionScopedAgentLoopCallbacks,
  analysisContext?: string,
  startFromIndex = 0,
  semanticContract?: TaskSemanticContract,
): Promise<AgentLoopResult> {
  if (!callbacks.executionMode) {
    throw new Error('agent-loop-boundary: an explicit executionMode/tool policy is required');
  }
  const executionMode = callbacks.executionMode;
  const writeAuthority = createSemanticExecutionWriteAuthority({
    userPrompt,
    callbacks,
    semanticContract,
    workspaceRoots: [workspaceRoot.fsPath],
    relatedPaths: tasks.flatMap(task => [task.absPath, task.file]),
  });
  callbacks = { ...writeAuthority.callbacks, executionMode };
  const policyResult = enforceAgentTaskExecutionPolicy(tasks, {
    mode: callbacks.executionMode,
    userPrompt: writeAuthority.currentPrompt,
  });
  if (policyResult.changed) {
    tasks = policyResult.tasks;
    startFromIndex = 0;
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'plan',
      state: 'completed',
      title: '已按权限模式调整任务计划',
      detail: policyResult.reason,
      taskTotal: tasks.length,
    });
  }

  const changedPaths: string[] = [];
  const editedFileRecords: WrittenFileEvidence[] = [];
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
  const executionEvidence = createAgentLoopExecutionEvidence();
  const allTerminalEvidence = executionEvidence.terminalEvidence;
  const allVerificationReceipts = executionEvidence.verificationReceipts;
  const allToolExecutionReceipts = executionEvidence.toolExecutionReceipts;
  const allChangeReceipts = executionEvidence.changeReceipts;
  const verificationIds: string[] = [];
  const artifactGrounding = new ArtifactGroundingCollector(callbacks, workspaceRoot.fsPath);
  const readEvidenceRecorder = new ToolReadEvidenceRecorder(workspaceRoot.fsPath, callbacks.traceRunId);
  // Each task starts from a clean DeepSeek web conversation. The current task
  // context is carried explicitly through `sessionHistory`, avoiding stale
  // browser-side conversations from previous sessions.
  let needsNewSession = true;
  // Track whether the AI called task_complete (to suppress duplicate phase:done).
  let hadTaskComplete = false;

  for (let i = startFromIndex; i < tasks.length; i++) {
    const task = tasks[i];

    // Reset todo states to ground-truth at the start of each task so any premature
    // "all completed" marking by earlier AI calls doesn't mislead the UI.
    if (callbacks.onTodoUpdate && tasks.length > 1) {
      await callbacks.onTodoUpdate(taskTodoLedger.startTask(i));
    }

    sessionHistory.push(...writeAuthority.takePendingAndDrain());

    const result = await executeTask(
      task,
      i + 1,
      tasks,
      changedPaths,
      writeAuthority,
      mode,
      workspaceRoot,
      callbacks,
      contentCache,
      sessionHistory.length > 0 ? [...sessionHistory] : undefined,
      analysisContext,
      needsNewSession,
      readEvidenceRecorder,
    );
    appendTaskExecutionEvidence(executionEvidence, result);
    const taskGrounding = artifactGrounding.captureTask(writeAuthority.currentPrompt, result);
    needsNewSession = true;

    // ── Network-error detection: save checkpoint and abort loop ──────────
    // If the task failed due to a network error (fetch failed, ECONNREFUSED,
    // AbortError from upstream timeout, etc.) there is no point executing the
    // remaining tasks — they will all fail for the same reason.
    // Save a checkpoint so the user can resume from this task after reconnecting.
    if (result.networkError) {
      const retryIndex = taskTodoLedger.firstUnfinishedTaskIndex() ?? i;
      await callbacks.onTaskCheckpoint?.(retryIndex, tasks.slice(retryIndex), 'paused');
      const providerInterrupted = Boolean(result.failedReason && /^RESPONSE_CORRUPTED:/i.test(result.failedReason));
      const failedReason = `${providerInterrupted ? 'Provider 响应中断' : '网络中断'}，已在第 ${i + 1}/${tasks.length} 个任务暂停。`;
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'done', state: 'failed',
        title: `${providerInterrupted ? 'Provider 响应中断' : '网络中断'}，已在第 ${i + 1}/${tasks.length} 个任务暂停`,
        detail: `已完成 ${tasksApplied} 个任务，剩余 ${tasks.length - i} 个等待续传。${result.failedReason ? `原因：${result.failedReason}` : '重连后可继续。'}`,
        taskTotal: tasks.length,
      });
      return buildAgentLoopResult({
        tasks,
        tasksApplied,
        tasksFailed: tasksFailed + 1,
        changedPaths,
        userPrompt: writeAuthority.currentPrompt,
        todos: taskTodoLedger.snapshot(),
        editedFileRecords,
        terminalEvidence: allTerminalEvidence,
        workspaceRoot: workspaceRoot.fsPath,
        failedReason,
        analysisTexts,
        verificationReceipts: allVerificationReceipts,
        toolExecutionReceipts: allToolExecutionReceipts,
        changeReceipts: allChangeReceipts,
        ...artifactGrounding.resultFields(),
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
      writtenFiles: collectTaskResultWrittenFiles(result, task.action, workspaceRoot.fsPath),
      raw: result.raw,
      taskComplete: result.taskComplete,
      failedReason: result.failedReason,
      terminalEvidence: result.terminalEvidence,
      workspaceRoot: workspaceRoot.fsPath,
      semanticContract: writeAuthority.semanticContract,
      ...taskGrounding,
    };
    const resultWrittenFiles = taskSettlementInput.writtenFiles;
    if (result.applied && resultWrittenFiles.length > 0) {
      appendAgentLoopWrittenFiles(changedPaths, editedFileRecords, resultWrittenFiles, workspaceRoot.fsPath);
      tasksApplied += 1;
      const changedBasenames = summarizeWrittenFileBasenames(resultWrittenFiles);
      sessionHistory.push({
        role: 'assistant',
        content: `已完成任务 ${i + 1}/${tasks.length}：修改 ${changedBasenames}（${task.desc}）`,
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

    const shouldDeferTaskValidationFailure = shouldDeferRecoverableTaskValidationFailure(taskSettlementInput);
    const taskSettlement = taskTodoLedger.settleTask(i, shouldDeferTaskValidationFailure
      ? { ...taskSettlementInput, terminalEvidence: [] }
      : taskSettlementInput);
    if (taskSettlement.failed) {
      tasksFailed += 1;
      await callbacks.onAgentStatus(buildTaskSettlementFailureStatus(task, i + 1, tasks.length, {
        ...taskSettlementInput,
        failedReason: taskSettlement.failedReason || taskSettlementInput.failedReason,
      }));
      if (isReadOnlyAction(task.action)) {
        sessionHistory.push({
          role: 'assistant',
          content: `任务 ${i + 1}/${tasks.length} 验证失败：${getAgentTaskDisplayTarget(task)}（${task.desc}）`,
        });
      }
    } else if (taskSettlement.completed) {
      await callbacks.onAgentStatus(buildTaskSettlementCompletionStatus(
        task,
        i + 1,
        tasks.length,
        taskSettlementInput,
      ));
    }

    if (callbacks.onTodoUpdate && tasks.length > 0) {
      await callbacks.onTodoUpdate(taskSettlement.todos);
    }

    // Only emit responseMeta for generation tasks (modify/create/delete).
    if (result.raw && !isReadOnlyAction(task.action)) {
      await callbacks.onResponseMeta(result.raw);
    }

    // Preserve the earliest failed/unfinished task. A later successful task must
    // never advance the resumable checkpoint past an earlier failure.
    if (i + 1 < tasks.length) {
      const checkpointIndex = taskTodoLedger.firstUnfinishedTaskIndex() ?? (i + 1);
      await callbacks.onTaskCheckpoint?.(checkpointIndex, tasks.slice(checkpointIndex), 'progress');
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

  // Validation must be evidence-backed. Planned task targets may point at old
  // files even when the model artifact was not applied, which would turn stale
  // checks into false completion evidence.
  sessionHistory.push(...writeAuthority.takePendingAndDrain());
  let nonLegacyValidationOutcome: ValidationOutcome | undefined;
  const autoValidationWrittenFiles = editedFileRecords.filter(shouldRunGeneralAutoValidationForFile);
  if (autoValidationWrittenFiles.length > 0) {
    const autoValidation = await runAgentAutoValidationForWrites(
      autoValidationWrittenFiles,
      workspaceRoot.fsPath,
      writeAuthority.currentPrompt,
      callbacks,
      'conservative',
      { qualityWrittenFiles: editedFileRecords },
    );
    if (autoValidation.evidenceOperationId) verificationIds.push(autoValidation.evidenceOperationId);
    appendVerificationReceipt(executionEvidence, autoValidation.verificationReceipt);
    if (autoValidation.evidence) allTerminalEvidence.push(autoValidation.evidence);
    if (autoValidation.feedbackForAI) {
      sessionHistory.push({
        role: 'assistant',
        content: `自动验证反馈：\n${autoValidation.feedbackForAI.slice(0, 2000)}`,
      });
    }
    nonLegacyValidationOutcome = autoValidationResultToValidationOutcome(autoValidation);
  }

  const modifiedPaths = uniquePaths(
    editedFileRecords
      .filter(file => isCompilableFile(file.path))
      .map(file => nodePath.isAbsolute(file.path) ? file.path : nodePath.join(workspaceRoot.fsPath, file.path)),
  );
  let legacyValidationOutcome: ValidationOutcome | undefined;
  if (modifiedPaths.length > 0) {
    // Derive wantRun from both the user's explicit request and task plan.
    // If the user asked to run/execute, validation must include runtime failures
    // such as exitCode=139/Segmentation fault instead of stopping at compile-only.
    const wantRun = tasks.some(
      t => t.action === 'analyze' && /run_terminal|运行程序|执行程序|compile.*run|build.*run/i.test(t.desc)
    ) || requiresRuntimeValidation(
      writeAuthority.currentPrompt,
      writeAuthority.semanticContract,
    );
    legacyValidationOutcome = await runValidation(modifiedPaths, workspaceRoot, callbacks, wantRun, writeAuthority.currentPrompt, sessionHistory);
    if (legacyValidationOutcome.evidenceOperationId) verificationIds.push(legacyValidationOutcome.evidenceOperationId);
    appendVerificationReceipt(executionEvidence, legacyValidationOutcome.verificationReceipt);
    if (legacyValidationOutcome.toolExecutionReceipts?.length) {
      allToolExecutionReceipts.push(...legacyValidationOutcome.toolExecutionReceipts);
    }
    appendValidationEvidence(allTerminalEvidence, legacyValidationOutcome);

    const maxRepairRounds = getAgentAutoFixRounds();
    for (let repairRound = 1;
      legacyValidationOutcome && !legacyValidationOutcome.ok && repairRound <= maxRepairRounds && !callbacks.signal?.aborted;
      repairRound += 1) {
      sessionHistory.push(...writeAuthority.takePendingAndDrain());
      const repairTarget = selectValidationRepairTarget(legacyValidationOutcome, modifiedPaths);
      if (!repairTarget) break;

      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'repair',
        state: 'started',
        title: `第 ${repairRound} 轮自动修复验证失败`,
        detail: `命令: ${legacyValidationOutcome.command ?? 'unknown'}\n${(legacyValidationOutcome.detail ?? '').slice(0, 1200)}`,
        taskTotal: tasks.length,
      });

      if (callbacks.onTodoUpdate && tasks.length > 0) {
        await callbacks.onTodoUpdate(taskTodoLedger.repairSnapshot(
          `修复验证失败：${nodePath.basename(repairTarget)}`,
          tasks.length + repairRound,
        ));
      }

      const repairTask = makeValidationRepairTask(repairTarget, workspaceRoot, legacyValidationOutcome, repairRound);
      const repairContext = buildValidationRepairContext(
        analysisContext,
        legacyValidationOutcome,
        repairRound,
        maxRepairRounds,
        modifiedPaths,
      );
      const repairResult = await executeTask(
        repairTask,
        1,
        [repairTask],
        changedPaths,
        writeAuthority,
        mode,
        workspaceRoot,
        callbacks,
        contentCache,
        sessionHistory.length > 0 ? [...sessionHistory] : undefined,
        repairContext,
        true,
        readEvidenceRecorder,
      );
      appendTaskExecutionEvidence(executionEvidence, repairResult);
      artifactGrounding.captureTask(writeAuthority.currentPrompt, repairResult);

      if (repairResult.networkError) {
        const retryIndex = taskTodoLedger.firstUnfinishedTaskIndex() ?? tasks.length;
        await callbacks.onTaskCheckpoint?.(retryIndex, tasks.slice(retryIndex), 'paused');
        const providerInterrupted = Boolean(repairResult.failedReason && /^RESPONSE_CORRUPTED:/i.test(repairResult.failedReason));
        const failedReason = `${providerInterrupted ? 'Provider 响应中断' : '网络中断'}，验证修复第 ${repairRound} 轮暂停。`;
        await callbacks.onAgentStatus({
          type: 'agentStatus',
          phase: 'done',
          state: 'failed',
          title: `${providerInterrupted ? 'Provider 响应中断' : '网络中断'}，验证修复第 ${repairRound} 轮暂停`,
          detail: repairResult.failedReason || '修复任务已暂停，重连后可重新发起验证。',
          taskTotal: tasks.length,
        });
        return buildAgentLoopResult({
          tasks,
          tasksApplied,
          tasksFailed: tasksFailed + 1,
          changedPaths,
          userPrompt: writeAuthority.currentPrompt,
          todos: taskTodoLedger.snapshot(),
          editedFileRecords,
          terminalEvidence: allTerminalEvidence,
          workspaceRoot: workspaceRoot.fsPath,
          failedReason,
          verificationIds: uniqueStringValues(verificationIds),
          analysisTexts,
          verificationReceipts: allVerificationReceipts,
          toolExecutionReceipts: allToolExecutionReceipts,
          changeReceipts: allChangeReceipts,
          ...artifactGrounding.resultFields(),
        });
      }

      if (repairResult.raw) {
        await callbacks.onResponseMeta(repairResult.raw);
      }

      const repairWrittenFiles = collectTaskResultWrittenFiles(repairResult, repairTask.action, workspaceRoot.fsPath);
      if (repairResult.applied && repairWrittenFiles.length > 0) {
        appendAgentLoopWrittenFiles(changedPaths, editedFileRecords, repairWrittenFiles, workspaceRoot.fsPath);
        tasksApplied += 1;
        sessionHistory.push({
          role: 'assistant',
          content: `第 ${repairRound} 轮自动修复已修改 ${summarizeWrittenFileBasenames(repairWrittenFiles)}，准备重新验证。`,
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

      sessionHistory.push(...writeAuthority.takePendingAndDrain());
      legacyValidationOutcome = await runValidation(modifiedPaths, workspaceRoot, callbacks, wantRun, writeAuthority.currentPrompt, sessionHistory);
      if (legacyValidationOutcome.evidenceOperationId) verificationIds.push(legacyValidationOutcome.evidenceOperationId);
      appendVerificationReceipt(executionEvidence, legacyValidationOutcome.verificationReceipt);
      if (legacyValidationOutcome.toolExecutionReceipts?.length) {
        allToolExecutionReceipts.push(...legacyValidationOutcome.toolExecutionReceipts);
      }
      appendValidationEvidence(allTerminalEvidence, legacyValidationOutcome);
    }
  }
  const validationOutcome = combineFinalValidationOutcomes(nonLegacyValidationOutcome, legacyValidationOutcome);
  const validationFailed = validationOutcome ? !validationOutcome.ok : false;
  const manualReviewTerminal = findLatestManualReviewTerminalEvidence(allTerminalEvidence);
  const manualReviewReason = validationOutcome?.reviewRequired
    ? (validationOutcome.reviewReason || validationOutcome.detail || '需要人工确认运行效果。')
    : manualReviewTerminal
      ? (manualReviewTerminal.detail || '需要人工确认运行效果。')
      : undefined;
  if (!validationFailed && tasksFailed > 0) {
    const reconciled = taskTodoLedger.reconcileFinalEvidence({
      validationFailed,
      writtenFiles: editedFileRecords,
      terminalEvidence: allTerminalEvidence,
      workspaceRoot: workspaceRoot.fsPath,
    });
    if (reconciled.clearedFailures > 0) {
      tasksFailed = Math.max(0, tasksFailed - reconciled.clearedFailures);
      if (callbacks.onTodoUpdate && tasks.length > 0) {
        await callbacks.onTodoUpdate(reconciled.todos);
      }
    }
  }
  if (validationFailed && callbacks.onTodoUpdate && tasks.length > 0) {
    await callbacks.onTodoUpdate(taskTodoLedger.markValidationFailure());
  }

  void hadTaskComplete;
  const finalFailed = tasksFailed + (validationFailed ? 1 : 0);
  if (finalFailed === 0) {
    await callbacks.onTaskCheckpoint?.(null, [], 'completed');
  } else {
    const retryIndex = taskTodoLedger.firstUnfinishedTaskIndex()
      ?? Math.max(0, tasks.length - 1);
    await callbacks.onTaskCheckpoint?.(retryIndex, tasks.slice(retryIndex), 'paused');
  }
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: finalFailed === 0 ? 'completed' : 'failed',
    title: finalFailed === 0
      ? manualReviewReason
        ? `全部 ${tasks.length} 个任务已执行，等待人工确认`
        : `全部 ${tasks.length} 个任务已完成`
      : validationFailed
        ? `完成 ${tasksApplied}，验证失败`
        : `完成 ${tasksApplied}，失败 ${tasksFailed}`,
    detail: changedPaths.length > 0
      ? `已写入：${changedPaths.join('、')}${validationFailed ? `\n验证失败：${validationOutcome?.reason || 'validation-failed'}${validationOutcome?.detail ? `\n${validationOutcome.detail.slice(0, 400)}` : ''}` : ''}${manualReviewReason ? `\n待人工确认：${manualReviewReason.slice(0, 400)}` : ''}`
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
    userPrompt: writeAuthority.currentPrompt,
    todos: taskTodoLedger.snapshot(),
    editedFileRecords,
    terminalEvidence: allTerminalEvidence,
    workspaceRoot: workspaceRoot.fsPath,
    failedReason: historyFailedReason,
    verificationIds: uniqueStringValues(verificationIds),
    summary: finalFailed === 0
      ? manualReviewReason
        ? `全部 ${tasks.length} 个任务已执行，运行效果等待人工确认。`
        : `全部 ${tasks.length} 个任务已完成。`
      : undefined,
    manualReviewReason,
    analysisTexts,
    verificationReceipts: allVerificationReceipts,
    toolExecutionReceipts: allToolExecutionReceipts,
    changeReceipts: allChangeReceipts,
    ...artifactGrounding.resultFields(),
  });
}

function appendValidationEvidence(target: TerminalEvidence[], validation: ValidationOutcome | undefined): void {
  if (!validation?.ran || !validation.command) return;
  target.push({
    command: validation.command,
    kind: classifyTerminalEvidenceCommand(validation.command),
    ok: validation.ok,
    exitCode: validation.exitCode ?? (validation.ok ? 0 : null),
    detail: validation.detail,
    ...(validation.reviewRequired ? { reviewRequired: true } : {}),
  });
}

function classifyTaskTerminalManualReview(
  failure: TerminalEvidence,
  evidence: TerminalEvidence[],
  userPrompt: string,
  changedPaths: string[],
): { detail: string; evidence: TerminalEvidence[] } | undefined {
  const review = shouldRequestManualReviewForRun({
    userPrompt,
    command: failure.command,
    output: failure.detail || '',
    changedPaths,
    terminalEvidence: failure,
  });
  if (!review) return undefined;
  return {
    detail: review.detail,
    evidence: evidence.map(item => item === failure
      ? {
        ...item,
        ok: true,
        reviewRequired: true,
        detail: review.detail,
      }
      : item),
  };
}

function findLatestManualReviewTerminalEvidence(evidence: TerminalEvidence[] | undefined): TerminalEvidence | undefined {
  const latest = evidence?.[evidence.length - 1];
  return latest?.reviewRequired ? latest : undefined;
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
