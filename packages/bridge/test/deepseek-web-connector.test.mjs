import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const bridgeRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-deepseek-web-connector-'));
const bundlePath = path.join(bundleRoot, 'deepseek-web-connector.cjs');

buildSync({
  entryPoints: [path.join(bridgeRoot, 'src/deepseek-web-connector.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const {
  CanonicalDeepSeekWebConnectorExecutionService,
  CanonicalDeepSeekWebConnectorService,
  DeepSeekWebConnectorCancelledError,
} = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('DeepSeekWebConnectorPort advertises a versioned exact capability contract and rejects duplicate ids', () => {
  const connector = new CanonicalDeepSeekWebConnectorService();
  const advertisement = connector.advertisement();
  assert.equal(advertisement.protocolVersion, 'devseek.deepseek-web-connector/v1');
  assert.equal(advertisement.maxAttempts, 2);
  assert.equal(advertisement.capabilities.includes('request-correlation'), true);

  const session = connector.open({ requestId: 'request-1', stream: true });
  assert.throws(
    () => connector.open({ requestId: 'request-1', stream: true }),
    /duplicate-request-id/u,
  );
  session.beginAttempt();
  session.complete();
  assert.equal(connector.advertisement().activeRequestCount, 0);
  assert.throws(() => session.complete(), /terminal-already-settled|request-not-running/u);
});

test('DeepSeekWebConnectorPort correlates cancellation and prevents queued provider dispatch', () => {
  const connector = new CanonicalDeepSeekWebConnectorService();
  const first = connector.open({ requestId: 'request-first', stream: true });
  const second = connector.open({ requestId: 'request-second', stream: true });

  assert.equal(connector.cancel().decision, 'ambiguous');
  assert.deepEqual(connector.cancel('missing'), {
    decision: 'not-found',
    requestId: 'missing',
    shouldInterruptProvider: false,
  });
  assert.equal(connector.cancel('request-second').shouldInterruptProvider, false);
  assert.throws(() => second.beginAttempt(), DeepSeekWebConnectorCancelledError);
  const cancelled = second.settleCancelled();
  assert.equal(cancelled.requestId, 'request-second');
  assert.equal(cancelled.event, 'cancelled');

  first.beginAttempt();
  assert.equal(connector.cancel('request-first').shouldInterruptProvider, true);
  assert.equal(first.fail('Cancelled', 'cancelled').event, 'cancelled');
  assert.equal(connector.activeRequests().length, 0);
});

test('DeepSeekWebConnectorPort retries only before partial output and within one bounded slot', () => {
  const connector = new CanonicalDeepSeekWebConnectorService();
  const retrying = connector.open({ requestId: 'request-retry', stream: true });
  assert.equal(retrying.beginAttempt(), 1);
  const retry = retrying.decideRetry('provider-error');
  assert.equal(retry.decision, 'retry');
  assert.equal(retry.frame.event, 'retry');
  assert.equal(retrying.beginAttempt(), 2);
  assert.deepEqual(retrying.decideRetry('provider-error'), {
    decision: 'stop',
    reason: 'budget-exhausted',
  });
  retrying.fail('provider failed', 'provider-error');

  const partial = connector.open({ requestId: 'request-partial', stream: true });
  partial.beginAttempt();
  const delta = partial.acceptProviderDelta('raw', 'visible');
  assert.equal(delta.sequence, 1);
  assert.deepEqual(partial.decideRetry('provider-error'), {
    decision: 'stop',
    reason: 'partial-output',
  });
  const failed = partial.fail('provider failed', 'provider-error');
  assert.equal(failed.sequence, 2);
});

test('T11 browser request is never replayed after the provider confirms submission', async () => {
  const execution = new CanonicalDeepSeekWebConnectorExecutionService({
    exclusive: { execute: operation => operation() },
    classifyError: () => 'provider-error',
    sleep: async () => {},
  });
  const connector = new CanonicalDeepSeekWebConnectorService();
  const session = connector.open({ requestId: 'submitted-timeout', stream: true });
  const attempts = [];

  await assert.rejects(
    execution.execute(session, async attempt => {
      attempts.push(attempt);
      session.confirmProviderSubmission();
      throw new Error('response timed out after browser submission');
    }),
    /response timed out/u,
  );

  assert.deepEqual(attempts, [1]);
  assert.equal(session.snapshot().providerSubmissionAttempt, 1);
  assert.deepEqual(session.decideRetry('provider-error'), {
    decision: 'stop',
    reason: 'submission-confirmed',
  });
  session.fail('response timed out after browser submission', 'provider-error');
});

test('DeepSeekWebConnectorPort settles cancellation from queued and retry-wait without provider dispatch', () => {
  const connector = new CanonicalDeepSeekWebConnectorService();
  const queued = connector.open({ requestId: 'queued-cancel', stream: true });
  assert.equal(connector.cancel('queued-cancel').shouldInterruptProvider, false);
  assert.equal(queued.settleCancelled().event, 'cancelled');
  assert.deepEqual(connector.activeRequests(), []);

  const retryWait = connector.open({ requestId: 'retry-cancel', stream: true });
  retryWait.beginAttempt();
  assert.equal(retryWait.decideRetry('provider-error').decision, 'retry');
  assert.equal(connector.cancel('retry-cancel').shouldInterruptProvider, false);
  assert.throws(() => retryWait.beginAttempt(), /Cancelled/);
  assert.equal(retryWait.settleCancelled().event, 'cancelled');
  assert.deepEqual(connector.activeRequests(), []);
});

test('I21-CNT-01 user journey: connector retries remain inside one exclusive browser slot', async () => {
  let tail = Promise.resolve();
  const exclusive = {
    execute(operation) {
      const result = tail.then(operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const execution = new CanonicalDeepSeekWebConnectorExecutionService({
    exclusive,
    classifyError: () => 'provider-error',
    sleep: async () => {},
  });
  const connector = new CanonicalDeepSeekWebConnectorService();
  const first = connector.open({ requestId: 'exclusive-first', stream: true });
  const second = connector.open({ requestId: 'exclusive-second', stream: true });
  const order = [];

  const firstResult = execution.execute(first, async attempt => {
    order.push(`first-${attempt}`);
    if (attempt === 1) throw new Error('retryable');
    return 'first-complete';
  });
  const secondResult = execution.execute(second, async attempt => {
    order.push(`second-${attempt}`);
    return 'second-complete';
  });

  assert.deepEqual(await Promise.all([firstResult, secondResult]), [
    'first-complete',
    'second-complete',
  ]);
  assert.deepEqual(order, ['first-1', 'first-2', 'second-1']);
  first.complete();
  second.complete();
});

test('T9 connector reports attempts and retry wait independently of stream frames', async () => {
  const execution = new CanonicalDeepSeekWebConnectorExecutionService({
    exclusive: { execute: operation => operation() },
    classifyError: () => 'provider-error',
    sleep: async () => {},
  });
  const connector = new CanonicalDeepSeekWebConnectorService();
  const session = connector.open({ requestId: 'observed-nonstream-retry', stream: false });
  const observations = [];

  const result = await execution.execute(session, async attempt => {
    observations.push(`operation:${attempt}`);
    if (attempt === 1) throw new Error('retryable');
    return 'complete';
  }, {
    onAttemptStarted: attempt => observations.push(`attempt:${attempt}`),
    onRetryScheduled: decision => observations.push(`retry:${decision.retryAfterMs}`),
    onRetryFrame: () => observations.push('unexpected-frame'),
  });

  assert.equal(result, 'complete');
  assert.deepEqual(observations, [
    'attempt:1',
    'operation:1',
    'retry:1000',
    'attempt:2',
    'operation:2',
  ]);
  session.complete();
});

test('T9 connector observer failures never alter bounded retry behavior', async () => {
  const execution = new CanonicalDeepSeekWebConnectorExecutionService({
    exclusive: { execute: operation => operation() },
    classifyError: () => 'provider-error',
    sleep: async () => {},
  });
  const connector = new CanonicalDeepSeekWebConnectorService();
  const session = connector.open({ requestId: 'observer-failure', stream: true });

  const result = await execution.execute(session, async attempt => {
    if (attempt === 1) throw new Error('retryable');
    return 'complete';
  }, {
    onAttemptStarted: () => { throw new Error('diagnostic attempt failed'); },
    onRetryScheduled: () => { throw new Error('diagnostic retry failed'); },
    onRetryFrame: () => { throw new Error('diagnostic frame failed'); },
  });

  assert.equal(result, 'complete');
  assert.equal(session.snapshot().attempt, 2);
  session.complete();
});
