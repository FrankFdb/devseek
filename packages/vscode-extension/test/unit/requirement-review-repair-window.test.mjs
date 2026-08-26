import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/requirement-review-repair-window.bundle.cjs');

execSync(
  `npx esbuild src/agent/requirement-review-repair-window.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  renewRequirementReviewRepairWindow,
  updateRequirementReviewRepairWindow,
} = createRequire(import.meta.url)(bundlePath);
test('each failed review wave renews a bounded local repair cohort', () => {
  assert.equal(updateRequirementReviewRepairWindow(0, true).graceRounds, 6);
  assert.equal(updateRequirementReviewRepairWindow(6, true).graceRounds, 12);
  assert.equal(updateRequirementReviewRepairWindow(12, true).graceRounds, 18);
  assert.equal(updateRequirementReviewRepairWindow(18, true).graceRounds, 24);
  assert.equal(updateRequirementReviewRepairWindow(24, true).graceRounds, 24);
});

test('ordinary and repeated failed-review feedback opens one cohort without growing it', () => {
  assert.equal(updateRequirementReviewRepairWindow(0, false).graceRounds, 6);
  assert.equal(updateRequirementReviewRepairWindow(6, false).graceRounds, 6);
});

test('accepted review repair progress renews a moving lease inside the hard cap', () => {
  let graceRounds = renewRequirementReviewRepairWindow({
    currentGraceRounds: 6,
    baseRoundLimit: 55,
    roundCount: 60,
    acceptedSourceMutation: true,
    postMutationValidation: false,
    reviewPending: true,
  });
  assert.equal(graceRounds, 11);

  graceRounds = renewRequirementReviewRepairWindow({
    currentGraceRounds: graceRounds,
    baseRoundLimit: 55,
    roundCount: 65,
    acceptedSourceMutation: false,
    postMutationValidation: true,
    reviewPending: true,
  });
  assert.equal(graceRounds, 16);

  assert.equal(renewRequirementReviewRepairWindow({
    currentGraceRounds: 23,
    baseRoundLimit: 55,
    roundCount: 78,
    acceptedSourceMutation: true,
    postMutationValidation: false,
    reviewPending: true,
  }), 24);
});

test('review repair lease ignores read-only investigation, stalled actions, and settled reviews', () => {
  const base = {
    currentGraceRounds: 6,
    baseRoundLimit: 55,
    roundCount: 60,
  };
  assert.equal(renewRequirementReviewRepairWindow({
    ...base,
    acceptedSourceMutation: false,
    postMutationValidation: false,
    reviewPending: true,
  }), 6);
  assert.equal(renewRequirementReviewRepairWindow({
    ...base,
    acceptedSourceMutation: true,
    postMutationValidation: false,
    reviewPending: false,
  }), 6);
});
