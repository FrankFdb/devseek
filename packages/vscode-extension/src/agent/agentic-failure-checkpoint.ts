import type { AgentTask } from './agent-task';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import type { TodoItem } from './evidence-recovery';

export interface AgenticFailureCheckpointInput {
  readonly userPrompt: string;
  readonly failureReason: string;
  readonly writtenFiles: readonly WrittenFileEvidence[];
  readonly terminalEvidence: readonly TerminalEvidence[];
  readonly todos: readonly TodoItem[];
}

/** Projects an unfinished model-led run into one durable, workspace-bound resume unit. */
export function buildAgenticFailureCheckpointTask(
  input: AgenticFailureCheckpointInput,
): AgentTask {
  const lastWritten = input.writtenFiles.at(-1);
  const latestFailure = [...input.terminalEvidence].reverse().find(evidence => !evidence.ok);
  const pendingTodos = input.todos
    .filter(todo => todo.status !== 'completed')
    .slice(0, 4)
    .map(todo => todo.title.trim())
    .filter(Boolean);
  const description = [
    'Continue the existing task from the current workspace state; do not recreate completed work.',
    `Original request: ${bounded(input.userPrompt, 4_000)}`,
    `Current stop reason: ${bounded(input.failureReason, 2_000)}`,
    ...(latestFailure ? [
      `Latest failed validation: ${bounded(latestFailure.command, 1_000)}`,
      `Observed failure: ${bounded(latestFailure.detail ?? 'No diagnostic text was captured.', 2_000)}`,
    ] : []),
    ...(pendingTodos.length > 0 ? [`Pending work: ${pendingTodos.join('; ')}`] : []),
    'Recheck the recorded failure first, run only affected verification while repairing, then run the final project gate once.',
  ].join('\n');
  return {
    id: 'agentic-incomplete-delivery',
    file: lastWritten?.path ?? '',
    action: lastWritten || latestFailure ? 'modify' : 'explore',
    desc: description,
    targetKind: lastWritten ? 'workspace-file' : 'agent-session',
    visibleTarget: lastWritten?.path ?? 'Current workspace delivery',
  };
}

function bounded(value: string, limit: number): string {
  const normalized = String(value || '').replace(/\s+/gu, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}...`;
}
