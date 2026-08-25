import type { TodoItem } from './evidence-recovery';

export interface AutoValidationScheduleInput {
  pendingWriteCount: number;
  roundHasWriteProgress: boolean;
  roundHasTerminalProgress: boolean;
  completionSignaled: boolean;
  todos: readonly TodoItem[];
}

/** Keep a planned multi-file mutation cohort intact until the model reaches validation. */
export function shouldDeferAgentAutoValidation(input: AutoValidationScheduleInput): boolean {
  if (input.pendingWriteCount === 0
    || !input.roundHasWriteProgress
    || input.roundHasTerminalProgress
    || input.completionSignaled) {
    return false;
  }
  return input.todos.length > 0 && input.todos.some(todo => todo.status !== 'completed');
}
