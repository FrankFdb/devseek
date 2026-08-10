import { uniqueCodingRefs } from './coding-contract-utils';
import type { CodingCompletionAcceptanceDecision } from './coding-completion';
import type { CodingKernelTaskContract } from './coding-task-contract';
import type { CodingWorkspaceMutationReceipt } from './coding-workspace-mutation';

export interface ProjectStructuralAcceptanceInput {
  readonly taskContract: CodingKernelTaskContract;
  readonly mutations: readonly CodingWorkspaceMutationReceipt<unknown>[];
}

export interface StructuralAcceptanceEvidencePort {
  project(input: ProjectStructuralAcceptanceInput): readonly CodingCompletionAcceptanceDecision[];
}

type ReadbackCommittedReceipt = CodingWorkspaceMutationReceipt<unknown> & {
  readonly status: 'committed';
  readonly readbackRef: string;
};

/** Proves only acceptance facts already established by canonical structural receipts. */
export class CanonicalStructuralAcceptanceEvidenceService implements StructuralAcceptanceEvidencePort {
  project(input: ProjectStructuralAcceptanceInput): readonly CodingCompletionAcceptanceDecision[] {
    const committed = input.mutations.filter((receipt): receipt is ReadbackCommittedReceipt => (
      receipt.status === 'committed' && Boolean(receipt.readbackRef)
    ));
    if (committed.length === 0) return Object.freeze([]);

    return Object.freeze(input.taskContract.acceptance
      .filter(criterion => criterion.oracle.kind === 'workspace-readback')
      .filter(criterion => criterion.externalBoundaryRefs.length === 0)
      .filter(criterion => !criterion.oracle.evidenceKinds.includes('source-citation'))
      .filter(criterion => deliverablesCovered(input.taskContract, criterion.deliverableIds, committed))
      .map(criterion => Object.freeze({
        criterionId: criterion.id,
        status: 'passed' as const,
        evidenceRefs: uniqueCodingRefs(committed.flatMap(receipt => [
          ...receipt.evidenceRefs,
          receipt.readbackRef,
          `workspace-mutation:${receipt.actionId}:committed`,
        ])),
      })));
  }
}

function deliverablesCovered(
  taskContract: CodingKernelTaskContract,
  deliverableIds: readonly string[],
  receipts: readonly ReadbackCommittedReceipt[],
): boolean {
  const ids = new Set(deliverableIds);
  const requiredPaths = taskContract.deliverables
    .filter(deliverable => ids.has(deliverable.id) && deliverable.path)
    .map(deliverable => normalizePath(deliverable.path ?? ''));
  if (requiredPaths.length === 0) return receipts.some(receipt => receipt.paths.length > 0);
  return requiredPaths.every(requiredPath => receipts.some(receipt => (
    receipt.paths.some(receiptPath => samePath(normalizePath(receiptPath), requiredPath))
  )));
}

function samePath(left: string, right: string): boolean {
  if (left === right) return true;
  const leftAbsolute = isAbsolutePath(left);
  const rightAbsolute = isAbsolutePath(right);
  if (leftAbsolute === rightAbsolute) return false;
  const absolute = leftAbsolute ? left : right;
  const relative = leftAbsolute ? right : left;
  return absolute.endsWith(`/${relative}`);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//u.test(value);
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
}
