import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  CODING_CONFORMANCE_DIMENSIONS,
  CODING_KERNEL_OUTPUT_VERSION,
  buildCodingKernelTaskContract,
  evaluateCodingConformanceFixture,
} from '../../shared/dist/index.js';
import {
  HeadlessCodingKernelExecutor,
  HeadlessCompletionAdapter,
  HeadlessToolExecutionAdapter,
  HeadlessVerificationAdapter,
  HeadlessWorkspaceMutationAdapter,
} from '../dist/index.js';

test('Headless product entry delegates one immutable request to the shared canonical Kernel', async () => {
  const calls = [];
  const executor = new HeadlessCodingKernelExecutor({
    async executeCanonical(request) {
      calls.push(request);
      const fixture = findFixture(request.runId);
      return runtimeOutput(fixture, { fixtureId: fixture.fixtureId });
    },
  });

  for (const fixture of CODING_CONFORMANCE_DEVELOPMENT_FIXTURES) {
    const output = await executor.execute(runInput(fixture));
    const evaluation = evaluateCodingConformanceFixture(fixture, [{
      surface: 'headless',
      adapterId: 'headless-canonical-product-output',
      evidenceClass: 'product-route',
      sourceRefs: [
        'packages/headless/src/headless-coding-kernel.ts',
        `headless-product-route:${fixture.fixtureId}`,
      ],
      projection: output.conformance,
      unavailableDimensions: [],
    }]);
    const headlessResult = evaluation.surfaceResults.find(result => result.surface === 'headless');

    assert.equal(output.version, CODING_KERNEL_OUTPUT_VERSION, fixture.fixtureId);
    assert.equal(output.surface, 'headless', fixture.fixtureId);
    assert.equal(output.status, fixture.expected.completion.status, fixture.fixtureId);
    assert.deepEqual(output.result, { fixtureId: fixture.fixtureId }, fixture.fixtureId);
    assert.deepEqual(output.conformance, fixture.expected, fixture.fixtureId);
    assert.equal(Object.isFrozen(output.conformance), true, fixture.fixtureId);
    assert.equal(Object.isFrozen(output.conformance.taskContract.scope.include), true, fixture.fixtureId);
    assert.equal(headlessResult.contractConformant, true, JSON.stringify(headlessResult.violations));
    assert.equal(headlessResult.evidenceClass, 'product-route', fixture.fixtureId);
    assert.deepEqual(headlessResult.observedDimensions, CODING_CONFORMANCE_DIMENSIONS, fixture.fixtureId);
    assert.deepEqual(headlessResult.missingDimensions, [], fixture.fixtureId);
    assert.equal(evaluation.contractConformant, false, fixture.fixtureId);
    assert.equal(evaluation.productRouteEvidenceComplete, false, fixture.fixtureId);
    assert.equal(evaluation.qualificationEligible, false, fixture.fixtureId);
    assert.equal(evaluation.claimsPermitted, false, fixture.fixtureId);
  }

  assert.equal(calls.length, CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.length);
  assert.equal(calls.every(call => call.route === 'canonical'), true);
  assert.equal(calls.every(call => call.surface === 'headless'), true);
  assert.equal(calls.every(call => Object.isFrozen(call.taskContract)), true);
});

test('Headless product entry fails closed on incomplete or drifted conformance evidence', async t => {
  const fixture = findFixture('modify-and-verify');

  await t.test('missing dimension', async () => {
    await assert.rejects(
      executeMutated(fixture, projection => delete projection.verifications),
      /headless-coding-conformance:invalid-projection:verifications:missing-dimension/,
    );
  });

  await t.test('TaskContract drift', async () => {
    await assert.rejects(
      executeMutated(fixture, projection => { projection.taskContract.goal = 'A different goal.'; }),
      /headless-coding-conformance:binding-mismatch:task-contract-mismatch/,
    );
  });

  await t.test('terminal status drift', async () => {
    await assert.rejects(
      executeMutated(fixture, projection => { projection.completion.status = 'failed'; }),
      /headless-coding-conformance:binding-mismatch:terminal-status-mismatch/,
    );
  });
});

