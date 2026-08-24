import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  CanonicalCodingKernel,
  InMemoryCodingOperationJournal,
  bindSettledCodingConformanceObservation,
  evaluateCodingConformanceFixture,
  resolveCodingKernelTaskContract,
  createFixtureCodingKernelEnvironment,
} from '../../../shared/dist/index.js';
import { createCanonicalCheckpointFixture } from '../helpers/canonical-checkpoint-fixture.mjs';
import { exerciseCanonicalDevelopmentRoute } from '../helpers/canonical-development-route-fixture.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-coding-conformance-'));
const runtimeBundlePath = path.join(bundleRoot, 'coding-kernel-execution.cjs');
const outputBundlePath = path.join(bundleRoot, 'vscode-coding-kernel-output.cjs');

for (const [entryPoint, outfile] of [
  ['src/app/coding-kernel-execution.ts', runtimeBundlePath],
  ['src/app/vscode-coding-kernel-output.ts', outputBundlePath],
]) {
  execFileSync('npx', [
    'esbuild',
    entryPoint,
    '--bundle',
    `--outfile=${outfile}`,
    '--format=cjs',
    '--platform=node',
    '--external:vscode',
  ], { cwd: extensionRoot, stdio: 'pipe' });
}

const require = createRequire(import.meta.url);
const { VsCodeCodingKernelRuntimeAdapter } = require(runtimeBundlePath);
const { projectVsCodeCodingKernelOutput } = require(outputBundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('VS Code canonical Kernel probe exposes semantically conformant settled product output', async () => {
  const cases = [
    { fixtureId: 'create-and-verify', recovery: false },
    { fixtureId: 'modify-and-verify', recovery: true },
    { fixtureId: 'verify-repair-reverify', recovery: true },
    { fixtureId: 'implicit-ci-health-repair', recovery: true },
    { fixtureId: 'implicit-cn-test-health-repair', recovery: true },
    { fixtureId: 'implicit-project-health-repair', recovery: true },
    { fixtureId: 'implicit-runtime-error-repair', recovery: true },
    { fixtureId: 'implicit-user-symptom-repair', recovery: true },
    { fixtureId: 'permission-denied-no-effect', recovery: false },
    { fixtureId: 'policy-refusal-no-mutation', recovery: false },
  ];

  for (const routeCase of cases) {
    const fixture = findFixture(routeCase.fixtureId);
    const calls = [];
    const input = routeInput(routeCase.recovery, fixture);
    let agentResult;
    const kernel = new CanonicalCodingKernel(new VsCodeCodingKernelRuntimeAdapter({
      async runCanonical(request) {
        calls.push({ route: 'canonical', request });
        const exercise = await exerciseCanonicalDevelopmentRoute({
          fixture,
          request,
          taskContract: input.taskContract,
        });
        agentResult = exercise.agentResult;
        return agentResult;
      },
    }));
    const routeOutput = await executeProductRoute(kernel, input);
    const evaluation = evaluateCodingConformanceFixture(fixture, [
      observeVsCodeRouteOutput(fixture, routeOutput),
    ]);
    const vscodeResult = evaluation.surfaceResults.find(result => result.surface === 'vscode');

    assert.equal(calls.length, 1, routeCase.fixtureId);
    assert.equal(calls[0].route, 'canonical', routeCase.fixtureId);
    assert.equal(Boolean(calls[0].request.recoveryContextText), routeCase.recovery, routeCase.fixtureId);
    assert.notEqual(routeOutput.result, agentResult, routeCase.fixtureId);
    assert.ok(routeOutput.result.completionDecision, routeCase.fixtureId);
    assert.equal(routeOutput.orientation, routeOutput.taskContract.orientation, routeCase.fixtureId);
    assert.equal(routeOutput.orientation.mode, routeOutput.taskContract.mode, routeCase.fixtureId);
    assert.equal(vscodeResult.contractConformant, true, JSON.stringify(vscodeResult.violations));
    assert.equal(vscodeResult.evidenceClass, 'product-route', routeCase.fixtureId);
    assert.deepEqual(vscodeResult.observedDimensions, [
      'taskContract',
      'toolExecutions',
      'changeReceipts',
      'verifications',
      'completion',
    ], routeCase.fixtureId);
    assert.deepEqual(vscodeResult.missingDimensions, [], routeCase.fixtureId);
    assert.deepEqual(vscodeResult.violations, [], routeCase.fixtureId);
    assert.equal(evaluation.productRouteEvidenceComplete, false, routeCase.fixtureId);
    assert.equal(evaluation.qualificationEligible, false, routeCase.fixtureId);
    assert.equal(evaluation.claimsPermitted, false, routeCase.fixtureId);
  }
});

test('VS Code product projection rejects unowned internal receipts instead of guessing ownership', async () => {
  const fixture = findFixture('create-and-verify');
  const input = routeInput(false, fixture);
  const kernel = new CanonicalCodingKernel(new VsCodeCodingKernelRuntimeAdapter({
    async runCanonical(request) {
      return (await exerciseCanonicalDevelopmentRoute({
        fixture,
        request,
        taskContract: input.taskContract,
        internalReceiptIds: true,
      })).agentResult;
    },
  }));

  const kernelOutput = await kernel.execute(input);
  const output = bindProductOutput(kernelOutput);
  const projection = output.result.codingConformance;
  const mutationTool = projection.toolExecutions.find(receipt => receipt.effects.includes('workspace-mutation'));
  const processTool = projection.toolExecutions.find(receipt => receipt.effects.includes('process'));
  assert.equal(projection.changeReceipts[0].actionId, 'vscode-text-transaction-1');
  assert.deepEqual(projection.verifications, []);
  assert.notEqual(projection.changeReceipts[0].actionId, mutationTool.actionId);
  assert.equal(kernelOutput.workspaceMutationReceipts[0].actionId, 'vscode-text-transaction-1');
  assert.equal(kernelOutput.verificationReceipts[0].actionId, 'vscode-auto-validation-1');
  assert.notEqual(kernelOutput.verificationReceipts[0].actionId, processTool.actionId);
});

test('VS Code product projection includes only exact action-owned verification receipts', async () => {
  const fixture = findFixture('create-and-verify');
  const input = routeInput(false, fixture);
  const kernel = new CanonicalCodingKernel(new VsCodeCodingKernelRuntimeAdapter({
    async runCanonical(request) {
      return (await exerciseCanonicalDevelopmentRoute({
        fixture,
        request,
        taskContract: input.taskContract,
        extraInternalVerification: true,
      })).agentResult;
    },
  }));

  const kernelOutput = await kernel.execute(input);
  const output = bindProductOutput(kernelOutput);
  const processTool = output.result.codingConformance.toolExecutions.find(
    receipt => receipt.effects.includes('process'),
  );
  assert.deepEqual(kernelOutput.verificationReceipts.map(receipt => receipt.actionId), [
    processTool.actionId,
    'vscode-auto-validation-internal',
  ]);
  assert.deepEqual(output.result.codingConformance.verifications.map(receipt => receipt.actionId), [
    processTool.actionId,
  ]);
  assert.deepEqual(kernelOutput.verificationReceipts.map(receipt => receipt.actionId), [
    processTool.actionId,
    'vscode-auto-validation-internal',
  ]);
});

function routeInput(recovery, fixture) {
  const tasks = [{ id: 'resume', file: 'src/main.ts', action: 'modify', desc: fixture.title }];
  const taskContract = resolveCodingKernelTaskContract({
    prompt: fixture.prompt,
    surface: 'vscode',
    ...(fixture.taskContractInput ?? {}),
  });
  const canonicalCheckpoint = recovery
    ? createCanonicalCheckpointFixture({
        tasks,
        workspaceRoot: '/workspace',
        runId: `conformance-${fixture.fixtureId}`,
        userPrompt: fixture.prompt,
        taskContract,
      })
    : undefined;
  const runtimeContext = {
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
        tasks,
        startFromIndex: 0,
        checkpoint: canonicalCheckpoint,
        taskContract,
      },
    } : {}),
  };
  return {
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: 'vscode',
    runId: `conformance-${fixture.fixtureId}`,
    userPrompt: fixture.prompt,
    workspaceRoot: '/workspace',
    taskContract,
    operationJournal: new InMemoryCodingOperationJournal(),
    environment: createFixtureCodingKernelEnvironment('/workspace'),
    ...(canonicalCheckpoint ? { resumeCheckpoint: canonicalCheckpoint } : {}),
    runtimeContext,
  };
}

async function executeProductRoute(kernel, input) {
  return bindProductOutput(await kernel.execute(input));
}

function bindProductOutput(output) {
  return { ...output, result: projectVsCodeCodingKernelOutput(output) };
}

function observeVsCodeRouteOutput(fixture, routeOutput) {
  assert.ok(routeOutput.result.codingConformance, 'VS Code route must expose its settled conformance projection');
  return bindSettledCodingConformanceObservation({
    fixture,
    surface: 'vscode',
    adapterId: 'vscode-coding-kernel-execution-product-output',
    sourceRefs: [
      'packages/vscode-extension/src/app/coding-kernel-execution.ts',
      `product-route:${fixture.fixtureId}:vscode`,
    ],
    projection: routeOutput.result.codingConformance,
  });
}

function findFixture(fixtureId) {
  const fixture = CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.find(candidate => candidate.fixtureId === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  return fixture;
}
