import type { CodingArtifactIdentityDecision } from './coding-artifact-identity';
import type { CodingCodeChangeDecision } from './coding-code-change';
import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type { CodingExternalEffectReceipt } from './coding-external-effect';
import type { CodingIndependentReviewDecision } from './coding-independent-review';
import type { CodingIntegrationConformanceDecision } from './coding-integration-conformance';
import { codingSemanticDigest } from './coding-semantic-digest';
import type { CodingToolExecutionReceipt } from './coding-tool-execution';
import {
  settledCodingVerificationReceipts,
  type CodingVerificationReceipt,
} from './coding-verification';

export const CODING_GIT_DELIVERY_DECISION_VERSION =
  'devseek.coding-git-delivery-decision/v1' as const;
export const CODING_DELIVERY_MANIFEST_VERSION = 'devseek.coding-delivery-manifest/v1' as const;

export type CodingGitDeliveryOperation = 'none' | 'commit' | 'push' | 'pull-request';

export interface CodingGitDeliveryObservation {
  readonly operation: Exclude<CodingGitDeliveryOperation, 'none'>;
  readonly status: 'completed' | 'failed' | 'indeterminate';
  readonly effectActionId: string;
  readonly reviewFingerprint: string;
  readonly commitSha?: string;
  readonly remoteRef?: string;
  readonly evidenceRefs: readonly string[];
}

export interface AssessCodingGitDeliveryInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly operation: CodingGitDeliveryOperation;
  readonly review: CodingIndependentReviewDecision;
  readonly externalEffects: readonly CodingExternalEffectReceipt<unknown>[];
  readonly observation?: CodingGitDeliveryObservation;
  readonly evidenceRefs: readonly string[];
}

export interface CodingGitDeliveryDecision {
  readonly version: typeof CODING_GIT_DELIVERY_DECISION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'completed' | 'failed' | 'blocked' | 'indeterminate' | 'not-applicable';
  readonly operation: CodingGitDeliveryOperation;
  readonly reviewFingerprint: string;
  readonly effectActionId?: string;
  readonly commitSha?: string;
  readonly remoteRef?: string;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface GitDeliveryPort {
  readonly runId: string;
  assess(input: AssessCodingGitDeliveryInput): CodingGitDeliveryDecision;
  decisions(): readonly CodingGitDeliveryDecision[];
}

export interface GitDeliveryServicePort {
  bind(input: { readonly runId: string }): GitDeliveryPort;
}

/** Adjudicates Git delivery from an already-authorized external-effect receipt. */
export class CanonicalGitDeliveryService implements GitDeliveryServicePort {
  bind(input: { readonly runId: string }): GitDeliveryPort {
    return new CanonicalGitDeliverySession(
      normalizedCodingId(input.runId, 'git-delivery-run-id'),
    );
  }
}

class CanonicalGitDeliverySession implements GitDeliveryPort {
  private readonly settled = new Map<
    string,
    { readonly input: string; readonly decision: CodingGitDeliveryDecision }
  >();

  constructor(readonly runId: string) {}