test('Headless product entry fails before runtime dispatch when cancellation is already requested', async () => {
  let calls = 0;
  const executor = new HeadlessCodingKernelExecutor({
    async executeCanonical() {
      calls += 1;
      const fixture = findFixture('create-and-verify');
      return runtimeOutput(fixture, null);
    },
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    executor.execute({
      ...runInput(findFixture('create-and-verify')),
      signal: controller.signal,
    }),
    /coding-kernel-execution:cancelled-before-start/,
  );
  assert.equal(calls, 0);
});

test('Headless tool adapter composes host capability without bypassing shared authority', async () => {
  let calls = 0;
  const adapter = new HeadlessToolExecutionAdapter();
  const denied = await adapter.execute({
    action: {
      runId: 'headless-tool-run',
      sequence: 1,
      actionId: 'network-denied',
      tool: 'fetch_webpage',
      effects: ['network'],
      input: { url: 'https://example.com' },
      authority: {
        decision: 'deny',
        status: 'denied',
        reason: 'network-not-authorized',
        evidenceRefs: ['headless-authority:network-denied'],
      },
    },
    host: {
      async execute() {
        calls++;
        return { status: 'completed', result: 'unexpected', evidenceRefs: ['unexpected'] };
      },
    },
  });

  assert.equal(calls, 0);
  assert.equal(denied.receipt.status, 'denied');
  assert.equal(denied.receipt.permission.decision, 'deny');
});

test('Headless mutation adapter commits only caller-host readback evidence', async () => {
  const calls = [];
  const outcome = await new HeadlessWorkspaceMutationAdapter().execute({
    plan: {
      runId: 'headless-mutation-run',
      sequence: 1,
      actionId: 'headless-write-1',
      idempotencyKey: 'headless-mutation-run:headless-write-1',
      paths: ['src/value.ts'],
      payload: { content: 'updated\n' },
      evidenceRefs: ['headless-plan:write-1'],
    },
    host: {
      async captureBaseline() {
        calls.push('baseline');
        return {
          baselineRef: 'headless-baseline:value:v0',
          state: { content: 'old\n' },
          evidenceRefs: ['headless-baseline:captured'],
        };
      },
      async apply() {
        calls.push('apply');
        return {
          status: 'applied',
          applied: {
            state: { content: 'updated\n' },
            result: ['src/value.ts'],
            evidenceRefs: ['headless-apply:completed'],
          },
        };
      },
      async readback() {
        calls.push('readback');
        return {
          matches: true,
          readbackRef: 'headless-readback:value:v1',
          evidenceRefs: ['headless-readback:matched'],
        };
      },
      async rollback() {
        calls.push('rollback');
        return { rolledBack: false, evidenceRefs: ['headless-rollback:unexpected'] };
      },
    },
  });

  assert.deepEqual(calls, ['baseline', 'apply', 'readback']);
  assert.equal(outcome.receipt.status, 'committed');
  assert.deepEqual(outcome.receipt.result, ['src/value.ts']);
  assert.equal(outcome.receipt.readbackRef, 'headless-readback:value:v1');
});

test('Headless verification adapter keeps missing acceptance evidence unverified', async () => {
  const outcome = await new HeadlessVerificationAdapter().verify({
    plan: {
      runId: 'headless-verify-run',
      sequence: 1,
      actionId: 'headless-verify-1',
      idempotencyKey: 'headless-verify-run:headless-verify-1',
      scopePaths: ['src/value.ts'],
      acceptance: [{ id: 'builds', statement: 'Project builds' }],
      payload: { workspaceRoot: '/workspace' },
      evidenceRefs: ['headless-mutation:committed'],
    },
    host: {
      async verify() {
        return { verifier: 'none', checks: [], evidenceRefs: ['headless-verifier:none'] };
      },
    },
  });

  assert.equal(outcome.receipt.status, 'unverified');
  assert.equal(outcome.receipt.acceptance[0].status, 'unverified');
});

test('Headless completion adapter blocks a change without verification evidence', () => {
  const decision = new HeadlessCompletionAdapter().decide({
    runId: 'headless-completion-run',
    decisionId: 'completion-1',
    idempotencyKey: 'headless-completion-run:completion-1',
    acceptance: [{ id: 'verified', statement: 'The change is verified.' }],
    verificationRequired: true,
    reviewRequired: false,
    toolExecutions: [],
    mutations: [],
    verifications: [],
    resolvedVerificationActionIds: [],
    acceptanceEvidence: [],
    pendingRefs: [],
    adverseEvidenceRefs: [],
    residualRisks: [],
    evidenceRefs: ['headless-task-contract:completion-run'],
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.reasonCodes.includes('verification-not-run'), true);
});

async function executeMutated(fixture, mutate) {
  const projection = structuredClone(fixture.expected);
  mutate(projection);
  const executor = new HeadlessCodingKernelExecutor({
    async executeCanonical() {
      return {
        status: fixture.expected.completion.status,
        result: { value: null, conformance: projection },
        evidenceRefs: fixture.expected.completion.evidenceRefs,
        residualRisks: fixture.expected.completion.residualRisks,
      };
    },
  });
  return executor.execute(runInput(fixture));
}

function runtimeOutput(fixture, value) {
  return {
    status: fixture.expected.completion.status,
    result: {
      value,
      conformance: structuredClone(fixture.expected),
    },
    evidenceRefs: fixture.expected.completion.evidenceRefs,
    residualRisks: fixture.expected.completion.residualRisks,
  };
}

function runInput(fixture) {
  return {
    runId: fixture.fixtureId,
    userPrompt: fixture.prompt,
    workspaceRoot: '/workspace',
    taskContract: buildCodingKernelTaskContract({
      goal: fixture.expected.taskContract.goal,
      mode: fixture.expected.taskContract.mode,
      include: fixture.expected.taskContract.scope.include,
      exclude: fixture.expected.taskContract.scope.exclude,
      deliverables: fixture.expected.taskContract.deliverables,
      constraints: fixture.expected.taskContract.constraints,
      acceptance: fixture.expected.taskContract.acceptance,
      provenanceRefs: fixture.expected.taskContract.provenanceRefs,
    }),
    runtimeContext: { provider: 'deterministic' },
  };
}

function findFixture(fixtureId) {
  const fixture = CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.find(candidate => candidate.fixtureId === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  return fixture;
}
