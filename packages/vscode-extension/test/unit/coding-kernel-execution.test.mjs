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

test('CodingKernelExecutionService routes exploratory work through the single kernel port', async () => {
  const calls = [];
  const expected = result('exploratory');
  const loops = {
    async runExploratory(...args) {
      calls.push(args);
      return expected;
    },
    async runPlanned() {
      throw new Error('planned loop must not run');
    },
  };
  const callbacks = { executionMode: 'inspect' };
  const service = new CodingKernelExecutionService(loops);

  const actual = await service.execute({
    route: 'exploratory',
    userPrompt: 'inspect the repository',
    dataFiles: ['build.log'],
    workspaceRoot: '/workspace',
    mode: 'r1',
    callbacks,
    sessionContextText: 'session context',
    workflowMode: 'inspect',
    memoryRelatedPaths: ['src/main.ts'],
  });

  assert.equal(actual, expected);
  assert.deepEqual(calls, [[
    'inspect the repository',
    ['build.log'],
    '/workspace',
    'r1',
    callbacks,
    'session context',
    'inspect',
    ['src/main.ts'],
  ]]);
});

test('CodingKernelExecutionService routes planned work through the same kernel port', async () => {
  const calls = [];
  const expected = result('planned');
  const loops = {
    async runExploratory() {
      throw new Error('exploratory loop must not run');
    },
    async runPlanned(...args) {
      calls.push(args);
      return expected;
    },
  };
  const tasks = [{ id: 'task-1', action: 'modify', desc: 'fix source' }];
  const workspaceRoot = { fsPath: '/workspace' };
  const callbacks = { executionMode: 'edit' };
  const service = new CodingKernelExecutionService(loops);

  const actual = await service.execute({
    route: 'planned',
    tasks,
    userPrompt: 'fix src/main.ts',
    mode: 'fast',
    workspaceRoot,
    callbacks,
    analysisContext: 'prior findings',
    startFromIndex: 2,
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
  ]]);
});

test('CodingKernelExecutionService fails closed on an unknown route', async () => {
  const service = new CodingKernelExecutionService({
    async runExploratory() { return result('exploratory'); },
    async runPlanned() { return result('planned'); },
  });

  await assert.rejects(
    service.execute({ route: 'legacy-surface-bypass' }),
    /coding-kernel-execution:unsupported-route/u,
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
