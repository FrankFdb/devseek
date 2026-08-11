import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODING_ARTIFACT_IDENTITY_DECISION_VERSION,
  CODING_CODE_CHANGE_DECISION_VERSION,
  CODING_EXTERNAL_EFFECT_RECEIPT_VERSION,
  CODING_INTEGRATION_CONFORMANCE_VERSION,
  CODING_VERIFICATION_RECEIPT_VERSION,
  CanonicalArtifactIdentityService,
  CanonicalCiDeployObserveService,
  CanonicalDeliveryManifestService,
  CanonicalGitDeliveryService,
  CanonicalIndependentReviewService,
  CanonicalReleaseGateService,
  CanonicalRollbackService,
} from '../dist/index.js';

const RUN_ID = 'run-delivery';
const SOURCE_COMMIT = 'abc1234';

function codeChange(overrides = {}) {
  return {
    version: CODING_CODE_CHANGE_DECISION_VERSION,
    runId: RUN_ID,
    sequence: 1,
    actionId: 'code-change',
    status: 'conformant',
    plannedTargets: ['src/value.ts'],
    changedPaths: ['src/value.ts'],
    uncoveredTargets: [],
    unplannedPaths: [],
    failedActionIds: [],
    reasonCodes: ['planned-change-committed-and-read-back'],
    evidenceRefs: ['mutation:readback'],
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    version: CODING_VERIFICATION_RECEIPT_VERSION,
    runId: RUN_ID,
    sequence: 2,
    actionId: 'verify-change',
    idempotencyKey: `${RUN_ID}:verify-change`,
    verifier: 'project-test',
    status: 'passed',
    scopePaths: ['src/value.ts'],
    checks: [],
    acceptance: [],
    evidenceRefs: ['verification:passed'],
    ...overrides,
  };
}

function integration(overrides = {}) {
  return {
    version: CODING_INTEGRATION_CONFORMANCE_VERSION,
    runId: RUN_ID,
    sequence: 3,
    actionId: 'integration',
    status: 'conformant',
    bypassedMutationActionIds: [],
    orphanMutationToolActionIds: [],
    indeterminateActionIds: [],
    unverifiedPaths: [],
    reasonCodes: ['tool-mutation-verification-chain-conformant'],
    evidenceRefs: ['integration:conformant'],
    ...overrides,
  };
}

function reviewObservation(overrides = {}) {
  return {
    status: 'passed',
    reviewerId: 'reviewer:independent',
    implementationActorId: 'implementation:runtime',
    scopePaths: ['src/value.ts'],
    findings: [],
    evidenceRefs: ['review:read-only-diff'],
    ...overrides,
  };
}

function effectReceipt(actionId, effects, status = 'committed') {
  return {
    version: CODING_EXTERNAL_EFFECT_RECEIPT_VERSION,
    runId: RUN_ID,
    sequence: 10,
    actionId,
    idempotencyKey: `${RUN_ID}:${actionId}`,
    tool: `host:${actionId}`,
    purpose: 'external-effect',
    nature: 'mutating',
    effects,
    status,
    settlement: 'resume-replay',
    resumeUnitId: `unit:${actionId}`,
    resumeReceiptSha256: 'a'.repeat(64),
    evidenceRefs: [`effect:${actionId}:${status}`],
  };
}

function artifactObservation(overrides = {}) {
  return {
    artifactId: 'extension-vsix',
    path: 'dist/devseek.vsix',
    sha256: 'b'.repeat(64),
    sourceCommit: SOURCE_COMMIT,
    buildId: 'build-1',
    evidenceRefs: ['artifact:bytes-read'],
    ...overrides,
  };
}

function passedReview() {
  return new CanonicalIndependentReviewService().bind({ runId: RUN_ID }).assess({
    sequence: 4,
    actionId: 'independent-review',
    reviewRequired: true,
    implementationActorId: 'implementation:runtime',
    codeChange: codeChange(),
    toolExecutions: [],
    verifications: [verification()],
    observation: reviewObservation(),
    evidenceRefs: [],
  });
}

function boundArtifact() {
  return new CanonicalArtifactIdentityService().bind({ runId: RUN_ID }).assess({
    sequence: 5,
    actionId: 'artifact-identity',
    required: true,
    expectedSourceCommit: SOURCE_COMMIT,
    artifacts: [artifactObservation()],
    evidenceRefs: [],
  });
}

