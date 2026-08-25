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
const mediumProgramJourneyPath = path.join(extensionRoot, 'test/harness/controlled-medium-program-journey.mjs');
const realPluginHarnessPath = path.join(extensionRoot, 'test/devseek-real-plugin-deepseek-harness.mjs');
const cppMatrixRunCasePath = path.resolve(extensionRoot, '../../code/devseek-tests/cpp-user-matrix/run-case.mjs');

function evaluateHarnessFunctions(source, startMarker, endMarker, names, globals = {}) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
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
  'cancel-plan-source-change',
  'cancel-review-instead',
  'agent-fit-ambiguous-clarify',
  'agent-fit-review-only',
  'agent-fit-multifile-with-test',
  'agent-fit-markdown-report-anchors',
  'agent-fit-openai-tool-calls-wrapper',
  't3-deepseek-malformed-openai-tool-calls',
  't3-deepseek-markdown-json-tool-list',
  't4-bounded-workspace-create',
  't4-source-readonly-report-artifact',
  't4-outside-workspace-write-denied',
  't4-dangerous-shell-denied',
  't5-capture-project-memory',
  't5-restart-use-project-memory',
  't5-medium-program-core',
  't5-medium-program-isolated-session',
  't5-medium-program-return-primary',
  't5-medium-program-restart-primary',
  'diverse-novice-typo-create',
  'diverse-asr-readonly-review',
  'diverse-mixed-language-plan',
  'diverse-contradictory-clarify',
  'diverse-typo-existing-fix',
  'diverse-no-run-artifact',
  'diverse-verify-only',
  'diverse-symptom-repair',
  'diverse-effect-denied',
  'diverse-unsafe-colloquial',
  't1-direct-cn-screenshot-explain',
  't1-direct-cn-concept',
  't1-direct-cn-typo-colloquial',
  't1-direct-en-concept',
  't1-direct-ja-concept',
  't1-followup-cn-anchor',
  't1-followup-cn-detail',
  't1-seed-uav-project-memory',
  't1-new-session-gpu-answer',
  't2-cpp-failed-write-recovered',
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
  { id: 'cancellation-replacement-product', scenarioCount: 2, sameDevSeekSession: true },
  { id: 'agent-fit-product', scenarioCount: 5, sameDevSeekSession: false },
  { id: 't3-deepseek-web-compat', scenarioCount: 2, sameDevSeekSession: false },
  { id: 't4-permission-write-boundary', scenarioCount: 4, sameDevSeekSession: false },
  { id: 't5-memory-restart', scenarioCount: 2, sameDevSeekSession: true },
  { id: 't5-medium-program-session-restart', scenarioCount: 4, sameDevSeekSession: false },
  { id: 'independent-user-diversity-product', scenarioCount: 10, sameDevSeekSession: false },
  { id: 't1-direct-answer-product', scenarioCount: 5, sameDevSeekSession: false },
  { id: 't1-direct-followup-product', scenarioCount: 2, sameDevSeekSession: true },
  { id: 't1-new-session-memory-isolation-product', scenarioCount: 2, sameDevSeekSession: false },
  { id: 't2-terminal-settlement-recovery-product', scenarioCount: 1, sameDevSeekSession: false },
  { id: 'coding-conformance-product', scenarioCount: 10, sameDevSeekSession: false },
  { id: 'r2-07e-stream-protocol', scenarioCount: 2, sameDevSeekSession: false },
  { id: 'r2-07f-connector-security', scenarioCount: 1, sameDevSeekSession: false },
];

test('controlled VSIX harness selects product run terminal instead of pending-edit resolution noise', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /function isProductRunTerminalEvent\(/, 'controlled VSIX harness must classify product run terminal events');
  assert.match(source, /mutationKind\s*!==\s*'pending-edit-resolution'/, 'pending-edit resolution runs must not replace the case terminal run');
  assert.doesNotMatch(source, /productTerminalLogs\.at\(-1\) \|\| terminalLogs/, 'background terminal runs must never be a product fallback');
  assert.doesNotMatch(source, /terminalLogs\.at\(-1\)/, 'terminal selection must not blindly use the last terminal log');
});

