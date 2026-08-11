import type { CodingArtifactIdentityDecision } from './coding-artifact-identity';
import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type {
  CodingDeliveryManifest,
  CodingGitDeliveryDecision,
} from './coding-delivery';
import type { CodingExternalEffectReceipt } from './coding-external-effect';

export const CODING_RELEASE_GATE_DECISION_VERSION = 'devseek.coding-release-gate-decision/v1' as const;
export const CODING_DEPLOYMENT_DECISION_VERSION = 'devseek.coding-deployment-decision/v1' as const;
export const CODING_ROLLBACK_DECISION_VERSION = 'devseek.coding-rollback-decision/v1' as const;

export interface AssessCodingReleaseGateInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly requested: boolean;
  readonly authorized: boolean;
  readonly authorizationRef?: string;
  readonly manifest: CodingDeliveryManifest;
  readonly artifactIdentity: CodingArtifactIdentityDecision;
  readonly gitDelivery: CodingGitDeliveryDecision;
  readonly evidenceRefs: readonly string[];
}

export interface CodingReleaseGateDecision {
  readonly version: typeof CODING_RELEASE_GATE_DECISION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'approved' | 'rejected' | 'blocked' | 'not-applicable';
  readonly requested: boolean;
  readonly authorizationRef?: string;
  readonly manifestFingerprint: string;
  readonly artifactSetFingerprint: string;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface ReleaseGatePort {
  readonly runId: string;
  assess(input: AssessCodingReleaseGateInput): CodingReleaseGateDecision;
  decisions(): readonly CodingReleaseGateDecision[];
}

export interface ReleaseGateServicePort {
  bind(input: { readonly runId: string }): ReleaseGatePort;
}

/** Decides release readiness. It never performs the release effect itself. */
export class CanonicalReleaseGateService implements ReleaseGateServicePort {
  bind(input: { readonly runId: string }): ReleaseGatePort {
    return new CanonicalReleaseGateSession(normalizedCodingId(input.runId, 'release-gate-run-id'));
  }
}

class CanonicalReleaseGateSession implements ReleaseGatePort {
  private readonly settled = new Map<
    string,
    { readonly input: string; readonly decision: CodingReleaseGateDecision }
  >();

  constructor(readonly runId: string) {}

  assess(input: AssessCodingReleaseGateInput): CodingReleaseGateDecision {
    const snapshot = snapshotReleaseGateInput(input, this.runId);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) releaseFailure('conflicting-gate-identity');
      return existing.decision;
    }
    const decision = assessReleaseGate(this.runId, snapshot);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingReleaseGateDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

function assessReleaseGate(
  runId: string,
  input: AssessCodingReleaseGateInput,
): CodingReleaseGateDecision {
  const rejected = input.manifest.status === 'failed'
    || input.artifactIdentity.status === 'failed'
    || input.gitDelivery.status === 'failed';
  const blocked = !input.authorized
    || !input.authorizationRef
    || input.manifest.status !== 'ready'
    || input.artifactIdentity.status !== 'bound'
    || input.gitDelivery.status !== 'completed';
  const status: CodingReleaseGateDecision['status'] = !input.requested
    ? 'not-applicable'
    : rejected
      ? 'rejected'
      : blocked
        ? 'blocked'
        : 'approved';
  const reasonCodes = status === 'approved'
    ? ['release-gate-approved']
    : status === 'not-applicable'
      ? ['release-gate-not-applicable']
      : uniqueCodingRefs([
          ...(input.authorized && input.authorizationRef ? [] : ['release-authorization-missing']),
          ...(input.manifest.status !== 'ready' ? [`delivery-manifest:${input.manifest.status}`] : []),
          ...(input.artifactIdentity.status !== 'bound'
            ? [`artifact-identity:${input.artifactIdentity.status}`]
            : []),
          ...(input.gitDelivery.status !== 'completed'
            ? [`git-delivery:${input.gitDelivery.status}`]
            : []),
        ]);
  return snapshotCodingValue({
    version: CODING_RELEASE_GATE_DECISION_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    requested: input.requested,
    ...(input.authorizationRef ? { authorizationRef: input.authorizationRef } : {}),
    manifestFingerprint: input.manifest.manifestFingerprint,
    artifactSetFingerprint: input.artifactIdentity.artifactSetFingerprint,
    reasonCodes: Object.freeze(reasonCodes),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...input.manifest.evidenceRefs,
      ...input.artifactIdentity.evidenceRefs,
      ...input.gitDelivery.evidenceRefs,
      ...(input.authorizationRef ? [input.authorizationRef] : []),
    ])),
  }, 'release-gate-decision') as CodingReleaseGateDecision;
}

