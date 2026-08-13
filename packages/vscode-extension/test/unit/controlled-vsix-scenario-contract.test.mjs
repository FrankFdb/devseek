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
const cppMatrixRunCasePath = path.resolve(extensionRoot, '../../code/devseek-tests/cpp-user-matrix/run-case.mjs');

function evaluateHarnessFunctions(source, startMarker, endMarker, names, globals = {}) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  const context = { ...globals };
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
  'prior-plan-source-change',
  'prior-plan-go-ahead',
  'scope-replace-alpha-plan',
  'scope-replace-beta-instead',
  'agent-fit-ambiguous-clarify',
  'agent-fit-review-only',
  'agent-fit-multifile-with-test',
  'agent-fit-markdown-report-anchors',
  'agent-fit-openai-tool-calls-wrapper',
  'conformance-create-and-verify',
  'conformance-modify-and-verify',
  'conformance-verify-repair-reverify',
  'conformance-ci-green-repair',
  'conformance-cn-tests-pass-repair',
  'conformance-project-health-repair',
  'conformance-runtime-error-repair',
  'conformance-user-symptom-repair',
  'conformance-permission-denied-no-effect',
  'conformance-policy-refusal-no-mutation',
  'stream-truncated-no-mutation',
  'stream-request-mismatch-no-mutation',
  'connector-evidence-redaction-replay',
];

const REQUIRED_SUITES = [
  { id: 'basic-surface', scenarioCount: 3, sameDevSeekSession: false },
  { id: 'journey-core', scenarioCount: 6, sameDevSeekSession: false },
  { id: 'realistic-product', scenarioCount: 4, sameDevSeekSession: true },
  { id: 'prior-task-continuation-product', scenarioCount: 2, sameDevSeekSession: true },
  { id: 'scope-replacement-product', scenarioCount: 2, sameDevSeekSession: true },
  { id: 'agent-fit-product', scenarioCount: 5, sameDevSeekSession: false },
  { id: 'coding-conformance-product', scenarioCount: 10, sameDevSeekSession: false },
  { id: 'r2-07e-stream-protocol', scenarioCount: 2, sameDevSeekSession: false },
  { id: 'r2-07f-connector-security', scenarioCount: 1, sameDevSeekSession: false },
];

test('controlled VSIX harness selects product run terminal instead of pending-edit resolution noise', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /function isProductRunTerminalEvent\(/, 'controlled VSIX harness must classify product run terminal events');
  assert.match(source, /mutationKind\s*!==\s*'pending-edit-resolution'/, 'pending-edit resolution runs must not replace the case terminal run');
  assert.doesNotMatch(source, /terminalLogs\.at\(-1\)/, 'terminal selection must not blindly use the last terminal log');
});

test('controlled VSIX harness fails completed mismatches without waiting for timeout', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(
    source,
    /evaluation\.runLogs\.terminal\?\.event === 'agent-run-completed'/,
    'completed-but-mismatched controlled cases must stop immediately for focused diagnosis',
  );
  assert.match(
    source,
    /\['completed', 'failed', 'blocked'\]\.includes/,
    'terminal completed/failed/blocked statuses must all end the case polling loop',
  );
});

test('controlled VSIX harness accepts packaged dirty-runtime source fingerprints', () => {
  const source = readFileSync(harnessPath, 'utf8');
  const packageVsix = readFileSync(path.resolve(extensionRoot, '../../scripts/package-vsix.mjs'), 'utf8');

  assert.match(packageVsix, /sourceFingerprint:\s*computeVsixDirtyRuntimeFingerprint/, 'VSIX package identity must include dirty runtime source fingerprint');
  assert.match(source, /computeVsixDirtyRuntimeFingerprint/, 'controlled harness must recompute the local runtime fingerprint');
  assert.match(source, /sameVsixSourceFingerprint/, 'controlled harness must compare the packaged fingerprint before accepting dirty runtime paths');
  assert.match(source, /exact-head-with-packaged-worktree/, 'controlled harness must report the pre-commit packaged-worktree mode');
});