test('controlled VSIX response evidence excludes request bodies and background maintenance', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /function summarizeRunLogEvent\(/);
  assert.match(source, /const \{ content: _content, \.\.\.metadata \} = data/);
  assert.match(source, /function isProductEvidenceLog\(/);
  assert.match(source, /if \(log\.backgroundMaintenance\) return false/);
  assert.match(source, /\.filter\(isProductEvidenceLog\)/);
});

test('controlled VSIX harness enforces exact provider request contracts for T10 risk classes', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /existing-js-fix[\s\S]*?expectedProviderRequestKinds:\s*\['agent-execution', 'independent-review'\]/);
  assert.match(source, /agent-fit-multifile-with-test[\s\S]*?expectedProviderRequestKinds:\s*\['agent-execution'\]/);
  assert.match(source, /t2-cpp-failed-write-recovered[\s\S]*?expectedProviderRequestKinds:\s*\['agent-execution', 'agent-execution'\]/);
  assert.match(source, /Provider request contract mismatch for \$\{scenario\.id\}/);
});

test('controlled VSIX harness observes provider and terminal payloads as independent bounded channels', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /function collectPayloadChannel\(/);
  assert.match(source, /collectPayloadChannel\(events, 'extension\.response\.raw'\)/);
  assert.match(source, /collectPayloadChannel\(events, 'terminal\.output'\)/);
  assert.doesNotMatch(source, /\.join\('\\n'\)\s*\.slice\(-20000\)/);
});

test('realistic JSON follow-up exposes the exact behavior value before asserting it', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /python tools\/log_summary\.py \| grep -Fx/);
  assert.doesNotMatch(source, /python tools\/log_summary\.py \| grep -q '\{\\"ERROR\\": 1/);
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

test('controlled VSIX run-log evidence distinguishes verification-only work from applied changes', () => {
  const source = readFileSync(harnessPath, 'utf8');
  const { inspectControlledRunLogEvidence } = evaluateHarnessFunctions(
    source,
    'function inspectControlledRunLogEvidenceForSelection',
    'function inspectCodingConformanceForSelection',
    ['inspectControlledRunLogEvidence'],
    {
      sortedStrings: values => Array.isArray(values) ? values.map(value => String(value).replace(/\\/g, '/')).sort() : [],
      arraysEqual: (left, right) => left.length === right.length
        && left.every((value, index) => value === right[index]),
    },
  );
  const driverReport = {
    runLogs: {
      logs: [{ terminal: { event: 'agent-run-completed', data: { status: 'completed' } } }],
      terminal: {
        event: 'agent-run-completed',
        data: { status: 'completed', tasksApplied: 0, tasksFailed: 0 },
      },
    },
    artifact: {
      fileExpectations: [{ exists: true, exactContent: true }],
      userChangedPaths: [],
      mutatedUserFiles: [],
      expectedChangedPaths: [],
      expectedMutatedUserFiles: [],
      missingRunLogSubstrings: [],
      forbiddenFileHits: [],
    },
  };
  const verificationOnly = inspectControlledRunLogEvidence(driverReport, {
    id: 'verification-only',
    expected: 'completed-workflow',
    requireAppliedTask: false,
  });
  const appliedChange = inspectControlledRunLogEvidence(driverReport, {
    id: 'applied-change',
    expected: 'completed-workflow',
  });

  assert.equal(verificationOnly.ok, true);
  assert.equal(appliedChange.ok, false);
  assert.ok(appliedChange.errors.includes('Run log did not record an applied task'));
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
  assert.match(source, /!preserveWorkspaceAcrossCases\s*&& !resumeExistingSession/, 'independent suites must refresh seed files while longitudinal journeys preserve them');
  assert.match(source, /writeScenarioSeedFiles\(workspaceDir, activeScenario\)/, 'runScenario must reset the active case before collecting its baseline');
});

test('controlled VSIX T5 suite proves memory across a real process restart', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /restartBetweenCases:\s*true/, 'T5 must request a VS Code process restart between cases');
  assert.match(source, /function runControlledDriverSelection\(/, 'restart orchestration must have one suite-level owner');
  assert.match(source, /resumeExistingSession:\s*index > 0/, 'later processes must resume the persisted DevSeek session');
  assert.match(source, /terminal\?\.source !== 'vscode-extension\.memory-pipeline'/, 'background memory runs must not replace the foreground user-run terminal');
  assert.match(source, /data\.workloadRole !== 'background-maintenance'/, 'background work must remain isolated even when its source label changes');
  assert.match(source, /error_code:\s*'MEMORY_CONTEXT_MISSING'/, 'the Provider must fail when persisted memory is absent from model context');
  assert.match(source, /processRestartCount/, 'the driver report must expose restart evidence');
});

