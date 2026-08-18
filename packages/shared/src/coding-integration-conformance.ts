import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type { CodingCodeChangeDecision } from './coding-code-change';
import type { CodingToolAuthorityReceipt } from './coding-tool-authority';
import type { CodingToolExecutionReceipt } from './coding-tool-execution';
import type { CodingVerificationReceipt } from './coding-verification';
import type { CodingWorkspaceMutationReceipt } from './coding-workspace-mutation';
import {
  codingWorkspaceTargetMatchesScope,
  normalizeCodingWorkspacePath,
} from './coding-workspace-scope';

export const CODING_INTEGRATION_CONFORMANCE_VERSION = 'devseek.coding-integration-conformance/v1' as const;

export interface AssessCodingIntegrationInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly codeChange: CodingCodeChangeDecision;
  readonly toolAuthorityReceipts: readonly CodingToolAuthorityReceipt[];
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly mutations: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly verifications: readonly CodingVerificationReceipt[];
  /** Final TaskContract decides whether a mutation must be linked to verification. */
  readonly verificationRequired: boolean;
  readonly evidenceRefs: readonly string[];
}

export interface CodingIntegrationConformanceDecision {
  readonly version: typeof CODING_INTEGRATION_CONFORMANCE_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'conformant' | 'not-applicable' | 'incomplete' | 'failed' | 'indeterminate';
  readonly bypassedMutationActionIds: readonly string[];
  readonly orphanMutationToolActionIds: readonly string[];
  readonly unexecutedAuthorizedActionIds: readonly string[];
  readonly indeterminateActionIds: readonly string[];
  readonly unverifiedPaths: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface IntegrationConformancePort {
  readonly runId: string;
  assess(input: AssessCodingIntegrationInput): CodingIntegrationConformanceDecision;
  decisions(): readonly CodingIntegrationConformanceDecision[];
}

export interface IntegrationConformanceServicePort {
  bind(input: { readonly runId: string }): IntegrationConformancePort;
}

/** Proves that tool dispatch, workspace mutation, and verification form one causal path. */
export class CanonicalIntegrationConformanceService implements IntegrationConformanceServicePort {
  bind(input: { readonly runId: string }): IntegrationConformancePort {
    return new CanonicalIntegrationConformanceSession(
      normalizedCodingId(input.runId, 'integration-conformance-run-id'),
    );
  }
}

class CanonicalIntegrationConformanceSession implements IntegrationConformancePort {
  private readonly settled = new Map<string, {
    input: string;
    decision: CodingIntegrationConformanceDecision;
  }>();

  constructor(readonly runId: string) {}

