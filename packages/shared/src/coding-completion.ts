import type { CodingTerminalStatus } from './coding-conformance';
import type { CodingToolExecutionReceipt } from './coding-tool-execution';
import type { CodingWorkspaceMutationReceipt } from './coding-workspace-mutation';
import type { CodingVerificationReceipt } from './coding-verification';
import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';

export const CODING_COMPLETION_DECISION_VERSION = 'devseek.coding-completion-decision/v1' as const;

export interface CodingCompletionAcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
}

export interface CodingCompletionReview {
  readonly status: 'passed' | 'failed' | 'not-run';
  readonly evidenceRefs: readonly string[];
}

export interface CodingCompletionDecisionInput {
  readonly runId: string;
  readonly decisionId: string;
  readonly idempotencyKey: string;
  readonly acceptance: readonly CodingCompletionAcceptanceCriterion[];
  readonly verificationRequired: boolean;
  readonly reviewRequired: boolean;
  readonly requestedTerminalStatus?: 'failed' | 'cancelled';
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly mutations: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly verifications: readonly CodingVerificationReceipt[];
  readonly acceptanceEvidence: readonly CodingCompletionAcceptanceDecision[];
  readonly review?: CodingCompletionReview;
  readonly pendingRefs: readonly string[];
  readonly adverseEvidenceRefs: readonly string[];
  readonly residualRisks: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingKernelCompletionEvidence {
  readonly reviewRequired: boolean;
  readonly acceptanceEvidence: readonly CodingCompletionAcceptanceDecision[];
  readonly review?: CodingCompletionReview;
  readonly pendingRefs: readonly string[];
  readonly adverseEvidenceRefs: readonly string[];
  readonly residualRisks: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingCompletionAcceptanceDecision {
  readonly criterionId: string;
  readonly status: 'passed' | 'failed' | 'blocked' | 'not-applicable';
  readonly evidenceRefs: readonly string[];
}

export interface CodingCompletionDecision {
  readonly version: typeof CODING_COMPLETION_DECISION_VERSION;
  readonly runId: string;
  readonly decisionId: string;
  readonly idempotencyKey: string;
  readonly status: CodingTerminalStatus;
  readonly acceptance: readonly CodingCompletionAcceptanceDecision[];
  readonly reasonCodes: readonly string[];
  readonly residualRisks: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CompletionDecisionPort {
  decide(input: CodingCompletionDecisionInput): CodingCompletionDecision;
}

/** The only semantic owner that can derive a terminal coding decision from settled evidence. */
export class CanonicalCompletionDecisionService implements CompletionDecisionPort {
  private readonly decisions = new Map<string, { canonicalInput: string; decision: CodingCompletionDecision }>();

  decide(input: CodingCompletionDecisionInput): CodingCompletionDecision {
    const snapshot = snapshotDecisionInput(input);
    const key = completionIdentity(snapshot);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.decisions.get(key);
    if (existing) {
      if (existing.canonicalInput !== canonicalInput) {
        throw new Error('coding-completion:conflicting-decision-identity');
      }
      return existing.decision;
    }
    const decision = deriveCompletionDecision(snapshot);
    this.decisions.set(key, { canonicalInput, decision });
    return decision;
  }
}

function deriveCompletionDecision(input: CodingCompletionDecisionInput): CodingCompletionDecision {
  const unresolvedVerifications = unresolvedVerificationReceipts(
    input.verifications,
    input.toolExecutions,
  );
  const acceptance = projectCompletionAcceptance(
    input.acceptance,
    unresolvedVerifications,
    input.acceptanceEvidence,
  );
  const reasonCodes: string[] = [];
  const verificationActionIds = new Set(input.verifications.map(receipt => receipt.actionId));
  const hasIndeterminateEffect = input.toolExecutions.some(receipt => (
    receipt.status === 'indeterminate' && !verificationActionIds.has(receipt.actionId)
  ))
    || input.mutations.some(receipt => receipt.status === 'indeterminate');
  const hasFailedEffect = input.toolExecutions.some(receipt => (
    receipt.status === 'failed'
      && !verificationActionIds.has(receipt.actionId)
      && !verificationToolFailureWasRecovered(receipt, input.toolExecutions, input.verifications)
  ))
    || input.mutations.some(receipt => receipt.status === 'failed' || receipt.status === 'rolled-back');
  const hasDeniedEffect = input.toolExecutions.some(receipt => receipt.status === 'denied');
  const hasFailedVerification = unresolvedVerifications.some(receipt => receipt.status === 'failed');
  const hasUnverified = unresolvedVerifications.some(receipt => (
    receipt.status === 'unverified' || receipt.status === 'indeterminate'
  ));
  const acceptanceFailed = acceptance.some(item => item.status === 'failed');
  const acceptanceBlocked = acceptance.some(item => item.status === 'blocked');

  if (input.pendingRefs.length > 0) reasonCodes.push('pending-work');
  if (input.adverseEvidenceRefs.length > 0) reasonCodes.push('unresolved-adverse-evidence');
  if (hasIndeterminateEffect) reasonCodes.push('indeterminate-effect');
  if (hasFailedEffect) reasonCodes.push('failed-effect');
  if (hasDeniedEffect) reasonCodes.push('denied-effect');
  if (hasFailedVerification || acceptanceFailed) reasonCodes.push('verification-failed');
  if (hasUnverified || acceptanceBlocked) reasonCodes.push('verification-incomplete');
  if (input.verificationRequired && unresolvedVerifications.length === 0) reasonCodes.push('verification-not-run');
  if (input.reviewRequired && input.review?.status !== 'passed') reasonCodes.push('review-not-passed');
  if (input.review?.status === 'failed') reasonCodes.push('review-veto');

  let status: CodingTerminalStatus;
  if (input.requestedTerminalStatus === 'failed') {
    status = 'failed';
    reasonCodes.push('execution-failed');
  } else if (input.requestedTerminalStatus === 'cancelled') {
    status = hasIndeterminateEffect || input.pendingRefs.length > 0 ? 'blocked' : 'cancelled';
    if (status === 'blocked') reasonCodes.push('cancellation-unsettled');
  } else if (hasFailedEffect || hasFailedVerification || acceptanceFailed || input.review?.status === 'failed') {
    status = 'failed';
  } else if (reasonCodes.length > 0) {
    status = 'blocked';
  } else {
    status = 'completed';
  }

  const evidenceRefs = uniqueCodingRefs([
    ...input.evidenceRefs,
    ...input.toolExecutions.flatMap(receipt => receipt.evidenceRefs),
    ...input.mutations.flatMap(receipt => receipt.evidenceRefs),
    ...input.verifications.flatMap(receipt => receipt.evidenceRefs),
    ...input.acceptanceEvidence.flatMap(result => result.evidenceRefs),
    ...(input.review?.evidenceRefs ?? []),
    ...input.adverseEvidenceRefs,
  ]);
  if (status === 'completed' && evidenceRefs.length === 0) {
    status = 'blocked';
    reasonCodes.push('completion-evidence-missing');
  }
  return snapshotCodingValue({
    version: CODING_COMPLETION_DECISION_VERSION,
    runId: input.runId,
    decisionId: input.decisionId,
    idempotencyKey: input.idempotencyKey,
    status,
    acceptance,
    reasonCodes: uniqueCodingRefs(reasonCodes),
    residualRisks: input.residualRisks,
    evidenceRefs,
  }, 'completion-decision') as CodingCompletionDecision;
}

function verificationToolFailureWasRecovered(
  failed: CodingToolExecutionReceipt<unknown>,
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
  verifications: readonly CodingVerificationReceipt[],
): boolean {
  if (failed.purpose !== 'verify' || !failed.effects.includes('process')) return false;
  return toolExecutions.some(candidate => (
    candidate.runId === failed.runId
      && candidate.sequence > failed.sequence
      && candidate.status === 'completed'
      && candidate.purpose === 'verify'
      && candidate.effects.includes('process')
      && verifications.some(receipt => (
        receipt.runId === failed.runId
          && receipt.actionId === candidate.actionId
          && receipt.status === 'passed'
          && receipt.acceptance.length > 0
          && receipt.acceptance.every(result => result.status === 'passed')
      ))
  ));
}

function unresolvedVerificationReceipts(
  receipts: readonly CodingVerificationReceipt[],
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
): readonly CodingVerificationReceipt[] {
  return receipts.filter(previous => (
    previous.status === 'passed'
    || !receipts.some(candidate => verificationSupersedes(candidate, previous, toolExecutions))
  ));
}

function verificationSupersedes(
  candidate: CodingVerificationReceipt,
  previous: CodingVerificationReceipt,
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
): boolean {
  if (candidate.status !== 'passed'
    || candidate.runId !== previous.runId
    || candidate.sequence <= previous.sequence) {
    return false;
  }
  const candidatePaths = new Set(candidate.scopePaths.map(normalizeVerificationPath));
  if (!previous.scopePaths.every(path => candidatePaths.has(normalizeVerificationPath(path)))) {
    return false;
  }
  const passedAcceptance = new Set(
    candidate.acceptance
      .filter(result => result.status === 'passed')
      .map(result => result.criterionId),
  );
  if (previous.acceptance.length === 0
    || !previous.acceptance.every(result => passedAcceptance.has(result.criterionId))) {
    return false;
  }
  const failedTool = matchingVerificationTool(previous, toolExecutions, 'failed');
  return !failedTool
    || matchingVerificationTool(candidate, toolExecutions, 'completed') !== undefined;
}

function matchingVerificationTool(
  verification: CodingVerificationReceipt,
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
  status: 'completed' | 'failed',
): CodingToolExecutionReceipt<unknown> | undefined {
  return toolExecutions.find(receipt => (
    receipt.runId === verification.runId
      && receipt.sequence === verification.sequence
      && receipt.actionId === verification.actionId
      && receipt.tool === 'run_terminal'
      && receipt.purpose === 'verify'
      && receipt.effects.length === 1
      && receipt.effects[0] === 'process'
      && receipt.status === status
  ));
}

function normalizeVerificationPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
}

function projectCompletionAcceptance(
  criteria: readonly CodingCompletionAcceptanceCriterion[],
  verifications: readonly CodingVerificationReceipt[],
  directEvidence: readonly CodingCompletionAcceptanceDecision[],
): CodingCompletionAcceptanceDecision[] {
  return criteria.map(criterion => {
    const results: Array<{
      readonly status: 'passed' | 'failed' | 'unverified' | 'blocked' | 'not-applicable';
      readonly evidenceRefs: readonly string[];
    }> = [
      ...verifications.flatMap(receipt => receipt.acceptance)
        .filter(result => result.criterionId === criterion.id),
      ...directEvidence.filter(result => result.criterionId === criterion.id),
    ];
    const failed = results.filter(result => result.status === 'failed');
    const passed = results.filter(result => result.status === 'passed');
    const notApplicable = results.filter(result => result.status === 'not-applicable');
    const blocked = results.filter(result => (
      result.status === 'blocked' || result.status === 'unverified'
    ));
    return {
      criterionId: criterion.id,
      status: failed.length > 0
        ? 'failed'
        : passed.length > 0
          ? 'passed'
          : notApplicable.length > 0
            ? 'not-applicable'
            : 'blocked',
      evidenceRefs: uniqueCodingRefs(
        (failed.length > 0
          ? failed
          : passed.length > 0
            ? passed
            : notApplicable.length > 0
              ? notApplicable
              : blocked)
          .flatMap(result => result.evidenceRefs),
      ),
    };
  });
}

function snapshotDecisionInput(input: CodingCompletionDecisionInput): CodingCompletionDecisionInput {
  const runId = normalizedCodingId(input.runId, 'completion-run-id');
  if (input.requestedTerminalStatus !== undefined
    && input.requestedTerminalStatus !== 'failed'
    && input.requestedTerminalStatus !== 'cancelled') {
    throw new Error('coding-completion:invalid-requested-terminal-status');
  }
  const acceptance = input.acceptance.map(criterion => Object.freeze({
    id: normalizedCodingId(criterion.id, 'completion-acceptance-id'),
    statement: normalizedCodingId(criterion.statement, 'completion-acceptance-statement'),
  }));
  if (new Set(acceptance.map(criterion => criterion.id)).size !== acceptance.length) {
    throw new Error('coding-completion:duplicate-acceptance-id');
  }
  const acceptanceIds = new Set(acceptance.map(criterion => criterion.id));
  const acceptanceEvidence = input.acceptanceEvidence.map(result => {
    const criterionId = normalizedCodingId(result.criterionId, 'completion-evidence-criterion-id');
    if (!acceptanceIds.has(criterionId)) throw new Error('coding-completion:unknown-acceptance-id');
    if (!['passed', 'failed', 'blocked', 'not-applicable'].includes(result.status)) {
      throw new Error('coding-completion:invalid-acceptance-status');
    }
    const evidenceRefs = uniqueCodingRefs(result.evidenceRefs);
    if ((result.status === 'passed' || result.status === 'not-applicable') && evidenceRefs.length === 0) {
      throw new Error('coding-completion:acceptance-evidence-missing');
    }
    return { criterionId, status: result.status, evidenceRefs };
  });
  assertReceiptRunIds(runId, input.toolExecutions, 'tool');
  assertReceiptRunIds(runId, input.mutations, 'mutation');
  assertReceiptRunIds(runId, input.verifications, 'verification');
  if (input.toolExecutions.some(receipt => !['completed', 'failed', 'denied', 'indeterminate'].includes(receipt.status))) {
    throw new Error('coding-completion:invalid-tool-status');
  }
  if (input.mutations.some(receipt => !['committed', 'rolled-back', 'failed', 'indeterminate'].includes(receipt.status))) {
    throw new Error('coding-completion:invalid-mutation-status');
  }
  if (input.verifications.some(receipt => !['passed', 'failed', 'unverified', 'indeterminate'].includes(receipt.status))) {
    throw new Error('coding-completion:invalid-verification-status');
  }
  return snapshotCodingValue({
    ...input,
    runId,
    decisionId: normalizedCodingId(input.decisionId, 'completion-decision-id'),
    idempotencyKey: normalizedCodingId(input.idempotencyKey, 'completion-idempotency-key'),
    acceptance,
    acceptanceEvidence,
    pendingRefs: uniqueCodingRefs(input.pendingRefs),
    adverseEvidenceRefs: uniqueCodingRefs(input.adverseEvidenceRefs),
    residualRisks: uniqueCodingRefs(input.residualRisks),
    evidenceRefs: uniqueCodingRefs(input.evidenceRefs),
  }, 'completion-input') as CodingCompletionDecisionInput;
}

function assertReceiptRunIds(
  runId: string,
  receipts: readonly { readonly runId: string }[],
  kind: 'tool' | 'mutation' | 'verification',
): void {
  if (receipts.some(receipt => receipt.runId !== runId)) {
    throw new Error(`coding-completion:${kind}-run-mismatch`);
  }
}

function completionIdentity(input: Pick<CodingCompletionDecisionInput, 'runId' | 'decisionId'>): string {
  return `${input.runId}\u0000${input.decisionId}`;
}
