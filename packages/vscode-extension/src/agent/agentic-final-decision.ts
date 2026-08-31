import type {
  CodingToolExecutionReceipt,
  CodingVerificationReceipt,
  CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import { hasUnsafeSecretHarvestingRefusalEvidence } from '../intent/safety-intent';
import type { AgenticEvidenceClosure } from './agentic-execution-evidence';
import {
  type AgenticHistoryQualityGate,
} from './agentic-history';
import { selectAgenticFinalFailure } from './agentic-final-failure';
import { settleAgenticLoopFinal } from './agentic-final-settlement';
import {
  describeBlockingTerminalFailure,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import type { EvidenceRef } from './tool-executor';
import type { AgentLoopCallbacks, AgentLoopResult } from './loop-types';
import { describeProviderOutputIntegrity } from './provider-output-integrity';
import {
  resolveAgentRuntimeTaskAction,
  runtimeStateCanDeliver,
  settleAgentRuntimeState,
} from './agent-runtime-state-machine';
import {
  completeAgentTodos,
  settleMissingEvidenceTodos,
  settleValidationFailureTodos,
} from './task-state-machine';
import {
  inspectIncompleteAuthorizedTextToolProtocol,
  inspectInvalidAuthorizedTextToolProtocol,
  inspectOutOfEnvelopeTextToolProtocol,
  type TextToolProtocolSession,
} from './text-tool-protocol';

export interface AgenticFinalDecisionInput {
  readonly userPrompt: string;
  readonly currentPrompt: string;
  readonly workspaceRoot: string;
  readonly roundCount: number;
  readonly routeChatKind: Parameters<typeof resolveAgentRuntimeTaskAction>[0]['routeChatKind'];
  readonly hadTaskComplete: boolean;
  readonly completeSummary: string;
  readonly existingFailure: string;
  readonly lastProviderText: string;
  readonly lastRoundToolRequestCount: number;
  readonly lastRoundToolExecutionCount: number;
  readonly sawWorkTool: boolean;
  readonly currentTodos: readonly TodoItem[];
  readonly lastMissingEvidence: readonly string[];
  readonly finalEvidence: AgenticEvidenceClosure;
  readonly latestAutoQualityGate?: AgenticHistoryQualityGate;
  readonly requirementReviewBlocker?: string;
  readonly recoveryBlocker?: string;
  readonly textToolProtocol: TextToolProtocolSession;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly readEvidenceCount: number;
  readonly writtenFiles: readonly WrittenFileEvidence[];
  readonly terminalEvidence: readonly TerminalEvidence[];
  readonly verificationReceipts: readonly CodingVerificationReceipt[];
  readonly toolExecutionReceipts: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly callbacks: AgentLoopCallbacks;
}

/** Decides terminal evidence closure, todo state, and final Surface projection. */
export async function settleAgenticFinalDecision(
  input: AgenticFinalDecisionInput,
): Promise<AgentLoopResult> {
  const runtimeTaskAction = resolveAgentRuntimeTaskAction({
    routeChatKind: input.routeChatKind,
    taskComplete: input.hadTaskComplete,
    toolReceipts: input.toolExecutionReceipts,
  });
  const validationFailedReason = input.latestAutoQualityGate
    && input.latestAutoQualityGate.status !== 'pass'
    ? input.latestAutoQualityGate.summary
    : undefined;
  const providerProtocolInvalid = inspectIncompleteAuthorizedTextToolProtocol(
    input.lastProviderText,
    input.textToolProtocol,
  ).found || inspectInvalidAuthorizedTextToolProtocol(
    input.lastProviderText,
    input.textToolProtocol,
  ).found || inspectOutOfEnvelopeTextToolProtocol(
    input.lastProviderText,
    input.textToolProtocol,
  ).found;
  const policyRefusalEvidenceSatisfied = hasUnsafeSecretHarvestingRefusalEvidence(
    input.currentPrompt,
    `${input.completeSummary}\n${input.lastProviderText}`,
    { workToolUsed: input.sawWorkTool, changedFileCount: input.writtenFiles.length },
  );
  const runtimeSettlement = settleAgentRuntimeState({
    taskAction: runtimeTaskAction,
    taskTitle: input.userPrompt,
    providerText: input.completeSummary || input.lastProviderText,
    roundText: input.lastProviderText,
    toolRequests: input.lastRoundToolRequestCount,
    toolExecutions: input.lastRoundToolExecutionCount,
    evidenceRefs: input.evidenceRefs,
    readEvidenceCount: input.readEvidenceCount,
    writtenEvidenceCount: input.writtenFiles.length,
    terminalEvidenceCount: input.terminalEvidence.length,
    validationPassed: input.latestAutoQualityGate?.status === 'pass',
    validationFailedReason,
    policyRefusalEvidenceSatisfied,
    taskComplete: input.hadTaskComplete,
    allTodosCompleted: input.currentTodos.length > 0
      && input.currentTodos.every(todo => todo.status === 'completed'),
    failedReason: input.existingFailure || undefined,
    completionBlocker: input.recoveryBlocker,
    providerOutputObservation: { incompleteToolProtocol: providerProtocolInvalid },
  });
  const providerRuntimeFailure = resolveProviderRuntimeFailure(runtimeTaskAction, runtimeSettlement);
  const missingEvidence = input.finalEvidence.missingEvidence.length > 0
    ? input.finalEvidence.missingEvidence
    : input.lastMissingEvidence;
  const missingEvidenceFailure = missingEvidence.length > 0
    ? `实际执行证据不足：缺少${missingEvidence.join('、')}。`
    : undefined;
  const finalFailure = selectAgenticFinalFailure({
    existingFailure: input.existingFailure,
    terminalValidationFailure: input.finalEvidence.blockingTerminalFailure
      ? describeBlockingTerminalFailure(input.finalEvidence.blockingTerminalFailure)
      : undefined,
    requirementReviewBlocker: input.requirementReviewBlocker,
    missingEvidenceFailure,
    providerRuntimeFailure,
  });
  let currentTodos = [...input.currentTodos];
  if (input.callbacks.onTodoUpdate && input.currentTodos.length > 0) {
    if (finalFailure?.kind === 'terminal-validation') {
      currentTodos = settleValidationFailureTodos(currentTodos);
      await input.callbacks.onTodoUpdate(currentTodos);
    } else if (finalFailure?.kind === 'missing-evidence') {
      currentTodos = settleMissingEvidenceTodos(currentTodos, missingEvidence);
      await input.callbacks.onTodoUpdate(currentTodos);
    } else if (!finalFailure && !input.callbacks.signal?.aborted) {
      currentTodos = completeAgentTodos(currentTodos);
      await input.callbacks.onTodoUpdate(currentTodos);
    }
  }

  return settleAgenticLoopFinal({
    userPrompt: input.userPrompt,
    workspaceRoot: input.workspaceRoot,
    roundCount: input.roundCount,
    failedReason: finalFailure?.reason ?? '',
    completeSummary: input.completeSummary,
    currentTodos,
    writtenFiles: [...input.writtenFiles],
    terminalEvidence: [...input.terminalEvidence],
    verificationReceipts: [...input.verificationReceipts],
    toolExecutionReceipts: [...input.toolExecutionReceipts],
    changeReceipts: [...input.changeReceipts],
    latestAutoQualityGate: input.latestAutoQualityGate,
    policyRefusalEvidenceSatisfied,
    callbacks: input.callbacks,
  });
}

function resolveProviderRuntimeFailure(
  taskAction: ReturnType<typeof resolveAgentRuntimeTaskAction>,
  settlement: ReturnType<typeof settleAgentRuntimeState>,
): string | undefined {
  if (settlement.state === 'failed') {
    return settlement.failedReason || describeProviderOutputIntegrity(settlement.providerOutput.kind);
  }
  if (settlement.state === 'tool_requested' && settlement.providerOutput.toolCallCount > 0) {
    return 'Provider 返回了工具调用，但本轮没有执行到任何工具；任务未完成。';
  }
  if (runtimeStateCanDeliver(settlement)) return undefined;
  if (taskAction === 'respond') return describeProviderOutputIntegrity(settlement.providerOutput.kind);
  return settlement.failedReason
    || `任务已有执行证据，但缺少完成信号、通过验证或可交付总结：${describeProviderOutputIntegrity(settlement.providerOutput.kind)}`;
}
