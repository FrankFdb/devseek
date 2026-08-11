import type { CodingToolExecutionReceipt } from './coding-tool-execution';
import type { CodingWorkspaceMutationReceipt } from './coding-workspace-mutation';
import {
  codingDeniedVerificationToolWasRecovered,
  codingVerificationToolFailureWasRecovered,
  type CodingVerificationReceipt,
} from './coding-verification';

/**
 * Settles a failed or denied tool route only when a later canonical route
 * commits the workspace result, reads it back, and verifies the affected scope.
 */
export function codingAdverseToolExecutionWasRecovered(
  adverse: CodingToolExecutionReceipt<unknown>,
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
  mutations: readonly CodingWorkspaceMutationReceipt<unknown>[],
  verifications: readonly CodingVerificationReceipt[],
): boolean {
  if (adverse.status !== 'failed' && adverse.status !== 'denied') return false;
  if (adverse.status === 'failed'
    && codingVerificationToolFailureWasRecovered(adverse, toolExecutions, verifications)) {
    return true;
  }
  if (adverse.status === 'denied'
    && codingDeniedVerificationToolWasRecovered(adverse, toolExecutions, verifications)) {
    return true;
  }
  if (!adverse.effects.includes('workspace-mutation')) return false;
  return hasVerifiedWorkspaceAlternative({
    runId: adverse.runId,
    afterSequence: adverse.sequence,
    toolExecutions,
    mutations,
    verifications,
  });
}

/** Settles an unsuccessful mutation transaction through a later verified replacement. */
export function codingAdverseWorkspaceMutationWasRecovered(
  adverse: CodingWorkspaceMutationReceipt<unknown>,
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
  mutations: readonly CodingWorkspaceMutationReceipt<unknown>[],
  verifications: readonly CodingVerificationReceipt[],
): boolean {
  if ((adverse.status !== 'failed' && adverse.status !== 'rolled-back')
    || adverse.paths.length === 0) {
    return false;
  }
  return hasVerifiedWorkspaceAlternative({
    runId: adverse.runId,
    afterSequence: adverse.sequence,
    requiredPaths: adverse.paths,
    toolExecutions,
    mutations,
    verifications,
  });
}

function hasVerifiedWorkspaceAlternative(input: {
  readonly runId: string;
  readonly afterSequence: number;
  readonly requiredPaths?: readonly string[];
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly mutations: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly verifications: readonly CodingVerificationReceipt[];
}): boolean {
  return input.mutations.some(mutation => (
    mutation.runId === input.runId
      && mutation.sequence > input.afterSequence
      && mutation.status === 'committed'
      && Boolean(mutation.baselineRef)
      && Boolean(mutation.readbackRef)
      && pathsCover(mutation.paths, input.requiredPaths ?? [])
      && hasCompletedMutationTool(mutation, input.toolExecutions)
      && input.verifications.some(verification => (
        verification.runId === input.runId
          && verification.sequence > mutation.sequence
          && verification.status === 'passed'
          && verification.acceptance.length > 0
          && verification.acceptance.every(result => result.status === 'passed')
          && pathsCover(verification.scopePaths, mutation.paths)
          && hasCompletedVerificationTool(verification, input.toolExecutions)
      ))
  ));
}

function hasCompletedMutationTool(
  mutation: CodingWorkspaceMutationReceipt<unknown>,
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
): boolean {
  return toolExecutions.some(receipt => (
    receipt.runId === mutation.runId
      && receipt.sequence === mutation.sequence
      && receipt.actionId === mutation.actionId
      && receipt.status === 'completed'
      && receipt.effects.includes('workspace-mutation')
  ));
}

function hasCompletedVerificationTool(
  verification: CodingVerificationReceipt,
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
): boolean {
  return toolExecutions.some(receipt => (
    receipt.runId === verification.runId
      && receipt.sequence === verification.sequence
      && receipt.actionId === verification.actionId
      && receipt.tool === 'run_terminal'
      && receipt.purpose === 'verify'
      && receipt.effects.length === 1
      && receipt.effects[0] === 'process'
      && receipt.status === 'completed'
  ));
}

function pathsCover(candidates: readonly string[], required: readonly string[]): boolean {
  const normalized = new Set(candidates.map(normalizePath));
  return required.every(path => normalized.has(normalizePath(path)));
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}
