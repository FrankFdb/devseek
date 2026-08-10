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
  CanonicalBuildOrchestrationService,
  CanonicalEngineeringOrientationService,
  CanonicalVerificationService,
  CanonicalVerifierSelectionService,
  CanonicalToolExecutionService,
  CanonicalToolAuthorityService,
  CanonicalWorkspaceMutationTransaction,
  bindSettledCodingConformanceObservation,
  buildSecretHarvestingRefusalAcceptanceEvidence,
  buildCodingKernelTaskContract,
  classifyCodingTerminalEffects,
  evaluateCodingConformanceFixture,
  ProductRunEvidenceWorkspaceReader,
  resolveCodingKernelTaskContract,
} from '../../shared/dist/index.js';
import {
  HeadlessCodingKernelExecutor,
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
      assert.equal(output.orientation, output.taskContract.orientation, fixture.fixtureId);
      assert.equal(output.orientation.mode, output.taskContract.mode, fixture.fixtureId);
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

test('Headless product entry accepts no Surface-owned terminal or conformance projection', async t => {
  const fixture = findFixture('modify-and-verify');

  await t.test('legacy runtime terminal protocol fails closed', async () => {
    const executor = new HeadlessCodingKernelExecutor({
      async executeCanonical() {
        return {
          status: 'completed',
          result: { value: null, conformance: structuredClone(fixture.expected) },
          evidenceRefs: fixture.expected.completion.evidenceRefs,
        };
      },
    });
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-headless-legacy-terminal-'));
    try {
      await assert.rejects(
        executor.execute(runInput(fixture, workspaceRoot)),
        /coding-kernel-execution:missing-completion-evidence/,
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  await t.test('result claims cannot replace canonical verification', async () => {
    const executor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        return {
          result: {
            claimedStatus: 'completed',
            claimedConformance: structuredClone(fixture.expected),
          },
          completionEvidence: {
            reviewRequired: false,
            acceptanceEvidence: request.taskContract.acceptance.map(criterion => ({
              criterionId: criterion.id,
              status: 'passed',
              evidenceRefs: ['surface:claimed-pass'],
            })),
            pendingRefs: [],
            adverseEvidenceRefs: [],
            residualRisks: [],
            evidenceRefs: ['surface:claimed-completed'],
          },
        };
      },
    });
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-headless-claimed-terminal-'));
    try {
      const output = await executor.execute(runInput(fixture, workspaceRoot));
      assert.equal(output.result.claimedStatus, 'completed');
      assert.equal(output.status, 'blocked');
      assert.equal(output.completion.reasonCodes.includes('verification-not-run'), true);
      assert.equal(output.conformance.completion.status, 'blocked');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
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
  const adapter = new HeadlessToolExecutionAdapter(
    new CanonicalToolExecutionService().bind({ runId: 'headless-tool-run' }),
  );
  const denied = await adapter.execute({
    action: {
      tool: 'fetch_webpage',
      effects: ['network'],
      input: { url: 'https://example.com' },
    },
    authority: standaloneAuthority('headless-tool-run', 'change'),
    purpose: 'observe',
    surfaceConstraint: {
      decision: 'deny',
      reason: 'network-not-authorized',
      evidenceRefs: ['headless-policy:network-denied'],
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
  const outcome = await new HeadlessWorkspaceMutationAdapter(
    new CanonicalWorkspaceMutationTransaction(),
  ).execute({
    plan: {
      runId: 'headless-mutation-run',
      sequence: 1,
      actionId: 'headless-write-1',
      idempotencyKey: 'headless-mutation-run:headless-write-1',
      paths: ['src/value.ts'],
      payload: { content: 'updated\n' },
      evidenceRefs: ['headless-plan:write-1'],
    },
    tool: 'replace_file',
    authority: standaloneAuthority('headless-mutation-run', 'change'),
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

test('I18-HDL-01 user journey: unavailable Headless verifier never dispatches the host', async () => {
  const acceptance = [{ id: 'builds', statement: 'Project builds' }];
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Verify the headless workspace',
    mode: 'change',
    include: ['src/value.ts'],
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/value.ts' }],
    acceptance: [{
      ...acceptance[0],
      deliverableIds: ['source'],
      oracle: {
        kind: 'verification',
        verifier: 'headless-test-adapter',
        scope: ['src/value.ts'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['headless-test'],
  });
  const verification = new CanonicalVerificationService().bind({
    runId: 'headless-verify-run',
    acceptance,
  });
  const outcome = await new HeadlessVerificationAdapter({
    selection: new CanonicalVerifierSelectionService().bind({
      runId: 'headless-verify-run',
      workspaceRoot: '/workspace',
      taskContract,
      orientation: new CanonicalEngineeringOrientationService().orient({
        workspaceRoot: '/workspace',
        files: [{ path: 'src/value.ts' }],
      }),
    }),
    orchestration: new CanonicalBuildOrchestrationService().bind({ runId: 'headless-verify-run' }),
    verification,
  }).verify({
    runId: 'headless-verify-run',
    sequence: 1,
    actionId: 'headless-verify-1',
    workspaceRoot: '/workspace',
    scopePaths: ['src/value.ts'],
    acceptance,
    candidates: [],
    evidenceRefs: ['headless-mutation:committed'],
    host: {
      async execute() {
        throw new Error('unavailable selection must not execute a host step');
      },
    },
  });

  assert.equal(outcome.receipt.status, 'unverified');
  assert.equal(outcome.receipt.acceptance[0].status, 'unverified');
  assert.equal(verification.receipts()[0], outcome.receipt);
});

test('Headless Kernel blocks a change without canonical verification evidence', async () => {
  const fixture = findFixture('modify-and-verify');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-headless-completion-'));
  try {
    const output = await new HeadlessCodingKernelExecutor({
      async executeCanonical() {
        return {
          result: null,
          completionEvidence: {
            reviewRequired: false,
            acceptanceEvidence: [],
            pendingRefs: [],
            adverseEvidenceRefs: [],
            residualRisks: [],
            evidenceRefs: ['headless-task-contract:completion-run'],
          },
        };
      },
    }).execute(runInput(fixture, workspaceRoot));

    assert.equal(output.status, 'blocked');
    assert.equal(output.completion.reasonCodes.includes('verification-not-run'), true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

async function executeHeadlessProductRoute(request, scenario) {
  const toolExecutions = [];
  const mutations = [];
  const verifications = [];

  if (scenario.fixtureId === 'permission-denied-no-effect') {
    const denied = await new HeadlessToolExecutionAdapter(request.toolExecution).execute({
      action: {
        tool: 'run_terminal',
        effects: classifyCodingTerminalEffects('npm install left-pad'),
        input: { command: 'npm install left-pad' },
      },
      authority: request.toolAuthority,
      purpose: 'external-effect',
      risk: 'high',
      surfaceConstraint: {
        decision: 'deny',
        reason: 'dependency-and-network-authority-not-granted',
        evidenceRefs: ['headless-policy:install-denied'],
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
      mutations.push(mutation.changeReceipt);

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
    }
  }

  const completionEvidence = {
    reviewRequired: false,
    acceptanceEvidence: scenario.fixtureId === 'policy-refusal-no-mutation'
      ? buildSecretHarvestingRefusalAcceptanceEvidence()
      : scenario.fixtureId === 'permission-denied-no-effect'
        ? request.taskContract.acceptance.map(criterion => ({
          criterionId: criterion.id,
          status: 'blocked',
          evidenceRefs: toolExecutions.flatMap(receipt => receipt.evidenceRefs),
        }))
        : request.taskContract.acceptance
          .filter(criterion => criterion.oracle.kind !== 'verification')
          .map(criterion => ({
            criterionId: criterion.id,
            status: 'passed',
            evidenceRefs: mutations.flatMap(receipt => receipt.evidenceRefs),
          })),
    pendingRefs: [],
    adverseEvidenceRefs: [],
    residualRisks: scenario.fixtureId === 'permission-denied-no-effect'
      ? ['requested-change-not-applied']
      : [],
    evidenceRefs: [...request.taskContract.provenanceRefs, `headless-product:${request.runId}:settled`],
  };
  return {
    result: { fixtureId: request.runId },
    completionEvidence,
  };
}

async function executeHeadlessMutationTool(input) {
  let changeReceipt;
  const tool = await new HeadlessToolExecutionAdapter(input.request.toolExecution).execute({
    action: {
      tool: 'replace_file',
      effects: ['workspace-mutation'],
      input: { path: input.path, content: input.content },
    },
    authority: input.request.toolAuthority,
    purpose: 'workspace-mutation',
    risk: 'medium',
    targetPaths: [input.path],
    host: {
      async execute(action) {
        const mutation = await new HeadlessWorkspaceMutationAdapter(
          input.request.workspaceMutations,
        ).execute({
          plan: {
            runId: action.runId,
            sequence: action.sequence,
            actionId: action.actionId,
            idempotencyKey: `${action.runId}:${action.actionId}`,
            paths: [input.path],
            payload: { path: input.path, content: input.content },
            evidenceRefs: [`headless-plan:${input.actionId}`],
          },
          tool: 'replace_file',
          authority: input.request.toolAuthority,
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
  const context = input.request.toolExecution.nextAction({
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process'],
    input: input.scenario.verifier,
  });
  const effect = await input.request.externalEffects.execute({
    sequence: context.sequence,
    actionId: context.actionId,
    tool: 'run_terminal',
    purpose: 'verify',
    nature: 'observational',
    effects: ['process'],
    input: input.scenario.verifier,
    risk: 'medium',
  }, {
    async execute() {
        const candidate = headlessVerifierCandidate(
          input.request.workspaceRoot,
          input.scenario.targetPath,
          input.request.taskContract.acceptance,
          input.scenario.verifier,
        );
        const verification = await new HeadlessVerificationAdapter({
          selection: input.request.verifierSelection,
          orchestration: input.request.buildOrchestration,
          verification: input.request.verification,
        }).verify({
          runId: context.runId,
          sequence: context.sequence,
          actionId: context.actionId,
          workspaceRoot: input.request.workspaceRoot,
          scopePaths: [input.scenario.targetPath],
          acceptance: input.request.verificationAcceptance,
          candidates: [candidate],
          evidenceRefs: input.mutationEvidenceRefs,
          host: {
            async execute(step) {
              const result = runVerifierStep(input.request.workspaceRoot, step);
              return {
                stepId: step.id,
                status: result.exitCode === 0 ? 'passed' : 'failed',
                summary: result.summary,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                workspaceMutationPaths: [],
                evidenceRefs: result.evidenceRefs,
              };
            },
          },
        });
        verificationReceipt = verification.receipt;
        return {
          status: verification.receipt.status === 'passed' ? 'committed' : 'failed-no-effect',
          result: verification.receipt,
          ...(verification.receipt.status === 'passed' ? {} : { errorCode: 'verification-failed' }),
          evidenceRefs: verification.receipt.evidenceRefs,
        };
    },
  });
  assert.ok(verificationReceipt, `${input.actionId} did not settle a verification receipt`);
  assert.ok(effect.receipt.toolReceipt, `${input.actionId} did not settle a tool receipt`);
  return { toolReceipt: effect.receipt.toolReceipt, verificationReceipt };
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

function headlessVerifierCandidate(cwd, targetPath, acceptance, verifier) {
  return {
    id: `headless-${verifier.name}`,
    source: `headless-capability:${verifier.name}`,
    verifierIds: [...new Set(acceptance.map(criterion => criterion.oracle.verifier))],
    strength: 'runtime',
    priority: 10,
    scopePaths: [targetPath],
    workspaceAccess: 'read-only',
    steps: [{
      id: `headless-${verifier.name}:runtime`,
      role: 'runtime',
      invocation: {
        kind: 'process',
        command: verifier.command,
        args: verifier.args,
        ...(verifier.stdin ? { stdin: verifier.stdin } : {}),
      },
      cwd,
      timeoutMs: 10_000,
      outputPolicy: 'ephemeral',
      evidenceRefs: [`headless-capability:${verifier.name}`],
    }],
    evidenceRefs: [`headless-capability:${verifier.name}`],
  };
}

function runVerifierStep(cwd, step) {
  assert.equal(step.invocation.kind, 'process');
  const result = spawnSync(step.invocation.command, step.invocation.args, {
    cwd,
    encoding: 'utf8',
    input: step.invocation.stdin ?? '',
    timeout: step.timeoutMs,
  });
  const display = `${step.invocation.command} ${step.invocation.args.join(' ')}`;
  const evidenceRefs = [`${display}:exit=${result.status}`];
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
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

function runtimeOutput(fixture, value) {
  return {
    result: value,
    completionEvidence: {
      reviewRequired: false,
      acceptanceEvidence: [],
      pendingRefs: [],
      adverseEvidenceRefs: [],
      residualRisks: fixture.expected.completion.residualRisks,
      evidenceRefs: fixture.expected.completion.evidenceRefs,
    },
  };
}

function standaloneAuthority(runId, mode) {
  return new CanonicalToolAuthorityService().bind({
    runId,
    surface: 'headless',
    workspaceRoot: '/workspace',
    taskContract: buildCodingKernelTaskContract({
      goal: `${mode} the headless workspace`,
      mode,
      deliverables: [{ id: 'change', kind: 'source-change' }],
      acceptance: [{
        id: 'settled',
        statement: 'The operation is settled.',
        deliverableIds: ['change'],
        oracle: {
          kind: 'verification',
          verifier: 'headless-test-adapter',
          scope: ['workspace'],
          evidenceKinds: ['verification-receipt'],
        },
        externalBoundaryRefs: [],
      }],
      provenanceRefs: ['headless-test'],
    }),
  });
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
      acceptance: executableAcceptance(fixture),
      provenanceRefs: fixture.expected.taskContract.provenanceRefs,
    }),
    runtimeContext: { provider: 'deterministic' },
  };
}

function executableAcceptance(fixture) {
  const deliverableIds = fixture.expected.taskContract.deliverables.map(deliverable => deliverable.id);
  return fixture.expected.taskContract.acceptance.map(criterion => ({
    ...criterion,
    deliverableIds,
    oracle: {
      kind: 'verification',
      verifier: 'headless-conformance-adapter',
      scope: fixture.expected.taskContract.scope.include.length > 0
        ? fixture.expected.taskContract.scope.include
        : ['workspace'],
      evidenceKinds: ['verification-receipt'],
    },
    externalBoundaryRefs: [],
  }));
}

function findFixture(fixtureId) {
  const fixture = CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.find(candidate => candidate.fixtureId === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  return fixture;
}
