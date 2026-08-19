/**
 * Canonical agentic loop.
 *
 * This module owns the Claude Code/Codex-style ReAct loop used for every new
 * task. Attached files contribute context; they never select another executor.
 */

import * as vscode from 'vscode';
import type {
  CodingToolCall,
  CodingToolExecutionReceipt,
  CodingVerificationReceipt,
  CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import { type ChatMessage } from '../llm/types';
import { bindProviderNormalizationBoundary } from '../llm/provider-events';
import type { ExecutionMode } from '../intent/intent-types';
import { routeTaskSemanticContract } from '../task-intent-router';
import type { TaskSemanticContract } from '../task-semantic-contract';
import {
  hasUnsafeSecretHarvestingRefusalEvidence,
} from '../intent/safety-intent';
import {
  buildTerminalFailureRepairFeedback,
  describeBlockingTerminalFailure,
  getUnsupportedSummaryFileClaims,
  requiresCommandEvidence,
  requiresFileChangeEvidence,
  requiresReadEvidence,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { AgenticHistoryQualityGate } from './agentic-history';
import { runAgentAutoValidationForWrites } from './auto-validation';
import { normalizeAgenticAutoValidation } from './agentic-auto-validation-settlement';
import { buildMissingEvidenceRecoveryInstruction, type TodoItem } from './evidence-recovery';
import {
  buildDanglingAgentActionFeedback,
  hasDanglingAgentActionIntent,
} from './no-tool-intent';
import {
  containsFakeToolCallProtocol,
  findFirstToolCallStart,
  hasIncompleteFakeToolCallProtocol,
  parseFakeToolCalls,
  stripToolCallBlocks,
} from './fake-tool-parser';
import { recoverRequirementReviewNoToolCompletion } from './provider-authored-transcript-recovery';
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
import type { AgentLoopCallbacks, AgentLoopResult } from './loop-types';
import { copyAgentLoopCallbacks } from './loop-callbacks';
import type { AgentRecoveryReason } from './events';
import type { EvidenceRef } from './tool-executor';
import { chatWithMessages } from './loop-chat';
import { hasWriteRevokedToolAttempt } from './write-authority';
import {
  extractPlanningTodoItems,
  shouldAdoptPlanningTodoItems,
} from './agentic-planning';
import { projectTaskContractAcceptance } from './task-contract-acceptance';
import {
  assessAgenticEvidenceClosure,
  describeAgenticDeniedToolExecution,
  getAgenticBlockingDeniedToolExecution,
} from './agentic-execution-evidence';
import { ProviderWaitFeedback } from './provider-wait-feedback';
import {
  analyzeTerminalEvidence,
  describeAgentToolActivity,
  executeFakeToolsForLoop,
  isAgentWorkToolName,
  normalizeVisibleTodos,
  type ToolSuppressionEvidence,
} from './tool-loop';
import {
  isFileMutationToolName,
  projectMarkdownFileArtifactToolsForLoop,
  shouldProjectMarkdownFileArtifacts,
} from './markdown-artifact-tool-projector';
import {
  buildTaskSettlementFailureStatus,
  completeAgentTodos,
  createAgentTaskTodoLedger,
  inferInitialAgenticTodos,
  settleMissingEvidenceTodos,
  settleValidationFailureTodos,
} from './task-state-machine';
import { tryRunSimpleFileTask } from './simple-file-task';
import {
  resolveAgentRuntimeTaskAction,
  runtimeStateCanDeliver,
  settleAgentRuntimeState,
} from './agent-runtime-state-machine';
import { settleProviderFailureFromCompletedEvidence } from './agentic-provider-settlement';
import { describeProviderOutputIntegrity } from './provider-output-integrity';
import {
  parseAgentProviderFailure,
} from './provider-response-recovery';
import { recoverAgenticProviderFailure } from './agentic-provider-recovery-boundary';
import {
  buildTaskOutputScopeRecoveryPrompt,
  detectTaskOutputScopeDrift,
} from './task-output-scope';
import {
  replaceLatestAssistantToolHistory,
} from './agent-history-compaction';
import { compactAgenticMessageHistory } from './agentic-context-compaction';
import { ToolFailureRecoveryLedger } from './tool-failure-recovery';
import { QualityGateStagnationLedger } from './quality-gate-stagnation';
import { SourceValidationLedger } from './source-validation-ledger';
import { createProviderRequirementReviewService } from './provider-requirement-review';
import { tryRunGroundedMarkdownAgenticTask } from './grounded-markdown-agentic-task';
import { buildAgenticSystemPrompt } from './agentic-system-prompt';
import { projectModelToolSemanticProposal } from './model-tool-semantic-proposal';
import { executeScheduledToolLoop } from './tool-loop-scheduler';
import { createSemanticExecutionWriteAuthority } from './semantic-execution-context';
import { createAgenticInitialPromptContext, type AgenticLoopExecutionContext } from './agentic-execution-context';
import { classifyAgenticManualReviewEvidence } from './terminal-evidence-settlement';
import { updateRequirementReviewRepairWindow } from './requirement-review-repair-window';
import { settleAgenticLoopFinal } from './agentic-final-settlement';
import {
  buildRepeatedContextToolFeedback,
  isContextGatheringToolName,
  makeContextToolSignature,
} from './context-convergence-feedback';
import { createModelSemanticSettlementService } from './model-semantic-settlement';
const AGENTIC_PROVIDER_RECOVERY_MAX_ATTEMPTS = 3;

// ----------------------------------------------------------------
// Canonical agentic loop (Claude Code/Codex style)
// New tasks share one executor regardless of attached context shape.
// ----------------------------------------------------------------

/** Normal mode ≈ Copilot's toolCallLimit ~25; autopilot mode ≈ Copilot's ~200. */
const AGENTIC_ROUNDS_NORMAL   = 25;
const AGENTIC_ROUNDS_AUTOPILOT = 200;
const AGENTIC_CONTEXT_GATHERING_ROUND_LIMIT_BEFORE_WRITE = 2;
const AGENTIC_CONTEXT_GATHERING_EVIDENCE_LIMIT_BEFORE_WRITE = 6;
const AGENTIC_CONTEXT_CONVERGENCE_MAX_WARNINGS = 2;
/** Canonical agentic loop: a single-phase tool cycle for every new task. */
export async function runAgenticLoop(
  userPrompt: string,
  contextFiles: string[],
  workspaceRoot: string,
  mode: 'fast' | 'r1' | undefined,
  callbacks: AgentLoopCallbacks,
  sessionContextText = '',
  workflowMode: ExecutionMode = 'edit',
  memoryRelatedPaths: readonly string[] = [],
  semanticContract?: TaskSemanticContract,
  executionContext: AgenticLoopExecutionContext = {},
): Promise<AgentLoopResult> {
  callbacks = copyAgentLoopCallbacks(callbacks, { executionMode: workflowMode });
  const recoveryContextText = executionContext.recoveryContextText?.trim() ?? '';
  const memoryContextText = executionContext.memoryContextText?.trim() ?? '';
  const writeAuthority = createSemanticExecutionWriteAuthority({
    userPrompt,
    callbacks,
    semanticContract,
    workspaceRoots: [workspaceRoot],
    relatedPaths: [...contextFiles, ...memoryRelatedPaths],
  });
  if (workflowMode !== 'model-led' && !recoveryContextText) {
    const groundedMarkdown = await tryRunGroundedMarkdownAgenticTask(
      userPrompt,
      workspaceRoot,
      mode,
      workflowMode,
      writeAuthority.callbacks,
      chatWithMessages,
      contextFiles,
      sessionContextText,
      writeAuthority.semanticContract,
    );
    if (groundedMarkdown) return groundedMarkdown;
  }

  const rules = writeAuthority.projectInstructionsText || null;

  const effectiveTaskIntent = routeTaskSemanticContract(
    writeAuthority.semanticContract,
  );
  const systemPrompt = buildAgenticSystemPrompt(
    userPrompt,
    workspaceRoot,
    contextFiles,
    callbacks.mcpToolRefs,
    rules ?? undefined,
    memoryContextText || undefined,
    workflowMode,
    effectiveTaskIntent,
  );

  const literalToolProtocolPrompt = isLiteralToolProtocolPrompt(userPrompt);
  const resolvePromptRequirements = () => {
    const currentContract = writeAuthority.semanticContract;
    const currentTaskIntent = routeTaskSemanticContract(currentContract);
    if (workflowMode === 'model-led') {
      return { currentTaskIntent, promptRequiresFileChange: false, promptRequiresTools: false };
    }
    const promptIsReadOnly = (
      currentTaskIntent.family === 'read-only-advisory'
      || currentTaskIntent.family === 'review'
      || currentTaskIntent.family === 'safety-refusal'
    );
    const promptRequiresFileChange = !literalToolProtocolPrompt
      && !promptIsReadOnly
      && requiresFileChangeEvidence(writeAuthority.currentPrompt, currentContract);
    const promptRequiresTools = !literalToolProtocolPrompt && (
      requiresReadEvidence(writeAuthority.currentPrompt, currentContract)
      || promptRequiresFileChange
      || requiresCommandEvidence(writeAuthority.currentPrompt, currentContract)
      || currentContract.obligations.sideEffects.length > 0
    );
    return { currentTaskIntent, promptRequiresFileChange, promptRequiresTools };
  };
  let { currentTaskIntent, promptRequiresFileChange, promptRequiresTools } = resolvePromptRequirements();
  const refreshPromptRequirements = (): void => {
    ({ currentTaskIntent, promptRequiresFileChange, promptRequiresTools } = resolvePromptRequirements());
  };
  // Full conversation history (Claude Code pattern: accumulate all rounds)
  const initialPromptContext = createAgenticInitialPromptContext(systemPrompt, userPrompt, sessionContextText, recoveryContextText);
  const messages = initialPromptContext.messages;
  let roundCount = 0;
  let totalChars = initialPromptContext.totalChars;
  const appendUserFeedback = (content: string): void => {
    messages.push({ role: 'user', content });
    totalChars += content.length;
  };
  let hadTaskComplete = false;
  let completeSummary = '';
  let failedReason = '';
  let noToolRounds = 0;
  let contextGatheringOnlyRoundsWithoutWrite = 0;
  let contextConvergenceWarnings = 0;
  let sawWorkTool = false;
  const allTerminalEvidence: TerminalEvidence[] = [];
  const allEvidenceRefs: EvidenceRef[] = [];
  const sourceValidation = new SourceValidationLedger();
  let currentTodos: TodoItem[] = [];
  let initialAgenticTodos: TodoItem[] = [];
  let lastMissingEvidence: string[] = [];
  let lastSummaryFactFailures: string[] = [];
  let lastProviderText = '';
  let lastRoundToolRequestCount = 0;
  let executedToolRoundCount = 0;
  let providerRecoveryAttempts = 0;
  let taskOutputScopeRecoveryAttempts = 0;
  let forceProviderNewSessionNextTurn = false;
  const resetProviderRecoveryAttemptsAfterProgress = () => {
    providerRecoveryAttempts = 0;
    forceProviderNewSessionNextTurn = false;
  };
  const announcedProseKeys = new Set<string>();
  const allReadEvidencePaths = new Set<string>();
  const toolFailureRecovery = new ToolFailureRecoveryLedger({ workspaceRoot });
  const qualityGateStagnation = new QualityGateStagnationLedger();
  const requirementReview = createProviderRequirementReviewService({
    userPrompt: () => writeAuthority.currentPrompt,
    workspaceRoot,
    mode,
    callbacks,
    onProviderSessionReplaced: () => { forceProviderNewSessionNextTurn = true; },
    semanticContract: () => writeAuthority.completionSemanticContract,
    canonicalTaskContract: () => callbacks.canonicalTaskContract,
  });
  let progressEpoch = 0;
  const recordQualityGateFailureFeedback = (qualityGate: AgenticHistoryQualityGate | undefined): string => {
    const observation = qualityGateStagnation.record(qualityGate, progressEpoch);
    if (observation.stopReason && !failedReason) failedReason = observation.stopReason;
    return observation.warning ?? '';
  };
  // Whether the AI has called manage_todo_list yet.
  let todoEverSet = false;
  let fallbackTodosVisible = false;
  const preserveInitialTodosWhenModelPlanIsTooCoarse = (items: TodoItem[]): TodoItem[] => {
    if (initialAgenticTodos.length < 3) return items;
    if (items.length >= 3) return items;
    return initialAgenticTodos;
  };
  // Accumulate files written across all rounds for the phase:done editedFiles payload.
  const allWrittenFiles: Array<{path: string; basename: string; linesAdded: number; linesRemoved: number; action: string}> = [];
  const allVerificationReceipts: CodingVerificationReceipt[] = [];
  const allChangeReceipts: CodingWorkspaceMutationReceipt<unknown>[] = [];
  const allToolExecutionReceipts: CodingToolExecutionReceipt<unknown>[] = [];
  let autoValidatedWriteCount = 0;
  const currentVerificationReceipts = (): readonly CodingVerificationReceipt[] => (
    callbacks.canonicalVerification?.receipts() ?? allVerificationReceipts
  );
  const assessCurrentEvidenceClosure = () => assessAgenticEvidenceClosure({
    requiredBeforeExecution: promptRequiresTools,
    workToolObserved: sawWorkTool,
    completion: {
      userPrompt: writeAuthority.currentPrompt,
      todos: currentTodos,
      writtenFiles: allWrittenFiles,
      terminalEvidence: allTerminalEvidence,
      readEvidencePaths: [...allReadEvidencePaths],
      workspaceRoot,
      semanticContract: writeAuthority.completionSemanticContract,
      canonicalTaskContract: callbacks.canonicalTaskContract,
      verificationReceipts: [...currentVerificationReceipts()],
    },
  });
  const modelSemanticSettlement = createModelSemanticSettlementService({
    authority: writeAuthority,
    callbacks,
    workspaceRoot,
    writtenFiles: () => allWrittenFiles,
    verificationReceipts: currentVerificationReceipts,
  });

  // Announce Working box to webview — neutral action (not 'analyze') so the
  // container doesn't get data-analyze and won't auto-collapse, regardless of
  // whether the agent ends up analyzing or creating files.
  const _shortPrompt = userPrompt.trim().replace(/\n+/g, ' ');
  const _agentLabel = _shortPrompt.length > 38 ? _shortPrompt.slice(0, 36) + '…' : _shortPrompt;
  const requestedDisplayAction = callbacks.runDisplayAction || 'explore';
  const initialDisplayAction = workflowMode === 'model-led' && requestedDisplayAction !== 'respond'
    ? 'explore'
    : requestedDisplayAction;
  const initialDisplayTarget = callbacks.runDisplayTarget || '';
  const emitAgenticCorrectionStatus = async (
    title: string,
    detail: string,
    activityLabel?: string,
    recoveryReason?: AgentRecoveryReason,
  ) => {
    if (callbacks.signal?.aborted) return;
    callbacks.onToolActivity?.('label', activityLabel || title);
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      taskId: 'agentic',
      taskFile: initialDisplayTarget,
      taskAction: initialDisplayAction,
      recoveryReason,
      taskIndex: 1,
      taskTotal: 1,
      state: 'started',
      title,
      detail,
    });
  };
  const recoverProviderFailureInsideCurrentTask = async (
    providerFailure: ReturnType<typeof parseAgentProviderFailure>,
    partialResponseLength = 0,
  ): Promise<boolean> => {
    const recovery = await recoverAgenticProviderFailure({
      failure: providerFailure,
      recoveryAttempts: providerRecoveryAttempts,
      maxRecoveryAttempts: AGENTIC_PROVIDER_RECOVERY_MAX_ATTEMPTS,
      partialResponseLength,
      userPrompt: writeAuthority.currentPrompt,
      promptRequiresTools,
      currentTodos,
      readEvidencePaths: [...allReadEvidencePaths],
      writtenFiles: allWrittenFiles,
      terminalEvidence: allTerminalEvidence,
      messages,
      totalChars,
      contextCompaction: executionContext.contextCompaction,
      workspaceRoot,
      round: roundCount,
      evidenceRefs: allEvidenceRefs,
      taskFile: initialDisplayTarget,
      taskAction: initialDisplayAction,
      callbacks,
    });
    providerRecoveryAttempts = recovery.recoveryAttempts;
    totalChars = recovery.totalChars;
    if (recovery.forceFreshProviderSession) forceProviderNewSessionNextTurn = true;
    return recovery.recovered;
  };
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
    const initialTodos = inferInitialAgenticTodos(
      userPrompt,
      writeAuthority.semanticContract,
    );
    if (initialTodos.length > 0) {
      initialAgenticTodos = initialTodos;
      currentTodos = initialTodos;
    }
  }

  if (workflowMode !== 'model-led' && !recoveryContextText) {
    const simpleFileResult = await tryRunSimpleFileTask({
      userPrompt,
      workspaceRoot,
      callbacks: writeAuthority.callbacks,
      options: {
        verificationAcceptance: callbacks.canonicalVerificationAcceptance
          ?? projectAgenticVerificationAcceptance(writeAuthority.canonicalSemanticContract.taskContract),
      },
    });
    if (simpleFileResult) return simpleFileResult;
  }

  const maxAgenticRounds = callbacks.autopilot ? AGENTIC_ROUNDS_AUTOPILOT : AGENTIC_ROUNDS_NORMAL;
  let requirementReviewRepairGraceRounds = 0;
  // Track terminal command signatures across rounds to detect and break stuck loops
  const seenTerminalCmdSignatures = new Map<string, { count: number; lastProgressEpoch: number }>();
  const seenContextToolSignatures = new Map<string, { count: number; lastProgressEpoch: number }>();
  while (roundCount < maxAgenticRounds + requirementReviewRepairGraceRounds) {
    if (callbacks.signal?.aborted) break;
    roundCount++;

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
          const earlyItems = preserveInitialTodosWhenModelPlanIsTooCoarse(
            normalizeVisibleTodos((firstTodo.input.todoList ?? []) as TodoItem[]),
          );
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

    // ReAct: suppress intermediate prose; route only the final answer to ASUM.
    // This avoids showing the same content in both working box AND bubble.
    const pendingSteerMessages = writeAuthority.takePendingAndDrain();
    if (pendingSteerMessages.length > 0) refreshPromptRequirements();
    messages.push(...pendingSteerMessages);
    totalChars = compactAgenticMessageHistory({
      messages,
      session: executionContext.contextCompaction,
      currentTodos,
      workspaceRoot,
      round: roundCount,
      evidenceRefs: allEvidenceRefs,
    });
    let text = '';
    let tools: CodingToolCall[] = [];
    const useFreshProviderSession = roundCount === 1 || forceProviderNewSessionNextTurn;
    if (forceProviderNewSessionNextTurn) {
      callbacks.onToolActivity?.('label', '重建模型会话并从任务事实恢复');
    }
    forceProviderNewSessionNextTurn = false;
    const providerWaitFeedback = new ProviderWaitFeedback(callbacks.onToolActivity, roundCount);
    try {
      const providerTurn = await chatWithMessages(
        messages,
        mode,
        delta => {
          providerWaitFeedback.observeOutput();
          roundStreamDelta(delta);
        },
        callbacks.signal,
        useFreshProviderSession,
        callbacks.traceRunId, callbacks.traceWorkspaceRoot, callbacks.traceEvidenceParticipantToken, callbacks.onTraceEvidenceError,
        bindProviderNormalizationBoundary(
          callbacks.canonicalProviderEvents,
          callbacks.canonicalToolDispatch,
          { workspaceRoot },
        ),
      );
      providerWaitFeedback.complete();
      text = providerTurn.text;
      tools = providerTurn.tools;
    } catch (error) {
      const providerSettlement = settleProviderFailureFromCompletedEvidence({
        promptRequiresTools, sawWorkTool, aborted: callbacks.signal?.aborted,
        userPrompt: writeAuthority.currentPrompt, todos: currentTodos, writtenFiles: allWrittenFiles,
        terminalEvidence: allTerminalEvidence, readEvidencePaths: [...allReadEvidencePaths],
        workspaceRoot, completeSummary,
        semanticContract: writeAuthority.completionSemanticContract,
        canonicalTaskContract: callbacks.canonicalTaskContract,
      });
      if (providerSettlement.completed) {
        completeSummary = completeSummary || providerSettlement.summary;
        break;
      }
      const providerFailure = parseAgentProviderFailure(error);
      if (await recoverProviderFailureInsideCurrentTask(providerFailure, sAccum.trim().length)) {
        continue;
      }
      throw error;
    } finally {
      providerWaitFeedback.stop();
    }

    const postProviderSteerMessages = writeAuthority.drainAfterProvider();
    if (postProviderSteerMessages.length > 0) {
      refreshPromptRequirements();
      messages.push({ role: 'assistant', content: text }, ...postProviderSteerMessages);
      lastProviderText = text;
      totalChars += text.length;
      callbacks.onToolActivity?.('label', '已接收最新要求，正在重新规划未执行动作');
      continue;
    }
    if (workflowMode === 'model-led' && tools.some(tool => isAgentWorkToolName(tool.name))) {
      const modelSemanticProposal = projectModelToolSemanticProposal(
        tools,
        writeAuthority.semanticContract,
      );
      if (modelSemanticProposal && writeAuthority.applyModelSemanticProposal(modelSemanticProposal)) {
        refreshPromptRequirements();
      }
      promptRequiresTools = true;
      if (tools.some(tool => isFileMutationToolName(tool.name))) promptRequiresFileChange = true;
    }

    const outputScopeDrift = detectTaskOutputScopeDrift({
      requestPrompt: writeAuthority.currentPrompt,
      text,
      workspaceRoot,
    });
    if (outputScopeDrift.blocked && !callbacks.signal?.aborted) {
      taskOutputScopeRecoveryAttempts++;
      callbacks.onToolActivity?.('label', '检测到旧运行目录，正在要求模型切回当前输出目录');
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'execute',
        taskId: 'agentic',
        taskFile: initialDisplayTarget,
        taskAction: initialDisplayAction,
        taskIndex: 1,
        taskTotal: 1,
        state: 'started',
        title: '已拦截旧运行上下文',
        detail: outputScopeDrift.reason,
      });
      if (taskOutputScopeRecoveryAttempts <= 2) {
        const recoveryMessage = buildTaskOutputScopeRecoveryPrompt(outputScopeDrift);
        messages.push(...postProviderSteerMessages, { role: 'user', content: recoveryMessage });
        totalChars += recoveryMessage.length;
        continue;
      }
      failedReason = outputScopeDrift.reason || '模型持续输出旧运行目录，任务上下文已污染。';
      break;
    }

    messages.push({ role: 'assistant', content: text }, ...postProviderSteerMessages);
    lastProviderText = text;
    totalChars += text.length;

    if (callbacks.canonicalToolDispatch && shouldProjectMarkdownFileArtifacts({
      taskRequiresTools: promptRequiresTools,
      workspaceAccess: callbacks.canonicalToolAuthority?.sandbox.workspaceAccess,
      tools,
    })) {
      tools = [
        ...tools,
        ...projectMarkdownFileArtifactToolsForLoop({
          text,
          userPrompt: writeAuthority.currentPrompt,
          workspaceRoot,
          dispatch: callbacks.canonicalToolDispatch,
        }),
      ];
    }

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
      if (!literalToolProtocolPrompt && !callbacks.signal?.aborted && hasIncompleteFakeToolCallProtocol(text)) {
        noToolRounds++;
        const recovered = await recoverProviderFailureInsideCurrentTask({
          status: 'incomplete-tool-block',
          reason: '工具协议痕迹存在，但没有形成可安全执行的工具参数。',
          rawMessage: text,
          recoverable: true,
        }, text.trim().length);
        if (recovered) continue;
        failedReason = 'Provider 连续输出损坏工具协议，未形成可执行工具调用。';
        break;
      }
      const rawFallbackTodos = shouldAdoptPlanningTodoItems({ sawWorkTool })
        ? normalizeVisibleTodos(extractPlanningTodoItems(text))
        : [];
      const fallbackTodos = rawFallbackTodos.length > 0
        ? preserveInitialTodosWhenModelPlanIsTooCoarse(rawFallbackTodos)
        : [];
      if (fallbackTodos.length > 0) {
        todoEverSet = true;
        currentTodos = fallbackTodos;
        if (callbacks.onTodoUpdate) {
          await callbacks.onTodoUpdate(fallbackTodos);
        }
        const continueMessage = '【系统反馈】任务清单已收到，请立即开始执行第一个任务，不要只停留在规划。';
        appendUserFeedback(continueMessage);
        continue;
      }
      const stripped = stripToolCallBlocks(text).trim();
      const reviewRecovery = recoverRequirementReviewNoToolCompletion(requirementReview, noToolRounds + 1, text);
      if (!callbacks.signal?.aborted && reviewRecovery) {
        noToolRounds++;
        if (reviewRecovery.kind === 'stop') {
          failedReason = reviewRecovery.reason;
          break;
        }
        await emitAgenticCorrectionStatus(
          reviewRecovery.statusTitle,
          reviewRecovery.statusDetail,
          reviewRecovery.statusActivity,
        );
        appendUserFeedback(reviewRecovery.feedback);
        continue;
      }
      const danglingActionWithoutTools = promptRequiresTools && hasDanglingAgentActionIntent(stripped);
      if (!callbacks.signal?.aborted && danglingActionWithoutTools && noToolRounds < 4) {
        noToolRounds++;
        await emitAgenticCorrectionStatus(
          '已拦接口头承诺，要求真实工具执行',
          '模型刚才只说明要继续检查、创建、写入或验证，但没有调用任何工具。DevSeek 已保留这个失败事实，并要求下一轮必须使用真实文件、搜索或终端工具推进。',
          '拦接口头承诺，要求真实工具执行',
          'provider-short-intent',
        );
        const retryMessage = buildDanglingAgentActionFeedback();
        appendUserFeedback(retryMessage);
        continue;
      }
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
        await emitAgenticCorrectionStatus(
          '等待真实工具执行',
          '当前回复没有任何工具调用，不能把规划或说明当作完成结果。DevSeek 正在要求模型先建立任务清单，再读取、写入或运行验证命令。',
          '要求模型调用真实工具',
        );
        const retryMessage = '【系统反馈】本轮没有检测到任何工具调用，不能把需要创建/修改/运行的任务标记为完成。请继续执行：先更新 manage_todo_list，然后调用 read_file/list_dir/create_file/run_terminal 等实际工具；完成前必须提供可验证的文件或命令结果。';
        appendUserFeedback(retryMessage);
        continue;
      }
      const missingWithoutTools = assessCurrentEvidenceClosure().missingEvidence;
      if (!callbacks.signal?.aborted && missingWithoutTools.length > 0 && noToolRounds < 4) {
        noToolRounds++;
        await emitAgenticCorrectionStatus(
          '交付证据不足，继续要求执行',
          `当前仍缺少${missingWithoutTools.join('、')}。DevSeek 不会把目录检查或说明文字结算为完成，下一轮必须补齐真实写盘、读取或验证证据。`,
          '交付证据不足，继续执行',
        );
        const retryMessage = `【系统反馈】不能停在检查目录或说明阶段。当前缺少${missingWithoutTools.join('、')}。${buildMissingEvidenceRecoveryInstruction(missingWithoutTools, {
          mutationExpected: promptRequiresFileChange || writeAuthority.canonicalSemanticContract.mutation.requested,
          mutationAllowed: !writeAuthority.canonicalSemanticContract.mutation.prohibited
            && !writeAuthority.writeRevoked,
        })}不要把 memory_write/项目记忆列为用户 todo。`;
        appendUserFeedback(retryMessage);
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

    const missingBeforeTools = assessCurrentEvidenceClosure().missingEvidence;

    const blockedRepeatedToolIndexes = new Set<number>();
    const suppressedTools: ToolSuppressionEvidence[] = [];
    const loopWarnings: string[] = [];
    const hasFileWriteIntentThisRound = tools.some(tool => isFileMutationToolName(tool.name));
    tools.forEach((tool, toolIndex) => {
      if (tool.name !== 'run_terminal') return;
      const command = typeof tool.input.command === 'string' ? tool.input.command.trim() : '';
      if (!command) return;
      const sig = makeTerminalCmdSignature(command);
      const seen = seenTerminalCmdSignatures.get(sig);
      if (seen && seen.lastProgressEpoch === progressEpoch && !hasFileWriteIntentThisRound) {
        blockedRepeatedToolIndexes.add(toolIndex);
        suppressedTools.push({ tool: tool.name, reason: 'repeated-terminal-without-progress' });
        loopWarnings.push(getTerminalRecoveryProtocol(command, seen.count + 1));
        callbacks.onToolActivity?.('terminal', `跳过重复命令: ${sig.slice(0, 50)}`);
      }
    });
    tools.forEach((tool, toolIndex) => {
      if (!isContextGatheringToolName(tool.name)) return;
      const sig = makeContextToolSignature(tool);
      const seen = seenContextToolSignatures.get(sig);
      if (seen && seen.lastProgressEpoch === progressEpoch && !hasFileWriteIntentThisRound) {
        const refreshPath = tool.name === 'read_file' && typeof tool.input.path === 'string'
          ? tool.input.path
          : undefined;
        if (toolFailureRecovery.consumeContextRefresh(refreshPath)) {
          seenContextToolSignatures.delete(sig);
          callbacks.onToolActivity?.('read', '重新读取失败编辑后的当前文件');
          return;
        }
        const nextCount = seen.count + 1;
        seenContextToolSignatures.set(sig, { count: nextCount, lastProgressEpoch: progressEpoch });
        blockedRepeatedToolIndexes.add(toolIndex);
        suppressedTools.push({ tool: tool.name, reason: 'repeated-context-without-progress' });
        loopWarnings.push(buildRepeatedContextToolFeedback(tool, nextCount));
        callbacks.onToolActivity?.('search', `跳过重复上下文工具: ${tool.name}`);
      }
    });
    const toolsToExecute = blockedRepeatedToolIndexes.size > 0
      ? tools.filter((_, toolIndex) => !blockedRepeatedToolIndexes.has(toolIndex))
      : tools;

    if (writeAuthority.writeRevoked && hasWriteRevokedToolAttempt(toolsToExecute)) {
      failedReason = '用户已撤销写入授权，任务已在工具执行前停止。';
      break;
    }

    const loopRes = await executeScheduledToolLoop(
      toolsToExecute,
      batch => executeFakeToolsForLoop(
        batch,
        writeAuthority.callbacks,
        workspaceRoot,
        {
          currentTaskIndex: Number.MAX_SAFE_INTEGER,
          taskTotal: 1,
          deferDoneStatus: true,
          requireWorkBeforeComplete: missingBeforeTools.length > 0,
          userPrompt: writeAuthority.currentPrompt,
          workspaceRoot,
          requireReadBeforeOverwrite: true,
          readEvidencePaths: [...allReadEvidencePaths],
          verificationScopeFiles: allWrittenFiles,
          suppressedTools,
        },
      ),
    );
    if (writeAuthority.writeRevoked && hasWriteRevokedToolAttempt(toolsToExecute)) { failedReason = '用户实时补充已撤销写入授权，任务已停止。'; break; }
    if (loopRes.toolCallsMade) {
      replaceLatestAssistantToolHistory(messages);
    }

    if (loopRes.workToolCallsMade) {
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
      toolFailureRecovery.clearForWrittenPaths(loopRes.writtenFiles.map(file => file.path));
      progressEpoch++;
    }
    if (loopRes.changeReceipts?.length) allChangeReceipts.push(...loopRes.changeReceipts);
    if (loopRes.toolExecutionReceipts?.length) {
      allToolExecutionReceipts.push(...loopRes.toolExecutionReceipts);
    }
    if (loopRes.verificationReceipts?.length) {
      allVerificationReceipts.push(...loopRes.verificationReceipts);
    }
    if (loopRes.readFiles?.length) {
      for (const readPath of loopRes.readFiles) allReadEvidencePaths.add(readPath);
    }
    if (loopRes.terminalEvidence?.length) {
      const classifiedTerminalEvidence = classifyAgenticManualReviewEvidence({
        evidence: loopRes.terminalEvidence,
        feedbackForAI: loopRes.feedbackForAI,
        userPrompt: writeAuthority.currentPrompt,
        writtenFiles: allWrittenFiles,
      });
      allTerminalEvidence.push(...classifiedTerminalEvidence);
    }
    if (loopRes.evidenceRefs?.length) {
      allEvidenceRefs.push(...loopRes.evidenceRefs);
    }
    const semanticSettlement = await modelSemanticSettlement.observe(loopRes);
    if (semanticSettlement.settled) {
      refreshPromptRequirements();
      allVerificationReceipts.push(...semanticSettlement.verificationReceipts);
    }
    if ((loopRes.readFiles?.length ?? 0) > 0
      || (loopRes.writtenFiles?.length ?? 0) > 0
      || (loopRes.terminalEvidence?.length ?? 0) > 0
      || (loopRes.evidenceRefs?.length ?? 0) > 0) {
      resetProviderRecoveryAttemptsAfterProgress();
    }
    const roundHasWriteProgress = hasFileWriteIntentThisRound
      || (loopRes.writtenFiles?.length ?? 0) > 0
      || toolsToExecute.some(tool => isFileMutationToolName(tool.name));
    const roundHasTerminalProgress = (loopRes.terminalCommands?.length ?? 0) > 0
      || (loopRes.terminalEvidence?.length ?? 0) > 0;
    const roundHasOnlyContextGathering = toolsToExecute.length > 0
      && toolsToExecute.some(tool => isContextGatheringToolName(tool.name))
      && toolsToExecute.every(tool => (
        isContextGatheringToolName(tool.name)
        || tool.name === 'manage_todo_list'
        || tool.name === 'memory_write'
      ))
      && !roundHasWriteProgress
      && !roundHasTerminalProgress;
    if (roundHasOnlyContextGathering) {
      contextGatheringOnlyRoundsWithoutWrite++;
    } else if (roundHasWriteProgress || roundHasTerminalProgress) {
      contextGatheringOnlyRoundsWithoutWrite = 0;
    }
    const failureRound = toolFailureRecovery.recordRound(loopRes.toolFailures ?? []);
    loopWarnings.push(...failureRound.warnings);
    if (failureRound.stopReason && !failedReason) {
      failedReason = failureRound.stopReason;
    }
    if (failedReason) {
      break;
    }
    const pendingAutoValidationWrites = allWrittenFiles.slice(autoValidatedWriteCount);
    if (pendingAutoValidationWrites.length > 0) {
      sourceValidation.beginWriteCohort(allWrittenFiles.length);
    }
    const autoValidation = await runAgentAutoValidationForWrites(
      pendingAutoValidationWrites,
      workspaceRoot,
      writeAuthority.currentPrompt,
      writeAuthority.callbacks,
      {
        qualityWrittenFiles: allWrittenFiles,
        verificationScopeWrittenFiles: allWrittenFiles,
        verificationAcceptance: callbacks.canonicalVerificationAcceptance
          ?? projectAgenticVerificationAcceptance(writeAuthority.completionSemanticContract.taskContract),
        priorVerificationReceipts: currentVerificationReceipts(),
        changeReceipts: allChangeReceipts,
      },
    );
    if (autoValidation.verificationReceipt) allVerificationReceipts.push(autoValidation.verificationReceipt);
    autoValidatedWriteCount = allWrittenFiles.length;
    const normalizedAutoValidation = normalizeAgenticAutoValidation({
      autoValidation,
      userPrompt: writeAuthority.currentPrompt,
      writtenFiles: allWrittenFiles,
    });
    if (pendingAutoValidationWrites.length > 0) {
      sourceValidation.settleWriteCohort(allWrittenFiles.length, normalizedAutoValidation.qualityGate);
    }
    if (normalizedAutoValidation.evidence.length) {
      allTerminalEvidence.push(...normalizedAutoValidation.evidence);
    }
    const qualityGateFeedback = recordQualityGateFailureFeedback(normalizedAutoValidation.qualityGate);
    if (autoValidation.repairBlockedReason) {
      if (callbacks.onTodoUpdate && currentTodos.length > 0) {
        currentTodos = settleValidationFailureTodos(currentTodos);
        await callbacks.onTodoUpdate(currentTodos);
      }
      failedReason = autoValidation.repairBlockedReason;
      break;
    }
    if (failedReason) {
      break;
    }
    const autoValidationFeedback = [normalizedAutoValidation.feedbackForAI, qualityGateFeedback].filter(Boolean).join('\n\n');

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
    for (const tool of toolsToExecute) {
      if (!isContextGatheringToolName(tool.name)) continue;
      const sig = makeContextToolSignature(tool);
      const prev = seenContextToolSignatures.get(sig);
      const nextCount = (prev?.count ?? 0) + 1;
      seenContextToolSignatures.set(sig, { count: nextCount, lastProgressEpoch: progressEpoch });
      if (prev && prev.lastProgressEpoch === progressEpoch && nextCount >= 2) {
        loopWarnings.push(buildRepeatedContextToolFeedback(tool, nextCount));
      }
    }
    // Clear any ASUM delta that task_complete may have emitted during this round.
    // Each round's summary is intermediate — only the definitive post-loop ASUM
    // should appear in the prose bubble (Copilot/Claude Code pattern).
    if (roundHasWorkTools) {
      callbacks.onDelta('\x00PROSE_CLEAR\x00');
    }

    const deniedToolAfterTools = getAgenticBlockingDeniedToolExecution(callbacks.canonicalToolExecution?.receipts()
      ?? allToolExecutionReceipts, allChangeReceipts, currentVerificationReceipts());
    if (deniedToolAfterTools
      && (loopRes.taskComplete || loopRes.allTodosCompleted)
      && !callbacks.signal?.aborted) {
      hadTaskComplete = hadTaskComplete || loopRes.taskComplete;
      completeSummary = loopRes.completeSummary ?? cleanAgentFinalSummaryForUser(stripToolCallBlocks(text));
      failedReason = describeAgenticDeniedToolExecution(deniedToolAfterTools);
      break;
    }

    const evidenceAfterTools = assessCurrentEvidenceClosure();
    const missingAfterTools = evidenceAfterTools.missingEvidence;
    const blockingFailureAfterTools = evidenceAfterTools.blockingTerminalFailure;
    const roundIsCompletionCandidate = loopRes.completeSummary !== undefined
      || loopRes.taskComplete
      || loopRes.allTodosCompleted;
    const roundSummaryForFactCheck = roundIsCompletionCandidate
      ? loopRes.completeSummary ?? cleanAgentFinalSummaryForUser(stripToolCallBlocks(text))
      : '';
    const summaryFactFailuresAfterTools = roundSummaryForFactCheck
      ? getUnsupportedSummaryFileClaims(roundSummaryForFactCheck, allWrittenFiles, workspaceRoot)
      : [];
    lastMissingEvidence = missingAfterTools;
    lastSummaryFactFailures = summaryFactFailuresAfterTools;
    if (summaryFactFailuresAfterTools.length > 0) {
      loopWarnings.push(`【系统反馈】完成文字缺少文件事实证据：${summaryFactFailuresAfterTools.join('、')}。请核对磁盘并补齐真实文件，或修正完成摘要。`);
    }
    const gatheredEvidenceCount = allReadEvidencePaths.size + allEvidenceRefs.length;
    if (!callbacks.signal?.aborted
      && promptRequiresFileChange
      && allWrittenFiles.length === 0
      && missingAfterTools.length > 0
      && contextGatheringOnlyRoundsWithoutWrite >= AGENTIC_CONTEXT_GATHERING_ROUND_LIMIT_BEFORE_WRITE
      && gatheredEvidenceCount >= AGENTIC_CONTEXT_GATHERING_EVIDENCE_LIMIT_BEFORE_WRITE
      && contextConvergenceWarnings < AGENTIC_CONTEXT_CONVERGENCE_MAX_WARNINGS) {
      contextConvergenceWarnings++;
      await emitAgenticCorrectionStatus(
        '项目证据已收集，正在切换到交付落盘',
        `已读取或搜索 ${gatheredEvidenceCount} 项项目证据，但尚未写入目标文件。DevSeek 正在要求模型停止横向调查，基于已有证据创建文档/源码并继续验证。`,
        '项目证据已足够，切换到交付落盘',
      );
      loopWarnings.push([
        '【系统反馈】项目调查证据已足够，必须从调查阶段切换到交付阶段。',
        `当前已读取/搜索 ${gatheredEvidenceCount} 项证据，连续 ${contextGatheringOnlyRoundsWithoutWrite} 轮只有上下文收集，但还没有任何写盘证据。`,
        '下一轮不要继续横向 grep/list/read；请直接使用 create_file/write_file 创建用户要求的 Markdown 文档、源码或测试骨架，随后用 read_file/run_terminal 等工具验证。',
        '如果仍缺少一个关键事实，只允许读取一个精确文件或行范围，并在同一轮后续工具中落盘。',
      ].join('\n'));
    }

    let reviewFeedback: string | undefined;
    if (!callbacks.signal?.aborted
      && sawWorkTool
      && missingAfterTools.length === 0
      && !blockingFailureAfterTools
      && summaryFactFailuresAfterTools.length === 0) {
      const reviewOutcome = await requirementReview.request({
        qualityGate: sourceValidation.qualityGateForCurrentSource(),
        writtenFiles: allWrittenFiles,
        roundReadFiles: loopRes.readFiles ?? [],
        hostFinalSourceEvidenceReady: sourceValidation.currentSourceIsValidated(),
      });
      if (reviewOutcome.kind === 'feedback') {
        reviewFeedback = reviewOutcome.feedback;
        noToolRounds = 0;
        const repairWindow = updateRequirementReviewRepairWindow(requirementReviewRepairGraceRounds, reviewFeedback);
        requirementReviewRepairGraceRounds = repairWindow.graceRounds;
        if (repairWindow.failureStatus) {
          await emitAgenticCorrectionStatus(...repairWindow.failureStatus);
        }
        loopWarnings.push(reviewFeedback);
      } else if (reviewOutcome.kind === 'settled') {
        hadTaskComplete = hadTaskComplete || loopRes.taskComplete;
        if (loopRes.completeSummary !== undefined) completeSummary = loopRes.completeSummary ?? '';
        break;
      }
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
      appendUserFeedback(retryMessage);
      continue;
    }

    if (loopRes.taskComplete && !reviewFeedback) {
      if (promptRequiresTools && !sawWorkTool && noToolRounds < 2 && !callbacks.signal?.aborted) {
        noToolRounds++;
        const retryMessage = '【系统反馈】你调用了 task_complete，但还没有执行任何实际工具。请继续完成任务：更新 todo 状态，并调用必要的文件/终端工具后再完成。';
        appendUserFeedback(retryMessage);
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
    if (!reviewFeedback
      && loopRes.allTodosCompleted
      && (!promptRequiresTools || (sawWorkTool && !blockingFailureAfterTools))) {
      break;
    }
    if (loopRes.allTodosCompleted && promptRequiresTools && !sawWorkTool && noToolRounds < 2 && !callbacks.signal?.aborted) {
      noToolRounds++;
      const retryMessage = '【系统反馈】todo 被标记为完成，但还没有任何实际文件/命令工具执行记录。请继续执行真实工作，不要只更新 todo。';
      appendUserFeedback(retryMessage);
      continue;
    }

    if (!loopRes.toolCallsMade && loopWarnings.length === 0) {
      const evidenceNow = assessCurrentEvidenceClosure();
      const missingNow = evidenceNow.missingEvidence;
      const blockingFailureNow = evidenceNow.blockingTerminalFailure;
      if (blockingFailureNow && noToolRounds < 2 && !callbacks.signal?.aborted) {
        noToolRounds++;
        const retryMessage = buildTerminalFailureRepairFeedback(blockingFailureNow, missingNow);
        appendUserFeedback(retryMessage);
        continue;
      }
      break;
    }

    // Inject tool results into next round
    const combinedFeedback = [loopRes.feedbackForAI, autoValidationFeedback, ...loopWarnings].filter(Boolean).join('\n\n');
    const feedback = `[工具结果 Round ${roundCount}]\n${combinedFeedback}`;
    appendUserFeedback(feedback);
  }

  const finalEvidence = assessCurrentEvidenceClosure();
  const finalMissingEvidence = finalEvidence.missingEvidence;
  const finalBlockingFailure = finalEvidence.blockingTerminalFailure;
  const finalSummaryFactFailures = completeSummary
    ? getUnsupportedSummaryFileClaims(completeSummary, allWrittenFiles, workspaceRoot)
    : lastSummaryFactFailures;
  const runtimeTaskAction = resolveAgentRuntimeTaskAction({
    routeChatKind: currentTaskIntent.chatKind,
    taskComplete: hadTaskComplete,
    toolReceipts: allToolExecutionReceipts,
  });
  const latestAutoQualityGate = sourceValidation.qualityGateForCurrentSource();
  const validationFailedReason = latestAutoQualityGate && latestAutoQualityGate.status !== 'pass'
    ? latestAutoQualityGate.summary
    : undefined;
  const finalRequirementReviewBlocker = requirementReview.completionBlocker();
  const policyRefusalEvidenceSatisfied = hasUnsafeSecretHarvestingRefusalEvidence(
    writeAuthority.currentPrompt, `${completeSummary}\n${lastProviderText}`, { workToolUsed: sawWorkTool, changedFileCount: allWrittenFiles.length },
  );
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
    validationPassed: latestAutoQualityGate?.status === 'pass',
    validationFailedReason,
    policyRefusalEvidenceSatisfied,
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
    && runtimeTaskAction === 'respond'
    && !runtimeStateCanDeliver(finalRuntimeSettlement)) {
    failedReason = describeProviderOutputIntegrity(finalRuntimeSettlement.providerOutput.kind);
  } else if (!failedReason
    && runtimeTaskAction !== 'respond'
    && !runtimeStateCanDeliver(finalRuntimeSettlement)) {
    failedReason = finalRuntimeSettlement.failedReason
      || `任务已有执行证据，但缺少完成信号、通过验证或可交付总结：${describeProviderOutputIntegrity(finalRuntimeSettlement.providerOutput.kind)}`;
  }
  if (!failedReason && finalRequirementReviewBlocker) {
    failedReason = finalRequirementReviewBlocker;
  } else if (!failedReason && finalBlockingFailure) {
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
  return settleAgenticLoopFinal({
    userPrompt,
    workspaceRoot,
    roundCount,
    failedReason,
    completeSummary,
    currentTodos,
    writtenFiles: allWrittenFiles,
    terminalEvidence: allTerminalEvidence,
    // Preserve the full failure/repair/reverification history for audit and
    // conformance. Decision sites above consume currentVerificationReceipts().
    verificationReceipts: [...allVerificationReceipts],
    toolExecutionReceipts: allToolExecutionReceipts,
    changeReceipts: allChangeReceipts,
    latestAutoQualityGate,
    policyRefusalEvidenceSatisfied,
    callbacks,
  });
}

function projectAgenticVerificationAcceptance(
  taskContract: Parameters<typeof projectTaskContractAcceptance>[0],
) {
  return projectTaskContractAcceptance(taskContract)
    .filter(criterion => criterion.id === 'verified');
}
