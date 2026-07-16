export const DEFAULT_REPAIR_ROUND_BUDGET = 6;
export const MAX_CONFIGURED_REPAIR_ROUND_BUDGET = 6;
export const USER_CONTINUE_REPAIR_ROUNDS = 3;

export interface BoundedRepairProgressInput {
  validationFailed: boolean;
  canContinue: boolean;
  repeatedRepairAttempt: boolean;
  stagnantFailureRounds: number;
}

export type BoundedRepairProgressDecision =
  | { kind: 'progressing' }
  | {
      kind: 'retry-with-root-cause';
      repeatedRepairAttempt: boolean;
      stagnantFailureRounds: number;
    }
  | {
      kind: 'stop-no-progress';
      repeatedRepairAttempt: boolean;
      stagnantFailureRounds: number;
    };

export interface ClosedLoopRepairabilityInput {
  applied?: boolean;
  validation?: {
    ran?: boolean;
    ok?: boolean;
    status?: string;
    command?: string;
  };
  qualityGate?: {
    status?: string;
  };
}

export type ClosedLoopRepairabilityDecision =
  | { repairable: true; reason: 'failed-runnable-validation' }
  | {
      repairable: false;
      reason:
        | 'not-applied'
        | 'missing-validation'
        | 'validation-not-run'
        | 'validation-not-failed'
        | 'validation-ok'
        | 'missing-command'
        | 'quality-gate-blocked';
    };

export function normalizeRepairRoundBudget(configured: unknown): number {
  const parsed = Number(configured);
  const effective = Number.isFinite(parsed) ? parsed : DEFAULT_REPAIR_ROUND_BUDGET;
  return Math.max(0, Math.min(MAX_CONFIGURED_REPAIR_ROUND_BUDGET, Math.trunc(effective)));
}

export function extendRepairRoundBudget(current: unknown): number {
  const parsed = Number(current);
  const effective = Number.isFinite(parsed) ? parsed : 0;
  return Math.max(0, Math.trunc(effective)) + USER_CONTINUE_REPAIR_ROUNDS;
}

export function decideBoundedRepairProgress(input: BoundedRepairProgressInput): BoundedRepairProgressDecision {
  if (!input.validationFailed) return { kind: 'progressing' };

  const stagnantFailureRounds = Math.max(0, Math.trunc(Number(input.stagnantFailureRounds) || 0));
  const repeatedRepairAttempt = input.repeatedRepairAttempt === true;

  if (stagnantFailureRounds >= 2 || (stagnantFailureRounds >= 1 && repeatedRepairAttempt)) {
    return {
      kind: 'stop-no-progress',
      repeatedRepairAttempt,
      stagnantFailureRounds,
    };
  }

  if (input.canContinue && (stagnantFailureRounds >= 1 || repeatedRepairAttempt)) {
    return {
      kind: 'retry-with-root-cause',
      repeatedRepairAttempt,
      stagnantFailureRounds,
    };
  }

  return { kind: 'progressing' };
}

export function decideClosedLoopRepairability(input: ClosedLoopRepairabilityInput): ClosedLoopRepairabilityDecision {
  const validation = input.validation;
  const qualityGate = input.qualityGate;

  if (input.applied !== true) return { repairable: false, reason: 'not-applied' };
  if (!validation) return { repairable: false, reason: 'missing-validation' };
  if (validation.ran !== true) return { repairable: false, reason: 'validation-not-run' };
  if (validation.status !== 'failed') return { repairable: false, reason: 'validation-not-failed' };
  if (validation.ok !== false) return { repairable: false, reason: 'validation-ok' };
  if (!validation.command) return { repairable: false, reason: 'missing-command' };
  if (qualityGate?.status === 'blocked') return { repairable: false, reason: 'quality-gate-blocked' };

  return { repairable: true, reason: 'failed-runnable-validation' };
}
