import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import {
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  evaluateCodingConformanceFixture,
} from '../../shared/dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-coding-conformance-'));
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

test('CLI legacy route probe records observable actions without inventing missing conformance dimensions', async () => {
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
    const routeOutput = await runCliLegacyRoute(fixture, routeCase.validations);
    const evaluation = evaluateCodingConformanceFixture(fixture, [
      observeCliLegacyRoute(fixture, routeOutput),
    ]);
    const cliResult = evaluation.surfaceResults.find(result => result.surface === 'cli');

    assert.equal(routeOutput.mutations.length, routeCase.expectedMutationCount, routeCase.fixtureId);
    assert.equal(routeOutput.verifications.length, routeCase.validations.length, routeCase.fixtureId);
    assert.equal(cliResult.contractConformant, false, routeCase.fixtureId);
    assert.equal(cliResult.evidenceClass, 'development-route-replay', routeCase.fixtureId);
    assert.deepEqual(cliResult.observedDimensions, ['toolExecutions'], routeCase.fixtureId);
    assert.deepEqual(cliResult.missingDimensions, [
      'taskContract',
      'changeReceipts',
      'verifications',
      'completion',
    ], routeCase.fixtureId);
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

async function runCliLegacyRoute(fixture, validations) {
  const evidence = [];
  const events = [];
  const mutations = [];
  const verifications = [];
  let validationIndex = 0;
  const targetPath = fixture.expected.taskContract.scope.include[0] || 'src/value.ts';
  const loop = new CliLegacyCodingLoop(
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
  );

  await loop.execute({
    cwd: '/workspace',
    prompt: fixture.prompt,
    response: 'initial development route response',
    runId: `conformance-${fixture.fixtureId}`,
    usesBridge: false,
    signal: new AbortController().signal,
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
  });

  return { evidence, events, mutations, verifications };
}

function observeCliLegacyRoute(fixture, routeOutput) {
  return {
    surface: 'cli',
    adapterId: 'cli-legacy-coding-loop-development-probe',
    evidenceClass: 'development-route-replay',
    sourceRefs: [
      'packages/cli/src/cli-legacy-coding-loop.ts',
      `development-route:${fixture.fixtureId}:cli`,
    ],
    projection: {
      schemaVersion: fixture.schemaVersion,
      fixtureId: fixture.fixtureId,
      toolExecutions: projectSettledCliActions(routeOutput.evidence),
    },
    unavailableDimensions: [
      unavailable('taskContract', 'route-output-not-exposed', 'cli-loop-input-has-prompt-only'),
      unavailable('changeReceipts', 'route-evidence-incomplete', 'cli-change-event-has-paths-without-baseline-readback'),
      unavailable('verifications', 'route-evidence-incomplete', 'cli-validation-event-has-no-acceptance-map'),
      unavailable('completion', 'route-output-not-exposed', 'cli-loop-returns-void'),
    ],
  };
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
        ? 'cli-legacy-workspace-mutation'
        : 'cli-legacy-verification',
      effects: record.entry.type.startsWith('side_effect.') ? ['workspace-mutation'] : ['process'],
      status: record.entry.type.endsWith('.committed') || record.entry.type.endsWith('.completed')
        ? 'completed'
        : 'failed',
      evidenceRefs: [`run-evidence:${record.operationId}:${record.entry.type}`],
    }));
}

function unavailable(dimension, reason, evidenceRef) {
  return { dimension, reason, evidenceRefs: [evidenceRef] };
}

function findFixture(fixtureId) {
  const fixture = CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.find(candidate => candidate.fixtureId === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  return fixture;
}
