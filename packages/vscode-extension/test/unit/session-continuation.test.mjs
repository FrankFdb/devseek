import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/session-continuation.bundle.cjs');

execSync(
  `npx esbuild src/app/session-continuation.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  appendSessionContinuationContext,
  isExplicitCheckpointResumeRequest,
  isLikelySessionContinuation,
  isRunContinuationIntent,
  shouldInjectSessionContinuationForIntent,
  shouldInjectSessionContinuation,
  shouldResumeCheckpointFromPrompt,
  shouldRestoreSessionFiles,
} = req(bundlePath);

test('Session continuation: detects correction about modifying original code', () => {
  const prompt = '你为什么不在原来的 /home/ff/work/devseek_netai/code/shape_manager 中的代码中修改，而单独重新写了一个程序呢';
  assert.equal(isLikelySessionContinuation(prompt), true);
});

test('Session continuation: detects explicit same-session follow-up wording', () => {
  assert.equal(isLikelySessionContinuation('在上一轮基础上继续加测试'), true);
  assert.equal(isLikelySessionContinuation('不要重新写，基于已有代码修改'), true);
  assert.equal(isLikelySessionContinuation('继续修复 src/math.js'), true);
});

test('Session continuation: detects approval shorthand for prior task execution', () => {
  assert.equal(isLikelySessionContinuation('go ahead'), true);
  assert.equal(isLikelySessionContinuation('do it'), true);
  assert.equal(isLikelySessionContinuation('开始吧'), true);
  assert.equal(isLikelySessionContinuation('就按这个改'), true);
  assert.equal(isLikelySessionContinuation('按上面的计划落地'), true);
  assert.equal(isLikelySessionContinuation('go ahead?'), false);
});

test('Session continuation: explicit target actions start independent task contracts', () => {
  assert.equal(isLikelySessionContinuation(
    '请修复 src/math.js 中 add(a, b) 的明显错误。要求 add(2, 3) 返回 5。',
  ), false);
  assert.equal(isLikelySessionContinuation('Fix src/math.js and verify add(2, 3).'), false);
  assert.equal(isLikelySessionContinuation('Please update packages/api/index.ts.'), false);
});

test('Session continuation: detects explicit checkpoint resume wording', () => {
  assert.equal(isExplicitCheckpointResumeRequest('继续'), true);
  assert.equal(isExplicitCheckpointResumeRequest('继续执行'), true);
  assert.equal(isExplicitCheckpointResumeRequest('continue'), true);
  assert.equal(isExplicitCheckpointResumeRequest('继续优化一下'), false);
});

test('Session continuation: checkpoint resume ignores stale chat context controls', () => {
  assert.equal(shouldResumeCheckpointFromPrompt({
    userDisplay: '继续',
    prompt: '继续',
    forceNoAgent: true,
    files: ['docs/old-context.md'],
    images: ['data:image/png;base64,old'],
  }), true);
  assert.equal(shouldResumeCheckpointFromPrompt({
    userDisplay: '继续',
    prompt: '继续',
    newSession: true,
  }), false);
});

test('Session continuation: leaves execution/result wording to intent classification', () => {
  const runIntent = { mode: 'run', signals: ['run-request', 'follow-up-run-request'] };
  assert.equal(isLikelySessionContinuation('能执行，看到执行结果吗'), false);
  assert.equal(isLikelySessionContinuation('看一下运行结果'), false);
  assert.equal(isRunContinuationIntent(runIntent), true);
  assert.equal(shouldRestoreSessionFiles('能执行，看到执行结果吗', runIntent), true);
  assert.equal(
    shouldInjectSessionContinuationForIntent('能执行，看到执行结果吗', '上一轮文件：src/main.cpp', runIntent),
    false,
  );
});

test('Session continuation: restores files for direct execute-result follow-up', () => {
  const runIntent = { mode: 'run', signals: ['run-request', 'follow-up-run-request'] };
  assert.equal(shouldRestoreSessionFiles('请执行，给出执行结果', runIntent), true);
  assert.equal(
    shouldInjectSessionContinuationForIntent('请执行，给出执行结果', '上一轮文件：code/shape_manager/main.cpp', runIntent),
    false,
  );
});

test('Session continuation: run verification restores files without injecting stale task prose', () => {
  const runIntent = { mode: 'run', signals: ['run-request', 'conditional-repair-on-failure'] };
  const prompt = '请编译，执行，如果有编译错误，请修正';

  assert.equal(shouldRestoreSessionFiles(prompt, runIntent, true), true);
  assert.equal(
    shouldInjectSessionContinuationForIntent(prompt, '上一轮任务：创建 Cone.cpp；涉及文件：code/shape_manager/main.cpp', runIntent, true),
    false,
  );
});

test('Session continuation: code follow-up restores previous files without exact wording', () => {
  const editIntent = { mode: 'edit', signals: [] };
  const prompt = '可以通过鼠标动作，天空背景也添加了，天空背景能用夜晚色吗，同时所有图形能同时显示吗';

  assert.equal(isLikelySessionContinuation(prompt), false);
  assert.equal(shouldRestoreSessionFiles(prompt, editIntent, true), true);
  assert.equal(
    shouldInjectSessionContinuationForIntent(prompt, '上一轮文件：code/shape_manager/main.cpp', editIntent),
    true,
  );
});

test('Session continuation: independent new code tasks do not inherit stale files', () => {
  const editIntent = { mode: 'edit', signals: [] };

  assert.equal(
    shouldRestoreSessionFiles('创建一个新的 Python 程序，打印 hello', editIntent, true),
    false,
  );
});

test('Session continuation: explicit run targets do not inherit previous files', () => {
  const runIntent = {
    mode: 'run',
    signals: ['run-request', 'follow-up-run-request', 'explicit-file-path'],
  };
  assert.equal(isRunContinuationIntent(runIntent), false);
  assert.equal(shouldRestoreSessionFiles('编译 code/hello.cpp', runIntent), false);
});

test('Session continuation: does not inject without context', () => {
  assert.equal(shouldInjectSessionContinuation('继续优化一下', ''), false);
});

test('Session continuation: appends bounded context block', () => {
  const prompt = '继续优化一下';
  const context = '上一轮文件：src/main.cpp';
  assert.equal(
    appendSessionContinuationContext(prompt, context),
    '继续优化一下\n\n【同一会话续作上下文】\n上一轮文件：src/main.cpp',
  );
});

console.log('\nSession continuation tests passed.\n');
