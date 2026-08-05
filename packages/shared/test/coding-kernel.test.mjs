import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CODING_KERNEL_TASK_CONTRACT_VERSION,
  CanonicalCodingKernel,
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
  assert.equal(output.taskContract.version, CODING_KERNEL_TASK_CONTRACT_VERSION);
  assert.deepEqual(output.taskContract.scope.include, ['src/value.ts']);
  assert.deepEqual(output.result.changedPaths, ['src/value.ts']);
  assert.deepEqual(output.evidenceRefs, ['verify:passed']);
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
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(kernel.execute(request({ signal: controller.signal })), /cancelled-before-start/u);
  assert.equal(calls, 0);
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
