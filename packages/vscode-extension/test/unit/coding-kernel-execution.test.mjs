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
  CanonicalCodingKernel,
  InMemoryCodingOperationJournal,
  buildCodingWorkspaceMutationPlan,
  buildCodingVerificationPlan,
  buildCodingKernelTaskContract,
  createFixtureCodingKernelEnvironment,
} from '../../../shared/dist/index.js';
import { createCanonicalCheckpointFixture } from '../helpers/canonical-checkpoint-fixture.mjs';
import {
  loadUserSimulationCase,
  materializeMemoryCandidates,
} from '../../../../scripts/lib/devseek-user-simulation-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-coding-kernel-execution-'));
const bundlePath = path.join(tempRoot, 'coding-kernel-execution.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/coding-kernel-execution.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const {
  VsCodeCodingKernelRuntimeAdapter,
  deliverVsCodeRecoverySettlement,
} = req(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('canonical Kernel sends VS Code work through its runtime adapter', async () => {
  const calls = [];
  const expected = result('canonical');
  const kernel = createKernel({
    async runCanonical(request) {
      calls.push(request);
      return expected;
    },
  });
  const semanticContract = { version: 3, revision: { kind: 'replace' } };

  const output = await execute(kernel, {
    route: 'canonical',
    userPrompt: 'inspect the repository',
    contextFiles: ['src/main.ts', 'build.log'],
    workspaceRoot: '/workspace',
    mode: 'r1',
    callbacks: { executionMode: 'inspect' },
    sessionContextText: 'session context',
    workflowMode: 'inspect',
    memoryRelatedPaths: ['src/main.ts'],
    semanticContract,
  });

  assert.notEqual(output.result, expected);
  assert.equal(output.result.agentResult.historyText, expected.historyText);
  assert.equal(output.completion.status, 'completed');
  assert.equal(output.status, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userPrompt, 'inspect the repository');
  assert.deepEqual(calls[0].contextFiles, ['src/main.ts', 'build.log']);
  assert.equal(calls[0].workspaceRoot, '/workspace');
  assert.equal(calls[0].workflowMode, 'inspect');
  assert.match(calls[0].sessionContextText, /^session context\n\n\[DevSeek Engineering Context\]/u);
  assert.match(calls[0].sessionContextText, /languages: typescript/u);
  assert.equal(calls[0].recoveryContextText, '');
  assert.equal(calls[0].semanticContract, semanticContract);
  assert.equal(calls[0].callbacks.traceRunId, output.runId);
  assert.equal(typeof calls[0].callbacks.canonicalToolAuthority.authorize, 'function');
  assert.equal(typeof calls[0].callbacks.canonicalExternalEffects.execute, 'function');
  assert.equal(
    typeof Object.getOwnPropertyDescriptor(calls[0].callbacks, 'canonicalVerificationAcceptance')?.get,
    'function',
    'verification acceptance must remain bound to the current revised TaskContract',
  );
});

test('runtime keeps verification audit history separate from current-contract settlement', async () => {
  const kernel = createKernel({
    async runCanonical(request) {
      const current = (await passCanonicalVerification(request, 'current-contract')).receipt;
      const historicalFailure = {
        ...current,
        actionId: 'verification-prior-contract',
        idempotencyKey: `${current.runId}:verification-prior-contract`,
        status: 'failed',
        checks: current.checks.map(check => ({ ...check, status: 'failed' })),
        acceptance: current.acceptance.map(criterion => ({ ...criterion, status: 'failed' })),
        evidenceRefs: ['verification:prior-contract:failed'],
      };
      return {
        ...result('canonical'),
        verificationReceipts: [historicalFailure, current],
      };
    },
  });

  const output = await execute(kernel, {
    ...baseRequest(),
    callbacks: { executionMode: 'edit' },
  });

  assert.equal(output.status, 'completed');
  assert.deepEqual(output.verificationReceipts.map(receipt => receipt.actionId), [
    'verification-current-contract',
  ]);
  assert.deepEqual(output.result.agentResult.verificationReceipts.map(receipt => receipt.actionId), [
    'verification-prior-contract',
    'verification-current-contract',
  ]);
});

test('canonical Kernel observes actual workspace apply lifecycle without replaying mutation evidence', async () => {
  const lifecycle = [];
  let applyCount = 0;
  const kernel = createKernel({
    async runCanonical(request) {
      const plan = buildCodingWorkspaceMutationPlan({
        runId: request.callbacks.traceRunId,
        sequence: 1,
        actionId: 'write-rate-limiter-source',
        idempotencyKey: `${request.callbacks.traceRunId}:write-rate-limiter-source`,
        paths: ['src/rate_limiter.cpp'],
        payload: { content: 'int rate_limiter = 1;' },
        evidenceRefs: ['fixture:workspace-write'],
      });
      const host = {
        captureBaseline: async () => ({
          baselineRef: 'fixture:baseline',
          state: { content: '' },
          evidenceRefs: ['fixture:baseline'],
        }),
        apply: async () => {
          applyCount += 1;
          return {
            status: 'applied',
            applied: {
              state: { content: 'int rate_limiter = 1;' },
              result: { changed: true },
              evidenceRefs: ['fixture:apply'],
            },
          };
        },
        readback: async () => ({
          matches: true,
          readbackRef: 'fixture:readback',
          evidenceRefs: ['fixture:readback'],
        }),
        rollback: async () => ({ rolledBack: true, evidenceRefs: ['fixture:rollback'] }),
      };
      const first = await request.callbacks.canonicalWorkspaceMutations.execute(plan, host);
      const replay = await request.callbacks.canonicalWorkspaceMutations.execute(plan, host);
      assert.equal(first.receipt.status, 'committed');
      assert.equal(replay.replayed, true);
      return result('canonical');
    },
  });

  await execute(kernel, {
    ...baseRequest(),
    callbacks: {
      executionMode: 'edit',
      onWorkspaceMutation: event => lifecycle.push(event),
    },
  });

  assert.equal(applyCount, 1);
  assert.deepEqual(lifecycle.map(event => event.state), ['started', 'committed']);
  assert.deepEqual(lifecycle.map(event => event.paths), [
    ['src/rate_limiter.cpp'],
    ['src/rate_limiter.cpp'],
  ]);
  assert.equal(lifecycle[1].replayed, false);
});

test('canonical Kernel envelope is the only VS Code prompt and workspace authority', async () => {
  const calls = [];
  const kernel = createKernel({
    async runCanonical(request) {
      calls.push(request);
      return result('canonical');
    },
  });

  await kernel.execute({
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: 'vscode',
    runId: 'vscode-authority-test',
    userPrompt: 'canonical prompt',
    workspaceRoot: '/canonical-workspace',
    taskContract: buildCodingKernelTaskContract({
      goal: 'canonical prompt',
      mode: 'review',
      deliverables: [{ id: 'result', kind: 'report' }],
      acceptance: [{
        id: 'completed',
        statement: 'The requested work is complete.',
        deliverableIds: ['result'],
        oracle: responseOracle(),
        externalBoundaryRefs: [],
      }],
      provenanceRefs: ['vscode-test'],
    }),
    operationJournal: new InMemoryCodingOperationJournal(),
    environment: createFixtureCodingKernelEnvironment('/canonical-workspace'),
    runtimeContext: {
      ...baseRequest(),
      callbacks: { executionMode: 'inspect' },
      userPrompt: 'spoofed runtime prompt',
      workspaceRoot: '/spoofed-workspace',
    },
  });

  assert.equal(calls[0].userPrompt, 'canonical prompt');
  assert.equal(calls[0].workspaceRoot, '/canonical-workspace');
});

test('I10-MEM-04 user journey: VS Code prompt consumes the sealed memory decision exactly once', async () => {
  const scenario = loadUserSimulationCase('I10', 'I10-MEM-04');
  const calls = [];
  const kernel = createKernel({
    async runCanonical(request) {
      calls.push(request);
      return result('canonical');
    },
  });

  const output = await execute(kernel, {
    ...baseRequest(),
    callbacks: { executionMode: 'edit' },
    memoryCandidates: materializeMemoryCandidates(scenario, { workspaceRoot: '/workspace' }),
  });

  assert.match(calls[0].memoryContextText, /DevSeek canonical memory decision=/u);
  assert.match(calls[0].memoryContextText, /Use the repository test command\./u);
  assert.doesNotMatch(calls[0].memoryContextText, /expose secrets/u);
  assert.match(calls[0].memoryContextText, /"effectiveAuthority":"memory"/u);
});

test('recovery failure stays paused with the same pending checkpoint work', async () => {
  const checkpoints = [];
  const calls = [];
  const recovery = checkpointRecovery(1);
  const kernel = createKernel({
    async runCanonical(request) {
      calls.push(request);
      return result('recovery', 1);
    },
  });

  const output = await execute(kernel, {
    ...baseRequest(),
    recovery,
    callbacks: {
      executionMode: 'edit',
      onTaskCheckpoint: async (...args) => { checkpoints.push(args); },
    },
  });

  assert.match(calls[0].recoveryContextText, /durable checkpoint resume/u);
  assert.match(calls[0].recoveryContextText, /pending task/u);
  assert.deepEqual(checkpoints, []);
  await deliverVsCodeRecoverySettlement({
    status: output.status,
    fallback: output.result.recoveryFallback,
    onTaskCheckpoint: async (...args) => { checkpoints.push(args); },
  });
  assertCheckpointCall(checkpoints, 0, [recovery.tasks[1]], 'paused', 1);
});

test('recovery success clears the durable checkpoint exactly once', async () => {
  const checkpoints = [];
  const kernel = createKernel({
    async runCanonical(request) {
      await passCanonicalVerification(request, 'recovery');
      return result('recovery');
    },
  });

  const output = await execute(kernel, {
    ...baseRequest(),
    recovery: checkpointRecovery(0),
    callbacks: {
      executionMode: 'edit',
      onTaskCheckpoint: async (...args) => { checkpoints.push(args); },
    },
  });

  assert.equal(output.status, 'completed');
  assert.deepEqual(checkpoints, []);
  await deliverVsCodeRecoverySettlement({
    status: output.status,
    fallback: output.result.recoveryFallback,
    onTaskCheckpoint: async (...args) => { checkpoints.push(args); },
  });
  assert.deepEqual(checkpoints, [[null, [], 'completed']]);
});

test('recovery stays paused when loop counters look successful but completion evidence is missing', async () => {
  const checkpoints = [];
  const kernel = createKernel({
    async runCanonical() {
      return {
        tasksTotal: 1,
        tasksApplied: 0,
        tasksFailed: 0,
        changedPaths: [],
      };
    },
  });

  const output = await execute(kernel, {
    ...baseRequest(),
    recovery: checkpointRecovery(0),
    callbacks: {
      executionMode: 'edit',
      onTaskCheckpoint: async (...args) => { checkpoints.push(args); },
    },
  });

  assert.equal(output.status, 'blocked');
  assert.deepEqual(checkpoints, []);
  await deliverVsCodeRecoverySettlement({
    status: output.status,
    fallback: output.result.recoveryFallback,
    onTaskCheckpoint: async (...args) => { checkpoints.push(args); },
  });
  assertCheckpointCall(checkpoints, 0, checkpointRecovery(0).tasks, 'paused', 0);
});

test('recovery exception preserves pending work before propagating the error', async () => {
  const checkpoints = [];
  const recovery = checkpointRecovery(0);
  const kernel = createKernel({
    async runCanonical() {
      throw new Error('provider disconnected');
    },
  });

  await assert.rejects(
    execute(kernel, {
      ...baseRequest(),
      recovery,
      callbacks: {
        executionMode: 'edit',
        onTaskCheckpoint: async (...args) => { checkpoints.push(args); },
      },
    }),
    /provider disconnected/u,
  );
  assertCheckpointCall(checkpoints, 0, recovery.tasks, 'paused', 0);
});

test('resumed progress retains the completed prefix across rebased pending queues', async () => {
  const checkpoints = [];
  const tasks = [
    { id: 'stage-3', file: 'stage-3.ts', action: 'modify', desc: 'finish stage 3' },
    { id: 'stage-4', file: 'stage-4.ts', action: 'modify', desc: 'finish stage 4' },
  ];
  const recovery = {
    version: 'devseek.coding-kernel-recovery/v1',
    kind: 'checkpoint-resume',
    tasks,
    startFromIndex: 0,
    checkpoint: createCanonicalCheckpointFixture({
      tasks,
      completedUnitCount: 2,
      workspaceRoot: '/workspace',
      runId: 'vscode-test-run',
      userPrompt: 'finish the task',
      taskContract: buildCodingKernelTaskContract({
        goal: 'finish the task',
        mode: 'change',
        include: [],
        deliverables: [{ id: 'result', kind: 'source-change' }],
        acceptance: [{
          id: 'completed',
          statement: 'The requested work is complete.',
          deliverableIds: ['result'],
          oracle: verificationOracle('workspace'),
          externalBoundaryRefs: [],
        }],
        provenanceRefs: ['vscode-test'],
      }),
    }),
  };
  const kernel = createKernel({
    async runCanonical(request) {
      await request.callbacks.onTaskCheckpoint(1, [tasks[1]], 'paused');
      return result('recovery', 1);
    },
  });

  await execute(kernel, {
    ...baseRequest(),
    recovery,
    callbacks: {
      executionMode: 'edit',
      onTaskCheckpoint: async (...args) => { checkpoints.push(args); },
    },
  });

  assertCheckpointCall(checkpoints, 1, [tasks[1]], 'paused', 3);
});

test('canonical Kernel fails closed on every non-canonical VS Code route', async () => {
  const kernel = createKernel({
    async runCanonical() { return result('canonical'); },
  });

  await assert.rejects(
    kernel.execute({ route: 'legacy-planned' }),
    /coding-kernel-execution:unsupported-route/u,
  );
});

function baseRequest() {
  return {
    route: 'canonical',
    userPrompt: 'finish the task',
    contextFiles: [],
    workspaceRoot: '/workspace',
    mode: 'fast',
    workflowMode: 'edit',
    providerType: 'bridge',
  };
}

function createKernel(loops) {
  return new CanonicalCodingKernel(new VsCodeCodingKernelRuntimeAdapter(loops));
}

function execute(kernel, runtimeContext) {
  const contextSeed = { files: runtimeContext.contextFiles.map(path => ({ path })) };
  const taskContract = buildCodingKernelTaskContract({
    goal: runtimeContext.userPrompt,
    mode: runtimeContext.workflowMode === 'inspect' ? 'review' : 'change',
    include: runtimeContext.contextFiles,
    deliverables: [{ id: 'result', kind: 'source-change' }],
    acceptance: [{
      id: 'completed',
      statement: 'The requested work is complete.',
      deliverableIds: ['result'],
      oracle: runtimeContext.workflowMode === 'inspect'
        ? responseOracle()
        : verificationOracle(...(runtimeContext.contextFiles.length > 0
          ? runtimeContext.contextFiles
          : ['workspace'])),
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['vscode-test'],
  });
  const recovery = runtimeContext.recovery?.kind === 'checkpoint-resume'
    ? {
        ...runtimeContext.recovery,
        checkpoint: runtimeContext.recovery.checkpoint ?? createCanonicalCheckpointFixture({
          tasks: runtimeContext.recovery.tasks,
          startFromIndex: runtimeContext.recovery.startFromIndex,
          workspaceRoot: runtimeContext.workspaceRoot,
          runId: 'vscode-test-run',
          userPrompt: runtimeContext.userPrompt,
          mode: runtimeContext.workflowMode === 'inspect' ? 'review' : 'change',
          contextFiles: runtimeContext.contextFiles,
          contextSeed,
          taskContract,
        }),
      }
    : runtimeContext.recovery;
  const effectiveRuntimeContext = { ...runtimeContext, ...(recovery ? { recovery } : {}) };
  return kernel.execute({
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: 'vscode',
    runId: 'vscode-test-run',
    userPrompt: runtimeContext.userPrompt,
    workspaceRoot: runtimeContext.workspaceRoot,
    taskContract,
    contextSeed,
    operationJournal: new InMemoryCodingOperationJournal(),
    environment: createFixtureCodingKernelEnvironment(runtimeContext.workspaceRoot, runtimeContext.providerType ?? 'bridge'),
    ...(runtimeContext.memoryCandidates ? { memoryCandidates: runtimeContext.memoryCandidates } : {}),
    ...(recovery?.kind === 'checkpoint-resume' ? { resumeCheckpoint: recovery.checkpoint } : {}),
    runtimeContext: effectiveRuntimeContext,
    signal: runtimeContext.callbacks?.signal,
  });
}

function verificationOracle(...scope) {
  return {
    kind: 'verification',
    verifier: 'vscode-test-adapter',
    scope,
    evidenceKinds: ['verification-receipt'],
  };
}

function responseOracle() {
  return {
    kind: 'response-evidence',
    verifier: 'vscode-test-adapter',
    scope: ['response'],
    evidenceKinds: ['response-evidence'],
  };
}

function assertCheckpointCall(calls, firstUnfinishedIndex, tasks, reason, completedUnitCount) {
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], firstUnfinishedIndex);
  assert.deepEqual(calls[0][1], tasks);
  assert.equal(calls[0][2], reason);
  assert.equal(calls[0][3].reason, reason);
  assert.equal(calls[0][3].completedUnitCount, completedUnitCount);
  assert.deepEqual(calls[0][3].pendingUnits.map(unit => unit.id), tasks.map(task => task.id));
}

function checkpointRecovery(startFromIndex) {
  return {
    version: 'devseek.coding-kernel-recovery/v1',
    kind: 'checkpoint-resume',
    tasks: [
      { id: 'done', file: 'done.ts', action: 'modify', desc: 'done task' },
      { id: 'pending', file: 'pending.ts', action: 'modify', desc: 'pending task' },
    ],
    startFromIndex,
  };
}

function result(route, tasksFailed = 0) {
  return {
    tasksTotal: 1,
    tasksApplied: tasksFailed ? 0 : 1,
    tasksFailed,
    changedPaths: [],
    ...(tasksFailed ? {} : {
      historyText: `Completed ${route}.`,
    }),
  };
}

async function passCanonicalVerification(request, route) {
  const runId = request.callbacks.traceRunId;
  return request.callbacks.canonicalVerification.verify(buildCodingVerificationPlan({
    runId,
    sequence: 1,
    actionId: `verification-${route}`,
    idempotencyKey: `${runId}:verification-${route}`,
    scopePaths: ['workspace'],
    acceptance: [{ id: 'completed', statement: 'The requested work is complete.' }],
    payload: { route },
    evidenceRefs: [],
  }), {
    async verify() {
      return {
        verifier: 'vscode-test',
        checks: [{
          checkId: `verification-${route}:check`,
          status: 'passed',
          acceptanceIds: ['completed'],
          summary: `${route} passed`,
          evidenceRefs: [`verification:${route}:passed`],
        }],
        evidenceRefs: [],
      };
    },
  });
}
