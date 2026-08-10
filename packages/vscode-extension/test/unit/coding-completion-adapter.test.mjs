import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import {
  CODING_TOOL_RECEIPT_VERSION,
  CODING_VERIFICATION_RECEIPT_VERSION,
  CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
  buildCodingKernelTaskContract,
  buildSecretHarvestingRefusalAcceptanceEvidence,
  buildSecretHarvestingRefusalTaskContract,
} from '../../../shared/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/coding-completion-adapter.bundle.cjs');

execSync(
  `npx esbuild src/app/coding-completion-adapter.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { VsCodeCompletionEvidenceAdapter } = req(bundlePath);

test('VS Code evidence projection leaves verifier authority with the Kernel', () => {
  const verified = project({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [verification()],
  });
  const unverified = project({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
  });

  assert.deepEqual(verified.acceptanceEvidence, []);
  assert.deepEqual(unverified.acceptanceEvidence, []);
  assert.deepEqual(verified.pendingRefs, []);
  assert.deepEqual(unverified.pendingRefs, []);
});

test('VS Code evidence projection preserves explicit criterion evidence without deciding terminal state', () => {
  const evidence = project({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [verification({ acceptance: [] })],
    acceptanceEvidence: [{
      criterionId: 'completed',
      status: 'passed',
      evidenceRefs: ['mutation:scope-contained'],
    }],
  });

  assert.deepEqual(evidence.acceptanceEvidence, [{
    criterionId: 'completed',
    status: 'passed',
    evidenceRefs: ['mutation:scope-contained'],
  }]);
});

test('VS Code evidence projection reports changed paths without canonical mutation receipts as pending', () => {
  const evidence = project({
    changedPaths: ['/workspace/src/main.ts'],
    verificationReceipts: [verification()],
  });

  assert.deepEqual(evidence.pendingRefs, ['vscode-mutation-receipt-missing:/workspace/src/main.ts']);
});

test('VS Code evidence projection preserves task and artifact failure evidence', () => {
  const taskFailure = project({ tasksFailed: 1, tasksApplied: 0 });
  const artifactFailure = project({
    changedPaths: [],
    verificationResults: [{ verificationId: 'artifact-1', ok: false, claims: [] }],
  }, 'review');

  assert.equal(taskFailure.acceptanceEvidence[0].status, 'failed');
  assert.deepEqual(artifactFailure.adverseEvidenceRefs, [
    'vscode-artifact-verification:artifact-1:failed',
  ]);
});

test('VS Code evidence projection treats denied effects as blocking evidence', () => {
  const evidence = project({
    tasksFailed: 1,
    tasksApplied: 0,
    toolExecutionReceipts: [deniedTool()],
  });

  assert.deepEqual(evidence.acceptanceEvidence, [{
    criterionId: 'completed',
    status: 'blocked',
    evidenceRefs: ['permission:install-denied'],
  }]);
  assert.deepEqual(evidence.residualRisks, ['requested-change-not-applied']);
});

test('manual review and read-only response evidence remain explicit', () => {
  const manualReview = project({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [verification()],
    manualReviewRequired: true,
    manualReviewReason: 'Confirm the rendered UI.',
  });
  const evidenceFree = project({ changedPaths: [] }, 'review');
  const evidencedReview = project({ changedPaths: [], historyText: 'Inspected src/main.ts.' }, 'review');

  assert.equal(manualReview.reviewRequired, true);
  assert.equal(manualReview.review.status, 'not-run');
  assert.deepEqual(manualReview.residualRisks, ['Confirm the rendered UI.']);
  assert.deepEqual(evidenceFree.acceptanceEvidence, []);
  assert.equal(evidencedReview.acceptanceEvidence[0].status, 'passed');
});

test('policy refusal projects only explicit refusal acceptance evidence', () => {
  const taskContract = buildSecretHarvestingRefusalTaskContract('vscode');
  const baseResult = {
    tasksTotal: 1,
    tasksApplied: 0,
    tasksFailed: 0,
    changedPaths: [],
    historyText: 'A provider response exists but is not itself refusal proof.',
  };
  const missingEvidence = new VsCodeCompletionEvidenceAdapter().project({
    runId: 'vscode-completion-run',
    taskContract,
    result: baseResult,
  });
  const completed = new VsCodeCompletionEvidenceAdapter().project({
    runId: 'vscode-completion-run',
    taskContract,
    result: {
      ...baseResult,
      acceptanceEvidence: buildSecretHarvestingRefusalAcceptanceEvidence(),
    },
  });

  assert.deepEqual(missingEvidence.acceptanceEvidence, []);
  assert.deepEqual(completed.acceptanceEvidence.map(criterion => criterion.status), [
    'passed',
    'passed',
    'passed',
  ]);
  assert.deepEqual(completed.residualRisks, []);
});

function project(result, mode = 'change') {
  return new VsCodeCompletionEvidenceAdapter().project({
    runId: 'vscode-completion-run',
    taskContract: buildCodingKernelTaskContract({
      goal: 'Complete the task',
      mode,
      include: ['src/main.ts'],
      deliverables: [{ id: 'result', kind: mode === 'review' ? 'report' : 'source-change' }],
      acceptance: [{
        id: 'completed',
        statement: 'The requested work is complete.',
        deliverableIds: ['result'],
        oracle: {
          kind: mode === 'review' ? 'response-evidence' : 'verification',
          verifier: 'vscode-completion-adapter',
          scope: ['src/main.ts'],
          evidenceKinds: [mode === 'review' ? 'response-evidence' : 'verification-receipt'],
        },
        externalBoundaryRefs: [],
      }],
      provenanceRefs: ['vscode-test'],
    }),
    result: {
      tasksTotal: 1,
      tasksApplied: 1,
      tasksFailed: 0,
      changedPaths: [],
      ...result,
    },
  });
}

function mutation(overrides = {}) {
  return {
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId: 'vscode-completion-run',
    sequence: 1,
    actionId: 'mutation-1',
    idempotencyKey: 'vscode-completion-run:mutation-1',
    status: 'committed',
    paths: ['src/main.ts'],
    baselineRef: 'baseline:src/main.ts',
    readbackRef: 'readback:src/main.ts',
    evidenceRefs: ['mutation:committed'],
    ...overrides,
  };
}

function verification(overrides = {}) {
  const status = overrides.status ?? 'passed';
  return {
    version: CODING_VERIFICATION_RECEIPT_VERSION,
    runId: 'vscode-completion-run',
    sequence: 1,
    actionId: 'verify-1',
    idempotencyKey: 'vscode-completion-run:verify-1',
    verifier: 'vscode-quality-gate',
    status,
    scopePaths: ['src/main.ts'],
    checks: [],
    acceptance: [{
      criterionId: 'completed',
      status: status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'unverified',
      evidenceRefs: [status === 'passed' ? 'verify:passed' : 'verify:failed'],
    }],
    evidenceRefs: [status === 'passed' ? 'verify:passed' : 'verify:failed'],
    ...overrides,
  };
}

function deniedTool() {
  return {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'vscode-completion-run',
    sequence: 1,
    actionId: 'install-dependency',
    tool: 'run_terminal',
    effects: ['process', 'network', 'workspace-mutation'],
    status: 'denied',
    permission: {
      decision: 'deny',
      status: 'denied',
      reason: 'approval-required',
      evidenceRefs: ['permission:install-denied'],
    },
    evidenceRefs: ['permission:install-denied'],
  };
}
