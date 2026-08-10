import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CodingKernelExecutionError,
  buildCodingKernelTaskContract,
  renderCodingContextCompactionReceipt,
} from '../../shared/dist/index.js';
import { HeadlessCodingKernelExecutor } from '../dist/index.js';
import { loadUserSimulationCase } from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';
import { completedRuntimeResult } from './headless-runtime-fixtures.mjs';

test('I11-CMP-01 user journey: three context compactions preserve canonical facts and progress', async () => {
  const scenario = loadUserSimulationCase('I11', 'I11-CMP-01');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-context-compaction-'));
  const prompt = scenario.input.prompt;
  const taskContract = reviewContract(prompt);
  try {
    const executor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        let receipt;
        for (let pass = 1; pass <= scenario.input.compaction_passes; pass += 1) {
          receipt = request.contextCompaction.compact({
            observedChars: 70_000 + pass,
            maxChars: 52_000,
            completedUnitCount: pass - 1,
            pendingUnits: scenario.input.pending_units.slice(pass - 1),
            evidenceRefs: [`i11:compaction:${pass}`],
            createdAt: 1_000 + pass,
          });
        }
        return completedReview(request, { receipt });
      },
    });
    const output = await executor.execute({
      runId: 'i11-context-compaction',
      userPrompt: prompt,
      workspaceRoot,
      taskContract,
      memoryCandidates: [{
        memoryId: scenario.input.stale_memory_id,
        content: scenario.input.stale_memory_content,
        scope: 'repository',
        classification: 'workspace',
        sourceKind: 'task-history',
        status: 'active',
        approvalState: 'not-required',
        externalContent: false,
        trusted: true,
        workspaceRoot,
        createdAt: 1,
        updatedAt: 2,
        expiresAt: 3,
      }],
      contextSeed: { files: [{ path: 'src/resume.ts', contentSample: 'export const resume = true;' }] },
      runtimeContext: { journey: 'three-pass-context-compaction' },
    });

    assert.equal(output.contextCompactions.length, 3);
    assert.deepEqual(output.contextCompactions.map(receipt => receipt.pass), [1, 2, 3]);
    assert.deepEqual(output.contextCompactions.map(receipt => receipt.completedUnitCount), [0, 1, 2]);
    assert.equal(output.contextCompactions[1].parentReceiptSha256, output.contextCompactions[0].receiptSha256);
    assert.equal(output.contextCompactions[2].parentReceiptSha256, output.contextCompactions[1].receiptSha256);
    assert.deepEqual(output.contextCompactions[2].rejectedMemoryIds, [scenario.input.stale_memory_id]);
    assert.deepEqual(output.contextCompactions[2].pendingUnits.map(unit => unit.id), ['finalize']);
    assert.equal(output.contextCompactions.every(receipt => receipt.requiresRevalidation), true);
    const rendered = renderCodingContextCompactionReceipt(output.contextCompactions[2]);
    assert.equal(rendered.includes('fixture-context-secret-123456'), false);
    assert.equal(rendered.includes('fixture-context-bearer-123456'), false);
    assert.equal(rendered.includes(scenario.input.stale_memory_content), false);
    assert.match(rendered, /stale-resume-target/u);
    assert.match(rendered, /workspace-file:src\/resume\.ts/u);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('I11-RSM-01 user journey: completed workspace effect is skipped on a second resume', async () => {
  const scenario = loadUserSimulationCase('I11', 'I11-RSM-01');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-resume-skip-'));
  const prompt = scenario.input.prompt;
  const taskContract = reviewContract(prompt);
  try {
    const checkpoint = await createInterruptedCheckpoint({
      workspaceRoot,
      prompt,
      taskContract,
      pendingUnit: scenario.input.pending_unit,
      runId: 'i11-resume-skip-origin',
    });
    let effectExecutions = 0;
    const firstResume = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        assert.deepEqual(request.resumeIdempotency.plan.executableUnits.map(unit => unit.id), ['apply-edit']);
        effectExecutions += 1;
        request.resumeIdempotency.settle({
          unitId: 'apply-edit',
          status: 'completed',
          evidenceRefs: ['workspace-mutation:committed'],
        });
        return completedReview(request, { effectExecutions });
      },
    });
    const first = await firstResume.execute({
      runId: 'i11-resume-skip-first',
      userPrompt: prompt,
      workspaceRoot,
      taskContract,
      resumeCheckpoint: checkpoint,
      runtimeContext: { journey: 'first-resume' },
    });

    const secondResume = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        assert.deepEqual(request.resumeIdempotency.plan.executableUnits, []);
        assert.deepEqual(request.resumeIdempotency.plan.skippedUnits.map(unit => unit.id), ['apply-edit']);
        return completedReview(request, { effectExecutions });
      },
    });
    const second = await secondResume.execute({
      runId: 'i11-resume-skip-second',
      userPrompt: prompt,
      workspaceRoot,
      taskContract,
      resumeCheckpoint: checkpoint,
      resumeReceipts: first.resumeReceipts,
      runtimeContext: { journey: 'second-resume' },
    });

    assert.equal(effectExecutions, 1);
    assert.equal(second.result.effectExecutions, 1);
    assert.equal(second.resumeReceipts[0].status, 'completed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('I11-RSM-02 user journey: indeterminate external effect blocks replay before runtime', async () => {
  const scenario = loadUserSimulationCase('I11', 'I11-RSM-02');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-resume-block-'));
  const prompt = scenario.input.prompt;
  const taskContract = reviewContract(prompt);
  try {
    const checkpoint = await createInterruptedCheckpoint({
      workspaceRoot,
      prompt,
      taskContract,
      pendingUnit: scenario.input.pending_unit,
      runId: 'i11-resume-block-origin',
    });
    const interrupted = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        request.resumeIdempotency.settle({
          unitId: scenario.input.pending_unit.id,
          status: 'indeterminate',
          evidenceRefs: ['provider:disconnected-after-effect'],
        });
        throw new Error(scenario.input.interruption);
      },
    });
    let receipts;
    await assert.rejects(interrupted.execute({
      runId: 'i11-resume-block-interrupted',
      userPrompt: prompt,
      workspaceRoot,
      taskContract,
      resumeCheckpoint: checkpoint,
      runtimeContext: { journey: 'indeterminate-effect' },
    }), error => {
      assert.equal(error instanceof CodingKernelExecutionError, true);
      assert.equal(error.resumeReceipts[0].status, 'indeterminate');
      receipts = error.resumeReceipts;
      return true;
    });

    let replayCalls = 0;
    const blocked = new HeadlessCodingKernelExecutor({
      async executeCanonical() {
        replayCalls += 1;
        throw new Error('blocked replay must not reach runtime');
      },
    });
    await assert.rejects(blocked.execute({
      runId: 'i11-resume-block-retry',
      userPrompt: prompt,
      workspaceRoot,
      taskContract,
      resumeCheckpoint: checkpoint,
      resumeReceipts: receipts,
      runtimeContext: { journey: 'blocked-replay' },
    }), error => {
      assert.equal(error instanceof CodingKernelExecutionError, true);
      assert.equal(error.lifecycle.status, 'blocked');
      assert.match(error.message, /resume-indeterminate-effect/u);
      return true;
    });
    assert.equal(replayCalls, 0);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