export type CodingDeploymentStage = 'ci' | 'deploy' | 'smoke' | 'observe';

export interface CodingDeploymentStageObservation {
  readonly stage: CodingDeploymentStage;
  readonly status: 'passed' | 'failed' | 'indeterminate';
  readonly effectActionId: string;
  readonly artifactSetFingerprint: string;
  readonly evidenceRefs: readonly string[];
}

export interface AssessCodingDeploymentInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly gate: CodingReleaseGateDecision;
  readonly observations: readonly CodingDeploymentStageObservation[];
  readonly externalEffects: readonly CodingExternalEffectReceipt<unknown>[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingDeploymentDecision {
  readonly version: typeof CODING_DEPLOYMENT_DECISION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'passed' | 'failed' | 'blocked' | 'in-progress' | 'indeterminate' | 'not-run' | 'not-applicable';
  readonly artifactSetFingerprint: string;
  readonly completedStages: readonly CodingDeploymentStage[];
  readonly deployed: boolean;
  readonly failedStage?: CodingDeploymentStage;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CiDeployObservePort {
  readonly runId: string;
  assess(input: AssessCodingDeploymentInput): CodingDeploymentDecision;
  decisions(): readonly CodingDeploymentDecision[];
}

export interface CiDeployObserveServicePort {
  bind(input: { readonly runId: string }): CiDeployObservePort;
}

/** Validates the ordered CI -> deploy -> smoke -> observe receipt chain. */
export class CanonicalCiDeployObserveService implements CiDeployObserveServicePort {
  bind(input: { readonly runId: string }): CiDeployObservePort {
    return new CanonicalCiDeployObserveSession(
      normalizedCodingId(input.runId, 'ci-deploy-observe-run-id'),
    );
  }
}

class CanonicalCiDeployObserveSession implements CiDeployObservePort {
  private readonly settled = new Map<
    string,
    { readonly input: string; readonly decision: CodingDeploymentDecision }
  >();

  constructor(readonly runId: string) {}

  assess(input: AssessCodingDeploymentInput): CodingDeploymentDecision {
    const snapshot = snapshotDeploymentInput(input, this.runId);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) releaseFailure('conflicting-deployment-identity');
      return existing.decision;
    }
    const decision = assessDeployment(this.runId, snapshot);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingDeploymentDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

const DEPLOYMENT_STAGES: readonly CodingDeploymentStage[] = ['ci', 'deploy', 'smoke', 'observe'];

function assessDeployment(
  runId: string,
  input: AssessCodingDeploymentInput,
): CodingDeploymentDecision {
  const orderConformant = input.observations.every((observation, index) => (
    observation.stage === DEPLOYMENT_STAGES[index]
  ));
  const assessed = input.observations.map(observation => {
    const effect = input.externalEffects.find(receipt => receipt.actionId === observation.effectActionId);
    const exactArtifact = observation.artifactSetFingerprint === input.gate.artifactSetFingerprint;
    const requiredFacet = observation.stage === 'deploy' ? 'release' : undefined;
    const validFacet = requiredFacet
      ? effect?.effects.includes(requiredFacet) === true
      : effect?.effects.some(facet => facet === 'process' || facet === 'network') === true;
    return { observation, effect, exactArtifact, validFacet };
  });
  const indeterminate = !orderConformant || assessed.some(item => (
    !item.effect
      || !item.exactArtifact
      || !item.validFacet
      || item.effect.status === 'indeterminate'
      || item.observation.status === 'indeterminate'
  ));
  const failed = assessed.find(item => (
    item.effect?.status === 'failed-no-effect'
      || item.effect?.status === 'denied'
      || item.observation.status === 'failed'
  ));
  const completedStages = assessed
    .filter(item => item.effect?.status === 'committed' && item.observation.status === 'passed')
    .map(item => item.observation.stage);
  const deployed = assessed.some(item => (
    item.observation.stage === 'deploy' && item.effect?.status === 'committed'
  ));
  let status: CodingDeploymentDecision['status'];
  if (input.gate.status === 'not-applicable') status = 'not-applicable';
  else if (input.gate.status !== 'approved') status = 'blocked';
  else if (input.observations.length === 0) status = 'not-run';
  else if (indeterminate) status = 'indeterminate';
  else if (failed) status = 'failed';
  else if (completedStages.length === DEPLOYMENT_STAGES.length) status = 'passed';
  else status = 'in-progress';

  const reasonCodes = status === 'passed'
    ? ['ci-deploy-smoke-observe-passed']
    : status === 'not-applicable'
      ? ['deployment-not-applicable']
      : uniqueCodingRefs([
          ...(input.gate.status !== 'approved' && input.gate.status !== 'not-applicable'
            ? [`release-gate:${input.gate.status}`]
            : []),
          ...(input.observations.length === 0 && input.gate.status === 'approved'
            ? ['deployment-not-run']
            : []),
          ...(!orderConformant ? ['deployment-stage-order-invalid'] : []),
          ...assessed.flatMap(item => [
            ...(!item.effect ? [`deployment-effect-missing:${item.observation.stage}`] : []),
            ...(!item.exactArtifact ? [`deployment-artifact-drift:${item.observation.stage}`] : []),
            ...(!item.validFacet ? [`deployment-effect-facet-invalid:${item.observation.stage}`] : []),
            ...(item.effect?.status === 'denied'
              ? [`deployment-effect-denied:${item.observation.stage}`]
              : []),
            ...(item.effect?.status === 'failed-no-effect'
              ? [`deployment-effect-failed:${item.observation.stage}`]
              : []),
            ...(item.effect?.status === 'indeterminate'
              ? [`deployment-effect-indeterminate:${item.observation.stage}`]
              : []),
            ...(item.observation.status === 'failed'
              ? [`deployment-observation-failed:${item.observation.stage}`]
              : []),
            ...(item.observation.status === 'indeterminate'
              ? [`deployment-observation-indeterminate:${item.observation.stage}`]
              : []),
          ]),
          ...(status === 'in-progress' ? ['deployment-stages-incomplete'] : []),
        ]);
  return snapshotCodingValue({
    version: CODING_DEPLOYMENT_DECISION_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    artifactSetFingerprint: input.gate.artifactSetFingerprint,
    completedStages: Object.freeze(completedStages),
    deployed,
    ...(failed ? { failedStage: failed.observation.stage } : {}),
    reasonCodes: Object.freeze(reasonCodes),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...input.gate.evidenceRefs,
      ...input.observations.flatMap(observation => observation.evidenceRefs),
      ...assessed.flatMap(item => item.effect?.evidenceRefs ?? []),
    ])),
  }, 'deployment-decision') as CodingDeploymentDecision;
}

