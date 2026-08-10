import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanonicalCompletionDecisionService,
  CODING_TOOL_RECEIPT_VERSION,
  CODING_VERIFICATION_RECEIPT_VERSION,
} from '../dist/index.js';

function verification(status = 'passed') {
  return {
    version: CODING_VERIFICATION_RECEIPT_VERSION,
    runId: 'completion-run-1',
    sequence: 1,
    actionId: 'verify-1',
    idempotencyKey: 'completion-run-1:verify-1',
    verifier: 'project-verifier',
    status,
    scopePaths: ['src/value.ts'],
    checks: [],
    acceptance: [{
      criterionId: 'builds',
      status: status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'unverified',
      evidenceRefs: status === 'passed' ? ['build:exit-0'] : ['build:not-passed'],
    }],
    evidenceRefs: [status === 'passed' ? 'build:exit-0' : 'build:not-passed'],
  };
}

function input(overrides = {}) {
  return {
    runId: 'completion-run-1',
    decisionId: 'completion-1',
    idempotencyKey: 'completion-run-1:completion-1',
    acceptance: [{ id: 'builds', statement: 'Project builds' }],
    verificationRequired: true,
    reviewRequired: false,
    toolExecutions: [],
    mutations: [],
    verifications: [verification()],
    acceptanceEvidence: [],
    pendingRefs: [],
    adverseEvidenceRefs: [],
    residualRisks: [],
    evidenceRefs: ['task-contract:completion-run-1'],
    ...overrides,
  };
}

function failedVerificationTool(actionId = 'verify-1', sequence = 1) {
  return {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'completion-run-1',
    sequence,
    actionId,
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process'],
    status: 'failed',
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'test-verification',
      evidenceRefs: ['authority:allow'],
    },
    errorCode: 'verification-failed',
    evidenceRefs: [`verification-tool:${actionId}:failed`],
  };
}

function completedVerificationTool(actionId = 'verify-2', sequence = 2) {
  return {
    ...failedVerificationTool(actionId, sequence),
    status: 'completed',
    errorCode: undefined,
    evidenceRefs: [`verification-tool:${actionId}:completed`],
  };
}

test('CanonicalCompletionDecisionService completes only fully evidenced acceptance', () => {
  const service = new CanonicalCompletionDecisionService();
  const first = service.decide(input());
  const replay = service.decide(input());

  assert.equal(first.status, 'completed');
  assert.equal(first.acceptance[0].status, 'passed');
  assert.equal(replay, first);
});

test('CanonicalCompletionDecisionService blocks unverified or missing verification', () => {
  const unverified = new CanonicalCompletionDecisionService().decide(input({
    verifications: [verification('unverified')],
  }));
  const missing = new CanonicalCompletionDecisionService().decide(input({ verifications: [] }));

  assert.equal(unverified.status, 'blocked');
  assert.equal(unverified.reasonCodes.includes('verification-incomplete'), true);
  assert.deepEqual(unverified.acceptance[0].evidenceRefs, ['build:not-passed']);
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.reasonCodes.includes('verification-not-run'), true);
});

test('CanonicalCompletionDecisionService preserves explicit blocked acceptance evidence', () => {
  const decision = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [failedVerificationTool('install-1')].map(receipt => ({
      ...receipt,
      status: 'denied',
      permission: {
        decision: 'deny',
        status: 'denied',
        reason: 'approval-required',
        evidenceRefs: ['permission:install-denied'],
      },
      evidenceRefs: ['permission:install-denied'],
    })),
    verifications: [],
    acceptanceEvidence: [{
      criterionId: 'builds',
      status: 'blocked',
      evidenceRefs: ['permission:install-denied'],
    }],
  }));

  assert.equal(decision.status, 'blocked');
  assert.deepEqual(decision.acceptance, [{
    criterionId: 'builds',
    status: 'blocked',
    evidenceRefs: ['permission:install-denied'],
  }]);
});

test('CanonicalCompletionDecisionService fails verification failure and settled effect failure', () => {
  const verificationFailure = new CanonicalCompletionDecisionService().decide(input({
    verifications: [verification('failed')],
  }));
  const effectFailure = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [{
      version: CODING_TOOL_RECEIPT_VERSION,
      runId: 'completion-run-1',
      sequence: 1,
      actionId: 'tool-1',
      tool: 'run_terminal',
      effects: ['process'],
      status: 'failed',
      permission: {
        decision: 'allow',
        status: 'authorized',
        reason: 'test',
        evidenceRefs: ['authority:allow'],
      },
      errorCode: 'process-exit-1',
      evidenceRefs: ['process:exit-1'],
    }],
  }));

  assert.equal(verificationFailure.status, 'failed');
  assert.equal(effectFailure.status, 'failed');
});

