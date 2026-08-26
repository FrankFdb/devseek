import type {
  CodingConformanceSurface,
  CodingDeliverableKind,
  CodingToolEffect,
  CodingTaskMode,
} from './coding-conformance';
import { codingSemanticDigest } from './coding-semantic-digest';
import {
  buildCodingKernelTaskContract,
  codingTaskContractRequiresWorkspaceMutation,
  codingTaskContractRequiresVerification,
  type CodingKernelTaskContract,
} from './coding-task-contract';
import type { CodingTaskContractRevisionCandidate } from './coding-task-contract-revision';
import { resolveCodingKernelTaskContract } from './coding-task-contract-resolver';
import type { CodingToolPurpose } from './coding-tool-authority';
import type { CodingToolExecutionReceipt } from './coding-tool-execution';
import type { CodingWorkspaceMutationReceipt } from './coding-workspace-mutation';

export interface CodingModelActionObservation {
  readonly actionId: string;
  readonly tool: string;
  readonly purpose: CodingToolPurpose;
  readonly effects: readonly CodingToolEffect[];
  readonly input: Readonly<Record<string, unknown>>;
  readonly targetPaths: readonly string[];
  readonly deliverableKinds?: readonly CodingDeliverableKind[];
  readonly verificationRequired?: boolean;
  readonly dependencyEffect?: boolean;
}

export interface ProjectCodingModelActionTaskContractInput {
  readonly current: CodingKernelTaskContract;
  readonly surface: CodingConformanceSurface;
  readonly action: CodingModelActionObservation;
  readonly contextFiles?: readonly string[];
  readonly committedTargetPaths?: readonly string[];
}

export interface ReconcileSettledCodingModelActionInput
  extends ProjectCodingModelActionTaskContractInput {
  readonly toolReceipts: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
}

/**
 * Projects task semantics from one normalized model action. User-language text
 * remains an opaque goal; only canonical purpose/effect/path fields can alter
 * execution obligations.
 */
export function projectCodingModelActionTaskContract(
  input: ProjectCodingModelActionTaskContractInput,
): CodingKernelTaskContract {
  const { current, action } = input;
  if (current.orientation.source === 'safety-policy') return current;

  const workspaceAction = action.purpose === 'workspace-mutation'
    && action.effects.includes('workspace-mutation');
  if (workspaceAction && hasAuthoritativeNoMutationBoundary(current)) return current;

  const currentMutation = codingTaskContractRequiresWorkspaceMutation(current);
  const mutationRequested = currentMutation || workspaceAction;
  const externalEffectRequested = current.acceptance.some(criterion => criterion.oracle.kind === 'authority')
    || action.purpose === 'external-effect';
  const inheritedTargets = currentMutation
    ? current.deliverables.flatMap(deliverable => deliverable.path ? [deliverable.path] : [])
    : [];
  const committedTargets = workspaceAction ? input.committedTargetPaths ?? [] : [];
  const targetPaths = uniquePaths([...inheritedTargets, ...committedTargets]);
  const classifiedTargets = uniquePaths([
    ...action.targetPaths,
    ...committedTargets,
  ]);
  const deliverableKinds = mutationRequested
    ? uniqueDeliverableKinds([
        ...(currentMutation
          ? current.deliverables
              .map(deliverable => deliverable.kind)
              .filter(kind => kind !== 'verification-result')
          : []),
        ...(action.deliverableKinds ?? classifyMutationDeliverables(classifiedTargets)),
      ])
    : [];
  const sourceChange = deliverableKinds.includes('source-change');
  const verificationRequired = action.verificationRequired ?? (
    codingTaskContractRequiresVerification(current)
      || (workspaceAction && sourceChange)
      || action.purpose === 'verify'
  );
  const modeHint = resolveObservedActionMode(current.mode, action);
  const projected = resolveCodingKernelTaskContract({
    prompt: current.goal,
    surface: input.surface,
    modeHint,
    contextFiles: mutationRequested
      ? input.contextFiles ?? []
      : uniquePaths([...(input.contextFiles ?? []), ...current.scope.include, ...action.targetPaths]),
    targetPaths,
    targetPathsAuthoritative: true,
    excludedTargetPaths: current.scope.exclude,
    strictTargetScope: current.constraints.includes('no-other-files'),
    deliverableKinds,
    confirmedWorkspaceMutation: mutationRequested,
    dependencyEffect: current.constraints.includes('dependency-change-requires-approval')
      || action.dependencyEffect === true,
    networkEffect: current.constraints.includes('network-requires-approval')
      || action.effects.includes('network'),
    noDependencies: current.constraints.includes('no-dependencies'),
    subjectiveAcceptance: current.acceptance.some(criterion => criterion.oracle.kind === 'subjective'),
    externalBoundaries: current.externalBoundaries,
    externalEffectIntent: externalEffectRequested ? 'requested' : 'none',
    verificationRequired,
    verificationRequirementAuthoritative: true,
  });
  return preserveCodingTaskContractBoundaries(current, projected);
}

/**
 * Revises completion semantics only after a canonical receipt proves that the
 * observed action reached the local authority/execution boundary.
 */
