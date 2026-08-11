import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type { CodingCodeChangeDecision } from './coding-code-change';
import { codingSemanticDigest } from './coding-semantic-digest';
import type { CodingToolExecutionReceipt } from './coding-tool-execution';
import {
  settledCodingVerificationReceipts,
  type CodingVerificationReceipt,
} from './coding-verification';
import {
  codingWorkspaceTargetMatchesScope,
  normalizeCodingWorkspacePath,
} from './coding-workspace-scope';

export const CODING_INDEPENDENT_REVIEW_DECISION_VERSION =
  'devseek.coding-independent-review-decision/v1' as const;

export type CodingIndependentReviewStatus =
  | 'passed'
  | 'failed'
  | 'not-run'
  | 'not-required'
  | 'indeterminate';

export interface CodingIndependentReviewFinding {
  readonly findingId: string;
  readonly severity: 'critical' | 'important' | 'advisory';
  readonly relation: 'introduced' | 'pre-existing';
  readonly disposition: 'open' | 'resolved';
  readonly summary: string;
  readonly path?: string;
  readonly line?: number;
  readonly verified: boolean;
  readonly evidenceRefs: readonly string[];
}

/** A read-only reviewer observation. It cannot itself authorize a fix or delivery effect. */
export interface CodingIndependentReviewObservation {
  readonly status: 'passed' | 'failed' | 'not-run';
  readonly reviewerId?: string;
  readonly implementationActorId?: string;
  readonly scopePaths?: readonly string[];
  readonly findings?: readonly CodingIndependentReviewFinding[];
  readonly evidenceRefs: readonly string[];
}

export interface AssessCodingIndependentReviewInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly reviewRequired: boolean;
  readonly implementationActorId: string;
  readonly codeChange: CodingCodeChangeDecision;
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly verifications: readonly CodingVerificationReceipt[];
  readonly observation?: CodingIndependentReviewObservation;
  readonly evidenceRefs: readonly string[];
}

export interface CodingIndependentReviewDecision {
  readonly version: typeof CODING_INDEPENDENT_REVIEW_DECISION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: CodingIndependentReviewStatus;
  readonly reviewFingerprint: string;
  readonly reviewerId?: string;
  readonly implementationActorId: string;
  readonly scopePaths: readonly string[];
  readonly uncoveredPaths: readonly string[];
  readonly findings: readonly CodingIndependentReviewFinding[];
  readonly blockingFindingIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface IndependentReviewPort {
  readonly runId: string;
  assess(input: AssessCodingIndependentReviewInput): CodingIndependentReviewDecision;
  decisions(): readonly CodingIndependentReviewDecision[];
}

export interface IndependentReviewServicePort {
  bind(input: { readonly runId: string }): IndependentReviewPort;
}

/** Validates independent, read-only review evidence against the exact changed scope. */
export class CanonicalIndependentReviewService implements IndependentReviewServicePort {
  bind(input: { readonly runId: string }): IndependentReviewPort {
    return new CanonicalIndependentReviewSession(
      normalizedCodingId(input.runId, 'independent-review-run-id'),
    );
  }
}

class CanonicalIndependentReviewSession implements IndependentReviewPort {
  private readonly settled = new Map<
    string,
    { readonly input: string; readonly decision: CodingIndependentReviewDecision }
  >();

  constructor(readonly runId: string) {}

