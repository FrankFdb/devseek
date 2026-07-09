/**
 * Unit tests for agent/task-convergence-guard.ts.
 *
 * The guard protects Codex/Claude-style agent loops from repeating the same
 * tool call and feedback without producing new evidence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-convergence-guard.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-convergence-guard.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { createTaskConvergenceGuard } = req(bundlePath);

function repeatedReadObservation() {
  return {
    tools: [{
      id: 'fake-tool:read_file',
      name: 'read_file',
      input: { path: '/workspace/code/shape_manager/main.cpp' },
      source: 'fake-tool',
      registered: true,
      kind: 'read',
      risk: 'low',
    }],
    feedbackForAI: '[read_file] /workspace/code/shape_manager/main.cpp\n#include <GL/glut.h>',
    rawText: 'Action: read_fileAction Input: {"path":"/workspace/code/shape_manager/main.cpp"}',
  };
}

test('TaskConvergenceGuard: warns then blocks repeated no-progress tool output', () => {
  const guard = createTaskConvergenceGuard({ warnAfter: 2, stopAfter: 3 });

  assert.deepEqual(guard.observe(repeatedReadObservation()), { kind: 'continue' });

  const warning = guard.observe(repeatedReadObservation());
  assert.equal(warning.kind, 'continue');
  assert.match(warning.feedbackSuffix, /收敛提醒/);
  assert.match(warning.feedbackSuffix, /不要再次重复同一读取/);

  const blocked = guard.observe(repeatedReadObservation());
  assert.equal(blocked.kind, 'blocked');
  assert.equal(blocked.reason, 'repeated-no-progress');
  assert.match(blocked.detail, /避免继续重复同一错误/);
});

test('TaskConvergenceGuard: workspace writes reset the repeated-output counter', () => {
  const guard = createTaskConvergenceGuard({ warnAfter: 2, stopAfter: 3 });

  guard.observe(repeatedReadObservation());
  const warning = guard.observe(repeatedReadObservation());
  assert.equal(warning.kind, 'continue');
  assert.match(warning.feedbackSuffix, /收敛提醒/);

  const write = guard.observe({
    ...repeatedReadObservation(),
    writtenFiles: [{
      path: '/workspace/code/shape_manager/main.cpp',
      basename: 'main.cpp',
      linesAdded: 2,
      linesRemoved: 1,
      action: 'modify',
    }],
  });
  assert.deepEqual(write, { kind: 'continue' });

  assert.deepEqual(guard.observe(repeatedReadObservation()), { kind: 'continue' });
});

console.log('\nTask convergence guard tests passed.\n');
