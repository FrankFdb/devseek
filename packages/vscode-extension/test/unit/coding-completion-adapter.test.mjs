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
const { VsCodeCompletionAdapter } = req(bundlePath);

test('VS Code completion requires committed mutation and passed acceptance verification for changes', () => {
  const completed = decide({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [verification()],
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.acceptance[0].status, 'passed');

  const missingVerification = decide({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
  });
  assert.equal(missingVerification.status, 'blocked');
  assert.equal(missingVerification.reasonCodes.includes('verification-not-run'), true);
});

test('VS Code completion accepts direct non-verifier evidence for a change criterion', () => {
  const decision = decide({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [verification({ acceptance: [] })],
    acceptanceEvidence: [{
      criterionId: 'completed',
      status: 'passed',
      evidenceRefs: ['mutation:scope-contained'],
    }],
  });

  assert.equal(decision.status, 'completed');
  assert.deepEqual(decision.acceptance[0].evidenceRefs, ['mutation:scope-contained']);
});

test('VS Code completion blocks changed paths without a canonical mutation receipt', () => {
  const decision = decide({
    changedPaths: ['/workspace/src/main.ts'],
    verificationReceipts: [verification()],
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.reasonCodes.includes('pending-work'), true);
  assert.equal(decision.evidenceRefs.includes('verify:passed'), true);
});

test('VS Code completion fails settled task and artifact verification failures', () => {
  const taskFailure = decide({ tasksFailed: 1, tasksApplied: 0 });
  const artifactFailure = decide({
    changedPaths: [],
    verificationResults: [{ verificationId: 'artifact-1', ok: false, claims: [] }],
  }, 'review');

  assert.equal(taskFailure.status, 'failed');
  assert.equal(taskFailure.reasonCodes.includes('verification-failed'), true);
  assert.equal(artifactFailure.status, 'failed');
  assert.equal(artifactFailure.reasonCodes.includes('unresolved-adverse-evidence'), true);
});

test('VS Code completion treats denied effects as evidenced blocking, not task failure', () => {
  const decision = decide({
    tasksFailed: 1,
    tasksApplied: 0,
    toolExecutionReceipts: [deniedTool()],
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.reasonCodes.includes('denied-effect'), true);
  assert.equal(decision.reasonCodes.includes('verification-failed'), false);
  assert.deepEqual(decision.acceptance, [{
    criterionId: 'completed',
    status: 'blocked',
    evidenceRefs: ['permission:install-denied'],
  }]);
  assert.deepEqual(decision.residualRisks, ['requested-change-not-applied']);
});

test('later passed verification supersedes earlier adverse verification only for the same full scope', () => {
  const repaired = decide({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [
      verification({ status: 'failed', actionId: 'verify-1', sequence: 1 }),
      verification({ status: 'passed', actionId: 'verify-2', sequence: 2 }),
    ],
  });
  const partialRepair = decide({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [
      verification({
        status: 'failed',
        actionId: 'verify-1',
        sequence: 1,
        scopePaths: ['src/main.ts', 'src/other.ts'],
      }),
      verification({ status: 'passed', actionId: 'verify-2', sequence: 2 }),
    ],
  });

  assert.equal(repaired.status, 'completed');
  assert.equal(repaired.evidenceRefs.includes('verify:failed'), true);
  assert.equal(partialRepair.status, 'failed');
});

test('a repaired terminal verifier resolves its failed process action without erasing history', () => {
  const decision = decide({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    toolExecutionReceipts: [
      terminalTool({ status: 'failed', actionId: 'verify-terminal-1', sequence: 3 }),
      terminalTool({ status: 'completed', actionId: 'verify-terminal-2', sequence: 5 }),
    ],
    verificationReceipts: [
      verification({ status: 'failed', actionId: 'verify-terminal-1', sequence: 3 }),
      verification({ status: 'passed', actionId: 'verify-terminal-2', sequence: 5 }),
    ],
  });

  assert.equal(decision.status, 'completed');
  assert.equal(decision.reasonCodes.includes('failed-effect'), false);
  assert.equal(decision.reasonCodes.includes('verification-failed'), false);
  assert.equal(decision.evidenceRefs.includes('terminal:failed'), true);
});

test('manual review and evidence-free read-only output remain blocked', () => {
  const manualReview = decide({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [verification()],
    manualReviewRequired: true,
    manualReviewReason: 'Confirm the rendered UI.',
  });
  const evidenceFree = decide({ changedPaths: [] }, 'review');
  const evidencedReview = decide({ changedPaths: [], historyText: 'Inspected src/main.ts.' }, 'review');

  assert.equal(manualReview.status, 'blocked');
  assert.equal(manualReview.reasonCodes.includes('review-not-passed'), true);
  assert.deepEqual(manualReview.residualRisks, ['Confirm the rendered UI.']);
  assert.equal(evidenceFree.status, 'blocked');
  assert.equal(evidencedReview.status, 'completed');
});

test('policy refusal completes only with direct refusal acceptance and no side effects', () => {
  const taskContract = buildSecretHarvestingRefusalTaskContract('vscode');
  const baseResult = {
    tasksTotal: 1,
    tasksApplied: 0,
    tasksFailed: 0,
    changedPaths: [],
    historyText: 'A provider response exists but is not itself refusal proof.',
  };
  const missingEvidence = new VsCodeCompletionAdapter().decide({
    runId: 'vscode-completion-run',
    taskContract,
    result: baseResult,
  });
  const completed = new VsCodeCompletionAdapter().decide({
    runId: 'vscode-completion-run',
    taskContract,
    result: {
      ...baseResult,
      acceptanceEvidence: buildSecretHarvestingRefusalAcceptanceEvidence(),
    },
  });

  assert.equal(missingEvidence.status, 'blocked');
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.acceptance.map(criterion => criterion.status), [
    'passed',
    'passed',
    'passed',
  ]);
  assert.deepEqual(completed.residualRisks, []);
});

function decide(result, mode = 'change') {
  return new VsCodeCompletionAdapter().decide({
    runId: 'vscode-completion-run',
    taskContract: buildCodingKernelTaskContract({
      goal: 'Complete the task',
      mode,
      include: ['src/main.ts'],
      deliverables: [{ id: 'result', kind: mode === 'review' ? 'report' : 'source-change' }],
      acceptance: [{ id: 'completed', statement: 'The requested work is complete.' }],
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

function terminalTool(overrides = {}) {
  const actionId = overrides.actionId ?? 'verify-terminal';
  const status = overrides.status ?? 'completed';
  return {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'vscode-completion-run',
    sequence: overrides.sequence ?? 1,
    actionId,
    tool: 'run_terminal',
    effects: ['process'],
    status,
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'terminal-authorized',
      evidenceRefs: [`terminal:${actionId}:authorized`],
    },
    evidenceRefs: [status === 'failed' ? 'terminal:failed' : 'terminal:passed'],
    ...overrides,
  };
}
