import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCanonicalCheckpointFixture } from '../helpers/canonical-checkpoint-fixture.mjs';

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
  projectCodingKernelCheckpointResume,
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

test('CodingKernelRouteDecision keeps checkpoint replay on the canonical route', () => {
  const tasks = [{ id: 'task-1', action: 'modify', file: 'src/main.ts', desc: 'finish edit' }];
  const decision = decideCodingKernelRoute({
    checkpoint: {
      tasks,
      startFromIndex: 0,
      canonicalCheckpoint: createCanonicalCheckpointFixture({ tasks }),
      analysisContext: ' prior verified finding ',
    },
  });

  assert.equal(decision.route, 'canonical');
  assert.equal(decision.reason, 'checkpoint-resume');
  assert.equal(decision.recovery.kind, 'checkpoint-resume');
  assert.notEqual(decision.recovery.tasks, tasks);
  assert.deepEqual(decision.recovery.tasks, tasks);
  assert.equal(decision.recovery.startFromIndex, 0);
  assert.equal(decision.recovery.analysisContext, 'prior verified finding');
});

test('CodingKernelRouteDecision projects persisted checkpoint fields without rebuilding authority', () => {
  const allTasks = [{ id: 'task-1', action: 'modify', file: 'src/main.ts', desc: 'finish edit' }];
  const canonicalCheckpoint = createCanonicalCheckpointFixture({ tasks: allTasks });
  const projected = projectCodingKernelCheckpointResume({
    allTasks,
    startFromIndex: 0,
    canonicalCheckpoint,
  }, ' prior verified finding ');

  assert.deepEqual(projected.tasks, allTasks);
  assert.equal(projected.startFromIndex, 0);
  assert.equal(projected.canonicalCheckpoint, canonicalCheckpoint);
  assert.equal(projected.analysisContext, 'prior verified finding');
  assert.equal(projectCodingKernelCheckpointResume(undefined, 'ignored'), undefined);
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
