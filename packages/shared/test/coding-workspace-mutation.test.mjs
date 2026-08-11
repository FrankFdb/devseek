import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanonicalWorkspaceMutationTransaction,
  InMemoryCodingOperationJournal,
  buildCodingWorkspaceMutationPlan,
  codingWorkspaceMutationOperationSha256,
} from '../dist/index.js';

function plan(overrides = {}) {
  return buildCodingWorkspaceMutationPlan({
    runId: 'mutation-run-1',
    sequence: 1,
    actionId: 'write-1',
    idempotencyKey: 'mutation-run-1:write-1',
    paths: ['src/value.ts'],
    payload: { content: 'export const value = 1;' },
    evidenceRefs: ['plan:write-1'],
    ...overrides,
  });
}

function host({
  readbackMatches = true,
  applyThrows = false,
  applyRejectsUnchanged = false,
  applyRejectionDetail,
  rollbackSucceeds = true,
} = {}) {
  const calls = [];
  return {
    calls,
    async captureBaseline() {
      calls.push('baseline');
      return {
        baselineRef: 'baseline:src/value.ts:v0',
        state: { existed: false },
        evidenceRefs: ['baseline:captured'],
      };
    },
    async apply() {
      calls.push('apply');
      if (applyThrows) throw new Error('disk changed after partial apply');
      if (applyRejectsUnchanged) {
        return {
          status: 'rejected',
          mutationState: 'unchanged',
          errorCode: 'workspace-baseline-changed',
          ...(applyRejectionDetail ? { errorDetail: applyRejectionDetail } : {}),
          evidenceRefs: ['baseline:changed'],
        };
      }
      return {
        status: 'applied',
        applied: {
          state: { expected: 'export const value = 1;' },
          result: ['src/value.ts'],
          evidenceRefs: ['apply:staged-and-renamed'],
        },
      };
    },
    async readback() {
      calls.push('readback');
      return {
        matches: readbackMatches,
        readbackRef: 'readback:src/value.ts:v1',
        evidenceRefs: ['readback:captured'],
      };
    },
    async rollback(_plan, _baseline, _applied, cause) {
      calls.push(`rollback:${cause}`);
      return {
        rolledBack: rollbackSucceeds,
        ...(rollbackSucceeds ? { rollbackRef: 'rollback:src/value.ts:v0' } : {}),
        evidenceRefs: ['rollback:attempted'],
      };
    },
  };
}

test('CanonicalWorkspaceMutationTransaction commits only after baseline, apply, and matching readback', async () => {
  const capability = host();
  const transaction = new CanonicalWorkspaceMutationTransaction();
  const first = await transaction.execute(plan(), capability);
  const replay = await transaction.execute(plan(), capability);

  assert.deepEqual(capability.calls, ['baseline', 'apply', 'readback']);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt, first.receipt);
  assert.equal(first.receipt.status, 'committed');
  assert.equal(first.receipt.baselineRef, 'baseline:src/value.ts:v0');
  assert.equal(first.receipt.readbackRef, 'readback:src/value.ts:v1');
  assert.deepEqual(first.receipt.result, ['src/value.ts']);
  assert.equal(Object.isFrozen(first.receipt), true);
});

test('CanonicalWorkspaceMutationTransaction rolls back a readback mismatch', async () => {
  const capability = host({ readbackMatches: false });
  const outcome = await new CanonicalWorkspaceMutationTransaction().execute(plan(), capability);

  assert.deepEqual(capability.calls, [
    'baseline',
    'apply',
    'readback',
    'rollback:readback-mismatch',
  ]);
  assert.equal(outcome.receipt.status, 'rolled-back');
  assert.equal(outcome.receipt.errorCode, 'readback-mismatch');
  assert.equal(outcome.receipt.rollbackRef, 'rollback:src/value.ts:v0');
});