  assess(input: AssessCodingGitDeliveryInput): CodingGitDeliveryDecision {
    const snapshot = snapshotGitDeliveryInput(input, this.runId);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) deliveryFailure('conflicting-git-action-identity');
      return existing.decision;
    }
    const decision = assessGitDelivery(this.runId, snapshot);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingGitDeliveryDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

function assessGitDelivery(
  runId: string,
  input: AssessCodingGitDeliveryInput,
): CodingGitDeliveryDecision {
  const observation = input.observation;
  const effect = observation
    ? input.externalEffects.find(receipt => receipt.actionId === observation.effectActionId)
    : undefined;
  const exactReview = observation?.reviewFingerprint === input.review.reviewFingerprint;
  const validEffect = Boolean(effect?.effects.includes('git'));
  const validCommit = Boolean(observation?.commitSha && /^[a-f0-9]{7,64}$/iu.test(observation.commitSha));
  const validRemote = input.operation !== 'pull-request' || Boolean(observation?.remoteRef);

  let status: CodingGitDeliveryDecision['status'];
  if (input.operation === 'none') status = 'not-applicable';
  else if (!observation || input.review.status !== 'passed' || !effect) status = 'blocked';
  else if (!exactReview || !validEffect || effect.status === 'indeterminate'
    || observation.status === 'indeterminate') {
    status = 'indeterminate';
  } else if (effect.status === 'denied') status = 'blocked';
  else if (effect.status === 'failed-no-effect' || observation.status === 'failed') status = 'failed';
  else if (!validCommit || !validRemote || observation.operation !== input.operation) {
    status = 'indeterminate';
  } else status = 'completed';

  const reasonCodes = status === 'completed'
    ? ['git-delivery-completed']
    : status === 'not-applicable'
      ? ['git-delivery-not-applicable']
      : uniqueCodingRefs([
          ...(observation ? [] : ['git-delivery-observation-missing']),
          ...(input.review.status !== 'passed' ? ['independent-review-not-passed'] : []),
          ...(observation && !effect ? ['git-effect-receipt-missing'] : []),
          ...(effect && !validEffect ? ['git-effect-facet-missing'] : []),
          ...(observation && !exactReview ? ['git-review-fingerprint-mismatch'] : []),
          ...(effect?.status === 'denied' ? ['git-effect-denied'] : []),
          ...(effect?.status === 'failed-no-effect' ? ['git-effect-failed'] : []),
          ...(effect?.status === 'indeterminate' ? ['git-effect-indeterminate'] : []),
          ...(observation?.status === 'failed' ? ['git-observation-failed'] : []),
          ...(observation?.status === 'indeterminate' ? ['git-observation-indeterminate'] : []),
          ...(observation && observation.operation !== input.operation
            ? ['git-operation-mismatch']
            : []),
          ...(observation && !validCommit ? ['git-commit-identity-missing'] : []),
          ...(observation && !validRemote ? ['pull-request-ref-missing'] : []),
        ]);

  return snapshotCodingValue({
    version: CODING_GIT_DELIVERY_DECISION_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    operation: input.operation,
    reviewFingerprint: input.review.reviewFingerprint,
    ...(observation?.effectActionId ? { effectActionId: observation.effectActionId } : {}),
    ...(observation?.commitSha ? { commitSha: observation.commitSha } : {}),
    ...(observation?.remoteRef ? { remoteRef: observation.remoteRef } : {}),
    reasonCodes: Object.freeze(reasonCodes),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...input.review.evidenceRefs,
      ...(effect?.evidenceRefs ?? []),
      ...(observation?.evidenceRefs ?? []),
    ])),
  }, 'git-delivery-decision') as CodingGitDeliveryDecision;
}

export interface BuildCodingDeliveryManifestInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly releaseRequired: boolean;
  readonly sourceCommit?: string;
  readonly codeChange: CodingCodeChangeDecision;
  readonly integration: CodingIntegrationConformanceDecision;
  readonly toolExecutions: readonly CodingToolExecutionReceipt<unknown>[];
  readonly verifications: readonly CodingVerificationReceipt[];
  readonly review: CodingIndependentReviewDecision;
  readonly artifactIdentity: CodingArtifactIdentityDecision;
  readonly gitDelivery: CodingGitDeliveryDecision;
  readonly evidenceRefs: readonly string[];
}

export interface CodingDeliveryManifest {
  readonly version: typeof CODING_DELIVERY_MANIFEST_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'ready' | 'failed' | 'blocked';
  readonly sourceCommit?: string;
  readonly reviewFingerprint: string;
  readonly artifactSetFingerprint: string;
  readonly manifestFingerprint: string;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface DeliveryManifestPort {
  readonly runId: string;
  build(input: BuildCodingDeliveryManifestInput): CodingDeliveryManifest;
  manifests(): readonly CodingDeliveryManifest[];
}

export interface DeliveryManifestServicePort {
  bind(input: { readonly runId: string }): DeliveryManifestPort;
}

/** Creates the immutable handoff boundary from code evidence to delivery/release. */
export class CanonicalDeliveryManifestService implements DeliveryManifestServicePort {
  bind(input: { readonly runId: string }): DeliveryManifestPort {
    return new CanonicalDeliveryManifestSession(
      normalizedCodingId(input.runId, 'delivery-manifest-run-id'),
    );
  }
}

class CanonicalDeliveryManifestSession implements DeliveryManifestPort {
  private readonly settled = new Map<
    string,
    { readonly input: string; readonly manifest: CodingDeliveryManifest }
  >();

