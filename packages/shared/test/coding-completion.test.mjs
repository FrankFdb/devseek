import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanonicalCompletionDecisionService,
  CODING_TOOL_RECEIPT_VERSION,
  CODING_VERIFICATION_RECEIPT_VERSION,
  CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
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

function workspaceTool(actionId, sequence, status = 'completed') {
  return {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'completion-run-1',
    sequence,
    actionId,
    tool: status === 'denied' ? 'run_terminal' : 'create_file',
    purpose: 'tool-write',
    effects: status === 'denied' ? ['process', 'workspace-mutation'] : ['workspace-mutation'],
    status,
    permission: {
      decision: status === 'denied' ? 'deny' : 'allow',
      status: status === 'denied' ? 'denied' : 'authorized',
      reason: status === 'denied' ? 'shell-write-denied' : 'workspace-write',
      evidenceRefs: [`authority:${status}`],
    },
    ...(status === 'failed' ? { errorCode: 'edit-route-failed' } : {}),
    evidenceRefs: [`workspace-tool:${actionId}:${status}`],
  };
}

function mutation(actionId, sequence, status = 'committed', overrides = {}) {
  return {
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId: 'completion-run-1',
    sequence,
    actionId,
    idempotencyKey: `completion-run-1:${actionId}`,
    status,
    paths: ['src/value.ts'],
    baselineRef: `baseline:${actionId}`,
    readbackRef: `readback:${actionId}`,
    evidenceRefs: [`mutation:${actionId}:${status}`],
    ...overrides,
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

test('CanonicalCompletionDecisionService settles a denied verification route only through a later canonical pass', () => {
  const denied = {
    ...failedVerificationTool('unsafe-shell-write', 1),
    effects: ['process', 'workspace-mutation'],
    status: 'denied',
    permission: {
      decision: 'deny',
      status: 'denied',
      reason: 'workspace-shell-write-denied',
      evidenceRefs: ['permission:shell-write-denied'],
    },
    evidenceRefs: ['permission:shell-write-denied'],
  };
  const verifiedTool = completedVerificationTool('host-validation-2', 2);
  const verified = {
    ...verification('passed'),
    sequence: verifiedTool.sequence,
    actionId: verifiedTool.actionId,
    idempotencyKey: `completion-run-1:${verifiedTool.actionId}`,
    evidenceRefs: ['host-validation:exit-0'],
    acceptance: [{
      criterionId: 'builds',
      status: 'passed',
      evidenceRefs: ['host-validation:exit-0'],
    }],
  };
  const recovered = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [denied, verifiedTool],
    verifications: [verified],
  }));
  const uncorrelated = new CanonicalCompletionDecisionService().decide(input({
    decisionId: 'completion-uncorrelated-denial',
    idempotencyKey: 'completion-run-1:completion-uncorrelated-denial',
    toolExecutions: [denied],
    verifications: [verified],
  }));

  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.reasonCodes.includes('denied-effect'), false);
  assert.equal(uncorrelated.status, 'blocked');
  assert.equal(uncorrelated.reasonCodes.includes('denied-effect'), true);
});

test('CanonicalCompletionDecisionService keeps rejected control attempts completion-neutral', () => {
  const deniedControl = {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'completion-run-1',
    sequence: 1,
    actionId: 'todo-invalid-1',
    tool: 'manage_todo_list',
    purpose: 'observe',
    effects: ['read'],
    status: 'denied',
    permission: {
      decision: 'deny',
      status: 'denied',
      reason: 'invalid-tool-input',
      evidenceRefs: ['authority:todo-invalid'],
    },
    evidenceRefs: ['authority:todo-invalid'],
  };
  const completedControl = {
    ...deniedControl,
    sequence: 2,
    actionId: 'todo-valid-2',
    status: 'completed',
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'valid-tool-input',
      evidenceRefs: ['authority:todo-valid'],
    },
    evidenceRefs: ['todo:updated'],
  };
  const decision = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [deniedControl, completedControl],
  }));

  assert.equal(decision.status, 'completed');
  assert.equal(decision.reasonCodes.includes('denied-effect'), false);
  assert.equal(decision.evidenceRefs.includes('authority:todo-invalid'), true);
});

test('CanonicalCompletionDecisionService keeps failed read-only exploration completion-neutral', () => {
  const failedRead = {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'completion-run-1',
    sequence: 1,
    actionId: 'read-missing-1',
    tool: 'read_file',
    purpose: 'observe',
    effects: ['read'],
    status: 'failed',
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'workspace-read',
      evidenceRefs: ['authority:read'],
    },
    errorCode: 'file-not-found',
    evidenceRefs: ['read:missing-path'],
  };
  const decision = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [failedRead],
  }));

  assert.equal(decision.status, 'completed');
  assert.equal(decision.reasonCodes.includes('failed-effect'), false);
  assert.equal(decision.evidenceRefs.includes('read:missing-path'), true);
});

