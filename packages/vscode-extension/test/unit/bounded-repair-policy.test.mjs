import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/bounded-repair-policy.bundle.cjs');

execSync(
  `npx esbuild src/app/bounded-repair-policy.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  decideBoundedRepairProgress,
  decideClosedLoopRepairability,
  extendRepairRoundBudget,
  normalizeRepairRoundBudget,
} = req(bundlePath);

test('BoundedRepairPolicy: unchanged validation failure gets exactly one root-cause retry before stop', () => {
  assert.deepEqual(decideBoundedRepairProgress({
    validationFailed: true,
    canContinue: true,
    repeatedRepairAttempt: false,
    stagnantFailureRounds: 1,
  }), {
    kind: 'retry-with-root-cause',
    repeatedRepairAttempt: false,
    stagnantFailureRounds: 1,
  });

  assert.deepEqual(decideBoundedRepairProgress({
    validationFailed: true,
    canContinue: true,
    repeatedRepairAttempt: false,
    stagnantFailureRounds: 2,
  }), {
    kind: 'stop-no-progress',
    repeatedRepairAttempt: false,
    stagnantFailureRounds: 2,
  });
});

test('BoundedRepairPolicy: repeated same repair plus stagnant failure stops immediately', () => {
  assert.deepEqual(decideBoundedRepairProgress({
    validationFailed: true,
    canContinue: true,
    repeatedRepairAttempt: true,
    stagnantFailureRounds: 1,
  }), {
    kind: 'stop-no-progress',
    repeatedRepairAttempt: true,
    stagnantFailureRounds: 1,
  });
});

test('BoundedRepairPolicy: progress and last-round budget exhaustion stay distinct', () => {
  assert.equal(decideBoundedRepairProgress({
    validationFailed: false,
    canContinue: true,
    repeatedRepairAttempt: true,
    stagnantFailureRounds: 8,
  }).kind, 'progressing');

  assert.equal(decideBoundedRepairProgress({
    validationFailed: true,
    canContinue: false,
    repeatedRepairAttempt: false,
    stagnantFailureRounds: 1,
  }).kind, 'progressing');
});

test('BoundedRepairPolicy: configured repair budgets are clamped and user continuation is explicit', () => {
  assert.equal(normalizeRepairRoundBudget(undefined), 6);
  assert.equal(normalizeRepairRoundBudget(99), 6);
  assert.equal(normalizeRepairRoundBudget(-3), 0);
  assert.equal(normalizeRepairRoundBudget(2.8), 2);
  assert.equal(extendRepairRoundBudget(6), 9);
});

test('BoundedRepairPolicy: repairability requires failed runnable validation and unblocked QualityGate', () => {
  const repairable = {
    applied: true,
    validation: { ran: true, ok: false, status: 'failed', command: 'npm test' },
  };

  assert.deepEqual(decideClosedLoopRepairability(repairable), {
    repairable: true,
    reason: 'failed-runnable-validation',
  });
  assert.equal(decideClosedLoopRepairability({
    ...repairable,
    qualityGate: { status: 'blocked' },
  }).reason, 'quality-gate-blocked');
  assert.equal(decideClosedLoopRepairability({
    ...repairable,
    validation: { ran: false, ok: false, status: 'blocked', command: '' },
  }).reason, 'validation-not-run');
  assert.equal(decideClosedLoopRepairability({
    ...repairable,
    validation: { ran: true, ok: true, status: 'passed', command: 'npm test' },
  }).reason, 'validation-not-failed');
});
