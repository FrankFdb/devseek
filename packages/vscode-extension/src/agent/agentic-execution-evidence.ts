import {
  codingAdverseToolExecutionBlocksCompletion,
  type CodingToolExecutionReceipt,
  type CodingVerificationReceipt,
  type CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
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