export interface CodingRollbackObservation {
  readonly status: 'completed' | 'failed' | 'indeterminate';
  readonly effectActionId: string;
  readonly targetArtifactFingerprint: string;
  readonly evidenceRefs: readonly string[];
}

export interface AssessCodingRollbackInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly requested: boolean;
  readonly authorized: boolean;
  readonly authorizationRef?: string;
  readonly targetArtifactFingerprint?: string;
  readonly deployment: CodingDeploymentDecision;
  readonly observation?: CodingRollbackObservation;
  readonly externalEffects: readonly CodingExternalEffectReceipt<unknown>[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingRollbackDecision {
  readonly version: typeof CODING_ROLLBACK_DECISION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'completed' | 'failed' | 'blocked' | 'ready' | 'indeterminate' | 'not-required';
  readonly required: boolean;
  readonly targetArtifactFingerprint?: string;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface RollbackPort {
  readonly runId: string;
  assess(input: AssessCodingRollbackInput): CodingRollbackDecision;
  decisions(): readonly CodingRollbackDecision[];
}

export interface RollbackServicePort {
  bind(input: { readonly runId: string }): RollbackPort;
}

/** Owns rollback necessity and exact-target receipt validation. */
export class CanonicalRollbackService implements RollbackServicePort {
  bind(input: { readonly runId: string }): RollbackPort {
    return new CanonicalRollbackSession(normalizedCodingId(input.runId, 'rollback-run-id'));
  }
}

class CanonicalRollbackSession implements RollbackPort {
  private readonly settled = new Map<
    string,
    { readonly input: string; readonly decision: CodingRollbackDecision }
  >();

  constructor(readonly runId: string) {}

  assess(input: AssessCodingRollbackInput): CodingRollbackDecision {
    const snapshot = snapshotRollbackInput(input, this.runId);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) releaseFailure('conflicting-rollback-identity');
      return existing.decision;
    }
    const decision = assessRollback(this.runId, snapshot);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingRollbackDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

function assessRollback(
  runId: string,
  input: AssessCodingRollbackInput,
): CodingRollbackDecision {
  const required = input.requested || (input.deployment.deployed
    && input.deployment.status !== 'passed');
  const effect = input.observation
    ? input.externalEffects.find(receipt => receipt.actionId === input.observation?.effectActionId)
    : undefined;
  const exactTarget = input.observation?.targetArtifactFingerprint === input.targetArtifactFingerprint;
  const validEffect = effect?.effects.includes('release') === true;
  let status: CodingRollbackDecision['status'];
  if (!required) status = 'not-required';
  else if (!input.targetArtifactFingerprint || !input.authorized || !input.authorizationRef) {
    status = 'blocked';
  } else if (!input.observation) status = 'ready';
  else if (!effect || !exactTarget || !validEffect
    || effect.status === 'indeterminate'
    || input.observation.status === 'indeterminate') {
    status = 'indeterminate';
  } else if (effect.status === 'denied') status = 'blocked';
  else if (effect.status === 'failed-no-effect' || input.observation.status === 'failed') {
    status = 'failed';
  } else status = 'completed';
  const reasonCodes = status === 'completed'
    ? ['rollback-completed']
    : status === 'not-required'
      ? ['rollback-not-required']
      : status === 'ready'
        ? ['rollback-ready']
        : uniqueCodingRefs([
            ...(!input.targetArtifactFingerprint ? ['rollback-target-missing'] : []),
            ...(!input.authorized || !input.authorizationRef ? ['rollback-authorization-missing'] : []),
            ...(input.observation && !effect ? ['rollback-effect-missing'] : []),
            ...(effect && !validEffect ? ['rollback-effect-facet-invalid'] : []),
            ...(input.observation && !exactTarget ? ['rollback-target-mismatch'] : []),
            ...(effect?.status === 'denied' ? ['rollback-effect-denied'] : []),
            ...(effect?.status === 'failed-no-effect' ? ['rollback-effect-failed'] : []),
            ...(effect?.status === 'indeterminate' ? ['rollback-effect-indeterminate'] : []),
            ...(input.observation?.status === 'failed' ? ['rollback-observation-failed'] : []),
            ...(input.observation?.status === 'indeterminate'
              ? ['rollback-observation-indeterminate']
              : []),
          ]);
  return snapshotCodingValue({
    version: CODING_ROLLBACK_DECISION_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    required,
    ...(input.targetArtifactFingerprint
      ? { targetArtifactFingerprint: input.targetArtifactFingerprint }
      : {}),
    reasonCodes: Object.freeze(reasonCodes),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...input.deployment.evidenceRefs,
      ...(input.authorizationRef ? [input.authorizationRef] : []),
      ...(input.observation?.evidenceRefs ?? []),
      ...(effect?.evidenceRefs ?? []),
    ])),
  }, 'rollback-decision') as CodingRollbackDecision;
}

