import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-run-settlement.bundle.cjs');

execSync(
  `npx esbuild src/app/agent-run-settlement.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { settleAgentLoopResult, settleRunContextDirect } = req(bundlePath);

test('direct run settlement reports refused completed state from RunContext authority', () => {
  let completionRequest;
  const runContext = {
    complete(requestedStatus, data) {
      completionRequest = { requestedStatus, data };
      return 'failed';
    },
  };

  const settlement = settleRunContextDirect(runContext, 'completed', { reason: 'missing-quality-gate' });

  assert.deepEqual(completionRequest, {
    requestedStatus: 'completed',
    data: { reason: 'missing-quality-gate' },
  });
  assert.deepEqual(settlement, {
    requestedStatus: 'completed',
    status: 'failed',
    completed: false,
    refused: true,
  });
});

test('direct run settlement keeps failed requests terminal but non-refused', () => {
  const runContext = {
    complete(requestedStatus) {
      return requestedStatus;
    },
  };

  const settlement = settleRunContextDirect(runContext, 'failed', { reason: 'provider-error' });

  assert.deepEqual(settlement, {
    requestedStatus: 'failed',
    status: 'failed',
    completed: false,
    refused: false,
  });
});

test('agent run settlement omits undefined verification fields for strict JSON completion data', () => {
  let completionData;
  const terminalPermissions = {
    completeRunContext(_runContext, requestedStatus, data) {
      completionData = data;
      assert.doesNotThrow(() => assertStrictJsonData(data));
      return requestedStatus;
    },
  };

  const settlement = settleAgentLoopResult(terminalPermissions, { runId: 'run-1' }, {
    tasksTotal: 1,
    tasksApplied: 0,
    tasksFailed: 1,
    changedPaths: [],
  });

  assert.equal(settlement.status, 'failed');
  assert.deepEqual(completionData, {
    tasksTotal: 1,
    tasksApplied: 0,
    tasksFailed: 1,
    changedPaths: [],
    verificationIds: [],
  });
  assert.equal(Object.hasOwn(completionData, 'artifactVerificationOk'), false);
});

test('agent run settlement keeps explicit artifact verification verdicts', () => {
  let completionData;
  const terminalPermissions = {
    completeRunContext(_runContext, requestedStatus, data) {
      completionData = data;
      assert.doesNotThrow(() => assertStrictJsonData(data));
      return requestedStatus;
    },
  };

  settleAgentLoopResult(terminalPermissions, { runId: 'run-2' }, {
    tasksTotal: 1,
    tasksApplied: 1,
    tasksFailed: 0,
    changedPaths: ['report.md'],
    verificationResults: [
      { verificationId: 'vr-1', ok: true, claims: [] },
    ],
  });

  assert.deepEqual(completionData.verificationIds, ['vr-1']);
  assert.equal(completionData.artifactVerificationOk, true);
});

test('agent run settlement preserves automatic validation verification ids', () => {
  let completionData;
  const terminalPermissions = {
    completeRunContext(_runContext, requestedStatus, data) {
      completionData = data;
      assert.doesNotThrow(() => assertStrictJsonData(data));
      return requestedStatus;
    },
  };

  settleAgentLoopResult(terminalPermissions, { runId: 'run-3' }, {
    tasksTotal: 1,
    tasksApplied: 1,
    tasksFailed: 0,
    changedPaths: ['report.md'],
    verificationIds: ['auto-validation-1-report.md', 'auto-validation-1-report.md'],
    verificationResults: [
      { verificationId: 'artifact-vr-1', ok: true, claims: [] },
    ],
  });

  assert.deepEqual(completionData.verificationIds, ['auto-validation-1-report.md', 'artifact-vr-1']);
  assert.equal(completionData.artifactVerificationOk, true);
});

test('agent run settlement preserves canonical blocked completion without recomputing it', () => {
  let completionRequest;
  const terminalPermissions = {
    completeRunContext(_runContext, requestedStatus, data) {
      completionRequest = { requestedStatus, data };
      return requestedStatus;
    },
  };
  const completionDecision = {
    version: 'devseek.coding-completion-decision/v1',
    runId: 'run-4',
    decisionId: 'vscode-completion',
    idempotencyKey: 'run-4:vscode-completion',
    status: 'blocked',
    acceptance: [{ criterionId: 'done', status: 'blocked', evidenceRefs: [] }],
    reasonCodes: ['verification-not-run'],
    residualRisks: ['No applicable verifier ran.'],
    evidenceRefs: ['task-contract:run-4'],
  };

  const settlement = settleAgentLoopResult(terminalPermissions, { runId: 'run-4' }, {
    tasksTotal: 1,
    tasksApplied: 1,
    tasksFailed: 0,
    changedPaths: ['src/main.ts'],
    completionDecision,
  });

  assert.equal(settlement.requestedStatus, 'blocked');
  assert.equal(settlement.status, 'blocked');
  assert.equal(settlement.completed, false);
  assert.equal(completionRequest.data.canonicalCompletionStatus, 'blocked');
  assert.deepEqual(completionRequest.data.canonicalCompletionReasonCodes, ['verification-not-run']);
  assert.deepEqual(completionRequest.data.canonicalCompletionEvidenceRefs, ['task-contract:run-4']);
});

test('agent run settlement preserves canonical cancellation', () => {
  const terminalPermissions = {
    completeRunContext(_runContext, requestedStatus) {
      return requestedStatus;
    },
  };
  const settlement = settleAgentLoopResult(terminalPermissions, { runId: 'run-5' }, {
    tasksTotal: 1,
    tasksApplied: 0,
    tasksFailed: 1,
    changedPaths: [],
    completionDecision: {
      version: 'devseek.coding-completion-decision/v1',
      runId: 'run-5',
      decisionId: 'vscode-completion',
      idempotencyKey: 'run-5:vscode-completion',
      status: 'cancelled',
      acceptance: [],
      reasonCodes: [],
      residualRisks: [],
      evidenceRefs: ['task-contract:run-5'],
    },
  });

  assert.equal(settlement.requestedStatus, 'cancelled');
  assert.equal(settlement.status, 'cancelled');
});

function assertStrictJsonData(value, seen = new Set()) {
  assert.notEqual(value, undefined, 'strict JSON data must not contain undefined');
  assert.notEqual(typeof value, 'function', 'strict JSON data must not contain functions');
  assert.notEqual(typeof value, 'symbol', 'strict JSON data must not contain symbols');
  if (value === null || typeof value !== 'object') return;
  assert.equal(seen.has(value), false, 'strict JSON data must not contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => assertStrictJsonData(item, seen));
  } else {
    Object.values(value).forEach(item => assertStrictJsonData(item, seen));
  }
  seen.delete(value);
}
