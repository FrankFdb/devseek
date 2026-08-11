export const DEFAULT_REPAIR_ROUND_BUDGET = 6;
export const MAX_CONFIGURED_REPAIR_ROUND_BUDGET = 6;
export const USER_CONTINUE_REPAIR_ROUNDS = 3;
export const RUN_BUDGET_POLICY_PROTOCOL = 'devseek.run-budget-policy/v1';
export const RUN_BUDGET_POLICY_AUTHORITY = 'canonical-run-budget';
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
  readonly phase: RunBudgetPolicyPhase;
  readonly allocated?: number;
  readonly used?: number;
  readonly required?: boolean;
}

export interface RunBudgetPolicyInput {
  readonly phases: readonly RunBudgetPhaseUsage[];
  readonly stagnantRounds?: number;
  readonly maxStagnantRounds?: number;
}

export type RunBudgetPolicyDecisionKind = 'allow' | 'replan' | 'blocked';
export type RunBudgetPolicyReason =
  | 'within-budget'
  | 'optional-budget-exceeded-replan'
  | 'required-budget-missing-blocked'
  | 'required-budget-exceeded-blocked'
  | 'no-progress-budget-exhausted';

export interface RunBudgetPolicyDecision {
  readonly protocol: typeof RUN_BUDGET_POLICY_PROTOCOL;
  readonly authority: typeof RUN_BUDGET_POLICY_AUTHORITY;
  readonly decision: RunBudgetPolicyDecisionKind;
  readonly reason: RunBudgetPolicyReason;
  readonly replanRequired: boolean;
  readonly safetyAndAcceptanceProtected: true;
  readonly noProgressBounded: boolean;
  readonly stagnantRounds: number;
  readonly maxStagnantRounds: number;
  readonly overBudgetPhases: readonly string[];
  readonly blockedRequiredPhases: readonly string[];
  readonly skippedRequiredPhases: readonly string[];
}

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

/** Preserves verification and safety capacity while allowing optional work to replan. */
export function decideRunBudgetPolicy(input: RunBudgetPolicyInput): RunBudgetPolicyDecision {
  const phases = normalizeRunBudgetPhases(input.phases);
  const maxStagnantRounds = normalizeStagnantRoundLimit(input.maxStagnantRounds);
  const stagnantRounds = normalizeStagnantRounds(input.stagnantRounds);
  const requiredPhases = collectRequiredRunBudgetPhases(phases);
  const missingRequiredPhases = requiredPhases.filter(phase => !phases.some(item => item.phase === phase));
  const overBudgetPhases = phases.filter(item => item.used > item.allocated).map(item => item.phase);
  const blockedRequiredPhases = uniqueSorted([
    ...missingRequiredPhases,
    ...overBudgetPhases.filter(phase => requiredPhases.includes(phase)),
  ]);

  if (missingRequiredPhases.length > 0) {
    return createDecision('blocked', 'required-budget-missing-blocked');
  }
  if (blockedRequiredPhases.length > 0) {
    return createDecision('blocked', 'required-budget-exceeded-blocked');
  }
  if (stagnantRounds >= maxStagnantRounds) {
    return createDecision('blocked', 'no-progress-budget-exhausted', true);
  }
  if (overBudgetPhases.length > 0) {
    return createDecision('replan', 'optional-budget-exceeded-replan');
  }
  return createDecision('allow', 'within-budget');

  function createDecision(
    decision: RunBudgetPolicyDecisionKind,
    reason: RunBudgetPolicyReason,
    noProgressBounded = false,
  ): RunBudgetPolicyDecision {
    return Object.freeze({
      protocol: RUN_BUDGET_POLICY_PROTOCOL,
      authority: RUN_BUDGET_POLICY_AUTHORITY,
      decision,
      reason,
      replanRequired: decision !== 'allow',
      safetyAndAcceptanceProtected: true,
      noProgressBounded,
      stagnantRounds,
      maxStagnantRounds,
      overBudgetPhases: Object.freeze(uniqueSorted(overBudgetPhases)),
      blockedRequiredPhases: Object.freeze(blockedRequiredPhases),
      skippedRequiredPhases: Object.freeze(blockedRequiredPhases),
    });
  }
}

function normalizeRunBudgetPhases(phases: readonly RunBudgetPhaseUsage[]): Array<{
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
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeStagnantRounds(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function normalizeStagnantRoundLimit(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 2;
}

function collectRequiredRunBudgetPhases(phases: readonly { phase: string; required: boolean }[]): string[] {
  const required = new Set<string>(RUN_BUDGET_REQUIRED_PHASES);
  for (const phase of phases) if (phase.required) required.add(phase.phase);
  return [...required];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
