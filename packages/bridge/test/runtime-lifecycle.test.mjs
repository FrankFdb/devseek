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
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-runtime-lifecycle-'));
const require = createRequire(import.meta.url);

function bundle(name) {
  const outfile = path.join(bundleRoot, `${name}.cjs`);
  buildSync({
    entryPoints: [path.join(bridgeRoot, 'src', `${name}.ts`)],
    bundle: true,
    outfile,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  return require(outfile);
}

const queueModule = bundle('queue');
const agentRuntimeModule = bundle('deepseek-agent-runtime');
const lifecycleModule = bundle('bridge-runtime-lifecycle');
const connectorModule = bundle('deepseek-web-connector');

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('RequestQueue removes cancelled work and rejects all pending work on close', async () => {
  const { RequestQueue, RequestQueueCancelledError, RequestQueueClosedError } = queueModule;
  const queue = new RequestQueue();
  let releaseActive;
  const active = queue.enqueue(() => new Promise(resolve => { releaseActive = resolve; }), { id: 'active' });
  let cancelledRan = false;
  const cancelled = queue.enqueue(async () => { cancelledRan = true; }, { id: 'cancelled' });
  const cancelledAssertion = assert.rejects(cancelled, RequestQueueCancelledError);

  assert.equal(queue.cancel('cancelled'), true);
  assert.equal(queue.cancel('missing'), false);
  await cancelledAssertion;
  assert.equal(cancelledRan, false);

  const pending = queue.enqueue(async () => 'pending', { id: 'pending' });
  const pendingAssertion = assert.rejects(pending, RequestQueueClosedError);
  queue.close();
  await pendingAssertion;
  await assert.rejects(queue.enqueue(async () => 'late'), RequestQueueClosedError);

  releaseActive('done');
  assert.equal(await active, 'done');
  await queue.whenIdle();
  assert.equal(queue.isIdle, true);
});

test('DeepSeekAgentRuntime shares initialization and closes a late initialization result', async () => {
  const { DeepSeekAgentRuntime, DeepSeekAgentRuntimeClosedError } = agentRuntimeModule;
  let releaseInitialization;
  const fake = {
    isReady: false,
    initCalls: 0,
    closeCalls: 0,
    cancelCalls: 0,
    async init() {
      this.initCalls += 1;
      await new Promise(resolve => { releaseInitialization = resolve; });
      this.isReady = true;
    },
    async loginWithVisibleBrowser() {},
    cancel() { this.cancelCalls += 1; },
    async close() { this.closeCalls += 1; this.isReady = false; },
  };
  const runtime = new DeepSeekAgentRuntime(fake, 200);
  const first = runtime.ensureReady();
  const second = runtime.ensureReady();
  assert.equal(fake.initCalls, 1);

  const closing = runtime.close();
  releaseInitialization();
  await closing;
  await assert.rejects(first, DeepSeekAgentRuntimeClosedError);
  await assert.rejects(second, DeepSeekAgentRuntimeClosedError);
  assert.equal(fake.cancelCalls, 1);
  assert.equal(fake.closeCalls >= 2, true);
  assert.equal(runtime.isReady, false);
});

test('DeepSeekAgentRuntime rolls back resources after failed initialization and can recover', async () => {
  const { DeepSeekAgentRuntime } = agentRuntimeModule;
  const failure = new Error('page.goto: Timeout 30000ms exceeded');
  const fake = {
    isReady: false,
    initCalls: 0,
    closeCalls: 0,
    async init() {
      this.initCalls += 1;
      if (this.initCalls === 1) throw failure;
      this.isReady = true;
    },
    async loginWithVisibleBrowser() {},
    cancel() {},
    async close() { this.closeCalls += 1; this.isReady = false; },
  };
  const runtime = new DeepSeekAgentRuntime(fake);

  await assert.rejects(runtime.ensureReady(), error => error === failure);
  assert.equal(fake.closeCalls, 1);
  assert.equal(runtime.isReady, false);

  await runtime.ensureReady();
  assert.equal(fake.initCalls, 2);
  assert.equal(runtime.isReady, true);
});

test('BridgeRuntimeLifecycle cancels correlated requests, drains once, and closes resources once', async () => {
  const { RequestQueue } = queueModule;
  const { CanonicalDeepSeekWebConnectorService } = connectorModule;
  const { BridgeRuntimeLifecycle } = lifecycleModule;
  const queue = new RequestQueue();
  const connector = new CanonicalDeepSeekWebConnectorService();
  const runningSession = connector.open({ requestId: 'running', stream: true });
  connector.open({ requestId: 'queued', stream: true });
  runningSession.beginAttempt();

  let releaseActive;
  const active = queue.enqueue(() => new Promise(resolve => { releaseActive = resolve; }), { id: 'running' });
  const queued = queue.enqueue(async () => 'should-not-run', { id: 'queued' });
  const queuedAssertion = assert.rejects(queued, /shutdown/u);
  let closeServerCalls = 0;
  const agent = {
    cancelCalls: 0,
    closeCalls: 0,
    cancel() { this.cancelCalls += 1; },
    async close() { this.closeCalls += 1; releaseActive('cancelled'); },
  };
  const lifecycle = new BridgeRuntimeLifecycle({
    queue,
    connector,
    agent,
    closeServer: async () => { closeServerCalls += 1; },
    cooperativeGraceMs: 5,
    forcedGraceMs: 100,
  });

  const first = lifecycle.shutdown('sigterm');
  const second = lifecycle.shutdown('http');
  assert.equal(first, second);
  const report = await first;
  await queuedAssertion;
  assert.equal(await active, 'cancelled');
  assert.equal(agent.cancelCalls, 1);
  assert.equal(agent.closeCalls, 1);
  assert.equal(closeServerCalls, 1);
  assert.equal(report.reason, 'sigterm');
  assert.equal(report.forcedDrainCompleted, true);
});

test('parent process watch invokes shutdown once when ownership disappears', async () => {
  const { watchParentProcess } = lifecycleModule;
  let calls = 0;
  const dispose = watchParentProcess({
    parentPid: 424242,
    intervalMs: 10,
    isAlive: () => false,
    onParentExit: () => { calls += 1; },
  });
  await new Promise(resolve => setTimeout(resolve, 140));
  dispose();
  assert.equal(calls, 1);
});