async function createInterruptedCheckpoint(input) {
  let checkpoint;
  const executor = new HeadlessCodingKernelExecutor({
    async executeCanonical(request) {
      checkpoint = request.checkpoint.create({
        epoch: 1,
        completedUnitCount: 0,
        pendingUnits: [input.pendingUnit],
        reason: 'paused',
        evidenceRefs: ['user:interrupted'],
        createdAt: 100,
      });
      throw new Error('simulated user interruption');
    },
  });
  await assert.rejects(executor.execute({
    runId: input.runId,
    userPrompt: input.prompt,
    workspaceRoot: input.workspaceRoot,
    taskContract: input.taskContract,
    runtimeContext: { journey: 'origin-interruption' },
  }), /simulated user interruption/u);
  return checkpoint;
}

function reviewContract(goal) {
  return buildCodingKernelTaskContract({
    goal,
    mode: 'review',
    deliverables: [{ id: 'report', kind: 'report' }],
    acceptance: [{
      id: 'reported',
      statement: 'Verified findings are reported.',
      deliverableIds: ['report'],
      oracle: {
        kind: 'response-evidence',
        verifier: 'headless-review-adapter',
        scope: ['response'],
        evidenceKinds: ['response-evidence'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
  });
}

function completedReview(request, value) {
  return completedRuntimeResult(request, value, { evidencePrefix: 'review' });
}
