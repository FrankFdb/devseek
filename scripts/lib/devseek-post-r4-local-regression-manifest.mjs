import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const POST_R4_LOCAL_REGRESSION_MANIFEST_SCHEMA_VERSION =
  'devseek.post-r4-local-regression-manifest/v1';
export const POST_R4_LOCAL_REGRESSION_MANIFEST_ID =
  'POST-R4-LOCAL-REGRESSION-MANIFEST/v1';
export const POST_R4_LOCAL_REGRESSION_MANIFEST_SCOPE =
  'local-post-r4-nonpermission-regression-coverage';
export const POST_R4_LOCAL_REGRESSION_MANIFEST_PATH =
  'docs/process/devseek-post-r4-local-regression-manifest.json';
export const POST_R4_LOCAL_REGRESSION_MANIFEST_VIEW_PATH =
  'docs/process/generated/devseek-post-r4-local-regression-manifest.md';

const PLAN_PATH = 'docs/process/devseek-post-r4-nonpermission-iteration-plan.md';
const PACKAGE_PATH = 'package.json';
const PHASE_GATE_PATH = 'scripts/devseek-phase0-12-verify.mjs';
const CHECKER_PATH = 'scripts/devseek-post-r4-local-regression-manifest-check.mjs';
const ORACLE_PATH = 'scripts/test/devseek-post-r4-local-regression-manifest.test.mjs';

export const POST_R4_LOCAL_REGRESSION_REQUIRED_SOURCE_PATHS = Object.freeze([
  PLAN_PATH,
]);

