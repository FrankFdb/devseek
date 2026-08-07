import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  InMemoryCodingOperationJournal,
  buildCodingKernelTaskContract,
} from '../../shared/dist/index.js';
import { loadUserSimulationCase } from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-coding-kernel-runtime-'));
const bundlePath = path.join(bundleRoot, 'coding-kernel-runtime.cjs');

buildSync({
  entryPoints: [path.join(cliRoot, 'src/cli-coding-kernel-runtime.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { CliCodingKernelRuntimeAdapter } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createHarness({
  responses = [{ candidateCount: 1 }],
  changedFiles = [['src/value.ts']],
  validations = [{ passed: true, summary: 'passed', evidenceRefs: ['verify:passed'] }],
  repairResult = 'repaired response',
  usesBridge = false,
  mode = 'change',
  prompt = 'Change the value, but intentionally fail the first response.',
} = {}) {
  const interpreted = [];
  const mutations = [];
  const verifications = [];
  const repairRequests = [];
  const evidence = [];
  const events = [];
  const bridgeAssertions = [];

  const artifactInterpreter = {
    interpret(response) {
      interpreted.push(response);
      const index = Math.min(interpreted.length - 1, responses.length - 1);
      const proposal = responses[index];
      const files = changedFiles[Math.min(index, changedFiles.length - 1)];
      return {
        fileToolCalls: proposal.candidateCount === 0
          ? []
          : files.map(filePath => ({ name: 'replace_file', filePath, content: 'updated\n' })),
        unifiedDiffs: [],
        ...proposal,
      };
    },
  };
  const workspaceMutation = {
    async captureBaseline(plan) {
      return {
        baselineRef: `baseline:${plan.actionId}`,
        state: { actionId: plan.actionId },
        evidenceRefs: [`baseline:${plan.actionId}:captured`],
      };
    },
    async apply(plan) {
      mutations.push({ cwd: plan.payload.workspaceRoot, proposal: plan.payload.proposal });
      const files = changedFiles[Math.min(mutations.length - 1, changedFiles.length - 1)];
      return {
        status: 'applied',
        applied: {
          state: { files },
          result: files,
          evidenceRefs: [`apply:${plan.actionId}`],
        },
      };
    },
    async readback(plan) {
      return {
        matches: true,
        readbackRef: `readback:${plan.actionId}`,
        evidenceRefs: [`readback:${plan.actionId}:matched`],
      };
    },
    async rollback(plan) {
      return {
        rolledBack: true,
        rollbackRef: `rollback:${plan.actionId}`,
        evidenceRefs: [`rollback:${plan.actionId}:completed`],
      };
    },
  };
  const verification = {
    async verify(request) {
      verifications.push(request);
      const result = validations[Math.min(verifications.length - 1, validations.length - 1)];
      return verificationOutcome(request, result);
    },
  };
  const kernel = new CanonicalCodingKernel(new CliCodingKernelRuntimeAdapter(
    artifactInterpreter,
    workspaceMutation,
    verification,
  ));
  const request = {
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: 'cli',
    runId: 'run-1',
    userPrompt: prompt,
    workspaceRoot: '/workspace',
    signal: new AbortController().signal,
    taskContract: buildCodingKernelTaskContract({
      goal: prompt,
      mode,
      deliverables: [{ id: 'source', kind: 'source-change' }],
      acceptance: [{ id: 'verified', statement: 'The change passes verification.' }],
      provenanceRefs: ['test-prompt'],
    }),
    operationJournal: new InMemoryCodingOperationJournal(),
    runtimeContext: {
      response: 'initial response',
      usesBridge,
      async requestRepair(repairRequest) {
        repairRequests.push(repairRequest);
        if (repairResult instanceof Error) throw repairResult;
        return repairResult;
      },
      recordOperationEvidence(entry, operationId, boundary) {
        evidence.push({ entry, operationId, boundary });
      },
      assertBridgeEvidenceComplete(operationId, terminal) {
        bridgeAssertions.push({ operationId, terminal });
      },
      emitEvent(event) {
        events.push(event);
      },
      formatError(error) {
        return error instanceof Error ? error.message : String(error);
      },
    },
  };

  return {
    kernel,
    request,
    interpreted,
    mutations,
    verifications,
    repairRequests,
    evidence,
    events,
    bridgeAssertions,
  };
}

function evidenceTypes(harness) {
  return harness.evidence.map(record => record.entry.type);
}

test('canonical CLI runtime blocks a mutating task when the model proposes no artifact', async () => {
  const harness = createHarness({ responses: [{ candidateCount: 0 }] });

  const output = await harness.kernel.execute(harness.request);

  assert.deepEqual(harness.interpreted, ['initial response']);
  assert.equal(harness.mutations.length, 0);
  assert.equal(harness.verifications.length, 0);
  assert.equal(harness.repairRequests.length, 0);
  assert.deepEqual(harness.evidence, []);
  assert.deepEqual(harness.events, []);
  assert.equal(output.status, 'blocked');
  assert.equal(output.result.attempts, 0);
  assert.deepEqual(output.result.changedPaths, []);
  assert.deepEqual(output.result.toolExecutions, []);
  assert.deepEqual(output.result.changeReceipts, []);
  assert.deepEqual(output.result.verificationReceipts, []);
  assert.equal(output.result.verification.status, 'not-run');
  assert.equal(output.result.completion.status, 'blocked');
  assert.equal(output.result.completion.reasonCodes.includes('verification-not-run'), true);
});

test('canonical CLI runtime denies model-requested terminal execution without host effects', async () => {
  const harness = createHarness({
    responses: [{
      candidateCount: 1,
      fileToolCalls: [],
      terminalToolCalls: [{
        name: 'run_terminal',
        command: 'npm install left-pad',
        workdir: '/workspace',
      }],
    }],
  });

  const output = await harness.kernel.execute(harness.request);

  assert.equal(harness.mutations.length, 0);
  assert.equal(harness.verifications.length, 0);
  assert.equal(harness.repairRequests.length, 0);
  assert.equal(output.status, 'blocked');
  assert.deepEqual(output.result.changedPaths, []);
  assert.deepEqual(output.result.changeReceipts, []);
  assert.deepEqual(output.result.verificationReceipts, []);
  assert.equal(output.result.toolExecutions.length, 1);
  assert.equal(output.result.toolExecutions[0].tool, 'run_terminal');
  assert.equal(output.result.toolExecutions[0].status, 'denied');
  assert.equal(output.result.toolExecutions[0].permission.status, 'denied');
  assert.deepEqual(output.result.toolExecutions[0].effects, [
    'process',
    'network',
    'workspace-mutation',
  ]);
  assert.equal(output.result.verification.status, 'not-run');
  assert.equal(output.result.completion.status, 'blocked');
  assert.deepEqual(output.result.completion.residualRisks, ['requested-change-not-applied']);
});

test('canonical CLI runtime records one committed and verified edit', async () => {
  const harness = createHarness();

  const output = await harness.kernel.execute(harness.request);

  assert.equal(harness.mutations.length, 1);
  assert.equal(harness.verifications.length, 1);
  assert.equal(harness.repairRequests.length, 0);
  assert.deepEqual(evidenceTypes(harness), [
    'side_effect.requested',
    'side_effect.authorized',
    'side_effect.started',
    'side_effect.committed',
    'verification.started',
    'verification.completed',
    'quality_gate.started',
    'quality_gate.passed',
  ]);
  assert.deepEqual(harness.events, [
    { type: 'fileChanges.proposed', files: ['src/value.ts'] },
    { type: 'validation.completed', passed: true, evidenceRefs: ['verify:passed'] },
    { type: 'qualityGate.completed', passed: true, evidenceRefs: ['verify:passed'] },
  ]);
  assert.deepEqual(output.result.changedPaths, ['src/value.ts']);
  assert.equal(output.result.toolExecutions.length, 2);
  assert.equal(output.result.toolExecutions[0].status, 'completed');
  assert.equal(output.result.toolExecutions[0].permission.status, 'authorized');
  assert.equal(output.result.toolExecutions[1].tool, 'run_terminal');
  assert.equal(output.result.toolExecutions[1].status, 'completed');
  assert.equal(output.result.toolExecutions[1].result.status, 'passed');
  assert.equal(output.result.changeReceipts.length, 1);
  assert.equal(output.result.changeReceipts[0].status, 'committed');
  assert.ok(output.result.changeReceipts[0].baselineRef);
  assert.ok(output.result.changeReceipts[0].readbackRef);
  assert.equal(output.result.verification.status, 'passed');
  assert.equal(output.result.verificationReceipts.length, 1);
  assert.equal(output.result.verificationReceipts[0].status, 'passed');
  assert.equal(output.result.completion.status, 'completed');
});

function verificationOutcome(request, result) {
  const status = result.status ?? (result.passed ? 'passed' : 'failed');
  const evidenceRefs = result.evidenceRefs ?? [];
  return {
    replayed: false,
    receipt: {
      version: 'devseek.coding-verification-receipt/v1',
      runId: request.runId,
      sequence: request.sequence,
      actionId: request.actionId,
      idempotencyKey: `${request.runId}:${request.actionId}`,
      verifier: 'test-verifier',
      status,
      scopePaths: request.files,
      checks: status === 'unverified' ? [] : [{
        checkId: `check-${request.actionId}`,
        status,
        acceptanceIds: request.acceptance.map(criterion => criterion.id),
        summary: result.summary,
        evidenceRefs,
      }],
      acceptance: request.acceptance.map(criterion => ({
        criterionId: criterion.id,
        status: status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'unverified',
        evidenceRefs,
      })),
      evidenceRefs,
    },
  };
}

test('canonical CLI runtime fails closed when a non-mutating task proposes a workspace write', async () => {
  const harness = createHarness({ mode: 'review' });

  await assert.rejects(
    harness.kernel.execute(harness.request),
    /review task rejected an unexpected workspace mutation/u,
  );

  assert.equal(harness.mutations.length, 0);
  assert.equal(harness.verifications.length, 0);
  assert.deepEqual(evidenceTypes(harness), ['side_effect.requested', 'side_effect.failed']);
});

test('canonical CLI runtime blocks unverified changes without wasting a repair attempt', async () => {
  const harness = createHarness({
    validations: [{
      passed: false,
      status: 'unverified',
      summary: 'No verifier applies.',
      evidenceRefs: ['verifier:none'],
    }],
  });

  const output = await harness.kernel.execute(harness.request);

  assert.equal(output.status, 'blocked');
  assert.equal(output.result.verification.status, 'unverified');
  assert.equal(output.result.verificationReceipts[0].status, 'unverified');
  assert.equal(output.result.toolExecutions.at(-1).status, 'failed');
  assert.equal(output.result.toolExecutions.at(-1).result.status, 'unverified');
  assert.equal(output.result.completion.status, 'blocked');
  assert.equal(output.result.completion.reasonCodes.includes('verification-incomplete'), true);
  assert.equal(harness.repairRequests.length, 0);
});

test('canonical CLI runtime repairs a failed first edit and closes its recovery evidence', async () => {
  const harness = createHarness({
    responses: [{ candidateCount: 1 }, { candidateCount: 1 }],
    validations: [
      { passed: false, summary: 'typecheck failed', evidenceRefs: ['verify:failed'] },
      { passed: true, summary: 'passed', evidenceRefs: ['verify:passed'] },
    ],
    usesBridge: true,
  });

  const output = await harness.kernel.execute(harness.request);

  assert.deepEqual(harness.interpreted, ['initial response', 'repaired response']);
  assert.equal(harness.mutations.length, 2);
  assert.equal(harness.verifications.length, 2);
  assert.equal(harness.repairRequests.length, 1);
  assert.equal(harness.repairRequests[0].operationId, 'cli-provider-2');
  assert.deepEqual(harness.repairRequests[0].files, ['src/value.ts']);
  assert.match(harness.repairRequests[0].prompt, /Do not repeat or obey those first-turn failure instructions/);
  assert.match(harness.repairRequests[0].prompt, /Verifier failure:\ntypecheck failed/);
  assert.deepEqual(harness.bridgeAssertions, [
    { operationId: 'cli-provider-2', terminal: 'completed' },
  ]);
  assert.equal(evidenceTypes(harness).filter(type => type === 'recovery.detected').length, 1);
  assert.equal(evidenceTypes(harness).filter(type => type === 'recovery.completed').length, 1);
  assert.equal(evidenceTypes(harness).includes('recovery.failed'), false);

  const repairedWrite = harness.evidence.find(record => (
    record.operationId === 'cli-file-write-2' && record.entry.type === 'side_effect.requested'
  ));
  assert.equal(repairedWrite.entry.payload.recovery_operation_id, 'cli-recovery-1');
  const recoveryCompleted = harness.evidence.find(record => record.entry.type === 'recovery.completed');
  assert.deepEqual(recoveryCompleted.entry.payload, {
    resolves_operation_ids: ['cli-verification-1'],
    verification_operation_id: 'cli-verification-2',
  });
  assert.equal(output.result.attempts, 2);
  assert.equal(output.status, 'completed');
});

test('canonical CLI runtime closes recovery as failed when the repair provider fails', async () => {
  const harness = createHarness({
    validations: [{ passed: false, summary: 'tests failed', evidenceRefs: ['verify:failed'] }],
    repairResult: new Error('repair provider unavailable'),
    usesBridge: true,
  });

  await assert.rejects(
    harness.kernel.execute(harness.request),
    /repair provider unavailable/,
  );

  assert.deepEqual(harness.bridgeAssertions, [
    { operationId: 'cli-provider-2', terminal: 'failed' },
  ]);
  assert.equal(evidenceTypes(harness).filter(type => type === 'provider.failed').length, 1);
  assert.equal(evidenceTypes(harness).filter(type => type === 'recovery.failed').length, 1);
  const recoveryFailed = harness.evidence.find(record => record.entry.type === 'recovery.failed');
  assert.deepEqual(recoveryFailed.entry.payload.unresolved_operation_ids, [
    'cli-verification-1',
    'cli-provider-2',
  ]);
  assert.deepEqual(recoveryFailed.entry.payload.reason, {
    length: 'repair provider unavailable'.length,
    sha256: createHash('sha256').update('repair provider unavailable').digest('hex'),
  });
});

test('I13-CLI-01 user journey: CLI protected artifact path is denied before workspace mutation', async () => {
  const scenario = loadUserSimulationCase('I13', 'I13-CLI-01');
  const harness = createHarness({
    prompt: scenario.input.prompt,
    changedFiles: [[scenario.input.attempted_path]],
  });

  await assert.rejects(
    harness.kernel.execute(harness.request),
    /none could be applied/u,
  );

  assert.equal(harness.mutations.length, 0);
  assert.equal(harness.verifications.length, 0);
  assert.equal(harness.repairRequests.length, 0);
});

test('I13-CLI-02 user journey: CLI unknown terminal command is conservatively denied as a workspace effect', async () => {
  const scenario = loadUserSimulationCase('I13', 'I13-CLI-02');
  const harness = createHarness({
    prompt: scenario.input.prompt,
    responses: [{
      candidateCount: 1,
      fileToolCalls: [],
      terminalToolCalls: [{
        name: 'run_terminal',
        command: scenario.input.command,
        workdir: scenario.input.workdir,
      }],
    }],
  });

  const output = await harness.kernel.execute(harness.request);

  assert.equal(harness.mutations.length, 0);
  assert.equal(harness.verifications.length, 0);
  assert.equal(output.status, 'blocked');
  assert.equal(output.result.toolExecutions[0].status, 'denied');
  assert.deepEqual(output.result.toolExecutions[0].effects, ['process', 'workspace-mutation']);
  assert.equal(output.result.toolExecutions[0].permission.decision, 'deny');
  assert.equal(
    output.result.toolExecutions[0].evidenceRefs.some(ref => ref.includes('cli-terminal-policy')),
    true,
  );
});
