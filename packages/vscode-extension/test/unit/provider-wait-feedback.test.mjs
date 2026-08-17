import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/provider-wait-feedback.bundle.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/provider-wait-feedback.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const { ProviderWaitFeedback } = req(bundlePath);

test('silent provider wait reports immediately and refreshes the same progress label', () => {
  const labels = [];
  const clock = fakeScheduler();
  const feedback = new ProviderWaitFeedback(
    (_kind, label) => labels.push(label),
    1,
    clock.scheduler,
    5_000,
  );

  assert.deepEqual(labels, ['正在等待模型响应']);
  clock.advanceTo(5_000);
  clock.tick();
  assert.deepEqual(labels, ['正在等待模型响应', '模型仍在处理，已等待 5 秒']);

  feedback.observeOutput();
  assert.equal(clock.clearCount(), 1);
  assert.equal(labels.at(-1), '已收到模型响应，正在解析动作');

  clock.advanceTo(10_000);
  clock.tick();
  assert.equal(labels.length, 3, 'no stale wait update may fire after first output');
});

test('non-streaming provider completion closes wait feedback without leaving a stale spinner label', () => {
  const labels = [];
  const clock = fakeScheduler();
  const feedback = new ProviderWaitFeedback(
    (_kind, label) => labels.push(label),
    2,
    clock.scheduler,
    5_000,
  );

  feedback.complete();

  assert.deepEqual(labels, [
    '正在等待模型继续处理',
    '已收到模型响应，正在解析动作',
  ]);
  assert.equal(clock.clearCount(), 1);
});

function fakeScheduler() {
  let now = 0;
  let interval;
  let clears = 0;
  return {
    scheduler: {
      now: () => now,
      setInterval(callback) {
        interval = callback;
        return 'wait-handle';
      },
      clearInterval(handle) {
        assert.equal(handle, 'wait-handle');
        clears++;
        interval = undefined;
      },
    },
    advanceTo(value) { now = value; },
    tick() { interval?.(); },
    clearCount() { return clears; },
  };
}