const REGRESSION_TRACKS = Object.freeze([
  {
    item_id: 'NP-05',
    title: 'Provider protocol replay hardening',
    product_risk: 'DeepSeek/Provider corrupted or partial tool output must stay in deterministic replay and never be settled as success.',
    plan_heading: '### NP-05 Provider protocol replay hardening',
    verification_commands: [
      'node packages/vscode-extension/test/unit/fake-tool-parser.test.mjs',
      'node packages/vscode-extension/test/unit/provider-output-integrity.test.mjs',
      'node packages/vscode-extension/test/unit/run-log-replay.test.mjs',
    ],
    covered_sources: [
      { path: 'packages/vscode-extension/src/agent/fake-tool-parser.ts', role: 'provider-tool-text-parser' },
      { path: 'packages/vscode-extension/src/agent/provider-output-integrity.ts', role: 'provider-integrity-classifier' },
      { path: 'packages/vscode-extension/src/diagnostics/run-log-replay.ts', role: 'run-log-failure-oracle' },
      { path: 'packages/vscode-extension/test/unit/fake-tool-parser.test.mjs', role: 'fake-tool-parser-replay-oracle' },
      { path: 'packages/vscode-extension/test/unit/provider-output-integrity.test.mjs', role: 'provider-integrity-replay-oracle' },
      { path: 'packages/vscode-extension/test/unit/run-log-replay.test.mjs', role: 'run-log-replay-oracle' },
    ],
    anchor_checks: [
      {
        path: 'packages/vscode-extension/test/unit/fake-tool-parser.test.mjs',
        anchor: 'parses R3 live DeepSeek named-parameter tool_call envelopes',
        category: 'named-tool-call-envelope',
      },
      {
        path: 'packages/vscode-extension/test/unit/provider-output-integrity.test.mjs',
        anchor: 'rejects safety-interstitial interrupted tool blocks as truncated',
        category: 'safety-interstitial-truncation',
      },
      {
        path: 'packages/vscode-extension/test/unit/provider-output-integrity.test.mjs',
        anchor: 'classifies malformed DeepSeek function envelopes as executable tool calls',
        category: 'malformed-json-tool-envelope',
      },
      {
        path: 'packages/vscode-extension/src/agent/provider-output-integrity.ts',
        anchor: 'RESPONSE_CORRUPTED',
        category: 'corrupted-provider-output',
      },
      {
        path: 'packages/vscode-extension/src/diagnostics/run-log-replay.ts',
        anchor: 'failure-status-reported-completed',
        category: 'replay-failure-not-overwritten',
      },
    ],
  },
  {
    item_id: 'NP-06',
    title: 'Terminal settlement and recovered-write regression pack',
    product_risk: 'A verified local write must not be overturned by later provider/fetch failure, duplicate recovery, or post-terminal events.',
    plan_heading: '### NP-06 Terminal settlement and recovered-write regression pack',
    verification_commands: [
      'node packages/vscode-extension/test/unit/run-context.test.mjs',
      'node packages/vscode-extension/test/unit/run-context-settlement.test.mjs',
      'node packages/vscode-extension/test/unit/workflow-compliance.test.mjs',
    ],
    covered_sources: [
      { path: 'packages/vscode-extension/src/app/run-context.ts', role: 'durable-run-settlement-owner' },
      { path: 'packages/vscode-extension/src/app/settlement-state.ts', role: 'terminal-state-policy' },
      { path: 'packages/vscode-extension/src/diagnostics/run-log-replay.ts', role: 'settlement-replay-oracle' },
      { path: 'packages/vscode-extension/test/unit/run-context.test.mjs', role: 'run-context-recovery-oracle' },
      { path: 'packages/vscode-extension/test/unit/run-context-settlement.test.mjs', role: 'settlement-contract-oracle' },
      { path: 'packages/vscode-extension/test/unit/workflow-compliance.test.mjs', role: 'workflow-static-contract-oracle' },
    ],
    anchor_checks: [
      {
        path: 'packages/vscode-extension/test/unit/run-context.test.mjs',
        anchor: 'post-verification provider failure cannot overturn recovered local write completion',
        category: 'late-provider-failure-after-local-success',
      },
      {
        path: 'packages/vscode-extension/test/unit/run-context.test.mjs',
        anchor: 'provider-failure-superseded-by-verified-local-result',
        category: 'recovered-write-resolution',
      },
      {
        path: 'packages/vscode-extension/test/unit/run-context.test.mjs',
        anchor: 'cancel owns settlement and ignores post-cancel effects',
        category: 'post-terminal-effect-ignored',
      },
      {
        path: 'packages/vscode-extension/test/unit/run-context-settlement.test.mjs',
        anchor: 'committed side effects complete only after verification and QualityGate pass',
        category: 'quality-gate-required-for-mutation',
      },
      {
        path: 'packages/vscode-extension/src/app/run-context.ts',
        anchor: 'completeLateProviderFailuresFromVerifiedLocalResult',
        category: 'late-provider-failure-recovery-boundary',
      },
      {
        path: 'packages/vscode-extension/src/diagnostics/run-log-replay.ts',
        anchor: 'run evidence 中仍有未被 recovery.completed',
        category: 'unresolved-provider-failure-replay-error',
      },
    ],
  },
  {
    item_id: 'NP-07',
    title: 'Artifact quality local oracle expansion',
    product_risk: 'Generated artifacts must be checked against concrete deliverables, source anchors, domain anchors, and scenario language.',
    plan_heading: '### NP-07 Artifact quality local oracle expansion',
    verification_commands: [
      'node packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs',
      'node packages/vscode-extension/test/unit/completion-evidence.test.mjs',
    ],
    covered_sources: [
      { path: 'packages/vscode-extension/src/agent/artifact-quality-oracle.ts', role: 'markdown-artifact-quality-oracle' },
      { path: 'packages/vscode-extension/src/agent/completion-evidence.ts', role: 'completion-evidence-deliverable-contract' },
      { path: 'packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs', role: 'artifact-quality-oracle-tests' },
      { path: 'packages/vscode-extension/test/unit/completion-evidence.test.mjs', role: 'completion-evidence-tests' },
    ],
    anchor_checks: [
      {
        path: 'packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs',
        anchor: 'missing literal anchors fail the generated artifact gate',
        category: 'missing-literal-anchor',
      },
      {
        path: 'packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs',
        anchor: 'stale warranty domain anchors fail DevSeek process artifacts',
        category: 'stale-domain-anchor',
      },
      {
        path: 'packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs',
        anchor: 'writing an input source path does not satisfy the requested output deliverable',
        category: 'source-path-is-not-output-target',
      },
      {
        path: 'packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs',
        anchor: 'generic warranty advice cannot replace source-backed warranty facts',
        category: 'generic-warranty-false-positive',
      },
      {
        path: 'packages/vscode-extension/test/unit/artifact-quality-oracle.test.mjs',
        anchor: 'explicit Chinese report requirement rejects English-only prose',
        category: 'artifact-language-mismatch',
      },
      {
        path: 'packages/vscode-extension/src/agent/artifact-quality-oracle.ts',
        anchor: 'source-grounding-missing',
        category: 'source-grounding-missing',
      },
    ],
  },
]);

