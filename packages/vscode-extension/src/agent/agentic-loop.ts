/**
 * Canonical agentic loop.
 *
 * This module owns the Claude Code/Codex-style ReAct loop used for every new
 * task. Attached files contribute context; they never select another executor.
 */

import * as vscode from 'vscode';
import type {
  CodingToolExecutionReceipt,
  CodingVerificationReceipt,
  CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import { type ChatMessage } from '../llm/types';
import { bindProviderNormalizationBoundary } from '../llm/provider-events';
import type { TaskSemanticContract } from '../task-semantic-contract';
import {
  hasUnsafeSecretHarvestingRefusalEvidence,
} from '../intent/safety-intent';
import {
  describeBlockingTerminalFailure,
  isCodeArtifactPath,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import { buildTerminalFailureRepairFeedback } from './terminal-failure-repair';
import type { AgenticHistoryQualityGate } from './agentic-history';
import { runAgentAutoValidationForWrites, type AgentAutoValidationResult } from './auto-validation';
import {
  advanceAutoValidationFailureFence,
  shouldDeferAgentAutoValidation,
} from './auto-validation-scheduler';
import { normalizeAgenticAutoValidation } from './agentic-auto-validation-settlement';
import { buildMissingEvidenceRecoveryInstruction, type TodoItem } from './evidence-recovery';
import {
  countCompletedAuthorizedTextToolEnvelopes,
  createTextToolProtocolSession,
  findFirstAuthorizedTextToolEnvelopeStart,
  hasIncompleteAuthorizedTextToolEnvelope,
  inspectInvalidAuthorizedTextToolProtocol,
  inspectOutOfEnvelopeTextToolProtocol,
  parseAuthorizedTextToolCalls,
  stripAuthorizedTextToolEnvelopes,
} from './text-tool-protocol';
import { recoverRequirementReviewNoToolCompletion } from './requirement-review-no-tool-recovery';
import {
  agentAnnouncementKey,
  cleanAgentFinalSummaryForUser,
  isDeferredAgentActionAnnouncement,
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
  completeAgentTodos,
  settleMissingEvidenceTodos,
  settleValidationFailureTodos,
} from './task-state-machine';
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
import { AgenticProviderRecoveryLifecycle, recoverAgenticProviderFailure } from './agentic-provider-recovery-boundary';
import {
  replaceLatestAssistantToolHistory,
} from './agent-history-compaction';
import {
  compactAgenticMessageHistory,
  projectAgenticToolFeedbackMessage,
} from './agentic-context-compaction';
import { ToolFailureRecoveryLedger } from './tool-failure-recovery';
import { QualityGateStagnationLedger } from './quality-gate-stagnation';
import { SourceValidationLedger } from './source-validation-ledger';
import { createProviderRequirementReviewService } from './provider-requirement-review';
import { buildAgenticSystemPrompt } from './agentic-system-prompt';
import { projectModelToolSemanticProposal } from './model-tool-semantic-proposal';
import { executeScheduledToolLoop } from './tool-loop-scheduler';
import { createSemanticExecutionWriteAuthority } from './semantic-execution-context';
import { createAgenticInitialPromptContext, type AgenticLoopExecutionContext } from './agentic-execution-context';
import { classifyAgenticManualReviewEvidence } from './terminal-evidence-settlement';
import {
  renewRequirementReviewRepairWindow,
  updateRequirementReviewRepairWindow,
} from './requirement-review-repair-window';
import { renewExecutionConvergenceRoundLimit } from './execution-convergence-window';
import { settleAgenticLoopFinal } from './agentic-final-settlement';
import {
  DeliveryConvergenceLedger,
  isContextGatheringToolName,
  resolveDeliveryConvergenceExpectation,
  resolveDeliveryConvergencePending,
} from './context-convergence-feedback';
import { ContextInvestigationLedger } from './context-investigation-ledger';
import { createModelSemanticSettlementService } from './model-semantic-settlement';
import { resolveAgenticPromptRequirements } from './agentic-prompt-requirements';
const AGENTIC_PROVIDER_RECOVERY_MAX_ATTEMPTS = 3;

// ----------------------------------------------------------------
// Canonical agentic loop (Claude Code/Codex style)
// New tasks share one executor regardless of attached context shape.
// ----------------------------------------------------------------

/** Normal mode starts near Copilot's ~25 and renews only on bounded execution progress. */
const AGENTIC_ROUNDS_NORMAL   = 25;
const AGENTIC_ROUNDS_AUTOPILOT = 200;
const AGENTIC_ROUNDS_NORMAL_CONVERGENCE_MAX = 80;
/** Canonical agentic loop: a single-phase tool cycle for every new task. */
export async function runAgenticLoop(
  userPrompt: string,
  contextFiles: string[],
  workspaceRoot: string,
  mode: 'fast' | 'r1' | undefined,
  callbacks: AgentLoopCallbacks,
  sessionContextText = '',
  memoryRelatedPaths: readonly string[] = [],
  semanticContract?: TaskSemanticContract,
  executionContext: AgenticLoopExecutionContext = {},
): Promise<AgentLoopResult> {
  callbacks = copyAgentLoopCallbacks(callbacks, { executionMode: 'model-led' });
  const recoveryContextText = executionContext.recoveryContextText?.trim() ?? '';
  const memoryContextText = executionContext.memoryContextText?.trim() ?? '';
  const writeAuthority = createSemanticExecutionWriteAuthority({
    userPrompt,
    callbacks,
    semanticContract,
    workspaceRoots: [workspaceRoot],
    relatedPaths: [...contextFiles, ...memoryRelatedPaths],
  });
  const rules = writeAuthority.projectInstructionsText || null;
  const textToolProtocol = createTextToolProtocolSession();

  const systemPrompt = buildAgenticSystemPrompt(
    workspaceRoot,
    contextFiles,
    callbacks.mcpToolRefs,
    rules ?? undefined,
    memoryContextText || undefined,
    textToolProtocol,
  );

  const resolvePromptRequirements = () => resolveAgenticPromptRequirements(
    writeAuthority.semanticContract,
    callbacks.canonicalTaskContract,
  );
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
  let sawWorkTool = false;
  const allTerminalEvidence: TerminalEvidence[] = [];
  const allEvidenceRefs: EvidenceRef[] = [];
  const sourceValidation = new SourceValidationLedger();
  let currentTodos: TodoItem[] = [];
  let lastMissingEvidence: string[] = [];
  let lastProviderText = '';
  let lastRoundToolRequestCount = 0;
  let executedToolRoundCount = 0;
  let providerRecoveryAttempts = 0;
  let unresolvedProviderToolProtocol = false;
  let forceProviderNewSessionNextTurn = false;
  const resetProviderRecoveryAttemptsAfterProgress = () => {
    providerRecoveryAttempts = 0;
    forceProviderNewSessionNextTurn = false;
  };
  const announcedProseKeys = new Set<string>();
  const allReadEvidencePaths = new Set<string>();
  const toolFailureRecovery = new ToolFailureRecoveryLedger({ workspaceRoot });
  const deliveryConvergence = new DeliveryConvergenceLedger();
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
  // Accumulate files written across all rounds for the phase:done editedFiles payload.
  const allWrittenFiles: Array<{path: string; basename: string; linesAdded: number; linesRemoved: number; action: string}> = [];
  const allVerificationReceipts: CodingVerificationReceipt[] = [];
  const allChangeReceipts: CodingWorkspaceMutationReceipt<unknown>[] = [];
  const allToolExecutionReceipts: CodingToolExecutionReceipt<unknown>[] = [];
  let autoValidatedWriteCount = 0;
  let failedTerminalWriteCount: number | undefined;
  const currentVerificationReceipts = (): readonly CodingVerificationReceipt[] => (
    callbacks.canonicalVerification?.receipts() ?? allVerificationReceipts
  );
  const assessCurrentEvidenceClosure = () => assessAgenticEvidenceClosure({
    requiredBeforeExecution: promptRequiresTools,
    workToolObserved: sawWorkTool,
    completion: {
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
  const initialDisplayAction = requestedDisplayAction !== 'respond'
    ? 'explore'
    : requestedDisplayAction;
  const initialDisplayTarget = callbacks.runDisplayTarget || '';
  const providerRecovery = new AgenticProviderRecoveryLifecycle(initialDisplayTarget, initialDisplayAction, callbacks);
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
  const recoverBlockingTerminalFailure = async (
    failure: TerminalEvidence | undefined,
    missingEvidence: readonly string[],
    maxNoToolRounds: number,
  ): Promise<boolean> => {
    if (!failure || callbacks.signal?.aborted || noToolRounds >= maxNoToolRounds) return false;
    noToolRounds++;
    await emitAgenticCorrectionStatus(
      '验证失败，继续依据证据修复',
      describeBlockingTerminalFailure(failure),
      '回流未清除的验证失败',
    );
    appendUserFeedback(buildTerminalFailureRepairFeedback(failure, missingEvidence));
    return true;
  };
  const settleOrRecoverProviderFailureInsideCurrentTask = async (
    providerFailure: ReturnType<typeof parseAgentProviderFailure>,
    partialResponseLength = 0,
  ): Promise<'completed' | 'recovered' | 'unrecoverable'> => {
    const providerSettlement = settleProviderFailureFromCompletedEvidence({
      providerFailureStatus: providerFailure?.status,
      unsettledToolProposal: Boolean(providerFailure?.observedToolNames?.length),
      promptRequiresTools,
      sawWorkTool,
      aborted: callbacks.signal?.aborted,
      currentWriteCohortValidated: sourceValidation.currentSourceIsValidated(),
      writtenFiles: allWrittenFiles,
      terminalEvidence: allTerminalEvidence,
      readEvidencePaths: [...allReadEvidencePaths],
      workspaceRoot,
      semanticContract: writeAuthority.completionSemanticContract,
      canonicalTaskContract: callbacks.canonicalTaskContract,
      completionBlockers: [requirementReview.completionBlocker()],
    });
    if (providerSettlement.completed) {
      completeSummary = completeSummary || providerSettlement.summary;
      hadTaskComplete = true;
      return 'completed';
    }
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
      textToolProtocol,
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
    if (recovery.forceFreshProviderSession) {
      forceProviderNewSessionNextTurn = true;
      // Duplicate-read suppression is scoped to what the current model session
      // has actually seen. A rebuilt Provider session retains audit paths but
      // must be allowed to replay the file contents it no longer possesses.
      contextInvestigation.reset();
    }
    if (recovery.recovered) {
      providerRecovery.begin(providerFailure?.operationId);
      return 'recovered';
    }
    await providerRecovery.fail();
    return 'unrecoverable';
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

  const maxAgenticRounds = callbacks.autopilot ? AGENTIC_ROUNDS_AUTOPILOT : AGENTIC_ROUNDS_NORMAL;
  let executionConvergenceRoundLimit = maxAgenticRounds;
  let requirementReviewRepairGraceRounds = 0;
  let steeringRevisionGraceRounds = 0;
  // Track terminal command signatures across rounds to detect and break stuck loops
  const seenTerminalCmdSignatures = new Map<string, { count: number; lastProgressEpoch: number }>();
  const contextInvestigation = new ContextInvestigationLedger(workspaceRoot);
  for (;;) {
  while (roundCount < Math.max(
    executionConvergenceRoundLimit,
    maxAgenticRounds + requirementReviewRepairGraceRounds + steeringRevisionGraceRounds,
  )) {
    if (callbacks.signal?.aborted) break;
    roundCount++;

    // ── Streaming delta: early manage_todo_list detection ───────────────────
    // Preview each newly completed authenticated envelope once so Todo and tool
    // activity can appear before the full response without repeatedly parsing a partial payload.
    let sAccum = '';
    let sNextToolPreviewCheck = 80;
    let sEarlyFired = false;
    let sNextSpinnerUpdate = 200; // update spinner label every ~200 chars to show progress
    let sPreviewedEnvelopeCount = 0;
    const sEarlyToolsEmitted = new Set<string>();
    const roundStreamDelta = (delta: string) => {
      // Bridge may send \x00RESET\x00 + fullText to replace accumulated content.
      // Reset sAccum to the new full text instead of appending the corrupt prefix.
      if (delta.startsWith('\x00RESET\x00')) {
        sAccum = delta.slice(7);
        sNextToolPreviewCheck = Math.min(sNextToolPreviewCheck, sAccum.length);
        sPreviewedEnvelopeCount = 0;
      } else {
        sAccum += delta;
      }
      // Show thinking progress in Working box spinner label so user sees DeepSeek is active.
      // This prevents the "no activity" perception while waiting for the full response.
      if (callbacks.onToolActivity && sAccum.length >= sNextSpinnerUpdate) {
        sNextSpinnerUpdate = sAccum.length + 300;
        callbacks.onToolActivity('label', `思考中 (${sAccum.length} 字符)…`);
      }
      if (sAccum.length < sNextToolPreviewCheck) return;
      sNextToolPreviewCheck = sAccum.length + 100;
      const completedEnvelopeCount = countCompletedAuthorizedTextToolEnvelopes(sAccum, textToolProtocol);
      if (completedEnvelopeCount <= sPreviewedEnvelopeCount) return;
      sPreviewedEnvelopeCount = completedEnvelopeCount;
      const earlyTools = parseAuthorizedTextToolCalls(sAccum, textToolProtocol);
      if (!sEarlyFired && callbacks.onTodoUpdate) {
        const firstTodo = earlyTools.find(t => t.name === 'manage_todo_list');
        if (firstTodo) {
          const earlyItems = normalizeVisibleTodos((firstTodo.input.todoList ?? []) as TodoItem[]);
          if (Array.isArray(earlyItems) && earlyItems.length > 0) {
            if (!earlyItems.every(item => item.status === 'completed')) {
              sEarlyFired = true;
              todoEverSet = true;
              currentTodos = earlyItems;
              void callbacks.onTodoUpdate(earlyItems);
            }
          }
        }
      }
      // Early tool activity: emit activity rows as soon as complete tool blocks are detected
      // in the streaming accumulation — before tools are actually executed.
      // The webview deduplicates by actKind:label, so re-emitting at execution time is safe.
      if (callbacks.onToolActivity) {
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
      textToolProtocol,
    });
    let providerTurn: Awaited<ReturnType<typeof chatWithMessages>>;
    let providerRecoveryCompletedThisRound = false;
    const useFreshProviderSession = roundCount === 1 || forceProviderNewSessionNextTurn;
    if (forceProviderNewSessionNextTurn) {
      callbacks.onToolActivity?.('label', '重建模型会话并从任务事实恢复');
    }
    forceProviderNewSessionNextTurn = false;
    const providerWaitFeedback = new ProviderWaitFeedback(callbacks.onToolActivity, roundCount);
    try {
      providerTurn = await chatWithMessages(
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
          textToolProtocol,
        ),
      );
      providerWaitFeedback.complete();
    } catch (error) {
      const providerFailure = parseAgentProviderFailure(error);
      const disposition = await settleOrRecoverProviderFailureInsideCurrentTask(
        providerFailure,
        sAccum.trim().length,
      );
      if (disposition === 'completed') break;
      if (disposition === 'recovered') continue;
      throw error;
    } finally {
      providerWaitFeedback.stop();
    }
    const { text, tools, providerOperationId } = providerTurn;

    const postProviderSteerMessages = writeAuthority.drainAfterProvider();
    if (postProviderSteerMessages.length > 0) {
      refreshPromptRequirements();
      messages.push({ role: 'assistant', content: text }, ...postProviderSteerMessages);
      lastProviderText = text;
      totalChars += text.length;
      callbacks.onToolActivity?.('label', '已接收最新要求，正在重新规划未执行动作');
      continue;
    }
    if (tools.some(tool => isAgentWorkToolName(tool.name))) {
      const modelSemanticProposal = projectModelToolSemanticProposal(
        tools,
        writeAuthority.semanticContract,
      );
      if (modelSemanticProposal && writeAuthority.applyModelSemanticProposal(modelSemanticProposal)) {
        refreshPromptRequirements();
      }
      refreshPromptRequirements();
      promptRequiresTools = true;
      if (tools.some(tool => tool.purpose === 'workspace-mutation')) promptRequiresFileChange = true;
    }
    if (tools.length > 0) {
      providerRecoveryCompletedThisRound = await providerRecovery.completeAcceptedResponse(
        'tool-protocol',
        providerOperationId,
      );
      unresolvedProviderToolProtocol = false;
    }

    messages.push({ role: 'assistant', content: text }, ...postProviderSteerMessages);
    lastProviderText = text;
    totalChars += text.length;

    const firstToolIndex = findFirstAuthorizedTextToolEnvelopeStart(text, textToolProtocol);
    const preToolProse = firstToolIndex >= 0
      ? stripAuthorizedTextToolEnvelopes(text.slice(0, firstToolIndex), textToolProtocol).trim()
      : '';
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
      const incompleteAuthorizedEnvelope = hasIncompleteAuthorizedTextToolEnvelope(text, textToolProtocol);
      const invalidAuthorizedProtocol = inspectInvalidAuthorizedTextToolProtocol(text, textToolProtocol);
      const quarantinedProtocol = inspectOutOfEnvelopeTextToolProtocol(text, textToolProtocol);
      if (!callbacks.signal?.aborted && (
        incompleteAuthorizedEnvelope
        || invalidAuthorizedProtocol.found
        || quarantinedProtocol.found
      )) {
        noToolRounds++;
        const status = quarantinedProtocol.found
          ? 'out-of-envelope-tool-block'
          : incompleteAuthorizedEnvelope
            ? 'incomplete-tool-block'
            : 'invalid-tool-block';
        const disposition = await settleOrRecoverProviderFailureInsideCurrentTask({
          status,
          reason: quarantinedProtocol.found
            ? `检测到授权信封外的结构化工具动作（${quarantinedProtocol.dialects.join(', ')}）；已隔离且未执行。`
            : incompleteAuthorizedEnvelope
              ? '工具协议信封没有完整闭合，未形成可安全执行的工具参数。'
              : `检测到 ${invalidAuthorizedProtocol.invalidEnvelopeCount} 个未形成无损可执行工具参数的授权信封；已隔离且未执行。`,
          rawMessage: text,
          recoverable: true,
          observedToolNames: [...new Set([
            ...quarantinedProtocol.observedToolNames,
            ...invalidAuthorizedProtocol.observedToolNames,
          ])],
        }, text.trim().length);
        if (disposition === 'completed') break;
        if (disposition === 'recovered') {
          unresolvedProviderToolProtocol = true;
          continue;
        }
        failedReason = 'Provider 连续输出损坏工具协议，未形成可执行工具调用。';
        break;
      }
      const stripped = stripAuthorizedTextToolEnvelopes(text, textToolProtocol).trim();
      if (!callbacks.signal?.aborted && unresolvedProviderToolProtocol) {
        noToolRounds++;
        const disposition = await settleOrRecoverProviderFailureInsideCurrentTask({
          status: 'incomplete-tool-block',
          reason: '安全恢复后仍未形成有效工具调用，上一轮结构化动作尚未解决。',
          rawMessage: text,
          recoverable: true,
        }, text.trim().length);
        if (disposition === 'completed') break;
        if (disposition === 'recovered') continue;
        failedReason = 'Provider 安全恢复后仍未形成有效工具调用。';
        break;
      }
      await providerRecovery.completeAcceptedResponse('plain-response', providerOperationId);
      const evidenceWithoutTools = assessCurrentEvidenceClosure();
      if (await recoverBlockingTerminalFailure(
        evidenceWithoutTools.blockingTerminalFailure,
        evidenceWithoutTools.missingEvidence,
        4,
      )) {
        continue;
      }
      const reviewRecovery = recoverRequirementReviewNoToolCompletion(requirementReview, noToolRounds + 1);
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
      if (!callbacks.signal?.aborted
        && noToolRounds < 2
        && isDeferredAgentActionAnnouncement(stripped)) {
        noToolRounds++;
        await emitAgenticCorrectionStatus(
          '等待行动提案落地',
          '当前回复只预告了后续动作，没有提供完整答案或工具提案。DevSeek 正在要求模型重新确认并落实本轮意图。',
          '要求模型落实预告动作',
        );
        appendUserFeedback([
          '【系统反馈】上一轮只说明了准备采取的后续动作，但没有形成工具调用或完整直接答案。',
          '请重新判断当前用户目标：若需要读取、修改或运行，请立即调用对应工具；若应直接回答，请现在给出完整答案，不要再停在未来动作预告。',
          '本提示不授予任何额外权限，每个具体工具动作仍会独立仲裁。',
        ].join('\n'));
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
      const missingWithoutTools = evidenceWithoutTools.missingEvidence;
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
            && !writeAuthority.semanticContract.mutation.prohibited,
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
    const hasFileWriteIntentThisRound = tools.some(tool => tool.purpose === 'workspace-mutation');
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
    const contextScreen = contextInvestigation.screen(tools, {
      progressEpoch,
      hasWorkspaceMutation: hasFileWriteIntentThisRound,
      consumeContextRefresh: path => toolFailureRecovery.consumeContextRefresh(path),
    });
    for (const toolIndex of contextScreen.blockedToolIndexes) blockedRepeatedToolIndexes.add(toolIndex);
    suppressedTools.push(...contextScreen.suppressedTools);
    loopWarnings.push(...contextScreen.warnings);
    const toolsToExecute = blockedRepeatedToolIndexes.size > 0
      ? tools.filter((_, toolIndex) => !blockedRepeatedToolIndexes.has(toolIndex))
      : tools;
    const progressEpochBeforeTools = progressEpoch;

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
    if (loopRes.toolCallsMade) {
      replaceLatestAssistantToolHistory(messages, textToolProtocol);
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
    loopWarnings.push(...contextInvestigation.record({
      tools: toolsToExecute,
      evidenceRefs: loopRes.evidenceRefs ?? [],
      progressEpoch: progressEpochBeforeTools,
    }));
    const semanticSettlement = await modelSemanticSettlement.observe(loopRes);
    if (semanticSettlement.settled) {
      refreshPromptRequirements();
      allVerificationReceipts.push(...semanticSettlement.verificationReceipts);
      for (const observedPath of semanticSettlement.observationPaths) {
        allReadEvidencePaths.add(observedPath);
      }
    }
    if ((loopRes.readFiles?.length ?? 0) > 0
      || (loopRes.writtenFiles?.length ?? 0) > 0
      || (loopRes.terminalEvidence?.length ?? 0) > 0
      || (loopRes.evidenceRefs?.length ?? 0) > 0) {
      resetProviderRecoveryAttemptsAfterProgress();
    }
    const roundHasTerminalProgress = (loopRes.terminalCommands?.length ?? 0) > 0
      || (loopRes.terminalEvidence?.length ?? 0) > 0;
    const roundHasValidationTerminalProgress = loopRes.terminalEvidence?.some(
      evidence => evidence.kind !== 'other',
    ) === true;
    const failedTerminalWriteCountBeforeRound = failedTerminalWriteCount;
    failedTerminalWriteCount = advanceAutoValidationFailureFence(failedTerminalWriteCount, {
      writeCount: allWrittenFiles.length,
      terminalOutcomes: (loopRes.terminalEvidence ?? []).map(evidence => evidence.ok),
    });
    const repairsTerminalFailure = failedTerminalWriteCountBeforeRound !== undefined
      && allWrittenFiles.length > failedTerminalWriteCountBeforeRound;
    const roundHasContextInvestigationActivity = toolsToExecute.some(
      tool => isContextGatheringToolName(tool.name),
    );
    const roundHasInvestigationActivity = roundHasTerminalProgress
      || roundHasContextInvestigationActivity;
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
    const deferAutoValidation = shouldDeferAgentAutoValidation({
      pendingWriteCount: pendingAutoValidationWrites.length,
      roundHasValidationTerminalProgress,
      roundHasInvestigationActivity,
      pendingCohortHasUnrepairedTerminalFailure: failedTerminalWriteCount === allWrittenFiles.length,
      repairsTerminalFailure,
      completionSignaled: Boolean(loopRes.taskComplete || loopRes.allTodosCompleted),
    });
    const autoValidation: AgentAutoValidationResult = deferAutoValidation
      ? {}
      : await runAgentAutoValidationForWrites(
          pendingAutoValidationWrites,
          workspaceRoot,
          writeAuthority.currentPrompt,
          writeAuthority.callbacks,
          {
            verificationScopeWrittenFiles: allWrittenFiles,
            verificationAcceptance: callbacks.canonicalVerificationAcceptance
              ?? projectAgenticVerificationAcceptance(writeAuthority.completionSemanticContract.taskContract),
            priorVerificationReceipts: currentVerificationReceipts(),
            changeReceipts: allChangeReceipts,
          },
        );
    if (!deferAutoValidation) {
      if (autoValidation.verificationReceipt) allVerificationReceipts.push(autoValidation.verificationReceipt);
      autoValidatedWriteCount = allWrittenFiles.length;
    }
    const normalizedAutoValidation = normalizeAgenticAutoValidation({
      autoValidation,
      userPrompt: writeAuthority.currentPrompt,
      writtenFiles: allWrittenFiles,
    });
    if (pendingAutoValidationWrites.length > 0 && !deferAutoValidation) {
      sourceValidation.settleWriteCohort(allWrittenFiles.length, normalizedAutoValidation.qualityGate);
    }
    if (normalizedAutoValidation.evidence.length) {
      allTerminalEvidence.push(...normalizedAutoValidation.evidence);
      failedTerminalWriteCount = advanceAutoValidationFailureFence(failedTerminalWriteCount, {
        writeCount: allWrittenFiles.length,
        terminalOutcomes: normalizedAutoValidation.evidence.map(evidence => evidence.ok),
      });
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
      completeSummary = loopRes.completeSummary
        ?? cleanAgentFinalSummaryForUser(stripAuthorizedTextToolEnvelopes(text, textToolProtocol));
      failedReason = describeAgenticDeniedToolExecution(deniedToolAfterTools);
      break;
    }

    const evidenceAfterTools = assessCurrentEvidenceClosure();
    const missingAfterTools = evidenceAfterTools.missingEvidence;
    const blockingFailureAfterTools = evidenceAfterTools.blockingTerminalFailure;
    const requirementReviewObligationAfterTools = requirementReview.completionObligation();
    const requirementReviewSourceRepairPending = requirementReviewObligationAfterTools?.kind === 'source-repair';
    lastMissingEvidence = missingAfterTools;
    requirementReviewRepairGraceRounds = renewRequirementReviewRepairWindow({
      currentGraceRounds: requirementReviewRepairGraceRounds,
      baseRoundLimit: maxAgenticRounds,
      roundCount,
      acceptedSourceMutation: loopRes.writtenFiles?.some(file => isCodeArtifactPath(file.path)) === true,
      postMutationValidation: progressEpoch > 0 && roundHasValidationTerminalProgress,
      reviewPending: Boolean(requirementReviewObligationAfterTools),
    });
    executionConvergenceRoundLimit = renewExecutionConvergenceRoundLimit({
      currentRoundLimit: executionConvergenceRoundLimit,
      roundCount,
      maxRoundLimit: callbacks.autopilot
        ? AGENTIC_ROUNDS_AUTOPILOT
        : AGENTIC_ROUNDS_NORMAL_CONVERGENCE_MAX,
      concreteProgress: (loopRes.writtenFiles?.length ?? 0) > 0 || roundHasValidationTerminalProgress,
      unresolvedExecution: missingAfterTools.length > 0 || Boolean(blockingFailureAfterTools),
    });
    const deliveryExpectation = resolveDeliveryConvergenceExpectation({
      mutationRequired: promptRequiresFileChange || requirementReviewSourceRepairPending,
      modelLedUnclassified: writeAuthority.canonicalSemanticContract.signals.includes('model-led-unclassified-turn'),
    });
    const deliveryConvergenceResult = deliveryConvergence.observe({
      expectation: deliveryExpectation,
      deliveryProgressEpoch: progressEpoch,
      deliveryPending: resolveDeliveryConvergencePending({
        expectation: deliveryExpectation,
        deliveryProgressEstablished: progressEpoch > 0,
        completionSignaled: Boolean(loopRes.taskComplete || loopRes.allTodosCompleted),
        unresolvedExecution: missingAfterTools.length > 0 || Boolean(blockingFailureAfterTools),
        actionableRepairPending: requirementReviewSourceRepairPending,
      }),
      actionableRepairPending: requirementReviewSourceRepairPending,
      gatheredEvidenceCount: allReadEvidencePaths.size + allEvidenceRefs.length,
      investigationActivity: roundHasContextInvestigationActivity
        && !providerRecoveryCompletedThisRound,
    });
    if (!callbacks.signal?.aborted && deliveryConvergenceResult.kind === 'correct') {
      await emitAgenticCorrectionStatus(
        deliveryConvergenceResult.statusTitle,
        deliveryConvergenceResult.statusDetail,
        deliveryConvergenceResult.activityLabel,
      );
      loopWarnings.push(deliveryConvergenceResult.feedback);
    } else if (deliveryConvergenceResult.kind === 'stop') {
      failedReason = deliveryConvergenceResult.reason;
      break;
    }

    let reviewFeedback: string | undefined;
    if (!callbacks.signal?.aborted
      && sawWorkTool
      && missingAfterTools.length === 0
      && !blockingFailureAfterTools) {
      const reviewOutcome = await requirementReview.request({
        qualityGate: sourceValidation.qualityGateForCurrentSource(),
        writtenFiles: allWrittenFiles,
        roundReadFiles: loopRes.readFiles ?? [],
        readEvidencePaths: [...allReadEvidencePaths],
        hostFinalSourceEvidenceReady: sourceValidation.currentSourceIsValidated(),
      });
      if (reviewOutcome.kind === 'feedback') {
        reviewFeedback = reviewOutcome.feedback;
        noToolRounds = 0;
        const repairWindow = updateRequirementReviewRepairWindow(
          requirementReviewRepairGraceRounds,
          reviewOutcome.failedReviewCohortStarted,
        );
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
      && (missingAfterTools.length > 0 || blockingFailureAfterTools)
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
        : `【系统反馈】不能结束任务。当前仍缺少可验证的${missingAfterTools.join('、')}。请继续调用实际工具完成缺失项：需要读取时用 read_file/list_dir/只读 run_terminal；需要代码时用 create_file/write_file 写入源码；需要验证时用合适的验证命令，文档/配置只需文件存在和内容证据，代码才需要编译/运行/测试。完成后再调用 task_complete，summary 必须只基于真实工具结果。${autoValidationFeedback ? `\n\n${autoValidationFeedback}` : ''}`;
      appendUserFeedback(retryMessage);
      continue;
    }

    if (blockingFailureAfterTools && loopRes.toolCallsMade && !callbacks.signal?.aborted) {
      const repairPhase = (loopRes.writtenFiles?.length ?? 0) > 0
        && !roundHasValidationTerminalProgress
        ? 'rerun'
        : 'repair';
      loopWarnings.push(buildTerminalFailureRepairFeedback(
        blockingFailureAfterTools,
        missingAfterTools,
        repairPhase,
      ));
    }

    if (loopRes.taskComplete && !reviewFeedback) {
      if (!sawWorkTool && noToolRounds < 2 && !callbacks.signal?.aborted) {
        noToolRounds++;
        const retryMessage = '【系统反馈】task_complete 是工作任务的显式结算信号，但当前没有任何实际读取、写入或命令工具证据。若这是普通问答，请直接返回答案且不要调用 task_complete；若任务需要执行，请先调用必要工具。';
        appendUserFeedback(retryMessage);
        continue;
      }
      if (!sawWorkTool) {
        failedReason = '模型调用 task_complete 时没有任何实际工具证据，任务未完成。';
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
      if (await recoverBlockingTerminalFailure(blockingFailureNow, missingNow, 2)) {
        continue;
      }
      break;
    }

    // Inject tool results into next round
    const feedback = projectAgenticToolFeedbackMessage(roundCount, [
      ...(loopRes.feedbackSegmentsForAI?.length
        ? loopRes.feedbackSegmentsForAI
        : [loopRes.feedbackForAI]),
      autoValidationFeedback,
      ...loopWarnings,
    ]);
    appendUserFeedback(feedback);
  }

  if (callbacks.signal?.aborted) break;
  const completionFenceMessages = writeAuthority.closeForCompletionAndDrain();
  if (completionFenceMessages.length === 0) break;
  if (!writeAuthority.reopenAfterCompletionFence()) {
    failedReason = failedReason || '收到新的用户要求，但当前 turn 无法重新打开输入窗口。';
    break;
  }

  messages.push(...completionFenceMessages);
  totalChars += completionFenceMessages.reduce((sum, message) => sum + message.content.length, 0);
  refreshPromptRequirements();
  steeringRevisionGraceRounds += Math.max(2, Math.min(6, completionFenceMessages.length * 2));
  hadTaskComplete = false;
  completeSummary = '';
  failedReason = '';
  noToolRounds = 0;
  lastMissingEvidence = [];
  callbacks.onToolActivity?.('label', '完成前收到最新要求，正在继续当前任务');
  }

  const finalEvidence = assessCurrentEvidenceClosure();
  const finalMissingEvidence = finalEvidence.missingEvidence;
  const finalBlockingFailure = finalEvidence.blockingTerminalFailure;
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
