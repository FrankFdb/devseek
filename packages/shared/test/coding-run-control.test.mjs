import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CanonicalRunControlService,
  CodingRunCancelledError,
  codingSteeringRevokesWrites,
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

test('I22-STR-01 user journey: steering is idempotent and can revoke write authority', () => {
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
  assert.deepEqual(decisions.map(decision => decision.receipt.writePolicy), ['revoke', 'unchanged']);
  assert.deepEqual(session.steeringReceipts().map(receipt => receipt.status), [
    'accepted',
    'duplicate',
    'accepted',
  ]);
  assert.equal(JSON.stringify(session.steeringReceipts()).includes('parser boundary'), false);
  assert.equal(codingSteeringRevokesWrites('停止写入。'), true);
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
