import type { AgentLoopCallbacks } from './loop-types';
import type { AgentAutoValidationResult } from './auto-validation';
import type { ToolLoopResult } from './tool-loop';
import type { TaskExecutionResult } from './task-execution-result';

export interface ValidationOutcome {
  readonly ran: boolean;
  readonly ok: boolean;
  readonly evidenceOperationId?: string;
  readonly command?: string;
  readonly detail?: string;
  readonly reason?: string;
  readonly exitCode?: number | null;
  readonly reviewRequired?: boolean;
  readonly reviewReason?: string;
  readonly toolExecutionReceipts?: NonNullable<ToolLoopResult['toolExecutionReceipts']>;
  readonly verificationReceipt?: NonNullable<TaskExecutionResult['verificationReceipts']>[number];
}

export function autoValidationResultToValidationOutcome(
  result: AgentAutoValidationResult,
): ValidationOutcome | undefined {
  const qualityGate = result.qualityGate;
  const evidence = result.evidence;
  if (!qualityGate && !evidence && !result.feedbackForAI && !result.repairBlockedReason) return undefined;
  const ok = qualityGate ? qualityGate.status === 'pass' : evidence ? evidence.ok : false;
  const detail = [
    evidence?.detail,
    result.repairBlockedReason,
    result.feedbackForAI,
    qualityGate?.summary,
  ].filter(Boolean).join('\n').slice(0, 1200);
  return {
    ran: Boolean(evidence?.command),
    ok,
    evidenceOperationId: result.evidenceOperationId,
    command: evidence?.command,
    detail,
    exitCode: evidence?.exitCode,
    reason: ok
      ? 'auto-validation-passed'
      : qualityGate?.status === 'blocked'
        ? 'quality-gate-blocked'
        : qualityGate?.status === 'fail'
          ? 'quality-gate-failed'
          : result.repairBlockedReason || 'auto-validation-failed',
  };
}

export function combineFinalValidationOutcomes(
  nonLegacyOutcome: ValidationOutcome | undefined,
  legacyOutcome: ValidationOutcome | undefined,
): ValidationOutcome | undefined {
  const outcomes = [nonLegacyOutcome, legacyOutcome].filter((outcome): outcome is ValidationOutcome => Boolean(outcome));
  if (outcomes.length === 0) return undefined;
  return outcomes.find(outcome => !outcome.ok)
    ?? outcomes.find(outcome => outcome.reviewRequired)
    ?? outcomes.find(outcome => outcome.ran)
    ?? outcomes[0];
}

export async function emitLegacyValidationQualityGateStatus(
  callbacks: AgentLoopCallbacks,
  evidenceOperationId: string,
  outcome: ValidationOutcome,
): Promise<void> {
  const state = outcome.ok ? 'completed' : outcome.ran === false ? 'skipped' : 'failed';
  const summary = outcome.ok
    ? `QualityGate 通过：${outcome.command || outcome.reason || 'legacy validation'} 已通过。`
    : state === 'skipped'
      ? `QualityGate 阻塞：${outcome.reason || 'validation-blocked'}。`
      : `QualityGate 未通过：${outcome.reason || 'validation-failed'}。`;
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'quality',
    state: 'started',
    evidenceOperationId,
    title: '评估 legacy 自动验证 QualityGate',
    detail: summary,
  });
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'quality',
    state,
    evidenceOperationId,
    title: outcome.ok
      ? 'legacy 自动验证 QualityGate 通过'
      : state === 'skipped'
        ? 'legacy 自动验证 QualityGate 阻塞'
        : 'legacy 自动验证 QualityGate 未通过',
    detail: summary,
  });
}
