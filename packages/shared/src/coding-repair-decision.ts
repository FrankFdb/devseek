import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type { CodingDiagnosticDecision } from './coding-diagnostic';

export const CODING_REPAIR_DECISION_VERSION = 'devseek.coding-repair-decision/v1' as const;

export type CodingRepairAction = 'not-required' | 'retry' | 'replan' | 'blocked';
export type CodingRepairReason =
  | 'verification-clean'
  | 'diagnostic-indeterminate'
  | 'mutation-not-authorized'
  | 'repair-budget-exhausted'
  | 'non-repairable-diagnostic'
  | 'new-repairable-diagnostic'
  | 'transient-failure-retry'
  | 'root-cause-replan-required'
  | 'repeated-mutation-no-progress'
  | 'repeated-diagnostic-no-progress';

export interface CodingRepairDecisionInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly diagnostic: CodingDiagnosticDecision;
  readonly mutationAllowed: boolean;
  readonly canContinue: boolean;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly mutationFingerprint?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingRepairDecision {
  readonly version: typeof CODING_REPAIR_DECISION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly action: CodingRepairAction;
  readonly reason: CodingRepairReason;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly rootCauseReplanRequired: boolean;
  readonly repeatedDiagnostic: boolean;
  readonly repeatedMutation: boolean;
  readonly stagnantRounds: number;
  readonly diagnosticFingerprints: readonly string[];
  readonly mutationFingerprint?: string;
  readonly evidenceRefs: readonly string[];
}

export interface RepairDecisionPort {
  readonly runId: string;
  decide(input: CodingRepairDecisionInput): CodingRepairDecision;
  decisions(): readonly CodingRepairDecision[];
}

export interface RepairDecisionServicePort {
  bind(input: { readonly runId: string }): RepairDecisionPort;
}

export interface ClosedLoopRepairabilityInput {
  readonly applied?: boolean;
  readonly validation?: {
    readonly ran?: boolean;
    readonly ok?: boolean;
    readonly status?: string;
    readonly command?: string;
  };
  readonly qualityGate?: { readonly status?: string };
}

export type ClosedLoopRepairabilityDecision =
  | { readonly repairable: true; readonly reason: 'failed-runnable-validation' }
  | {
      readonly repairable: false;
      readonly reason:
        | 'not-applied'
        | 'missing-validation'
        | 'validation-not-run'
        | 'validation-not-failed'
        | 'validation-ok'
        | 'missing-command'
        | 'quality-gate-blocked';
    };

/** Owns evidence-progress and no-progress decisions; callers only perform the chosen action. */
export class CanonicalRepairDecisionService implements RepairDecisionServicePort {
  bind(input: { readonly runId: string }): RepairDecisionPort {
    return new CanonicalRepairDecisionSession(normalizedCodingId(input.runId, 'repair-run-id'));
  }
}

class CanonicalRepairDecisionSession implements RepairDecisionPort {
  private readonly settled = new Map<string, { input: string; decision: CodingRepairDecision }>();
  private readonly history: CodingRepairDecision[] = [];

  constructor(readonly runId: string) {}

  decide(input: CodingRepairDecisionInput): CodingRepairDecision {
    const snapshot = snapshotRepairInput(input, this.runId);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) repairFailure('conflicting-action-identity');
      return existing.decision;
    }
    const decision = decideRepair(this.runId, snapshot, this.history);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    this.history.push(decision);
    return decision;
  }

  decisions(): readonly CodingRepairDecision[] {
    return Object.freeze([...this.history]);
  }
}

export function decideClosedLoopRepairability(
  input: ClosedLoopRepairabilityInput,
): ClosedLoopRepairabilityDecision {
  const validation = input.validation;
  if (input.applied !== true) return { repairable: false, reason: 'not-applied' };
  if (!validation) return { repairable: false, reason: 'missing-validation' };
  if (validation.ran !== true) return { repairable: false, reason: 'validation-not-run' };
  if (validation.status !== 'failed') return { repairable: false, reason: 'validation-not-failed' };
  if (validation.ok !== false) return { repairable: false, reason: 'validation-ok' };
  if (!validation.command) return { repairable: false, reason: 'missing-command' };
  if (input.qualityGate?.status === 'blocked') return { repairable: false, reason: 'quality-gate-blocked' };
  return { repairable: true, reason: 'failed-runnable-validation' };
}

