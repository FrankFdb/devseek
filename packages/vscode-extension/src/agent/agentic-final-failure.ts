export type AgenticFinalFailureKind =
  | 'existing'
  | 'terminal-validation'
  | 'requirement-review'
  | 'missing-evidence'
  | 'provider-runtime';

export interface AgenticFinalFailureCandidates {
  existingFailure?: string;
  terminalValidationFailure?: string;
  requirementReviewBlocker?: string;
  missingEvidenceFailure?: string;
  providerRuntimeFailure?: string;
}

export interface AgenticFinalFailureSelection {
  kind: AgenticFinalFailureKind;
  reason: string;
}

export interface AgenticRoundBudgetObservation {
  readonly roundCount: number;
  readonly roundLimit: number;
  readonly settlementReached: boolean;
  readonly aborted: boolean;
  readonly completionBlockers?: readonly (string | undefined)[];
}

/** Converts natural loop exhaustion into an explicit non-delivery result. */
export function resolveAgenticRoundBudgetFailure(
  input: AgenticRoundBudgetObservation,
): string | undefined {
  if (input.aborted || input.settlementReached || input.roundCount < input.roundLimit) {
    return undefined;
  }
  const blocker = input.completionBlockers
    ?.map(reason => reason?.trim())
    .find((reason): reason is string => Boolean(reason));
  return blocker
    ?? `智能体在 ${input.roundCount} 轮执行预算内未形成可结算的最终响应；最后一轮要求继续执行或恢复，任务未完成。`;
}

/** Selects the most concrete unresolved completion obligation for user-visible settlement. */
export function selectAgenticFinalFailure(
  input: AgenticFinalFailureCandidates,
): AgenticFinalFailureSelection | undefined {
  const ordered: readonly [AgenticFinalFailureKind, string | undefined][] = [
    ['existing', input.existingFailure],
    ['terminal-validation', input.terminalValidationFailure],
    ['requirement-review', input.requirementReviewBlocker],
    ['missing-evidence', input.missingEvidenceFailure],
    ['provider-runtime', input.providerRuntimeFailure],
  ];
  for (const [kind, reason] of ordered) {
    const normalized = reason?.trim();
    if (normalized) return { kind, reason: normalized };
  }
  return undefined;
}
