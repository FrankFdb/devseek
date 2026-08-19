import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRealPluginQualityProfile,
  buildRealPluginScenarioSpec,
  listRealPluginIterationScenarioSpecs,
  parseRequiredArtifactSnippets,
  specializeRealPluginQualityProfileForDelivery,
} from '../harness/real-plugin-quality-profile.mjs';

test('real plugin quality profile keeps short canaries task-specific', () => {
  const profile = buildRealPluginQualityProfile('short-canary');

  assert.equal(profile.kind, 'canary');
  assert.equal(profile.minimumMarkdownBytes, 120);
  assert.equal(profile.requireFormalProjectQuality, false);
});

test('real plugin quality profile preserves strict project checks for medium and formal tasks', () => {
  assert.equal(buildRealPluginQualityProfile('medium-integration').requireFormalProjectQuality, true);
  assert.equal(buildRealPluginQualityProfile('formal-simulation').requireFormalProjectQuality, true);
  assert.equal(buildRealPluginQualityProfile('unknown').kind, 'formal');
});

test('real plugin quality profile derives the quality gate from explicit deliverables', () => {
  const base = buildRealPluginQualityProfile('t11-live-medium-coding');
  const codeProfile = specializeRealPluginQualityProfileForDelivery(base, {
    expectedMarkdownArtifacts: [],
    expectedCodeArtifacts: ['package.json', 'test/task-service.test.js'],
    expectedCodeDirs: ['src'],
  });

  assert.equal(base.requireFormalProjectQuality, true, 'scenario name alone must not disable formal checks');
  assert.equal(codeProfile.deliveryMode, 'code-workspace-deliverable');
  assert.equal(codeProfile.requireFormalProjectQuality, false);
});

test('required artifact snippets are explicit task assertions, not domain keywords', () => {
  assert.deepEqual(
    parseRequiredArtifactSnippets('kMavTunnelCmdLicense||print("\\nready")\nlicense_types.hpp'),
    ['kMavTunnelCmdLicense', 'print("\\nready")', 'license_types.hpp'],
  );
});

test('C11 real plugin scenario audits cancellation and steering reconciliation', () => {
  const profile = buildRealPluginQualityProfile('c11-cancel-steer-reconciliation');
  const spec = buildRealPluginScenarioSpec('c11-cancel-steer-reconciliation');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.minimumMarkdownBytes, 1000);
  assert.equal(spec.expectedReportLanguage, 'zh-CN');
  assert.equal(spec.expectedArtifactRel, 'docs/convergence/c11-cancel-steer-reconciliation.md');
  for (const marker of [
    'CanonicalRunControlService',
    'cancelling before cancelled',
    'effect-frozen',
    'in-flight effect reconciliation',
    'steering receipt',
    'instructionSha256',
    'TaskContract revision',
    'no post-cancel mutation',
  ]) {
    assert.ok(spec.requiredArtifactSnippets.includes(marker), `C11 must require ${marker}`);
  }
});

test('C13 real plugin scenario audits official MCP protocol and risk-scaled session authority', () => {
  const profile = buildRealPluginQualityProfile('c13-mcp-authority-boundary');
  const spec = buildRealPluginScenarioSpec('c13-mcp-authority-boundary');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.minimumMarkdownBytes, 1050);
  assert.equal(spec.expectedReportLanguage, 'zh-CN');
  assert.equal(spec.expectedArtifactRel, 'docs/convergence/c13-mcp-authority-boundary.md');
  for (const marker of [
    '@modelcontextprotocol/sdk',
    'server launch request and receipt',
    'tool call request and receipt',
    'configuration is not authority',
    'session-approved read-only tools',
    'risky calls require user evidence',
    'receipt replay is rejected',
    'safe inherited environment',
    'untrusted MCP result',
    'official stdio handshake',
  ]) {
    assert.ok(spec.requiredArtifactSnippets.includes(marker), `C13 must require ${marker}`);
  }
});

test('R3 live login-ready artifact gate allows warranty as historical meta wording only', () => {
  const spec = buildRealPluginScenarioSpec('r3-live-deepseek-login-ready-state');
  const allowedMetaText = 'Old warranty Markdown is historical context and cannot satisfy this login-ready audit.';
  const staleDomainText = 'uav-warranty-reminder uses maintenance_threshold_engine and warranty_types from the old case.';

  assert.equal(spec.forbiddenArtifactSnippets.includes('warranty'), false);
  assert.equal(spec.forbiddenArtifactSnippets.some((snippet) => allowedMetaText.includes(snippet)), false);
  assert.equal(spec.forbiddenArtifactSnippets.some((snippet) => staleDomainText.includes(snippet)), true);
});


