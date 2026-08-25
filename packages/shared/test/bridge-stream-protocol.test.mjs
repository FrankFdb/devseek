/**
 * Contract tests for the DeepSeek Web Bridge stream protocol.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../');
const bundlePath = path.join(rootDir, 'test/bridge-stream-protocol.bundle.cjs');

execSync(
  `npx esbuild src/bridge-stream-protocol.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  BridgeStreamCorrelator,
  DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION,
  canAgentRecoverDeepSeekStreamError,
  classifyDeepSeekStreamErrorMessage,
  parseDeepSeekStreamFrameData,
} = req(bundlePath);

function frame(overrides = {}) {
  return {
    protocolVersion: DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION,
    requestId: 'bridge-op-1',
    sequence: 1,
    event: 'delta',
    delta: 'hello',
    done: false,
    ...overrides,
  };
}

test('BridgeStreamCorrelator: rejects a frame from the wrong request before applying output', () => {
  const correlator = new BridgeStreamCorrelator('bridge-op-1');

  assert.throws(
    () => correlator.observe(frame({ requestId: 'bridge-op-2' })),
    /RESPONSE_CORRUPTED:stream-correlation-mismatch/,
  );
  assert.equal(correlator.fullText, '');
});

test('BridgeStreamCorrelator: duplicate replay frames have zero output effect', () => {
  const correlator = new BridgeStreamCorrelator('bridge-op-1');

  const first = correlator.observe(frame());
  const duplicate = correlator.observe(frame());
  const second = correlator.observe(frame({
    sequence: 2,
    delta: ' world',
  }));
  correlator.observe(frame({
    sequence: 3,
    event: 'done',
    delta: '',
    done: true,
  }));

  assert.equal(first.safeToApply, true);
  assert.equal(first.delta, 'hello');
  assert.equal(duplicate.safeToApply, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.delta, '');
  assert.equal(second.safeToApply, true);
  assert.equal(correlator.fullText, 'hello world');
  assert.doesNotThrow(() => correlator.assertComplete());
});

test('BridgeStreamCorrelator: reset frames rebuild text without exposing transport markers', () => {
  const correlator = new BridgeStreamCorrelator('bridge-op-reset');
  const first = correlator.observe(frame({
    requestId: 'bridge-op-reset',
    sequence: 1,
    delta: '\u0000RESET\u0000hello',
  }));
  const second = correlator.observe(frame({
    requestId: 'bridge-op-reset',
    sequence: 2,
    delta: '\u0000RESET\u0000hello world',
  }));

  assert.equal(first.delta, 'hello');
  assert.equal(second.delta, ' world');
  assert.equal(first.delta.includes('RESET'), false);
  assert.equal(second.delta.includes('RESET'), false);
  assert.equal(correlator.fullText, 'hello world');
});

test('BridgeStreamCorrelator: same sequence with different content is corrupt', () => {
  const correlator = new BridgeStreamCorrelator('bridge-op-1');
  correlator.observe(frame());

  assert.throws(
    () => correlator.observe(frame({ delta: 'different replay' })),
    /RESPONSE_CORRUPTED:stream-sequence-conflict/,
  );
  assert.equal(correlator.fullText, 'hello');
});

test('BridgeStreamCorrelator: stream cannot settle without a done frame', () => {
  const correlator = new BridgeStreamCorrelator('bridge-op-1');
  correlator.observe(frame());

  assert.throws(
    () => correlator.assertComplete(),
    /RESPONSE_CORRUPTED:stream-truncated/,
  );
});

test('BridgeStreamCorrelator: a correlated cancelled terminal never becomes partial success', () => {
  const correlator = new BridgeStreamCorrelator('bridge-op-cancelled');
  correlator.observe(frame({
    requestId: 'bridge-op-cancelled',
    sequence: 1,
    event: 'delta',
    delta: 'partial',
  }));
  assert.throws(() => correlator.observe(frame({
    requestId: 'bridge-op-cancelled',
    sequence: 2,
    event: 'cancelled',
    done: true,
    errorCategory: 'cancelled',
  })), /Cancelled/);
});

test('parseDeepSeekStreamFrameData: malformed SSE data fails closed', () => {
  assert.throws(
    () => parseDeepSeekStreamFrameData('{"delta": "unterminated"'),
    /RESPONSE_CORRUPTED:stream-malformed-frame/,
  );
});

test('DeepSeek stream errors distinguish rate limiter code from provider throttling', () => {
  assert.equal(classifyDeepSeekStreamErrorMessage('HTTP 429 rate limited'), 'rate-limited');
  assert.equal(classifyDeepSeekStreamErrorMessage('rate limiter.cpp failed to compile'), 'provider-error');
});

test('DeepSeek stream errors expose the categories safe for checkpoint recovery', () => {
  assert.equal(canAgentRecoverDeepSeekStreamError('provider-error'), true);
  assert.equal(canAgentRecoverDeepSeekStreamError('browser-session-lost'), true);
  assert.equal(canAgentRecoverDeepSeekStreamError('rate-limited'), false);
  assert.equal(canAgentRecoverDeepSeekStreamError('login-required'), false);
  assert.equal(canAgentRecoverDeepSeekStreamError('cancelled'), false);
});

console.log('\nBridge stream protocol tests passed.\n');
