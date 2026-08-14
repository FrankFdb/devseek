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

test('VS Code evidence projection clears a denied validation route after a canonical host pass', () => {
  const denied = {
    ...deniedTool(),
    purpose: 'verify',
    effects: ['process', 'workspace-mutation'],
  };
  const completed = {
    ...deniedTool(),
    sequence: 2,
    actionId: 'host-validation-2',
    purpose: 'verify',
    effects: ['process'],
    status: 'completed',
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'host-validation',
      evidenceRefs: ['permission:host-validation'],
    },
    evidenceRefs: ['host-validation:exit-0'],
  };
  const evidence = project({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    toolExecutionReceipts: [denied, completed],
    verificationReceipts: [verification({
      sequence: completed.sequence,
      actionId: completed.actionId,
      idempotencyKey: `vscode-completion-run:${completed.actionId}`,
    })],
  });

  assert.deepEqual(evidence.acceptanceEvidence, []);
  assert.deepEqual(evidence.residualRisks, []);
});

test('VS Code evidence projection does not turn rejected control attempts into delivery risk', () => {
  const controlDenial = {
    ...deniedTool(),
    actionId: 'todo-invalid-1',
    tool: 'manage_todo_list',
    purpose: 'observe',
    effects: ['read'],
    permission: {
      decision: 'deny',
      status: 'denied',
      reason: 'invalid-tool-input',
      evidenceRefs: ['permission:todo-invalid'],
    },
    evidenceRefs: ['permission:todo-invalid'],
  };
  const evidence = project({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [verification()],
    toolExecutionReceipts: [controlDenial],
  });

  assert.deepEqual(evidence.acceptanceEvidence, []);
  assert.deepEqual(evidence.residualRisks, []);
});

test('VS Code evidence projection clears a denied shell write after a verified workspace tool replacement', () => {
  const denied = {
    ...deniedTool(),
    purpose: 'tool-write',
    sequence: 1,
  };
  const replacement = {
    ...deniedTool(),
    sequence: 2,
    actionId: 'safe-create-2',
    tool: 'create_file',
    purpose: 'tool-write',
    effects: ['workspace-mutation'],
    status: 'completed',
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'workspace-write',
      evidenceRefs: ['permission:workspace-write'],
    },
    evidenceRefs: ['workspace-write:readback-matched'],
  };
  const verified = {
    ...replacement,
    sequence: 3,
    actionId: 'host-validation-3',
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process'],
    evidenceRefs: ['host-validation:exit-0'],
  };
  const evidence = project({
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation({
      sequence: replacement.sequence,
      actionId: replacement.actionId,
      idempotencyKey: `vscode-completion-run:${replacement.actionId}`,
    })],
    toolExecutionReceipts: [denied, replacement, verified],
    verificationReceipts: [verification({
      sequence: verified.sequence,
      actionId: verified.actionId,
      idempotencyKey: `vscode-completion-run:${verified.actionId}`,
    })],
  });

  assert.deepEqual(evidence.acceptanceEvidence, []);
  assert.deepEqual(evidence.residualRisks, []);
});

test('VS Code evidence projection clears a task failure caused only by an out-of-contract file denial', () => {
  const deniedTestWrite = {
    ...deniedTool(),
    sequence: 2,
    actionId: 'write-test-sh-denied',
    tool: 'write_file',
    purpose: 'tool-write',
    effects: ['workspace-mutation'],
    permission: {
      decision: 'deny',
      status: 'denied',
      reason: 'target-file-write-prohibited',
      evidenceRefs: ['vscode-file-write-policy:target-file-write-prohibited'],
    },
    evidenceRefs: ['vscode-file-write-policy:target-file-write-prohibited'],
  };
  const evidence = project({
    tasksFailed: 1,
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [verification()],
    toolExecutionReceipts: [deniedTestWrite],
  });

  assert.deepEqual(evidence.acceptanceEvidence, []);
  assert.deepEqual(evidence.residualRisks, []);
  assert.equal(
    evidence.evidenceRefs.includes('vscode-agent-result:vscode-completion-run:tasks-failed'),
    false,
  );
});