test('controlled VSIX T1-T5 medium journey switches sessions, returns, restarts, and retains the program artifact', () => {
  const harnessSource = readFileSync(harnessPath, 'utf8');
  const journeySource = readFileSync(mediumProgramJourneyPath, 'utf8');
  const source = `${harnessSource}\n${journeySource}`;
  const productHarness = readFileSync(path.join(extensionRoot, 'src/ui/real-plugin-harness.ts'), 'utf8');

  assert.match(source, /t5-medium-program-session-restart/, 'the longitudinal suite must be registered');
  assert.match(harnessSource, /controlledMediumProgramScenarioCatalog/, 'the generic driver must delegate the domain journey catalog');
  assert.match(source, /restartBeforeCases:\s*\[4\]/, 'the editor must restart after returning to the primary session');
  assert.match(source, /sessionDirective:\s*\{ mode: 'resume', alias: 'primary' \}/, 'follow-up turns must explicitly return to the original session');
  assert.match(source, /independentReviewPaths/, 'multi-file review must declare source scope instead of assuming the primary artifact is reviewable source');
  assert.match(journeySource, /independentReviewEvidenceFacts/, 'the domain journey must own its independent-review evidence contract');
  assert.match(harnessSource, /controlledDeclaredReviewEvidence\(scenario\)/, 'the generic bridge must consume declared review evidence through one boundary');
  const declaredEvidenceOwner = evaluateHarnessFunctions(
    harnessSource,
    'function controlledReviewEvidence(',
    'function controlledOpenAiToolCallsResponse(',
    ['controlledReviewEvidence', 'controlledDeclaredReviewEvidence'],
  );
  assert.doesNotMatch(
    String(declaredEvidenceOwner.controlledReviewEvidence),
    /medium-task-board-(?:cli|persistence)-complete/,
    'the generic review evidence owner must not branch on medium-journey case identities',
  );
  assert.match(source, /forbiddenProviderPromptSubstrings/, 'the unrelated session must reject leaked primary-session context');
  assert.match(source, /retainWorkspace:\s*true/, 'the generated medium program must remain under the run evidence tree');
  assert.match(source, /TASK_PERSISTENCE_TESTS_PASSED/, 'the final process must execute persistence verification');
  assert.match(productHarness, /_devseek\.harnessSessionSnapshot/, 'the test port must expose session identity without bypassing product storage');
  assert.match(productHarness, /_devseek\.harnessLoadSession/, 'the test port must load through the product session callback');
});

test('controlled VSIX fake bridge advertises the connector status contract', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /function controlledDeepSeekWebConnectorAdvertisement\(/, 'controlled bridge must have one owner for connector advertisement');
  assert.match(source, /DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION/, 'controlled bridge must reuse the shared connector protocol version');
  assert.match(source, /DEEPSEEK_WEB_CONNECTOR_CAPABILITIES/, 'controlled bridge must reuse the shared connector capability set');
  assert.match(source, /loggedInLikely:\s*true/, 'controlled status must satisfy bridge health negotiation');
  assert.match(source, /connector:\s*controlledDeepSeekWebConnectorAdvertisement\(0\)/, 'controlled status must expose connector advertisement');
});

