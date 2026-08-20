import { uniqueCodingRefs } from './coding-contract-utils';
import type { CodingCompletionAcceptanceDecision } from './coding-completion';
import type { CodingKernelTaskContract } from './coding-task-contract';
import type { CodingToolExecutionReceipt } from './coding-tool-execution';
import type { CodingWorkspaceMutationReceipt } from './coding-workspace-mutation';

export interface ProjectReceiptAcceptanceInput {
  readonly taskContract: CodingKernelTaskContract;
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly mutations: readonly CodingWorkspaceMutationReceipt<unknown>[];
}

export interface ReceiptAcceptanceEvidencePort {
  project(input: ProjectReceiptAcceptanceInput): readonly CodingCompletionAcceptanceDecision[];
}

type ReadbackCommittedReceipt = CodingWorkspaceMutationReceipt<unknown> & {
  readonly status: 'committed';
  readonly readbackRef: string;
};

/** Proves only acceptance facts established by action-bound canonical receipts. */
export class CanonicalReceiptAcceptanceEvidenceService implements ReceiptAcceptanceEvidencePort {
  project(input: ProjectReceiptAcceptanceInput): readonly CodingCompletionAcceptanceDecision[] {
    const authorityEvidence = projectAuthorityEvidence(input);
    const committed = input.mutations.filter((receipt): receipt is ReadbackCommittedReceipt => (
      receipt.status === 'committed' && Boolean(receipt.readbackRef)
    ));
    const workspaceEvidence = projectWorkspaceEvidence(input, committed);
    const evidenceByCriterion = new Map(
      [...authorityEvidence, ...workspaceEvidence].map(evidence => [evidence.criterionId, evidence]),
    );
    return Object.freeze(input.taskContract.acceptance.flatMap(criterion => {
      const evidence = evidenceByCriterion.get(criterion.id);
      return evidence ? [evidence] : [];
    }));
  }
}

function projectWorkspaceEvidence(
  input: ProjectReceiptAcceptanceInput,
  committed: readonly ReadbackCommittedReceipt[],
): readonly CodingCompletionAcceptanceDecision[] {
  const workspaceExecutions = input.toolExecutions.filter(receipt => (
    receipt.effects.includes('workspace-mutation') && authorityReceiptMatchesExecution(receipt)
  ));
  const adverseExecutions = workspaceExecutions.filter(receipt => receipt.status !== 'completed');
  const workspaceActionIds = new Set(workspaceExecutions.map(receipt => receipt.actionId));
  const adverseMutations = input.mutations.filter(receipt => (
    workspaceActionIds.has(receipt.actionId) && receipt.status !== 'committed'
  ));
  const adverseEvidenceRefs = uniqueCodingRefs([
    ...adverseExecutions.flatMap(receipt => [
      ...receipt.permission.evidenceRefs,
      ...receipt.evidenceRefs,
      `tool-execution:${receipt.actionId}:${receipt.status}`,
    ]),
    ...adverseMutations.flatMap(receipt => [
      ...receipt.evidenceRefs,
      `workspace-mutation:${receipt.actionId}:${receipt.status}`,
    ]),
  ]);
  const adverseStatus = adverseExecutions.some(receipt => receipt.status === 'failed')
    || adverseMutations.some(receipt => receipt.status === 'failed' || receipt.status === 'rolled-back')
    ? 'failed' as const
    : 'blocked' as const;

  const evidence: CodingCompletionAcceptanceDecision[] = [];
  for (const criterion of input.taskContract.acceptance) {
    if (criterion.oracle.kind !== 'workspace-readback') continue;
    const canUseCommittedReadback = criterion.externalBoundaryRefs.length === 0
      && !criterion.oracle.evidenceKinds.includes('source-citation')
      && deliverablesCovered(input.taskContract, criterion.deliverableIds, committed);
    if (canUseCommittedReadback) {
      evidence.push(Object.freeze({
        criterionId: criterion.id,
        status: 'passed',
        evidenceRefs: uniqueCodingRefs(committed.flatMap(receipt => [
          ...receipt.evidenceRefs,
          receipt.readbackRef,
          `workspace-mutation:${receipt.actionId}:committed`,
        ])),
      }));
    } else if (adverseEvidenceRefs.length > 0) {
      evidence.push(Object.freeze({
        criterionId: criterion.id,
        status: adverseStatus,
        evidenceRefs: adverseEvidenceRefs,
      }));
    }
  }
  return evidence;
}

function projectAuthorityEvidence(
  input: ProjectReceiptAcceptanceInput,
): readonly CodingCompletionAcceptanceDecision[] {
  const externalExecutions = input.toolExecutions.filter(receipt => receipt.purpose === 'external-effect');
  if (externalExecutions.length === 0 || !externalExecutions.every(authorityReceiptMatchesExecution)) {
    return [];
  }
  const evidenceRefs = uniqueCodingRefs(externalExecutions.flatMap(receipt => [
    ...receipt.permission.evidenceRefs,
    `tool-authority:${receipt.actionId}:${receipt.permission.status}`,
  ]));
  return input.taskContract.acceptance
    .filter(criterion => criterion.oracle.kind === 'authority')
    .map(criterion => Object.freeze({
      criterionId: criterion.id,
      status: 'passed' as const,
      evidenceRefs,
    }));
}

function authorityReceiptMatchesExecution(receipt: CodingToolExecutionReceipt<unknown>): boolean {
  const permission = receipt.permission;
  const expectedAuthorityStatus = receipt.status === 'denied' ? 'denied' : 'authorized';
  return permission.runId === receipt.runId
    && permission.actionId === receipt.actionId
    && permission.tool === receipt.tool
    && permission.purpose === receipt.purpose
    && permission.inputSha256 === receipt.inputSha256
    && permission.status === expectedAuthorityStatus
    && sameEffects(permission.effects, receipt.effects)
    && permission.evidenceRefs.length > 0;
}

function sameEffects(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((effect, index) => effect === right[index]);
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
