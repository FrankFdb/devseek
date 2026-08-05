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
  projectSettledCodingConformanceRun,
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

test('CLI canonical Kernel probe exposes semantically conformant settled product output', async () => {
  const cases = [
    {
      fixtureId: 'create-and-verify',
      validations: [{ passed: true, summary: 'passed', evidenceRefs: ['verify:passed'] }],
      expectedMutationCount: 1,
    },
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
    {
      fixtureId: 'permission-denied-no-effect',
      validations: [],
      expectedMutationCount: 0,
    },
    {
      fixtureId: 'policy-refusal-no-mutation',
      validations: [],
      expectedMutationCount: 0,
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
    assert.equal(cliResult.contractConformant, true, JSON.stringify(cliResult.violations));
    assert.equal(cliResult.evidenceClass, 'development-route-replay', routeCase.fixtureId);
    assert.deepEqual(cliResult.observedDimensions, [
      'taskContract',
      'toolExecutions',
      'changeReceipts',
      'verifications',
      'completion',
    ], routeCase.fixtureId);
    assert.deepEqual(cliResult.missingDimensions, [], routeCase.fixtureId);
    assert.deepEqual(cliResult.violations, [], routeCase.fixtureId);
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
    {
      interpret: () => developmentArtifactProposal(fixture.fixtureId, targetPath),
    },
    {
      async captureBaseline(plan) {
        return {
          baselineRef: `baseline:${plan.actionId}`,
          state: { actionId: plan.actionId },
          evidenceRefs: [`baseline:${plan.actionId}:captured`],
        };
      },
      async apply(plan) {
        mutations.push({ cwd: plan.payload.workspaceRoot, proposal: plan.payload.proposal });
        return {
          status: 'applied',
          applied: {
            state: { files: [targetPath] },
            result: [targetPath],
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
    },
    {
      async verify(request) {
        verifications.push(request);
        const result = validations[Math.min(validationIndex++, validations.length - 1)];
        const status = result.status ?? (result.passed ? 'passed' : 'failed');
        return {
          replayed: false,
          receipt: {
            version: 'devseek.coding-verification-receipt/v1',
            runId: request.runId,
            sequence: request.sequence,
            actionId: request.actionId,
            idempotencyKey: `${request.runId}:${request.actionId}`,
            verifier: 'development-verifier',
            status,
            scopePaths: request.files,
            checks: [{
              checkId: `check-${request.actionId}`,
              status,
              acceptanceIds: request.acceptance.map(criterion => criterion.id),
              summary: result.summary,
              evidenceRefs: result.evidenceRefs,
            }],
            acceptance: request.acceptance.map(criterion => ({
              criterionId: criterion.id,
              status,
              evidenceRefs: result.evidenceRefs,
            })),
            evidenceRefs: result.evidenceRefs,
          },
        };
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

function developmentArtifactProposal(fixtureId, targetPath) {
  if (fixtureId === 'permission-denied-no-effect') {
    return {
      candidateCount: 1,
      fileToolCalls: [],
      terminalToolCalls: [{
        name: 'run_terminal',
        command: 'npm install left-pad',
      }],
      unifiedDiffs: [],
    };
  }
  if (fixtureId === 'policy-refusal-no-mutation') {
    return {
      candidateCount: 0,
      fileToolCalls: [],
      terminalToolCalls: [],
      unifiedDiffs: [],
    };
  }
  return {
    candidateCount: 1,
    fileToolCalls: [{ name: 'replace_file', filePath: targetPath, content: 'updated\n' }],
    terminalToolCalls: [],
    unifiedDiffs: [],
  };
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
      ...projectSettledCodingConformanceRun({
        fixtureId: fixture.fixtureId,
        taskContract: routeOutput.output.taskContract,
        toolExecutions: routeOutput.output.result.toolExecutions,
        changeReceipts: routeOutput.output.result.changeReceipts,
        verifications: routeOutput.output.result.verificationReceipts,
        completion: routeOutput.output.result.completion,
      }),
    },
    unavailableDimensions: [],
  };
}

function findFixture(fixtureId) {
  const fixture = CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.find(candidate => candidate.fixtureId === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  return fixture;
}
