import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '../..');
const harnessPath = path.join(extensionRoot, 'test/devseek-controlled-vsix-harness.mjs');
const realPluginHarnessPath = path.join(extensionRoot, 'test/devseek-real-plugin-deepseek-harness.mjs');

function evaluateHarnessFunctions(source, startMarker, endMarker, names) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  const context = {};
  vm.runInNewContext(`${source.slice(start, end)}\nresult = { ${names.join(', ')} };`, context);
  return context.result;
}

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
  const selectHelperMatches = source.match(/function selectProductRunLog\(logs\)/g) || [];
  const helperIndex = source.indexOf('function selectProductRunLog(logs)');
  const driverWriterIndex = source.indexOf('function writeDriverExtension()');

  assert.match(source, /function isProductRunTerminalEvent\(/, 'real plugin harness must classify product run terminal events in the driver');
  assert.equal(selectHelperMatches.length, 1, 'real plugin harness must keep one source owner for product-run selection');
  assert.ok(helperIndex >= 0 && helperIndex < driverWriterIndex, 'product-run selection helper must be callable by outer replay reporting');
  assert.match(source, /\$\{productRunLogSelectionSource\(\)\}/, 'real plugin driver must inject the shared product-run selection helper');
  assert.match(source, /const selected = selectProductRunLog\(logs\)\?\.absolutePath/, 'real plugin harness replay must reuse the product-run selection helper');
  assert.doesNotMatch(source, /selectProductRunLogForReplay/, 'real plugin harness must not fork replay-only terminal selection');
  assert.match(source, /function productRunLogScore\(log\)/, 'real plugin harness must score product-like logs before replay fallback');
  assert.match(source, /mutationKind\s*!==\s*'pending-edit-resolution'/, 'pending-edit resolution runs must not replace the real plugin terminal run');
  assert.doesNotMatch(source, /logs\.find\(\(log\) => log\.terminal\)\?\.absolutePath/, 'replay selection must not blindly use the first terminal log');
});

test('real plugin VSIX harness chooses the agent run log over bridge status probes', () => {
  const source = readFileSync(realPluginHarnessPath, 'utf8');
  const { selectProductRunLog } = evaluateHarnessFunctions(
    source,
    'function isProductRunTerminalEvent',
    'function productRunLogSelectionSource',
    ['isProductRunTerminalEvent', 'productRunLogScore', 'selectProductRunLog'],
  );

  const selected = selectProductRunLog([
    {
      path: '.devseek/runs/20260723-134636.log',
      absolutePath: '/workspace/.devseek/runs/20260723-134636.log',
      runStartedAtMs: new Date(2026, 6, 23, 13, 46, 36).getTime(),
      mtimeMs: new Date(2026, 6, 23, 13, 46, 36).getTime(),
      size: 1522,
      events: 5,
      lastEvent: 'bridge-status-ready',
      terminal: null,
      hasAgentRunStarted: false,
      hasAgentStatus: false,
      providerEventCount: 0,
      toolExecutionCount: 0,
    },
    {
      path: '.devseek/runs/20260723-054636511-0b4ed653468767da.log',
      absolutePath: '/workspace/.devseek/runs/20260723-054636511-0b4ed653468767da.log',
      runStartedAtMs: Date.UTC(2026, 6, 23, 5, 46, 36, 511),
      mtimeMs: new Date(2026, 6, 23, 13, 50, 35).getTime(),
      size: 328257,
      events: 357,
      lastEvent: 'execute-complete',
      terminal: null,
      hasAgentRunStarted: true,
      hasAgentStatus: true,
      providerEventCount: 58,
      toolExecutionCount: 18,
    },
  ]);

  assert.equal(selected?.path, '.devseek/runs/20260723-054636511-0b4ed653468767da.log');
});

test('real plugin VSIX harness parses product and bridge run-log timestamps', () => {
  const source = readFileSync(realPluginHarnessPath, 'utf8');
  const { parseRunLogStartedAtMs } = evaluateHarnessFunctions(
    source,
    'function parseRunLogStartedAtMs',
    '${productRunLogSelectionSource()}',
    ['parseRunLogStartedAtMs'],
  );

  assert.equal(
    parseRunLogStartedAtMs('20260723-054636511-0b4ed653468767da.log'),
    Date.UTC(2026, 6, 23, 5, 46, 36, 511),
  );
  assert.equal(
    parseRunLogStartedAtMs('20260723-134636.log'),
    new Date(2026, 6, 23, 13, 46, 36).getTime(),
  );
});

test('real plugin VSIX harness keeps visible DeepSeek pages for user inspection', () => {
  const source = readFileSync(realPluginHarnessPath, 'utf8');

  assert.match(source, /const keepDeepSeekPage =/, 'real plugin harness must expose a keep-visible DeepSeek page guard');
  assert.match(source, /\|\| \(headed && keepWindow\)/, 'headed keep-window runs must preserve the DeepSeek page by default');
  assert.match(source, /const cleanup = !keepTmp && !keepWindow && !keepDeepSeekPage && report\.ok/, 'kept visible windows must retain the temporary inspection workspace');
  assert.match(source, /detached: keepDeepSeekPage/, 'relogin bridge/browser must remain detached when kept for inspection');
  assert.match(source, /DEVSEEK_BRIDGE_KEEP_VISIBLE: keepDeepSeekPage \? '1' : ''/, 'DeepSeek bridge must receive the visible-page retention flag');
  assert.match(source, /keepVisible: keepDeepSeekPage/, 'login report must disclose whether the DeepSeek page was intentionally kept');
  assert.match(source, /if \(keepDeepSeekPage\) \{\s*child\.unref\(\);/s, 'kept relogin browser must not be killed during cleanup');
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