test('controlled VSIX bridge keeps user scenarios, internal memory inference, and transport separate', () => {
  const source = readFileSync(harnessPath, 'utf8');

  assert.match(source, /bindControlledInternalModelPrompt/, 'internal model prompts must use their own exact contract binder');
  assert.match(source, /internalModelRequests:\s*\[\]/, 'internal model requests must not affect user-turn prompt correlation');
  assert.match(source, /state\.internalModelRequests\.length \+ 1/, 'internal model ordinals must have an independent request stream');
  assert.match(source, /function sendControlledProviderResponse\(/, 'SSE and JSON delivery must have one transport owner');
  assert.match(source, /controlledInternalModelResponse/, 'memory inference must use the dedicated deterministic fixture');
});

test('VS Code window harnesses preserve injected test environment variables', () => {
  const controlledSource = readFileSync(harnessPath, 'utf8');
  const realPluginSource = readFileSync(realPluginHarnessPath, 'utf8');
  const extensionHostSource = readFileSync(path.join(extensionRoot, 'test/devseek-extension-host-harness.mjs'), 'utf8');

  for (const [label, source] of [
    ['controlled VSIX harness', controlledSource],
    ['real plugin harness', realPluginSource],
    ['extension host harness', extensionHostSource],
  ]) {
    const extensionDevelopmentIndex = source.indexOf("'--extensionDevelopmentPath'");
    const preserveEnvIndex = source.indexOf("'--preserve-env'");
    const newWindowIndex = source.indexOf("'--new-window'");
    assert.ok(extensionDevelopmentIndex >= 0, `${label} must launch a VS Code extension host`);
    assert.ok(preserveEnvIndex > extensionDevelopmentIndex, `${label} must preserve the injected test environment`);
    assert.ok(newWindowIndex > preserveEnvIndex, `${label} must preserve env before opening the controlled window`);
    assert.match(source, /const xdgRuntimeDir = path\.join\(tmpRoot, 'xdg-runtime'\)/, `${label} must allocate a writable runtime directory`);
    assert.match(source, /fs\.chmodSync\(xdgRuntimeDir, 0o700\)/, `${label} must protect the runtime socket directory`);
    assert.match(source, /XDG_RUNTIME_DIR:\s*xdgRuntimeDir/, `${label} must keep VS Code sockets out of the sandbox read-only runtime`);
    assert.match(source, /XDG_SESSION_TYPE:\s*'x11'/, `${label} must force the X11 path in sandboxed launches`);
    assert.match(source, /WAYLAND_DISPLAY:\s*''/, `${label} must not point Wayland at the parent runtime directory`);
    assert.match(source, /'--ozone-platform=x11'/, `${label} must launch Electron through X11 in the sandbox`);
    assert.match(source, /'--verbose'/, `${label} must retain VS Code launch diagnostics`);
    assert.match(source, /'--log', 'trace'/, `${label} must retain extension-host trace diagnostics`);
  }

  assert.match(controlledSource, /DEVSEEK_REAL_PLUGIN_DEEPSEEK:\s*'1'/, 'controlled VSIX harness injects the test command switch');
  assert.match(realPluginSource, /DEVSEEK_REAL_PLUGIN_DEEPSEEK:\s*'1'/, 'real plugin harness injects the test command switch');
  assert.match(extensionHostSource, /DEVSEEK_EXTENSION_HOST_HARNESS:\s*'1'/, 'extension-host harness injects its test switch');
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
  assert.match(source, /log\.workloadRole === 'background-maintenance'/, 'real plugin harness must exclude background maintenance logs from product-run scoring');
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
    /reportScope:\s*pollExitReason === 'timeout'[\s\S]*\? 'report-time-snapshot'[\s\S]*'foreground-terminal-and-background-idle-snapshot'[\s\S]*'terminal-or-success-snapshot'/,
    'timeout reports must mark their scope as a report-time snapshot',
  );
  assert.match(
    source,
    /_devseek\.harnessFlushMemoryPipelineWork/,
    'full-idle scope must be grounded in an explicit extension-owned memory flush',
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

test('real plugin natural UI submission requires prompt-bound foreground dispatch evidence', () => {
  const source = readFileSync(realPluginHarnessPath, 'utf8');

  assert.match(source, /waitForNaturalUiForegroundDispatch\(30_000\)/u);
  assert.match(source, /\.map\(parseHarnessJsonLine\)/u);
  assert.match(source, /function parseHarnessJsonLine\(line\)/u);
  assert.match(source, /event\.data\?\.prompt\?\.sha256 === expectedPrompt\.sha256/u);
  assert.match(source, /ok: foregroundDispatch\.observed/u);
  assert.doesNotMatch(source, /route: 'vscode-webview-screen-coordinate-keyboard',[\s\S]{0,120}ok: true/u);
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
  assert.match(source, /fetchJson\([\s\S]*?60_000\)/u, 'relogin request must have a bounded response wait');
  assert.match(source, /await terminateChild\(child, 5_000\)/u, 'failed relogin must reclaim its bridge process');
  assert.match(source, /child\.kill\('SIGKILL'\)/u, 'bridge cleanup must close a child that ignores graceful termination');
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
