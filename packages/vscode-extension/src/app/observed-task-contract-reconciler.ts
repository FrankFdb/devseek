import {
  buildCodingKernelTaskContract,
  codingSemanticDigest,
  codingWorkspaceTargetMatchesScope,
  type CodingKernelTaskContract,
  type CodingToolExecutionReceipt,
  type CodingWorkspaceMutationReceipt,
  type CodingTaskContractRevisionCandidate,
} from '@devseek-netai/shared';
import type { TaskSemanticContract } from '../task-semantic-contract';
import type { ExecutionMode } from '../intent/intent-types';
import { canToolReceiptPromoteModelSemantics } from '../agent/model-tool-semantic-proposal';
import { projectVsCodeCodingKernelTaskContract } from './coding-kernel-task-contract';

export interface ObservedTaskContractReconciliationInput {
  readonly current: CodingKernelTaskContract;
  readonly semanticContract: TaskSemanticContract;
  readonly contextFiles: readonly string[];
  readonly workspaceRoot: string;
  readonly toolReceipts: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
}

/**
 * Refines completion semantics from locally settled model actions. It cannot
 * authorize an uncommitted model-proposed path or remove a user prohibition.
 */
export function reconcileObservedTaskContract(
  input: ObservedTaskContractReconciliationInput,
): CodingTaskContractRevisionCandidate | undefined {
  const semanticReceipts = input.toolReceipts.filter(canToolReceiptPromoteModelSemantics);
  if (semanticReceipts.length === 0) return undefined;
  const actionIds = new Set(semanticReceipts.map(receipt => receipt.actionId));
  const committedChanges = input.changeReceipts.filter(receipt => (
    receipt.status === 'committed' && actionIds.has(receipt.actionId)
  ));
  const committedPaths = unique(committedChanges.flatMap(receipt => [...receipt.paths]));
  const observedDeliverableTargets = unique([
    ...input.current.deliverables
      .filter(deliverable => deliverable.kind === 'source-change' || deliverable.kind === 'report')
      .flatMap(deliverable => deliverable.path ? [deliverable.path] : []),
    ...committedPaths,
  ]).filter(target => !isExcluded(target, input.current.scope.exclude));
  const projected = projectVsCodeCodingKernelTaskContract({
    userPrompt: input.semanticContract.prompt,
    executionMode: resolveObservedExecutionMode(input, committedChanges),
    contextFiles: [...input.contextFiles],
    workspaceRoot: input.workspaceRoot,
    taskContract: input.semanticContract.taskContract,
    externalEffectIntent: input.semanticContract.intent.context.externalEffect,
    targetPaths: observedDeliverableTargets,
    prohibitedTargets: input.current.scope.exclude,
    // Settled paths refine completion evidence; they do not become a new user
    // prohibition for later actions in a broader multi-file task.
    strictTargetScope: input.current.constraints.includes('no-other-files'),
  });
  const taskContract = preserveUserContractBoundaries(
    input.current,
    projected,
  );
  if (codingSemanticDigest(taskContract) === codingSemanticDigest(input.current)) return undefined;

  const lastReceipt = [...semanticReceipts]
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1)!;
  return {
    revisionId: `settled-model-${lastReceipt.sequence}-${sanitizeId(lastReceipt.actionId)}`,
    taskContract,
    evidenceRefs: unique([
      `settled-model-semantic:${lastReceipt.actionId}`,
      ...semanticReceipts.flatMap(receipt => [...receipt.evidenceRefs]),
      ...committedChanges.flatMap(receipt => [...receipt.evidenceRefs]),
    ]),
  };
}

function preserveUserContractBoundaries(
  current: CodingKernelTaskContract,
  projected: CodingKernelTaskContract,
): CodingKernelTaskContract {
  const preserveRelease = current.mode === 'release' && projected.mode !== 'release';
  return buildCodingKernelTaskContract({
    goal: projected.goal,
    mode: preserveRelease ? current.mode : projected.mode,
    orientation: preserveRelease ? current.orientation : projected.orientation,
    include: projected.scope.include,
    exclude: unique([...current.scope.exclude, ...projected.scope.exclude]),
    // Deliverables, verification obligations, and acceptance criteria are a
    // semantic snapshot. Carrying them forward would preserve a superseded
    // lexical guess (for example, treating a memory write as source work).
    deliverables: projected.deliverables,
    constraints: projected.constraints,
    nonGoals: unique([...projected.nonGoals, ...current.nonGoals]),
    assumptions: mergeById(projected.assumptions, current.assumptions),
    conflicts: mergeById(projected.conflicts, current.conflicts),
    externalBoundaries: mergeById(projected.externalBoundaries, current.externalBoundaries),
    acceptance: projected.acceptance,
    provenanceRefs: unique([
      ...projected.provenanceRefs,
      ...current.provenanceRefs,
    ]),
  });
}

/**
 * Settled effects accumulate for the turn. A later read or verification action
 * cannot downgrade an already committed change into a read-only task.
 */
function resolveObservedExecutionMode(
  input: Pick<ObservedTaskContractReconciliationInput, 'current' | 'semanticContract'>,
  committedChanges: readonly CodingWorkspaceMutationReceipt<unknown>[],
): ExecutionMode {
  const { current, semanticContract } = input;
  if (semanticContract.kind === 'destructive'
    || semanticContract.intent.mode === 'destructive') {
    return 'destructive';
  }
  if (current.mode === 'change'
    || current.mode === 'release'
    || committedChanges.length > 0
    || semanticContract.mutation.requested
    || semanticContract.intent.context.externalEffect === 'requested') {
    return 'edit';
  }
  if (semanticContract.validation.requested) return 'run';
  return semanticContract.intent.mode;
}

function mergeById<T extends { readonly id: string }>(
  preferred: readonly T[],
  inherited: readonly T[],
): T[] {
  const merged = new Map<string, T>();
  for (const item of preferred) merged.set(item.id, item);
  for (const item of inherited) {
    if (!merged.has(item.id)) merged.set(item.id, item);
  }
  return [...merged.values()];
}

function isExcluded(target: string, exclusions: readonly string[]): boolean {
  return exclusions.some(scope => codingWorkspaceTargetMatchesScope(target, scope));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function sanitizeId(value: string): string {
  return value.replace(/[^0-9A-Za-z._-]+/gu, '-').slice(0, 160) || 'action';
}
