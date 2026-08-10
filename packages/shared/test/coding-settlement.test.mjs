import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_SETTLEMENT_DECISION_VERSION,
  CanonicalCompletionDecisionService,
  CanonicalRunLifecycleService,
  CanonicalSettlementDecisionService,
} from '../dist/index.js';

function lifecycle(status) {
  const session = new CanonicalRunLifecycleService().start({
    runId: `run-${status}`,
    surface: 'headless',
  });
  if (status === 'cancelled') {
    session.settle(status);
  } else {
    session.beginExecution();
    session.settle(status);
  }
  return session.snapshot();
}

function completion(status, overrides = {}) {
  return new CanonicalCompletionDecisionService().decide({
    runId: overrides.runId ?? `run-${status}`,
    decisionId: 'kernel-completion',
    idempotencyKey: `${overrides.runId ?? `run-${status}`}:kernel-completion`,
    acceptance: [],
    verificationRequired: false,
    reviewRequired: false,
    ...(status === 'failed' || status === 'cancelled' ? { requestedTerminalStatus: status } : {}),
    toolExecutions: [],
    mutations: [],
    verifications: [],
    acceptanceEvidence: [],
    pendingRefs: status === 'blocked' ? [' pending '] : [],
    adverseEvidenceRefs: [],
    residualRisks: overrides.residualRisks ?? [],
    evidenceRefs: overrides.evidenceRefs ?? [`${status}:evidence`],
  });
}

test('CanonicalSettlementDecisionService preserves a terminal lifecycle and immutable evidence', () => {
  const decision = new CanonicalSettlementDecisionService().decide({
    lifecycle: lifecycle('completed'),
    completion: completion('completed', {
      evidenceRefs: [' test:passed ', 'test:passed'],
      residualRisks: [' none '],
    }),
  });

  assert.equal(decision.version, CODING_SETTLEMENT_DECISION_VERSION);
  assert.equal(decision.status, 'completed');
  assert.equal(decision.lifecycleSequence, 3);
  assert.deepEqual(decision.evidenceRefs, ['test:passed']);
  assert.deepEqual(decision.residualRisks, ['none']);
  assert.deepEqual(decision.reasonCodes, [
    'canonical-lifecycle-terminal',
    'canonical-completion-bound',
  ]);
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.evidenceRefs), true);
});

test('CanonicalSettlementDecisionService never remaps blocked, failed, or cancelled terminals', () => {
  const service = new CanonicalSettlementDecisionService();
  for (const status of ['blocked', 'failed', 'cancelled']) {
    assert.equal(service.decide({ lifecycle: lifecycle(status), completion: completion(status) }).status, status);
  }
});

test('CanonicalSettlementDecisionService rejects non-terminal and mismatched decisions', () => {
  const active = new CanonicalRunLifecycleService().start({ runId: 'active', surface: 'cli' }).snapshot();
  const service = new CanonicalSettlementDecisionService();
  assert.throws(
    () => service.decide({ lifecycle: active, completion: completion('failed', { runId: 'active' }) }),
    /coding-settlement:non-terminal-lifecycle/u,
  );
  assert.throws(
    () => service.decide({
      lifecycle: lifecycle('blocked'),
      completion: completion('failed', { runId: 'run-blocked' }),
    }),
    /coding-settlement:terminal-mismatch:blocked:failed/u,
  );
});