test('R3-08A VS Code collaboration real plugin scenario adds a fresh visible case', () => {
  const profile = buildRealPluginQualityProfile('r3-08a-vscode-collaboration');
  const spec = buildRealPluginScenarioSpec('r3-08a-vscode-collaboration');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.minimumMarkdownBytes, 1100);
  assert.equal(profile.minimumMarkdownLines, 26);
  assert.equal(profile.minimumMarkdownHeadings, 5);
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-08a-vscode-collaboration');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-08a-vscode-collaboration.md');
  assert.match(spec.promptTitle, /R3-08A-VSCODE-USER-COLLABORATION/);
  assert.deepEqual(spec.requiredArtifactSnippets, [
    'R3-08A-VSCODE-USER-COLLABORATION',
    'VSCodeSurfaceAdapter',
    'SurfaceAdapter.renderEvent',
    'same trace/event',
    'surfaceTrace',
    'eventId',
    'commandId',
    'taskId',
    'provider.status',
    'permission.requested',
    'fileChanges.proposed',
    'validation.completed',
    'qualityGate.completed',
    'checkpoint.available',
    'agentCheckpointAvailable',
    'not only DOM fixture',
    'not fixed line-count smoke',
  ]);
  assert.ok(spec.forbiddenArtifactSnippets.includes('uav-warranty-reminder'));
});

test('visible iteration scenarios are fresh semantic cases, not fixed line-count smoke', () => {
  const iterationSpecs = listRealPluginIterationScenarioSpecs();

  assert.ok(iterationSpecs.length >= 10, 'iteration harness must carry every active visible leaf as a scenario');
  assert.deepEqual(new Set(iterationSpecs.map((spec) => spec.id)).size, iterationSpecs.length, 'scenario ids must be unique');
  assert.deepEqual(
    new Set(iterationSpecs.map((spec) => spec.expectedArtifactRel)).size,
    iterationSpecs.length,
    'expected artifact paths must be unique per active leaf',
  );
  assert.deepEqual(
    new Set(iterationSpecs.map((spec) => spec.freshCaseMarker)).size,
    iterationSpecs.length,
    'fresh case markers must be unique per active leaf',
  );

  for (const spec of iterationSpecs) {
    assert.equal(spec.kind, 'iteration', `${spec.id} must be an iteration profile`);
    assert.ok(spec.changedSurface, `${spec.id} must name the changed surface being tested`);
    assert.ok(spec.semanticAcceptance && spec.semanticAcceptance.length >= 3, `${spec.id} must define semantic acceptance anchors`);
    assert.ok(spec.rejectFixedLineCountOnly, `${spec.id} must reject fixed line-count-only settlement`);
    assert.ok(spec.requiredArtifactSnippets.includes(spec.freshCaseMarker), `${spec.id} must require its fresh marker in the artifact`);
    assert.ok(spec.requiredArtifactSnippets.length > Number(spec.minimumMarkdownHeadings || 0), `${spec.id} must require semantic anchors beyond heading counts`);
    assert.ok(spec.forbiddenArtifactSnippets.includes('uav-warranty-reminder'), `${spec.id} must reject stale warranty case bleed-through`);
  }
});

test('R3-08C accessibility real plugin scenario adds keyboard and screen-reader coverage', () => {
  const profile = buildRealPluginQualityProfile('r3-08c-accessibility');
  const spec = buildRealPluginScenarioSpec('r3-08c-accessibility');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-08c-accessibility');
  assert.equal(spec.changedSurface, 'vscode-webview-accessibility');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-08c-accessibility.md');
  assert.match(spec.promptTitle, /R3-08C-ACCESSIBILITY/);
  assert.deepEqual(spec.semanticAcceptance, [
    'keyboard-navigation',
    'screen-reader-live-status',
    'focusable-action-surfaces',
    'status-not-color-only',
  ]);
  for (const snippet of [
    'R3-08C-ACCESSIBILITY',
    'keyboard-navigation',
    'screen-reader-live-status',
    'focusable-action-surfaces',
    'status-not-color-only',
    'aria-live',
    'aria-label',
    'role="status"',
    'tabindex="0"',
    'Enter/Space',
    'not fixed line-count smoke',
  ]) {
    assert.ok(spec.requiredArtifactSnippets.includes(snippet), `R3-08C must require ${snippet}`);
  }
});

