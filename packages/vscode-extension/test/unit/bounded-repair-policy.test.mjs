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
  decideRunBudgetPolicy,
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

test('R3-09B BudgetPolicy: optional over-budget work replans without skipping safety or acceptance', () => {
  const decision = decideRunBudgetPolicy({
    phases: [
      { phase: 'provider', allocated: 10, used: 14, required: false },
      { phase: 'safety', allocated: 2, used: 1, required: true },
      { phase: 'validation', allocated: 8, used: 3, required: true },
      { phase: 'quality-gate', allocated: 4, used: 1, required: true },
    ],
    stagnantRounds: 0,
  });

  assert.equal(decision.protocol, 'devseek.run-budget-policy/v1');
  assert.equal(decision.authority, 'bounded-repair-policy');
  assert.equal(decision.decision, 'replan');
  assert.equal(decision.reason, 'optional-budget-exceeded-replan');
  assert.deepEqual(decision.overBudgetPhases, ['provider']);
  assert.deepEqual(decision.blockedRequiredPhases, []);
  assert.deepEqual(decision.skippedRequiredPhases, []);
  assert.equal(decision.safetyAndAcceptanceProtected, true);
  assert.equal(decision.replanRequired, true);
});

test('R3-09B BudgetPolicy: safety and acceptance budget exhaustion blocks instead of silent skip', () => {
  const validationOverBudget = decideRunBudgetPolicy({
    phases: [
      { phase: 'provider', allocated: 10, used: 10, required: false },
      { phase: 'safety', allocated: 2, used: 1, required: true },
      { phase: 'validation', allocated: 3, used: 5, required: true },
      { phase: 'quality-gate', allocated: 2, used: 1, required: true },
    ],
  });
  assert.equal(validationOverBudget.decision, 'blocked');
  assert.equal(validationOverBudget.reason, 'required-budget-exceeded-blocked');
  assert.deepEqual(validationOverBudget.blockedRequiredPhases, ['validation']);
  assert.deepEqual(validationOverBudget.skippedRequiredPhases, ['validation']);

  const missingSafety = decideRunBudgetPolicy({
    phases: [
      { phase: 'provider', allocated: 6, used: 2, required: false },
      { phase: 'validation', allocated: 4, used: 1, required: true },
      { phase: 'quality-gate', allocated: 4, used: 1, required: true },
    ],
  });
  assert.equal(missingSafety.decision, 'blocked');
  assert.equal(missingSafety.reason, 'required-budget-missing-blocked');
  assert.deepEqual(missingSafety.blockedRequiredPhases, ['safety']);
  assert.deepEqual(missingSafety.skippedRequiredPhases, ['safety']);
});

test('R3-09B BudgetPolicy: no-progress loops are bounded by policy', () => {
  const decision = decideRunBudgetPolicy({
    phases: [
      { phase: 'safety', allocated: 2, used: 1, required: true },
      { phase: 'validation', allocated: 8, used: 3, required: true },
      { phase: 'quality-gate', allocated: 4, used: 1, required: true },
    ],
    stagnantRounds: 2,
    maxStagnantRounds: 2,
  });

  assert.equal(decision.decision, 'blocked');
  assert.equal(decision.reason, 'no-progress-budget-exhausted');
  assert.equal(decision.noProgressBounded, true);
  assert.equal(decision.maxStagnantRounds, 2);
});