function completedGit(review) {
  return new CanonicalGitDeliveryService().bind({ runId: RUN_ID }).assess({
    sequence: 6,
    actionId: 'git-delivery',
    operation: 'push',
    review,
    externalEffects: [effectReceipt('git-push', ['git', 'network'])],
    observation: {
      operation: 'push',
      status: 'completed',
      effectActionId: 'git-push',
      reviewFingerprint: review.reviewFingerprint,
      commitSha: SOURCE_COMMIT,
      remoteRef: 'origin/feature',
      evidenceRefs: ['git:remote-readback'],
    },
    evidenceRefs: [],
  });
}

function readyManifest(review, artifact, git) {
  return new CanonicalDeliveryManifestService().bind({ runId: RUN_ID }).build({
    sequence: 7,
    actionId: 'delivery-manifest',
    releaseRequired: true,
    sourceCommit: SOURCE_COMMIT,
    codeChange: codeChange(),
    integration: integration(),
    toolExecutions: [],
    verifications: [verification()],
    review,
    artifactIdentity: artifact,
    gitDelivery: git,
    evidenceRefs: [],
  });
}

test('I20-REV-01 user journey: independent review rejects self-review, incomplete scope, and open introduced findings', () => {
  const service = new CanonicalIndependentReviewService();
  const selfReview = service.bind({ runId: RUN_ID }).assess({
    sequence: 4,
    actionId: 'self-review',
    reviewRequired: true,
    implementationActorId: 'implementation:runtime',
    codeChange: codeChange(),
    toolExecutions: [],
    verifications: [verification()],
    observation: reviewObservation({ reviewerId: 'implementation:runtime' }),
    evidenceRefs: [],
  });
  assert.equal(selfReview.status, 'indeterminate');
  assert.equal(selfReview.reasonCodes.includes('reviewer-not-independent'), true);

  const incomplete = service.bind({ runId: RUN_ID }).assess({
    sequence: 4,
    actionId: 'scope-review',
    reviewRequired: true,
    implementationActorId: 'implementation:runtime',
    codeChange: codeChange({ changedPaths: ['src/value.ts', 'src/auth.ts'] }),
    toolExecutions: [],
    verifications: [verification({ scopePaths: ['src/value.ts', 'src/auth.ts'] })],
    observation: reviewObservation(),
    evidenceRefs: [],
  });
  assert.equal(incomplete.status, 'indeterminate');
  assert.deepEqual(incomplete.uncoveredPaths, ['src/auth.ts']);

  const finding = service.bind({ runId: RUN_ID }).assess({
    sequence: 4,
    actionId: 'finding-review',
    reviewRequired: true,
    implementationActorId: 'implementation:runtime',
    codeChange: codeChange(),
    toolExecutions: [],
    verifications: [verification()],
    observation: reviewObservation({
      status: 'failed',
      findings: [{
        findingId: 'review-finding-1',
        severity: 'important',
        relation: 'introduced',
        disposition: 'open',
        summary: 'The new path can lose user data.',
        path: 'src/value.ts',
        line: 12,
        verified: true,
        evidenceRefs: ['review:reproduction'],
      }],
    }),
    evidenceRefs: [],
  });
  assert.equal(finding.status, 'failed');
  assert.deepEqual(finding.blockingFindingIds, ['review-finding-1']);
});