test('CanonicalWorkspaceMutationTransaction rolls back an uncertain partial apply', async () => {
  const capability = host({ applyThrows: true });
  const outcome = await new CanonicalWorkspaceMutationTransaction().execute(plan(), capability);

  assert.deepEqual(capability.calls, ['baseline', 'apply', 'rollback:apply-failed']);
  assert.equal(outcome.receipt.status, 'rolled-back');
  assert.equal(outcome.receipt.errorCode, 'apply-failed');
});

test('CanonicalWorkspaceMutationTransaction does not roll back a proven unchanged rejection', async () => {
  const capability = host({
    applyRejectsUnchanged: true,
    applyRejectionDetail: '  Line 1\ncontains a collapsed directive.  ',
  });
  const outcome = await new CanonicalWorkspaceMutationTransaction().execute(plan(), capability);

  assert.deepEqual(capability.calls, ['baseline', 'apply']);
  assert.equal(outcome.receipt.status, 'failed');
  assert.equal(outcome.receipt.errorCode, 'workspace-baseline-changed');
  assert.equal(outcome.receipt.errorDetail, 'Line 1 contains a collapsed directive.');
  assert.equal(outcome.receipt.rollbackRef, undefined);
});

test('CanonicalWorkspaceMutationTransaction reports indeterminate when rollback cannot be proven', async () => {
  const capability = host({ readbackMatches: false, rollbackSucceeds: false });
  const outcome = await new CanonicalWorkspaceMutationTransaction().execute(plan(), capability);

  assert.equal(outcome.receipt.status, 'indeterminate');
  assert.equal(outcome.receipt.errorCode, 'readback-mismatch');
  assert.equal(outcome.receipt.rollbackRef, undefined);
  assert.equal(outcome.receipt.evidenceRefs.includes('mutation-rollback:write-1:indeterminate'), true);
});

test('CanonicalWorkspaceMutationTransaction journal replays across instances without host effects', async () => {
  const journal = new InMemoryCodingOperationJournal();
  const capability = host();
  await new CanonicalWorkspaceMutationTransaction(journal).execute(plan(), capability);
  const replay = await new CanonicalWorkspaceMutationTransaction(journal).execute(plan(), capability);

  assert.deepEqual(capability.calls, ['baseline', 'apply', 'readback']);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.status, 'committed');
});

test('Workspace mutation plans reject path escape and conflicting action identity', async () => {
  assert.throws(
    () => plan({ paths: ['../outside.ts'] }),
    /coding-workspace-mutation:unsafe-path/,
  );
  const transaction = new CanonicalWorkspaceMutationTransaction();
  const capability = host();
  await transaction.execute(plan(), capability);
  await assert.rejects(
    transaction.execute(plan({ payload: { content: 'different' } }), capability),
    /coding-workspace-mutation:conflicting-action-identity/,
  );
});

async function prepareInterruptedMutation(journal, originPlan, baseline) {
  await journal.prepare({
    kind: 'workspace-mutation',
    runId: originPlan.runId,
    actionId: originPlan.actionId,
    operationSha256: codingWorkspaceMutationOperationSha256(originPlan),
    preparation: { plan: originPlan, baseline },
  });
}

test('workspace recovery proves a committed postcondition without applying twice', async () => {
  const journal = new InMemoryCodingOperationJournal();
  const origin = plan();
  const baseline = {
    baselineRef: 'baseline:src/value.ts:v0',
    state: { content: '' },
    evidenceRefs: ['baseline:captured'],
  };
  await prepareInterruptedMutation(journal, origin, baseline);
  const calls = [];
  const recoveryHost = {
    async reconcile() {
      calls.push('reconcile');
      return {
        status: 'committed',
        result: ['src/value.ts'],
        readbackRef: 'readback:recovered',
        evidenceRefs: ['workspace:desired-content-present'],
      };
    },
    async captureBaseline() { throw new Error('must not recapture'); },
    async apply() { calls.push('apply'); throw new Error('must not apply twice'); },
    async readback() { throw new Error('must not read back through apply path'); },
    async rollback() { throw new Error('must not roll back'); },
  };
  const resumedPlan = plan({ runId: 'mutation-run-2', idempotencyKey: 'mutation-run-2:write-1' });
  const outcome = await new CanonicalWorkspaceMutationTransaction(
    journal,
    origin.runId,
  ).execute(resumedPlan, recoveryHost);

  assert.deepEqual(calls, ['reconcile']);
  assert.equal(outcome.replayed, true);
  assert.equal(outcome.receipt.status, 'committed');
  assert.equal(outcome.receipt.readbackRef, 'readback:recovered');
});

