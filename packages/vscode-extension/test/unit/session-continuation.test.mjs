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
  isLikelySessionContinuation,
  shouldInjectSessionContinuation,
} = req(bundlePath);

test('Session continuation: detects correction about modifying original code', () => {
  const prompt = '你为什么不在原来的 /home/ff/work/devseek_netai/code/shape_manager 中的代码中修改，而单独重新写了一个程序呢';
  assert.equal(isLikelySessionContinuation(prompt), true);
});

test('Session continuation: detects explicit same-session follow-up wording', () => {
  assert.equal(isLikelySessionContinuation('在上一轮基础上继续加测试'), true);
  assert.equal(isLikelySessionContinuation('不要重新写，基于已有代码修改'), true);
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