test('I20-DLV-01 user journey: exact artifact and reviewed Git evidence govern delivery', () => {
  const artifactService = new CanonicalArtifactIdentityService().bind({ runId: RUN_ID });
  const drifted = artifactService.assess({
    sequence: 5,
    actionId: 'artifact-drift',
    required: true,
    expectedSourceCommit: SOURCE_COMMIT,
    artifacts: [artifactObservation({ sourceCommit: 'def5678' })],
    evidenceRefs: [],
  });
  assert.equal(drifted.version, CODING_ARTIFACT_IDENTITY_DECISION_VERSION);
  assert.equal(drifted.status, 'failed');

  const review = passedReview();
  const gitService = new CanonicalGitDeliveryService();
  const missingEffect = gitService.bind({ runId: RUN_ID }).assess({
    sequence: 6,
    actionId: 'git-no-effect',
    operation: 'push',
    review,
    externalEffects: [],
    observation: {
      operation: 'push',
      status: 'completed',
      effectActionId: 'git-push',
      reviewFingerprint: review.reviewFingerprint,
      commitSha: SOURCE_COMMIT,
      remoteRef: 'origin/feature',
      evidenceRefs: ['git:self-report'],
    },
    evidenceRefs: [],
  });
  assert.equal(missingEffect.status, 'blocked');
  assert.equal(missingEffect.reasonCodes.includes('git-effect-receipt-missing'), true);

  const driftedReview = gitService.bind({ runId: RUN_ID }).assess({
    sequence: 6,
    actionId: 'git-review-drift',
    operation: 'push',
    review,
    externalEffects: [effectReceipt('git-push', ['git', 'network'])],
    observation: {
      operation: 'push',
      status: 'completed',
      effectActionId: 'git-push',
      reviewFingerprint: 'different-review',
      commitSha: SOURCE_COMMIT,
      remoteRef: 'origin/feature',
      evidenceRefs: ['git:remote-readback'],
    },
    evidenceRefs: [],
  });
  assert.equal(driftedReview.status, 'indeterminate');
  assert.equal(driftedReview.reasonCodes.includes('git-review-fingerprint-mismatch'), true);
});

test('I20-REL-01 user journey: authorized release preserves artifact identity through observation', () => {
  const review = passedReview();
  const artifact = boundArtifact();
  const git = completedGit(review);
  const manifest = readyManifest(review, artifact, git);
  assert.equal(manifest.status, 'ready');

  const gateService = new CanonicalReleaseGateService();
  const blocked = gateService.bind({ runId: RUN_ID }).assess({
    sequence: 8,
    actionId: 'release-without-authority',
    requested: true,
    authorized: false,
    manifest,
    artifactIdentity: artifact,
    gitDelivery: git,
    evidenceRefs: [],
  });
  assert.equal(blocked.status, 'blocked');

  const gate = gateService.bind({ runId: RUN_ID }).assess({
    sequence: 8,
    actionId: 'release-gate',
    requested: true,
    authorized: true,
    authorizationRef: 'authority:release-approved',
    manifest,
    artifactIdentity: artifact,
    gitDelivery: git,
    evidenceRefs: [],
  });
  assert.equal(gate.status, 'approved');

  const effects = [
    effectReceipt('ci', ['process']),
    effectReceipt('deploy', ['release']),
    effectReceipt('smoke', ['process']),
    effectReceipt('observe', ['network']),
  ];
  const observations = ['ci', 'deploy', 'smoke', 'observe'].map(stage => ({
    stage,
    status: 'passed',
    effectActionId: stage,
    artifactSetFingerprint: artifact.artifactSetFingerprint,
    evidenceRefs: [`${stage}:observed`],
  }));
  const deploymentService = new CanonicalCiDeployObserveService();
  const drifted = deploymentService.bind({ runId: RUN_ID }).assess({
    sequence: 9,
    actionId: 'deployment-drift',
    gate,
    observations: observations.map((item, index) => (
      index === 2 ? { ...item, artifactSetFingerprint: 'stale-artifact' } : item
    )),
    externalEffects: effects,
    evidenceRefs: [],
  });
  assert.equal(drifted.status, 'indeterminate');
  assert.equal(drifted.reasonCodes.includes('deployment-artifact-drift:smoke'), true);

  const passed = deploymentService.bind({ runId: RUN_ID }).assess({
    sequence: 9,
    actionId: 'deployment-passed',
    gate,
    observations,
    externalEffects: effects,
    evidenceRefs: [],
  });
  assert.equal(passed.status, 'passed');
  assert.deepEqual(passed.completedStages, ['ci', 'deploy', 'smoke', 'observe']);
});