test('workspace recovery retries only a proven not-started operation', async () => {
  const journal = new InMemoryCodingOperationJournal();
  const origin = plan();
  const baseline = {
    baselineRef: 'baseline:src/value.ts:v0',
    state: { content: '' },
    evidenceRefs: ['baseline:captured'],
  };
  await prepareInterruptedMutation(journal, origin, baseline);
  const capability = host();
  capability.reconcile = async () => {
    capability.calls.push('reconcile');
    return { status: 'not-started', evidenceRefs: ['workspace:baseline-still-current'] };
  };
  const resumedPlan = plan({ runId: 'mutation-run-2', idempotencyKey: 'mutation-run-2:write-1' });
  const outcome = await new CanonicalWorkspaceMutationTransaction(
    journal,
    origin.runId,
  ).execute(resumedPlan, capability);

  assert.deepEqual(capability.calls, ['reconcile', 'apply', 'readback']);
  assert.equal(outcome.receipt.status, 'committed');
});

test('workspace recovery does not apply when the resumed journal cannot record intent', async () => {
  const backingJournal = new InMemoryCodingOperationJournal();
  const origin = plan();
  const baseline = {
    baselineRef: 'baseline:src/value.ts:v0',
    state: { content: '' },
    evidenceRefs: ['baseline:captured'],
  };
  await prepareInterruptedMutation(backingJournal, origin, baseline);
  const resumedPlan = plan({ runId: 'mutation-run-2', idempotencyKey: 'mutation-run-2:write-1' });
  const journal = {
    load: (...args) => backingJournal.load(...args),
    prepare: async input => {
      if (input.runId === resumedPlan.runId) throw new Error('journal unavailable');
      return backingJournal.prepare(input);
    },
    settle: input => backingJournal.settle(input),
  };
  const capability = host();
  capability.reconcile = async () => {
    capability.calls.push('reconcile');
    return { status: 'not-started', evidenceRefs: ['workspace:baseline-still-current'] };
  };

  const outcome = await new CanonicalWorkspaceMutationTransaction(
    journal,
    origin.runId,
  ).execute(resumedPlan, capability);

  assert.deepEqual(capability.calls, ['reconcile']);
  assert.equal(outcome.replayed, true);
  assert.equal(outcome.receipt.status, 'failed');
  assert.equal(outcome.receipt.errorCode, 'mutation-preparation-journal-failed');
});

test('workspace recovery fails closed on post-crash drift', async () => {
  const journal = new InMemoryCodingOperationJournal();
  const origin = plan();
  const baseline = {
    baselineRef: 'baseline:src/value.ts:v0',
    state: { content: '' },
    evidenceRefs: ['baseline:captured'],
  };
  await prepareInterruptedMutation(journal, origin, baseline);
  let applyCalls = 0;
  const outcome = await new CanonicalWorkspaceMutationTransaction(
    journal,
    origin.runId,
  ).execute(
    plan({ runId: 'mutation-run-2', idempotencyKey: 'mutation-run-2:write-1' }),
    {
      async reconcile() {
        return { status: 'indeterminate', evidenceRefs: ['workspace:unexpected-drift'] };
      },
      async captureBaseline() { throw new Error('must not recapture'); },
      async apply() { applyCalls++; throw new Error('must not overwrite drift'); },
      async readback() { throw new Error('must not read back'); },
      async rollback() { throw new Error('must not roll back'); },
    },
  );

  assert.equal(applyCalls, 0);
  assert.equal(outcome.receipt.status, 'indeterminate');
  assert.equal(outcome.receipt.errorCode, 'reconciliation-indeterminate');
});
