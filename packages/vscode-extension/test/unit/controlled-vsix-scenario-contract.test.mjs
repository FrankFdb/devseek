import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '../..');
const harnessPath = path.join(extensionRoot, 'test/devseek-controlled-vsix-harness.mjs');
const realPluginHarnessPath = path.join(extensionRoot, 'test/devseek-real-plugin-deepseek-harness.mjs');

const REQUIRED_SCENARIOS = [
  'normal',
  'exception',
  'boundary',
  'cpp-program',
  'existing-js-fix',
  'latest-requirement',
  'realistic-python-log-tool',
  'realistic-python-log-json-followup',
  'realistic-safety-boundary',
  'stream-truncated-no-mutation',
  'stream-request-mismatch-no-mutation',
  'connector-evidence-redaction-replay',
];

const REQUIRED_SUITES = [
  { id: 'basic-surface', scenarioCount: 3, sameDevSeekSession: false },
  { id: 'journey-core', scenarioCount: 6, sameDevSeekSession: false },
  { id: 'realistic-product', scenarioCount: 4, sameDevSeekSession: true },
  { id: 'r2-07e-stream-protocol', scenarioCount: 2, sameDevSeekSession: false },
  { id: 'r2-07f-connector-security', scenarioCount: 1, sameDevSeekSession: false },
];

test('controlled VSIX harness selects product run terminal instead of pending-edit resolution noise', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /function isProductRunTerminalEvent\(/, 'controlled VSIX harness must classify product run terminal events');
  assert.match(source, /mutationKind\s*!==\s*'pending-edit-resolution'/, 'pending-edit resolution runs must not replace the case terminal run');
  assert.doesNotMatch(source, /terminalLogs\.at\(-1\)/, 'terminal selection must not blindly use the last terminal log');
});

test('real plugin VSIX harness selects product run terminal instead of pending-edit resolution noise', () => {
  const source = readFileSync(realPluginHarnessPath, 'utf8');

  assert.match(source, /function isProductRunTerminalEvent\(/, 'real plugin harness must classify product run terminal events in the driver');
  assert.match(source, /function selectProductRunLogForReplay\(/, 'real plugin harness replay must use the same product-run selection');
  assert.match(source, /mutationKind\s*!==\s*'pending-edit-resolution'/, 'pending-edit resolution runs must not replace the real plugin terminal run');
  assert.doesNotMatch(source, /logs\.find\(\(log\) => log\.terminal\)\?\.absolutePath/, 'replay selection must not blindly use the first terminal log');
});

for (const scenario of REQUIRED_SCENARIOS) {
  test(`controlled VSIX scenario prompt contract is bound: ${scenario}`, () => {
    const result = spawnSync(process.execPath, [
      harnessPath,
      '--case',
      scenario,
      '--prompt-contract-self-test',
    ], {
      cwd: extensionRoot,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true, scenario);
    assert.equal(report.contractVersion, 'devseek.controlled-prompt-binding/v1', scenario);
    assert.equal(report.errors.length, 0, scenario);
  });
}

for (const suite of REQUIRED_SUITES) {
  test(`controlled VSIX suite prompt contract is bound: ${suite.id}`, () => {
    const result = spawnSync(process.execPath, [
      harnessPath,
      '--suite',
      suite.id,
      '--prompt-contract-self-test',
    ], {
      cwd: extensionRoot,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true, suite.id);
    assert.equal(report.contractVersion, 'devseek.controlled-prompt-binding/v1', suite.id);
    assert.equal(report.scenarioCount, suite.scenarioCount, suite.id);
    assert.equal(report.sameDevSeekSession, suite.sameDevSeekSession, suite.id);
    assert.equal(report.errors.length, 0, suite.id);
  });
}

console.log('\nControlled VSIX scenario contract tests passed.\n');