test('I20-RBK-01 user journey: post-deploy failure requires exact authorized rollback', () => {
  const review = passedReview();
  const artifact = boundArtifact();
  const git = completedGit(review);
  const manifest = readyManifest(review, artifact, git);
  const gate = new CanonicalReleaseGateService().bind({ runId: RUN_ID }).assess({
    sequence: 8,
    actionId: 'release-gate',
    requested: true,
    authorized: true,
    authorizationRef: 'authority:release-approved',
    manifest,
    artifactIdentity: artifact,
    gitDelivery: git,
    evidenceRefs: [],
  });
  const effects = [
    effectReceipt('ci', ['process']),
    effectReceipt('deploy', ['release']),
    effectReceipt('smoke', ['process']),
  ];
  const deployment = new CanonicalCiDeployObserveService().bind({ runId: RUN_ID }).assess({
    sequence: 9,
    actionId: 'deployment-failed',
    gate,
    observations: [
      { stage: 'ci', status: 'passed', effectActionId: 'ci', artifactSetFingerprint: artifact.artifactSetFingerprint, evidenceRefs: ['ci:passed'] },
      { stage: 'deploy', status: 'passed', effectActionId: 'deploy', artifactSetFingerprint: artifact.artifactSetFingerprint, evidenceRefs: ['deploy:passed'] },
      { stage: 'smoke', status: 'failed', effectActionId: 'smoke', artifactSetFingerprint: artifact.artifactSetFingerprint, evidenceRefs: ['smoke:failed'] },
    ],
    externalEffects: effects,
    evidenceRefs: [],
  });
  assert.equal(deployment.status, 'failed');
  assert.equal(deployment.deployed, true);

  const rollbackService = new CanonicalRollbackService();
  const blocked = rollbackService.bind({ runId: RUN_ID }).assess({
    sequence: 10,
    actionId: 'rollback-missing-target',
    requested: false,
    authorized: false,
    deployment,
    externalEffects: [],
    evidenceRefs: [],
  });
  assert.equal(blocked.required, true);
  assert.equal(blocked.status, 'blocked');

  const rollbackEffect = effectReceipt('rollback', ['release']);
  const completed = rollbackService.bind({ runId: RUN_ID }).assess({
    sequence: 10,
    actionId: 'rollback-completed',
    requested: false,
    authorized: true,
    authorizationRef: 'authority:rollback-approved',
    targetArtifactFingerprint: 'previous-artifact-fingerprint',
    deployment,
    observation: {
      status: 'completed',
      effectActionId: 'rollback',
      targetArtifactFingerprint: 'previous-artifact-fingerprint',
      evidenceRefs: ['rollback:readback'],
    },
    externalEffects: [rollbackEffect],
    evidenceRefs: [],
  });
  assert.equal(completed.status, 'completed');
});

test('deployment readback failure still requires rollback after a committed release effect', () => {
  const review = passedReview();
  const artifact = boundArtifact();
  const git = completedGit(review);
  const manifest = readyManifest(review, artifact, git);
  const gate = new CanonicalReleaseGateService().bind({ runId: RUN_ID }).assess({
    sequence: 8,
    actionId: 'release-gate-readback-failure',
    requested: true,
    authorized: true,
    authorizationRef: 'authority:release-approved',
    manifest,
    artifactIdentity: artifact,
    gitDelivery: git,
    evidenceRefs: [],
  });
  const deployment = new CanonicalCiDeployObserveService().bind({ runId: RUN_ID }).assess({
    sequence: 9,
    actionId: 'deployment-readback-failed',
    gate,
    observations: [
      { stage: 'ci', status: 'passed', effectActionId: 'ci', artifactSetFingerprint: artifact.artifactSetFingerprint, evidenceRefs: ['ci:passed'] },
      { stage: 'deploy', status: 'failed', effectActionId: 'deploy', artifactSetFingerprint: artifact.artifactSetFingerprint, evidenceRefs: ['deploy:readback-failed'] },
    ],
    externalEffects: [
      effectReceipt('ci', ['process']),
      effectReceipt('deploy', ['release']),
    ],
    evidenceRefs: [],
  });

  assert.equal(deployment.status, 'failed');
  assert.equal(deployment.deployed, true);
  const rollback = new CanonicalRollbackService().bind({ runId: RUN_ID }).assess({
    sequence: 10,
    actionId: 'rollback-after-deploy-readback-failure',
    requested: false,
    authorized: false,
    deployment,
    externalEffects: [],
    evidenceRefs: [],
  });
  assert.equal(rollback.required, true);
  assert.equal(rollback.status, 'blocked');
});
