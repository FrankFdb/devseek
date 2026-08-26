import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanonicalVerificationService,
  buildCodingVerificationPlan,
  resolveCodingKernelTaskContract,
} from '../dist/index.js';

function plan(overrides = {}) {
  return buildCodingVerificationPlan({
    runId: 'verify-run-1',
    sequence: 1,
    actionId: 'verify-1',
    idempotencyKey: 'verify-run-1:verify-1',
    scopePaths: ['src/value.ts'],
    acceptance: [
      { id: 'builds', statement: 'Project builds' },
      { id: 'behavior', statement: 'Output is correct' },
    ],
    payload: { workspaceRoot: '/workspace' },
    evidenceRefs: ['mutation:committed'],
    ...overrides,
  });
}

function host(checks) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async verify() {
      calls++;
      return { verifier: 'project-verifier', checks, evidenceRefs: ['verifier:selected'] };
    },
  };
}

test('CanonicalVerificationService passes only evidence-backed complete acceptance coverage', async () => {
  const capability = host([
    {
      checkId: 'build',
      status: 'passed',
      acceptanceIds: ['builds'],
      summary: 'build passed',
      exitCode: 0,
      evidenceRefs: ['build:exit-0'],
    },
    {
      checkId: 'runtime',
      status: 'passed',
      acceptanceIds: ['behavior'],
      summary: 'runtime output matched',
      exitCode: 0,
      evidenceRefs: ['runtime:output-match'],
    },
  ]);
  const service = new CanonicalVerificationService();
  const first = await service.verify(plan(), capability);
  const replay = await service.verify(plan(), capability);

  assert.equal(first.receipt.status, 'passed');
  assert.deepEqual(first.receipt.acceptance.map(item => item.status), ['passed', 'passed']);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt, first.receipt);
  assert.equal(capability.calls, 1);
});

test('CanonicalVerificationService reports unverified instead of passing without a verifier', async () => {
  const outcome = await new CanonicalVerificationService().verify(plan(), host([]));

  assert.equal(outcome.receipt.status, 'unverified');
  assert.equal(outcome.receipt.errorCode, 'verification-acceptance-uncovered');
  assert.deepEqual(outcome.receipt.acceptance.map(item => item.status), ['unverified', 'unverified']);
});

test('CanonicalVerificationService fails when any acceptance check fails', async () => {
  const outcome = await new CanonicalVerificationService().verify(plan(), host([{
    checkId: 'build',
    status: 'failed',
    acceptanceIds: ['builds'],
    summary: 'compiler failed',
    exitCode: 1,
    evidenceRefs: ['build:exit-1'],
  }]));

  assert.equal(outcome.receipt.status, 'failed');
  assert.equal(outcome.receipt.acceptance[0].status, 'failed');
  assert.equal(outcome.receipt.acceptance[1].status, 'unverified');
});

test('CanonicalVerificationService treats host errors and evidence-free pass claims as indeterminate', async () => {
  const throwing = { async verify() { throw new Error('runner crashed'); } };
  const hostError = await new CanonicalVerificationService().verify(plan(), throwing);
  const falsePass = await new CanonicalVerificationService().verify(plan(), host([{
    checkId: 'build',
    status: 'passed',
    acceptanceIds: ['builds'],
    summary: 'claimed pass',
    evidenceRefs: [],
  }]));

  assert.equal(hostError.receipt.status, 'indeterminate');
  assert.equal(falsePass.receipt.status, 'indeterminate');
});

test('Verification plans reject duplicate acceptance and conflicting action identity', async () => {
  assert.throws(
    () => plan({ acceptance: [{ id: 'same', statement: 'one' }, { id: 'same', statement: 'two' }] }),
    /coding-verification:duplicate-acceptance-id/,
  );
  const service = new CanonicalVerificationService();
  const capability = host([]);
  await service.verify(plan(), capability);
  await assert.rejects(
    service.verify(plan({ payload: { workspaceRoot: '/different' } }), capability),
    /coding-verification:conflicting-action-identity/,
  );
});