  assess(input: AssessCodingIndependentReviewInput): CodingIndependentReviewDecision {
    const snapshot = snapshotReviewInput(input, this.runId);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) reviewFailure('conflicting-action-identity');
      return existing.decision;
    }
    const decision = assessReview(this.runId, snapshot);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingIndependentReviewDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

function assessReview(
  runId: string,
  input: AssessCodingIndependentReviewInput,
): CodingIndependentReviewDecision {
  const settledVerifications = settledCodingVerificationReceipts(
    input.verifications,
    input.toolExecutions,
  );
  const reviewFingerprint = codingSemanticDigest({
    codeChange: input.codeChange,
    verifications: settledVerifications,
  });
  const observation = input.observation;
  const scopePaths = observation?.scopePaths ?? [];
  const findings = observation?.findings ?? [];
  const uncoveredPaths = input.codeChange.changedPaths.filter(path => (
    !scopePaths.some(scope => codingWorkspaceTargetMatchesScope(path, scope))
  ));
  const blockingFindingIds = findings
    .filter(finding => finding.relation === 'introduced'
      && finding.disposition === 'open'
      && (finding.severity === 'critical' || finding.severity === 'important'))
    .map(finding => finding.findingId);
  const unverifiedFindingIds = findings
    .filter(finding => !finding.verified || finding.evidenceRefs.length === 0)
    .map(finding => finding.findingId);
  const verificationDrift = settledVerifications.some(receipt => receipt.status !== 'passed');
  const independent = Boolean(
    observation?.reviewerId
      && observation.implementationActorId
      && observation.reviewerId !== observation.implementationActorId
      && observation.implementationActorId === input.implementationActorId,
  );

  let status: CodingIndependentReviewStatus;
  if (!observation) status = input.reviewRequired ? 'not-run' : 'not-required';
  else if (observation.status === 'not-run') status = 'not-run';
  else if (!independent
    || uncoveredPaths.length > 0
    || unverifiedFindingIds.length > 0
    || observation.evidenceRefs.length === 0
    || verificationDrift) {
    status = 'indeterminate';
  } else if (observation.status === 'failed' || blockingFindingIds.length > 0) {
    status = 'failed';
  } else {
    status = 'passed';
  }

  const reasonCodes = status === 'passed'
    ? ['independent-review-passed']
    : status === 'not-required'
      ? ['independent-review-not-required']
      : uniqueCodingRefs([
          ...(observation ? [] : ['independent-review-missing']),
          ...(observation?.status === 'not-run' ? ['independent-review-not-run'] : []),
          ...(observation && observation.status !== 'not-run' && !independent
            ? ['reviewer-not-independent']
            : []),
          ...(uncoveredPaths.length > 0 ? ['review-scope-incomplete'] : []),
          ...(unverifiedFindingIds.length > 0 ? ['review-finding-unverified'] : []),
          ...(observation && observation.status !== 'not-run' && observation.evidenceRefs.length === 0
            ? ['review-evidence-missing']
            : []),
          ...(verificationDrift ? ['review-verification-not-passed'] : []),
          ...(observation?.status === 'failed' ? ['reviewer-reported-failure'] : []),
          ...(blockingFindingIds.length > 0 ? ['introduced-blocking-finding-open'] : []),
        ]);

  return snapshotCodingValue({
    version: CODING_INDEPENDENT_REVIEW_DECISION_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    reviewFingerprint,
    ...(observation?.reviewerId ? { reviewerId: observation.reviewerId } : {}),
    implementationActorId: input.implementationActorId,
    scopePaths: Object.freeze(scopePaths),
    uncoveredPaths: Object.freeze(uniqueCodingRefs(uncoveredPaths)),
    findings: Object.freeze(findings),
    blockingFindingIds: Object.freeze(uniqueCodingRefs(blockingFindingIds)),
    reasonCodes: Object.freeze(reasonCodes),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...input.codeChange.evidenceRefs,
      ...input.verifications.flatMap(receipt => receipt.evidenceRefs),
      ...(observation?.evidenceRefs ?? []),
      ...findings.flatMap(finding => finding.evidenceRefs),
      `independent-review:fingerprint:${reviewFingerprint}`,
    ])),
  }, 'independent-review-decision') as CodingIndependentReviewDecision;
}

