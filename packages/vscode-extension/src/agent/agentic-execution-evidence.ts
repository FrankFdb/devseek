import {
  codingAdverseToolExecutionBlocksCompletion,
  type CodingToolExecutionReceipt,
  type CodingVerificationReceipt,
  type CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import {
  assessMissingCompletionEvidence,
  findBlockingTerminalFailureEvidence,
  getBlockingTerminalFailure,
  type CompletionEvidenceAssessmentInput,
  type TerminalEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';

export interface AgenticEvidenceClosureInput {
  readonly requiredBeforeExecution: boolean;
  readonly workToolObserved: boolean;
  readonly completion: CompletionEvidenceAssessmentInput & {
    readonly todos: TodoItem[];
  };
}

export interface AgenticEvidenceClosure {
  readonly required: boolean;
  readonly missingEvidence: string[];
  readonly blockingTerminalFailure?: TerminalEvidence;
}

/**
 * Model-led turns remain free to interpret the prompt, but concrete work makes
 * local evidence closure mandatory even when the pre-execution route was only a hint.
 */
export function assessAgenticEvidenceClosure(
  input: AgenticEvidenceClosureInput,
): AgenticEvidenceClosure {
  const required = input.requiredBeforeExecution || input.workToolObserved;
  if (!required) return { required, missingEvidence: [] };
  const { completion } = input;
  return {
    required,
    missingEvidence: assessMissingCompletionEvidence(completion),
    blockingTerminalFailure: getAgenticBlockingTerminalFailure(
      completion.terminalEvidence,
      completion.semanticContract,
    ),
  };
}

export function getAgenticBlockingTerminalFailure(
  terminalEvidence: readonly TerminalEvidence[],
  semanticContract: CompletionEvidenceAssessmentInput['semanticContract'],
): TerminalEvidence | undefined {
  return getBlockingTerminalFailure(terminalEvidence, semanticContract)
    ?? findBlockingTerminalFailureEvidence(terminalEvidence);
}

export function getAgenticBlockingDeniedToolExecution(
  receipts: readonly CodingToolExecutionReceipt<unknown>[],
  mutations: readonly CodingWorkspaceMutationReceipt<unknown>[],
  verifications: readonly CodingVerificationReceipt[],
): CodingToolExecutionReceipt<unknown> | undefined {
  return receipts.find(receipt => (
    receipt.status === 'denied'
      && codingAdverseToolExecutionBlocksCompletion(receipt, receipts, mutations, verifications)
  ));
}

export function describeAgenticDeniedToolExecution(
  receipt: CodingToolExecutionReceipt<unknown>,
): string {
  return `工具 ${receipt.tool} 未获授权：${receipt.permission.reason}`;
}