test('R3-08D Linux conformance real plugin scenario adds native and container platform coverage', () => {
  const profile = buildRealPluginQualityProfile('r3-08d-linux-conformance');
  const spec = buildRealPluginScenarioSpec('r3-08d-linux-conformance');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-08d-linux-conformance');
  assert.equal(spec.changedSurface, 'linux-platform-runtime-conformance');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-08d-linux-conformance.md');
  assert.match(spec.promptTitle, /R3-08D-LINUX-CONFORMANCE/);
  assert.deepEqual(spec.semanticAcceptance, [
    'native/container',
    'shell-path-storage-browser-bridge',
    'permission-fault-sequence',
    'path-fault-sequence',
  ]);
  for (const snippet of [
    'R3-08D-LINUX-CONFORMANCE',
    'evaluateLinuxPlatformConformance',
    'linux-local-xdg',
    'linux-container-xdg',
    'display-server',
    'external-bridge-url',
    'linux-browser-bridge-unreachable',
    'bridge-executable-not-executable',
    'linux-requires-posix-lf-case-sensitive-paths',
    'native/container',
    'not fixed line-count smoke',
  ]) {
    assert.ok(spec.requiredArtifactSnippets.includes(snippet), `R3-08D must require ${snippet}`);
  }
});

test('R3-08E Windows and WSL conformance real plugin scenario adds split platform coverage', () => {
  const profile = buildRealPluginQualityProfile('r3-08e-windows-wsl-conformance');
  const spec = buildRealPluginScenarioSpec('r3-08e-windows-wsl-conformance');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-08e-windows-wsl-conformance');
  assert.equal(spec.changedSurface, 'windows-wsl-platform-runtime-conformance');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-08e-windows-wsl-conformance.md');
  assert.match(spec.promptTitle, /R3-08E-WINDOWS-WSL-CONFORMANCE/);
  assert.deepEqual(spec.semanticAcceptance, [
    'Windows native/WSL',
    'path-shell-line-ending',
    'permission-fault-sequence',
    'interop-fault-sequence',
  ]);
  for (const snippet of [
    'R3-08E-WINDOWS-WSL-CONFORMANCE',
    'evaluateWindowsWslPlatformConformance',
    'windows-native-path',
    'wsl-posix-path',
    'windows-crlf',
    'wsl-lf',
    'windows-native-no-wsl',
    'wsl-interop',
    'windows-native-requires-windows-paths',
    'wsl-interop-missing',
    'Windows native/WSL',
    'not fixed line-count smoke',
  ]) {
    assert.ok(spec.requiredArtifactSnippets.includes(snippet), `R3-08E must require ${snippet}`);
  }
});

test('R3-08F macOS conformance real plugin scenario adds deferred platform coverage', () => {
  const profile = buildRealPluginQualityProfile('r3-08f-macos-conformance');
  const spec = buildRealPluginScenarioSpec('r3-08f-macos-conformance');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-08f-macos-conformance');
  assert.equal(spec.changedSurface, 'macos-platform-runtime-conformance');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-08f-macos-conformance.md');
  assert.match(spec.promptTitle, /R3-08F-MACOS-CONFORMANCE/);
  assert.deepEqual(spec.semanticAcceptance, [
    'macOS shell/path/keychain/browser/runtime',
    'deferred-not-pass',
    'keychain-browser-runtime-evidence',
    'path-shell-fault-sequence',
  ]);
  for (const snippet of [
    'R3-08F-MACOS-CONFORMANCE',
    'evaluateMacOSPlatformConformance',
    'macos-darwin',
    'macos-posix-shell',
    'macos-posix-path',
    'macos-keychain',
    'macos-browser-bridge',
    'macos-runtime',
    'r3-08f-macos-environment-deferred',
    'macos-keychain-evidence-deferred',
    'macos-browser-bridge-evidence-deferred',
    'macos-runtime-unavailable',
    'macOS shell/path/keychain/browser/runtime',
    'not fixed line-count smoke',
  ]) {
    assert.ok(spec.requiredArtifactSnippets.includes(snippet), `R3-08F must require ${snippet}`);
  }
});

