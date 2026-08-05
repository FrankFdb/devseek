import type { TaskSemanticContract } from '../task-semantic-contract';
import {
  findBlockingTerminalFailureEvidence,
  getBlockingTerminalFailure,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';

export function getAgenticBlockingTerminalFailure(
  userPrompt: string,
  todos: readonly TodoItem[],
  writtenFiles: readonly WrittenFileEvidence[],
  terminalEvidence: readonly TerminalEvidence[],
  semanticContract?: TaskSemanticContract,
): TerminalEvidence | undefined {
  return getBlockingTerminalFailure(userPrompt, todos, writtenFiles, terminalEvidence, semanticContract)
    ?? findBlockingTerminalFailureEvidence(terminalEvidence);
}
