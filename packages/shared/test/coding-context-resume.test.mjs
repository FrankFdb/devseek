import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCheckpointService,
  CanonicalCodingKernel,
  CanonicalContextCompactionService,
  CanonicalContextGraphService,
  CanonicalMemoryPolicyService,
  CanonicalResumeIdempotencyService,
  CanonicalTaskContractService,
  CodingKernelExecutionError,
  codingSemanticDigest,
  renderCodingContextCompactionReceipt,
} from '../dist/index.js';

function fixture(pendingUnits = defaultPendingUnits()) {
  const taskContract = new CanonicalTaskContractService().build({
    goal: 'Refactor the resume path and verify it without publishing',
    mode: 'change',
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/resume.ts' }],
    constraints: ['Do not publish artifacts.'],
    acceptance: [{ id: 'tests', statement: 'The resume tests pass.' }],
    provenanceRefs: ['user:current'],
  });
  const contextGraph = new CanonicalContextGraphService().build({
    workspaceRoot: '/repo',
    userPrompt: taskContract.goal,
    taskContract,
    seed: { files: [{ path: 'src/resume.ts', contentSample: 'export const resume = true;' }] },
  });
  const memoryPolicy = new CanonicalMemoryPolicyService().selectContext({
    candidates: [],
    workspaceRoot: '/repo',
  });
  const checkpoints = new CanonicalCheckpointService();
  const checkpointSession = checkpoints.bind({
    runId: 'origin-run',
    surface: 'headless',
    workspaceRoot: '/repo',
    taskContract,
    contextGraph,
    memoryPolicySha256: memoryPolicy.decisionSha256,
  });
  const checkpoint = checkpointSession.create({
    epoch: 1,
    completedUnitCount: 1,
    pendingUnits,
    evidenceRefs: ['test:initial'],
    reason: 'paused',
    createdAt: 1_000,
  });
  const restore = checkpoints.restore(checkpoint, {
    surface: 'headless',
    workspaceRoot: '/repo',
    taskContract,
    contextGraph,
    memoryPolicySha256: memoryPolicy.decisionSha256,
  });
  return { taskContract, contextGraph, memoryPolicy, checkpointSession, checkpoint, restore };
}

function defaultPendingUnits() {
  return [
    { id: 'edit', description: 'Modify the resume path', action: 'modify', target: 'src/resume.ts' },
    { id: 'publish', description: 'Publish the package', action: 'deploy', target: 'registry' },
    { id: 'verify', description: 'Run focused tests', action: 'verify', target: 'npm test' },
  ];
}

test('ContextCompactionPort preserves canonical task, provenance, progress, and checkpoint ancestry', () => {
  const input = fixture();
  const compaction = new CanonicalContextCompactionService();
  const session = compaction.bind({
    taskContract: input.taskContract,
    contextGraph: input.contextGraph,
    memoryPolicy: input.memoryPolicy,
    checkpoint: input.checkpointSession,
  });
  const pending = [
    defaultPendingUnits()[0],
    {
      ...defaultPendingUnits()[2],
      description: 'Run tests with token=supersecretvalue',
    },
  ];
  const first = session.compact({
    observedChars: 18_000,
    maxChars: 12_000,
    completedUnitCount: 1,
    pendingUnits: pending,
    evidenceRefs: ['terminal:token=supersecretvalue'],
    createdAt: 2_000,
  });
  const second = session.compact({
    trigger: 'provider-recovery',
    observedChars: 21_000,
    maxChars: 12_000,
    completedUnitCount: 2,
    pendingUnits: [pending[1]],
    evidenceRefs: ['test:retry'],
    createdAt: 3_000,
  });

  assert.equal(first.pass, 1);
  assert.equal(second.pass, 2);
  assert.equal(second.parentReceiptSha256, first.receiptSha256);
  assert.equal(second.checkpoint.parentCheckpointId, first.checkpoint.checkpointId);
  assert.equal(second.taskContractSha256, first.taskContractSha256);
  assert.equal(second.contextGraphSha256, first.contextGraphSha256);
  assert.equal(second.memoryPolicySha256, first.memoryPolicySha256);
  assert.equal(second.completedUnitCount, 2);
  assert.deepEqual(second.pendingUnits.map(unit => unit.id), ['verify']);
  assert.equal(second.requiresRevalidation, true);
  assert.equal(first.checkpoint.reason, 'compaction');
  assert.equal(first.redactedSecretCount >= 2, true);
  assert.equal(renderCodingContextCompactionReceipt(first).includes('supersecretvalue'), false);
  assert.equal(first.evidenceRefs.some(value => value.includes('supersecretvalue')), false);
  assert.throws(() => first.pendingUnits.push({}), TypeError);
  assert.throws(
    () => compaction.snapshot({ ...second, completedUnitCount: 3 }),
    /coding-context-compaction:checkpoint-progress-mismatch/u,
  );
});