test('bound verification sessions reject foreign runs and drifted acceptance contracts', async () => {
  const service = new CanonicalVerificationService();
  const session = service.bind({
    runId: 'verify-run-1',
    acceptance: [
      { id: 'builds', statement: 'Project builds' },
      { id: 'behavior', statement: 'Output is correct' },
    ],
  });
  const capability = host([
    {
      checkId: 'build',
      status: 'passed',
      acceptanceIds: ['builds'],
      summary: 'build passed',
      evidenceRefs: ['build:exit-0'],
    },
    {
      checkId: 'runtime',
      status: 'passed',
      acceptanceIds: ['behavior'],
      summary: 'runtime output matched',
      evidenceRefs: ['runtime:output-match'],
    },
  ]);

  await assert.rejects(
    session.verify(plan({ runId: 'foreign-run' }), capability),
    /coding-verification:session-run-mismatch/,
  );
  await assert.rejects(
    session.verify(plan({
      acceptance: [
        { id: 'builds', statement: 'Project builds differently' },
        { id: 'behavior', statement: 'Output is correct' },
      ],
    }), capability),
    /coding-verification:session-acceptance-mismatch/,
  );
  assert.deepEqual(session.receipts(), []);

  const first = await session.verify(plan(), capability);
  const replay = await session.verify(plan(), capability);
  assert.equal(first.receipt.status, 'passed');
  assert.equal(replay.replayed, true);
  assert.deepEqual(session.receipts(), [first.receipt]);
  assert.equal(capability.calls, 1);
});

test('bound verification survives provenance-only review and expires after a later overlapping mutation', async () => {
  let current = resolveCodingKernelTaskContract({
    prompt: 'Implement and verify src/value.ts',
    surface: 'vscode',
    modeHint: 'change',
    targetPaths: ['src/value.ts'],
    targetPathsAuthoritative: true,
    deliverableKinds: ['source-change', 'verification-result'],
    confirmedWorkspaceMutation: true,
    verificationRequired: true,
    verificationRequirementAuthoritative: true,
  });
  const acceptance = current.acceptance
    .filter(criterion => criterion.oracle.kind === 'verification')
    .map(criterion => ({ id: criterion.id, statement: criterion.statement }));
  const mutations = [];
  const session = new CanonicalVerificationService().bind({
    runId: 'verify-run-1',
    acceptance,
    taskContractSource: { current: () => current },
    mutationSource: { receipts: () => mutations },
  });
  const capability = host([{
    checkId: 'project-test',
    status: 'passed',
    acceptanceIds: acceptance.map(criterion => criterion.id),
    summary: 'project test passed',
    exitCode: 0,
    evidenceRefs: ['project-test:exit-0'],
  }]);
  const verification = await session.verify(plan({
    sequence: 10,
    acceptance,
  }), capability);

  current = {
    ...current,
    provenanceRefs: [...current.provenanceRefs, 'settled-read:src/value.ts'],
  };
  assert.deepEqual(session.receipts(), [verification.receipt]);

  mutations.push({
    version: 'devseek.coding-workspace-mutation-receipt/v1',
    runId: 'verify-run-1',
    sequence: 11,
    actionId: 'write-unrelated-notes',
    idempotencyKey: 'verify-run-1:write-unrelated-notes',
    status: 'committed',
    paths: ['docs/notes.md'],
    baselineRef: 'baseline:notes',
    readbackRef: 'readback:notes',
    evidenceRefs: ['workspace-mutation:notes:committed'],
  });
  assert.deepEqual(session.receipts(), [verification.receipt]);

  mutations.push({
    version: 'devseek.coding-workspace-mutation-receipt/v1',
    runId: 'verify-run-1',
    sequence: 12,
    actionId: 'rewrite-value-after-verification',
    idempotencyKey: 'verify-run-1:rewrite-value-after-verification',
    status: 'committed',
    paths: ['src/value.ts'],
    baselineRef: 'baseline:value',
    readbackRef: 'readback:value',
    evidenceRefs: ['workspace-mutation:value:committed'],
  });
  assert.deepEqual(session.receipts(), []);
});