export function loadPostR4LocalRegressionManifestSources(repoRoot = process.cwd(), overrides = {}) {
  const sourcePaths = unique([
    PLAN_PATH,
    PACKAGE_PATH,
    PHASE_GATE_PATH,
    CHECKER_PATH,
    ORACLE_PATH,
    ...REGRESSION_TRACKS.flatMap(track => track.covered_sources.map(source => source.path)),
  ]);
  const sourceContents = {};
  for (const sourcePath of sourcePaths) {
    sourceContents[sourcePath] = overrides.sourceContents?.[sourcePath]
      ?? readText(path.join(repoRoot, sourcePath));
  }
  return {
    sourceContents,
    packageJson: overrides.packageJson
      ?? JSON.parse(sourceContents[PACKAGE_PATH]),
  };
}

export function buildPostR4LocalRegressionManifest({ repoRoot = process.cwd(), sources = null } = {}) {
  const activeSources = sources ?? loadPostR4LocalRegressionManifestSources(repoRoot);
  const { sourceContents, packageJson } = activeSources;
  const packageScriptPresent = Boolean(packageJson.scripts?.['verify:post-r4-local-regression-manifest']);
  const phaseSource = sourceContents[PHASE_GATE_PATH] ?? '';
  const phaseGatePresent = phaseSource.includes('post-r4-local-regression-manifest');
  const planText = sourceContents[PLAN_PATH] ?? '';
  const tracks = REGRESSION_TRACKS.map(track => {
    const commands = track.verification_commands.map(command => ({
      command,
      execution_scope: 'local-node-unit-test',
      live_provider_actions: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      qualification_effect: 'NONE',
      command_is_local_only: isLocalOnlyCommand(command),
    }));
    const sourceBindings = track.covered_sources.map(source => ({
      ...source,
      source_sha256: sha256Text(sourceContents[source.path] ?? ''),
    }));
    const anchorChecks = track.anchor_checks.map(check => ({
      ...check,
      present: (sourceContents[check.path] ?? '').includes(check.anchor),
    }));
    return {
      item_id: track.item_id,
      title: track.title,
      source_status: 'source-bound-local-regression-track',
      terminal_state: 'COVERED_LOCALLY',
      plan_heading: track.plan_heading,
      plan_heading_present: planText.includes(track.plan_heading),
      product_risk: track.product_risk,
      covered_sources: sourceBindings,
      anchor_checks: anchorChecks,
      verification_commands: commands,
      local_only_boundary: {
        provider_prompt_sent: false,
        live_provider_run_performed: false,
        vsix_packaged_or_installed: false,
        window_or_browser_action_performed: false,
        qualification_ledger_written: false,
        gate0_or_r1_status_changed: false,
      },
      counts: {
        covered_sources: sourceBindings.length,
        anchor_checks: anchorChecks.length,
        anchors_present: anchorChecks.filter(check => check.present).length,
        verification_commands: commands.length,
        local_only_commands: commands.filter(command => command.command_is_local_only).length,
      },
    };
  });

  const manifest = {
    schema_version: POST_R4_LOCAL_REGRESSION_MANIFEST_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    manifest_id: POST_R4_LOCAL_REGRESSION_MANIFEST_ID,
    manifest_version: 1,
    source_status: 'generated-source-bound-local-regression-manifest',
    integrity_scope: POST_R4_LOCAL_REGRESSION_MANIFEST_SCOPE,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'PostR4LocalRegressionManifest',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
      qualification_ledger_writes: 'FORBIDDEN',
    },
    source_bindings: {
      post_r4_nonpermission_plan: sourceRef(PLAN_PATH, sourceContents),
      package_scripts: {
        ...sourceRef(PACKAGE_PATH, sourceContents),
        required_script: 'verify:post-r4-local-regression-manifest',
        required_script_present: packageScriptPresent,
      },
      phase_gate_source: {
        ...sourceRef(PHASE_GATE_PATH, sourceContents),
        required_gate: 'post-r4-local-regression-manifest',
        required_gate_present: phaseGatePresent,
      },
      checker_source: sourceRef(CHECKER_PATH, sourceContents),
      oracle_source: sourceRef(ORACLE_PATH, sourceContents),
    },
    regression_scope: {
      covered_nonpermission_items: tracks.map(track => track.item_id),
      local_only_product_regression: true,
      local_process_manifest_only: true,
      provider_or_window_actions_performed: false,
      live_rerun_performed: false,
      qualification_ledger_writes: false,
      gate0_status: 'NOT_PASSED',
      r1_qualification_status: 'NOT_STARTED',
    },
    regression_tracks: tracks,
    counts: {
      regression_tracks: tracks.length,
      covered_nonpermission_items: tracks.length,
      covered_sources: sum(tracks.map(track => track.counts.covered_sources)),
      anchor_checks: sum(tracks.map(track => track.counts.anchor_checks)),
      anchors_present: sum(tracks.map(track => track.counts.anchors_present)),
      verification_commands: sum(tracks.map(track => track.counts.verification_commands)),
      local_only_commands: sum(tracks.map(track => track.counts.local_only_commands)),
      live_provider_runs: 0,
      install_or_window_actions: 0,
      qualification_claims: 0,
      gate_pass_assertions: 0,
      bypasses: 0,
    },
    manifest_sha256: null,
  };
  manifest.manifest_sha256 = postR4LocalRegressionManifestHash(manifest);
  return manifest;
}