test('VS Code evidence projection clears stale missing-evidence failures after canonical verification passes', () => {
  const recovered = project({
    tasksFailed: 1,
    failedReason: '实际执行证据不足：缺少成功的测试/运行结果。',
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [verification()],
  });
  const summaryFactFailure = project({
    tasksFailed: 1,
    failedReason: '完成摘要缺少文件事实证据：ghost.js。',
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation()],
    verificationReceipts: [verification()],
  });

  assert.deepEqual(recovered.acceptanceEvidence, []);
  assert.equal(
    recovered.evidenceRefs.includes('vscode-agent-result:vscode-completion-run:tasks-failed'),
    false,
  );
  assert.equal(summaryFactFailure.acceptanceEvidence[0].status, 'failed');
  assert.equal(
    summaryFactFailure.evidenceRefs.includes('vscode-agent-result:vscode-completion-run:tasks-failed'),
    true,
  );
});

test('VS Code evidence projection clears recovered validation failures after repair verification passes', () => {
  const failedVerificationTool = terminalTool({
    sequence: 2,
    actionId: 'focused-check-1',
    status: 'failed',
  });
  const passedVerificationTool = terminalTool({
    sequence: 4,
    actionId: 'focused-check-2',
    status: 'completed',
  });
  const evidence = project({
    tasksFailed: 1,
    failedReason: 'Focused validation failed before the repair.',
    changedPaths: ['src/main.ts'],
    changeReceipts: [mutation({
      sequence: 3,
      actionId: 'repair-mutation',
      idempotencyKey: 'vscode-completion-run:repair-mutation',
    })],
    toolExecutionReceipts: [failedVerificationTool, passedVerificationTool],
    verificationReceipts: [
      verification({
        sequence: 2,
        actionId: 'focused-check-1',
        idempotencyKey: 'vscode-completion-run:focused-check-1',
        status: 'failed',
      }),
      verification({
        sequence: 4,
        actionId: 'focused-check-2',
        idempotencyKey: 'vscode-completion-run:focused-check-2',
        status: 'passed',
      }),
    ],
  });

  assert.deepEqual(evidence.acceptanceEvidence, []);
  assert.equal(
    evidence.evidenceRefs.includes('vscode-agent-result:vscode-completion-run:tasks-failed'),
    false,
  );
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

test('run-only completion grounds the response while verifier authority settles verification', () => {
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Run the health check and report the result without modifying files.',
    mode: 'review',
    deliverables: [
      { id: 'response', kind: 'report' },
      { id: 'verification-result', kind: 'verification-result' },
    ],
    constraints: ['no-workspace-mutation', 'verification-before-completion'],
    acceptance: [
      {
        id: 'grounded-response',
        statement: 'Report the observed result.',
        deliverableIds: ['response'],
        oracle: {
          kind: 'response-evidence',
          verifier: 'grounded-response-review',
          scope: ['response'],
          evidenceKinds: ['response-evidence'],
        },
        externalBoundaryRefs: [],
      },
      {
        id: 'verified',
        statement: 'The health check passes.',
        deliverableIds: ['verification-result'],
        oracle: {
          kind: 'verification',
          verifier: 'project-verification',
          scope: ['workspace'],
          evidenceKinds: ['verification-receipt'],
        },
        externalBoundaryRefs: [],
      },
    ],
    provenanceRefs: ['vscode-test'],
  });
  const evidence = new VsCodeCompletionEvidenceAdapter().project({
    runId: 'vscode-run-only',
    taskContract,
    result: {
      tasksTotal: 1,
      tasksApplied: 0,
      tasksFailed: 0,
      changedPaths: [],
      historyText: 'HEALTH_OK',
      verificationReceipts: [verification({
        runId: 'vscode-run-only',
        acceptance: [{
          criterionId: 'verified',
          status: 'passed',
          evidenceRefs: ['terminal:health:exit-0'],
        }],
      })],
    },
  });

  assert.deepEqual(evidence.acceptanceEvidence.map(item => [item.criterionId, item.status]), [
    ['grounded-response', 'passed'],
  ]);
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

function terminalTool(overrides = {}) {
  const status = overrides.status ?? 'completed';
  return {
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: 'vscode-completion-run',
    sequence: 1,
    actionId: 'verify-1',
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process'],
    status,
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'workspace-command',
      evidenceRefs: ['permission:terminal-allowed'],
    },
    evidenceRefs: [status === 'completed' ? 'terminal:exit-0' : 'terminal:exit-1'],
    ...overrides,
  };
}
