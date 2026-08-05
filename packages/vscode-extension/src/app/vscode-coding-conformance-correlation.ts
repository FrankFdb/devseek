import type {
  CodingToolExecutionReceipt,
  CodingVerificationReceipt,
  CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';

export interface CorrelatedVsCodeCodingReceipts {
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly verifications: readonly CodingVerificationReceipt[];
}

/**
 * Correlates VS Code host-operation receipts with their outer canonical tool action.
 * A receipt remains untouched when settled evidence does not identify one unique owner.
 */
export function correlateVsCodeCodingConformanceReceipts(input: {
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly verifications: readonly CodingVerificationReceipt[];
}): CorrelatedVsCodeCodingReceipts {
  const toolActionIds = new Set(input.toolExecutions.map(receipt => receipt.actionId));
  const claimedChangeActions = new Set<string>();
  const changeReceipts = input.changeReceipts.map(receipt => {
    if (toolActionIds.has(receipt.actionId)) {
      claimedChangeActions.add(receipt.actionId);
      return receipt;
    }
    const owner = uniqueEvidenceOwner(
      receipt.evidenceRefs,
      input.toolExecutions.filter(candidate => (
        candidate.effects.includes('workspace-mutation')
        && !claimedChangeActions.has(candidate.actionId)
        && mutationStatusCompatible(receipt.status, candidate.status)
      )),
    );
    if (!owner) return receipt;
    claimedChangeActions.add(owner.actionId);
    return { ...receipt, actionId: owner.actionId };
  });

  const claimedVerificationActions = new Set<string>();
  const verifications = input.verifications.map(receipt => {
    if (toolActionIds.has(receipt.actionId)) {
      claimedVerificationActions.add(receipt.actionId);
      return receipt;
    }
    const candidates = input.toolExecutions.filter(candidate => (
      candidate.effects.includes('process')
      && !claimedVerificationActions.has(candidate.actionId)
      && verificationStatusCompatible(receipt.status, candidate.status)
    ));
    const owner = uniqueEvidenceOwner(receipt.evidenceRefs, candidates)
      ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!owner) return receipt;
    claimedVerificationActions.add(owner.actionId);
    return { ...receipt, actionId: owner.actionId };
  });

  return {
    toolExecutions: input.toolExecutions,
    changeReceipts,
    verifications,
  };
}

function uniqueEvidenceOwner(
  evidenceRefs: readonly string[],
  candidates: readonly CodingToolExecutionReceipt<unknown>[],
): CodingToolExecutionReceipt<unknown> | undefined {
  const evidence = new Set(evidenceRefs);
  const scored = candidates
    .map(candidate => ({
      candidate,
      score: candidate.evidenceRefs.filter(ref => evidence.has(ref)).length,
    }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0 || scored[1]?.score === scored[0].score) return undefined;
  return scored[0].candidate;
}

function mutationStatusCompatible(
  mutation: CodingWorkspaceMutationReceipt<unknown>['status'],
  tool: CodingToolExecutionReceipt<unknown>['status'],
): boolean {
  if (mutation === 'committed') return tool === 'completed';
  return tool === 'failed' || tool === 'indeterminate';
}

function verificationStatusCompatible(
  verification: CodingVerificationReceipt['status'],
  tool: CodingToolExecutionReceipt<unknown>['status'],
): boolean {
  if (verification === 'passed') return tool === 'completed';
  if (verification === 'failed') return tool === 'failed';
  return tool === 'denied' || tool === 'failed' || tool === 'indeterminate';
}
