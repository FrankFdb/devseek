import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_KERNEL_TASK_CONTRACT_VERSION,
  CanonicalTaskContractService,
  resolveCodingKernelTaskContract,
} from '../dist/index.js';

function validInput(overrides = {}) {
  return {
    goal: 'Fix src/value.ts and verify the result.',
    mode: 'change',
    include: [' src/value.ts ', 'src/value.ts'],
    deliverables: [{ id: ' source-change ', kind: 'source-change', path: ' src/value.ts ' }],
    constraints: [' workspace-scoped ', 'workspace-scoped'],
    acceptance: [{
      id: ' changed ',
      statement: ' The requested source change is present. ',
      deliverableIds: [' source-change '],
      oracle: {
        kind: 'verification',
        verifier: ' focused-test-suite ',
        scope: [' src/value.ts '],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: [' user-prompt ', 'user-prompt'],
    ...overrides,
  };
}

test('TaskContractPort owns canonical construction and immutable projection', () => {
  const service = new CanonicalTaskContractService();
  const contract = service.build(validInput());
  const projection = service.project(contract);

  assert.equal(contract.version, CODING_KERNEL_TASK_CONTRACT_VERSION);
  assert.equal(contract.goal, 'Fix src/value.ts and verify the result.');
  assert.equal(contract.orientation.mode, 'change');
  assert.deepEqual(contract.scope.include, ['src/value.ts']);
  assert.deepEqual(contract.deliverables, [{
    id: 'source-change',
    kind: 'source-change',
    path: 'src/value.ts',
  }]);
  assert.deepEqual(contract.constraints, ['workspace-scoped']);
  assert.deepEqual(contract.acceptance[0].deliverableIds, ['source-change']);
  assert.equal(contract.acceptance[0].oracle.verifier, 'focused-test-suite');
  assert.deepEqual(contract.provenanceRefs, ['user-prompt']);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.scope.include), true);
  assert.equal(Object.isFrozen(contract.deliverables[0]), true);
  assert.deepEqual(projection.deliverables, contract.deliverables);
  assert.equal(Object.isFrozen(projection), true);
});

test('TaskContractPort fails closed on malformed, contradictory, and spoofed contracts', () => {
  const service = new CanonicalTaskContractService();
  assert.throws(
    () => service.build(validInput({ deliverables: 'source-change' })),
    /coding-kernel-task-contract:invalid-deliverables/u,
  );
  assert.throws(
    () => service.build(validInput({ mode: 'execute' })),
    /coding-kernel-task-contract:invalid-mode/u,
  );
  assert.throws(
    () => service.build(validInput({ provenanceRefs: [] })),
    /coding-kernel-task-contract:missing-provenance/u,
  );
  const reviewOrientation = service.build(validInput({
    goal: 'Review src/value.ts.',
    mode: 'review',
    deliverables: [{ id: 'report', kind: 'report' }],
    acceptance: [{
      id: 'reviewed',
      statement: 'The review findings are grounded.',
      deliverableIds: ['report'],
      oracle: {
        kind: 'response-evidence',
        verifier: 'review-completion-adapter',
        scope: ['response'],
        evidenceKinds: ['response-evidence'],
      },
      externalBoundaryRefs: [],
    }],
  })).orientation;
  assert.throws(
    () => service.build(validInput({ orientation: reviewOrientation })),
    /coding-kernel-task-contract:orientation-mode-mismatch/u,
  );

  const contract = service.build(validInput());
  assert.throws(
    () => service.snapshot({ ...contract, version: 'spoofed/v1' }),
    /coding-kernel-task-contract:unsupported-version/u,
  );
  assert.throws(
    () => service.snapshot({ ...contract, scope: undefined }),
    /coding-kernel-task-contract:invalid-shape/u,
  );
});

test('all product Surfaces resolve through the same TaskContractPort semantics', () => {
  const prompt = 'Fix src/value.ts and run the relevant tests.';
  const contracts = ['vscode', 'cli', 'headless'].map(surface => (
    resolveCodingKernelTaskContract({
      prompt,
      surface,
      modeHint: 'change',
      confirmedWorkspaceMutation: true,
      targetPaths: ['src/value.ts'],
      targetPathsAuthoritative: true,
      deliverableKinds: ['source-change', 'verification-result'],
      verificationRequired: true,
      verificationRequirementAuthoritative: true,
    })
  ));

  for (const contract of contracts) {
    assert.equal(contract.version, CODING_KERNEL_TASK_CONTRACT_VERSION);
    assert.equal(contract.mode, 'change');
    assert.equal(contract.orientation.mode, 'change');
    assert.deepEqual(contract.scope.include, ['src/value.ts']);
    assert.equal(Object.isFrozen(contract), true);
  }
  assert.deepEqual(
    contracts.map(contract => ({
      goal: contract.goal,
      mode: contract.mode,
      scope: contract.scope,
      deliverables: contract.deliverables,
      constraints: contract.constraints,
      acceptance: contract.acceptance,
    })),
    Array(3).fill({
      goal: contracts[0].goal,
      mode: contracts[0].mode,
      scope: contracts[0].scope,
      deliverables: contracts[0].deliverables,
      constraints: contracts[0].constraints,
      acceptance: contracts[0].acceptance,
    }),
  );
});
