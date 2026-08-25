export interface AutoValidationScheduleInput {
  pendingWriteCount: number;
  roundHasWriteProgress: boolean;
  roundHasTerminalProgress: boolean;
  roundHasFailedTerminalProgress: boolean;
  completionSignaled: boolean;
}

/** Keep a mutation cohort intact until the model reaches an observable validation boundary. */
export function shouldDeferAgentAutoValidation(input: AutoValidationScheduleInput): boolean {
  if (input.pendingWriteCount > 0 && input.roundHasFailedTerminalProgress) {
    return true;
  }
  if (input.pendingWriteCount === 0
    || !input.roundHasWriteProgress
    || input.roundHasTerminalProgress
    || input.completionSignaled) {
    return false;
  }
  return true;
}
