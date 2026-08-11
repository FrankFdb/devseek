import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import { codingSemanticDigest } from './coding-semantic-digest';
import { normalizeCodingWorkspacePath } from './coding-workspace-scope';

export const CODING_ARTIFACT_IDENTITY_DECISION_VERSION =
  'devseek.coding-artifact-identity-decision/v1' as const;

export interface CodingArtifactObservation {
  readonly artifactId: string;
  readonly path: string;
  readonly sha256: string;
  readonly sourceCommit: string;
  readonly buildId: string;
  readonly evidenceRefs: readonly string[];
}

export interface AssessCodingArtifactIdentityInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly required: boolean;
  readonly expectedSourceCommit?: string;
  readonly artifacts: readonly CodingArtifactObservation[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingArtifactIdentityDecision {
  readonly version: typeof CODING_ARTIFACT_IDENTITY_DECISION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'bound' | 'failed' | 'indeterminate' | 'not-applicable';
  readonly expectedSourceCommit?: string;
  readonly artifacts: readonly CodingArtifactObservation[];
  readonly artifactSetFingerprint: string;
  readonly invalidArtifactIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface ArtifactIdentityPort {
  readonly runId: string;
  assess(input: AssessCodingArtifactIdentityInput): CodingArtifactIdentityDecision;
  decisions(): readonly CodingArtifactIdentityDecision[];
}

export interface ArtifactIdentityServicePort {
  bind(input: { readonly runId: string }): ArtifactIdentityPort;
}

/** Binds immutable artifact bytes to one source/build identity without performing host I/O. */
export class CanonicalArtifactIdentityService implements ArtifactIdentityServicePort {
  bind(input: { readonly runId: string }): ArtifactIdentityPort {
    return new CanonicalArtifactIdentitySession(
      normalizedCodingId(input.runId, 'artifact-identity-run-id'),
    );
  }
}

class CanonicalArtifactIdentitySession implements ArtifactIdentityPort {
  private readonly settled = new Map<
    string,
    { readonly input: string; readonly decision: CodingArtifactIdentityDecision }
  >();

  constructor(readonly runId: string) {}

  assess(input: AssessCodingArtifactIdentityInput): CodingArtifactIdentityDecision {
    const snapshot = snapshotArtifactInput(input);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) artifactFailure('conflicting-action-identity');
      return existing.decision;
    }
    const decision = assessArtifactIdentity(this.runId, snapshot);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingArtifactIdentityDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

function assessArtifactIdentity(
  runId: string,
  input: AssessCodingArtifactIdentityInput,
): CodingArtifactIdentityDecision {
  const invalidArtifactIds = input.artifacts
    .filter(artifact => !isSha256(artifact.sha256)
      || artifact.evidenceRefs.length === 0
      || (input.expectedSourceCommit !== undefined
        && artifact.sourceCommit !== input.expectedSourceCommit))
    .map(artifact => artifact.artifactId);
  const artifactSetFingerprint = codingSemanticDigest(input.artifacts.map(artifact => ({
    artifactId: artifact.artifactId,
    path: artifact.path,
    sha256: artifact.sha256,
    sourceCommit: artifact.sourceCommit,
    buildId: artifact.buildId,
  })));
  let status: CodingArtifactIdentityDecision['status'];
  if (input.artifacts.length === 0) status = input.required ? 'indeterminate' : 'not-applicable';
  else if (invalidArtifactIds.length > 0) status = 'failed';
  else status = 'bound';
  const reasonCodes = status === 'bound'
    ? ['artifact-identity-bound']
    : status === 'not-applicable'
      ? ['artifact-identity-not-applicable']
      : uniqueCodingRefs([
          ...(input.artifacts.length === 0 ? ['required-artifact-missing'] : []),
          ...(invalidArtifactIds.length > 0 ? ['artifact-identity-invalid'] : []),
        ]);
  return snapshotCodingValue({
    version: CODING_ARTIFACT_IDENTITY_DECISION_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    ...(input.expectedSourceCommit ? { expectedSourceCommit: input.expectedSourceCommit } : {}),
    artifacts: Object.freeze(input.artifacts),
    artifactSetFingerprint,
    invalidArtifactIds: Object.freeze(uniqueCodingRefs(invalidArtifactIds)),
    reasonCodes: Object.freeze(reasonCodes),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...input.artifacts.flatMap(artifact => artifact.evidenceRefs),
      `artifact-set:fingerprint:${artifactSetFingerprint}`,
    ])),
  }, 'artifact-identity-decision') as CodingArtifactIdentityDecision;
}

function snapshotArtifactInput(
  input: AssessCodingArtifactIdentityInput,
): AssessCodingArtifactIdentityInput {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) artifactFailure('invalid-sequence');
  const artifacts = input.artifacts.map(snapshotArtifact);
  if (new Set(artifacts.map(artifact => artifact.artifactId)).size !== artifacts.length) {
    artifactFailure('duplicate-artifact-id');
  }
  if (new Set(artifacts.map(artifact => artifact.path)).size !== artifacts.length) {
    artifactFailure('duplicate-artifact-path');
  }
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'artifact-identity-action-id'),
    required: input.required === true,
    ...(input.expectedSourceCommit
      ? { expectedSourceCommit: normalizedCodingId(input.expectedSourceCommit, 'source-commit') }
      : {}),
    artifacts: Object.freeze(artifacts),
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function snapshotArtifact(artifact: CodingArtifactObservation): CodingArtifactObservation {
  if (!artifact || typeof artifact !== 'object') artifactFailure('invalid-artifact');
  const path = normalizeCodingWorkspacePath(artifact.path);
  if (!path) artifactFailure('invalid-artifact-path');
  return Object.freeze({
    artifactId: normalizedCodingId(artifact.artifactId, 'artifact-id'),
    path,
    sha256: normalizedCodingId(artifact.sha256, 'artifact-sha256').toLowerCase(),
    sourceCommit: normalizedCodingId(artifact.sourceCommit, 'artifact-source-commit'),
    buildId: normalizedCodingId(artifact.buildId, 'artifact-build-id'),
    evidenceRefs: Object.freeze(uniqueCodingRefs(artifact.evidenceRefs)),
  });
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function artifactFailure(reason: string): never {
  throw new Error(`coding-artifact-identity:${reason}`);
}
