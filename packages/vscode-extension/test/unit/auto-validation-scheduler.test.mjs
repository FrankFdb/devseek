import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-validation-scheduler-'));
const bundlePath = path.join(tempRoot, 'auto-validation-scheduler.cjs');

execSync(
  `npx esbuild src/agent/auto-validation-scheduler.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { shouldDeferAgentAutoValidation } = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

const pendingTodo = Object.freeze({ id: 1, title: 'Implement sources', status: 'in-progress' });

test('defers validation while a planned multi-file write cohort is still open', () => {
  assert.equal(shouldDeferAgentAutoValidation({
    pendingWriteCount: 4,
    roundHasWriteProgress: true,
    roundHasTerminalProgress: false,
    completionSignaled: false,
    todos: [pendingTodo],
  }), true);
});

test('runs validation at explicit validation and completion boundaries', () => {
  const base = {
    pendingWriteCount: 4,
    roundHasWriteProgress: true,
    roundHasTerminalProgress: false,
    completionSignaled: false,
    todos: [pendingTodo],
  };
  assert.equal(shouldDeferAgentAutoValidation({ ...base, roundHasTerminalProgress: true }), false);
  assert.equal(shouldDeferAgentAutoValidation({ ...base, completionSignaled: true }), false);
  assert.equal(shouldDeferAgentAutoValidation({
    ...base,
    todos: [{ ...pendingTodo, status: 'completed' }],
  }), false);
});

test('preserves immediate validation when the model did not establish a plan', () => {
  assert.equal(shouldDeferAgentAutoValidation({
    pendingWriteCount: 1,
    roundHasWriteProgress: true,
    roundHasTerminalProgress: false,
    completionSignaled: false,
    todos: [],
  }), false);
});
