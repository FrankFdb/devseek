import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ProviderEfficiencyProfiler,
  measureProviderMessagePrompt,
  measureProviderTextPrompt,
  providerEfficiencyEvidence,
  truncateUtf8ToByteLength,
  utf8ByteLength,
} from '../dist/index.js';

test('prompt budgets measure UTF-8 bytes and preserve role ownership', () => {
  const snapshot = measureProviderMessagePrompt([
    { role: 'system', content: 'rules' },
    { role: 'user', content: '说明 GPU 与 CPU' },
    { role: 'assistant', content: 'ok' },
  ], 48);

  assert.equal(snapshot.roleBytes.system, 5);
  assert.equal(snapshot.roleBytes.user, utf8ByteLength('说明 GPU 与 CPU'));
  assert.equal(snapshot.roleBytes.assistant, 2);
  assert.equal(snapshot.contentBytes, 5 + utf8ByteLength('说明 GPU 与 CPU') + 2);
  assert.ok(snapshot.totalBytes > snapshot.contentBytes);
  assert.equal(snapshot.status, 'exceeded');

  const english = measureProviderTextPrompt('a'.repeat(24), 48);
  const chinese = measureProviderTextPrompt('汉'.repeat(24), 48);
  assert.equal(english.totalBytes, 24);
  assert.equal(chinese.totalBytes, 72);
  assert.equal(english.status, 'within');
  assert.equal(chinese.status, 'exceeded');
});

test('UTF-8 truncation never splits surrogate pairs or multibyte text', () => {
  assert.equal(truncateUtf8ToByteLength('A汉🙂B', 1), 'A');
  assert.equal(truncateUtf8ToByteLength('A汉🙂B', 4), 'A汉');
  assert.equal(truncateUtf8ToByteLength('A汉🙂B', 8), 'A汉🙂');
  assert.equal(utf8ByteLength(truncateUtf8ToByteLength('A汉🙂B', 7)) <= 7, true);
});

test('provider profiler classifies every phase and joins retries under one sampling id', () => {
  const ticks = [0, 10, 30, 80, 100, 120, 150, 170, 200];
  const profiler = new ProviderEfficiencyProfiler({
    layer: 'bridge-server',
    samplingId: 'sampling-1',
    operationId: 'operation-1',
    transportAttempt: 2,
  }, {
    promptBudget: measureProviderTextPrompt('hello'),
    now: () => ticks.shift(),
  });

  profiler.transition('initialization');
  profiler.transition('prompt-preparation');
  profiler.markAttemptStarted(1);
  profiler.transition('sampling');
  profiler.observeOutput('首');
  profiler.markRetryScheduled();
  profiler.markAttemptStarted(2);
  profiler.transition('prompt-preparation');
  profiler.transition('settlement');
  const profile = profiler.finish('completed', '最终');

  assert.equal(profile.samplingId, 'sampling-1');
  assert.equal(profile.transportAttempt, 2);
  assert.equal(profile.attemptCount, 2);
  assert.equal(profile.retryCount, 1);
  assert.equal(profile.timeToFirstOutputMs, 100);
  assert.equal(profile.streamBytesObserved, utf8ByteLength('首'));
  assert.equal(profile.outputBytes, utf8ByteLength('最终'));
  assert.deepEqual(profile.phasesMs, {
    admission: 10,
    initialization: 20,
    'prompt-preparation': 70,
    sampling: 40,
    'retry-wait': 30,
    settlement: 30,
  });
  assert.equal(profile.totalMs, 200);

  const evidence = providerEfficiencyEvidence(profile);
  assert.equal(evidence.sampling_id, 'sampling-1');
  assert.equal(evidence.phases_ms.prompt_preparation, 70);
  assert.equal(evidence.prompt_budget.total_bytes, 5);
  assert.equal(profiler.finish('failed'), profile, 'terminal profile is idempotent');
});

test('provider profiler rejects regressing clocks and attempt numbers', () => {
  const times = [10, 20, 19];
  const profiler = new ProviderEfficiencyProfiler({
    layer: 'vscode-provider-client',
    samplingId: 'sampling-2',
    operationId: 'operation-2',
    transportAttempt: 1,
  }, {
    promptBudget: measureProviderTextPrompt('hello'),
    now: () => times.shift(),
  });
  profiler.markAttemptStarted(2);
  assert.throws(() => profiler.markAttemptStarted(1), /attempt-regressed/);
  profiler.transition('sampling');
  assert.throws(() => profiler.transition('settlement'), /clock-regressed/);
});
