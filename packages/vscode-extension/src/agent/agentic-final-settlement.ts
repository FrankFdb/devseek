import type {
  CodingToolExecutionReceipt,
  CodingVerificationReceipt,
  CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import { buildSecretHarvestingRefusalAcceptanceEvidence } from '../intent/safety-intent';
import {
  buildAgenticHistoryText,
  buildAgenticQualityGateForHistory,
  type AgenticHistoryQualityGate,
} from './agentic-history';
import { cleanAgentFinalSummaryForUser } from './agentic-summary';
import {
  coalesceWrittenFileEvidence,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import type { AgentLoopCallbacks, AgentLoopResult } from './loop-types';
import { buildAgenticFailureCheckpointTask } from './agentic-failure-checkpoint';

export interface AgenticFinalSettlementInput {
  userPrompt: string;
  workspaceRoot: string;
  roundCount: number;
  failedReason: string;
  completeSummary: string;
  currentTodos: TodoItem[];
  writtenFiles: WrittenFileEvidence[];
  terminalEvidence: TerminalEvidence[];
  verificationReceipts: CodingVerificationReceipt[];
  toolExecutionReceipts: CodingToolExecutionReceipt<unknown>[];
  changeReceipts: CodingWorkspaceMutationReceipt<unknown>[];
  latestAutoQualityGate?: AgenticHistoryQualityGate;
  policyRefusalEvidenceSatisfied: boolean;
  callbacks: AgentLoopCallbacks;
}

/** Owns terminal UI, history, and evidence projection after the model/tool loop stops. */
export async function settleAgenticLoopFinal(input: AgenticFinalSettlementInput): Promise<AgentLoopResult> {
  const {
    callbacks, completeSummary, currentTodos, failedReason, latestAutoQualityGate,
    policyRefusalEvidenceSatisfied, roundCount, terminalEvidence, userPrompt, workspaceRoot,
  } = input;
  const cleanAbort = callbacks.signal?.aborted ?? false;
  const visibleCompleteSummary = cleanAgentFinalSummaryForUser(completeSummary);
  const finalWrittenFiles = coalesceWrittenFileEvidence(input.writtenFiles, workspaceRoot);
  const manualReviewTerminal = [...terminalEvidence].reverse().find(evidence => evidence.reviewRequired);
  const manualReviewReason = manualReviewTerminal?.detail
    || (manualReviewTerminal ? '运行效果需要人工确认。' : undefined);

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

  const fileSummary = finalWrittenFiles.length > 0
    ? `已完成，修改 ${finalWrittenFiles.length} 个文件：${finalWrittenFiles.map(
      file => `${file.basename} (+${file.linesAdded} -${file.linesRemoved})`,
    ).join('、')}。`
    : '';
  const finalMessage = failedReason
    ? `任务没有完成：${failedReason}`
    : manualReviewReason
      ? `任务已执行，运行效果需要人工确认：${manualReviewReason}`
      : (visibleCompleteSummary || fileSummary || '任务已完成。');
  callbacks.onDelta('\x00ASUM\x00' + finalMessage);

  if (!(cleanAbort || failedReason)) {
    await callbacks.onTaskCheckpoint?.(null, [], 'completed');
  } else if (!policyRefusalEvidenceSatisfied) {
    const pendingTask = buildAgenticFailureCheckpointTask({
      userPrompt,
      failureReason: cleanAbort ? '用户中断。' : failedReason,
      writtenFiles: finalWrittenFiles,
      terminalEvidence,
      todos: currentTodos,
    });
    await callbacks.onTaskCheckpoint?.(0, [pendingTask], 'paused');
  }

  const derivedQualityGate = buildAgenticQualityGateForHistory({
    failedReason: cleanAbort ? '用户中断。' : failedReason,
    writtenFiles: finalWrittenFiles,
    terminalEvidence,
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
    terminalEvidence,
    qualityGate: historyQualityGate,
    workspaceRoot,
  });

  return {
    tasksTotal: 1,
    tasksApplied: finalWrittenFiles.length > 0 ? 1 : 0,
    tasksFailed: cleanAbort || failedReason ? 1 : 0,
    changedPaths: [...new Set(finalWrittenFiles.map(file => file.path))],
    ...(cleanAbort || failedReason ? { failedReason: cleanAbort ? '用户中断。' : failedReason } : {}),
    verificationReceipts: input.verificationReceipts,
    toolExecutionReceipts: input.toolExecutionReceipts,
    changeReceipts: input.changeReceipts,
    ...(policyRefusalEvidenceSatisfied
      ? { acceptanceEvidence: buildSecretHarvestingRefusalAcceptanceEvidence() }
      : {}),
    ...(manualReviewReason ? { manualReviewRequired: true, manualReviewReason } : {}),
    historyText,
  };
}
