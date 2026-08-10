import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  InMemoryCodingOperationJournal,
  buildCodingKernelTaskContract,
  buildCodingVerificationPlan,
} from '../dist/index.js';
import { loadUserSimulationCase } from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';

test('I17-OWN-01 Surface completed claims cannot settle a verification task', async () => {
  const scenario = loadUserSimulationCase('I17', 'I17-OWN-01');
  const output = await executeScenario(scenario, {
    async executeCanonical(request) {
      return {
        status: scenario.input.surface_terminal_status,
        result: {
          surfaceTerminalStatus: scenario.input.surface_terminal_status,
          codingConformance: { completion: { status: scenario.input.surface_terminal_status } },
        },
        completionEvidence: completionEvidence({
          acceptanceEvidence: [{
            criterionId: 'verified',
            status: 'passed',
            evidenceRefs: ['surface:claimed-pass'],
          }],
          evidenceRefs: [request.taskContract.provenanceRefs[0]],
        }),
      };
    },
  });

  assert.equal(output.result.surfaceTerminalStatus, 'completed');
  assert.equal(output.status, 'blocked');
  assert.equal(output.settlement.status, 'blocked');
  assert.equal(output.completion.reasonCodes.includes('verification-not-run'), true);
  assert.deepEqual(output.verificationReceipts, []);
});

test('I17-VRF-01 exact run-bound verification authorizes Kernel completion', async () => {
  const scenario = loadUserSimulationCase('I17', 'I17-VRF-01');
  const output = await executeScenario(scenario, {
    async executeCanonical(request) {
      await request.verification.verify(verificationPlan(request, scenario.input.action_id), {
        async verify() {
          return passedVerification(scenario.input.action_id);
        },
      });
      return {
        result: { verifierInvoked: true },
        completionEvidence: completionEvidence({ evidenceRefs: ['runtime:observed-verification'] }),
      };
    },
  });

  assert.equal(output.status, 'completed');
  assert.equal(output.completion.status, 'completed');
  assert.deepEqual(output.verificationReceipts.map(receipt => receipt.status), ['passed']);
  assert.equal(output.completion.acceptance[0].status, 'passed');
});

test('I17-RUN-01 verifier evidence from another run is rejected before host dispatch', async () => {
  const scenario = loadUserSimulationCase('I17', 'I17-RUN-01');
  let hostCalls = 0;
  const output = await executeScenario(scenario, {
    async executeCanonical(request) {
      let rejection;
      try {
        await request.verification.verify(verificationPlan(request, scenario.input.action_id, {
          runId: scenario.input.foreign_run_id,
        }), {
          async verify() {
            hostCalls += 1;
            return passedVerification(scenario.input.action_id);
          },
        });
      } catch (error) {
        rejection = error instanceof Error ? error.message : String(error);
      }
      return {
        result: { rejection },
        completionEvidence: completionEvidence(),
      };
    },
  });

  assert.equal(output.result.rejection, 'coding-verification:session-run-mismatch');
  assert.equal(hostCalls, 0);
  assert.equal(output.status, 'blocked');
  assert.deepEqual(output.verificationReceipts, []);
});

test('I17-ACC-01 verifier cannot substitute a different acceptance contract', async () => {
  const scenario = loadUserSimulationCase('I17', 'I17-ACC-01');
  let hostCalls = 0;
  const output = await executeScenario(scenario, {
    async executeCanonical(request) {
      const acceptance = request.taskContract.acceptance.map(criterion => ({
        id: criterion.id,
        statement: scenario.input.drifted_statement,
      }));
      let rejection;
      try {
        await request.verification.verify(verificationPlan(request, scenario.input.action_id, {
          acceptance,
        }), {
          async verify() {
            hostCalls += 1;
            return passedVerification(scenario.input.action_id);
          },
        });
      } catch (error) {
        rejection = error instanceof Error ? error.message : String(error);
      }
      return {
        result: { rejection },
        completionEvidence: completionEvidence(),
      };
    },
  });

  assert.equal(output.result.rejection, 'coding-verification:session-acceptance-mismatch');
  assert.equal(hostCalls, 0);
  assert.equal(output.status, 'blocked');
  assert.deepEqual(output.verificationReceipts, []);
});

test('I17-RPR-01 passed revalidation resolves the failed pre-repair evidence', async () => {
  const scenario = loadUserSimulationCase('I17', 'I17-RPR-01');
  const output = await executeScenario(scenario, {
    async executeCanonical(request) {
      const failed = await request.verification.verify(
        verificationPlan(request, scenario.input.failed_action_id, { sequence: 1 }),
        {
          async verify() {
            return verificationResult(scenario.input.failed_action_id, 'failed');
          },
        },
      );
      await request.verification.verify(
        verificationPlan(request, scenario.input.passed_action_id, { sequence: 2 }),
        {
          async verify() {
            return verificationResult(scenario.input.passed_action_id, 'passed');
          },
        },
      );
      return {
        result: { repairAttempts: 1 },
        completionEvidence: completionEvidence({
          evidenceRefs: ['repair:applied'],
        }),
      };
    },
  });

  assert.deepEqual(output.verificationReceipts.map(receipt => receipt.status), ['failed', 'passed']);
  assert.equal(output.result.repairAttempts, 1);
  assert.equal(output.status, 'completed');
  assert.equal(output.completion.acceptance[0].status, 'passed');
  assert.equal(output.completion.reasonCodes.includes('verification-failed'), false);
});

function executeScenario(scenario, runtime) {
  const taskContract = buildCodingKernelTaskContract({
    goal: scenario.input.prompt,
    mode: 'change',
    include: ['src/value.ts'],
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/value.ts' }],
    acceptance: [{
      id: 'verified',
      statement: 'The requested behavior passes verification.',
      deliverableIds: ['source'],
      oracle: {
        kind: 'verification',
        verifier: 'project-test-runner',
        scope: ['src/value.ts'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
  });
  return new CanonicalCodingKernel(runtime).execute({
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: scenario.input.surface,
    runId: scenario.input.run_id,
    userPrompt: scenario.input.prompt,
    workspaceRoot: '/workspace',
    taskContract,
    operationJournal: new InMemoryCodingOperationJournal(),
    runtimeContext: { simulationCaseId: scenario.case_id },
  });
}

function verificationPlan(request, actionId, overrides = {}) {
  const runId = overrides.runId ?? request.runId;
  return buildCodingVerificationPlan({
    runId,
    sequence: overrides.sequence ?? 1,
    actionId,
    idempotencyKey: `${runId}:${actionId}`,
    scopePaths: ['src/value.ts'],
    acceptance: overrides.acceptance ?? request.taskContract.acceptance.map(({ id, statement }) => ({
      id,
      statement,
    })),
    payload: { command: 'npm test' },
    evidenceRefs: [],
  });
}

function passedVerification(actionId) {
  return verificationResult(actionId, 'passed');
}

function verificationResult(actionId, status) {
  return {
    verifier: 'project-test-runner',
    checks: [{
      checkId: `${actionId}:requested-behavior`,
      status,
      acceptanceIds: ['verified'],
      summary: status === 'passed' ? 'Requested behavior passed.' : 'Requested behavior still failed.',
      exitCode: status === 'passed' ? 0 : 1,
      evidenceRefs: [`verification:${actionId}:${status}`],
    }],
    evidenceRefs: [],
  };
}

function completionEvidence(overrides = {}) {
  return {
    reviewRequired: false,
    acceptanceEvidence: [],
    pendingRefs: [],
    adverseEvidenceRefs: [],
    residualRisks: [],
    evidenceRefs: [],
    ...overrides,
  };
}