export function reconcileSettledCodingModelAction(
  input: ReconcileSettledCodingModelActionInput,
): CodingTaskContractRevisionCandidate | undefined {
  const matchingReceipts = input.toolReceipts.filter(receipt => receiptMatchesAction(
    receipt,
    input.action,
  ));
  if (matchingReceipts.length === 0) return undefined;

  const actionIds = new Set(matchingReceipts.map(receipt => receipt.actionId));
  const matchingChanges = input.changeReceipts.filter(receipt => actionIds.has(receipt.actionId));
  const committedTargetPaths = uniquePaths(matchingChanges.flatMap(receipt => (
    receipt.status === 'committed' ? [...receipt.paths] : []
  )));
  const taskContract = projectCodingModelActionTaskContract({
    current: input.current,
    surface: input.surface,
    action: input.action,
    contextFiles: input.contextFiles,
    committedTargetPaths,
  });
  if (codingSemanticDigest(taskContract) === codingSemanticDigest(input.current)) return undefined;

  const lastReceipt = [...matchingReceipts]
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1)!;
  return {
    revisionId: `settled-model-${lastReceipt.sequence}-${sanitizeId(lastReceipt.actionId)}`,
    taskContract,
    evidenceRefs: uniqueStrings([
      `settled-model-action:${lastReceipt.actionId}`,
      ...matchingReceipts.flatMap(receipt => [...receipt.evidenceRefs]),
      ...matchingChanges.flatMap(receipt => [...receipt.evidenceRefs]),
    ]),
  };
}

function resolveObservedActionMode(
  current: CodingTaskMode,
  action: CodingModelActionObservation,
): CodingTaskMode {
  if (current === 'release' || action.effects.includes('release') || action.effects.includes('git')) {
    return 'release';
  }
  if (current === 'change'
    || action.purpose === 'workspace-mutation'
    || action.purpose === 'external-effect') {
    return 'change';
  }
  if (current === 'review' || action.purpose === 'verify' || action.purpose === 'observe') {
    return 'review';
  }
  return current;
}

function hasAuthoritativeNoMutationBoundary(contract: CodingKernelTaskContract): boolean {
  return contract.orientation.source !== 'read-only-default'
    && (contract.mode === 'explain'
      || contract.mode === 'review'
      || contract.constraints.includes('no-workspace-mutation'));
}

function classifyMutationDeliverables(paths: readonly string[]): CodingDeliverableKind[] {
  if (paths.length === 0) return ['source-change'];
  return uniqueDeliverableKinds(paths.map(path => (
    isReportArtifactPath(path) ? 'report' : 'source-change'
  )));
}

function isReportArtifactPath(path: string): boolean {
  return /\.(?:md|markdown|txt)$/iu.test(path)
    || /(?:^|\/)(?:docs?|reports?)(?:\/|$)/iu.test(path);
}

function preserveCodingTaskContractBoundaries(
  current: CodingKernelTaskContract,
  projected: CodingKernelTaskContract,
): CodingKernelTaskContract {
  return buildCodingKernelTaskContract({
    goal: projected.goal,
    mode: projected.mode,
    orientation: projected.orientation,
    include: projected.scope.include,
    exclude: uniqueStrings([...current.scope.exclude, ...projected.scope.exclude]),
    deliverables: projected.deliverables,
    constraints: uniqueStrings([
      ...projected.constraints,
      ...current.constraints.filter(constraint => !DERIVED_CONSTRAINTS.has(constraint)),
    ]),
    nonGoals: uniqueStrings([...projected.nonGoals, ...current.nonGoals]),
    assumptions: mergeById(projected.assumptions, current.assumptions),
    conflicts: mergeById(projected.conflicts, current.conflicts),
    externalBoundaries: mergeById(projected.externalBoundaries, current.externalBoundaries),
    acceptance: projected.acceptance,
    provenanceRefs: uniqueStrings([
      ...current.provenanceRefs,
      ...projected.provenanceRefs,
      'settled-model-action',
    ]),
  });
}

function receiptMatchesAction(
  receipt: CodingToolExecutionReceipt<unknown>,
  action: CodingModelActionObservation,
): boolean {
  return receipt.actionId === action.actionId
    && receipt.tool === action.tool
    && receipt.purpose === action.purpose
    && receipt.inputSha256 === codingSemanticDigest(action.input)
    && sameEffects(receipt.effects, action.effects);
}

function sameEffects(left: readonly CodingToolEffect[], right: readonly CodingToolEffect[]): boolean {
  return left.length === right.length && left.every((effect, index) => effect === right[index]);
}

function mergeById<T extends { readonly id: string }>(preferred: readonly T[], inherited: readonly T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of preferred) merged.set(item.id, item);
  for (const item of inherited) {
    if (!merged.has(item.id)) merged.set(item.id, item);
  }
  return [...merged.values()];
}

function uniquePaths(values: readonly string[]): string[] {
  return uniqueStrings(values.map(value => (
    String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//u, '')
  )).filter(Boolean));
}

function uniqueDeliverableKinds(values: readonly CodingDeliverableKind[]): CodingDeliverableKind[] {
  return [...new Set(values.filter(value => (
    value === 'source-change' || value === 'report' || value === 'verification-result'
  )))];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function sanitizeId(value: string): string {
  return String(value || '').replace(/[^0-9A-Za-z._-]+/gu, '-').slice(0, 160) || 'action';
}

const DERIVED_CONSTRAINTS = new Set([
  'no-workspace-mutation',
  'workspace-root-only',
  'external-effect-requires-approval',
  'dependency-change-requires-approval',
  'network-requires-approval',
  'verification-before-completion',
]);
