import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCodingKernelTaskContract } from '../../shared/dist/index.js';
import { HeadlessCodingKernelExecutor } from '../dist/index.js';
import {
  loadUserSimulationCase,
  materializeMemoryCandidates,
} from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';
import { completedRuntimeResult } from './headless-runtime-fixtures.mjs';

test('I10-MEM-01 user journey: external memory cannot become an instruction', async () => {
  const scenario = loadUserSimulationCase('I10', 'I10-MEM-01');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-memory-authority-'));
  let observedMemoryPolicy;
  try {
    const executor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        observedMemoryPolicy = request.memoryPolicy;
        return completedReview(request, { selectedMemoryIds: request.memoryPolicy.selected.map(item => item.memoryId) });
      },
    });
    const prompt = scenario.input.prompt;
    const output = await executor.execute({
      runId: 'i10-memory-authority',
      userPrompt: prompt,
      workspaceRoot,
      taskContract: reviewContract(prompt),
      memoryCandidates: materializeMemoryCandidates(scenario, { workspaceRoot }),
      runtimeContext: { journey: 'memory-authority' },
    });

    assert.deepEqual(output.result.selectedMemoryIds, ['user-preference']);
    assert.deepEqual(observedMemoryPolicy.rejected.map(item => item.memoryId), ['external-instruction']);
    assert.deepEqual(observedMemoryPolicy.rejected[0].reasonCodes, ['external-authority-elevation']);
    assert.equal(observedMemoryPolicy.rejected[0].effectiveAuthority, 'memory');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('I10-CHK-01 user journey: interrupted work resumes pending units without replay', async () => {
  const scenario = loadUserSimulationCase('I10', 'I10-CHK-01');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-checkpoint-resume-'));
  const prompt = scenario.input.prompt;
  const taskContract = reviewContract(prompt);
  let interruptedCheckpoint;
  try {
    const interrupted = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        interruptedCheckpoint = request.checkpoint.create({
          epoch: 1,
          completedUnitCount: 1,
          pendingUnits: [{
            id: scenario.input.pending_unit,
            description: 'Verify the remaining result against current workspace facts.',
          }],
          reason: 'paused',
          evidenceRefs: [`unit:${scenario.input.completed_unit}:completed`],
          createdAt: 100,
        });
        throw new Error(scenario.input.interruption);
      },
    });

    await assert.rejects(
      interrupted.execute({
        runId: 'i10-checkpoint-origin',
        userPrompt: prompt,
        workspaceRoot,
        taskContract,
        runtimeContext: { journey: 'interrupted-origin' },
      }),
      new RegExp(scenario.input.interruption, 'u'),
    );

    const executedUnits = [];
    const resumed = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        assert.equal(request.resume.requiresRevalidation, true);
        assert.equal(request.resume.contextChanged, false);
        assert.equal(request.resume.memoryPolicyChanged, false);
        for (const unit of request.resume.pendingUnits) executedUnits.push(unit.id);
        return completedReview(request, { executedUnits });
      },
    });
    const output = await resumed.execute({
      runId: 'i10-checkpoint-resumed',
      userPrompt: prompt,
      workspaceRoot,
      taskContract,
      resumeCheckpoint: interruptedCheckpoint,
      runtimeContext: { journey: 'resumed-run' },
    });

    assert.deepEqual(output.result.executedUnits, [scenario.input.pending_unit]);
    assert.equal(output.result.executedUnits.includes(scenario.input.completed_unit), false);
    assert.equal(output.resume.checkpointId, interruptedCheckpoint.checkpointId);
    assert.deepEqual(output.resume.evidenceRefs, [`unit:${scenario.input.completed_unit}:completed`]);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

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