test('R3-09A run metrics schema real plugin scenario adds append-only metrics coverage', () => {
  const profile = buildRealPluginQualityProfile('r3-09a-run-metrics-schema');
  const spec = buildRealPluginScenarioSpec('r3-09a-run-metrics-schema');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-09a-run-metrics-schema');
  assert.equal(spec.changedSurface, 'run-evidence-metrics-schema');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-09a-run-metrics-schema.md');
  assert.match(spec.promptTitle, /R3-09A-RUN-METRICS-SCHEMA/);
  assert.deepEqual(spec.semanticAcceptance, [
    'append-only evidence',
    'token/tool/latency/retry/cost/evidence-size',
    'unknown-not-omitted',
    'content-secret-free',
  ]);
  for (const snippet of [
    'R3-09A-RUN-METRICS-SCHEMA',
    'ProductRunEvidenceSession.recordRunMetrics',
    'run.metrics',
    'devseek.run-metrics/v1',
    'token/tool/latency/retry/cost/evidence-size',
    'append-only evidence',
    'unknown-not-omitted',
    'content-secret-free',
    'evidence_size',
    'cost.amount_micros',
    'not fixed line-count smoke',
  ]) {
    assert.ok(spec.requiredArtifactSnippets.includes(snippet), `R3-09A must require ${snippet}`);
  }
});

test('R3-09B budget policy decision real plugin scenario adds bounded budget coverage', () => {
  const profile = buildRealPluginQualityProfile('r3-09b-budget-policy-decision');
  const spec = buildRealPluginScenarioSpec('r3-09b-budget-policy-decision');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-09b-budget-policy-decision');
  assert.equal(spec.changedSurface, 'run-budget-policy-decision');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-09b-budget-policy-decision.md');
  assert.match(spec.promptTitle, /R3-09B-BUDGET-POLICY-DECISION/);
  assert.deepEqual(spec.semanticAcceptance, [
    'budget-policy-owner',
    'allow/replan/blocked',
    'safety-and-acceptance-protected',
    'no-progress-bounded',
  ]);
  for (const snippet of [
    'R3-09B-BUDGET-POLICY-DECISION',
    'decideRunBudgetPolicy',
    'devseek.run-budget-policy/v1',
    'canonical-run-budget',
    'allow/replan/blocked',
    'safety-and-acceptance-protected',
    'optional-budget-exceeded-replan',
    'required-budget-exceeded-blocked',
    'required-budget-missing-blocked',
    'no-progress-budget-exhausted',
    'not fixed line-count smoke',
  ]) {
    assert.ok(spec.requiredArtifactSnippets.includes(snippet), `R3-09B must require ${snippet}`);
  }
});

test('R3 live DeepSeek login-ready real plugin scenario covers plugin-opened session drift', () => {
  const profile = buildRealPluginQualityProfile('r3-live-deepseek-login-ready-state');
  const spec = buildRealPluginScenarioSpec('r3-live-deepseek-login-ready-state');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-live-deepseek-login-ready-state');
  assert.equal(spec.changedSurface, 'deepseek-web-login-ready-health');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md');
  assert.equal(spec.expectedReportLanguage, 'zh-CN');
  assert.match(spec.promptTitle, /R3-LIVE-DEEPSEEK-LOGIN-READY-STATE/);
  assert.deepEqual(spec.semanticAcceptance, [
    'plugin-opened DeepSeek page',
    'chatInput evidence',
    'login-state-not-send-button',
    'send button selector drift is not LOGIN_REQUIRED',
  ]);
  for (const snippet of [
    'R3-LIVE-DEEPSEEK-LOGIN-READY-STATE',
    'BridgeHealthCheck',
    'devseek.deepseek-web-connector-health/v1',
    'loggedInLikely',
    'plugin-opened DeepSeek page',
    'chatInput evidence',
    'deepseek-dom-send-button-missing',
    'login-state-not-send-button',
    'send button selector drift is not LOGIN_REQUIRED',
    'not fixed line-count smoke',
  ]) {
    assert.ok(spec.requiredArtifactSnippets.includes(snippet), `R3 live login-ready must require ${snippet}`);
  }
});