export function validatePostR4LocalRegressionManifest(
  manifest,
  { repoRoot = process.cwd(), sources = null } = {},
) {
  const errors = [];
  if (!isObject(manifest)) {
    return {
      ok: false,
      errors: ['manifest:expected-object'],
      summary: null,
    };
  }
  semanticValidate(manifest, errors);

  let expected = null;
  try {
    expected = buildPostR4LocalRegressionManifest({ repoRoot, sources });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }
  if (expected && canonicalJson(manifest) !== canonicalJson(expected)) {
    errors.push('manifest:expected-current-post-r4-local-regression-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizePostR4LocalRegressionManifest(expected) : null,
  };
}

export function renderPostR4LocalRegressionManifestMarkdown(manifest) {
  const trackRows = manifest.regression_tracks.map(track => (
    `| \`${track.item_id}\` | ${track.title} | \`${track.terminal_state}\` | ${track.counts.anchor_checks}/${track.counts.anchors_present} | ${track.verification_commands.length} |`
  ));
  const commandRows = manifest.regression_tracks.flatMap(track => (
    track.verification_commands.map(command => (
      `| \`${track.item_id}\` | \`${command.command}\` | \`${command.execution_scope}\` | \`${command.command_is_local_only}\` |`
    ))
  ));
  const sourceRows = manifest.regression_tracks.flatMap(track => (
    track.covered_sources.map(source => (
      `| \`${track.item_id}\` | \`${source.path}\` | ${source.role} | \`${source.source_sha256}\` |`
    ))
  ));
  const anchorRows = manifest.regression_tracks.flatMap(track => (
    track.anchor_checks.map(check => (
      `| \`${track.item_id}\` | \`${check.path}\` | ${check.category} | \`${check.present}\` |`
    ))
  ));

  return [
    '# DevSeek Post-R4 本地回归 Manifest',
    '',
    '## 摘要',
    '',
    `- Manifest ID: \`${manifest.manifest_id}\``,
    `- Source status: \`${manifest.source_status}\``,
    `- Qualification effect: \`${manifest.qualification_effect}\``,
    `- Claims permitted: \`${manifest.claims_permitted}\``,
    `- Gate assertion: \`${manifest.asserts_gate_pass}\``,
    `- Covered NP items: \`${manifest.regression_scope.covered_nonpermission_items.join(', ')}\``,
    `- Anchor coverage: \`${manifest.counts.anchors_present}/${manifest.counts.anchor_checks}\``,
    `- Local commands: \`${manifest.counts.local_only_commands}/${manifest.counts.verification_commands}\``,
    '',
    '## 资格边界',
    '',
    `- Provider/window actions performed: \`${manifest.regression_scope.provider_or_window_actions_performed}\``,
    `- Live rerun performed: \`${manifest.regression_scope.live_rerun_performed}\``,
    `- Qualification ledger writes: \`${manifest.regression_scope.qualification_ledger_writes}\``,
    `- Gate0: \`${manifest.regression_scope.gate0_status}\``,
    `- R1 qualification: \`${manifest.regression_scope.r1_qualification_status}\``,
    '',
    '## Track 覆盖',
    '',
    '| Item | Title | State | Anchors | Commands |',
    '| --- | --- | --- | ---: | ---: |',
    ...trackRows,
    '',
    '## 本地命令',
    '',
    '| Item | Command | Scope | Local only |',
    '| --- | --- | --- | --- |',
    ...commandRows,
    '',
    '## Source Bindings',
    '',
    '| Item | Path | Role | SHA-256 |',
    '| --- | --- | --- | --- |',
    ...sourceRows,
    '',
    '## Anchor Checks',
    '',
    '| Item | Path | Category | Present |',
    '| --- | --- | --- | --- |',
    ...anchorRows,
    '',
    '## Manifest Identity',
    '',
    `- Manifest SHA-256: \`${manifest.manifest_sha256}\``,
    '',
  ].join('\n');
}

export function postR4LocalRegressionManifestHash(manifest) {
  return sha256Object(withoutKeys(manifest, ['manifest_sha256']), manifest?.integrity);
}

export function summarizePostR4LocalRegressionManifest(manifest) {
  return {
    manifest_sha256: manifest.manifest_sha256,
    regression_tracks: manifest.counts.regression_tracks,
    covered_nonpermission_items: manifest.regression_scope.covered_nonpermission_items,
    covered_sources: manifest.counts.covered_sources,
    anchor_checks: manifest.counts.anchor_checks,
    anchors_present: manifest.counts.anchors_present,
    verification_commands: manifest.counts.verification_commands,
    local_only_commands: manifest.counts.local_only_commands,
    live_provider_runs: manifest.counts.live_provider_runs,
    install_or_window_actions: manifest.counts.install_or_window_actions,
    qualification_claims: manifest.counts.qualification_claims,
    qualification_effect: manifest.qualification_effect,
    claims_permitted: manifest.claims_permitted,
    asserts_gate_pass: manifest.asserts_gate_pass,
  };
}

function semanticValidate(manifest, errors) {
  if (manifest.schema_version !== POST_R4_LOCAL_REGRESSION_MANIFEST_SCHEMA_VERSION) {
    errors.push('schema_version:invalid');
  }
  if (manifest.manifest_id !== POST_R4_LOCAL_REGRESSION_MANIFEST_ID) errors.push('manifest_id:invalid');
  if (manifest.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (manifest.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (manifest.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (manifest.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (manifest.observation_authority?.provider_actions !== 'FORBIDDEN') {
    errors.push('observation_authority.provider_actions:must-be-FORBIDDEN');
  }
  if (manifest.observation_authority?.install_or_window_actions !== 'FORBIDDEN') {
    errors.push('observation_authority.install_or_window_actions:must-be-FORBIDDEN');
  }
  if (manifest.observation_authority?.qualification_ledger_writes !== 'FORBIDDEN') {
    errors.push('observation_authority.qualification_ledger_writes:must-be-FORBIDDEN');
  }
  if (manifest.source_bindings?.package_scripts?.required_script_present !== true) {
    errors.push('source_bindings.package_scripts.required_script_present:must-be-true');
  }
  if (manifest.source_bindings?.phase_gate_source?.required_gate_present !== true) {
    errors.push('source_bindings.phase_gate_source.required_gate_present:must-be-true');
  }
  if (manifest.regression_scope?.provider_or_window_actions_performed !== false) {
    errors.push('regression_scope.provider_or_window_actions_performed:must-be-false');
  }
  if (manifest.regression_scope?.live_rerun_performed !== false) {
    errors.push('regression_scope.live_rerun_performed:must-be-false');
  }
  if (manifest.regression_scope?.qualification_ledger_writes !== false) {
    errors.push('regression_scope.qualification_ledger_writes:must-be-false');
  }
  if (manifest.regression_scope?.gate0_status !== 'NOT_PASSED') {
    errors.push('regression_scope.gate0_status:must-be-NOT_PASSED');
  }
  if (manifest.regression_scope?.r1_qualification_status !== 'NOT_STARTED') {
    errors.push('regression_scope.r1_qualification_status:must-be-NOT_STARTED');
  }

  const tracks = Array.isArray(manifest.regression_tracks) ? manifest.regression_tracks : [];
  const expectedIds = REGRESSION_TRACKS.map(track => track.item_id);
  if (canonicalJson(tracks.map(track => track.item_id)) !== canonicalJson(expectedIds)) {
    errors.push('regression_tracks:item-order-must-be-NP-05-NP-06-NP-07');
  }
  for (const [index, track] of tracks.entries()) {
    const label = `regression_tracks[${index}]`;
    if (track.source_status !== 'source-bound-local-regression-track') {
      errors.push(`${label}.source_status:invalid`);
    }
    if (track.terminal_state !== 'COVERED_LOCALLY') {
      errors.push(`${label}.terminal_state:must-be-COVERED_LOCALLY`);
    }
    if (track.plan_heading_present !== true) {
      errors.push(`${label}.plan_heading_present:must-be-true`);
    }
    const anchorChecks = Array.isArray(track.anchor_checks) ? track.anchor_checks : [];
    for (const [anchorIndex, check] of anchorChecks.entries()) {
      if (check.present !== true) errors.push(`${label}.anchor_checks[${anchorIndex}].present:must-be-true`);
    }
    const commands = Array.isArray(track.verification_commands) ? track.verification_commands : [];
    for (const [commandIndex, command] of commands.entries()) {
      if (command.live_provider_actions !== 'FORBIDDEN') {
        errors.push(`${label}.verification_commands[${commandIndex}].live_provider_actions:must-be-FORBIDDEN`);
      }
      if (command.install_or_window_actions !== 'FORBIDDEN') {
        errors.push(`${label}.verification_commands[${commandIndex}].install_or_window_actions:must-be-FORBIDDEN`);
      }
      if (command.qualification_effect !== 'NONE') {
        errors.push(`${label}.verification_commands[${commandIndex}].qualification_effect:must-be-NONE`);
      }
      if (command.command_is_local_only !== true || !isLocalOnlyCommand(command.command)) {
        errors.push(`${label}.verification_commands[${commandIndex}].command:must-be-local-only`);
      }
    }
    if (track.counts?.anchor_checks !== anchorChecks.length) errors.push(`${label}.counts.anchor_checks:invalid`);
    if (track.counts?.anchors_present !== anchorChecks.filter(check => check.present === true).length) {
      errors.push(`${label}.counts.anchors_present:invalid`);
    }
    if (track.counts?.verification_commands !== commands.length) {
      errors.push(`${label}.counts.verification_commands:invalid`);
    }
    if (track.counts?.local_only_commands !== commands.filter(command => command.command_is_local_only === true).length) {
      errors.push(`${label}.counts.local_only_commands:invalid`);
    }
  }
  if (manifest.counts?.regression_tracks !== tracks.length) errors.push('counts.regression_tracks:invalid');
  if (manifest.counts?.anchor_checks !== sum(tracks.map(track => track.counts?.anchor_checks ?? 0))) {
    errors.push('counts.anchor_checks:invalid');
  }
  if (manifest.counts?.anchors_present !== manifest.counts?.anchor_checks) {
    errors.push('counts.anchors_present:must-equal-anchor_checks');
  }
  if (manifest.counts?.verification_commands !== sum(tracks.map(track => track.counts?.verification_commands ?? 0))) {
    errors.push('counts.verification_commands:invalid');
  }
  if (manifest.counts?.local_only_commands !== manifest.counts?.verification_commands) {
    errors.push('counts.local_only_commands:must-equal-verification_commands');
  }
  if (manifest.counts?.live_provider_runs !== 0) errors.push('counts.live_provider_runs:must-be-0');
  if (manifest.counts?.install_or_window_actions !== 0) errors.push('counts.install_or_window_actions:must-be-0');
  if (manifest.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  if (manifest.counts?.gate_pass_assertions !== 0) errors.push('counts.gate_pass_assertions:must-be-0');
  if (manifest.counts?.bypasses !== 0) errors.push('counts.bypasses:must-be-0');
  if (manifest.manifest_sha256 !== postR4LocalRegressionManifestHash(manifest)) {
    errors.push('manifest_sha256:mismatch');
  }
}

function isLocalOnlyCommand(command) {
  const value = String(command || '');
  if (!/^node packages\/vscode-extension\/test\/unit\/[A-Za-z0-9_.-]+\.test\.mjs$/.test(value)) return false;
  return !/(?:real-deepseek|--real|extension:package|package-vsix|vsix|install|uninstall|playwright|headed|browser|deepseek-web|agent-loop-eval:real)/i.test(value);
}

function sourceRef(sourcePath, sourceContents) {
  return {
    path: sourcePath,
    source_sha256: sha256Text(sourceContents[sourcePath] ?? ''),
  };
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function withoutKeys(value, keys) {
  const clone = structuredClone(value);
  for (const key of keys) delete clone[key];
  return clone;
}

function unique(items) {
  return [...new Set(items)];
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
