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
  CODING_TOOL_RECEIPT_VERSION,
  CODING_VERIFICATION_RECEIPT_VERSION,
  CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
  CanonicalCodingKernel,
  bindSettledCodingConformanceObservation,
  buildSecretHarvestingRefusalAcceptanceEvidence,
  buildCodingKernelTaskContract,
  evaluateCodingConformanceFixture,
  isSecretHarvestingRefusalTaskContract,
  resolveCodingOrientationDecision,
} from '../../../shared/dist/index.js';
import { createCanonicalCheckpointFixture } from '../helpers/canonical-checkpoint-fixture.mjs';

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
const { VsCodeCodingKernelRuntimeAdapter } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('VS Code canonical Kernel probe exposes semantically conformant settled product output', async () => {
  const cases = [
    { fixtureId: 'create-and-verify', recovery: false },
    { fixtureId: 'modify-and-verify', recovery: true },
    { fixtureId: 'verify-repair-reverify', recovery: true },
    { fixtureId: 'permission-denied-no-effect', recovery: false },
    { fixtureId: 'policy-refusal-no-mutation', recovery: false },
  ];

  for (const routeCase of cases) {
    const fixture = findFixture(routeCase.fixtureId);
    const calls = [];
    const loopResult = buildDevelopmentLoopResult(fixture);
    const kernel = new CanonicalCodingKernel(new VsCodeCodingKernelRuntimeAdapter({
      async runCanonical(request) {
        calls.push({ route: 'canonical', request });
        return loopResult;
      },
    }));
    const routeOutput = await kernel.execute(routeInput(routeCase.recovery, fixture));
    const evaluation = evaluateCodingConformanceFixture(fixture, [
      observeVsCodeRouteOutput(fixture, routeOutput),
    ]);
    const vscodeResult = evaluation.surfaceResults.find(result => result.surface === 'vscode');

    assert.equal(calls.length, 1, routeCase.fixtureId);
    assert.equal(calls[0].route, 'canonical', routeCase.fixtureId);
    assert.equal(Boolean(calls[0].request.recoveryContextText), routeCase.recovery, routeCase.fixtureId);
    assert.notEqual(routeOutput.result, loopResult, routeCase.fixtureId);
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

test('VS Code product projection correlates internal host receipt ids to canonical tool actions', async () => {
  const fixture = findFixture('create-and-verify');
  const loopResult = buildDevelopmentLoopResult(fixture);
  const mutationEvidence = 'vscode-mutation-correlation:create';
  loopResult.toolExecutionReceipts = loopResult.toolExecutionReceipts.map(receipt => ({
    ...receipt,
    actionId: `vscode-tool-${receipt.sequence}-${receipt.tool}`,
    evidenceRefs: receipt.effects.includes('workspace-mutation')
      ? [...receipt.evidenceRefs, mutationEvidence]
      : receipt.evidenceRefs,
  }));
  loopResult.changeReceipts = loopResult.changeReceipts.map(receipt => ({
    ...receipt,
    actionId: `vscode-text-transaction-${receipt.sequence}`,
    evidenceRefs: [...receipt.evidenceRefs, mutationEvidence],
  }));
  loopResult.verificationReceipts = loopResult.verificationReceipts.map(receipt => ({
    ...receipt,
    actionId: `vscode-auto-validation-${receipt.sequence}`,
  }));
  const kernel = new CanonicalCodingKernel(new VsCodeCodingKernelRuntimeAdapter({
    async runCanonical() {
      return loopResult;
    },
  }));

  const output = await kernel.execute(routeInput(false, fixture));
  const projection = output.result.codingConformance;
  const mutationTool = projection.toolExecutions.find(receipt => receipt.effects.includes('workspace-mutation'));
  const processTool = projection.toolExecutions.find(receipt => receipt.effects.includes('process'));
  assert.equal(projection.changeReceipts[0].actionId, mutationTool.actionId);
  assert.equal(projection.verifications[0].actionId, processTool.actionId);
  assert.equal(loopResult.changeReceipts[0].actionId, 'vscode-text-transaction-1');
  assert.equal(loopResult.verificationReceipts[0].actionId, 'vscode-auto-validation-1');

  const evaluation = evaluateCodingConformanceFixture(fixture, [observeVsCodeRouteOutput(fixture, output)]);
  const vscodeResult = evaluation.surfaceResults.find(result => result.surface === 'vscode');
  assert.equal(vscodeResult.contractConformant, true, JSON.stringify(vscodeResult.violations));
});

test('VS Code product projection prefers action-owned acceptance receipts over internal quality receipts', async () => {
  const fixture = findFixture('create-and-verify');
  const loopResult = buildDevelopmentLoopResult(fixture);
  const actionOwned = loopResult.verificationReceipts[0];
  loopResult.verificationReceipts.push({
    ...actionOwned,
    sequence: actionOwned.sequence + 100,
    actionId: 'vscode-auto-validation-internal',
    idempotencyKey: `${actionOwned.runId}:vscode-auto-validation-internal`,
    verifier: 'vscode-agent-quality-gate',
  });
  const kernel = new CanonicalCodingKernel(new VsCodeCodingKernelRuntimeAdapter({
    async runCanonical() {
      return loopResult;
    },
  }));

  const output = await kernel.execute(routeInput(false, fixture));
  assert.deepEqual(
    output.result.codingConformance.verifications.map(receipt => receipt.actionId),
    [actionOwned.actionId],
  );
});

function buildDevelopmentLoopResult(fixture) {
  const runId = `conformance-${fixture.fixtureId}`;
  const toolExecutionReceipts = fixture.expected.toolExecutions.map(receipt => ({
    version: CODING_TOOL_RECEIPT_VERSION,
    runId,
    sequence: receipt.sequence,
    actionId: receipt.actionId,
    tool: receipt.tool,
    effects: receipt.effects,
    status: receipt.status,
    permission: {
      decision: receipt.status === 'denied' ? 'deny' : 'allow',
      status: receipt.status === 'denied' ? 'denied' : 'authorized',
      reason: receipt.status === 'denied'
        ? 'development-route-approval-required'
        : 'development-route-authorized',
      evidenceRefs: receipt.evidenceRefs,
    },
    ...(receipt.status === 'failed' ? { errorCode: 'development-verification-failed' } : {}),
    evidenceRefs: receipt.evidenceRefs,
  }));
  const changeReceipts = fixture.expected.changeReceipts.map(receipt => ({
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId,
    sequence: receipt.sequence,
    actionId: receipt.actionId,
    idempotencyKey: `${runId}:${receipt.actionId}`,
    status: receipt.status,
    paths: receipt.paths,
    baselineRef: receipt.baselineRef,
    ...(receipt.readbackRef ? { readbackRef: receipt.readbackRef } : {}),
    ...(receipt.rollbackRef ? { rollbackRef: receipt.rollbackRef } : {}),
    evidenceRefs: receipt.evidenceRefs,
  }));
  const verificationReceipts = fixture.expected.verifications.map(receipt => {
    const status = receipt.status === 'blocked' ? 'unverified' : receipt.status;
    return {
      version: CODING_VERIFICATION_RECEIPT_VERSION,
      runId,
      sequence: receipt.sequence,
      actionId: receipt.actionId,
      idempotencyKey: `${runId}:${receipt.actionId}`,
      verifier: receipt.verifier,
      status,
      scopePaths: [...new Set(changeReceipts.flatMap(change => change.paths))],
      checks: [{
        checkId: `check-${receipt.actionId}`,
        status,
        acceptanceIds: receipt.acceptanceIds,
        summary: `Development verification ${status}`,
        evidenceRefs: receipt.evidenceRefs,
      }],
      acceptance: receipt.acceptanceIds.map(criterionId => ({
        criterionId,
        status: status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'unverified',
        evidenceRefs: receipt.evidenceRefs,
      })),
      evidenceRefs: receipt.evidenceRefs,
    };
  });
  const changedPaths = [...new Set(changeReceipts
    .filter(receipt => receipt.status === 'committed')
    .flatMap(receipt => receipt.paths))];
  const blockedByAuthority = toolExecutionReceipts.some(receipt => receipt.status === 'denied');
  const verifiedAcceptanceIds = new Set(verificationReceipts
    .flatMap(receipt => receipt.acceptance.map(result => result.criterionId)));
  const acceptanceEvidence = isSecretHarvestingRefusalTaskContract(fixture.expected.taskContract)
    ? buildSecretHarvestingRefusalAcceptanceEvidence()
    : blockedByAuthority || fixture.expected.taskContract.mode !== 'change'
      ? []
      : fixture.expected.completion.acceptance
        .filter(result => !verifiedAcceptanceIds.has(result.criterionId));
  const taskCount = Math.max(1, changeReceipts.length);

  return {
    tasksTotal: taskCount,
    tasksApplied: blockedByAuthority ? 0 : taskCount,
    tasksFailed: blockedByAuthority ? 1 : 0,
    changedPaths,
    verificationIds: verificationReceipts.map(receipt => receipt.actionId),
    verificationReceipts,
    toolExecutionReceipts,
    changeReceipts,
    ...(acceptanceEvidence.length > 0 ? { acceptanceEvidence } : {}),
    historyText: `Development route settled ${fixture.title}.`,
  };
}

function routeInput(recovery, fixture) {
  const tasks = [{ id: 'resume', file: 'src/main.ts', action: 'modify', desc: fixture.title }];
  const taskContract = buildCodingKernelTaskContract({
    goal: fixture.expected.taskContract.goal,
    mode: fixture.expected.taskContract.mode,
    orientation: resolveCodingOrientationDecision({
      prompt: fixture.prompt,
      modeHint: fixture.expected.taskContract.mode,
    }),
    include: fixture.expected.taskContract.scope.include,
    exclude: fixture.expected.taskContract.scope.exclude,
    deliverables: fixture.expected.taskContract.deliverables,
    constraints: fixture.expected.taskContract.constraints,
    acceptance: fixture.expected.taskContract.acceptance,
    provenanceRefs: fixture.expected.taskContract.provenanceRefs,
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
    ...(canonicalCheckpoint ? { resumeCheckpoint: canonicalCheckpoint } : {}),
    runtimeContext,
  };
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
