import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-legacy-coding-loop-'));
const bundlePath = path.join(bundleRoot, 'legacy-coding-loop.cjs');

buildSync({
  entryPoints: [path.join(cliRoot, 'src/cli-legacy-coding-loop.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { CliLegacyCodingLoop } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createHarness({
  responses = [{ candidateCount: 1 }],
  changedFiles = [['src/value.ts']],
  validations = [{ passed: true, summary: 'passed', evidenceRefs: ['verify:passed'] }],
  repairResult = 'repaired response',
  usesBridge = false,
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
      return responses[Math.min(interpreted.length - 1, responses.length - 1)];
    },
  };
  const workspaceMutation = {
    async apply(cwd, proposal) {
      mutations.push({ cwd, proposal });
      return changedFiles[Math.min(mutations.length - 1, changedFiles.length - 1)];
    },
  };
  const verification = {
    async verify(cwd, files, prompt) {
      verifications.push({ cwd, files, prompt });
      return validations[Math.min(verifications.length - 1, validations.length - 1)];
    },
  };
  const loop = new CliLegacyCodingLoop(artifactInterpreter, workspaceMutation, verification);
  const input = {
    cwd: '/workspace',
    prompt: 'Change the value, but intentionally fail the first response.',
    response: 'initial response',
    runId: 'run-1',
    usesBridge,
    signal: new AbortController().signal,
    async requestRepair(request) {
      repairRequests.push(request);
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
  };

  return {
    loop,
    input,
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

test('legacy CLI coding loop leaves the workspace untouched when the model proposes no artifact', async () => {
  const harness = createHarness({ responses: [{ candidateCount: 0 }] });

  await harness.loop.execute(harness.input);

  assert.deepEqual(harness.interpreted, ['initial response']);
  assert.equal(harness.mutations.length, 0);
  assert.equal(harness.verifications.length, 0);
  assert.equal(harness.repairRequests.length, 0);
  assert.deepEqual(harness.evidence, []);
  assert.deepEqual(harness.events, []);
});

test('legacy CLI coding loop records one committed and verified edit', async () => {
  const harness = createHarness();

  await harness.loop.execute(harness.input);

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
});

test('legacy CLI coding loop repairs a failed first edit and closes its recovery evidence', async () => {
  const harness = createHarness({
    responses: [{ candidateCount: 1 }, { candidateCount: 1 }],
    validations: [
      { passed: false, summary: 'typecheck failed', evidenceRefs: ['verify:failed'] },
      { passed: true, summary: 'passed', evidenceRefs: ['verify:passed'] },
    ],
    usesBridge: true,
  });

  await harness.loop.execute(harness.input);

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
});

test('legacy CLI coding loop closes recovery as failed when the repair provider fails', async () => {
  const harness = createHarness({
    validations: [{ passed: false, summary: 'tests failed', evidenceRefs: ['verify:failed'] }],
    repairResult: new Error('repair provider unavailable'),
    usesBridge: true,
  });

  await assert.rejects(
    harness.loop.execute(harness.input),
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
