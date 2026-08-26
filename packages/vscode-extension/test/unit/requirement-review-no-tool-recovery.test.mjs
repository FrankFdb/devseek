import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/requirement-review-no-tool-recovery.bundle.cjs');

execSync(
  `npx esbuild src/agent/requirement-review-no-tool-recovery.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  recoverRequirementReviewNoToolCompletion,
} = createRequire(import.meta.url)(bundlePath);

test('requirement review no-tool recovery preserves ledger feedback', () => {
  const requirementReview = {
    recoverNoToolCompletion(consecutiveRound) {
      assert.equal(consecutiveRound, 1);
      return {
        kind: 'retry',
        feedback: '【系统反馈：不能跳过需求覆盖复核】\n请先用 read_file 重新读取最终源码。',
      };
    },
    completionBlocker() {
      return '独立需求审查未完成：缺少最终源码 read_file 复核（src/order_book.cpp）。';
    },
  };

  const decision = recoverRequirementReviewNoToolCompletion(requirementReview, 1);

  assert.equal(decision.kind, 'retry');
  assert.equal(decision.statusTitle, '正在复核最终源码与用户需求');
  assert.match(decision.feedback, /不能跳过需求覆盖复核/);
});

test('requirement review no-tool recovery falls back to the active blocker', () => {
  const requirementReview = {
    recoverNoToolCompletion() {
      return undefined;
    },
    completionBlocker() {
      return '独立需求审查未完成：隔离审查者尚未形成结论。';
    },
  };

  const decision = recoverRequirementReviewNoToolCompletion(requirementReview, 2);

  assert.equal(decision.kind, 'retry');
  assert.match(decision.feedback, /工具执行缺失/);
  assert.match(decision.feedback, /隔离审查者尚未形成结论/);
});

test('requirement review no-tool recovery respects the ledger stop decision', () => {
  const requirementReview = {
    recoverNoToolCompletion() {
      return { kind: 'stop', reason: '独立需求审查连续停滞。' };
    },
    completionBlocker() {
      return '独立需求审查未完成。';
    },
  };

  assert.deepEqual(
    recoverRequirementReviewNoToolCompletion(requirementReview, 3),
    { kind: 'stop', reason: '独立需求审查连续停滞。' },
  );
});