test('controlled VSIX harness resets independent scenario seed files before each case', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /function writeScenarioSeedFiles\(workspaceDir, scenario\)/, 'scenario seed reset must have one explicit helper');
  assert.match(source, /if \(!sameDevSeekSession \|\| caseIndex === 1\)/, 'independent suites must refresh seed files per case');
  assert.match(source, /writeScenarioSeedFiles\(workspaceDir, activeScenario\)/, 'runScenario must reset the active case before collecting its baseline');
});

test('controlled VSIX fake bridge advertises the connector status contract', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /function controlledDeepSeekWebConnectorAdvertisement\(/, 'controlled bridge must have one owner for connector advertisement');
  assert.match(source, /DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION/, 'controlled bridge must reuse the shared connector protocol version');
  assert.match(source, /DEEPSEEK_WEB_CONNECTOR_CAPABILITIES/, 'controlled bridge must reuse the shared connector capability set');
  assert.match(source, /loggedInLikely:\s*true/, 'controlled status must satisfy bridge health negotiation');
  assert.match(source, /connector:\s*controlledDeepSeekWebConnectorAdvertisement\(0\)/, 'controlled status must expose connector advertisement');
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
  assert.match(source, /function isAuxiliaryMutationTerminalEvent/, 'real plugin harness must classify auxiliary mutation run terminals');
  assert.match(source, /mutationKind === 'pending-edit-resolution'/, 'pending-edit resolution runs must not replace the real plugin terminal run');
  assert.match(source, /mutationKind === 'pending-edit-undo'/, 'pending-edit undo runs must not replace the real plugin terminal run');
  assert.doesNotMatch(source, /logs\.find\(\(log\) => log\.terminal\)\?\.absolutePath/, 'replay selection must not blindly use the first terminal log');
});

test('real plugin VSIX harness reports generated artifact quality details', () => {
  const source = readFileSync(realPluginHarnessPath, 'utf8');

  assert.match(source, /function changedMarkdownArtifacts\(before\)/, 'real plugin harness must inspect generated Markdown artifacts');
  assert.match(source, /requiredContentMatches/, 'report artifacts must expose required snippet matches');
  assert.match(source, /forbiddenContentMatches/, 'report artifacts must expose stale-domain forbidden snippet matches');
  assert.match(source, /reportLanguageQuality/, 'report artifacts must expose language quality checks');
  assert.match(source, /selectedCodeArtifactRecords/, 'explicit code artifacts must use the shared code quality owner');
  assert.match(source, /expectedCodeQuality/, 'file and directory code evidence must converge before quality settlement');
  assert.doesNotMatch(source, /missing-formal-project-anchor/, 'generic code quality must not require one historical product domain');
  assert.doesNotMatch(source, /missing-code-validation-hook/, 'verification evidence must not be inferred from names inside changed production code');
  assert.match(source, /stageArtifactQuality/, 'report checks must include generated artifact stage quality');
  assert.match(source, /阶段成果物质量不达标/, 'failed generated artifact quality must be surfaced in report errors');
});

