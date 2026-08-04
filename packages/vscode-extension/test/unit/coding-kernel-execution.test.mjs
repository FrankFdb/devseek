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
  buildCodingKernelTaskContract,
} from '../../../shared/dist/index.js';

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
const { VsCodeCodingKernelRuntimeAdapter } = req(bundlePath);

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

  assert.equal(output.result, expected);
  assert.equal(output.status, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userPrompt, 'inspect the repository');
  assert.deepEqual(calls[0].contextFiles, ['src/main.ts', 'build.log']);
  assert.equal(calls[0].workspaceRoot, '/workspace');
  assert.equal(calls[0].workflowMode, 'inspect');
  assert.equal(calls[0].recoveryContextText, '');
  assert.equal(calls[0].semanticContract, semanticContract);
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
      acceptance: [{ id: 'completed', statement: 'The requested work is complete.' }],
      provenanceRefs: ['vscode-test'],
    }),
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

  await execute(kernel, {
    ...baseRequest(),
    recovery,
    callbacks: {
      executionMode: 'edit',
      onTaskCheckpoint: async (...args) => { checkpoints.push(args); },
    },
  });

  assert.match(calls[0].recoveryContextText, /durable checkpoint resume/u);
  assert.match(calls[0].recoveryContextText, /pending task/u);
  assert.deepEqual(checkpoints, [[1, [recovery.tasks[1]], 'paused']]);
});

test('recovery success clears the durable checkpoint exactly once', async () => {
  const checkpoints = [];
  const kernel = createKernel({
    async runCanonical() {
      return result('recovery');
    },
  });

  await execute(kernel, {
    ...baseRequest(),
    recovery: checkpointRecovery(0),
    callbacks: {
      executionMode: 'edit',
      onTaskCheckpoint: async (...args) => { checkpoints.push(args); },
    },
  });

  assert.deepEqual(checkpoints, [[null, [], 'completed']]);
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
  assert.deepEqual(checkpoints, [[0, [...recovery.tasks], 'paused']]);
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
  };
}

function createKernel(loops) {
  return new CanonicalCodingKernel(new VsCodeCodingKernelRuntimeAdapter(loops));
}

function execute(kernel, runtimeContext) {
  return kernel.execute({
    version: CODING_KERNEL_REQUEST_VERSION,
    route: 'canonical',
    surface: 'vscode',
    runId: 'vscode-test-run',
    userPrompt: runtimeContext.userPrompt,
    workspaceRoot: runtimeContext.workspaceRoot,
    taskContract: buildCodingKernelTaskContract({
      goal: runtimeContext.userPrompt,
      mode: runtimeContext.workflowMode === 'inspect' ? 'review' : 'change',
      include: runtimeContext.contextFiles,
      deliverables: [{ id: 'result', kind: 'source-change' }],
      acceptance: [{ id: 'completed', statement: 'The requested work is complete.' }],
      provenanceRefs: ['vscode-test'],
    }),
    runtimeContext,
    signal: runtimeContext.callbacks?.signal,
  });
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
    changedPaths: tasksFailed ? [] : [`${route}.txt`],
  };
}
