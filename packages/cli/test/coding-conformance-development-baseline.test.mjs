import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  CanonicalCodingKernel,
  buildCodingKernelTaskContract,
  evaluateCodingConformanceFixture,
} from '../../shared/dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-coding-conformance-'));
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

test('CLI canonical Kernel probe exposes settled output without inventing mutation readback receipts', async () => {
  const cases = [
    {
      fixtureId: 'modify-and-verify',
      validations: [{ passed: true, summary: 'passed', evidenceRefs: ['verify:passed'] }],
      expectedMutationCount: 1,
    },
    {
      fixtureId: 'verify-repair-reverify',
      validations: [
        { passed: false, summary: 'focused test failed', evidenceRefs: ['verify:failed'] },
        { passed: true, summary: 'passed after repair', evidenceRefs: ['verify:passed'] },
      ],
      expectedMutationCount: 2,
    },
  ];

  for (const routeCase of cases) {
    const fixture = findFixture(routeCase.fixtureId);
    const routeOutput = await runCliCanonicalRoute(fixture, routeCase.validations);
    const evaluation = evaluateCodingConformanceFixture(fixture, [
      observeCliCanonicalRoute(fixture, routeOutput),
    ]);
    const cliResult = evaluation.surfaceResults.find(result => result.surface === 'cli');

    assert.equal(routeOutput.mutations.length, routeCase.expectedMutationCount, routeCase.fixtureId);
    assert.equal(routeOutput.verifications.length, routeCase.validations.length, routeCase.fixtureId);
    assert.equal(cliResult.contractConformant, false, routeCase.fixtureId);
    assert.equal(cliResult.evidenceClass, 'development-route-replay', routeCase.fixtureId);
    assert.deepEqual(cliResult.observedDimensions, [
      'taskContract',
      'toolExecutions',
      'verifications',
      'completion',
    ], routeCase.fixtureId);
    assert.deepEqual(cliResult.missingDimensions, ['changeReceipts'], routeCase.fixtureId);
    assert.ok(cliResult.violations.some(violation => (
      violation.dimension === 'toolExecutions' && violation.code === 'semantic-mismatch'
    )), routeCase.fixtureId);
    assert.equal(cliResult.violations.some(violation => (
      violation.code === 'unexplained-missing-dimension'
    )), false, routeCase.fixtureId);
    assert.equal(evaluation.productRouteEvidenceComplete, false, routeCase.fixtureId);
    assert.equal(evaluation.qualificationEligible, false, routeCase.fixtureId);
    assert.equal(evaluation.claimsPermitted, false, routeCase.fixtureId);
  }
});

async function runCliCanonicalRoute(fixture, validations) {
  const evidence = [];
  const events = [];
  const mutations = [];
  const verifications = [];
  let validationIndex = 0;
  const targetPath = fixture.expected.taskContract.scope.include[0] || 'src/value.ts';
  const kernel = new CanonicalCodingKernel(new CliCodingKernelRuntimeAdapter(
    { interpret: () => ({ candidateCount: 1 }) },
    {
      async apply(cwd, proposal) {
        mutations.push({ cwd, proposal });
        return [targetPath];
      },
    },
    {
      async verify(cwd, files, prompt) {
        verifications.push({ cwd, files, prompt });
        return validations[Math.min(validationIndex++, validations.length - 1)];
      },
    },
  ));

  const output = await kernel.execute({
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: 'cli',
    runId: `conformance-${fixture.fixtureId}`,
    userPrompt: fixture.prompt,
    workspaceRoot: '/workspace',
    signal: new AbortController().signal,
    taskContract: buildCodingKernelTaskContract({
      goal: fixture.expected.taskContract.goal,
      mode: fixture.expected.taskContract.mode,
      include: fixture.expected.taskContract.scope.include,
      exclude: fixture.expected.taskContract.scope.exclude,
      deliverables: fixture.expected.taskContract.deliverables,
      constraints: fixture.expected.taskContract.constraints,
      acceptance: fixture.expected.taskContract.acceptance,
      provenanceRefs: fixture.expected.taskContract.provenanceRefs,
    }),
    runtimeContext: {
      response: 'initial development route response',
      usesBridge: false,
      async requestRepair() {
        return 'bounded repair development route response';
      },
      recordOperationEvidence(entry, operationId, boundary) {
        evidence.push({ entry, operationId, boundary });
      },
      assertBridgeEvidenceComplete() {},
      emitEvent(event) {
        events.push(event);
      },
      formatError(error) {
        return error instanceof Error ? error.message : String(error);
      },
    },
  });

  return { output, evidence, events, mutations, verifications };
}

