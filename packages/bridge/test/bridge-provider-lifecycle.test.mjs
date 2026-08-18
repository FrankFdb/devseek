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
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-lifecycle-'));
const bundlePath = path.join(bundleRoot, 'bridge-provider-lifecycle.cjs');

buildSync({
  entryPoints: [path.join(bridgeRoot, 'src/bridge-provider-lifecycle.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { BridgeProviderLifecycle } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createTrace() {
  const entries = [];
  return {
    entries,
    info(component, event, payload) { entries.push({ level: 'info', component, event, payload }); },
    error(component, event, payload) { entries.push({ level: 'error', component, event, payload }); },
  };
}

test('T9 bridge lifecycle joins retries, effective prompt bytes, TTFO, and one terminal', () => {
  const events = [];
  const trace = createTrace();
  const ticks = [0, 10, 30, 40, 60, 70, 100, 130, 150, 160, 190, 200];
  const lifecycle = BridgeProviderLifecycle.start({
    operationId: 'operation-2',
    samplingId: 'sampling-shared',
    transportAttempt: 2,
    prompt: '说明 GPU',
    stream: true,
    mode: 'fast',
    fileCount: 1,
    evidence: { record: (type, payload) => events.push({ type, payload }) },
    trace,
    now: () => ticks.shift(),
  });

  lifecycle.beginInitialization();
  lifecycle.beginAdmission();
  lifecycle.beginAttempt(1);
  lifecycle.promptPrepared('说明 GPU\n\n附件内容');
  lifecycle.submitConfirmed();
  lifecycle.observeProviderOutput('首');
  lifecycle.retryScheduled();
  lifecycle.beginAttempt(2);
  lifecycle.promptPrepared('说明 GPU\n\n附件内容');
  lifecycle.submitConfirmed();
  lifecycle.observeProviderOutput('终');
  const profile = lifecycle.complete('最终回答');

  assert.equal(profile.samplingId, 'sampling-shared');
  assert.equal(profile.operationId, 'operation-2');
  assert.equal(profile.transportAttempt, 2);
  assert.equal(profile.attemptCount, 2);
  assert.equal(profile.retryCount, 1);
  assert.equal(profile.timeToFirstOutputMs, 70);
  assert.equal(profile.promptBudget.totalBytes, Buffer.byteLength('说明 GPU\n\n附件内容'));
  assert.deepEqual(profile.phasesMs, {
    admission: 20,
    initialization: 20,
    'prompt-preparation': 40,
    sampling: 80,
    'retry-wait': 30,
    settlement: 10,
  });
  assert.deepEqual(events.map(event => event.type), ['provider.requested', 'provider.completed']);
  assert.equal(events[1].payload.efficiency.sampling_id, 'sampling-shared');
  assert.equal(events[1].payload.efficiency.prompt_budget.total_bytes, Buffer.byteLength('说明 GPU\n\n附件内容'));
  assert.equal(lifecycle.complete('duplicate'), undefined);
  assert.equal(events.length, 2);
  assert.equal(trace.entries.some(entry => entry.level === 'error'), false);
});

test('T9 bridge lifecycle closes cancellation after initialization exactly once', () => {
  const events = [];
  const lifecycle = BridgeProviderLifecycle.start({
    operationId: 'cancel-after-init',
    prompt: '停止',
    stream: false,
    fileCount: 0,
    evidence: { record: (type, payload) => events.push({ type, payload }) },
    trace: createTrace(),
    now: (() => {
      const ticks = [0, 5, 15, 25];
      return () => ticks.shift();
    })(),
  });

  lifecycle.beginInitialization();
  const profile = lifecycle.fail({
    message: 'Cancelled by client',
    category: 'cancelled',
    phase: 'initialization',
  });
  lifecycle.fail({ message: 'duplicate', category: 'provider-error', phase: 'generation' });

  assert.equal(profile.outcome, 'cancelled');
  assert.deepEqual(events.map(event => event.type), ['provider.requested', 'provider.failed']);
  assert.equal(events[1].payload.category, 'cancelled');
  assert.equal(events[1].payload.efficiency.outcome, 'cancelled');
});

test('T9 lifecycle diagnostics fail closed without changing provider completion', () => {
  const trace = createTrace();
  const events = [];
  const lifecycle = BridgeProviderLifecycle.start({
    operationId: 'diagnostic-clock-failure',
    samplingId: 'bad\nidentity',
    transportAttempt: 99,
    prompt: 'hello',
    stream: false,
    fileCount: 0,
    evidence: { record: (type, payload) => events.push({ type, payload }) },
    trace,
    now: (() => {
      const ticks = [10, 5];
      return () => ticks.shift();
    })(),
  });

  lifecycle.beginInitialization();
  assert.doesNotThrow(() => lifecycle.complete('answer'));
  assert.equal(lifecycle.samplingId, 'diagnostic-clock-failure');
  assert.equal(lifecycle.transportAttempt, 1);
  assert.deepEqual(events.map(event => event.type), ['provider.requested', 'provider.completed']);
  assert.equal(trace.entries.some(entry => entry.event === 'bridge-observation-failed'), true);
});
