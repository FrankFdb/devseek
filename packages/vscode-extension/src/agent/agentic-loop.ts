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
  isBlockingTerminalFailureEvidence,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import { buildTerminalFailureRepairFeedback } from './terminal-failure-repair';
import { TerminalFailureProgressLedger } from './terminal-failure-progress';
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
  inspectIncompleteAuthorizedTextToolProtocol,
  inspectInvalidAuthorizedTextToolProtocol,
  inspectOutOfEnvelopeTextToolProtocol,
  parseAuthorizedTextToolCalls,
  stripAuthorizedTextToolEnvelopes,
} from './text-tool-protocol';
import { recoverRequirementReviewNoToolCompletion } from './requirement-review-no-tool-recovery';
import {
  agentAnnouncementKey,
  cleanAgentFinalSummaryForUser,
  normalizeAgentUserAnnouncement,
} from './agentic-summary';
import { resolveNoToolActionRecovery } from './no-tool-action-recovery';
import {
  getTerminalRecoveryProtocol,
  TerminalCommandProgressLedger,
} from './write-guard';
import {
  buildTaskTerminalFailureDetail,
  withTaskTerminalEvidence,
} from './task-execution-result';
import type { AgentLoopCallbacks, AgentLoopResult } from './loop-types';
import { copyAgentLoopCallbacks } from './loop-callbacks';
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
import { describeProviderOutputIntegrity } from './provider-output-integrity';
import {
  parseAgentProviderFailure,
} from './provider-response-recovery';
import {
  projectProviderRecoveryScreenFeedback,
} from './agentic-provider-recovery-boundary';
import {
  replaceLatestAssistantToolHistory,
} from './agent-history-compaction';
import {
  compactAgenticMessageHistory,
  projectAgenticToolFeedback,
} from './agentic-context-compaction';
import { deliverAgenticToolFeedback } from './agentic-tool-feedback-delivery';
import { ToolFailureRecoveryLedger } from './tool-failure-recovery';
import { QualityGateStagnationLedger } from './quality-gate-stagnation';
import { SourceValidationLedger } from './source-validation-ledger';
import { createProviderRequirementReviewService } from './provider-requirement-review';
import { shouldEnterRequirementReview } from './requirement-review-policy';
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
  resolveAgenticRoundBudgetFailure,
  selectAgenticFinalFailure,
} from './agentic-final-failure';
import {
  DeliveryConvergenceLedger,
  isContextGatheringToolName,
  resolveDeliveryConvergenceExpectation,
  resolveDeliveryRoundActivity,
  resolveDeliveryConvergencePending,
} from './context-convergence-feedback';
import { ContextInvestigationLedger } from './context-investigation-ledger';
import { createModelSemanticSettlementService } from './model-semantic-settlement';
import { resolveAgenticPromptRequirements } from './agentic-prompt-requirements';
import { AgenticProviderRecoveryCoordinator } from './agentic-provider-recovery-coordinator';
import { settleAgenticFinalDecision } from './agentic-final-decision';

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
  let lastRoundToolExecutionCount = 0;
  const announcedProseKeys = new Set<string>();
  const allReadEvidencePaths = new Set<string>();
  const toolFailureRecovery = new ToolFailureRecoveryLedger({ workspaceRoot });
  const contextInvestigation = new ContextInvestigationLedger(workspaceRoot);
  const deliveryConvergence = new DeliveryConvergenceLedger();
  const qualityGateStagnation = new QualityGateStagnationLedger();
  const terminalFailureProgress = new TerminalFailureProgressLedger();
  let providerRecoveryCoordinator: AgenticProviderRecoveryCoordinator;
  const requirementReview = createProviderRequirementReviewService({
    userPrompt: () => writeAuthority.currentPrompt,
    workspaceRoot,
    mode,
    callbacks,
    onProviderSessionReplaced: () => providerRecoveryCoordinator.requestFreshProviderSession(),
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
  const currentCompletionBlockers = () => [
    requirementReview.completionBlocker(),
    providerRecoveryCoordinator.lifecycle.completionBlocker(),
    toolFailureRecovery.completionBlocker(),
  ];
  providerRecoveryCoordinator = new AgenticProviderRecoveryCoordinator({
    workspaceRoot,
    taskFile: initialDisplayTarget,
    taskAction: initialDisplayAction,
    callbacks,
    executionContext,
    writeAuthority,
    requirementReview,
    sourceValidation,
    terminalFailureProgress,
    contextInvestigation,
    textToolProtocol,
    messages,
    evidenceRefs: allEvidenceRefs,
    readEvidencePaths: allReadEvidencePaths,
    writtenFiles: allWrittenFiles,
    terminalEvidence: allTerminalEvidence,
    appendUserFeedback,
    state: {
      promptRequiresTools: () => promptRequiresTools,
      sawWorkTool: () => sawWorkTool,
      currentTodos: () => currentTodos,
      noToolRounds: () => noToolRounds,
      setNoToolRounds: value => { noToolRounds = value; },
      round: () => roundCount,
      totalChars: () => totalChars,
      setTotalChars: value => { totalChars = value; },
      completionBlockers: currentCompletionBlockers,
      complete: summary => {
        completeSummary = completeSummary || summary;
        hadTaskComplete = true;
      },
    },
  });
  const providerRecovery = providerRecoveryCoordinator.lifecycle;
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
  const terminalCommandProgress = new TerminalCommandProgressLedger();
  const currentRoundLimit = () => Math.max(
    executionConvergenceRoundLimit,
    maxAgenticRounds + requirementReviewRepairGraceRounds + steeringRevisionGraceRounds,
  );
  let loopSettlementReached = false;
  for (;;) {
  loopSettlementReached = false;
  while (roundCount < currentRoundLimit()) {
    if (callbacks.signal?.aborted) break;
    roundCount++;
    lastRoundToolRequestCount = 0;
    lastRoundToolExecutionCount = 0;

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
    const useFreshProviderSession = providerRecoveryCoordinator.takeFreshProviderSession(roundCount);
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
        () => contextInvestigation.reset(),
      );
      providerWaitFeedback.complete();
    } catch (error) {
      const providerFailure = parseAgentProviderFailure(error);
      const disposition = await providerRecoveryCoordinator.settleOrRecover(
        providerFailure,
        sAccum.trim().length,
      );
      if (disposition === 'completed') {
        loopSettlementReached = true;
        break;
      }
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
      const incompleteAuthorizedProtocol = inspectIncompleteAuthorizedTextToolProtocol(text, textToolProtocol);
      const invalidAuthorizedProtocol = inspectInvalidAuthorizedTextToolProtocol(text, textToolProtocol);
      const quarantinedProtocol = inspectOutOfEnvelopeTextToolProtocol(text, textToolProtocol);
      if (!callbacks.signal?.aborted && (
        incompleteAuthorizedProtocol.found
        || invalidAuthorizedProtocol.found
        || quarantinedProtocol.found
      )) {
        noToolRounds++;
        const status = quarantinedProtocol.found
          ? 'out-of-envelope-tool-block'
          : incompleteAuthorizedProtocol.found
            ? 'incomplete-tool-block'
            : 'invalid-tool-block';
        const disposition = await providerRecoveryCoordinator.settleOrRecover({
          status,
          reason: quarantinedProtocol.found
            ? `检测到授权信封外的结构化工具动作（${quarantinedProtocol.dialects.join(', ')}）；已隔离且未执行。`
            : incompleteAuthorizedProtocol.found
              ? '工具协议信封没有完整闭合，未形成可安全执行的工具参数。'
              : `检测到 ${invalidAuthorizedProtocol.invalidEnvelopeCount} 个未形成无损可执行工具参数的授权信封；已隔离且未执行。`,
          rawMessage: text,
          recoverable: true,
          observedToolNames: [...new Set([
            ...incompleteAuthorizedProtocol.observedToolNames,
            ...quarantinedProtocol.observedToolNames,
            ...invalidAuthorizedProtocol.observedToolNames,
          ])],
        }, text.trim().length);
        if (disposition === 'completed') {
          loopSettlementReached = true;
          break;
        }
        if (disposition === 'recovered') {
          continue;
        }
        failedReason = 'Provider 连续输出损坏工具协议，未形成可执行工具调用。';
        break;
      }
      const stripped = stripAuthorizedTextToolEnvelopes(text, textToolProtocol).trim();
      if (!callbacks.signal?.aborted && providerRecovery.hasUnresolvedToolAction()) {
        noToolRounds++;
        const disposition = await providerRecoveryCoordinator.settleOrRecover({
          status: 'incomplete-tool-block',
          reason: '安全恢复后仍未形成有效工具调用，上一轮结构化动作尚未解决。',
          rawMessage: text,
          recoverable: true,
          observedToolNames: providerRecovery.pendingObservedToolNames(),
        }, text.trim().length);
        if (disposition === 'completed') {
          loopSettlementReached = true;
          break;
        }
        if (disposition === 'recovered') continue;
        failedReason = 'Provider 安全恢复后仍未形成有效工具调用。';
        break;
      }
      await providerRecovery.completeAcceptedResponse('plain-response', providerOperationId);
      const evidenceWithoutTools = assessCurrentEvidenceClosure();
      const actionRecovery = resolveNoToolActionRecovery({
        text: stripped, noToolRounds, promptRequiresTools, sawWorkTool, textToolProtocol,
        missingEvidenceCount: evidenceWithoutTools.missingEvidence.length,
      });
      if (actionRecovery?.kind === 'stop') {
        if (!callbacks.signal?.aborted) failedReason = actionRecovery.reason;
        break;
      }
      if (await providerRecoveryCoordinator.recoverBlockingTerminalFailure(
        evidenceWithoutTools.blockingTerminalFailure,
        evidenceWithoutTools.missingEvidence, 4, actionRecovery,
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
        await providerRecoveryCoordinator.emitCorrectionStatus(
          reviewRecovery.statusTitle,
          reviewRecovery.statusDetail,
          reviewRecovery.statusActivity,
        );
        appendUserFeedback(reviewRecovery.feedback);
        continue;
      }
      if (!callbacks.signal?.aborted && actionRecovery) {
        noToolRounds++;
        if (actionRecovery.useFreshProviderSession) {
          providerRecoveryCoordinator.rebuildWithCausalFeedback(actionRecovery.feedback);
        } else {
          appendUserFeedback(actionRecovery.feedback);
        }
        await providerRecoveryCoordinator.emitCorrectionStatus(
          actionRecovery.statusTitle,
          actionRecovery.statusDetail,
          actionRecovery.activityLabel,
        );
        continue;
      }
      const missingWithoutTools = evidenceWithoutTools.missingEvidence;
      if (!callbacks.signal?.aborted && missingWithoutTools.length > 0 && noToolRounds < 4) {
        noToolRounds++;
        await providerRecoveryCoordinator.emitCorrectionStatus(
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
      loopSettlementReached = !failedReason;
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
    const projectedReadContinuations = contextInvestigation.reconcileProjectedReadContinuations(tools);
    const screenedTools = tools.map((tool, toolIndex) => {
      const input = projectedReadContinuations.inputOverrides.get(toolIndex);
      return input ? { ...tool, input } : tool;
    });
    loopWarnings.push(...projectedReadContinuations.warnings);
    const providerRecoveryScreen = providerRecovery.screenToolProposals(screenedTools, {
      projectedReadContinuationToolIndexes: projectedReadContinuations.continuationToolIndexes,
    });
    await providerRecovery.completeAdmittedToolProposal(
      screenedTools,
      providerRecoveryScreen,
      providerOperationId,
    );
    for (const toolIndex of providerRecoveryScreen.blockedToolIndexes) {
      blockedRepeatedToolIndexes.add(toolIndex);
      suppressedTools.push({
        tool: screenedTools[toolIndex]?.name ?? 'unknown',
        reason: 'provider-recovery-action-budget',
      });
    }
    const failureInvestigationScreen = terminalFailureProgress.screen(screenedTools);
    for (const toolIndex of failureInvestigationScreen.blockedToolIndexes) {
      blockedRepeatedToolIndexes.add(toolIndex);
    }
    suppressedTools.push(...failureInvestigationScreen.suppressedTools);
    loopWarnings.push(...failureInvestigationScreen.warnings);
    const hasAdmittedFileWriteIntentThisRound = screenedTools.some((tool, toolIndex) => (
      tool.purpose === 'workspace-mutation' && !blockedRepeatedToolIndexes.has(toolIndex)
    ));
    screenedTools.forEach((tool, toolIndex) => {
      if (tool.name !== 'run_terminal') return;
      const command = typeof tool.input.command === 'string' ? tool.input.command.trim() : '';
      if (!command) return;
      const commandProgress = terminalCommandProgress.inspect(command, progressEpoch);
      if (commandProgress.repeatedWithoutProgress && !hasAdmittedFileWriteIntentThisRound) {
        blockedRepeatedToolIndexes.add(toolIndex);
        suppressedTools.push({ tool: tool.name, reason: 'repeated-terminal-without-progress' });
        loopWarnings.push(getTerminalRecoveryProtocol(command, commandProgress.nextAttempt));
        callbacks.onToolActivity?.('terminal', `跳过重复命令: ${commandProgress.signature.slice(0, 50)}`);
      }
    });
    const contextScreen = contextInvestigation.screen(screenedTools, {
      progressEpoch,
      hasWorkspaceMutation: hasAdmittedFileWriteIntentThisRound,
      consumeContextRefresh: path => toolFailureRecovery.consumeContextRefresh(path),
      alreadyBlockedToolIndexes: blockedRepeatedToolIndexes,
      providerRecoveryContextRefreshToolIndexes: providerRecoveryScreen.contextRefreshToolIndexes,
    });
    for (const toolIndex of contextScreen.blockedToolIndexes) blockedRepeatedToolIndexes.add(toolIndex);
    suppressedTools.push(...contextScreen.suppressedTools);
    loopWarnings.push(...contextScreen.warnings);
    const toolsToExecute = blockedRepeatedToolIndexes.size > 0
      ? screenedTools.filter((_, toolIndex) => !blockedRepeatedToolIndexes.has(toolIndex))
      : screenedTools;
    const unresolvedProviderActionFeedback = providerRecovery.unresolvedToolActionFeedback(textToolProtocol);
    if (unresolvedProviderActionFeedback) loopWarnings.push(unresolvedProviderActionFeedback);
    const progressEpochBeforeTools = progressEpoch;
    const terminalEvidenceCountBeforeRound = allTerminalEvidence.length;

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
          readEvidencePaths: contextInvestigation.completeReadPaths(),
          targetedReadEvidencePaths: contextInvestigation.visibleReadPaths(),
          verificationScopeFiles: allWrittenFiles,
          suppressedTools,
        },
      ),
    );
    loopWarnings.push(...projectProviderRecoveryScreenFeedback(
      providerRecoveryScreen,
      loopRes,
      providerRecovery.hasUnresolvedToolAction(),
    ));
    const providerNativeTextTools = screenedTools.filter(tool => tool.source === 'provider-native-text');
    if (loopRes.toolCallsMade || providerNativeTextTools.length > 0) {
      replaceLatestAssistantToolHistory(messages, textToolProtocol, providerNativeTextTools);
    }

    if (loopRes.workToolCallsMade) {
      sawWorkTool = true;
      noToolRounds = 0;
    }
    lastRoundToolExecutionCount = loopRes.toolCallsMade ? 1 : 0;

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
      providerRecoveryCoordinator.resetAfterProgress();
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
    // Tool outputs become Provider history before any settlement branch can
    // break or continue. A completion-fence correction must see the exact
    // results produced by the turn it is reopening.
    const toolFeedbackDelivery = deliverAgenticToolFeedback({
      round: roundCount,
      result: loopRes,
      additionalSegments: loopWarnings,
      contextInvestigation,
      appendUserFeedback,
    });
    const deliveredLoopWarningCount = loopWarnings.length;
    const investigationEvidenceFeedback = terminalFailureProgress.recordInvestigationEvidence(
      toolFeedbackDelivery.novelReadExposureCount > 0
        || (loopRes.evidenceRefs ?? []).some(evidence => (
          evidence.kind === 'search'
            || evidence.kind === 'diagnostics'
            || evidence.kind === 'memory'
        )),
    );
    if (investigationEvidenceFeedback) loopWarnings.push(investigationEvidenceFeedback);
    if (failedReason) {
      break;
    }
    const pendingAutoValidationWrites = allWrittenFiles.slice(autoValidatedWriteCount);
    if (pendingAutoValidationWrites.length > 0) {
      sourceValidation.beginWriteCohort(
        allWrittenFiles.length,
        terminalEvidenceCountBeforeRound,
      );
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
    const freshTerminalEvidence = [
      ...(loopRes.terminalEvidence ?? []),
      ...normalizedAutoValidation.evidence,
    ];
    const failureProgressObservation = terminalFailureProgress.observe(
      assessCurrentEvidenceClosure().blockingTerminalFailure,
      progressEpoch,
      freshTerminalEvidence.some(isBlockingTerminalFailureEvidence),
    );
    if (failureProgressObservation.newlyRequiresInvestigation && !callbacks.signal?.aborted) {
      await providerRecoveryCoordinator.emitCorrectionStatus(
        '修复未改变失败，转入根因取证',
        `连续 ${failureProgressObservation.unchangedRepairCohorts} 个修复批次未改变核心诊断。`,
        '公开验证已证伪当前修复假设',
      );
    }
    const autoValidationFeedback = [
      normalizedAutoValidation.feedbackForAI,
      qualityGateFeedback,
      failureProgressObservation.feedback,
    ].filter(Boolean).join('\n\n');

    const validationCommandsThisRound = (loopRes.terminalEvidence ?? [])
      .filter(evidence => evidence.kind !== 'other')
      .map(evidence => evidence.command);
    const terminalProgress = terminalCommandProgress.observe(
      loopRes.terminalCommands ?? [], progressEpoch, validationCommandsThisRound,
    );
    loopWarnings.push(...terminalProgress.warnings);
    const roundHasNovelValidationTerminalProgress = terminalProgress.hasNovelEligibleCommand;
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
    const failedMutationRepairPending = toolFailureRecovery.hasPendingMutationRepair();
    const actionableRepairPending = requirementReviewSourceRepairPending || failedMutationRepairPending;
    const actionableRepairSource = requirementReviewSourceRepairPending
      ? 'requirement-review' as const
      : failedMutationRepairPending
        ? 'failed-mutation' as const
        : undefined;
    const novelNonReadContextToolCount = contextScreen.admittedNovelContextToolCount
      - contextScreen.admittedNovelReadToolCount;
    const repeatedTerminalSuppressed = suppressedTools.some(
      suppression => suppression.reason === 'repeated-terminal-without-progress',
    );
    const deliveryConvergenceResult = deliveryConvergence.observe({
      expectation: deliveryExpectation,
      deliveryProgressEpoch: progressEpoch,
      deliveryPending: resolveDeliveryConvergencePending({
        expectation: deliveryExpectation,
        deliveryProgressEstablished: progressEpoch > 0,
        completionSignaled: Boolean(loopRes.taskComplete || loopRes.allTodosCompleted),
        unresolvedExecution: missingAfterTools.length > 0 || Boolean(blockingFailureAfterTools),
        actionableRepairPending,
      }),
      actionableRepairSource,
      gatheredEvidenceCount: allReadEvidencePaths.size + allEvidenceRefs.length,
      ...resolveDeliveryRoundActivity({
        hasContextInvestigationActivity: roundHasContextInvestigationActivity,
        hasNovelContextEvidence: !repeatedTerminalSuppressed && (
          toolFeedbackDelivery.novelReadExposureCount > 0
          || novelNonReadContextToolCount > 0
        ),
        hasAcceptedWorkspaceMutation: (loopRes.writtenFiles?.length ?? 0) > 0,
        acceptedRecoveryContextRefresh: contextScreen.acceptedRecoveryContextRefresh,
        expectation: deliveryExpectation,
        hasNovelValidationTerminalProgress: roundHasNovelValidationTerminalProgress,
      }),
    });
    const deliveryContextStopReason = contextScreen.suppressedContextToolCount > 0
      && toolFeedbackDelivery.novelReadExposureCount === 0
      && novelNonReadContextToolCount === 0
      && !roundHasNovelValidationTerminalProgress
      ? deliveryConvergence.recordSuppressedInvestigationRound(
        allReadEvidencePaths.size + allEvidenceRefs.length,
      )
      : undefined;
    if (!callbacks.signal?.aborted && deliveryConvergenceResult.kind === 'correct') {
      await providerRecoveryCoordinator.emitCorrectionStatus(
        deliveryConvergenceResult.statusTitle,
        deliveryConvergenceResult.statusDetail,
        deliveryConvergenceResult.activityLabel,
      );
      loopWarnings.push(deliveryConvergenceResult.feedback);
    } else if (deliveryConvergenceResult.kind === 'stop') {
      failedReason = deliveryConvergenceResult.reason;
      break;
    }
    if (deliveryContextStopReason) {
      failedReason = deliveryContextStopReason;
      break;
    }

    let reviewFeedback: string | undefined;
    if (!callbacks.signal?.aborted && shouldEnterRequirementReview({
      workObserved: sawWorkTool,
      completionSignaled: Boolean(loopRes.taskComplete || loopRes.allTodosCompleted),
      missingEvidenceCount: missingAfterTools.length,
      hasBlockingTerminalFailure: Boolean(blockingFailureAfterTools),
    })) {
      const reviewOutcome = await requirementReview.request({
        qualityGate: sourceValidation.qualityGateForCurrentSource(),
        validationEvidence: sourceValidation.terminalEvidenceForCurrentSource(allTerminalEvidence),
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
          await providerRecoveryCoordinator.emitCorrectionStatus(...repairWindow.failureStatus);
        }
        loopWarnings.push(reviewFeedback);
      } else if (reviewOutcome.kind === 'settled') {
        hadTaskComplete = hadTaskComplete || loopRes.taskComplete;
        if (loopRes.completeSummary !== undefined) completeSummary = loopRes.completeSummary ?? '';
        loopSettlementReached = true;
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
        ? `${buildTerminalFailureRepairFeedback(
          blockingFailureAfterTools,
          missingAfterTools,
          terminalFailureProgress.requiresInvestigation() ? 'investigate' : 'repair',
        )}${autoValidationFeedback ? `\n\n${autoValidationFeedback}` : ''}`
        : `【系统反馈】不能结束任务。当前仍缺少可验证的${missingAfterTools.join('、')}。请继续调用实际工具完成缺失项：需要读取时用 read_file/list_dir/只读 run_terminal；需要代码时用 create_file/write_file 写入源码；需要验证时用合适的验证命令，文档/配置只需文件存在和内容证据，代码才需要编译/运行/测试。完成后再调用 task_complete，summary 必须只基于真实工具结果。${autoValidationFeedback ? `\n\n${autoValidationFeedback}` : ''}`;
      appendUserFeedback(retryMessage);
      continue;
    }

    if (blockingFailureAfterTools && loopRes.toolCallsMade && !callbacks.signal?.aborted) {
      const repairPhase = terminalFailureProgress.requiresInvestigation()
        ? 'investigate'
        : (loopRes.writtenFiles?.length ?? 0) > 0
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
      loopSettlementReached = true;
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
      loopSettlementReached = true;
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
      if (await providerRecoveryCoordinator.recoverBlockingTerminalFailure(blockingFailureNow, missingNow, 2)) {
        continue;
      }
      loopSettlementReached = true;
      break;
    }

    const postToolFeedback = [
      autoValidationFeedback,
      ...loopWarnings.slice(deliveredLoopWarningCount),
    ].filter(Boolean);
    if (postToolFeedback.length > 0) {
      appendUserFeedback(projectAgenticToolFeedback(roundCount, postToolFeedback).message);
    }
  }

  if (callbacks.signal?.aborted) break;
  const completionFenceMessages = writeAuthority.closeForCompletionAndDrain();
  if (completionFenceMessages.length === 0) {
    failedReason = failedReason || resolveAgenticRoundBudgetFailure({
      roundCount,
      roundLimit: currentRoundLimit(),
      settlementReached: loopSettlementReached,
      aborted: callbacks.signal?.aborted ?? false,
      completionBlockers: currentCompletionBlockers(),
    }) || '';
    break;
  }
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
  const latestAutoQualityGate = sourceValidation.qualityGateForCurrentSource();
  return settleAgenticFinalDecision({
    userPrompt,
    currentPrompt: writeAuthority.currentPrompt,
    workspaceRoot,
    roundCount,
    routeChatKind: currentTaskIntent.chatKind,
    hadTaskComplete,
    completeSummary,
    existingFailure: failedReason,
    lastProviderText,
    lastRoundToolRequestCount,
    lastRoundToolExecutionCount,
    sawWorkTool,
    currentTodos,
    lastMissingEvidence,
    finalEvidence,
    latestAutoQualityGate,
    requirementReviewBlocker: requirementReview.completionBlocker(),
    recoveryBlocker: providerRecovery.completionBlocker() ?? toolFailureRecovery.completionBlocker(),
    textToolProtocol,
    evidenceRefs: allEvidenceRefs,
    readEvidenceCount: allReadEvidencePaths.size,
    writtenFiles: allWrittenFiles,
    terminalEvidence: allTerminalEvidence,
    verificationReceipts: [...allVerificationReceipts],
    toolExecutionReceipts: allToolExecutionReceipts,
    changeReceipts: allChangeReceipts,
    callbacks,
  });
}

function projectAgenticVerificationAcceptance(
  taskContract: Parameters<typeof projectTaskContractAcceptance>[0],
) {
  return projectTaskContractAcceptance(taskContract)
    .filter(criterion => criterion.id === 'verified');
}
