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

const { updateRequirementReviewRepairWindow } = createRequire(import.meta.url)(bundlePath);
const failedReview = '【独立需求审查：未通过】\nA distinct final-source defect remains.';

test('each failed review wave renews a bounded local repair cohort', () => {
  assert.equal(updateRequirementReviewRepairWindow(0, failedReview).graceRounds, 6);
  assert.equal(updateRequirementReviewRepairWindow(6, failedReview).graceRounds, 12);
  assert.equal(updateRequirementReviewRepairWindow(12, failedReview).graceRounds, 18);
  assert.equal(updateRequirementReviewRepairWindow(18, failedReview).graceRounds, 24);
  assert.equal(updateRequirementReviewRepairWindow(24, failedReview).graceRounds, 24);
});

test('non-finding review feedback opens one cohort without repeatedly growing it', () => {
  const evidenceFeedback = '【系统反馈：完成前需求覆盖复核】';
  assert.equal(updateRequirementReviewRepairWindow(0, evidenceFeedback).graceRounds, 6);
  assert.equal(updateRequirementReviewRepairWindow(6, evidenceFeedback).graceRounds, 6);
});
