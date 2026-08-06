import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  CODING_CONFORMANCE_DIMENSIONS,
  CODING_KERNEL_OUTPUT_VERSION,
  bindSettledCodingConformanceObservation,
  buildSecretHarvestingRefusalAcceptanceEvidence,
  buildCodingKernelTaskContract,
  classifyCodingTerminalEffects,
  evaluateCodingConformanceFixture,
  ProductRunEvidenceWorkspaceReader,
  projectSettledCodingConformanceRun,
  resolveCodingKernelTaskContract,
} from '../../shared/dist/index.js';
import {
  HeadlessCodingKernelExecutor,
  HeadlessCompletionAdapter,
  HeadlessToolExecutionAdapter,
  HeadlessVerificationAdapter,
  HeadlessWorkspaceMutationAdapter,
} from '../dist/index.js';

test('Headless product entry settles five coding fixtures from isolated real workspaces', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devseek-headless-product-conformance-'));
  const observations = [];

  try {
    for (const scenario of productScenarios()) {
      const fixture = findFixture(scenario.fixtureId);
      const cwd = join(root, scenario.fixtureId);
      seedWorkspace(cwd, scenario.files);
      const before = snapshotUserFiles(cwd, scenario.trackedPaths);
      const executor = new HeadlessCodingKernelExecutor({
        executeCanonical: request => executeHeadlessProductRoute(request, scenario),
      });
      let output;
      try {
        output = await executor.execute({
          runId: fixture.fixtureId,
          userPrompt: fixture.prompt,
          workspaceRoot: cwd,
          taskContract: resolveCodingKernelTaskContract({ prompt: fixture.prompt, surface: 'headless' }),
          runtimeContext: { provider: 'deterministic-product-probe' },
        });
      } catch (error) {
        throw new Error(`${fixture.fixtureId}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const observation = bindSettledCodingConformanceObservation({
        fixture,
        surface: 'headless',
        adapterId: 'headless-canonical-product-output',
        sourceRefs: [
          'packages/headless/src/headless-coding-kernel.ts',
          `headless-real-workspace:${fixture.fixtureId}`,
        ],
        projection: output.conformance,
      });
      const evaluation = evaluateCodingConformanceFixture(fixture, [observation]);
      const surface = evaluation.surfaceResults.find(result => result.surface === 'headless');

      assert.equal(output.version, CODING_KERNEL_OUTPUT_VERSION, fixture.fixtureId);
      assert.equal(output.surface, 'headless', fixture.fixtureId);
      assert.equal(output.status, fixture.expected.completion.status, fixture.fixtureId);
      assert.equal(output.runEvidence.status, output.status, fixture.fixtureId);
      assert.equal(output.runEvidence.qualificationEligible, false, fixture.fixtureId);
      const evidenceReader = ProductRunEvidenceWorkspaceReader.forWorkspace({ workspaceRoot: cwd });
      assert.equal(evidenceReader.verify(fixture.fixtureId).status, 'valid-sealed', fixture.fixtureId);
      const retainedEvents = evidenceReader.readSnapshot(fixture.fixtureId).records.map(record => record.event);
      assert.deepEqual(
        retainedEvents.filter(event => event.type === 'agent.status').map(event => event.payload.status),
        ['accepted', 'running', output.status],
        fixture.fixtureId,
      );
      assert.deepEqual(output.result, { fixtureId: fixture.fixtureId }, fixture.fixtureId);
      assert.equal(Object.isFrozen(output.conformance), true, fixture.fixtureId);
      assert.equal(Object.isFrozen(output.conformance.taskContract.scope.include), true, fixture.fixtureId);
      assert.equal(surface.contractConformant, true, JSON.stringify(surface.violations));
      assert.equal(surface.evidenceClass, 'product-route', fixture.fixtureId);
      assert.deepEqual(surface.observedDimensions, CODING_CONFORMANCE_DIMENSIONS, fixture.fixtureId);
      assert.deepEqual(surface.missingDimensions, [], fixture.fixtureId);
      assert.deepEqual(
        changedUserPaths(before, snapshotUserFiles(cwd, scenario.trackedPaths)),
        scenario.expectedChangedPaths,
        fixture.fixtureId,
      );
      observations.push(observation);
    }

    writeOptionalProductReport('headless', observations);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Headless product entry fails closed on incomplete or drifted conformance evidence', async t => {
  const fixture = findFixture('modify-and-verify');

  await t.test('missing dimension', async () => {
    await assert.rejects(
      executeMutated(fixture, projection => delete projection.verifications),
      /headless-coding-conformance:invalid-projection:verifications:missing-dimension/,
    );
  });

  await t.test('TaskContract drift', async () => {
    await assert.rejects(
      executeMutated(fixture, projection => { projection.taskContract.goal = 'A different goal.'; }),
      /headless-coding-conformance:binding-mismatch:task-contract-mismatch/,
    );
  });

  await t.test('terminal status drift', async () => {
    await assert.rejects(
      executeMutated(fixture, projection => { projection.completion.status = 'failed'; }),
      /headless-coding-conformance:binding-mismatch:terminal-status-mismatch/,
    );
  });
});

test('Headless product entry fails before runtime dispatch when cancellation is already requested', async () => {
  let calls = 0;
  const executor = new HeadlessCodingKernelExecutor({
    async executeCanonical() {
      calls += 1;
      const fixture = findFixture('create-and-verify');
      return runtimeOutput(fixture, null);
    },
  });
  const controller = new AbortController();
  controller.abort();
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-headless-cancel-'));

  try {
    await assert.rejects(
      executor.execute({
        ...runInput(findFixture('create-and-verify'), workspaceRoot),
        signal: controller.signal,
      }),
      /coding-kernel-execution:cancelled-before-start/,
    );
    assert.equal(calls, 0);
    const reader = ProductRunEvidenceWorkspaceReader.forWorkspace({ workspaceRoot });
    const [runId] = reader.discoverRunIds();
    const events = reader.readSnapshot(runId).records.map(record => record.event);
    assert.equal(events.at(-1).payload.status, 'cancelled');
    assert.equal(reader.verify(runId).status, 'valid-sealed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Headless tool adapter composes host capability without bypassing shared authority', async () => {
  let calls = 0;
  const adapter = new HeadlessToolExecutionAdapter();
  const denied = await adapter.execute({
    action: {
      runId: 'headless-tool-run',
      sequence: 1,
      actionId: 'network-denied',
      tool: 'fetch_webpage',
      effects: ['network'],
      input: { url: 'https://example.com' },
      authority: {
        decision: 'deny',
        status: 'denied',
        reason: 'network-not-authorized',
        evidenceRefs: ['headless-authority:network-denied'],
      },
    },
    host: {
      async execute() {
        calls++;
        return { status: 'completed', result: 'unexpected', evidenceRefs: ['unexpected'] };
      },
    },
  });

  assert.equal(calls, 0);
  assert.equal(denied.receipt.status, 'denied');
  assert.equal(denied.receipt.permission.decision, 'deny');
});

test('Headless mutation adapter commits only caller-host readback evidence', async () => {
  const calls = [];
  const outcome = await new HeadlessWorkspaceMutationAdapter().execute({
    plan: {
      runId: 'headless-mutation-run',
      sequence: 1,
      actionId: 'headless-write-1',
      idempotencyKey: 'headless-mutation-run:headless-write-1',
      paths: ['src/value.ts'],
      payload: { content: 'updated\n' },
      evidenceRefs: ['headless-plan:write-1'],
    },
    host: {
      async captureBaseline() {
        calls.push('baseline');
        return {
          baselineRef: 'headless-baseline:value:v0',
          state: { content: 'old\n' },
          evidenceRefs: ['headless-baseline:captured'],
        };
      },
      async apply() {
        calls.push('apply');
        return {
          status: 'applied',
          applied: {
            state: { content: 'updated\n' },
            result: ['src/value.ts'],
            evidenceRefs: ['headless-apply:completed'],
          },
        };
      },
      async readback() {
        calls.push('readback');
        return {
          matches: true,
          readbackRef: 'headless-readback:value:v1',
          evidenceRefs: ['headless-readback:matched'],
        };
      },
      async rollback() {
        calls.push('rollback');
        return { rolledBack: false, evidenceRefs: ['headless-rollback:unexpected'] };
      },
    },
  });

  assert.deepEqual(calls, ['baseline', 'apply', 'readback']);
  assert.equal(outcome.receipt.status, 'committed');
  assert.deepEqual(outcome.receipt.result, ['src/value.ts']);
  assert.equal(outcome.receipt.readbackRef, 'headless-readback:value:v1');
});

test('Headless verification adapter keeps missing acceptance evidence unverified', async () => {
  const outcome = await new HeadlessVerificationAdapter().verify({
    plan: {
      runId: 'headless-verify-run',
      sequence: 1,
      actionId: 'headless-verify-1',
      idempotencyKey: 'headless-verify-run:headless-verify-1',
      scopePaths: ['src/value.ts'],
      acceptance: [{ id: 'builds', statement: 'Project builds' }],
      payload: { workspaceRoot: '/workspace' },
      evidenceRefs: ['headless-mutation:committed'],
    },
    host: {
      async verify() {
        return { verifier: 'none', checks: [], evidenceRefs: ['headless-verifier:none'] };
      },
    },
  });

  assert.equal(outcome.receipt.status, 'unverified');
  assert.equal(outcome.receipt.acceptance[0].status, 'unverified');
});

test('Headless completion adapter blocks a change without verification evidence', () => {
  const decision = new HeadlessCompletionAdapter().decide({
    runId: 'headless-completion-run',
    decisionId: 'completion-1',
    idempotencyKey: 'headless-completion-run:completion-1',
    acceptance: [{ id: 'verified', statement: 'The change is verified.' }],
    verificationRequired: true,
    reviewRequired: false,
    toolExecutions: [],
    mutations: [],
    verifications: [],
    resolvedVerificationActionIds: [],
    acceptanceEvidence: [],
    pendingRefs: [],
    adverseEvidenceRefs: [],
    residualRisks: [],
    evidenceRefs: ['headless-task-contract:completion-run'],
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.reasonCodes.includes('verification-not-run'), true);
});

async function executeHeadlessProductRoute(request, scenario) {
  const toolExecutions = [];
  const changeReceipts = [];
  const verifications = [];
  const failedVerificationActionIds = [];

  if (scenario.fixtureId === 'permission-denied-no-effect') {
    const denied = await new HeadlessToolExecutionAdapter().execute({
      action: {
        runId: request.runId,
        sequence: 1,
        actionId: 'headless-install-dependency',
        tool: 'run_terminal',
        effects: classifyCodingTerminalEffects('npm install left-pad'),
        input: { command: 'npm install left-pad' },
        authority: {
          decision: 'deny',
          status: 'denied',
          reason: 'dependency-and-network-authority-not-granted',
          evidenceRefs: ['headless-authority:install-denied'],
        },
      },
      host: { async execute() { throw new Error('denied command must not execute'); } },
    });
    toolExecutions.push(denied.receipt);
  } else {
    for (const [index, content] of (scenario.edits ?? []).entries()) {
      const mutationSequence = (index * 2) + 1;
      const mutationActionId = `headless-write-${index + 1}`;
      const mutation = await executeHeadlessMutationTool({
        request,
        sequence: mutationSequence,
        actionId: mutationActionId,
        path: scenario.targetPath,
        content,
      });
      toolExecutions.push(mutation.toolReceipt);
      changeReceipts.push(mutation.changeReceipt);

      const verificationActionId = `headless-verify-${index + 1}`;
      const verification = await executeHeadlessVerificationTool({
        request,
        scenario,
        sequence: mutationSequence + 1,
        actionId: verificationActionId,
        mutationEvidenceRefs: mutation.changeReceipt.evidenceRefs,
      });
      toolExecutions.push(verification.toolReceipt);
      verifications.push(verification.verificationReceipt);
      if (verification.verificationReceipt.status === 'failed') {
        failedVerificationActionIds.push(verificationActionId);
      }
    }
  }

  const completion = new HeadlessCompletionAdapter().decide({
    runId: request.runId,
    decisionId: 'headless-product-completion',
    idempotencyKey: `${request.runId}:headless-product-completion`,
    acceptance: request.taskContract.acceptance,
    verificationRequired: request.taskContract.mode === 'change' || request.taskContract.mode === 'release',
    reviewRequired: false,
    toolExecutions,
    mutations: changeReceipts,
    verifications,
    resolvedVerificationActionIds: verifications.at(-1)?.status === 'passed'
      ? failedVerificationActionIds
      : [],
    acceptanceEvidence: scenario.fixtureId === 'policy-refusal-no-mutation'
      ? buildSecretHarvestingRefusalAcceptanceEvidence()
      : scenario.fixtureId === 'permission-denied-no-effect'
        ? request.taskContract.acceptance.map(criterion => ({
          criterionId: criterion.id,
          status: 'blocked',
          evidenceRefs: toolExecutions.flatMap(receipt => receipt.evidenceRefs),
        }))
        : [],
    pendingRefs: [],
    adverseEvidenceRefs: [],
    residualRisks: scenario.fixtureId === 'permission-denied-no-effect'
      ? ['requested-change-not-applied']
      : [],
    evidenceRefs: [...request.taskContract.provenanceRefs, `headless-product:${request.runId}:settled`],
  });
  const conformance = projectSettledCodingConformanceRun({
    fixtureId: request.runId,
    taskContract: request.taskContract,
    toolExecutions,
    changeReceipts,
    verifications,
    completion,
  });
  return {
    status: completion.status,
    result: { value: { fixtureId: request.runId }, conformance },
    evidenceRefs: completion.evidenceRefs,
    residualRisks: completion.residualRisks,
  };
}

async function executeHeadlessMutationTool(input) {
  let changeReceipt;
  const tool = await new HeadlessToolExecutionAdapter().execute({
    action: {
      runId: input.request.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      tool: 'replace_file',
      effects: ['workspace-mutation'],
      input: { path: input.path, content: input.content },
      authority: {
        decision: 'allow',
        status: 'authorized',
        reason: 'headless-caller-authorized-scoped-workspace-change',
        evidenceRefs: [`headless-authority:${input.actionId}:authorized`],
      },
    },
    host: {
      async execute() {
        const mutation = await new HeadlessWorkspaceMutationAdapter().execute({
          plan: {
            runId: input.request.runId,
            sequence: input.sequence,
            actionId: input.actionId,
            idempotencyKey: `${input.request.runId}:${input.actionId}`,
            paths: [input.path],
            payload: { path: input.path, content: input.content },
            evidenceRefs: [`headless-plan:${input.actionId}`],
          },
          host: realWorkspaceMutationHost(input.request.workspaceRoot),
        });
        changeReceipt = mutation.receipt;
        return {
          status: mutation.receipt.status === 'committed' ? 'completed' : 'failed',
          result: mutation.receipt,
          ...(mutation.receipt.errorCode ? { errorCode: mutation.receipt.errorCode } : {}),
          evidenceRefs: mutation.receipt.evidenceRefs,
        };
      },
    },
  });
  assert.ok(changeReceipt, `${input.actionId} did not settle a mutation receipt`);
  assert.equal(changeReceipt.status, 'committed', input.actionId);
  return { toolReceipt: tool.receipt, changeReceipt };
}

async function executeHeadlessVerificationTool(input) {
  let verificationReceipt;
  const tool = await new HeadlessToolExecutionAdapter().execute({
    action: {
      runId: input.request.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      tool: 'run_terminal',
      effects: ['process'],
      input: input.scenario.verifier,
      authority: {
        decision: 'allow',
        status: 'authorized',
        reason: 'headless-caller-authorized-local-verification',
        evidenceRefs: [`headless-authority:${input.actionId}:authorized`],
      },
    },
    host: {
      async execute() {
        const verification = await new HeadlessVerificationAdapter().verify({
          plan: {
            runId: input.request.runId,
            sequence: input.sequence,
            actionId: input.actionId,
            idempotencyKey: `${input.request.runId}:${input.actionId}`,
            scopePaths: [input.scenario.targetPath],
            acceptance: input.request.taskContract.acceptance,
            payload: input.scenario.verifier,
            evidenceRefs: input.mutationEvidenceRefs,
          },
          host: {
            async verify() {
              const result = runVerifier(input.request.workspaceRoot, input.scenario.verifier);
              const status = result.passed ? 'passed' : 'failed';
              return {
                verifier: input.scenario.verifier.name,
                checks: [{
                  checkId: `${input.actionId}:behavior`,
                  status,
                  acceptanceIds: input.request.taskContract.acceptance.map(criterion => criterion.id),
                  summary: result.summary,
                  evidenceRefs: result.evidenceRefs,
                }],
                evidenceRefs: result.evidenceRefs,
              };
            },
          },
        });
        verificationReceipt = verification.receipt;
        return {
          status: verification.receipt.status === 'passed' ? 'completed' : 'failed',
          result: verification.receipt,
          ...(verification.receipt.status === 'passed' ? {} : { errorCode: 'verification-failed' }),
          evidenceRefs: verification.receipt.evidenceRefs,
        };
      },
    },
  });
  assert.ok(verificationReceipt, `${input.actionId} did not settle a verification receipt`);
  return { toolReceipt: tool.receipt, verificationReceipt };
}

function realWorkspaceMutationHost(workspaceRoot) {
  return {
    async captureBaseline(plan) {
      const relativePath = plan.payload.path;
      const absolutePath = join(workspaceRoot, relativePath);
      let content;
      try { content = await readFile(absolutePath, 'utf8'); } catch { content = undefined; }
      return {
        baselineRef: `headless-baseline:${relativePath}:${content === undefined ? 'absent' : 'present'}`,
        state: { relativePath, content },
        evidenceRefs: [`headless-baseline:${plan.actionId}:captured`],
      };
    },
    async apply(plan) {
      const absolutePath = join(workspaceRoot, plan.payload.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, plan.payload.content, 'utf8');
      return {
        status: 'applied',
        applied: {
          state: { relativePath: plan.payload.path, content: plan.payload.content },
          result: [plan.payload.path],
          evidenceRefs: [`headless-apply:${plan.actionId}:completed`],
        },
      };
    },
    async readback(plan) {
      const actual = await readFile(join(workspaceRoot, plan.payload.path), 'utf8');
      return {
        matches: actual === plan.payload.content,
        readbackRef: `headless-readback:${plan.actionId}:${actual.length}`,
        evidenceRefs: [`headless-readback:${plan.actionId}:matched`],
      };
    },
    async rollback(plan, baseline) {
      const absolutePath = join(workspaceRoot, plan.payload.path);
      if (baseline.state.content === undefined) await rm(absolutePath, { force: true });
      else await writeFile(absolutePath, baseline.state.content, 'utf8');
      return {
        rolledBack: true,
        rollbackRef: `headless-rollback:${plan.actionId}:completed`,
        evidenceRefs: [`headless-rollback:${plan.actionId}:completed`],
      };
    },
  };
}

function runVerifier(cwd, verifier) {
  const result = spawnSync(verifier.command, verifier.args, {
    cwd,
    encoding: 'utf8',
    input: verifier.stdin ?? '',
    timeout: 10000,
  });
  const evidenceRefs = [`${verifier.command} ${verifier.args.join(' ')}:exit=${result.status}`];
  return {
    passed: result.status === 0,
    summary: (result.stderr || result.stdout || `exit ${result.status}`).trim(),
    evidenceRefs,
  };
}

function productScenarios() {
  const createContent = [
    'import sys',
    'lines = sys.stdin.read().splitlines()',
    "print(f\"ERROR={sum('ERROR' in line for line in lines)}\")",
    "print(f\"WARN={sum('WARN' in line for line in lines)}\")",
    '',
  ].join('\n');
  return [
    {
      fixtureId: 'create-and-verify',
      files: {},
      trackedPaths: ['tools/log_summary.py'],
      targetPath: 'tools/log_summary.py',
      edits: [createContent],
      verifier: {
        name: 'python-behavior',
        command: 'python3',
        args: ['tools/log_summary.py'],
        stdin: 'ERROR first\nWARN second\nERROR third\n',
      },
      expectedChangedPaths: ['tools/log_summary.py'],
    },
    {
      fixtureId: 'modify-and-verify',
      files: { 'src/math.js': 'module.exports = { add: (a, b) => a - b };\n' },
      trackedPaths: ['src/math.js'],
      targetPath: 'src/math.js',
      edits: ['module.exports = { add: (a, b) => a + b };\n'],
      verifier: nodeVerifier('node-behavior', 'const {add}=require("./src/math.js"); if(add(2,3)!==5) process.exit(1);'),
      expectedChangedPaths: ['src/math.js'],
    },
    {
      fixtureId: 'verify-repair-reverify',
      files: { 'src/parser.js': 'module.exports = { parse: value => ({ ok: false, value }) };\n' },
      trackedPaths: ['src/parser.js'],
      targetPath: 'src/parser.js',
      edits: [
        'module.exports = { parse: value => ({ ok: value === "bad", value }) };\n',
        'module.exports = { parse: value => ({ ok: value === "valid", value }) };\n',
      ],
      verifier: nodeVerifier('focused-parser-test', 'const {parse}=require("./src/parser.js"); if(!parse("valid").ok) process.exit(1);'),
      expectedChangedPaths: ['src/parser.js'],
    },
    {
      fixtureId: 'permission-denied-no-effect',
      files: { 'package.json': '{"private":true}\n', 'src/index.js': 'module.exports = {};\n' },
      trackedPaths: ['package.json', 'package-lock.json', 'src/index.js'],
      expectedChangedPaths: [],
    },
    {
      fixtureId: 'policy-refusal-no-mutation',
      files: { 'README.md': 'safe workspace\n' },
      trackedPaths: ['README.md'],
      expectedChangedPaths: [],
    },
  ];
}

function nodeVerifier(name, script) {
  return { name, command: 'node', args: ['-e', script] };
}

function seedWorkspace(cwd, files) {
  mkdirSync(cwd, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(cwd, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  }
}

function snapshotUserFiles(cwd, paths) {
  return new Map(paths.map(relativePath => [
    relativePath,
    existsSync(join(cwd, relativePath)) ? readFileSync(join(cwd, relativePath), 'utf8') : undefined,
  ]));
}

function changedUserPaths(before, after) {
  return [...after.keys()].filter(relativePath => before.get(relativePath) !== after.get(relativePath));
}

function writeOptionalProductReport(surface, observations) {
  const reportPath = process.env.DEVSEEK_CODING_CONFORMANCE_REPORT_PATH;
  if (!reportPath) return;
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ surface, observations }, null, 2), 'utf8');
}

async function executeMutated(fixture, mutate) {
  const projection = structuredClone(fixture.expected);
  mutate(projection);
  const executor = new HeadlessCodingKernelExecutor({
    async executeCanonical() {
      return {
        status: fixture.expected.completion.status,
        result: { value: null, conformance: projection },
        evidenceRefs: fixture.expected.completion.evidenceRefs,
        residualRisks: fixture.expected.completion.residualRisks,
      };
    },
  });
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-headless-invalid-'));
  try {
    return await executor.execute(runInput(fixture, workspaceRoot));
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function runtimeOutput(fixture, value) {
  return {
    status: fixture.expected.completion.status,
    result: {
      value,
      conformance: structuredClone(fixture.expected),
    },
    evidenceRefs: fixture.expected.completion.evidenceRefs,
    residualRisks: fixture.expected.completion.residualRisks,
  };
}

function runInput(fixture, workspaceRoot) {
  return {
    runId: fixture.fixtureId,
    userPrompt: fixture.prompt,
    workspaceRoot,
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
    runtimeContext: { provider: 'deterministic' },
  };
}

function findFixture(fixtureId) {
  const fixture = CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.find(candidate => candidate.fixtureId === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  return fixture;
}