  constructor(readonly runId: string) {}

  build(input: BuildCodingDeliveryManifestInput): CodingDeliveryManifest {
    const snapshot = snapshotManifestInput(input, this.runId);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) deliveryFailure('conflicting-manifest-identity');
      return existing.manifest;
    }
    const manifest = buildManifest(this.runId, snapshot);
    this.settled.set(snapshot.actionId, { input: canonicalInput, manifest });
    return manifest;
  }

  manifests(): readonly CodingDeliveryManifest[] {
    return Object.freeze([...this.settled.values()].map(value => value.manifest));
  }
}

function buildManifest(
  runId: string,
  input: BuildCodingDeliveryManifestInput,
): CodingDeliveryManifest {
  const settledVerifications = settledCodingVerificationReceipts(
    input.verifications,
    input.toolExecutions,
  );
  const failed = input.codeChange.status === 'failed'
    || input.integration.status === 'failed'
    || settledVerifications.some(receipt => receipt.status === 'failed')
    || input.review.status === 'failed'
    || input.artifactIdentity.status === 'failed'
    || input.gitDelivery.status === 'failed';
  const blocked = input.codeChange.status === 'incomplete'
    || input.codeChange.status === 'indeterminate'
    || input.integration.status === 'incomplete'
    || input.integration.status === 'indeterminate'
    || settledVerifications.some(receipt => receipt.status !== 'passed')
    || input.review.status === 'indeterminate'
    || (input.releaseRequired && input.review.status !== 'passed')
    || (input.releaseRequired && input.artifactIdentity.status !== 'bound')
    || (input.releaseRequired && input.gitDelivery.status !== 'completed')
    || (input.releaseRequired && !input.sourceCommit);
  const status: CodingDeliveryManifest['status'] = failed ? 'failed' : blocked ? 'blocked' : 'ready';
  const reasonCodes = status === 'ready'
    ? ['delivery-manifest-ready']
    : uniqueCodingRefs([
        ...(input.codeChange.status !== 'conformant' && input.codeChange.status !== 'not-applicable'
          ? [`code-change:${input.codeChange.status}`]
          : []),
        ...(input.integration.status !== 'conformant' && input.integration.status !== 'not-applicable'
          ? [`integration:${input.integration.status}`]
          : []),
        ...settledVerifications
          .filter(receipt => receipt.status !== 'passed')
          .map(receipt => `verification:${receipt.status}`),
        ...(input.review.status === 'failed' || input.review.status === 'indeterminate'
          ? [`review:${input.review.status}`]
          : []),
        ...(input.artifactIdentity.status === 'failed'
          ? ['artifact-identity:failed']
          : []),
        ...(input.gitDelivery.status === 'failed' ? ['git-delivery:failed'] : []),
        ...(input.releaseRequired && input.review.status !== 'passed'
          ? ['release-review-not-passed']
          : []),
        ...(input.releaseRequired && input.artifactIdentity.status !== 'bound'
          ? ['release-artifact-not-bound']
          : []),
        ...(input.releaseRequired && input.gitDelivery.status !== 'completed'
          ? ['release-git-delivery-incomplete']
          : []),
        ...(input.releaseRequired && !input.sourceCommit ? ['release-source-commit-missing'] : []),
      ]);
  const manifestFingerprint = codingSemanticDigest({
    runId,
    sourceCommit: input.sourceCommit,
    codeChange: input.codeChange,
    integration: input.integration,
    verifications: settledVerifications,
    review: input.review,
    artifactIdentity: input.artifactIdentity,
    gitDelivery: input.gitDelivery,
  });
  return snapshotCodingValue({
    version: CODING_DELIVERY_MANIFEST_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    ...(input.sourceCommit ? { sourceCommit: input.sourceCommit } : {}),
    reviewFingerprint: input.review.reviewFingerprint,
    artifactSetFingerprint: input.artifactIdentity.artifactSetFingerprint,
    manifestFingerprint,
    reasonCodes: Object.freeze(reasonCodes),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...input.codeChange.evidenceRefs,
      ...input.integration.evidenceRefs,
      ...input.toolExecutions.flatMap(receipt => receipt.evidenceRefs),
      ...input.verifications.flatMap(receipt => receipt.evidenceRefs),
      ...input.review.evidenceRefs,
      ...input.artifactIdentity.evidenceRefs,
      ...input.gitDelivery.evidenceRefs,
      `delivery-manifest:fingerprint:${manifestFingerprint}`,
    ])),
  }, 'delivery-manifest') as CodingDeliveryManifest;
}