function snapshotReviewInput(
  input: AssessCodingIndependentReviewInput,
  runId: string,
): AssessCodingIndependentReviewInput {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) reviewFailure('invalid-sequence');
  if (input.codeChange.runId !== runId) reviewFailure('code-change-run-mismatch');
  if (input.verifications.some(receipt => receipt.runId !== runId)
    || input.toolExecutions.some(receipt => receipt.runId !== runId)) {
    reviewFailure('verification-run-mismatch');
  }
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'independent-review-action-id'),
    reviewRequired: input.reviewRequired === true,
    implementationActorId: normalizedCodingId(
      input.implementationActorId,
      'implementation-actor-id',
    ),
    codeChange: snapshotCodingValue(
      input.codeChange,
      'independent-review-code-change',
    ) as CodingCodeChangeDecision,
    toolExecutions: Object.freeze(input.toolExecutions.map(receipt => (
      snapshotCodingValue(
        receipt,
        'independent-review-tool-execution',
      ) as CodingToolExecutionReceipt<unknown>
    ))),
    verifications: Object.freeze(input.verifications.map(receipt => (
      snapshotCodingValue(receipt, 'independent-review-verification') as CodingVerificationReceipt
    ))),
    ...(input.observation ? { observation: snapshotObservation(input.observation) } : {}),
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function snapshotObservation(
  observation: CodingIndependentReviewObservation,
): CodingIndependentReviewObservation {
  if (!observation || typeof observation !== 'object') reviewFailure('invalid-observation');
  if (!['passed', 'failed', 'not-run'].includes(observation.status)) {
    reviewFailure('invalid-observation-status');
  }
  const findings = (observation.findings ?? []).map(snapshotFinding);
  if (new Set(findings.map(finding => finding.findingId)).size !== findings.length) {
    reviewFailure('duplicate-finding-id');
  }
  const reviewerId = observation.reviewerId
    ? normalizedCodingId(observation.reviewerId, 'reviewer-id')
    : undefined;
  const implementationActorId = observation.implementationActorId
    ? normalizedCodingId(observation.implementationActorId, 'review-implementation-actor-id')
    : undefined;
  return Object.freeze({
    status: observation.status,
    ...(reviewerId ? { reviewerId } : {}),
    ...(implementationActorId ? { implementationActorId } : {}),
    scopePaths: Object.freeze(uniqueCodingRefs(
      (observation.scopePaths ?? []).map(normalizeCodingWorkspacePath),
    )),
    findings: Object.freeze(findings),
    evidenceRefs: Object.freeze(uniqueCodingRefs(observation.evidenceRefs)),
  });
}

function snapshotFinding(finding: CodingIndependentReviewFinding): CodingIndependentReviewFinding {
  if (!finding || typeof finding !== 'object') reviewFailure('invalid-finding');
  if (!['critical', 'important', 'advisory'].includes(finding.severity)) {
    reviewFailure('invalid-finding-severity');
  }
  if (!['introduced', 'pre-existing'].includes(finding.relation)) {
    reviewFailure('invalid-finding-relation');
  }
  if (!['open', 'resolved'].includes(finding.disposition)) {
    reviewFailure('invalid-finding-disposition');
  }
  if (finding.line !== undefined && (!Number.isSafeInteger(finding.line) || finding.line < 1)) {
    reviewFailure('invalid-finding-line');
  }
  return Object.freeze({
    findingId: normalizedCodingId(finding.findingId, 'review-finding-id'),
    severity: finding.severity,
    relation: finding.relation,
    disposition: finding.disposition,
    summary: normalizedCodingId(finding.summary, 'review-finding-summary'),
    ...(finding.path ? { path: normalizeCodingWorkspacePath(finding.path) } : {}),
    ...(finding.line === undefined ? {} : { line: finding.line }),
    verified: finding.verified === true,
    evidenceRefs: Object.freeze(uniqueCodingRefs(finding.evidenceRefs)),
  });
}

function reviewFailure(reason: string): never {
  throw new Error(`coding-independent-review:${reason}`);
}
