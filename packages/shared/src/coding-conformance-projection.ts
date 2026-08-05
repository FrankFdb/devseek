import type { CodingCompletionDecision } from './coding-completion';
import {
  CODING_CONFORMANCE_SCHEMA_VERSION,
  type CodingChangeReceiptProjection,
  type CodingConformanceProjection,
  type CodingReceiptStatus,
  type CodingVerificationStatus,
} from './coding-conformance';
import { snapshotCodingValue } from './coding-contract-utils';
import {
  projectCodingKernelTaskContract,
  type CodingKernelTaskContract,
} from './coding-kernel';
import type { CodingToolExecutionReceipt } from './coding-tool-execution';
import type { CodingVerificationReceipt } from './coding-verification';
import type { CodingWorkspaceMutationReceipt } from './coding-workspace-mutation';

export interface SettledCodingConformanceRun {
  readonly fixtureId: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly verifications: readonly CodingVerificationReceipt[];
  readonly completion: CodingCompletionDecision;
}

/** Projects only already-settled canonical facts; it never fills missing evidence or decides outcomes. */
export function projectSettledCodingConformanceRun(
  input: SettledCodingConformanceRun,
): CodingConformanceProjection {
  const fixtureId = input.fixtureId.trim();
  if (!fixtureId) throw new Error('coding-conformance-projection:missing-fixture-id');

  return snapshotCodingValue({
    schemaVersion: CODING_CONFORMANCE_SCHEMA_VERSION,
    fixtureId,
    taskContract: projectCodingKernelTaskContract(input.taskContract),
    toolExecutions: input.toolExecutions.map(receipt => ({
      sequence: receipt.sequence,
      actionId: receipt.actionId,
      tool: receipt.tool,
      effects: receipt.effects,
      status: projectToolStatus(receipt.status),
      evidenceRefs: receipt.evidenceRefs,
    })),
    changeReceipts: input.changeReceipts.map(projectChangeReceipt),
    verifications: input.verifications.map(receipt => ({
      sequence: receipt.sequence,
      actionId: receipt.actionId,
      verifier: receipt.verifier,
      status: projectVerificationStatus(receipt.status),
      acceptanceIds: receipt.acceptance.map(result => result.criterionId),
      evidenceRefs: receipt.evidenceRefs,
    })),
    completion: {
      status: input.completion.status,
      acceptance: input.completion.acceptance,
      residualRisks: input.completion.residualRisks,
      evidenceRefs: input.completion.evidenceRefs,
    },
  }, 'coding-conformance-projection') as CodingConformanceProjection;
}

function projectToolStatus(
  status: CodingToolExecutionReceipt<unknown>['status'],
): CodingReceiptStatus {
  if (status === 'completed' || status === 'denied' || status === 'failed') return status;
  throw new Error('coding-conformance-projection:indeterminate-tool-execution');
}

function projectChangeReceipt(
  receipt: CodingWorkspaceMutationReceipt<unknown>,
): CodingChangeReceiptProjection {
  if (receipt.status !== 'committed' && receipt.status !== 'rolled-back') {
    throw new Error(`coding-conformance-projection:unsettled-mutation:${receipt.status}`);
  }
  if (!receipt.baselineRef) {
    throw new Error('coding-conformance-projection:mutation-baseline-missing');
  }
  return {
    sequence: receipt.sequence,
    actionId: receipt.actionId,
    status: receipt.status,
    paths: receipt.paths,
    baselineRef: receipt.baselineRef,
    ...(receipt.readbackRef ? { readbackRef: receipt.readbackRef } : {}),
    ...(receipt.rollbackRef ? { rollbackRef: receipt.rollbackRef } : {}),
    evidenceRefs: receipt.evidenceRefs,
  };
}

function projectVerificationStatus(
  status: CodingVerificationReceipt['status'],
): CodingVerificationStatus {
  if (status === 'passed' || status === 'failed') return status;
  return 'blocked';
}
