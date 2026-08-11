import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CODING_KERNEL_TASK_CONTRACT_VERSION,
  CODING_CONTEXT_GRAPH_VERSION,
  CODING_RUN_LIFECYCLE_VERSION,
  CODING_SETTLEMENT_DECISION_VERSION,
  CanonicalCodingKernel,
  CanonicalRunLifecycleService,
  CodingKernelExecutionError,
  CodingRunCancelledError,
  InMemoryCodingOperationJournal,
  buildCodingVerificationPlan,
  buildCodingKernelTaskContract,
  createFixtureCodingKernelEnvironment,
  createCodingWorktreeSnapshot,
  projectCodingKernelTaskContract,
} from '../dist/index.js';
import { commitCanonicalWorkspaceChange } from './support/canonical-code-change-fixture.mjs';

function taskContract() {
  return buildCodingKernelTaskContract({
    goal: 'Create src/value.ts and verify it',
    mode: 'change',
    include: ['src/value.ts', 'src/value.ts'],
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/value.ts' }],
    acceptance: [{
      id: 'verified',
      statement: 'The requested behavior passes verification.',
      deliverableIds: ['source'],
      oracle: verificationOracle('src/value.ts'),
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user-prompt'],
  });
}

function releaseTaskContract() {
  return buildCodingKernelTaskContract({
    goal: 'Deploy src/value.ts and verify it',
    mode: 'release',
    include: ['src/value.ts'],
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/value.ts' }],
    acceptance: [{
      id: 'verified',
      statement: 'The requested behavior passes verification.',
      deliverableIds: ['source'],
      oracle: verificationOracle('src/value.ts'),
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user-prompt'],
  });
}

function reviewTaskContract() {
  return buildCodingKernelTaskContract({
    goal: 'Inspect the repository architecture',
    mode: 'review',
    deliverables: [{ id: 'report', kind: 'report' }],
    acceptance: [{
      id: 'reviewed',
      statement: 'The inspection report is grounded.',
      deliverableIds: ['report'],
      oracle: responseOracle(),
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user-prompt'],
  });
}

function request(overrides = {}) {
  return {
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: 'cli',
    runId: 'run-1',
    userPrompt: 'Create src/value.ts and verify it',
    workspaceRoot: '/workspace',
    taskContract: taskContract(),
    operationJournal: new InMemoryCodingOperationJournal(),
    environment: createFixtureCodingKernelEnvironment('/workspace'),
    contextSeed: {
      files: [{ path: '/workspace/src/value.ts', sizeBytes: 120 }],
      manifests: { 'package.json': JSON.stringify({ scripts: { build: 'tsc', test: 'node --test' } }) },
    },
    runtimeContext: { providerResponse: 'response' },
    ...overrides,
  };
}

function completionEvidence(overrides = {}) {
  return {
    reviewRequired: false,
    acceptanceEvidence: [],
    pendingRefs: [],
    adverseEvidenceRefs: [],
    residualRisks: [],
    evidenceRefs: [],
    ...overrides,
  };
}

async function passCanonicalVerification(input, scopePaths = ['src/value.ts']) {
  return input.verification.verify(buildCodingVerificationPlan({
    runId: input.runId,
    sequence: 1,
    actionId: 'verify-change',
    idempotencyKey: `${input.runId}:verify-change`,
    scopePaths,
    acceptance: input.taskContract.acceptance.map(({ id, statement }) => ({ id, statement })),
    payload: { command: 'npm test' },
    evidenceRefs: [],
  }), {
    async verify() {
      return {
        verifier: 'project-test-runner',
        checks: [{
          checkId: 'requested-behavior',
          status: 'passed',
          acceptanceIds: ['verified'],
          summary: 'The requested behavior passed.',
          exitCode: 0,
          evidenceRefs: ['verify:passed'],
        }],
        evidenceRefs: [],
      };
    },
  });
}

test('CanonicalCodingKernel preserves one versioned request and terminal output contract', async () => {
  const calls = [];
  const kernel = new CanonicalCodingKernel({
    async executeCanonical(input) {
      calls.push(input);
      assert.throws(() => input.taskContract.scope.include.push('runtime-owned-path.ts'), TypeError);
      assert.throws(() => input.contextGraph.nodes.push({}), TypeError);
      assert.equal(input.requirementDecision.status, 'ready');
      assert.equal(input.designDecision.status, 'ready');
      assert.equal(input.changePlan.status, 'ready');
      assert.equal(typeof input.independentReview.assess, 'function');
      assert.equal(typeof input.artifactIdentity.assess, 'function');
      assert.equal(typeof input.gitDelivery.assess, 'function');
      assert.equal(typeof input.deliveryManifest.build, 'function');
      assert.equal(typeof input.releaseGate.assess, 'function');
      assert.equal(typeof input.ciDeployObserve.assess, 'function');
      assert.equal(typeof input.rollback.assess, 'function');
      assert.equal(input.providerCapabilityDecision.decision, 'allow');
      assert.equal(input.providerCapabilityDecision.requestKind, 'code-change');
      assert.equal(input.platformConformance.supported, true);
      assert.equal(input.secretRedaction.redactText('api_key=sk-secret123').redacted, true);
      const planned = await commitCanonicalWorkspaceChange(input, {
        paths: ['src/value.ts'],
        marker: 'planned-target',
      });
      assert.equal(planned.authorization.permission.decision, 'allow');
      const revised = await commitCanonicalWorkspaceChange(input, {
        paths: ['src/auth.ts'],
        marker: 'runtime-discovered-target',
      });
      assert.equal(
        revised.authorization.permission.reason,
        'task-contract-change-allows-workspace-mutation',
      );
      await passCanonicalVerification(input, ['src/value.ts', 'src/auth.ts']);
      return {
        result: { changedPaths: ['src/value.ts', 'src/auth.ts'] },
        completionEvidence: completionEvidence(),
      };
    },
  });

  const output = await kernel.execute(request());

  assert.equal(calls.length, 1);
  assert.equal(output.route, 'canonical');
  assert.equal(output.surface, 'cli');
  assert.equal(output.status, 'completed');
  assert.equal(output.settlement.version, CODING_SETTLEMENT_DECISION_VERSION);
  assert.equal(output.settlement.status, output.status);
  assert.equal(output.settlement.lifecycleSequence, output.lifecycle.events.length);
  assert.equal(output.orientation, output.taskContract.orientation);
  assert.equal(output.orientation.mode, 'change');
  assert.equal(output.contextGraph.version, CODING_CONTEXT_GRAPH_VERSION);
  assert.equal(output.contextGraph, calls[0].contextGraph);
  assert.equal(output.requirementDecision, calls[0].requirementDecision);
  assert.notEqual(output.designDecision, calls[0].designDecision);
  assert.notEqual(output.changePlan, calls[0].changePlan);
  assert.equal(output.changePlan.parentPlanId, calls[0].changePlan.planId);
  assert.deepEqual(output.changePlan.authorizedTargets, ['src/value.ts', 'src/auth.ts']);
  assert.deepEqual(output.changePlanRevisionDecisions.map(item => item.status), ['unchanged', 'revised']);
  assert.equal(output.designDecisionHistory.length, 2);
  assert.equal(output.changePlanHistory.length, 2);
  assert.equal(Object.isFrozen(output.requirementDecision), true);
  assert.equal(Object.isFrozen(output.designDecision), true);
  assert.equal(Object.isFrozen(output.changePlan), true);
  assert.deepEqual(output.toolAuthorizations.map(item => item.permission.decision), ['allow', 'allow']);
  assert.equal(output.contextGraph.orientation.environment.languages.includes('typescript'), true);
  assert.equal(output.contextGraph.nodes.some(node => node.id === 'file:src/value.ts'), true);
  assert.equal(output.contextGraph.instructionPrecedence.instructions.at(-1).sourceId, 'user:current');
  assert.deepEqual(output.lifecycle, {
    version: CODING_RUN_LIFECYCLE_VERSION,
    runId: 'run-1',
    surface: 'cli',
    status: 'completed',
    terminal: true,
    events: [
      {
        version: CODING_RUN_LIFECYCLE_VERSION,
        runId: 'run-1',
        surface: 'cli',
        sequence: 1,
        from: null,
        to: 'accepted',
        cause: 'task-accepted',
      },
      {
        version: CODING_RUN_LIFECYCLE_VERSION,
        runId: 'run-1',
        surface: 'cli',
        sequence: 2,
        from: 'accepted',
        to: 'running',
        cause: 'execution-dispatched',
      },
      {
        version: CODING_RUN_LIFECYCLE_VERSION,
        runId: 'run-1',
        surface: 'cli',
        sequence: 3,
        from: 'running',
        to: 'completed',
        cause: 'runtime-completed',
      },
    ],
  });
  assert.equal(output.taskContract.version, CODING_KERNEL_TASK_CONTRACT_VERSION);
  assert.deepEqual(output.taskContract.scope.include, ['src/value.ts']);
  assert.deepEqual(output.result.changedPaths, ['src/value.ts', 'src/auth.ts']);
  assert.equal(output.completion.status, 'completed');
  assert.deepEqual(output.verificationReceipts.map(receipt => receipt.status), ['passed']);
  assert.deepEqual(output.independentReviewDecisions.map(item => item.status), ['not-required']);
  assert.deepEqual(output.artifactIdentityDecisions.map(item => item.status), ['not-applicable']);
  assert.deepEqual(output.gitDeliveryDecisions.map(item => item.status), ['not-applicable']);
  assert.deepEqual(output.deliveryManifests.map(item => item.status), ['ready']);
  assert.deepEqual(output.releaseGateDecisions.map(item => item.status), ['not-applicable']);
  assert.deepEqual(output.deploymentDecisions.map(item => item.status), ['not-applicable']);
  assert.deepEqual(output.rollbackDecisions.map(item => item.status), ['not-required']);
  assert.equal(output.providerCapabilityDecision.decision, 'allow');
  assert.equal(output.platformConformance.supported, true);
  assert.equal(output.runControl.state, 'settled');
  assert.equal(output.runControl.terminalStatus, 'completed');
  assert.deepEqual(output.cancellationReceipts, []);
  assert.deepEqual(output.steeringReceipts, []);
  assert.deepEqual(output.dirtyWorktreeDecisions.map(item => item.reason), ['clean', 'clean']);
  assert.equal(output.evidenceRefs.includes('code-change:path:src/value.ts'), true);
  assert.equal(output.evidenceRefs.includes('code-change:path:src/auth.ts'), true);
  assert.equal(output.evidenceRefs.includes('verify:passed'), true);
  assert.deepEqual(output.settlement.evidenceRefs, output.evidenceRefs);
});

test('CanonicalCodingKernel blocks incompatible providers and unsupported platforms before runtime', async () => {
  let calls = 0;
  const kernel = new CanonicalCodingKernel({
    async executeCanonical() {
      calls += 1;
      return { result: undefined, completionEvidence: completionEvidence() };
    },
  });

  await assert.rejects(kernel.execute(request({
    runId: 'run-provider-blocked',
    environment: createFixtureCodingKernelEnvironment('/workspace', 'vscode-lm'),
  })), error => {
    assert.equal(error instanceof CodingKernelExecutionError, true);
    assert.equal(error.lifecycle.status, 'blocked');
    assert.equal(error.environment.providerCapabilityDecision.reason, 'missing-capability');
    assert.deepEqual(error.environment.providerCapabilityDecision.missingCapabilities, ['native-tools|text-tools']);
    return true;
  });

  const environment = createFixtureCodingKernelEnvironment('/workspace');
  await assert.rejects(kernel.execute(request({
    runId: 'run-platform-blocked',
    environment: {
      ...environment,
      platform: {
        ...environment.platform,
        profile: { ...environment.platform.profile, os: 'unknown' },
      },
    },
  })), error => {
    assert.equal(error instanceof CodingKernelExecutionError, true);
    assert.equal(error.lifecycle.status, 'blocked');
    assert.equal(error.environment.platformConformance.supported, false);
    return true;
  });
  assert.equal(calls, 0);
});

test('CanonicalCodingKernel applies dirty-worktree policy to runtime workspace mutations', async () => {
  const kernel = new CanonicalCodingKernel({
    async executeCanonical(input) {
      const attempted = await commitCanonicalWorkspaceChange(input, {
        paths: ['src/value.ts'],
        marker: 'overlap-existing-user-change',
      });
      assert.equal(attempted.outcome.receipt.status, 'failed');
      return { result: undefined, completionEvidence: completionEvidence() };
    },
  });
  const environment = createFixtureCodingKernelEnvironment('/workspace');
  const output = await kernel.execute(request({
    environment: {
      ...environment,
      worktree: createCodingWorktreeSnapshot({
        workspaceRoot: '/workspace',
        repositoryState: 'git',
        entries: [{ path: 'src/value.ts', status: 'modified' }],
      }),
    },
  }));

  assert.equal(output.status, 'failed');
  assert.equal(output.workspaceMutationReceipts[0].errorCode, 'dirty-worktree-conflict');
  assert.equal(output.dirtyWorktreeDecisions[0].reason, 'overlapping-user-changes');
  assert.deepEqual(output.dirtyWorktreeDecisions[0].conflictingEntries.map(item => item.path), ['src/value.ts']);
});

test('CanonicalCodingKernel blocks release without independent review and exact delivery evidence', async () => {
  const kernel = new CanonicalCodingKernel({
    async executeCanonical(input) {
      await commitCanonicalWorkspaceChange(input, {
        paths: ['src/value.ts'],
        marker: 'release-target',
      });
      await passCanonicalVerification(input);
      return {
        result: { changedPaths: ['src/value.ts'] },
        completionEvidence: completionEvidence(),
      };
    },
  });

  const output = await kernel.execute(request({
    runId: 'run-release-blocked',
    userPrompt: 'Deploy src/value.ts and verify it',
    taskContract: releaseTaskContract(),
  }));

  assert.equal(output.status, 'blocked');
  assert.equal(output.completion.reasonCodes.includes('review-not-passed'), true);
  assert.deepEqual(output.independentReviewDecisions.map(item => item.status), ['not-run']);
  assert.deepEqual(output.artifactIdentityDecisions.map(item => item.status), ['indeterminate']);
  assert.deepEqual(output.gitDeliveryDecisions.map(item => item.status), ['blocked']);
  assert.deepEqual(output.deliveryManifests.map(item => item.status), ['blocked']);
  assert.deepEqual(output.releaseGateDecisions.map(item => item.status), ['blocked']);
  assert.deepEqual(output.deploymentDecisions.map(item => item.status), ['blocked']);
});

test('CanonicalCodingKernel keeps read-only reports, manual review, and independent review distinct', async () => {
  const kernel = new CanonicalCodingKernel({
    async executeCanonical(input) {
      return {
        result: { report: 'Architecture inspection.' },
        completionEvidence: completionEvidence({
          acceptanceEvidence: [{
            criterionId: 'reviewed',
            status: 'passed',
            evidenceRefs: [`report:${input.runId}`],
          }],
          ...(input.runtimeContext.manualReview ? {
            reviewRequired: true,
            review: { status: 'not-run', evidenceRefs: [] },
          } : {}),
          ...(input.runtimeContext.independentReview ? {
            independentReviewRequired: true,
          } : {}),
        }),
      };
    },
  });
  const base = {
    userPrompt: 'Inspect the repository architecture',
    taskContract: reviewTaskContract(),
  };

  const report = await kernel.execute(request({
    ...base,
    runId: 'run-read-only-report',
    runtimeContext: {},
  }));
  assert.equal(report.status, 'completed');
  assert.deepEqual(report.independentReviewDecisions.map(item => item.status), ['not-required']);

  const manual = await kernel.execute(request({
    ...base,
    runId: 'run-manual-review',
    runtimeContext: { manualReview: true },
  }));
  assert.equal(manual.status, 'blocked');
  assert.equal(manual.completion.reasonCodes.includes('review-not-passed'), true);
  assert.deepEqual(manual.independentReviewDecisions.map(item => item.status), ['not-required']);

  const independent = await kernel.execute(request({
    ...base,
    runId: 'run-independent-review',
    runtimeContext: { independentReview: true },
  }));
  assert.equal(independent.status, 'blocked');
  assert.equal(independent.completion.reasonCodes.includes('review-not-passed'), true);
  assert.deepEqual(independent.independentReviewDecisions.map(item => item.status), ['not-run']);
});

test('CanonicalCodingKernel fails closed before invoking runtime for invalid routes and cancellation', async () => {
  let calls = 0;
  const kernel = new CanonicalCodingKernel({
    async executeCanonical() {
      calls += 1;
      return { result: undefined, completionEvidence: completionEvidence() };
    },
  });

  await assert.rejects(kernel.execute(request({ route: 'legacy-planned' })), /unsupported-route/u);
  const otherContract = buildCodingKernelTaskContract({
    goal: 'Fix src/other.ts and verify it',
    mode: 'change',
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/other.ts' }],
    acceptance: [{
      id: 'verified',
      statement: 'The other source change passes verification.',
      deliverableIds: ['source'],
      oracle: verificationOracle('src/other.ts'),
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user-prompt'],
  });
  await assert.rejects(
    kernel.execute(request({ taskContract: otherContract })),
    /coding-orientation:prompt-mismatch/u,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(kernel.execute(request({ signal: controller.signal })), error => {
    assert.equal(error instanceof CodingKernelExecutionError, true);
    assert.match(error.message, /cancelled-before-start/u);
    assert.equal(error.lifecycle.status, 'cancelled');
    assert.equal(error.settlement.status, 'cancelled');
    assert.deepEqual(error.lifecycle.events.map(event => event.to), ['accepted', 'cancelled']);
    return true;
  });
  assert.equal(calls, 0);
});

test('CanonicalCodingKernel cancellation freezes new runtime effects before terminal settlement', async () => {
  const controller = new AbortController();
  const kernel = new CanonicalCodingKernel({
    async executeCanonical(input) {
      controller.abort('user-cancelled');
      await assert.rejects(
        commitCanonicalWorkspaceChange(input, {
          paths: ['src/value.ts'],
          marker: 'must-not-run-after-cancel',
        }),
        error => error instanceof CodingRunCancelledError,
      );
      return {
        result: { changedPaths: [] },
        completionEvidence: completionEvidence(),
      };
    },
  });

  const output = await kernel.execute(request({
    runId: 'run-cancel-freezes-effects',
    signal: controller.signal,
  }));

  assert.equal(output.status, 'cancelled');
  assert.equal(output.runControl.terminalStatus, 'cancelled');
  assert.equal(output.cancellationReceipts.length, 1);
  assert.equal(output.cancellationReceipts[0].effectsFrozen, true);
  assert.deepEqual(output.toolExecutionReceipts, []);
  assert.deepEqual(output.workspaceMutationReceipts, []);
});

test('CanonicalCodingKernel seals blocked and failed runtime outcomes through one lifecycle owner', async () => {
  const blockedKernel = new CanonicalCodingKernel({
    async executeCanonical() {
      return {
        result: { reason: 'permission-denied' },
        completionEvidence: completionEvidence({ pendingRefs: ['permission-denied'] }),
      };
    },
  });
  const blocked = await blockedKernel.execute(request());
  assert.equal(blocked.lifecycle.status, 'blocked');
  assert.equal(blocked.settlement.status, 'blocked');
  assert.equal(blocked.completion.reasonCodes.includes('pending-work'), true);
  assert.equal(blocked.completion.reasonCodes.includes('verification-not-run'), true);
  assert.equal(blocked.lifecycle.events.at(-1).cause, 'authority-blocked');

  const failedKernel = new CanonicalCodingKernel({
    async executeCanonical() {
      throw new Error('provider disconnected');
    },
  });
  await assert.rejects(failedKernel.execute(request()), error => {
    assert.equal(error instanceof CodingKernelExecutionError, true);
    assert.equal(error.message, 'provider disconnected');
    assert.equal(error.lifecycle.status, 'failed');
    assert.equal(error.settlement.status, 'failed');
    assert.equal(error.completion.status, 'failed');
    assert.equal(error.completion.reasonCodes.includes('execution-failed'), true);
    assert.equal(error.lifecycle.events.at(-1).cause, 'runtime-failed');
    return true;
  });
});

test('RunLifecyclePort treats waiting-user as resumable and rejects post-terminal transitions', () => {
  const lifecycle = new CanonicalRunLifecycleService().start({ runId: 'run-wait', surface: 'vscode' });
  lifecycle.beginExecution();
  lifecycle.waitForUser();
  assert.equal(lifecycle.snapshot().terminal, false);
  assert.equal(lifecycle.snapshot().status, 'waiting-user');
  lifecycle.resumeExecution();
  lifecycle.settle('completed');

  assert.deepEqual(
    lifecycle.snapshot().events.map(event => event.to),
    ['accepted', 'running', 'waiting-user', 'running', 'completed'],
  );
  assert.throws(() => lifecycle.settle('failed'), /invalid-transition:completed->failed/u);
});

test('task contract rejects missing provenance and ambiguous acceptance ids', () => {
  assert.throws(() => buildCodingKernelTaskContract({
    goal: 'Inspect the project',
    mode: 'review',
    deliverables: [{ id: 'report', kind: 'report' }],
    acceptance: [{
      id: 'reviewed',
      statement: 'Findings are grounded.',
      deliverableIds: ['report'],
      oracle: responseOracle(),
      externalBoundaryRefs: [],
    }],
    provenanceRefs: [],
  }), /missing-provenance/u);

  assert.throws(() => buildCodingKernelTaskContract({
    goal: 'Inspect the project',
    mode: 'review',
    deliverables: [{ id: 'report', kind: 'report' }],
    acceptance: [
      {
        id: 'reviewed',
        statement: 'Findings are grounded.',
        deliverableIds: ['report'],
        oracle: responseOracle(),
        externalBoundaryRefs: [],
      },
      {
        id: 'reviewed',
        statement: 'Risks are listed.',
        deliverableIds: ['report'],
        oracle: responseOracle(),
        externalBoundaryRefs: [],
      },
    ],
    provenanceRefs: ['user-prompt'],
  }), /invalid-acceptance/u);
});

test('task contract rejects a mode that contradicts canonical prompt orientation', () => {
  assert.throws(() => buildCodingKernelTaskContract({
    goal: 'Fix src/value.ts.',
    mode: 'review',
    deliverables: [{ id: 'report', kind: 'report' }],
    acceptance: [{
      id: 'reviewed',
      statement: 'The file is reviewed.',
      deliverableIds: ['report'],
      oracle: responseOracle(),
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user-prompt'],
  }), /coding-kernel-task-contract:orientation-mode-mismatch/u);
});

function verificationOracle(...scope) {
  return {
    kind: 'verification',
    verifier: 'focused-test-suite',
    scope,
    evidenceKinds: ['verification-receipt'],
  };
}

function responseOracle() {
  return {
    kind: 'response-evidence',
    verifier: 'completion-adapter',
    scope: ['response'],
    evidenceKinds: ['response-evidence'],
  };
}

test('canonical TaskContract projection has one immutable shared owner', () => {
  const contract = taskContract();
  const projection = projectCodingKernelTaskContract(contract);

  assert.equal('version' in projection, false);
  assert.deepEqual(projection, {
    goal: contract.goal,
    mode: contract.mode,
    scope: contract.scope,
    deliverables: contract.deliverables,
    constraints: contract.constraints,
    acceptance: contract.acceptance.map(({ id, statement }) => ({ id, statement })),
    provenanceRefs: contract.provenanceRefs,
  });
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.scope.include), true);
  assert.throws(() => projection.scope.include.push('surface-owned-path.ts'), TypeError);
});