test('ContextCompactionPort rejects stale ancestry, semantic drift, and non-compaction budgets', () => {
  const input = fixture();
  const session = new CanonicalContextCompactionService().bind({
    taskContract: input.taskContract,
    contextGraph: input.contextGraph,
    memoryPolicy: input.memoryPolicy,
    checkpoint: input.checkpointSession,
  });
  const first = session.compact({
    observedChars: 20_000,
    maxChars: 10_000,
    completedUnitCount: 1,
    pendingUnits: defaultPendingUnits(),
    createdAt: 2_000,
  });
  session.compact({
    observedChars: 22_000,
    maxChars: 10_000,
    completedUnitCount: 2,
    pendingUnits: defaultPendingUnits().slice(1),
    createdAt: 3_000,
  });

  assert.throws(() => session.compact({
    observedChars: 24_000,
    maxChars: 10_000,
    completedUnitCount: 2,
    pendingUnits: defaultPendingUnits().slice(1),
    priorReceipt: first,
  }), /coding-context-compaction:prior-receipt-not-latest/u);
  assert.throws(() => session.compact({
    observedChars: 24_000,
    maxChars: 10_000,
    completedUnitCount: 2,
    pendingUnits: [{ ...defaultPendingUnits()[1], target: 'another-registry' }, defaultPendingUnits()[2]],
  }), /coding-context-compaction:pending-unit-drift/u);

  const fresh = new CanonicalContextCompactionService().bind({
    taskContract: input.taskContract,
    contextGraph: input.contextGraph,
    memoryPolicy: input.memoryPolicy,
    checkpoint: input.checkpointSession,
  });
  assert.throws(() => fresh.compact({
    observedChars: 8_000,
    maxChars: 10_000,
    completedUnitCount: 1,
    pendingUnits: defaultPendingUnits(),
  }), /coding-context-compaction:budget-not-exceeded/u);
});

test('ResumeIdempotencyPort skips completed effects and blocks indeterminate replay', () => {
  const { restore } = fixture();
  const service = new CanonicalResumeIdempotencyService();
  const first = service.bind({ restore });
  const completed = first.settle({ unitId: 'edit', status: 'completed', evidenceRefs: ['write:1'] });
  const indeterminate = first.settle({
    unitId: 'publish',
    status: 'indeterminate',
    evidenceRefs: ['provider:disconnected'],
  });
  const failed = first.settle({ unitId: 'verify', status: 'failed-no-effect', evidenceRefs: ['test:failed'] });
  const resumed = service.bind({ restore, receipts: [completed, indeterminate, failed] });

  assert.deepEqual(resumed.plan.skippedUnits.map(unit => unit.id), ['edit']);
  assert.deepEqual(resumed.plan.blockedUnits.map(unit => unit.id), ['publish']);
  assert.deepEqual(resumed.plan.executableUnits.map(unit => unit.id), ['verify']);
  assert.equal(resumed.plan.executionAllowed, false);
  assert.throws(
    () => resumed.settle({ unitId: 'verify', status: 'completed', evidenceRefs: ['test:passed'] }),
    /coding-resume-idempotency:execution-blocked/u,
  );
  assert.throws(
    () => service.bind({ restore, receipts: [{ ...completed, status: 'indeterminate' }] }),
    /coding-resume-idempotency:receipt-sha256-mismatch/u,
  );
});

