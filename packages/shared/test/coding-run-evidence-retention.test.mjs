import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODING_RUN_LIFECYCLE_EVIDENCE_SCHEMA,
  CanonicalRunEvidenceRetentionService,
  CanonicalRunLifecycleService,
} from '../dist/index.js';

function completedLifecycle(runId = 'run-retained') {
  const lifecycle = new CanonicalRunLifecycleService().start({ runId, surface: 'headless' });
  lifecycle.beginExecution();
  lifecycle.settle('completed');
  return lifecycle.snapshot();
}

test('RunEvidenceRetentionPort writes every canonical lifecycle transition once', () => {
  const records = [];
  const session = {
    record(input) {
      records.push(input);
      return { event: { sequence: records.length } };
    },
  };
  const retention = new CanonicalRunEvidenceRetentionService('run-retained', session);

  const receipts = retention.retainLifecycle(completedLifecycle());

  assert.equal(receipts.length, 3);
  assert.deepEqual(records.map(record => record.payload.status), ['accepted', 'running', 'completed']);
  assert.equal(records.every(record => record.type === 'agent.status'), true);
  assert.equal(records.every(record => record.payload.schema === CODING_RUN_LIFECYCLE_EVIDENCE_SCHEMA), true);
  assert.equal(records.at(-1).payload.terminal, true);
  assert.equal(new Set(records.map(record => record.idempotencyKey)).size, records.length);
});

test('RunEvidenceRetentionPort rejects cross-run and forged lifecycle evidence before append', () => {
  const records = [];
  const retention = new CanonicalRunEvidenceRetentionService('run-retained', {
    record(input) {
      records.push(input);
      return {};
    },
  });

  assert.throws(
    () => retention.retainLifecycle(completedLifecycle('different-run')),
    /run-id-mismatch/u,
  );

  const forged = structuredClone(completedLifecycle());
  forged.events[1].from = 'waiting-user';
  assert.throws(
    () => retention.retainLifecycle(forged),
    /event-binding-2/u,
  );
  assert.deepEqual(records, []);
});
