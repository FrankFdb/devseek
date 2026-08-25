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

test('defers validation while a pure-write mutation cohort is still open', () => {
  assert.equal(shouldDeferAgentAutoValidation({
    pendingWriteCount: 4,
    roundHasWriteProgress: true,
    roundHasTerminalProgress: false,
    completionSignaled: false,
  }), true);
});

test('runs validation at explicit validation and completion boundaries', () => {
  const base = {
    pendingWriteCount: 4,
    roundHasWriteProgress: true,
    roundHasTerminalProgress: false,
    completionSignaled: false,
  };
  assert.equal(shouldDeferAgentAutoValidation({ ...base, roundHasTerminalProgress: true }), false);
  assert.equal(shouldDeferAgentAutoValidation({ ...base, completionSignaled: true }), false);
});

test('does not defer when there is no pending write or the round is not writing', () => {
  assert.equal(shouldDeferAgentAutoValidation({
    pendingWriteCount: 0,
    roundHasWriteProgress: true,
    roundHasTerminalProgress: false,
    completionSignaled: false,
  }), false);
  assert.equal(shouldDeferAgentAutoValidation({
    pendingWriteCount: 1,
    roundHasWriteProgress: false,
    roundHasTerminalProgress: false,
    completionSignaled: false,
  }), false);
});
