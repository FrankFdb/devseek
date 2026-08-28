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
