import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODING_VERIFICATION_RECEIPT_VERSION,
  CanonicalDiagnosticService,
  CanonicalRepairDecisionService,
  decideClosedLoopRepairability,
  decideRunBudgetPolicy,
  extendRepairRoundBudget,
  normalizeRepairRoundBudget,
} from '../dist/index.js';

function verificationReceipt(overrides = {}) {
  return {
    version: CODING_VERIFICATION_RECEIPT_VERSION,
    runId: 'run-diagnostic',
    sequence: 2,
    actionId: 'verify-2',
    idempotencyKey: 'run-diagnostic:verify-2',
    verifier: 'project-verification',
    status: 'failed',
    scopePaths: ['src/value.ts'],
    checks: [{
      checkId: 'typecheck',
      status: 'failed',
      acceptanceIds: ['verified'],
      summary: 'src/value.ts:12: Type error: string is not assignable to number',
      command: 'npm run typecheck',
      exitCode: 2,
      evidenceRefs: ['process:typecheck:exit-2'],
    }],
    acceptance: [{
      criterionId: 'verified',
      status: 'failed',
      evidenceRefs: ['process:typecheck:exit-2'],
    }],
    evidenceRefs: ['process:typecheck:exit-2'],
    ...overrides,
  };
}

test('I19-DGN-01 user journey: verifier failure becomes a stable path-bound diagnosis', () => {
  const diagnostics = new CanonicalDiagnosticService().bind({ runId: 'run-diagnostic' });
  const decision = diagnostics.normalizeVerification(verificationReceipt());

  assert.equal(decision.status, 'diagnosed');
  assert.equal(decision.diagnostics[0].category, 'typecheck');
  assert.equal(decision.diagnostics[0].rootCauseLayer, 'implementation');
  assert.equal(decision.diagnostics[0].disposition, 'repair');
  assert.deepEqual(decision.diagnostics[0].affectedPaths, ['src/value.ts']);
  assert.match(decision.diagnostics[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(diagnostics.normalizeVerification(verificationReceipt()), decision);
});

test('C9 diagnostic keeps rate limiter compile failures in the implementation layer', () => {
  const diagnostics = new CanonicalDiagnosticService().bind({ runId: 'run-rate-limiter-diagnostic' });
  const decision = diagnostics.normalizeVerification(verificationReceipt({
    runId: 'run-rate-limiter-diagnostic',
    checks: [{
      checkId: 'build',
      status: 'failed',
      acceptanceIds: ['verified'],
      summary: 'src/rate_limiter.cpp:42: rate limiter implementation failed to compile',
      command: 'cmake --build build',
      exitCode: 2,
      evidenceRefs: ['process:build:exit-2'],
    }],
  }));

  assert.equal(decision.diagnostics[0].category, 'build');
  assert.equal(decision.diagnostics[0].rootCauseLayer, 'implementation');
  assert.equal(decision.diagnostics[0].transient, false);
});

test('C9 diagnostic normalization fails closed for indeterminate verification', () => {
  const diagnostics = new CanonicalDiagnosticService().bind({ runId: 'run-diagnostic' });
  const decision = diagnostics.normalizeVerification(verificationReceipt({
    status: 'indeterminate',
    checks: [],
    errorCode: 'verification-mutated-user-workspace',
  }));

  assert.equal(decision.status, 'indeterminate');
  assert.equal(decision.diagnostics[0].disposition, 'blocked');
});

test('C9 repair decisions retry new evidence, replan one stagnant result, then stop', () => {
  const diagnostics = new CanonicalDiagnosticService().bind({ runId: 'run-diagnostic' });
  const repair = new CanonicalRepairDecisionService().bind({ runId: 'run-diagnostic' });
  const firstDiagnostic = diagnostics.normalizeVerification(verificationReceipt());
  const first = repair.decide({
    sequence: 2,
    actionId: 'repair-2',
    diagnostic: firstDiagnostic,
    mutationAllowed: true,
    canContinue: true,
    attempt: 1,
    maxAttempts: 4,
    mutationFingerprint: 'patch-a',
    evidenceRefs: ['mutation:patch-a'],
  });
  assert.equal(first.action, 'retry');

  const secondDiagnostic = diagnostics.normalizeVerification(verificationReceipt({
    sequence: 3,
    actionId: 'verify-3',
    idempotencyKey: 'run-diagnostic:verify-3',
  }));
  const second = repair.decide({
    sequence: 3,
    actionId: 'repair-3',
    diagnostic: secondDiagnostic,
    mutationAllowed: true,
    canContinue: true,
    attempt: 2,
    maxAttempts: 4,
    mutationFingerprint: 'patch-b',
    evidenceRefs: ['mutation:patch-b'],
  });
  assert.equal(second.action, 'replan');
  assert.equal(second.rootCauseReplanRequired, true);

  const thirdDiagnostic = diagnostics.normalizeVerification(verificationReceipt({
    sequence: 4,
    actionId: 'verify-4',
    idempotencyKey: 'run-diagnostic:verify-4',
  }));
  const third = repair.decide({
    sequence: 4,
    actionId: 'repair-4',
    diagnostic: thirdDiagnostic,
    mutationAllowed: true,
    canContinue: true,
    attempt: 3,
    maxAttempts: 4,
    mutationFingerprint: 'patch-c',
    evidenceRefs: ['mutation:patch-c'],
  });
  assert.equal(third.action, 'blocked');
  assert.equal(third.reason, 'repeated-diagnostic-no-progress');
});

test('C9 repair decisions stop a repeated mutation without spending another provider turn', () => {
  const diagnostics = new CanonicalDiagnosticService().bind({ runId: 'run-diagnostic' });
  const repair = new CanonicalRepairDecisionService().bind({ runId: 'run-diagnostic' });
  const firstDiagnostic = diagnostics.normalizeVerification(verificationReceipt());
  repair.decide({
    sequence: 2,
    actionId: 'repair-2',
    diagnostic: firstDiagnostic,
    mutationAllowed: true,
    canContinue: true,
    attempt: 1,
    maxAttempts: 4,
    mutationFingerprint: 'same-patch',
    evidenceRefs: [],
  });
  const repeatedDiagnostic = diagnostics.normalizeVerification(verificationReceipt({
    sequence: 3,
    actionId: 'verify-3',
    idempotencyKey: 'run-diagnostic:verify-3',
  }));
  const decision = repair.decide({
    sequence: 3,
    actionId: 'repair-3',
    diagnostic: repeatedDiagnostic,
    mutationAllowed: true,
    canContinue: true,
    attempt: 2,
    maxAttempts: 4,
    mutationFingerprint: 'same-patch',
    evidenceRefs: [],
  });

  assert.equal(decision.action, 'blocked');
  assert.equal(decision.reason, 'repeated-mutation-no-progress');
  assert.equal(decision.mutationFingerprint, 'same-patch');
});

test('C9 repair decisions do not infer mutation identity from general evidence references', () => {
  const diagnostics = new CanonicalDiagnosticService().bind({ runId: 'run-diagnostic' });
  const repair = new CanonicalRepairDecisionService().bind({ runId: 'run-diagnostic' });
  repair.decide({
    sequence: 2,
    actionId: 'repair-2',
    diagnostic: diagnostics.normalizeVerification(verificationReceipt()),
    mutationAllowed: true,
    canContinue: true,
    attempt: 1,
    maxAttempts: 4,
    mutationFingerprint: 'patch-a',
    evidenceRefs: ['mutation-fingerprint:patch-b'],
  });
  const decision = repair.decide({
    sequence: 3,
    actionId: 'repair-3',
    diagnostic: diagnostics.normalizeVerification(verificationReceipt({
      sequence: 3,
      actionId: 'verify-3',
      idempotencyKey: 'run-diagnostic:verify-3',
    })),
    mutationAllowed: true,
    canContinue: true,
    attempt: 2,
    maxAttempts: 4,
    mutationFingerprint: 'patch-b',
    evidenceRefs: [],
  });

  assert.equal(decision.repeatedMutation, false);
  assert.equal(decision.action, 'replan');
});

test('shared repairability and run-budget policies protect validation and explicit continuation', () => {
  assert.deepEqual(decideClosedLoopRepairability({
    applied: true,
    validation: { ran: true, ok: false, status: 'failed', command: 'npm test' },
  }), { repairable: true, reason: 'failed-runnable-validation' });
  assert.equal(normalizeRepairRoundBudget(99), 6);
  assert.equal(extendRepairRoundBudget(6), 9);

  const budget = decideRunBudgetPolicy({
    phases: [
      { phase: 'provider', allocated: 1, used: 2 },
      { phase: 'safety', allocated: 1, used: 0 },
      { phase: 'validation', allocated: 1, used: 0 },
      { phase: 'quality-gate', allocated: 1, used: 0 },
    ],
  });
  assert.equal(budget.authority, 'canonical-run-budget');
  assert.equal(budget.decision, 'replan');
  assert.equal(budget.safetyAndAcceptanceProtected, true);
});
