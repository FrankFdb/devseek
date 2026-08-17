import type { CodingCompletionDecision } from './coding-completion';
import {
  CODING_CONFORMANCE_SCHEMA_VERSION,
  validateCodingConformanceProjection,
  type CodingConformanceEvidenceClass,
  type CodingConformanceFixture,
  type CodingConformanceObservation,
  type CodingChangeReceiptProjection,
  type CodingConformanceProjection,
  type CodingConformanceSurface,
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
import { codingAdverseWorkspaceMutationWasRecovered } from './coding-tool-effect-settlement';

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
      ...(receipt.effectStarted === undefined ? {} : { effectStarted: receipt.effectStarted }),
      evidenceRefs: receipt.evidenceRefs,
    })),
    changeReceipts: projectEffectiveChangeReceipts(input),
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

function projectEffectiveChangeReceipts(
  input: SettledCodingConformanceRun,
): CodingChangeReceiptProjection[] {
  const projected: CodingChangeReceiptProjection[] = [];
  for (const receipt of input.changeReceipts) {
    if (receipt.status === 'failed') {
      const recovered = codingAdverseWorkspaceMutationWasRecovered(
        receipt,
        input.toolExecutions,
        input.changeReceipts,
        input.verifications,
      );
      if (input.completion.status === 'completed' && !recovered) {
        throw new Error('coding-conformance-projection:completed-with-unrecovered-failed-mutation');
      }
      // A failed mutation is a proven no-change attempt. Its failed tool receipt
      // remains in the audit projection; only actual commits or rollbacks belong here.
      continue;
    }
    projected.push(projectChangeReceipt(receipt));
  }
  return projected;
}

export function bindSettledCodingConformanceObservation(input: {
  readonly fixture: CodingConformanceFixture;
  readonly surface: CodingConformanceSurface;
  readonly adapterId: string;
  readonly sourceRefs: readonly string[];
  readonly projection: CodingConformanceProjection;
  readonly evidenceClass?: CodingConformanceEvidenceClass;
}): CodingConformanceObservation {
  const violations = validateCodingConformanceProjection(input.projection, input.surface);
  if (violations.length > 0) {
    const codes = violations.map(violation => `${violation.dimension}:${violation.code}`).join(',');
    throw new Error(`coding-conformance-observation:unsettled-projection:${codes}`);
  }
  if (!input.adapterId.trim() || input.sourceRefs.some(ref => !ref.trim()) || input.sourceRefs.length === 0) {
    throw new Error('coding-conformance-observation:missing-product-source');
  }
  return snapshotCodingValue({
    surface: input.surface,
    adapterId: input.adapterId,
    evidenceClass: input.evidenceClass ?? 'product-route',
    sourceRefs: input.sourceRefs,
    projection: { ...input.projection, fixtureId: input.fixture.fixtureId },
    unavailableDimensions: [],
  }, 'coding-conformance-observation') as CodingConformanceObservation;
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