function snapshotReleaseGateInput(
  input: AssessCodingReleaseGateInput,
  runId: string,
): AssessCodingReleaseGateInput {
  assertSequence(input.sequence);
  if ([input.manifest, input.artifactIdentity, input.gitDelivery]
    .some(value => value.runId !== runId)) releaseFailure('release-gate-run-mismatch');
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'release-gate-action-id'),
    requested: input.requested === true,
    authorized: input.authorized === true,
    ...(input.authorizationRef
      ? { authorizationRef: normalizedCodingId(input.authorizationRef, 'release-authorization-ref') }
      : {}),
    manifest: snapshotCodingValue(input.manifest, 'release-manifest') as CodingDeliveryManifest,
    artifactIdentity: snapshotCodingValue(
      input.artifactIdentity,
      'release-artifact-identity',
    ) as CodingArtifactIdentityDecision,
    gitDelivery: snapshotCodingValue(
      input.gitDelivery,
      'release-git-delivery',
    ) as CodingGitDeliveryDecision,
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function snapshotDeploymentInput(
  input: AssessCodingDeploymentInput,
  runId: string,
): AssessCodingDeploymentInput {
  assertSequence(input.sequence);
  if (input.gate.runId !== runId || input.externalEffects.some(receipt => receipt.runId !== runId)) {
    releaseFailure('deployment-run-mismatch');
  }
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'deployment-action-id'),
    gate: snapshotCodingValue(input.gate, 'deployment-gate') as CodingReleaseGateDecision,
    observations: Object.freeze(input.observations.map(snapshotDeploymentObservation)),
    externalEffects: Object.freeze(input.externalEffects.map(receipt => (
      snapshotCodingValue(receipt, 'deployment-effect') as CodingExternalEffectReceipt<unknown>
    ))),
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function snapshotDeploymentObservation(
  observation: CodingDeploymentStageObservation,
): CodingDeploymentStageObservation {
  if (!observation || typeof observation !== 'object') releaseFailure('invalid-deployment-observation');
  if (!DEPLOYMENT_STAGES.includes(observation.stage)) releaseFailure('invalid-deployment-stage');
  if (!['passed', 'failed', 'indeterminate'].includes(observation.status)) {
    releaseFailure('invalid-deployment-status');
  }
  return Object.freeze({
    stage: observation.stage,
    status: observation.status,
    effectActionId: normalizedCodingId(observation.effectActionId, 'deployment-effect-action-id'),
    artifactSetFingerprint: normalizedCodingId(
      observation.artifactSetFingerprint,
      'deployment-artifact-fingerprint',
    ),
    evidenceRefs: Object.freeze(uniqueCodingRefs(observation.evidenceRefs)),
  });
}

