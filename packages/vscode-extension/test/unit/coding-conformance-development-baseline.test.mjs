import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  evaluateCodingConformanceFixture,
} from '../../../shared/dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-coding-conformance-'));
const bundlePath = path.join(bundleRoot, 'coding-kernel-execution.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/coding-kernel-execution.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { CodingKernelExecutionService } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('VS Code Kernel route probe records that AgentLoopResult cannot settle conformance dimensions', async () => {
  const cases = [
    { fixtureId: 'create-and-verify', recovery: false },
    { fixtureId: 'modify-and-verify', recovery: true },
  ];

  for (const routeCase of cases) {
    const fixture = findFixture(routeCase.fixtureId);
    const calls = [];
    const expectedResult = {
      tasksTotal: 1,
      tasksApplied: 1,
      tasksFailed: 0,
      changedPaths: [...fixture.expected.changeReceipts.flatMap(receipt => receipt.paths)],
      verificationIds: ['development-verification-id'],
    };
    const service = new CodingKernelExecutionService({
      async runCanonical(request) {
        calls.push({ route: 'canonical', request });
        return expectedResult;
      },
    });
    const routeOutput = await service.execute(routeInput(routeCase.recovery, fixture));
    const evaluation = evaluateCodingConformanceFixture(fixture, [
      observeVsCodeRouteOutput(fixture, routeOutput),
    ]);
    const vscodeResult = evaluation.surfaceResults.find(result => result.surface === 'vscode');

    assert.equal(calls.length, 1, routeCase.fixtureId);
    assert.equal(calls[0].route, 'canonical', routeCase.fixtureId);
    assert.equal(Boolean(calls[0].request.recoveryContextText), routeCase.recovery, routeCase.fixtureId);
    assert.equal(routeOutput, expectedResult, routeCase.fixtureId);
    assert.equal(vscodeResult.contractConformant, false, routeCase.fixtureId);
    assert.equal(vscodeResult.evidenceClass, 'development-route-replay', routeCase.fixtureId);
    assert.deepEqual(vscodeResult.observedDimensions, [], routeCase.fixtureId);
    assert.deepEqual(vscodeResult.missingDimensions, [
      'taskContract',
      'toolExecutions',
      'changeReceipts',
      'verifications',
      'completion',
    ], routeCase.fixtureId);
    assert.equal(vscodeResult.violations.filter(violation => violation.code === 'missing-dimension').length, 5);
    assert.equal(vscodeResult.violations.some(violation => (
      violation.code === 'unexplained-missing-dimension'
    )), false, routeCase.fixtureId);
    assert.equal(evaluation.productRouteEvidenceComplete, false, routeCase.fixtureId);
    assert.equal(evaluation.qualificationEligible, false, routeCase.fixtureId);
    assert.equal(evaluation.claimsPermitted, false, routeCase.fixtureId);
  }
});

function routeInput(recovery, fixture) {
  return {
    route: 'canonical',
    userPrompt: fixture.prompt,
    contextFiles: [],
    workspaceRoot: '/workspace',
    mode: 'r1',
    callbacks: { executionMode: 'edit' },
    workflowMode: 'edit',
    ...(recovery ? {
      recovery: {
        version: 'devseek.coding-kernel-recovery/v1',
        kind: 'checkpoint-resume',
        tasks: [{ id: 'resume', file: 'src/main.ts', action: 'modify', desc: fixture.title }],
        startFromIndex: 0,
      },
    } : {}),
  };
}

function observeVsCodeRouteOutput(fixture, routeOutput) {
  return {
    surface: 'vscode',
    adapterId: 'vscode-coding-kernel-execution-development-probe',
    evidenceClass: 'development-route-replay',
    sourceRefs: [
      'packages/vscode-extension/src/app/coding-kernel-execution.ts',
      `development-route:${fixture.fixtureId}:vscode`,
    ],
    projection: {
      schemaVersion: fixture.schemaVersion,
      fixtureId: fixture.fixtureId,
    },
    unavailableDimensions: [
      unavailable('taskContract', 'route-output-not-exposed', 'agent-loop-result:no-task-contract'),
      unavailable('toolExecutions', 'route-output-not-exposed', 'agent-loop-result:no-tool-receipts'),
      unavailable('changeReceipts', 'route-evidence-incomplete', `agent-loop-result:changed-path-count=${routeOutput.changedPaths.length}`),
      unavailable('verifications', 'route-evidence-incomplete', `agent-loop-result:verification-id-count=${routeOutput.verificationIds?.length ?? 0}`),
      unavailable('completion', 'route-evidence-incomplete', `agent-loop-result:task-counts=${routeOutput.tasksApplied}/${routeOutput.tasksTotal}`),
    ],
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
