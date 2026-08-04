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
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-coding-kernel-route-'));
const bundlePath = path.join(tempRoot, 'coding-kernel-route-decision.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/coding-kernel-route-decision.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const {
  CODING_KERNEL_ROUTE_DECISION_VERSION,
  decideCodingKernelRoute,
} = req(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('CodingKernelRouteDecision keeps attachments as context, never executor selectors', () => {
  const contextShapes = [
    [],
    ['/workspace/src/main.ts'],
    ['/workspace/build.log'],
    ['/workspace/src/main.ts', '/workspace/build.log'],
  ];

  for (const contextFiles of contextShapes) {
    const decision = decideCodingKernelRoute({ contextFiles });
    assert.deepEqual(decision, {
      version: CODING_KERNEL_ROUTE_DECISION_VERSION,
      route: 'canonical',
      reason: 'new-task',
    });
  }
});

test('CodingKernelRouteDecision permits the legacy loop only for valid checkpoint replay', () => {
  const tasks = [{ id: 'task-1', action: 'modify', file: 'src/main.ts', desc: 'finish edit' }];
  const decision = decideCodingKernelRoute({
    checkpoint: { tasks, startFromIndex: 0 },
  });

  assert.equal(decision.route, 'legacy-planned');
  assert.equal(decision.reason, 'checkpoint-resume');
  assert.notEqual(decision.checkpoint.tasks, tasks);
  assert.deepEqual(decision.checkpoint.tasks, tasks);
  assert.equal(decision.checkpoint.startFromIndex, 0);
});

test('CodingKernelRouteDecision fails closed on malformed checkpoint replay', () => {
  assert.throws(
    () => decideCodingKernelRoute({ checkpoint: { tasks: [], startFromIndex: 0 } }),
    /coding-kernel-route:invalid-checkpoint-resume/u,
  );
  assert.throws(
    () => decideCodingKernelRoute({
      checkpoint: {
        tasks: [{ id: 'task-1', action: 'modify', file: 'src/main.ts', desc: 'finish edit' }],
        startFromIndex: 1,
      },
    }),
    /coding-kernel-route:invalid-checkpoint-resume/u,
  );
});