function snapshotGitDeliveryInput(
  input: AssessCodingGitDeliveryInput,
  runId: string,
): AssessCodingGitDeliveryInput {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) deliveryFailure('invalid-sequence');
  if (!['none', 'commit', 'push', 'pull-request'].includes(input.operation)) {
    deliveryFailure('invalid-git-operation');
  }
  if (input.review.runId !== runId
    || input.externalEffects.some(receipt => receipt.runId !== runId)) {
    deliveryFailure('git-delivery-run-mismatch');
  }
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'git-delivery-action-id'),
    operation: input.operation,
    review: snapshotCodingValue(
      input.review,
      'git-delivery-review',
    ) as CodingIndependentReviewDecision,
    externalEffects: Object.freeze(input.externalEffects.map(receipt => (
      snapshotCodingValue(receipt, 'git-delivery-effect') as CodingExternalEffectReceipt<unknown>
    ))),
    ...(input.observation ? { observation: snapshotGitObservation(input.observation) } : {}),
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function snapshotGitObservation(
  observation: CodingGitDeliveryObservation,
): CodingGitDeliveryObservation {
  if (!observation || typeof observation !== 'object') deliveryFailure('invalid-git-observation');
  if (!['commit', 'push', 'pull-request'].includes(observation.operation)) {
    deliveryFailure('invalid-git-observation-operation');
  }
  if (!['completed', 'failed', 'indeterminate'].includes(observation.status)) {
    deliveryFailure('invalid-git-observation-status');
  }
  return Object.freeze({
    operation: observation.operation,
    status: observation.status,
    effectActionId: normalizedCodingId(observation.effectActionId, 'git-effect-action-id'),
    reviewFingerprint: normalizedCodingId(
      observation.reviewFingerprint,
      'git-review-fingerprint',
    ),
    ...(observation.commitSha ? { commitSha: observation.commitSha.trim() } : {}),
    ...(observation.remoteRef ? { remoteRef: observation.remoteRef.trim() } : {}),
    evidenceRefs: Object.freeze(uniqueCodingRefs(observation.evidenceRefs)),
  });
}

function snapshotManifestInput(
  input: BuildCodingDeliveryManifestInput,
  runId: string,
): BuildCodingDeliveryManifestInput {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) deliveryFailure('invalid-sequence');
  const runBound = [
    input.codeChange,
    input.integration,
    ...input.toolExecutions,
    ...input.verifications,
    input.review,
    input.artifactIdentity,
    input.gitDelivery,
  ];
  if (runBound.some(value => value.runId !== runId)) deliveryFailure('manifest-run-mismatch');
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'delivery-manifest-action-id'),
    releaseRequired: input.releaseRequired === true,
    ...(input.sourceCommit
      ? { sourceCommit: normalizedCodingId(input.sourceCommit, 'delivery-source-commit') }
      : {}),
    codeChange: snapshotCodingValue(
      input.codeChange,
      'delivery-code-change',
    ) as CodingCodeChangeDecision,
    integration: snapshotCodingValue(
      input.integration,
      'delivery-integration',
    ) as CodingIntegrationConformanceDecision,
    toolExecutions: Object.freeze(input.toolExecutions.map(receipt => (
      snapshotCodingValue(receipt, 'delivery-tool-execution') as CodingToolExecutionReceipt<unknown>
    ))),
    verifications: Object.freeze(input.verifications.map(receipt => (
      snapshotCodingValue(receipt, 'delivery-verification') as CodingVerificationReceipt
    ))),
    review: snapshotCodingValue(
      input.review,
      'delivery-review',
    ) as CodingIndependentReviewDecision,
    artifactIdentity: snapshotCodingValue(
      input.artifactIdentity,
      'delivery-artifact-identity',
    ) as CodingArtifactIdentityDecision,
    gitDelivery: snapshotCodingValue(
      input.gitDelivery,
      'delivery-git',
    ) as CodingGitDeliveryDecision,
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function deliveryFailure(reason: string): never {
  throw new Error(`coding-delivery:${reason}`);
}
