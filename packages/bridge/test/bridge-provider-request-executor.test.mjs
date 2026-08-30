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
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-request-executor-'));
const bundlePath = path.join(bundleRoot, 'bridge-provider-request-executor.cjs');

buildSync({
  entryPoints: [path.join(bridgeRoot, 'src/bridge-provider-request-executor.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const {
  BridgeProviderExecutionError,
  BridgeProviderRequestExecutor,
} = require(bundlePath);
const connectorBundlePath = path.join(bundleRoot, 'deepseek-web-connector.cjs');
buildSync({
  entryPoints: [path.join(bridgeRoot, 'src/deepseek-web-connector.ts')],
  bundle: true,
  outfile: connectorBundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});
const {
  CanonicalDeepSeekWebConnectorExecutionService,
  CanonicalDeepSeekWebConnectorService,
} = require(connectorBundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createHarness(runtime) {
  const events = [];
  const connector = new CanonicalDeepSeekWebConnectorService();
  const connectorExecution = new CanonicalDeepSeekWebConnectorExecutionService({
    exclusive: { execute: operation => operation() },
    classifyError: error => error.message === 'LOGIN_REQUIRED' ? 'login-required' : 'provider-error',
    sleep: async () => {},
  });
  const executor = new BridgeProviderRequestExecutor({ runtime, connectorExecution });
  const lifecycle = {
    beginInitialization: () => events.push('initialization'),
    beginAdmission: () => events.push('admission'),
    beginAttempt: attempt => events.push(`attempt:${attempt}`),
    beginPromptPreparation: () => events.push('prompt-preparation'),
    retryScheduled: () => events.push('retry-wait'),
  };
  return { connector, executor, lifecycle, events };
}

test('provider initialization retries inside one request and dispatches generation only after readiness', async () => {
  const runtime = {
    calls: 0,
    async ensureReady() {
      this.calls += 1;
      if (this.calls === 1) throw new Error('page.goto: Timeout 30000ms exceeded');
    },
  };
  const { connector, executor, lifecycle, events } = createHarness(runtime);
  const session = connector.open({ requestId: 'initialization-retry', stream: false });
  const generationAttempts = [];

  const result = await executor.execute(session, async attempt => {
    generationAttempts.push(attempt);
    return 'ready';
  }, { lifecycle });

  assert.equal(result, 'ready');
  assert.equal(runtime.calls, 2);
  assert.deepEqual(generationAttempts, [2]);
  assert.deepEqual(events, [
    'attempt:1',
    'initialization',
    'retry-wait',
    'attempt:2',
    'initialization',
    'admission',
    'prompt-preparation',
  ]);
  session.complete();
});

test('provider initialization retry does not require diagnostics observers', async () => {
  const runtime = {
    calls: 0,
    async ensureReady() {
      this.calls += 1;
      if (this.calls === 1) throw new Error('transient initialization failure');
    },
  };
  const { connector, executor } = createHarness(runtime);
  const session = connector.open({ requestId: 'initialization-retry-no-lifecycle', stream: false });

  assert.equal(await executor.execute(session, async () => 'ready', {}), 'ready');
  assert.equal(runtime.calls, 2);
  session.complete();
});

test('provider operation is not replayed after submission is confirmed', async () => {
  const { connector, executor } = createHarness({ async ensureReady() {} });
  const session = connector.open({ requestId: 'submitted-operation-failure', stream: false });
  let operationCalls = 0;

  await assert.rejects(executor.execute(session, async () => {
    operationCalls += 1;
    session.confirmProviderSubmission();
    throw new Error('upload failed after submission');
  }, {}), error => error instanceof BridgeProviderExecutionError
    && error.phase === 'generation'
    && error.message === 'upload failed after submission');

  assert.equal(operationCalls, 1);
  session.fail('upload failed after submission', 'provider-error');
});

test('login-required initialization is terminal and keeps its failure phase', async () => {
  const runtime = {
    calls: 0,
    async ensureReady() { this.calls += 1; throw new Error('LOGIN_REQUIRED'); },
  };
  const { connector, executor, lifecycle, events } = createHarness(runtime);
  const session = connector.open({ requestId: 'login-required', stream: false });

  await assert.rejects(
    executor.execute(session, async () => 'must-not-run', { lifecycle }),
    error => error instanceof BridgeProviderExecutionError
      && error.phase === 'initialization'
      && error.message === 'LOGIN_REQUIRED',
  );

  assert.equal(runtime.calls, 1);
  assert.deepEqual(events, ['attempt:1', 'initialization']);
  session.fail('LOGIN_REQUIRED', 'login-required');
});

test('cancellation after readiness prevents provider dispatch and is never retried', async () => {
  let session;
  const runtime = {
    calls: 0,
    async ensureReady() { this.calls += 1; session.requestCancel(); },
  };
  const harness = createHarness(runtime);
  session = harness.connector.open({ requestId: 'cancel-after-ready', stream: true });
  let generationCalls = 0;

  await assert.rejects(
    harness.executor.execute(session, async () => { generationCalls += 1; }, {
      lifecycle: harness.lifecycle,
    }),
    error => error instanceof BridgeProviderExecutionError
      && error.phase === 'initialization'
      && error.message === 'Cancelled',
  );

  assert.equal(runtime.calls, 1);
  assert.equal(generationCalls, 0);
  assert.deepEqual(harness.events, ['attempt:1', 'initialization']);
  session.settleCancelled();
});