function decideRepair(
  runId: string,
  input: CodingRepairDecisionInput,
  history: readonly CodingRepairDecision[],
): CodingRepairDecision {
  const fingerprints = uniqueCodingRefs(input.diagnostic.diagnostics.map(item => item.fingerprint)).sort();
  const previous = history.at(-1);
  const repeatedDiagnostic = Boolean(previous)
    && sameValues(previous!.diagnosticFingerprints, fingerprints);
  const repeatedMutation = Boolean(
    input.mutationFingerprint
    && previous
    && previous.mutationFingerprint === input.mutationFingerprint,
  );
  const stagnantRounds = repeatedDiagnostic ? previous!.stagnantRounds + 1 : 0;
  let action: CodingRepairAction;
  let reason: CodingRepairReason;

  if (input.diagnostic.status === 'clean') {
    [action, reason] = ['not-required', 'verification-clean'];
  } else if (input.diagnostic.status === 'indeterminate') {
    [action, reason] = ['blocked', 'diagnostic-indeterminate'];
  } else if (!input.mutationAllowed) {
    [action, reason] = ['blocked', 'mutation-not-authorized'];
  } else if (!input.canContinue || input.attempt >= input.maxAttempts) {
    [action, reason] = ['blocked', 'repair-budget-exhausted'];
  } else if (input.diagnostic.diagnostics.some(item => item.disposition === 'blocked')) {
    [action, reason] = ['blocked', 'non-repairable-diagnostic'];
  } else if (repeatedMutation && repeatedDiagnostic) {
    [action, reason] = ['blocked', 'repeated-mutation-no-progress'];
  } else if (repeatedDiagnostic && previous?.action === 'replan') {
    [action, reason] = ['blocked', 'repeated-diagnostic-no-progress'];
  } else if (repeatedDiagnostic) {
    [action, reason] = ['replan', 'root-cause-replan-required'];
  } else if (input.diagnostic.diagnostics.some(item => item.disposition === 'replan')) {
    [action, reason] = ['replan', 'root-cause-replan-required'];
  } else if (input.diagnostic.diagnostics.every(item => item.disposition === 'retry')) {
    [action, reason] = ['retry', 'transient-failure-retry'];
  } else {
    [action, reason] = ['retry', 'new-repairable-diagnostic'];
  }

  return snapshotCodingValue({
    version: CODING_REPAIR_DECISION_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    action,
    reason,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    rootCauseReplanRequired: action === 'replan',
    repeatedDiagnostic,
    repeatedMutation,
    stagnantRounds,
    diagnosticFingerprints: Object.freeze(fingerprints),
    ...(input.mutationFingerprint ? { mutationFingerprint: input.mutationFingerprint } : {}),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...input.diagnostic.evidenceRefs,
      ...(input.mutationFingerprint ? [`mutation-fingerprint:${input.mutationFingerprint}`] : []),
      `repair-decision:${action}:${reason}`,
    ])),
  }, 'repair-decision') as CodingRepairDecision;
}

function snapshotRepairInput(input: CodingRepairDecisionInput, runId: string): CodingRepairDecisionInput {
  if (input.diagnostic.runId !== runId) repairFailure('diagnostic-run-mismatch');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) repairFailure('invalid-sequence');
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) repairFailure('invalid-attempt');
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) repairFailure('invalid-max-attempts');
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'repair-action-id'),
    diagnostic: snapshotCodingValue(input.diagnostic, 'repair-diagnostic') as CodingDiagnosticDecision,
    mutationAllowed: input.mutationAllowed === true,
    canContinue: input.canContinue === true,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    ...(input.mutationFingerprint
      ? { mutationFingerprint: normalizedCodingId(input.mutationFingerprint, 'mutation-fingerprint') }
      : {}),
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function repairFailure(reason: string): never {
  throw new Error(`coding-repair-decision:${reason}`);
}