  assess(input: AssessCodingIntegrationInput): CodingIntegrationConformanceDecision {
    const snapshot = snapshotIntegrationInput(input, this.runId);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) integrationFailure('conflicting-action-identity');
      return existing.decision;
    }
    const decision = assessIntegration(this.runId, snapshot);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingIntegrationConformanceDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

function assessIntegration(
  runId: string,
  input: AssessCodingIntegrationInput,
): CodingIntegrationConformanceDecision {
  const committed = input.mutations.filter(receipt => receipt.status === 'committed');
  const mutatingTools = input.toolExecutions.filter(receipt => receipt.effects.includes('workspace-mutation'));
  const completedMutatingTools = mutatingTools.filter(receipt => receipt.status === 'completed');
  const bypassedMutationActionIds = committed
    .filter(receipt => !completedMutatingTools.some(tool => tool.actionId === receipt.actionId))
    .map(receipt => receipt.actionId);
  const orphanMutationToolActionIds = completedMutatingTools
    .filter(tool => !committed.some(receipt => receipt.actionId === tool.actionId))
    .map(receipt => receipt.actionId);
  const executedActionIds = new Set(input.toolExecutions.map(receipt => receipt.actionId));
  const unexecutedAuthorizedActionIds = input.toolAuthorityReceipts
    .filter(receipt => receipt.status === 'authorized' && !executedActionIds.has(receipt.actionId))
    .map(receipt => receipt.actionId);
  const indeterminateActionIds = uniqueCodingRefs([
    ...input.mutations.filter(receipt => receipt.status === 'indeterminate').map(receipt => receipt.actionId),
    ...mutatingTools.filter(receipt => receipt.status === 'indeterminate').map(receipt => receipt.actionId),
  ]);
  const verificationScopes = input.verificationRequired
    ? uniqueCodingRefs(input.verifications.flatMap(receipt => receipt.scopePaths))
      .map(normalizeCodingWorkspacePath)
    : [];
  const unverifiedPaths = input.verificationRequired
    ? input.codeChange.changedPaths.filter(path => (
        !verificationScopes.some(scope => codingWorkspaceTargetMatchesScope(path, scope))
      ))
    : [];
  let status: CodingIntegrationConformanceDecision['status'];
  if (input.codeChange.status === 'indeterminate' || indeterminateActionIds.length > 0) {
    status = 'indeterminate';
  } else if (input.codeChange.status === 'failed'
    || bypassedMutationActionIds.length > 0
    || orphanMutationToolActionIds.length > 0) {
    status = 'failed';
  } else if (unexecutedAuthorizedActionIds.length > 0) {
    status = 'incomplete';
  } else if (input.codeChange.status === 'not-applicable') {
    status = 'not-applicable';
  } else if (input.codeChange.status !== 'conformant' || unverifiedPaths.length > 0) {
    status = 'incomplete';
  } else {
    status = 'conformant';
  }
  const reasonCodes = status === 'conformant'
    ? ['tool-mutation-verification-chain-conformant']
    : status === 'not-applicable'
      ? ['integration-conformance-not-applicable']
      : uniqueCodingRefs([
          ...(input.codeChange.status !== 'conformant' ? [`code-change:${input.codeChange.status}`] : []),
          ...(bypassedMutationActionIds.length > 0 ? ['workspace-mutation-bypassed-tool-execution'] : []),
          ...(orphanMutationToolActionIds.length > 0 ? ['mutating-tool-missing-transaction-receipt'] : []),
          ...(unexecutedAuthorizedActionIds.length > 0 ? ['authorized-tool-not-executed'] : []),
          ...(indeterminateActionIds.length > 0 ? ['integration-action-indeterminate'] : []),
          ...(unverifiedPaths.length > 0 ? ['changed-path-unverified'] : []),
        ]);
  return snapshotCodingValue({
    version: CODING_INTEGRATION_CONFORMANCE_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    bypassedMutationActionIds: Object.freeze(uniqueCodingRefs(bypassedMutationActionIds)),
    orphanMutationToolActionIds: Object.freeze(uniqueCodingRefs(orphanMutationToolActionIds)),
    unexecutedAuthorizedActionIds: Object.freeze(uniqueCodingRefs(unexecutedAuthorizedActionIds)),
    indeterminateActionIds: Object.freeze(indeterminateActionIds),
    unverifiedPaths: Object.freeze(uniqueCodingRefs(unverifiedPaths)),
    reasonCodes: Object.freeze(reasonCodes),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...input.codeChange.evidenceRefs,
      ...input.toolAuthorityReceipts.flatMap(receipt => receipt.evidenceRefs),
      ...input.toolExecutions.flatMap(receipt => receipt.evidenceRefs),
      ...input.mutations.flatMap(receipt => receipt.evidenceRefs),
      ...input.verifications.flatMap(receipt => receipt.evidenceRefs),
    ])),
  }, 'integration-conformance-decision') as CodingIntegrationConformanceDecision;
}

function snapshotIntegrationInput(
  input: AssessCodingIntegrationInput,
  runId: string,
): AssessCodingIntegrationInput {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) integrationFailure('invalid-sequence');
  if (input.codeChange.runId !== runId) integrationFailure('code-change-run-mismatch');
  const runBound = [
    ...input.toolAuthorityReceipts,
    ...input.toolExecutions,
    ...input.mutations,
    ...input.verifications,
  ];
  if (runBound.some(receipt => receipt.runId !== runId)) integrationFailure('receipt-run-mismatch');
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'integration-action-id'),
    codeChange: snapshotCodingValue(input.codeChange, 'integration-code-change') as CodingCodeChangeDecision,
    toolAuthorityReceipts: Object.freeze(input.toolAuthorityReceipts.map(receipt => (
      snapshotCodingValue(receipt, 'integration-tool-authority') as CodingToolAuthorityReceipt
    ))),
    toolExecutions: Object.freeze(input.toolExecutions.map(receipt => (
      snapshotCodingValue(receipt, 'integration-tool-receipt') as CodingToolExecutionReceipt<unknown>
    ))),
    mutations: Object.freeze(input.mutations.map(receipt => (
      snapshotCodingValue(receipt, 'integration-mutation-receipt') as CodingWorkspaceMutationReceipt<unknown>
    ))),
    verifications: Object.freeze(input.verifications.map(receipt => (
      snapshotCodingValue(receipt, 'integration-verification-receipt') as CodingVerificationReceipt
    ))),
    verificationRequired: input.verificationRequired === true,
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function integrationFailure(reason: string): never {
  throw new Error(`coding-integration-conformance:${reason}`);
}