test('CanonicalCompletionDecisionService preserves but does not re-fail resolved verification history', () => {
  const failed = verification('failed');
  const repaired = {
    ...verification('passed'),
    sequence: 2,
    actionId: 'verify-2',
    idempotencyKey: 'completion-run-1:verify-2',
    evidenceRefs: ['repair-build:exit-0'],
    acceptance: [{ criterionId: 'builds', status: 'passed', evidenceRefs: ['repair-build:exit-0'] }],
  };
  const decision = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [failedVerificationTool()],
    verifications: [failed, repaired],
  }));

  assert.equal(decision.status, 'completed');
  assert.equal(decision.evidenceRefs.includes('build:not-passed'), true);
  assert.equal(decision.evidenceRefs.includes('repair-build:exit-0'), true);
});

test('CanonicalCompletionDecisionService requires a later verified tool action to settle a failed check', () => {
  const failedTool = failedVerificationTool('focused-check-1', 1);
  const recoveredTool = completedVerificationTool('focused-check-2', 2);
  const recoveredVerification = {
    ...verification('passed'),
    sequence: 2,
    actionId: recoveredTool.actionId,
    idempotencyKey: `completion-run-1:${recoveredTool.actionId}`,
    evidenceRefs: ['focused-check:exit-0'],
    acceptance: [{ criterionId: 'builds', status: 'passed', evidenceRefs: ['focused-check:exit-0'] }],
  };
  const recovered = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [failedTool, recoveredTool],
    verifications: [recoveredVerification],
  }));
  const unrelatedAutoPass = new CanonicalCompletionDecisionService().decide(input({
    decisionId: 'completion-unrelated-auto-pass',
    idempotencyKey: 'completion-run-1:completion-unrelated-auto-pass',
    toolExecutions: [failedTool],
    verifications: [{
      ...recoveredVerification,
      actionId: 'auto-validation-1',
      idempotencyKey: 'completion-run-1:auto-validation-1',
    }],
  }));

  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.reasonCodes.includes('failed-effect'), false);
  assert.equal(recovered.evidenceRefs.includes('verification-tool:focused-check-1:failed'), true);
  assert.equal(unrelatedAutoPass.status, 'failed');
  assert.equal(unrelatedAutoPass.reasonCodes.includes('failed-effect'), true);
});

test('CanonicalCompletionDecisionService does not let a narrower pass erase a broader failure', () => {
  const failed = {
    ...verification('failed'),
    scopePaths: ['src/value.ts', 'src/other.ts'],
  };
  const narrowerPass = {
    ...verification('passed'),
    sequence: 2,
    actionId: 'verify-2',
    idempotencyKey: 'completion-run-1:verify-2',
  };
  const decision = new CanonicalCompletionDecisionService().decide(input({
    verifications: [failed, narrowerPass],
  }));

  assert.equal(decision.status, 'failed');
  assert.equal(decision.reasonCodes.includes('verification-failed'), true);
});

test('CanonicalCompletionDecisionService rejects receipts from another run', () => {
  const foreignVerification = { ...verification(), runId: 'foreign-run' };
  const foreignTool = { ...failedVerificationTool(), runId: 'foreign-run' };
  const service = new CanonicalCompletionDecisionService();

  assert.throws(
    () => service.decide(input({ verifications: [foreignVerification] })),
    /coding-completion:verification-run-mismatch/,
  );
  assert.throws(
    () => service.decide(input({ toolExecutions: [foreignTool] })),
    /coding-completion:tool-run-mismatch/,
  );
  assert.throws(
    () => service.decide(input({
      mutations: [{ runId: 'foreign-run', status: 'committed' }],
    })),
    /coding-completion:mutation-run-mismatch/,
  );
});

test('CanonicalCompletionDecisionService lets Verification own a matching failed tool outcome', () => {
  const unverified = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [failedVerificationTool()],
    verifications: [verification('unverified')],
  }));
  const failed = new CanonicalCompletionDecisionService().decide(input({
    decisionId: 'completion-2',
    idempotencyKey: 'completion-run-1:completion-2',
    toolExecutions: [failedVerificationTool()],
    verifications: [verification('failed')],
  }));

  assert.equal(unverified.status, 'blocked');
  assert.equal(unverified.reasonCodes.includes('failed-effect'), false);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reasonCodes.includes('verification-failed'), true);
  assert.equal(failed.reasonCodes.includes('failed-effect'), false);
});

test('CanonicalCompletionDecisionService refuses cancellation with unsettled effects', () => {
  const blocked = new CanonicalCompletionDecisionService().decide(input({
    requestedTerminalStatus: 'cancelled',
    pendingRefs: ['effect:still-running'],
  }));
  const cancelled = new CanonicalCompletionDecisionService().decide(input({
    requestedTerminalStatus: 'cancelled',
    acceptance: [],
    verificationRequired: false,
    verifications: [],
  }));

  assert.equal(blocked.status, 'blocked');
  assert.equal(cancelled.status, 'cancelled');
});

test('Completion decision identity cannot be reused with different evidence', () => {
  const service = new CanonicalCompletionDecisionService();
  service.decide(input());
  assert.throws(
    () => service.decide(input({ evidenceRefs: ['different'] })),
    /coding-completion:conflicting-decision-identity/,
  );
});
