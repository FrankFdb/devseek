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

const {
  advanceAutoValidationFailureFence,
  shouldDeferAgentAutoValidation,
} = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('defers validation while a pure-write mutation cohort is still open', () => {
  assert.equal(shouldDeferAgentAutoValidation({
    pendingWriteCount: 4,
    roundHasValidationTerminalProgress: false,
    pendingCohortHasUnrepairedTerminalFailure: false,
    completionSignaled: false,
  }), true);
});

test('runs validation at explicit validation and completion boundaries', () => {
  const base = {
    pendingWriteCount: 4,
    roundHasValidationTerminalProgress: false,
    pendingCohortHasUnrepairedTerminalFailure: false,
    completionSignaled: false,
  };
  assert.equal(shouldDeferAgentAutoValidation({ ...base, roundHasValidationTerminalProgress: true }), false);
  assert.equal(shouldDeferAgentAutoValidation({ ...base, completionSignaled: true }), false);
});

test('does not duplicate validation after a failed terminal result', () => {
  assert.equal(shouldDeferAgentAutoValidation({
    pendingWriteCount: 4,
    roundHasValidationTerminalProgress: true,
    pendingCohortHasUnrepairedTerminalFailure: true,
    completionSignaled: false,
  }), true);
});

test('keeps a pending cohort open during context-only rounds', () => {
  assert.equal(shouldDeferAgentAutoValidation({
    pendingWriteCount: 0,
    roundHasValidationTerminalProgress: false,
    pendingCohortHasUnrepairedTerminalFailure: false,
    completionSignaled: false,
  }), false);
  assert.equal(shouldDeferAgentAutoValidation({
    pendingWriteCount: 1,
    roundHasValidationTerminalProgress: false,
    pendingCohortHasUnrepairedTerminalFailure: false,
    completionSignaled: false,
  }), true);
});

test('persists a failed validation fence across read-only rounds', () => {
  const failedFence = advanceAutoValidationFailureFence(undefined, {
    writeCount: 4,
    terminalOutcomes: [false],
  });
  assert.equal(failedFence, 4);
  assert.equal(advanceAutoValidationFailureFence(failedFence, {
    writeCount: 4,
    terminalOutcomes: [],
  }), 4);
});

test('clears a failed validation fence after repair or successful terminal evidence', () => {
  assert.equal(advanceAutoValidationFailureFence(4, {
    writeCount: 5,
    terminalOutcomes: [],
  }), undefined);
  assert.equal(advanceAutoValidationFailureFence(4, {
    writeCount: 4,
    terminalOutcomes: [true],
  }), undefined);
  assert.equal(advanceAutoValidationFailureFence(4, {
    writeCount: 5,
    terminalOutcomes: [false],
  }), 5);
});