test('real plugin VSIX harness accepts domain-neutral production code and rejects placeholders', () => {
  const source = readFileSync(realPluginHarnessPath, 'utf8');
  const { assessCodeArtifactSignals, assessCodeQuality } = evaluateHarnessFunctions(
    source,
    'function assessCodeArtifactSignals',
    'function mergeCodeArtifactRecords',
    ['assessCodeArtifactSignals', 'assessCodeQuality'],
    { path },
  );
  const record = (content) => ({
    path: 'src/job_scheduler.cpp',
    exists: true,
    created: false,
    changed: true,
    size: Buffer.byteLength(content),
    qualitySignals: assessCodeArtifactSignals('src/job_scheduler.cpp', content),
  });

  const implementation = '#include "job_scheduler.hpp"\nnamespace scheduler { void run() {} }\n';
  assert.equal(assessCodeQuality([record(implementation)]).ok, true);
  assert.deepEqual(
    [...assessCodeQuality([record('// TODO: implement scheduler\n')]).reasons],
    ['placeholder-implementation'],
  );
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

test('real plugin VSIX harness keeps in-flight agent repair above pending-edit side runs', () => {
  const source = readFileSync(realPluginHarnessPath, 'utf8');
  const { selectProductRunLog, productRunLogScore } = evaluateHarnessFunctions(
    source,
    'function isProductRunTerminalEvent',
    'function productRunLogSelectionSource',
    ['isProductRunTerminalEvent', 'isAuxiliaryMutationTerminalEvent', 'productRunLogScore', 'selectProductRunLog'],
  );

  const pendingResolution = {
    path: '.devseek/runs/20260812-052721604-fd716ff2b2dd14ee.log',
    absolutePath: '/workspace/.devseek/runs/20260812-052721604-fd716ff2b2dd14ee.log',
    runStartedAtMs: Date.UTC(2026, 7, 12, 5, 27, 21, 604),
    mtimeMs: Date.UTC(2026, 7, 12, 5, 27, 21, 696),
    size: 2094,
    events: 4,
    lastEvent: 'agent-run-completed',
    terminal: {
      event: 'agent-run-completed',
      data: {
        mutationKind: 'pending-edit-resolution',
        status: 'failed',
      },
    },
    hasAgentRunStarted: true,
    hasAgentStatus: false,
    providerEventCount: 0,
    toolExecutionCount: 0,
    committedMutationCount: 0,
  };
  const activeRepair = {
    path: '.devseek/runs/20260812-052449799-bda1bc22da19d8fe.log',
    absolutePath: '/workspace/.devseek/runs/20260812-052449799-bda1bc22da19d8fe.log',
    runStartedAtMs: Date.UTC(2026, 7, 12, 5, 24, 49, 799),
    mtimeMs: Date.UTC(2026, 7, 12, 5, 27, 10, 503),
    size: 360466,
    events: 244,
    lastEvent: 'message-sent',
    terminal: null,
    hasAgentRunStarted: true,
    hasAgentStatus: true,
    providerEventCount: 36,
    toolExecutionCount: 14,
    committedMutationCount: 2,
    inFlightProviderRequests: 2,
  };

  assert.equal(productRunLogScore(pendingResolution), 0);
  assert.ok(productRunLogScore(activeRepair) > productRunLogScore(pendingResolution));
  assert.equal(selectProductRunLog([pendingResolution, activeRepair])?.path, activeRepair.path);
});

test('C++ matrix runner chooses the active agent run over later bridge status probes', () => {
  const source = readFileSync(cppMatrixRunCasePath, 'utf8');
  const { selectAgentRun } = evaluateHarnessFunctions(
    source,
    'function selectAgentRun',
    'function markdownReport',
    ['selectAgentRun', 'agentRunScore', 'uniqueWorkspacePaths', 'sameTerminalOutcome'],
  );

  const selected = selectAgentRun({
    runLogs: {
      logs: [
        {
          path: '.devseek/runs/20260812-105641.log',
          runStartedAtMs: Date.UTC(2026, 7, 12, 10, 56, 41),
          mtimeMs: Date.UTC(2026, 7, 12, 10, 56, 41),
          size: 2539,
          lastEvent: 'bridge-status-ready',
          hasAgentRunStarted: false,
          hasAgentStatus: false,
          providerEventCount: 0,
          toolExecutionCount: 0,
        },
        {
          path: '.devseek/runs/20260812-024403226-0bfac0441f7762ef.log',
          runStartedAtMs: Date.UTC(2026, 7, 12, 2, 44, 3, 226),
          mtimeMs: Date.UTC(2026, 7, 12, 2, 59, 4),
          size: 1031758,
          lastEvent: 'message-sent',
          hasAgentRunStarted: true,
          hasAgentStatus: true,
          providerEventCount: 80,
          toolExecutionCount: 32,
        },
      ],
    },
  });

  assert.equal(selected?.path, '.devseek/runs/20260812-024403226-0bfac0441f7762ef.log');
});

test('C++ matrix runner ignores pending-edit terminal when active run is still repairing', () => {
  const source = readFileSync(cppMatrixRunCasePath, 'utf8');
  const { selectAgentRun, agentRunScore } = evaluateHarnessFunctions(
    source,
    'function selectAgentRun',
    'function markdownReport',
    ['selectAgentRun', 'agentRunScore', 'isAuxiliaryMutationTerminal', 'uniqueWorkspacePaths', 'sameTerminalOutcome'],
  );

  const pendingTerminal = {
    path: '.devseek/runs/20260812-052721604-fd716ff2b2dd14ee.log',
    runStartedAtMs: Date.UTC(2026, 7, 12, 5, 27, 21, 604),
    mtimeMs: Date.UTC(2026, 7, 12, 5, 27, 21, 696),
    size: 2094,
    lastEvent: 'agent-run-completed',
    terminal: {
      event: 'agent-run-completed',
      data: {
        mutationKind: 'pending-edit-resolution',
        status: 'failed',
      },
    },
    hasAgentRunStarted: true,
    hasAgentStatus: false,
    providerEventCount: 0,
    toolExecutionCount: 0,
    committedMutationCount: 0,
  };
  const activeRepair = {
    path: '.devseek/runs/20260812-052449799-bda1bc22da19d8fe.log',
    runStartedAtMs: Date.UTC(2026, 7, 12, 5, 24, 49, 799),
    mtimeMs: Date.UTC(2026, 7, 12, 5, 27, 10, 503),
    size: 360466,
    lastEvent: 'message-sent',
    terminal: null,
    hasAgentRunStarted: true,
    hasAgentStatus: true,
    providerEventCount: 36,
    toolExecutionCount: 14,
    committedMutationCount: 2,
  };

  assert.equal(agentRunScore(pendingTerminal), 0);
  assert.equal(selectAgentRun({
    runLogs: {
      terminal: pendingTerminal.terminal,
      logs: [pendingTerminal, activeRepair],
    },
  })?.path, activeRepair.path);
});

test('real plugin VSIX harness timeout reports are report-time snapshots, not bridge status verdicts', () => {
  const source = readFileSync(realPluginHarnessPath, 'utf8');

  assert.match(
    source,
    /const finalEvaluation = evaluate\(before,\s*startedAtMs,\s*expectedCodeBefore,\s*expectedCodeDirBefore\);\s*Object\.assign\(baseReport,\s*finalEvaluation\);/,
    'timeout reports must re-evaluate the workspace and run logs at report finalization time',
  );
  assert.match(
    source,
    /reportScope:\s*pollExitReason === 'timeout' \? 'report-time-snapshot' : 'terminal-or-success-snapshot'/,
    'timeout reports must mark their scope as a report-time snapshot',
  );
  assert.match(
    source,
    /报告轮询达到 timeout-ms；此 report\.json 只代表报告写入时刻的快照/,
    'timeout reports must warn that later Provider, run log, changedPaths or generated files require re-checking',
  );
  assert.match(
    source,
    /function collectCommittedMutationPaths\(events\)/,
    'timeout reports must summarize committed workspace mutations from in-flight agent logs',
  );
  assert.match(
    source,
    /event\.event !== 'workspace-mutation-lifecycle'/,
    'committed mutation path collection must be grounded in workspace mutation lifecycle events',
  );
  assert.match(
    source,
    /committedMutationCount:\s*mutationPaths\.length/,
    'run-log summaries must expose observed committed mutation counts',
  );
  assert.doesNotMatch(
    source,
    /pollExitReason === 'timeout'[\s\S]{0,600}(?:bridge-status-ready|bridge status|Bridge status)/i,
    'timeout settlement must not be derived from stale Bridge status probes',
  );
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
  assert.match(source, /const bridgeKeepVisible = keepDeepSeekPage \? '1' : ''/, 'DeepSeek page retention must have one semantic owner');
  assert.equal(
    (source.match(/DEVSEEK_BRIDGE_KEEP_VISIBLE: bridgeKeepVisible/g) || []).length,
    2,
    'login and task bridges must share the explicit page-retention contract',
  );
  assert.doesNotMatch(
    source,
    /DEVSEEK_BRIDGE_KEEP_VISIBLE: headed/,
    'headed execution alone must not retain the browser after the test',
  );
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
