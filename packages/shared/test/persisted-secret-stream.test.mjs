import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../');
const bundlePath = path.join(rootDir, 'test/persisted-secret-stream.bundle.cjs');

execFileSync('npx', [
  'esbuild',
  'src/index.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const {
  BridgeStreamCorrelator,
  createDeepSeekStreamFrame,
  DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION,
  DEEPSEEK_WEB_STREAM_RESET_PREFIX,
  DevSeekCapabilityTextStreamGuard,
} = req(bundlePath);

function frame(sequence, delta, done = false) {
  return createDeepSeekStreamFrame({
    requestId: 'bridge-op-reset',
    sequence,
    event: done ? 'done' : 'delta',
    done,
    delta,
  });
}

function observeIfAny(correlator, sequenceRef, delta) {
  if (!delta) return;
  correlator.observe(frame(sequenceRef.value, delta));
  sequenceRef.value += 1;
}

test('DevSeekCapabilityTextStreamGuard: reset snapshots preserve Bridge stream reset frame boundaries', () => {
  const guard = new DevSeekCapabilityTextStreamGuard();
  const correlator = new BridgeStreamCorrelator('bridge-op-reset');
  const sequence = { value: 1 };

  observeIfAny(correlator, sequence, guard.push(
    'earlier snapshot that is intentionally longer than the retained capability window before reset',
  ));

  const finalSnapshot = [
    '好的，我已经读取了必需文件。现在创建报告。',
    'create_file({"path":"/tmp/r3-live-deepseek-login-ready-state.md","content":"# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE\\nBridgeHealthCheck\\nnot fixed line-count smoke\\n"})',
  ].join('');
  observeIfAny(correlator, sequence, guard.push(DEEPSEEK_WEB_STREAM_RESET_PREFIX + finalSnapshot));
  observeIfAny(correlator, sequence, guard.finish());
  correlator.observe(frame(sequence.value, '', true));

  assert.equal(correlator.fullText, finalSnapshot);
  assert.doesNotMatch(correlator.fullText, /RESET/);
  assert.doesNotMatch(correlator.fullText, /earlier snapshot/);
  assert.match(correlator.fullText, /create_file\(\{"path":"\/tmp\/r3-live-deepseek-login-ready-state\.md"/);
  assert.equal(DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION, 'devseek.deepseek-web-stream/v1');
});

console.log('\nPersisted secret stream tests passed.\n');