function observeCliCanonicalRoute(fixture, routeOutput) {
  return {
    surface: 'cli',
    adapterId: 'cli-canonical-coding-kernel-development-probe',
    evidenceClass: 'development-route-replay',
    sourceRefs: [
      'packages/shared/src/coding-kernel.ts',
      'packages/cli/src/cli-coding-kernel-runtime.ts',
      `development-route:${fixture.fixtureId}:cli`,
    ],
    projection: {
      schemaVersion: fixture.schemaVersion,
      fixtureId: fixture.fixtureId,
      taskContract: projectTaskContract(routeOutput.output.taskContract),
      toolExecutions: projectSettledCliActions(routeOutput.evidence),
      verifications: projectCliVerifications(routeOutput.evidence, fixture),
      completion: projectCliCompletion(routeOutput.output),
    },
    unavailableDimensions: [
      unavailable('changeReceipts', 'route-evidence-incomplete', 'cli-change-event-has-paths-without-baseline-readback'),
    ],
  };
}

function projectTaskContract(taskContract) {
  const { version: _version, ...projection } = taskContract;
  return projection;
}

function projectSettledCliActions(evidence) {
  const terminalTypes = new Set([
    'side_effect.committed',
    'side_effect.indeterminate',
    'verification.completed',
    'verification.failed',
  ]);
  return evidence
    .filter(record => terminalTypes.has(record.entry.type))
    .map((record, index) => ({
      sequence: index + 1,
      actionId: record.operationId,
      tool: record.entry.type.startsWith('side_effect.')
        ? 'cli-workspace-mutation'
        : 'cli-verification',
      effects: record.entry.type.startsWith('side_effect.') ? ['workspace-mutation'] : ['process'],
      status: record.entry.type.endsWith('.committed') || record.entry.type.endsWith('.completed')
        ? 'completed'
        : 'failed',
      evidenceRefs: [`run-evidence:${record.operationId}:${record.entry.type}`],
    }));
}

function projectCliVerifications(evidence, fixture) {
  return evidence
    .filter(record => record.entry.type === 'verification.completed' || record.entry.type === 'verification.failed')
    .map((record, index) => ({
      sequence: index + 1,
      actionId: record.operationId,
      verifier: 'cli-verification',
      status: record.entry.type === 'verification.completed' ? 'passed' : 'failed',
      acceptanceIds: fixture.expected.taskContract.acceptance.map(criterion => criterion.id),
      evidenceRefs: [`run-evidence:${record.operationId}:${record.entry.type}`],
    }));
}

function projectCliCompletion(output) {
  const evidenceRef = `kernel-output:${output.runId}:${output.status}`;
  return {
    status: output.status,
    acceptance: output.taskContract.acceptance.map(criterion => ({
      criterionId: criterion.id,
      status: output.status === 'completed' ? 'passed' : 'failed',
      evidenceRefs: [evidenceRef],
    })),
    residualRisks: [...output.residualRisks],
    evidenceRefs: [evidenceRef],
  };
}

function unavailable(dimension, reason, evidenceRef) {
  return { dimension, reason, evidenceRefs: [evidenceRef] };
}

function findFixture(fixtureId) {
  const fixture = CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.find(candidate => candidate.fixtureId === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  return fixture;
}
