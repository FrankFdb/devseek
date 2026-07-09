/**
 * Agentic free-explore loop.
 *
 * This module owns the Claude Code/Codex-style ReAct loop used when there are
 * no explicit code attachments. Keeping it out of agent-loop.ts prevents the
 * two-phase Architect+Editor pipeline from sharing stateful tool-loop concerns.
 */

import * as vscode from 'vscode';
import { getActiveProvider } from '../llm/provider-router';
import { type ChatMessage } from '../llm/types';
import { getProjectRulesSync, wrapRulesAsContext, getProjectMemorySync, wrapMemoryAsContext } from '../project-rules';
import { type McpToolRef } from '../mcp/client';
import type { ExecutionMode } from '../intent/intent-types';
import type { CppValidationPolicy } from '../validation-planner';
import {
  buildTerminalFailureRepairFeedback,
  coalesceWrittenFileEvidence,
  describeBlockingTerminalFailure,
  findBlockingTerminalFailureEvidence,
  getBlockingTerminalFailure,
  getMissingCompletionEvidence,
  getUnsupportedSummaryFileClaims,
  isExplicitlyReadOnlyRequest,
  requiresCommandEvidence,
  requiresFileChangeEvidence,
  requiresReadEvidence,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import {
  buildAgenticHistoryText,
  buildAgenticQualityGateForHistory,
  type AgenticHistoryQualityGate,
} from './agentic-history';
import { runAgentAutoValidationForWrites, type AgentAutoValidationResult } from './auto-validation';
import {
  buildMissingEvidenceRecoveryInstruction,
  type TodoItem,
} from './evidence-recovery';
import {
  buildDanglingAgentActionFeedback,
  hasDanglingAgentActionIntent,
} from './no-tool-intent';
import {
  containsFakeToolCallProtocol,
  findFirstToolCallStart,
  parseFakeToolCalls,
  stripToolCallBlocks,
} from './fake-tool-parser';
import { isLiteralToolProtocolPrompt } from './agent-run-display';
import {
  agentAnnouncementKey,
  cleanAgentFinalSummaryForUser,
  normalizeAgentUserAnnouncement,
} from './agentic-summary';
import {
  getTerminalRecoveryProtocol,
  makeTerminalCmdSignature,
} from './write-guard';
import {
  buildTaskTerminalFailureDetail,
  withTaskTerminalEvidence,
} from './task-execution-result';
import { shouldRequestManualReviewForRun } from './manual-review-validation';
import type { AgentLoopCallbacks, AgentLoopResult } from './loop-types';
import type { EvidenceRef } from './tool-executor';
import { chatWithMessages, consumeUserSteerMessages } from './loop-chat';
import {
  analyzeTerminalEvidence,
  applyMarkdownFileArtifactsForLoop,
  describeAgentToolActivity,
  executeFakeToolsForLoop,
  isAgentWorkToolName,
  normalizeVisibleTodos,
} from './tool-loop';
import {
  buildTaskSettlementFailureStatus,
  completeAgentTodos,
  createAgentTaskTodoLedger,
  inferInitialAgenticTodos,
  settleMissingEvidenceTodos,
  settleValidationFailureTodos,
} from './task-state-machine';
import { tryRunSimpleFileTask } from './simple-file-task';
import { buildEngineeringGuidelinesPrompt } from './engineering-guidelines';
import {
  runtimeStateCanDeliver,
  settleAgentRuntimeState,
} from './agent-runtime-state-machine';
import { describeProviderOutputIntegrity } from './provider-output-integrity';

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

function classifyAgenticManualReviewEvidence(input: {
  evidence: TerminalEvidence[] | undefined;
  feedbackForAI: string;
  userPrompt: string;
  writtenFiles: WrittenFileEvidence[];
}): TerminalEvidence[] {
  if (!input.evidence?.length) return [];
  const changedPaths = input.writtenFiles.map(file => file.path).filter(Boolean);
  return input.evidence.map((evidence) => {
    if (evidence.reviewRequired) return evidence;
    if (evidence.ok) return evidence;
    const review = shouldRequestManualReviewForRun({
      userPrompt: input.userPrompt,
      command: evidence.command,
      output: input.feedbackForAI || evidence.detail || '',
      changedPaths,
      terminalEvidence: evidence,
    });
    return review
      ? {
        ...evidence,
        ok: true,
        reviewRequired: true,
        detail: review.detail,
      }
      : evidence;
  });
}

function normalizeAgenticAutoValidation(input: {
  autoValidation: AgentAutoValidationResult;
  userPrompt: string;
  writtenFiles: WrittenFileEvidence[];
}): {
  evidence: TerminalEvidence[];
  feedbackForAI: string;
  qualityGate?: AgenticHistoryQualityGate;
  manualReviewEvidence?: TerminalEvidence;
} {
  const evidence = classifyAgenticManualReviewEvidence({
    evidence: input.autoValidation.evidence ? [input.autoValidation.evidence] : [],
    feedbackForAI: input.autoValidation.feedbackForAI || '',
    userPrompt: input.userPrompt,
    writtenFiles: input.writtenFiles,
  });
  const manualReviewEvidence = evidence.find(item => item.reviewRequired);
  if (manualReviewEvidence) {
    return {
      evidence,
      feedbackForAI: `【系统反馈】运行验证需要人工确认：${manualReviewEvidence.detail || '图形或交互式程序已启动，需人工确认窗口和交互效果。'}`,
      manualReviewEvidence,
    };
  }
  return {
    evidence,
    feedbackForAI: input.autoValidation.feedbackForAI ?? '',
    qualityGate: input.autoValidation.qualityGate,
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
${buildEngineeringGuidelinesPrompt('agent')}

【可用工具】

读取文件（代码文件、日志文件、配置文件，支持绝对路径；大文件可用 startLine/endLine 继续读取）：
[TOOL:read_file {"path":"/absolute/path/to/file"}]
[TOOL:read_file {"path":"/absolute/path/to/file","startLine":300,"endLine":520}]

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
- AGENTS.md、CLAUDE.md、.devseek/rules.md、.github/copilot-instructions.md 是项目指令文件，不是普通源码文件；除非用户明确要求修改指令，否则不要把源码实现写入或引用为源码事实
- 用户指定“code 目录/code目录”时，必须把源码写到 ${workspaceRoot}/code/ 下；不要只描述创建，也不要把文件写到扩展目录或临时目录
- 你已经拥有 run_terminal/read_file/create_file 等工具；禁止声称“无法执行命令/无法访问文件/只是对话模式”。需要执行时必须调用 run_terminal，并以真实退出码和输出作为证据
- 如果 run_terminal 被禁止、未执行、超时或没有真实 exitCode，必须报告“未完成验证/需要用户允许终端后重试”，不能声称编译、运行或测试通过
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
  memoryRelatedPaths: readonly string[] = [],
): Promise<AgentLoopResult> {
  const rules  = getProjectRulesSync();
  const memory = getProjectMemorySync({
    prompt: userPrompt,
    relatedPaths: [...new Set([...dataFiles, ...memoryRelatedPaths].filter(Boolean))],
  });

  const systemPrompt = buildAgenticSystemPrompt(
    workspaceRoot,
    dataFiles,
    callbacks.mcpToolRefs,
    rules ?? undefined,
    memory ?? undefined,
    workflowMode,
  );

  const promptIsReadOnly = isExplicitlyReadOnlyRequest(userPrompt);
  const literalToolProtocolPrompt = isLiteralToolProtocolPrompt(userPrompt);
  const promptRequiresTools = !literalToolProtocolPrompt && (
    requiresReadEvidence(userPrompt)
    || requiresFileChangeEvidence(userPrompt)
    || requiresCommandEvidence(userPrompt)
    || (!promptIsReadOnly && /(?:创建|新建|修改|生成|修复|添加|删除|更新|改造|重构|看(?:一下)?(?:运行|执行)?结果|看到(?:运行|执行)?结果|输出效果|效果|create|write|modify|fix|implement)/i.test(userPrompt))
  );
  const cppValidationPolicy = vscode.workspace
    .getConfiguration('devseek')
    .get<CppValidationPolicy>('cppValidationPolicy', 'conservative');
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
  const allEvidenceRefs: EvidenceRef[] = [];
  let latestAutoQualityGate: AgenticHistoryQualityGate | undefined;
  let currentTodos: TodoItem[] = [];
  let lastMissingEvidence: string[] = [];
  let lastSummaryFactFailures: string[] = [];
  let lastProviderText = '';
  let lastRoundToolRequestCount = 0;
  let executedToolRoundCount = 0;
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
  const initialDisplayAction = callbacks.runDisplayAction || 'explore';
  const initialDisplayTarget = callbacks.runDisplayTarget || '';
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    taskId: 'agentic',
    taskFile: initialDisplayTarget,
    taskAction: initialDisplayAction,
    taskIndex: 1,
    taskTotal: 1,
    state: 'started',
    title: initialDisplayTarget || _agentLabel,
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

  const simpleFileResult = await tryRunSimpleFileTask({
    userPrompt,
    workspaceRoot,
    callbacks,
    cppValidationPolicy,
  });
  if (simpleFileResult) return simpleFileResult;

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
      if (callbacks.onToolActivity && sAccum.length > sLastEarlyToolCheck + 100 && containsFakeToolCallProtocol(sAccum)) {
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
      callbacks.traceRunId,
      callbacks.traceWorkspaceRoot,
    );

    messages.push({ role: 'assistant', content: text });
    lastProviderText = text;
    totalChars += text.length;

    const firstToolIndex = findFirstToolCallStart(text);
    const preToolProse = firstToolIndex >= 0 ? stripToolCallBlocks(text.slice(0, firstToolIndex)).trim() : '';
    const userAnnouncement = normalizeAgentUserAnnouncement(preToolProse);
    const userAnnouncementKey = agentAnnouncementKey(userAnnouncement);
    lastRoundToolRequestCount = tools.length;

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
        const normalizedAutoValidation = normalizeAgenticAutoValidation({
          autoValidation,
          userPrompt,
          writtenFiles: allWrittenFiles,
        });
        if (normalizedAutoValidation.qualityGate) latestAutoQualityGate = normalizedAutoValidation.qualityGate;
        if (normalizedAutoValidation.evidence.length) allTerminalEvidence.push(...normalizedAutoValidation.evidence);
        if (autoValidation.repairBlockedReason) {
          if (callbacks.onTodoUpdate && currentTodos.length > 0) {
            currentTodos = settleValidationFailureTodos(currentTodos);
            await callbacks.onTodoUpdate(currentTodos);
          }
          failedReason = autoValidation.repairBlockedReason;
          break;
        }
        const validationFeedback = normalizedAutoValidation.feedbackForAI ? `\n\n${normalizedAutoValidation.feedbackForAI}` : '';
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
      if (!callbacks.signal?.aborted && promptRequiresTools && sawWorkTool && hasDanglingAgentActionIntent(stripped) && noToolRounds < 4) {
        noToolRounds++;
        const retryMessage = buildDanglingAgentActionFeedback();
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

    const roundHasWorkTools = tools.some(t => isAgentWorkToolName(t.name));

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

    if (loopRes.workToolCallsMade || artifactApply.writtenFiles.length > 0) {
      sawWorkTool = true;
      noToolRounds = 0;
    }
    if (loopRes.toolCallsMade) {
      executedToolRoundCount++;
    }

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
      allTerminalEvidence.push(...classifyAgenticManualReviewEvidence({
        evidence: loopRes.terminalEvidence,
        feedbackForAI: loopRes.feedbackForAI,
        userPrompt,
        writtenFiles: allWrittenFiles,
      }));
    }
    if (loopRes.evidenceRefs?.length) {
      allEvidenceRefs.push(...loopRes.evidenceRefs);
    }
    const autoValidation = await runAgentAutoValidationForWrites(
      allWrittenFiles.slice(autoValidatedWriteCount),
      workspaceRoot,
      userPrompt,
      callbacks,
      cppValidationPolicy,
    );
    autoValidatedWriteCount = allWrittenFiles.length;
    const normalizedAutoValidation = normalizeAgenticAutoValidation({
      autoValidation,
      userPrompt,
      writtenFiles: allWrittenFiles,
    });
    if (normalizedAutoValidation.qualityGate) latestAutoQualityGate = normalizedAutoValidation.qualityGate;
    if (normalizedAutoValidation.evidence.length) {
      allTerminalEvidence.push(...normalizedAutoValidation.evidence);
    }
    if (autoValidation.repairBlockedReason) {
      if (callbacks.onTodoUpdate && currentTodos.length > 0) {
        currentTodos = settleValidationFailureTodos(currentTodos);
        await callbacks.onTodoUpdate(currentTodos);
      }
      failedReason = autoValidation.repairBlockedReason;
      break;
    }
    const autoValidationFeedback = normalizedAutoValidation.feedbackForAI ?? '';

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
    const blockingFailureAfterTools = promptRequiresTools
      ? getBlockingTerminalFailure(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence)
      : undefined;
    const roundSummaryForFactCheck = loopRes.completeSummary !== undefined
      ? loopRes.completeSummary ?? ''
      : cleanAgentFinalSummaryForUser(stripToolCallBlocks(text));
    const summaryFactFailuresAfterTools = roundSummaryForFactCheck
      ? getUnsupportedSummaryFileClaims(roundSummaryForFactCheck, allWrittenFiles, workspaceRoot)
      : [];
    lastMissingEvidence = missingAfterTools;
    lastSummaryFactFailures = summaryFactFailuresAfterTools;
    if (summaryFactFailuresAfterTools.length > 0) {
      loopWarnings.push(`【系统反馈】完成文字缺少文件事实证据：${summaryFactFailuresAfterTools.join('、')}。请核对磁盘并补齐真实文件，或修正完成摘要。`);
    }

    if (!callbacks.signal?.aborted
      && promptRequiresTools
      && sawWorkTool
      && missingAfterTools.length === 0
      && !blockingFailureAfterTools
      && summaryFactFailuresAfterTools.length === 0) {
      if (loopRes.completeSummary !== undefined) {
        completeSummary = loopRes.completeSummary ?? '';
      }
      break;
    }

    if ((loopRes.taskComplete || loopRes.allTodosCompleted)
      && (missingAfterTools.length > 0 || blockingFailureAfterTools || summaryFactFailuresAfterTools.length > 0)
      && !callbacks.signal?.aborted) {
      noToolRounds++;
      if (callbacks.onTodoUpdate && currentTodos.length > 0) {
        currentTodos = blockingFailureAfterTools
          ? settleValidationFailureTodos(currentTodos)
          : settleMissingEvidenceTodos(currentTodos, missingAfterTools);
        await callbacks.onTodoUpdate(currentTodos);
      }
      const retryMessage = blockingFailureAfterTools
        ? `${buildTerminalFailureRepairFeedback(blockingFailureAfterTools, missingAfterTools)}${autoValidationFeedback ? `\n\n${autoValidationFeedback}` : ''}`
        : summaryFactFailuresAfterTools.length > 0
          ? `【系统反馈】不能结束任务。完成摘要声称创建或修改了这些文件，但工作区没有对应写入/存在证据：${summaryFactFailuresAfterTools.join('、')}。请先用 list_dir/read_file 核对，再用 create_file/write_file 补齐或修正摘要；summary 必须只基于真实工具结果。${autoValidationFeedback ? `\n\n${autoValidationFeedback}` : ''}`
        : `【系统反馈】不能结束任务。当前仍缺少可验证的${missingAfterTools.join('、')}。请继续调用实际工具完成缺失项：需要读取时用 read_file/list_dir/只读 run_terminal；需要代码时用 create_file/write_file 写入源码；需要验证时用合适的验证命令，文档/配置只需文件存在和内容证据，代码才需要编译/运行/测试。完成后再调用 task_complete，summary 必须只基于真实工具结果。${autoValidationFeedback ? `\n\n${autoValidationFeedback}` : ''}`;
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
    if (loopRes.allTodosCompleted && (!promptRequiresTools || (sawWorkTool && !blockingFailureAfterTools))) {
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
      const blockingFailureNow = promptRequiresTools
        ? getBlockingTerminalFailure(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence)
        : undefined;
      if (blockingFailureNow && noToolRounds < 2 && !callbacks.signal?.aborted) {
        noToolRounds++;
        const retryMessage = buildTerminalFailureRepairFeedback(blockingFailureNow, missingNow);
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
  const finalBlockingFailure = promptRequiresTools
    ? getBlockingTerminalFailure(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence)
    : undefined;
  const finalSummaryFactFailures = completeSummary
    ? getUnsupportedSummaryFileClaims(completeSummary, allWrittenFiles, workspaceRoot)
    : lastSummaryFactFailures;
  const runtimeTaskAction = workflowMode === 'inspect' || workflowMode === 'plan' ? 'analyze' : 'edit';
  const finalRuntimeSettlement = settleAgentRuntimeState({
    taskAction: runtimeTaskAction,
    taskTitle: userPrompt,
    providerText: completeSummary || lastProviderText,
    roundText: lastProviderText,
    toolRequests: lastRoundToolRequestCount,
    toolExecutions: executedToolRoundCount,
    evidenceRefs: allEvidenceRefs,
    readEvidenceCount: allReadEvidencePaths.size,
    writtenEvidenceCount: allWrittenFiles.length,
    terminalEvidenceCount: allTerminalEvidence.length,
    taskComplete: hadTaskComplete,
    allTodosCompleted: currentTodos.length > 0 && currentTodos.every(todo => todo.status === 'completed'),
    failedReason: failedReason || undefined,
  });
  if (!failedReason && finalRuntimeSettlement.state === 'failed') {
    failedReason = finalRuntimeSettlement.failedReason || describeProviderOutputIntegrity(finalRuntimeSettlement.providerOutput.kind);
  } else if (!failedReason
    && finalRuntimeSettlement.state === 'tool_requested'
    && finalRuntimeSettlement.providerOutput.toolCallCount > 0) {
    failedReason = 'Provider 返回了工具调用，但本轮没有执行到任何工具；任务未完成。';
  } else if (!failedReason
    && runtimeTaskAction === 'analyze'
    && !runtimeStateCanDeliver(finalRuntimeSettlement)) {
    failedReason = describeProviderOutputIntegrity(finalRuntimeSettlement.providerOutput.kind);
  }
  if (!failedReason && finalBlockingFailure) {
    failedReason = describeBlockingTerminalFailure(finalBlockingFailure);
    if (callbacks.onTodoUpdate && currentTodos.length > 0) {
      currentTodos = settleValidationFailureTodos(currentTodos);
      await callbacks.onTodoUpdate(currentTodos);
    }
  } else if (!failedReason && finalMissingEvidence.length > 0) {
    failedReason = `实际执行证据不足：缺少${finalMissingEvidence.join('、')}。`;
    if (callbacks.onTodoUpdate && currentTodos.length > 0) {
      currentTodos = settleMissingEvidenceTodos(currentTodos, finalMissingEvidence);
      await callbacks.onTodoUpdate(currentTodos);
    }
  } else if (!failedReason && lastMissingEvidence.length > 0) {
    failedReason = `实际执行证据不足：缺少${lastMissingEvidence.join('、')}。`;
  } else if (!failedReason && finalSummaryFactFailures.length > 0) {
    failedReason = `完成摘要缺少文件事实证据：${finalSummaryFactFailures.join('、')}。`;
  }
  if (!failedReason && !callbacks.signal?.aborted && callbacks.onTodoUpdate && currentTodos.length > 0) {
    currentTodos = completeAgentTodos(currentTodos);
    await callbacks.onTodoUpdate(currentTodos);
  }

  // Emit done phase from runAgenticLoop itself so editedFiles includes files
  // accumulated across all rounds and task_complete cannot race endResponse.
  // Use 'failed' state when aborted cleanly (signal fired between iterations rather than
  // during an LLM call) so the Working box shows ✗ instead of misleading green ✓.
  const cleanAbort = callbacks.signal?.aborted ?? false;
  const visibleCompleteSummary = cleanAgentFinalSummaryForUser(completeSummary);
  const finalWrittenFiles = coalesceWrittenFileEvidence(allWrittenFiles, workspaceRoot);
  const manualReviewTerminal = [...allTerminalEvidence].reverse().find(e => e.reviewRequired);
  const manualReviewReason = manualReviewTerminal?.detail || (manualReviewTerminal ? '运行效果需要人工确认。' : undefined);
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: cleanAbort || failedReason ? 'failed' : 'completed',
    title: cleanAbort ? `已中断（${roundCount} 轮）`
      : failedReason
        ? failedReason
        : manualReviewReason
          ? `已执行，等待人工确认（${roundCount} 轮）`
          : (visibleCompleteSummary || `完成（${roundCount} 轮）`),
    ...(manualReviewReason ? { detail: manualReviewReason } : {}),
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
      : manualReviewReason
        ? `任务已执行，运行效果需要人工确认：${manualReviewReason}`
      : (visibleCompleteSummary || fileSummary || '任务已完成。');
    callbacks.onDelta('\x00ASUM\x00' + finalMsg);
  }

  await callbacks.onTaskCheckpoint?.(null, [], 'completed');

  const derivedQualityGate = buildAgenticQualityGateForHistory({
    failedReason: cleanAbort ? '用户中断。' : failedReason,
    writtenFiles: finalWrittenFiles,
    terminalEvidence: allTerminalEvidence,
  });
  const historyQualityGate = derivedQualityGate?.status === 'fail'
    ? derivedQualityGate
    : manualReviewReason
      ? derivedQualityGate ?? latestAutoQualityGate
      : latestAutoQualityGate ?? derivedQualityGate;

  const historyText = buildAgenticHistoryText({
    userPrompt,
    roundCount,
    completed: !(cleanAbort || failedReason),
    failedReason: cleanAbort ? '用户中断。' : failedReason,
    summary: visibleCompleteSummary,
    todos: currentTodos,
    writtenFiles: finalWrittenFiles,
    terminalEvidence: allTerminalEvidence,
    qualityGate: historyQualityGate,
    workspaceRoot,
  });

  return {
    tasksTotal: 1,
    tasksApplied: finalWrittenFiles.length > 0 ? 1 : 0,
    tasksFailed: cleanAbort || failedReason ? 1 : 0,
    changedPaths: [...new Set(finalWrittenFiles.map(f => f.path))],
    ...(manualReviewReason ? {
      manualReviewRequired: true,
      manualReviewReason,
    } : {}),
    historyText,
  };
}
