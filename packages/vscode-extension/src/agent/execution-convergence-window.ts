const EXECUTION_CONVERGENCE_RENEWAL_ROUNDS = 8;

export interface ExecutionConvergenceWindowInput {
  currentRoundLimit: number;
  roundCount: number;
  maxRoundLimit: number;
  concreteProgress: boolean;
  unresolvedExecution: boolean;
}

/** Keeps an active repair turn alive while bounded, receipt-backed progress continues. */
export function renewExecutionConvergenceRoundLimit(
  input: ExecutionConvergenceWindowInput,
): number {
  if (!input.concreteProgress || !input.unresolvedExecution) return input.currentRoundLimit;
  return Math.min(
    input.maxRoundLimit,
    Math.max(input.currentRoundLimit, input.roundCount + EXECUTION_CONVERGENCE_RENEWAL_ROUNDS),
  );
}