test('ResumeIdempotencyPort permits failed-no-effect retry and seals the later completion', () => {
  const { restore } = fixture([
    { id: 'verify', description: 'Run focused tests', action: 'verify', target: 'npm test' },
  ]);
  const service = new CanonicalResumeIdempotencyService();
  const initial = service.bind({ restore });
  const failed = initial.settle({
    unitId: 'verify',
    status: 'failed-no-effect',
    evidenceRefs: ['test:first-failure'],
  });
  const retry = service.bind({ restore, receipts: [failed] });
  assert.equal(retry.plan.executionAllowed, true);
  const completed = retry.settle({ unitId: 'verify', status: 'completed', evidenceRefs: ['test:passed'] });
  assert.equal(retry.receipts().length, 2);

  const converged = service.bind({ restore, receipts: [failed, completed] });
  assert.deepEqual(converged.plan.skippedUnits.map(unit => unit.id), ['verify']);
  assert.deepEqual(converged.plan.executableUnits, []);
  assert.equal(converged.plan.executionAllowed, true);

  const unknownPayload = {
    version: completed.version,
    checkpointId: completed.checkpointId,
    unitId: 'unknown',
    unitFingerprint: 'a'.repeat(64),
    idempotencyKey: 'b'.repeat(64),
    effectClass: 'workspace-mutation',
    status: 'completed',
    evidenceRefs: ['unknown:1'],
  };
  assert.throws(() => service.bind({
    restore,
    receipts: [{ ...unknownPayload, receiptSha256: codingSemanticDigest(unknownPayload) }],
  }), /coding-resume-idempotency:receipt-unit-mismatch/u);
});

test('CanonicalCodingKernel exposes compaction receipts and blocks indeterminate resume before runtime', async () => {
  let checkpoint;
  const firstKernel = new CanonicalCodingKernel({
    async executeCanonical(input) {
      const compacted = input.contextCompaction.compact({
        observedChars: 16_000,
        maxChars: 8_000,
        completedUnitCount: 0,
        pendingUnits: [{ id: 'publish', description: 'Publish package', action: 'deploy', target: 'registry' }],
        evidenceRefs: ['context:budget'],
        createdAt: 2_000,
      });
      checkpoint = compacted.checkpoint;
      return { status: 'completed', result: { checkpointId: checkpoint.checkpointId } };
    },
  });
  const base = {
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: 'headless',
    runId: 'kernel-context-run',
    userPrompt: 'Refactor the resume path and verify it without publishing',
    workspaceRoot: '/repo',
    taskContract: fixture().taskContract,
    contextSeed: { files: [{ path: 'src/resume.ts', contentSample: 'export const resume = true;' }] },
    runtimeContext: {},
  };
  const firstOutput = await firstKernel.execute(base);
  assert.equal(firstOutput.contextCompactions.length, 1);
  assert.equal(firstOutput.contextCompactions[0].checkpoint.checkpointId, checkpoint.checkpointId);

  let resumeCalls = 0;
  const interruptedKernel = new CanonicalCodingKernel({
    async executeCanonical(input) {
      resumeCalls += 1;
      input.resumeIdempotency.settle({
        unitId: 'publish',
        status: 'indeterminate',
        evidenceRefs: ['provider:disconnected'],
      });
      throw new Error('provider disconnected after publish');
    },
  });
  let indeterminateReceipts;
  await assert.rejects(interruptedKernel.execute({
    ...base,
    runId: 'kernel-resume-interrupted',
    resumeCheckpoint: checkpoint,
  }), error => {
    assert.equal(error instanceof CodingKernelExecutionError, true);
    assert.equal(error.resumeReceipts.length, 1);
    indeterminateReceipts = error.resumeReceipts;
    return true;
  });

  const blockedKernel = new CanonicalCodingKernel({
    async executeCanonical() {
      resumeCalls += 1;
      return { status: 'completed', result: {} };
    },
  });
  await assert.rejects(blockedKernel.execute({
    ...base,
    runId: 'kernel-resume-blocked',
    resumeCheckpoint: checkpoint,
    resumeReceipts: indeterminateReceipts,
  }), error => {
    assert.equal(error instanceof CodingKernelExecutionError, true);
    assert.equal(error.lifecycle.status, 'blocked');
    assert.match(error.message, /resume-indeterminate-effect/u);
    return true;
  });
  assert.equal(resumeCalls, 1);
});
