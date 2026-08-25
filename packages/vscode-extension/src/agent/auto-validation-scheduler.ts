export interface AutoValidationScheduleInput {
  pendingWriteCount: number;
  roundHasTerminalProgress: boolean;
  pendingCohortHasUnrepairedTerminalFailure: boolean;
  completionSignaled: boolean;
}

/** Keep a mutation cohort intact until the model reaches an observable validation boundary. */
export function shouldDeferAgentAutoValidation(input: AutoValidationScheduleInput): boolean {
  if (input.pendingWriteCount === 0) {
    return false;
  }
  if (input.pendingCohortHasUnrepairedTerminalFailure) {
    return true;
  }
  return !input.roundHasTerminalProgress && !input.completionSignaled;
}

export interface AutoValidationFailureFenceInput {
  writeCount: number;
  terminalOutcomes: readonly boolean[];
}

/** Track a failed validation against the exact mutation version that produced it. */
export function advanceAutoValidationFailureFence(
  failedAtWriteCount: number | undefined,
  input: AutoValidationFailureFenceInput,
): number | undefined {
  let nextFence = failedAtWriteCount;
  if (nextFence !== undefined && input.writeCount > nextFence) {
    nextFence = undefined;
  }

  const latestOutcome = input.terminalOutcomes.at(-1);
  if (latestOutcome === false) {
    return input.writeCount;
  }
  if (latestOutcome === true) {
    return undefined;
  }
  return nextFence;
}
