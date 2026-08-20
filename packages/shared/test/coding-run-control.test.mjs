import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CanonicalRunControlService,
  CodingRunCancelledError,
} from '../dist/index.js';

test('I22-CAN-01 user journey: cancellation freezes effects until in-flight work is reconciled', () => {
  const session = new CanonicalRunControlService().bind({ runId: 'cancel-run' });
  const lease = session.beginEffect('workspace-mutation:write-a');
  assert.throws(
    () => session.beginEffect('workspace-mutation:write-a'),
    /duplicate-in-flight-effect/,
  );

  const accepted = session.cancel({
    requestId: 'cancel-1',
    reason: 'user-cancelled',
    source: 'test-surface',
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.effectsFrozen, true);
  assert.deepEqual(accepted.inFlightEffectIds, ['workspace-mutation:write-a']);
  assert.equal(session.signal.aborted, true);
  assert.throws(
    () => session.beginEffect('external-effect:publish'),
    error => error instanceof CodingRunCancelledError
      && error.message === 'coding-run-control:effect-frozen:external-effect:publish',
  );
  assert.throws(
    () => session.settle('cancelled'),
    /in-flight-effects-not-reconciled/,
  );

  lease.release();
  const duplicate = session.cancel({
    requestId: 'cancel-2',
    reason: 'duplicate-user-cancel',
    source: 'test-surface',
  });
  assert.equal(duplicate.status, 'already-cancelling');
  assert.equal(session.settle('cancelled').terminalStatus, 'cancelled');
  assert.throws(
    () => session.cancel({
      requestId: 'cancel-after-settlement',
      reason: 'late-user-cancel',
      source: 'test-surface',
    }),
    /run-already-settled/,
  );
});

test('I22-STR-01 user journey: steering is idempotent and invalidates stale model actions', () => {
  const queued = [
    { steeringId: 'steer-one', instruction: '  Continue, but do not create files.  ' },
    { steeringId: 'steer-one', instruction: 'Continue, but do not create files.' },
    'Focus validation on the parser boundary.',
  ];
  const session = new CanonicalRunControlService().bind({
    runId: 'steer-run',
    steeringSource: { drain: () => queued.splice(0) },
  });

  const decisions = session.consumeSteering();
  assert.deepEqual(decisions.map(decision => decision.receipt.status), ['accepted', 'accepted']);
  assert.deepEqual(decisions.map(decision => decision.receipt.invalidatesPendingActions), [true, true]);
  assert.deepEqual(decisions.map(decision => decision.receipt.requiresModelReinterpretation), [true, true]);
  assert.deepEqual(session.steeringReceipts().map(receipt => receipt.status), [
    'accepted',
    'duplicate',
    'accepted',
  ]);
  assert.equal(JSON.stringify(session.steeringReceipts()).includes('parser boundary'), false);
});

test('steering receipts never infer authority from wording, language, typos, or identifiers', () => {
  const queued = [
    '停止写入。',
    'Do not create any files.',
    '先别写了，我打错了，只说明 GPU CPU。',
    'MODEL_LATEST_OK contest_result happy_value',
    '只允许修改 src/，不得修改 tests/ 或 package.json。',
  ];
  const session = new CanonicalRunControlService().bind({
    runId: 'wording-neutral-steer-run',
    steeringSource: { drain: () => queued.splice(0) },
  });

  const decisions = session.consumeSteering();
  assert.equal(decisions.length, 5);
  for (const decision of decisions) {
    assert.equal(decision.receipt.invalidatesPendingActions, true);
    assert.equal(decision.receipt.requiresModelReinterpretation, true);
    assert.equal('writePolicy' in decision.receipt, false);
  }
});

test('SteeringPort fails closed when one steering identity changes meaning', () => {
  const queued = [
    { steeringId: 'stable-steer', instruction: 'Inspect only.' },
    { steeringId: 'stable-steer', instruction: 'Publish the result.' },
  ];
  const session = new CanonicalRunControlService().bind({
    runId: 'conflicting-steer-run',
    steeringSource: { drain: () => queued.splice(0) },
  });

  assert.throws(() => session.consumeSteering(), /conflicting-steering-id/);
  assert.deepEqual(session.steeringReceipts().map(receipt => receipt.status), ['accepted']);
});

test('completion fence closes surface intake, preserves order, and can reopen the same run', () => {
  const queued = [{ steeringId: 'late-1', instruction: 'Preserve the public API.' }];
  let surfaceOpen = true;
  const source = {
    drain: () => surfaceOpen ? queued.splice(0) : [],
    closeAndDrain: () => {
      surfaceOpen = false;
      return queued.splice(0);
    },
    reopen: () => {
      surfaceOpen = true;
      return true;
    },
  };
  const session = new CanonicalRunControlService().bind({ runId: 'fenced-steer-run', steeringSource: source });

  const fenced = session.closeSteeringIntake();
  assert.deepEqual(fenced.map(decision => decision.instruction), ['Preserve the public API.']);
  queued.push({ steeringId: 'blocked-while-closed', instruction: 'This is not surface-accepted.' });
  assert.deepEqual(session.consumeSteering(), []);
  assert.equal(session.reopenSteeringIntake(), true);
  assert.deepEqual(session.consumeSteering().map(decision => decision.receipt.steeringId), ['blocked-while-closed']);
});

test('external AbortSignal enters the same cancellation saga before runtime work begins', () => {
  const controller = new AbortController();
  const session = new CanonicalRunControlService().bind({
    runId: 'external-cancel-run',
    signal: controller.signal,
  });
  controller.abort('sigterm');

  assert.equal(session.cancellationRequested(), true);
  assert.equal(session.cancellationReceipts().length, 1);
  assert.equal(session.cancellationReceipts()[0].source, 'kernel-request-signal');
  assert.throws(() => session.settle('failed'), /cancellation-terminal-mismatch/);
});