function snapshotRollbackInput(
  input: AssessCodingRollbackInput,
  runId: string,
): AssessCodingRollbackInput {
  assertSequence(input.sequence);
  if (input.deployment.runId !== runId
    || input.externalEffects.some(receipt => receipt.runId !== runId)) {
    releaseFailure('rollback-run-mismatch');
  }
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'rollback-action-id'),
    requested: input.requested === true,
    authorized: input.authorized === true,
    ...(input.authorizationRef
      ? { authorizationRef: normalizedCodingId(input.authorizationRef, 'rollback-authorization-ref') }
      : {}),
    ...(input.targetArtifactFingerprint
      ? { targetArtifactFingerprint: normalizedCodingId(
          input.targetArtifactFingerprint,
          'rollback-target-fingerprint',
        ) }
      : {}),
    deployment: snapshotCodingValue(
      input.deployment,
      'rollback-deployment',
    ) as CodingDeploymentDecision,
    ...(input.observation ? { observation: snapshotRollbackObservation(input.observation) } : {}),
    externalEffects: Object.freeze(input.externalEffects.map(receipt => (
      snapshotCodingValue(receipt, 'rollback-effect') as CodingExternalEffectReceipt<unknown>
    ))),
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function snapshotRollbackObservation(observation: CodingRollbackObservation): CodingRollbackObservation {
  if (!observation || typeof observation !== 'object') releaseFailure('invalid-rollback-observation');
  if (!['completed', 'failed', 'indeterminate'].includes(observation.status)) {
    releaseFailure('invalid-rollback-status');
  }
  return Object.freeze({
    status: observation.status,
    effectActionId: normalizedCodingId(observation.effectActionId, 'rollback-effect-action-id'),
    targetArtifactFingerprint: normalizedCodingId(
      observation.targetArtifactFingerprint,
      'rollback-observation-target',
    ),
    evidenceRefs: Object.freeze(uniqueCodingRefs(observation.evidenceRefs)),
  });
}

function assertSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0) releaseFailure('invalid-sequence');
}

function releaseFailure(reason: string): never {
  throw new Error(`coding-release:${reason}`);
}
