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
  buildCodingVerificationPlan,
  buildCodingKernelTaskContract,
  createFixtureCodingKernelEnvironment,
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

let harnessSequence = 0;

function createHarness({
  responses = [{ candidateCount: 1 }],
  changedFiles = [['src/value.ts']],
  validations = [{ passed: true, summary: 'passed', evidenceRefs: ['verify:passed'] }],
  repairResult = 'repaired response',
  usesBridge = false,
  mode = 'change',
  prompt = 'Change the value, but intentionally fail the first response.',
} = {}) {
  harnessSequence += 1;
  const interpreted = [];
  const mutations = [];
  const verifications = [];
  const repairRequests = [];
  const evidence = [];
  const events = [];
  const bridgeAssertions = [];
  const plannedFiles = [...new Set(changedFiles.flat())];
  const deliverables = plannedFiles.map((filePath, index) => ({
    id: `source-${index + 1}`,
    kind: 'source-change',
    path: filePath,
  }));

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
    async prepare(request) {
      verifications.push(request);
      return { input: request };
    },
    async execute(preparation, ports) {
      const request = preparation.input;
      const result = validations[Math.min(verifications.length - 1, validations.length - 1)];
      return ports.verification.verify(buildCodingVerificationPlan({
        runId: request.runId,
        sequence: request.sequence,
        actionId: request.actionId,
        idempotencyKey: `${request.runId}:${request.actionId}`,
        scopePaths: request.files,
        acceptance: request.acceptance,
        payload: {
          workspaceRoot: request.workspaceRoot,
          files: request.files,
          prompt: request.prompt,
        },
        evidenceRefs: request.evidenceRefs,
      }), {
        async verify() {
          const status = result.status ?? (result.passed ? 'passed' : 'failed');
          const evidenceRefs = result.evidenceRefs ?? [];
          return {
            verifier: status === 'unverified' ? 'none' : 'test-verifier',
            checks: status === 'unverified' ? [] : [{
              checkId: `check-${request.actionId}`,
              status,
              acceptanceIds: request.acceptance.map(criterion => criterion.id),
              summary: result.summary,
              evidenceRefs,
            }],
            evidenceRefs,
          };
        },
      });
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
    runId: `cli-runtime-run-${harnessSequence}`,
    userPrompt: prompt,
    workspaceRoot: '/workspace',
    signal: new AbortController().signal,
    taskContract: buildCodingKernelTaskContract({
      goal: prompt,
      mode,
      include: plannedFiles,
      deliverables,
      acceptance: [{
        id: 'verified',
        statement: 'The change passes verification.',
        deliverableIds: deliverables.map(deliverable => deliverable.id),
        oracle: {
          kind: 'verification',
          verifier: 'cli-test-adapter',
          scope: plannedFiles,
          evidenceKinds: ['verification-receipt'],
        },
        externalBoundaryRefs: [],
      }],
      provenanceRefs: ['test-prompt'],
    }),
    operationJournal: new InMemoryCodingOperationJournal(),
    environment: createFixtureCodingKernelEnvironment('/workspace', usesBridge ? 'bridge' : 'local-api'),
    runtimeContext: {
      response: 'initial response',
      usesBridge,
      async requestRepair(repairRequest) {
        repairRequests.push(repairRequest);
        const repairIndex = repairRequests.length - 1;
        const candidate = typeof repairResult === 'function'
          ? await repairResult(repairRequest, repairIndex)
          : Array.isArray(repairResult)
            ? repairResult[Math.min(repairIndex, repairResult.length - 1)]
            : repairResult;
        if (candidate instanceof Error) throw candidate;
        return candidate;
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
  assert.deepEqual(output.toolExecutionReceipts, []);
  assert.deepEqual(output.workspaceMutationReceipts, []);
  assert.deepEqual(output.verificationReceipts, []);
  assert.equal(output.result.verification.status, 'not-run');
  assert.equal(output.completion.status, 'blocked');
  assert.equal(output.completion.reasonCodes.includes('verification-not-run'), true);
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
  assert.deepEqual(output.workspaceMutationReceipts, []);
  assert.deepEqual(output.verificationReceipts, []);
  assert.equal(output.toolExecutionReceipts.length, 1);
  assert.equal(output.toolExecutionReceipts[0].tool, 'run_terminal');
  assert.equal(output.toolExecutionReceipts[0].status, 'denied');
  assert.equal(output.toolExecutionReceipts[0].permission.status, 'denied');
  assert.deepEqual(output.toolExecutionReceipts[0].effects, [
    'process',
    'network',
    'workspace-mutation',
  ]);
  assert.equal(output.result.verification.status, 'not-run');
  assert.equal(output.completion.status, 'blocked');
  assert.deepEqual(output.completion.residualRisks, ['requested-change-not-applied']);
  assert.equal(output.codeChangeDecisions[0].status, 'incomplete');
  assert.equal(output.integrationConformanceDecisions[0].status, 'incomplete');
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
  assert.deepEqual(harness.events.map(event => event.type), [
    'fileChanges.proposed',
    'validation.completed',
    'qualityGate.completed',
  ]);
  assert.deepEqual(harness.events[0].files, ['src/value.ts']);
  assert.equal(harness.events[1].passed, true);
  assert.equal(harness.events[1].evidenceRefs.includes('verify:passed'), true);
  assert.equal(harness.events[2].passed, true);
  assert.equal(harness.events[2].evidenceRefs.includes('verify:passed'), true);
  assert.deepEqual(output.result.changedPaths, ['src/value.ts']);
  assert.equal(output.toolExecutionReceipts.length, 2);
  assert.equal(output.toolExecutionReceipts[0].status, 'completed');
  assert.equal(output.toolExecutionReceipts[0].permission.status, 'authorized');
  assert.equal(output.toolExecutionReceipts[1].tool, 'run_terminal');
  assert.equal(output.toolExecutionReceipts[1].status, 'completed');
  assert.equal(output.toolExecutionReceipts[1].result.status, 'passed');
  assert.equal(output.workspaceMutationReceipts.length, 1);
  assert.equal(output.workspaceMutationReceipts[0].status, 'committed');
  assert.ok(output.workspaceMutationReceipts[0].baselineRef);
  assert.ok(output.workspaceMutationReceipts[0].readbackRef);
  assert.equal(output.result.verification.status, 'passed');
  assert.equal(output.verificationReceipts.length, 1);
  assert.equal(output.verificationReceipts[0].status, 'passed');
  assert.equal(output.completion.status, 'completed');
});

test('canonical CLI runtime reports a proposed workspace escape before mutation', async () => {
  const harness = createHarness({ changedFiles: [['../escaped.ts']] });

  const output = await harness.kernel.execute(harness.request);

  assert.equal(output.status, 'blocked');
  assert.equal(output.toolExecutionReceipts[0].status, 'denied');
  assert.match(output.toolExecutionReceipts[0].permission.reason, /workspace-path-outside-root/u);
  assert.equal(harness.mutations.length, 0);
  assert.equal(harness.verifications.length, 0);
});

test('canonical CLI runtime fails closed when a non-mutating task proposes a workspace write', async () => {
  const harness = createHarness({ mode: 'review' });

  const output = await harness.kernel.execute(harness.request);

  assert.equal(output.status, 'blocked');
  assert.equal(output.taskContract.mode, 'review');
  assert.equal(output.toolExecutionReceipts[0].status, 'denied');
  assert.equal(output.toolExecutionReceipts[0].permission.reason, 'sandbox-denies-workspace-mutation');
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
  assert.equal(output.verificationReceipts[0].status, 'unverified');
  assert.equal(output.toolExecutionReceipts.at(-1).status, 'failed');
  assert.equal(output.toolExecutionReceipts.at(-1).result.status, 'unverified');
  assert.equal(output.completion.status, 'blocked');
  assert.equal(output.completion.reasonCodes.includes('verification-incomplete'), true);
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

test('I19-RPR-01 user journey: one root-cause replan lets changed repair evidence succeed', async () => {
  const harness = createHarness({
    responses: [
      { candidateCount: 1 },
      { candidateCount: 1 },
      { candidateCount: 1 },
    ],
    validations: [
      { passed: false, summary: 'typecheck failed: TS2322', evidenceRefs: ['verify:failed:1'] },
      { passed: false, summary: 'typecheck failed: TS2322', evidenceRefs: ['verify:failed:2'] },
      { passed: true, summary: 'passed', evidenceRefs: ['verify:passed'] },
    ],
    repairResult: ['changed repair response', 'root-cause repair response'],
  });

  const output = await harness.kernel.execute(harness.request);

  assert.deepEqual(harness.interpreted, [
    'initial response',
    'changed repair response',
    'root-cause repair response',
  ]);
  assert.equal(harness.repairRequests.length, 2);
  assert.match(harness.repairRequests[1].prompt, /Canonical repair decision: replan/);
  assert.match(harness.repairRequests[1].prompt, /change the root-cause hypothesis/);
  assert.deepEqual(output.repairDecisions.map(decision => decision.action), ['retry', 'replan']);
  assert.deepEqual(output.repairDecisions.map(decision => decision.repeatedMutation), [false, false]);
  assert.equal(output.result.attempts, 3);
  assert.equal(output.status, 'completed');
});

test('I19-RPR-02 user journey: identical repair stops before another provider turn', async () => {
  const harness = createHarness({
    responses: [{ candidateCount: 1 }, { candidateCount: 1 }],
    validations: [
      { passed: false, summary: 'tests failed: same assertion', evidenceRefs: ['verify:failed:1'] },
      { passed: false, summary: 'tests failed: same assertion', evidenceRefs: ['verify:failed:2'] },
    ],
    repairResult: 'initial response',
  });

  let caught;
  try {
    await harness.kernel.execute(harness.request);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.match(caught.message, /repeated-mutation-no-progress/);
  assert.equal(harness.mutations.length, 2);
  assert.equal(harness.verifications.length, 2);
  assert.equal(harness.repairRequests.length, 1);
  assert.deepEqual(caught.repairDecisions.map(decision => decision.action), ['retry', 'blocked']);
  assert.equal(caught.repairDecisions[1].repeatedDiagnostic, true);
  assert.equal(caught.repairDecisions[1].repeatedMutation, true);
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

  const output = await harness.kernel.execute(harness.request);

  assert.equal(output.status, 'blocked');
  assert.equal(output.toolExecutionReceipts[0].status, 'denied');
  assert.match(output.toolExecutionReceipts[0].permission.reason, /protected-path/u);
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
  assert.equal(output.toolExecutionReceipts[0].status, 'denied');
  assert.deepEqual(output.toolExecutionReceipts[0].effects, ['process', 'workspace-mutation']);
  assert.equal(output.toolExecutionReceipts[0].permission.decision, 'deny');
  assert.equal(
    output.toolExecutionReceipts[0].evidenceRefs.some(ref => ref.includes('cli-terminal-policy')),
    true,
  );
});