test('CanonicalCompletionDecisionService keeps failed network observations blocking', () => {
  const failedFetch = {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'completion-run-1',
    sequence: 1,
    actionId: 'fetch-failed-1',
    tool: 'fetch_webpage',
    purpose: 'observe',
    effects: ['network'],
    status: 'failed',
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'network-read',
      evidenceRefs: ['authority:network'],
    },
    errorCode: 'network-failed',
    evidenceRefs: ['network:failed'],
  };
  const decision = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [failedFetch],
  }));

  assert.equal(decision.status, 'failed');
  assert.equal(decision.reasonCodes.includes('failed-effect'), true);
});

test('CanonicalCompletionDecisionService rejects non-read effects on a read-only tool receipt', () => {
  const inconsistentRead = {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'completion-run-1',
    sequence: 1,
    actionId: 'read-inconsistent-1',
    tool: 'read_file',
    purpose: 'observe',
    effects: ['workspace-mutation'],
    status: 'failed',
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'inconsistent-adapter',
      evidenceRefs: ['authority:inconsistent-read'],
    },
    errorCode: 'adapter-contract-violation',
    evidenceRefs: ['read:inconsistent-effect'],
  };
  const decision = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [inconsistentRead],
  }));

  assert.equal(decision.status, 'failed');
  assert.equal(decision.reasonCodes.includes('failed-effect'), true);
});

test('CanonicalCompletionDecisionService settles failed edit routes through a read-back and scoped canonical verification', () => {
  const failedEdit = workspaceTool('replace-failed', 1, 'failed');
  const deniedShellWrite = workspaceTool('shell-write-denied', 2, 'denied');
  const replacementTool = workspaceTool('safe-create', 3);
  const replacementMutation = mutation(replacementTool.actionId, replacementTool.sequence);
  const verifiedTool = completedVerificationTool('host-validation-4', 4);
  const verified = {
    ...verification('passed'),
    sequence: verifiedTool.sequence,
    actionId: verifiedTool.actionId,
    idempotencyKey: `completion-run-1:${verifiedTool.actionId}`,
  };
  const recovered = new CanonicalCompletionDecisionService().decide(input({
    toolExecutions: [failedEdit, deniedShellWrite, replacementTool, verifiedTool],
    mutations: [
      mutation(failedEdit.actionId, failedEdit.sequence, 'rolled-back'),
      replacementMutation,
    ],
    verifications: [verified],
  }));
  const missingReadback = new CanonicalCompletionDecisionService().decide(input({
    decisionId: 'completion-missing-readback',
    idempotencyKey: 'completion-run-1:completion-missing-readback',
    toolExecutions: [failedEdit, deniedShellWrite, replacementTool, verifiedTool],
    mutations: [
      mutation(failedEdit.actionId, failedEdit.sequence, 'rolled-back'),
      { ...replacementMutation, readbackRef: undefined },
    ],
    verifications: [verified],
  }));

  assert.equal(recovered.status, 'completed');
  assert.deepEqual(recovered.reasonCodes, []);
  assert.equal(missingReadback.status, 'failed');
  assert.equal(missingReadback.reasonCodes.includes('failed-effect'), true);
  assert.equal(missingReadback.reasonCodes.includes('denied-effect'), true);
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
    toolExecutions: [failedVerificationTool(), completedVerificationTool()],
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

test('CanonicalCompletionDecisionService requires a matching executed verifier to supersede its failure', () => {
  const failedTool = failedVerificationTool('focused-check-1', 1);
  const failedVerification = {
    ...verification('failed'),
    actionId: failedTool.actionId,
    idempotencyKey: `completion-run-1:${failedTool.actionId}`,
  };
  const automaticPass = {
    ...verification('passed'),
    sequence: 2,
    actionId: 'auto-validation-2',
    idempotencyKey: 'completion-run-1:auto-validation-2',
  };
  const stillFailed = new CanonicalCompletionDecisionService().decide(input({
    decisionId: 'completion-weaker-auto-pass',
    idempotencyKey: 'completion-run-1:completion-weaker-auto-pass',
    toolExecutions: [failedTool],
    verifications: [failedVerification, automaticPass],
  }));
  const recoveredTool = completedVerificationTool('focused-check-3', 3);
  const recoveredVerification = {
    ...automaticPass,
    sequence: recoveredTool.sequence,
    actionId: recoveredTool.actionId,
    idempotencyKey: `completion-run-1:${recoveredTool.actionId}`,
    evidenceRefs: ['focused-check-3:exit-0'],
    acceptance: [{ criterionId: 'builds', status: 'passed', evidenceRefs: ['focused-check-3:exit-0'] }],
  };
  const recovered = new CanonicalCompletionDecisionService().decide(input({
    decisionId: 'completion-matching-terminal-pass',
    idempotencyKey: 'completion-run-1:completion-matching-terminal-pass',
    toolExecutions: [failedTool, recoveredTool],
    verifications: [failedVerification, automaticPass, recoveredVerification],
  }));

  assert.equal(stillFailed.status, 'failed');
  assert.equal(stillFailed.reasonCodes.includes('verification-failed'), true);
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.evidenceRefs.includes('build:not-passed'), true);
  assert.equal(recovered.evidenceRefs.includes('focused-check-3:exit-0'), true);
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
