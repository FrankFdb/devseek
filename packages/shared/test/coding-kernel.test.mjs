import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CODING_KERNEL_TASK_CONTRACT_VERSION,
  CODING_RUN_LIFECYCLE_VERSION,
  CODING_SETTLEMENT_DECISION_VERSION,
  CanonicalCodingKernel,
  CanonicalRunLifecycleService,
  CodingKernelExecutionError,
  buildCodingKernelTaskContract,
  projectCodingKernelTaskContract,
} from '../dist/index.js';

function taskContract() {
  return buildCodingKernelTaskContract({
    goal: 'Create src/value.ts and verify it',
    mode: 'change',
    include: ['src/value.ts', 'src/value.ts'],
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/value.ts' }],
    acceptance: [{ id: 'verified', statement: 'The requested behavior passes verification.' }],
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
    runtimeContext: { providerResponse: 'response' },
    ...overrides,
  };
}

test('CanonicalCodingKernel preserves one versioned request and terminal output contract', async () => {
  const calls = [];
  const kernel = new CanonicalCodingKernel({
    async executeCanonical(input) {
      calls.push(input);
      assert.throws(() => input.taskContract.scope.include.push('runtime-owned-path.ts'), TypeError);
      return {
        status: 'completed',
        result: { changedPaths: ['src/value.ts'] },
        evidenceRefs: ['verify:passed', 'verify:passed'],
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
  assert.deepEqual(output.result.changedPaths, ['src/value.ts']);
  assert.deepEqual(output.evidenceRefs, ['verify:passed']);
  assert.deepEqual(output.settlement.evidenceRefs, output.evidenceRefs);
});

test('CanonicalCodingKernel fails closed before invoking runtime for invalid routes and cancellation', async () => {
  let calls = 0;
  const kernel = new CanonicalCodingKernel({
    async executeCanonical() {
      calls += 1;
      return { status: 'completed', result: undefined };
    },
  });

  await assert.rejects(kernel.execute(request({ route: 'legacy-planned' })), /unsupported-route/u);
  const otherContract = buildCodingKernelTaskContract({
    goal: 'Fix src/other.ts and verify it',
    mode: 'change',
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/other.ts' }],
    acceptance: [{ id: 'verified', statement: 'The other source change passes verification.' }],
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

test('CanonicalCodingKernel seals blocked and failed runtime outcomes through one lifecycle owner', async () => {
  const blockedKernel = new CanonicalCodingKernel({
    async executeCanonical() {
      return { status: 'blocked', result: { reason: 'permission-denied' } };
    },
  });
  const blocked = await blockedKernel.execute(request());
  assert.equal(blocked.lifecycle.status, 'blocked');
  assert.equal(blocked.settlement.status, 'blocked');
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
    acceptance: [{ id: 'reviewed', statement: 'Findings are grounded.' }],
    provenanceRefs: [],
  }), /missing-provenance/u);

  assert.throws(() => buildCodingKernelTaskContract({
    goal: 'Inspect the project',
    mode: 'review',
    deliverables: [{ id: 'report', kind: 'report' }],
    acceptance: [
      { id: 'reviewed', statement: 'Findings are grounded.' },
      { id: 'reviewed', statement: 'Risks are listed.' },
    ],
    provenanceRefs: ['user-prompt'],
  }), /invalid-acceptance/u);
});

test('task contract rejects a mode that contradicts canonical prompt orientation', () => {
  assert.throws(() => buildCodingKernelTaskContract({
    goal: 'Fix src/value.ts.',
    mode: 'review',
    deliverables: [{ id: 'report', kind: 'report' }],
    acceptance: [{ id: 'reviewed', statement: 'The file is reviewed.' }],
    provenanceRefs: ['user-prompt'],
  }), /coding-kernel-task-contract:orientation-mode-mismatch/u);
});

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
    acceptance: contract.acceptance,
    provenanceRefs: contract.provenanceRefs,
  });
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.scope.include), true);
  assert.throws(() => projection.scope.include.push('surface-owned-path.ts'), TypeError);
});
