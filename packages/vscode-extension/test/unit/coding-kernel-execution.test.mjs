import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
  '--external:vscode',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const { CodingKernelExecutionService } = req(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('CodingKernelExecutionService routes new work through the canonical kernel port', async () => {
  const calls = [];
  const expected = result('canonical');
  const loops = {
    async runCanonical(...args) {
      calls.push(args);
      return expected;
    },
    async runLegacyPlanned() {
      throw new Error('legacy planned loop must not run');
    },
  };
  const callbacks = { executionMode: 'inspect' };
  const semanticContract = { version: 3, revision: { kind: 'replace' } };
  const service = new CodingKernelExecutionService(loops);

  const actual = await service.execute({
    route: 'canonical',
    userPrompt: 'inspect the repository',
    contextFiles: ['src/main.ts', 'build.log'],
    workspaceRoot: '/workspace',
    mode: 'r1',
    callbacks,
    sessionContextText: 'session context',
    workflowMode: 'inspect',
    memoryRelatedPaths: ['src/main.ts'],
    semanticContract,
  });

  assert.equal(actual, expected);
  assert.deepEqual(calls, [[
    'inspect the repository',
    ['src/main.ts', 'build.log'],
    '/workspace',
    'r1',
    callbacks,
    'session context',
    'inspect',
    ['src/main.ts'],
    semanticContract,
  ]]);
});

test('CodingKernelExecutionService restricts planned work to an explicit legacy reason', async () => {
  const calls = [];
  const expected = result('legacy-planned');
  const loops = {
    async runCanonical() {
      throw new Error('canonical loop must not run');
    },
    async runLegacyPlanned(...args) {
      calls.push(args);
      return expected;
    },
  };
  const tasks = [{ id: 'task-1', action: 'modify', desc: 'fix source' }];
  const workspaceRoot = { fsPath: '/workspace' };
  const callbacks = { executionMode: 'edit' };
  const semanticContract = { version: 3, revision: { kind: 'replace' } };
  const service = new CodingKernelExecutionService(loops);

  const actual = await service.execute({
    route: 'legacy-planned',
    legacyReason: 'checkpoint-resume',
    tasks,
    userPrompt: 'fix src/main.ts',
    mode: 'fast',
    workspaceRoot,
    callbacks,
    analysisContext: 'prior findings',
    startFromIndex: 2,
    semanticContract,
  });

  assert.equal(actual, expected);
  assert.deepEqual(calls, [[
    tasks,
    'fix src/main.ts',
    'fast',
    workspaceRoot,
    callbacks,
    'prior findings',
    2,
    semanticContract,
  ]]);
});

test('CodingKernelExecutionService fails closed on an unknown route', async () => {
  const service = new CodingKernelExecutionService({
    async runCanonical() { return result('canonical'); },
    async runLegacyPlanned() { return result('legacy-planned'); },
  });

  await assert.rejects(
    service.execute({ route: 'legacy-surface-bypass' }),
    /coding-kernel-execution:unsupported-route/u,
  );
});

test('CodingKernelExecutionService fails closed on an unknown legacy reason', async () => {
  const service = new CodingKernelExecutionService({
    async runCanonical() { return result('canonical'); },
    async runLegacyPlanned() { return result('legacy-planned'); },
  });

  await assert.rejects(
    service.execute({
      route: 'legacy-planned',
      legacyReason: 'fresh-task-bypass',
      tasks: [],
      userPrompt: 'edit',
      workspaceRoot: { fsPath: '/workspace' },
      callbacks: {},
    }),
    /coding-kernel-execution:unsupported-legacy-reason/u,
  );
});

function result(route) {
  return {
    tasksTotal: 1,
    tasksApplied: 1,
    tasksFailed: 0,
    changedPaths: [`${route}.txt`],
  };
}
