import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/provider-authored-transcript-recovery.bundle.cjs');

execSync(
  `npx esbuild src/agent/provider-authored-transcript-recovery.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  buildProviderAuthoredToolTranscriptRecovery,
  containsProviderAuthoredToolTranscript,
  recoverRequirementReviewNoToolCompletion,
} = createRequire(import.meta.url)(bundlePath);

test('provider-authored transcript recovery detects DevSeek internal transcript echoes', () => {
  for (const text of [
    '[DevSeek 已执行工具请求摘要]意图：进行独立复核',
    '[工具结果 Round 9]\nread_file output...',
    '工具返回：src/order_book.cpp 已读取',
    '[读文件: /tmp/project/src/order_book.cpp]',
    '[read_file: /tmp/project/src/order_book.cpp]',
    '[replace_in_file: src/order_book.cpp]',
    'read_file: {"path":"src/order_book.cpp"}',
    'list_dir: /tmp/project',
    'grep_search: invalid_argument',
    'run_terminal: npm test',
  ]) {
    assert.equal(containsProviderAuthoredToolTranscript(text), true, text);
  }
});

test('provider-authored transcript recovery ignores normal no-tool prose', () => {
  assert.equal(
    containsProviderAuthoredToolTranscript('我需要继续读取最终源码，然后再做独立复核。'),
    false,
  );
});

test('provider-authored transcript recovery asks for real tools and keeps the blocker', () => {
  const blocker = '独立需求审查未完成：缺少最终源码 read_file 复核（src/order_book.cpp）。';
  const feedback = buildProviderAuthoredToolTranscriptRecovery(blocker, true);

  assert.match(feedback, /伪造工具结果已拦截/);
  assert.match(feedback, /真实工具调用/);
  assert.match(feedback, /\[DevSeek 已执行工具请求摘要\]/);
  assert.match(feedback, /\[工具结果 Round\]/);
  assert.match(feedback, /src\/order_book\.cpp/);
});

test('provider-authored transcript recovery also handles plain no-tool review stalls', () => {
  const blocker = '独立需求审查未完成：最终源码已读取，但隔离审查者尚未形成结论。';
  const feedback = buildProviderAuthoredToolTranscriptRecovery(blocker, false);

  assert.match(feedback, /工具执行缺失/);
  assert.match(feedback, /真实工具调用/);
  assert.match(feedback, /隔离审查者尚未形成结论/);
});

test('provider-authored transcript recovery preserves the active review blocker', () => {
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

  const decision = recoverRequirementReviewNoToolCompletion(
    requirementReview,
    1,
    '[DevSeek 已执行工具请求摘要]\n[工具结果 Round 9]\nread_file output',
  );

  assert.equal(decision.kind, 'retry');
  assert.equal(decision.statusTitle, '已拦截伪造工具结果');
  assert.match(decision.feedback, /src\/order_book\.cpp/);
  assert.match(decision.feedback, /不能跳过需求覆盖复核/);
});
