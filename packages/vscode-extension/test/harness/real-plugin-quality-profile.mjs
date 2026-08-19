const R3_07G_STALE_DOMAIN_SNIPPETS = Object.freeze([
  'UAV 吊运维保',
  '维保提醒',
  'maintenance_threshold_engine',
  'uav-warranty-reminder',
  'uav_warranty_reminder',
  'warranty reminder',
  'warranty_types',
  'test_warranty',
]);

const FRESH_R3_CASE_REJECTION = Object.freeze([
  'not fixed line-count smoke',
]);

const C11_CANCEL_STEER_RECONCILIATION_SPEC = Object.freeze({
  id: 'c11-cancel-steer-reconciliation',
  kind: 'iteration',
  minimumMarkdownBytes: 1000,
  minimumMarkdownLines: 22,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'C11 cancellation and steering reconciliation audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/convergence/c11-cancel-steer-reconciliation.md',
  expectedArtifactRel: 'docs/convergence/c11-cancel-steer-reconciliation.md',
  expectedReportLanguage: 'zh-CN',
  requiredArtifactSnippets: Object.freeze([
    'C11-CANCEL-STEER-RECONCILIATION',
    'CanonicalRunControlService',
    'cancelling before cancelled',
    'effect-frozen',
    'in-flight effect reconciliation',
    'steering receipt',
    'instructionSha256',
    'TaskContract revision',
    'no post-cancel mutation',
    ...FRESH_R3_CASE_REJECTION,
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  changedSurface: 'canonical-run-control',
  freshCaseMarker: 'C11-CANCEL-STEER-RECONCILIATION',
  semanticAcceptance: Object.freeze([
    'cancelling before cancelled',
    'in-flight effect reconciliation',
    'no post-cancel mutation',
  ]),
  rejectFixedLineCountOnly: true,
});

const C13_MCP_AUTHORITY_BOUNDARY_SPEC = Object.freeze({
  id: 'c13-mcp-authority-boundary',
  kind: 'iteration',
  minimumMarkdownBytes: 1050,
  minimumMarkdownLines: 24,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'C13 MCP protocol and risk-scaled session authority audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/convergence/c13-mcp-authority-boundary.md',
  expectedArtifactRel: 'docs/convergence/c13-mcp-authority-boundary.md',
  expectedReportLanguage: 'zh-CN',
  requiredArtifactSnippets: Object.freeze([
    'C13-MCP-AUTHORITY-BOUNDARY',
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
    ...FRESH_R3_CASE_REJECTION,
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  changedSurface: 'canonical-mcp-boundary',
  freshCaseMarker: 'C13-MCP-AUTHORITY-BOUNDARY',
  semanticAcceptance: Object.freeze([
    'configuration is not authority',
    'session-approved read-only tools',
    'risky calls require user evidence',
    'receipt replay is rejected',
    'official stdio handshake',
  ]),
  rejectFixedLineCountOnly: true,
});

const R3_08A_VSCODE_COLLABORATION_SPEC = Object.freeze({
  id: 'r3-08a-vscode-collaboration',
  kind: 'iteration',
  minimumMarkdownBytes: 1100,
  minimumMarkdownLines: 26,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-08A-VSCODE-USER-COLLABORATION surface event projection audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-08a-vscode-collaboration.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-08a-vscode-collaboration.md',
  requiredArtifactSnippets: Object.freeze([
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
    ...FRESH_R3_CASE_REJECTION,
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  changedSurface: 'vscode-surface-adapter-collaboration',
  freshCaseMarker: 'R3-08A-VSCODE-USER-COLLABORATION',
  semanticAcceptance: Object.freeze([
    'surfaceTrace',
    'same trace/event',
    'agentCheckpointAvailable',
    'not only DOM fixture',
  ]),
  rejectFixedLineCountOnly: true,
});

const R3_08C_ACCESSIBILITY_SPEC = Object.freeze({
  id: 'r3-08c-accessibility',
  kind: 'iteration',
  minimumMarkdownBytes: 1150,
  minimumMarkdownLines: 28,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-08C-ACCESSIBILITY keyboard and screen-reader surface audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-08c-accessibility.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-08c-accessibility.md',
  requiredArtifactSnippets: Object.freeze([
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
    ...FRESH_R3_CASE_REJECTION,
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  changedSurface: 'vscode-webview-accessibility',
  freshCaseMarker: 'R3-08C-ACCESSIBILITY',
  semanticAcceptance: Object.freeze([
    'keyboard-navigation',
    'screen-reader-live-status',
    'focusable-action-surfaces',
    'status-not-color-only',
  ]),
  rejectFixedLineCountOnly: true,
});

const R3_08D_LINUX_CONFORMANCE_SPEC = Object.freeze({
  id: 'r3-08d-linux-conformance',
  kind: 'iteration',
  minimumMarkdownBytes: 1200,
  minimumMarkdownLines: 30,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-08D-LINUX-CONFORMANCE native/container platform profile audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-08d-linux-conformance.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-08d-linux-conformance.md',
  requiredArtifactSnippets: Object.freeze([
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
    ...FRESH_R3_CASE_REJECTION,
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  changedSurface: 'linux-platform-runtime-conformance',
  freshCaseMarker: 'R3-08D-LINUX-CONFORMANCE',
  semanticAcceptance: Object.freeze([
    'native/container',
    'shell-path-storage-browser-bridge',
    'permission-fault-sequence',
    'path-fault-sequence',
  ]),
  rejectFixedLineCountOnly: true,
});

const R3_08E_WINDOWS_WSL_CONFORMANCE_SPEC = Object.freeze({
  id: 'r3-08e-windows-wsl-conformance',
  kind: 'iteration',
  minimumMarkdownBytes: 1250,
  minimumMarkdownLines: 32,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-08E-WINDOWS-WSL-CONFORMANCE native and WSL platform profile audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-08e-windows-wsl-conformance.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-08e-windows-wsl-conformance.md',
  requiredArtifactSnippets: Object.freeze([
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
    ...FRESH_R3_CASE_REJECTION,
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  changedSurface: 'windows-wsl-platform-runtime-conformance',
  freshCaseMarker: 'R3-08E-WINDOWS-WSL-CONFORMANCE',
  semanticAcceptance: Object.freeze([
    'Windows native/WSL',
    'path-shell-line-ending',
    'permission-fault-sequence',
    'interop-fault-sequence',
  ]),
  rejectFixedLineCountOnly: true,
});

const R3_08F_MACOS_CONFORMANCE_SPEC = Object.freeze({
  id: 'r3-08f-macos-conformance',
  kind: 'iteration',
  minimumMarkdownBytes: 1250,
  minimumMarkdownLines: 32,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-08F-MACOS-CONFORMANCE macOS platform profile audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-08f-macos-conformance.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-08f-macos-conformance.md',
  requiredArtifactSnippets: Object.freeze([
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
    ...FRESH_R3_CASE_REJECTION,
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  changedSurface: 'macos-platform-runtime-conformance',
  freshCaseMarker: 'R3-08F-MACOS-CONFORMANCE',
  semanticAcceptance: Object.freeze([
    'macOS shell/path/keychain/browser/runtime',
    'deferred-not-pass',
    'keychain-browser-runtime-evidence',
    'path-shell-fault-sequence',
  ]),
  rejectFixedLineCountOnly: true,
});

const R3_09A_RUN_METRICS_SCHEMA_SPEC = Object.freeze({
  id: 'r3-09a-run-metrics-schema',
  kind: 'iteration',
  minimumMarkdownBytes: 1250,
  minimumMarkdownLines: 32,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-09A-RUN-METRICS-SCHEMA append-only observability metrics audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-09a-run-metrics-schema.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-09a-run-metrics-schema.md',
  requiredArtifactSnippets: Object.freeze([
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
    ...FRESH_R3_CASE_REJECTION,
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  changedSurface: 'run-evidence-metrics-schema',
  freshCaseMarker: 'R3-09A-RUN-METRICS-SCHEMA',
  semanticAcceptance: Object.freeze([
    'append-only evidence',
    'token/tool/latency/retry/cost/evidence-size',
    'unknown-not-omitted',
    'content-secret-free',
  ]),
  rejectFixedLineCountOnly: true,
});

const R3_09B_BUDGET_POLICY_DECISION_SPEC = Object.freeze({
  id: 'r3-09b-budget-policy-decision',
  kind: 'iteration',
  minimumMarkdownBytes: 1250,
  minimumMarkdownLines: 32,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-09B-BUDGET-POLICY-DECISION bounded budget policy audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-09b-budget-policy-decision.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-09b-budget-policy-decision.md',
  requiredArtifactSnippets: Object.freeze([
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
    ...FRESH_R3_CASE_REJECTION,
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  changedSurface: 'run-budget-policy-decision',
  freshCaseMarker: 'R3-09B-BUDGET-POLICY-DECISION',
  semanticAcceptance: Object.freeze([
    'budget-policy-owner',
    'allow/replan/blocked',
    'safety-and-acceptance-protected',
    'no-progress-bounded',
  ]),
  rejectFixedLineCountOnly: true,
});

const R3_LIVE_DEEPSEEK_LOGIN_READY_STATE_SPEC = Object.freeze({
  id: 'r3-live-deepseek-login-ready-state',
  kind: 'iteration',
  minimumMarkdownBytes: 1150,
  minimumMarkdownLines: 28,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-LIVE-DEEPSEEK-LOGIN-READY-STATE plugin-opened DeepSeek login readiness audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md',
  expectedReportLanguage: 'zh-CN',
  requiredArtifactSnippets: Object.freeze([
    'R3-LIVE-DEEPSEEK-LOGIN-READY-STATE',
    'BridgeHealthCheck',
    'devseek.deepseek-web-connector-health/v1',
    'loggedInLikely',
    'plugin-opened DeepSeek page',
    'chatInput evidence',
    'deepseek-dom-send-button-missing',
    'login-state-not-send-button',
    'send button selector drift is not LOGIN_REQUIRED',
    ...FRESH_R3_CASE_REJECTION,
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  changedSurface: 'deepseek-web-login-ready-health',
  freshCaseMarker: 'R3-LIVE-DEEPSEEK-LOGIN-READY-STATE',
  semanticAcceptance: Object.freeze([
    'plugin-opened DeepSeek page',
    'chatInput evidence',
    'login-state-not-send-button',
    'send button selector drift is not LOGIN_REQUIRED',
  ]),
  rejectFixedLineCountOnly: true,
});

export function buildRealPluginQualityProfile(scenario) {
  const spec = lookupScenarioSpec(scenario);
  if (spec) {
    return {
      kind: spec.kind,
      minimumMarkdownBytes: spec.minimumMarkdownBytes,
      minimumMarkdownLines: spec.minimumMarkdownLines,
      minimumMarkdownHeadings: spec.minimumMarkdownHeadings,
      requireFormalProjectQuality: spec.requireFormalProjectQuality,
    };
  }
  const kind = classifyScenario(scenario);
  return {
    kind,
    minimumMarkdownBytes: kind === 'canary' ? 120 : kind === 'medium' ? 300 : 500,
    minimumMarkdownLines: kind === 'canary' ? 2 : 8,
    minimumMarkdownHeadings: kind === 'canary' ? 1 : 2,
    requireFormalProjectQuality: kind !== 'canary',
  };
}

export function specializeRealPluginQualityProfileForDelivery(profile, delivery) {
  const codeEvidenceRequired = (delivery.expectedCodeArtifacts || []).length > 0
    || (delivery.expectedCodeDirs || []).length > 0;
  const markdownEvidenceRequired = (delivery.expectedMarkdownArtifacts || []).length > 0;
  if (codeEvidenceRequired && !markdownEvidenceRequired) {
    return {
      ...profile,
      deliveryMode: 'code-workspace-deliverable',
      requireFormalProjectQuality: false,
    };
  }
  return {
    ...profile,
    deliveryMode: markdownEvidenceRequired ? 'markdown-file-deliverable' : 'unspecified',
  };
}

export function buildRealPluginScenarioSpec(scenario) {
  const spec = lookupScenarioSpec(scenario);
  if (!spec) {
    return {
      id: normalizeScenario(scenario),
      promptTitle: '',
      requestedOutputDocRel: '',
      expectedArtifactRel: '',
      requiredArtifactSnippets: [],
      forbiddenArtifactSnippets: [],
      changedSurface: '',
      freshCaseMarker: '',
      semanticAcceptance: [],
      rejectFixedLineCountOnly: false,
    };
  }
  return {
    id: spec.id,
    kind: spec.kind,
    minimumMarkdownBytes: spec.minimumMarkdownBytes,
    minimumMarkdownLines: spec.minimumMarkdownLines,
    minimumMarkdownHeadings: spec.minimumMarkdownHeadings,
    requireFormalProjectQuality: spec.requireFormalProjectQuality,
    promptTitle: spec.promptTitle,
    profileKind: spec.profileKind,
    deliveryMode: spec.deliveryMode,
    requestedOutputDocRel: spec.requestedOutputDocRel,
    expectedArtifactRel: spec.expectedArtifactRel,
    expectedReportLanguage: spec.expectedReportLanguage || '',
    requiredArtifactSnippets: [...spec.requiredArtifactSnippets],
    forbiddenArtifactSnippets: [...spec.forbiddenArtifactSnippets],
    changedSurface: spec.changedSurface || '',
    freshCaseMarker: spec.freshCaseMarker || '',
    semanticAcceptance: [...(spec.semanticAcceptance || [])],
    rejectFixedLineCountOnly: spec.rejectFixedLineCountOnly === true,
  };
}

export function listRealPluginIterationScenarioSpecs() {
  return [
    C11_CANCEL_STEER_RECONCILIATION_SPEC,
    C13_MCP_AUTHORITY_BOUNDARY_SPEC,
    R3_08A_VSCODE_COLLABORATION_SPEC,
    R3_08C_ACCESSIBILITY_SPEC,
    R3_08D_LINUX_CONFORMANCE_SPEC,
    R3_08E_WINDOWS_WSL_CONFORMANCE_SPEC,
    R3_08F_MACOS_CONFORMANCE_SPEC,
    R3_09A_RUN_METRICS_SCHEMA_SPEC,
    R3_09B_BUDGET_POLICY_DECISION_SPEC,
    R3_LIVE_DEEPSEEK_LOGIN_READY_STATE_SPEC,
  ].map((spec) => buildRealPluginScenarioSpec(spec.id));
}

export function parseRequiredArtifactSnippets(value) {
  return String(value || '')
    .split(/\|\||\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
}

function lookupScenarioSpec(value) {
  const scenario = normalizeScenario(value);
  if (scenario === R3_LIVE_DEEPSEEK_LOGIN_READY_STATE_SPEC.id) return R3_LIVE_DEEPSEEK_LOGIN_READY_STATE_SPEC;
  if (scenario === R3_09B_BUDGET_POLICY_DECISION_SPEC.id) return R3_09B_BUDGET_POLICY_DECISION_SPEC;
  if (scenario === R3_09A_RUN_METRICS_SCHEMA_SPEC.id) return R3_09A_RUN_METRICS_SCHEMA_SPEC;
  if (scenario === R3_08F_MACOS_CONFORMANCE_SPEC.id) return R3_08F_MACOS_CONFORMANCE_SPEC;
  if (scenario === R3_08E_WINDOWS_WSL_CONFORMANCE_SPEC.id) return R3_08E_WINDOWS_WSL_CONFORMANCE_SPEC;
  if (scenario === R3_08D_LINUX_CONFORMANCE_SPEC.id) return R3_08D_LINUX_CONFORMANCE_SPEC;
  if (scenario === R3_08C_ACCESSIBILITY_SPEC.id) return R3_08C_ACCESSIBILITY_SPEC;
  if (scenario === R3_08A_VSCODE_COLLABORATION_SPEC.id) return R3_08A_VSCODE_COLLABORATION_SPEC;
  if (scenario === C13_MCP_AUTHORITY_BOUNDARY_SPEC.id) return C13_MCP_AUTHORITY_BOUNDARY_SPEC;
  if (scenario === C11_CANCEL_STEER_RECONCILIATION_SPEC.id) return C11_CANCEL_STEER_RECONCILIATION_SPEC;
  return null;
}

function normalizeScenario(value) {
  return String(value || '').trim().toLowerCase();
}

function classifyScenario(value) {
  const scenario = normalizeScenario(value);
  if (/canary|smoke|short|tiny|read-only/.test(scenario)) return 'canary';
  if (/medium|integration/.test(scenario)) return 'medium';
  return 'formal';
}
