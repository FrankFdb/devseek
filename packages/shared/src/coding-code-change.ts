import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type { CodingChangePlan } from './coding-design-plan';
import type { CodingWorkspaceMutationReceipt } from './coding-workspace-mutation';
import {
  codingWorkspaceTargetMatchesScope,
  normalizeCodingWorkspacePath,
} from './coding-workspace-scope';

export const CODING_CODE_CHANGE_DECISION_VERSION = 'devseek.coding-code-change-decision/v1' as const;

export interface AssessCodingCodeChangeInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly plan: CodingChangePlan;
  readonly mutations: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingCodeChangeDecision {
  readonly version: typeof CODING_CODE_CHANGE_DECISION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'conformant' | 'not-applicable' | 'incomplete' | 'failed' | 'indeterminate';
  readonly plannedTargets: readonly string[];
  readonly changedPaths: readonly string[];
  readonly uncoveredTargets: readonly string[];
  readonly unplannedPaths: readonly string[];
  readonly failedActionIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CodeChangePort {
  readonly runId: string;
  assess(input: AssessCodingCodeChangeInput): CodingCodeChangeDecision;
  decisions(): readonly CodingCodeChangeDecision[];
}

export interface CodeChangeServicePort {
  bind(input: { readonly runId: string }): CodeChangePort;
}

/** Settles whether actual mutations implement the accepted change plan with readback evidence. */
export class CanonicalCodeChangeService implements CodeChangeServicePort {
  bind(input: { readonly runId: string }): CodeChangePort {
    return new CanonicalCodeChangeSession(normalizedCodingId(input.runId, 'code-change-run-id'));
  }
}

class CanonicalCodeChangeSession implements CodeChangePort {
  private readonly settled = new Map<string, { input: string; decision: CodingCodeChangeDecision }>();

  constructor(readonly runId: string) {}

  assess(input: AssessCodingCodeChangeInput): CodingCodeChangeDecision {
    const snapshot = snapshotCodeChangeInput(input, this.runId);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) codeChangeFailure('conflicting-action-identity');
      return existing.decision;
    }
    const decision = assessCodeChange(this.runId, snapshot);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingCodeChangeDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

function assessCodeChange(runId: string, input: AssessCodingCodeChangeInput): CodingCodeChangeDecision {
  const plannedTargets = uniqueCodingRefs(input.plan.steps
    .filter(step => step.action === 'modify')
    .map(step => normalizeCodingWorkspacePath(step.target)));
  const changedPaths = uniqueCodingRefs(input.mutations
    .filter(receipt => receipt.status === 'committed')
    .flatMap(receipt => receipt.paths)
    .map(normalizeCodingWorkspacePath));
  const unplannedPaths = changedPaths.filter(path => (
    !plannedTargets.some(target => codingWorkspaceTargetMatchesScope(path, target))
  ));
  const uncoveredTargets = plannedTargets.filter(target => (
    !changedPaths.some(path => codingWorkspaceTargetMatchesScope(path, target))
  ));
  const indeterminate = input.mutations.filter(receipt => receipt.status === 'indeterminate');
  const failed = input.mutations.filter(receipt => receipt.status === 'failed');
  const missingReadback = input.mutations.filter(receipt => (
    receipt.status === 'committed' && (!receipt.readbackRef || receipt.evidenceRefs.length === 0)
  ));
  let status: CodingCodeChangeDecision['status'];
  if (plannedTargets.length === 0) status = 'not-applicable';
  else if (indeterminate.length > 0) status = 'indeterminate';
  else if (failed.length > 0 || missingReadback.length > 0 || unplannedPaths.length > 0) status = 'failed';
  else if (uncoveredTargets.length > 0) status = 'incomplete';
  else status = 'conformant';
  const reasonCodes = status === 'conformant'
    ? ['planned-change-committed-and-read-back']
    : status === 'not-applicable'
      ? ['code-change-not-applicable']
      : uniqueCodingRefs([
          ...(indeterminate.length > 0 ? ['mutation-indeterminate'] : []),
          ...(failed.length > 0 ? ['mutation-failed'] : []),
          ...(missingReadback.length > 0 ? ['committed-mutation-missing-readback'] : []),
          ...(unplannedPaths.length > 0 ? ['unplanned-path-mutated'] : []),
          ...(uncoveredTargets.length > 0 ? ['planned-target-uncovered'] : []),
        ]);
  return snapshotCodingValue({
    version: CODING_CODE_CHANGE_DECISION_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    plannedTargets: Object.freeze(plannedTargets),
    changedPaths: Object.freeze(changedPaths),
    uncoveredTargets: Object.freeze(uncoveredTargets),
    unplannedPaths: Object.freeze(unplannedPaths),
    failedActionIds: Object.freeze(uniqueCodingRefs([
      ...indeterminate,
      ...failed,
      ...missingReadback,
    ].map(receipt => receipt.actionId))),
    reasonCodes: Object.freeze(reasonCodes),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.plan.evidenceRefs,
      ...input.evidenceRefs,
      ...input.mutations.flatMap(receipt => receipt.evidenceRefs),
      ...changedPaths.map(path => `code-change:path:${path}`),
    ])),
  }, 'code-change-decision') as CodingCodeChangeDecision;
}

function snapshotCodeChangeInput(
  input: AssessCodingCodeChangeInput,
  runId: string,
): AssessCodingCodeChangeInput {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) codeChangeFailure('invalid-sequence');
  if (input.mutations.some(receipt => receipt.runId !== runId)) codeChangeFailure('mutation-run-mismatch');
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'code-change-action-id'),
    plan: snapshotCodingValue(input.plan, 'code-change-plan') as CodingChangePlan,
    mutations: Object.freeze(input.mutations.map(receipt => (
      snapshotCodingValue(receipt, 'code-change-mutation') as CodingWorkspaceMutationReceipt<unknown>
    ))),
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function codeChangeFailure(reason: string): never {
  throw new Error(`coding-code-change:${reason}`);
}
