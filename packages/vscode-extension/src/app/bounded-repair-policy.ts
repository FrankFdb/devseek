export const DEFAULT_REPAIR_ROUND_BUDGET = 6;
export const MAX_CONFIGURED_REPAIR_ROUND_BUDGET = 6;
export const USER_CONTINUE_REPAIR_ROUNDS = 3;
export const RUN_BUDGET_POLICY_PROTOCOL = 'devseek.run-budget-policy/v1';
export const RUN_BUDGET_POLICY_AUTHORITY = 'bounded-repair-policy';
export const RUN_BUDGET_REQUIRED_PHASES = ['safety', 'validation', 'quality-gate'] as const;

export type RunBudgetPolicyPhase =
  | 'planning'
  | 'context'
  | 'provider'
  | 'tool'
  | 'repair'
  | 'safety'
  | 'validation'
  | 'quality-gate'
  | 'settlement'
  | string;

export interface RunBudgetPhaseUsage {
  phase: RunBudgetPolicyPhase;
  allocated?: number;
  used?: number;
  required?: boolean;
}

export interface RunBudgetPolicyInput {
  phases: RunBudgetPhaseUsage[];
  stagnantRounds?: number;
  maxStagnantRounds?: number;
}

export type RunBudgetPolicyDecisionKind = 'allow' | 'replan' | 'blocked';
export type RunBudgetPolicyReason =
  | 'within-budget'
  | 'optional-budget-exceeded-replan'
  | 'required-budget-missing-blocked'
  | 'required-budget-exceeded-blocked'
  | 'no-progress-budget-exhausted';

export interface RunBudgetPolicyDecision {
  protocol: typeof RUN_BUDGET_POLICY_PROTOCOL;
  authority: typeof RUN_BUDGET_POLICY_AUTHORITY;
  decision: RunBudgetPolicyDecisionKind;
  reason: RunBudgetPolicyReason;
  replanRequired: boolean;
  safetyAndAcceptanceProtected: true;
  noProgressBounded: boolean;
  stagnantRounds: number;
  maxStagnantRounds: number;
  overBudgetPhases: string[];
  blockedRequiredPhases: string[];
  skippedRequiredPhases: string[];
}

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

export function decideRunBudgetPolicy(input: RunBudgetPolicyInput): RunBudgetPolicyDecision {
  const phases = normalizeRunBudgetPhases(input.phases);
  const maxStagnantRounds = normalizeStagnantRoundLimit(input.maxStagnantRounds);
  const stagnantRounds = normalizeStagnantRounds(input.stagnantRounds);
  const requiredPhases = collectRequiredRunBudgetPhases(phases);
  const missingRequiredPhases = requiredPhases.filter(phase => !phases.some(item => item.phase === phase));
  const overBudgetPhases = phases
    .filter(item => item.used > item.allocated)
    .map(item => item.phase);
  const blockedRequiredPhases = [
    ...missingRequiredPhases,
    ...overBudgetPhases.filter(phase => requiredPhases.includes(phase)),
  ];

  if (missingRequiredPhases.length > 0) {
    return createRunBudgetPolicyDecision({
      decision: 'blocked',
      reason: 'required-budget-missing-blocked',
      stagnantRounds,
      maxStagnantRounds,
      overBudgetPhases,
      blockedRequiredPhases,
    });
  }

  if (blockedRequiredPhases.length > 0) {
    return createRunBudgetPolicyDecision({
      decision: 'blocked',
      reason: 'required-budget-exceeded-blocked',
      stagnantRounds,
      maxStagnantRounds,
      overBudgetPhases,
      blockedRequiredPhases,
    });
  }

  if (stagnantRounds >= maxStagnantRounds) {
    return createRunBudgetPolicyDecision({
      decision: 'blocked',
      reason: 'no-progress-budget-exhausted',
      stagnantRounds,
      maxStagnantRounds,
      overBudgetPhases,
      blockedRequiredPhases: [],
      noProgressBounded: true,
    });
  }

  if (overBudgetPhases.length > 0) {
    return createRunBudgetPolicyDecision({
      decision: 'replan',
      reason: 'optional-budget-exceeded-replan',
      stagnantRounds,
      maxStagnantRounds,
      overBudgetPhases,
      blockedRequiredPhases: [],
    });
  }

  return createRunBudgetPolicyDecision({
    decision: 'allow',
    reason: 'within-budget',
    stagnantRounds,
    maxStagnantRounds,
    overBudgetPhases: [],
    blockedRequiredPhases: [],
  });
}

function normalizeRunBudgetPhases(phases: RunBudgetPhaseUsage[]): Array<{
  phase: string;
  allocated: number;
  used: number;
  required: boolean;
}> {
  if (!Array.isArray(phases)) return [];
  return phases
    .filter(item => item && typeof item.phase === 'string' && item.phase.trim())
    .map(item => ({
      phase: item.phase.trim(),
      allocated: normalizeBudgetAmount(item.allocated),
      used: normalizeBudgetAmount(item.used),
      required: item.required === true,
    }));
}

function normalizeBudgetAmount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeStagnantRounds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function normalizeStagnantRoundLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 2;
  return Math.trunc(parsed);
}

function collectRequiredRunBudgetPhases(phases: Array<{ phase: string; required: boolean }>): string[] {
  const required = new Set<string>(RUN_BUDGET_REQUIRED_PHASES);
  for (const phase of phases) {
    if (phase.required) required.add(phase.phase);
  }
  return [...required];
}

function createRunBudgetPolicyDecision(input: {
  decision: RunBudgetPolicyDecisionKind;
  reason: RunBudgetPolicyReason;
  stagnantRounds: number;
  maxStagnantRounds: number;
  overBudgetPhases: string[];
  blockedRequiredPhases: string[];
  noProgressBounded?: boolean;
}): RunBudgetPolicyDecision {
  return {
    protocol: RUN_BUDGET_POLICY_PROTOCOL,
    authority: RUN_BUDGET_POLICY_AUTHORITY,
    decision: input.decision,
    reason: input.reason,
    replanRequired: input.decision !== 'allow',
    safetyAndAcceptanceProtected: true,
    noProgressBounded: input.noProgressBounded === true,
    stagnantRounds: input.stagnantRounds,
    maxStagnantRounds: input.maxStagnantRounds,
    overBudgetPhases: uniqueSorted(input.overBudgetPhases),
    blockedRequiredPhases: uniqueSorted(input.blockedRequiredPhases),
    skippedRequiredPhases: uniqueSorted(input.blockedRequiredPhases),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
