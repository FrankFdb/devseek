import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  readJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';
import {
  buildCurrentCandidateIdentity,
  currentCandidateIdentityHash,
  observeBridgeRuntimeProcesses,
  validateLiveRuntimeProcesses,
} from './devseek-current-candidate-identity.mjs';

export const R4_CLEAN_RUNTIME_LIMITED_OBSERVATION_SCHEMA_VERSION = 'devseek.r4-clean-runtime-limited-observation/v1';
export const R4_CLEAN_RUNTIME_LIMITED_OBSERVATION_ID = 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME-LIMITED-OBSERVATION/v1';
export const R4_CLEAN_RUNTIME_LIMITED_OBSERVATION_SCOPE = 'local-r4-clean-runtime-limited-observation';

const AUTHORIZATION_GUIDE = 'docs/process/devseek-r4-authorization-and-permission-guide.md';
const CURRENT_IDENTITY = 'docs/process/devseek-current-candidate-identity.json';
const RELEASE_MANIFEST = 'docs/process/devseek-r4-release-candidate-manifest.json';
const DOC_RECONCILIATION = 'docs/process/devseek-r4-doc-process-identity-reconciliation.json';
const LIVE_REQUEST_PACKET = 'docs/process/devseek-r4-live-qualification-request-packet.json';
const R4_ROLLUP = 'docs/process/devseek-r4-iteration-status-rollup.json';
const CURRENT_IDENTITY_SCRIPT = 'scripts/devseek-current-candidate-identity-check.mjs';

export function r4CleanRuntimeLimitedObservationHash(report) {
  return sha256Object(withoutKeys(report, ['observation_sha256']), report?.integrity);
}

export function buildR4CleanRuntimeLimitedObservation({ repoRoot, homeDir } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const trackedIdentity = readJson(path.join(repoRoot, CURRENT_IDENTITY));
  const releaseManifest = readJson(path.join(repoRoot, RELEASE_MANIFEST));
  const docReconciliation = readJson(path.join(repoRoot, DOC_RECONCILIATION));
  const liveRequestPacket = readJson(path.join(repoRoot, LIVE_REQUEST_PACKET));
  const r4Rollup = readJson(path.join(repoRoot, R4_ROLLUP));
  const expectedIdentity = buildCurrentCandidateIdentity({ repoRoot, homeDir });
  const liveRuntimeResult = validateLiveRuntimeProcesses(expectedIdentity, observeBridgeRuntimeProcesses());
  const trackedIdentityMatchesExpected = canonicalJson(trackedIdentity) === canonicalJson(expectedIdentity);
  const expectedMatchesReleaseCandidate = expectedIdentity.source_identity.candidate_source_commit
    === releaseManifest.source_identity.artifact_source_commit;
  const cleanRuntimeIdentityEstablished = trackedIdentityMatchesExpected
    && expectedMatchesReleaseCandidate
    && liveRuntimeResult.ok;
  const blockers = buildBlockers({
    trackedIdentityMatchesExpected,
    expectedMatchesReleaseCandidate,
    liveRuntimeResult,
  });
  const terminalState = cleanRuntimeIdentityEstablished ? 'COMPLETED' : 'BLOCKED';

  const report = {
    schema_version: R4_CLEAN_RUNTIME_LIMITED_OBSERVATION_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    observation_id: R4_CLEAN_RUNTIME_LIMITED_OBSERVATION_ID,
    observation_version: 1,
    source_status: 'generated-limited-runtime-observation-only',
    integrity_scope: R4_CLEAN_RUNTIME_LIMITED_OBSERVATION_SCOPE,
    current_leaf: 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME',
    terminal_state: terminalState,
    clean_runtime_identity_established: cleanRuntimeIdentityEstablished,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'R4CleanRuntimeLimitedObservation',
      writes_product_state: false,
      runtime_process_observation: 'LIMITED_READ_ONLY',
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_bindings: {
      authorization_guide: sourceBinding(repoRoot, AUTHORIZATION_GUIDE),
      tracked_current_candidate_identity: sourceBinding(repoRoot, CURRENT_IDENTITY, {
        tracked_identity_probe_sha256: trackedIdentity.identity_probe_sha256,
        tracked_artifact_git_commit: trackedIdentity.source_identity.artifact_git_commit,
        tracked_observe_status: trackedIdentity.release_state.observe.status,
      }),
      release_candidate_manifest: sourceBinding(repoRoot, RELEASE_MANIFEST, {
        manifest_sha256: releaseManifest.manifest_sha256,
        artifact_source_commit: releaseManifest.source_identity.artifact_source_commit,
        vsix_sha256: releaseManifest.artifact_identity.primary_vsix.sha256,
      }),
      doc_process_identity_reconciliation: sourceBinding(repoRoot, DOC_RECONCILIATION, {
        reconciliation_sha256: docReconciliation.reconciliation_sha256,
        current_candidate_identity_status: docReconciliation.conclusions.current_candidate_identity_status,
      }),
      live_qualification_request_packet: sourceBinding(repoRoot, LIVE_REQUEST_PACKET, {
        packet_sha256: liveRequestPacket.packet_sha256,
        live_runs_authorized: liveRequestPacket.counts.live_runs_authorized,
      }),
      r4_iteration_status_rollup: sourceBinding(repoRoot, R4_ROLLUP, {
        rollup_sha256: r4Rollup.rollup_sha256,
        clean_runtime_leaf_terminal_state: r4Rollup.r4_scope.clean_runtime_leaf_terminal_state,
      }),
      current_candidate_identity_checker: sourceBinding(repoRoot, CURRENT_IDENTITY_SCRIPT),
    },
    expected_candidate_identity: {
      identity_probe_sha256: currentCandidateIdentityHash(expectedIdentity),
      artifact_git_commit: expectedIdentity.source_identity.artifact_git_commit,
      candidate_source_commit: expectedIdentity.source_identity.candidate_source_commit,
      vsix_sha256: expectedIdentity.artifact_identity.primary_vsix.sha256,
      build_id: expectedIdentity.artifact_identity.primary_vsix.package_identity.devseekBuild.buildId,
      build_git_commit: expectedIdentity.artifact_identity.primary_vsix.package_identity.devseekBuild.gitCommit,
      stable_install_package_root: expectedIdentity.stable_install_identity.package_root,
      expected_bridge_server_path: expectedIdentity.active_runtime_identity.expected_bridge_server_path,
      package_install_runtime_exact_match: expectedIdentity.artifact_identity.exact_match
        && expectedIdentity.stable_install_identity.exact_match_artifact
        && expectedIdentity.active_runtime_identity.exact_match_stable_install,
      matches_release_candidate_manifest: expectedMatchesReleaseCandidate,
    },
    tracked_registry_comparison: {
      tracked_identity_probe_sha256: trackedIdentity.identity_probe_sha256,
      tracked_artifact_git_commit: trackedIdentity.source_identity.artifact_git_commit,
      tracked_candidate_source_commit: trackedIdentity.source_identity.candidate_source_commit,
      tracked_vsix_sha256: trackedIdentity.artifact_identity.primary_vsix.sha256,
      tracked_observe_status: trackedIdentity.release_state.observe.status,
      tracked_matches_expected_identity: trackedIdentityMatchesExpected,
    },
    live_runtime_observation: {
      stable_runtime_count: liveRuntimeResult.summary.stable_runtime_count,
      isolated_controlled_vsix_runtime_count: liveRuntimeResult.summary.isolated_controlled_vsix_runtime_count,
      stale_debug_runtime_count: liveRuntimeResult.summary.stale_debug_runtime_count,
      unknown_devseek_bridge_runtime_count: liveRuntimeResult.summary.unknown_devseek_bridge_runtime_count,
      unreadable_runtime_identity_count: liveRuntimeResult.summary.unreadable_runtime_identity_count,
      stable_runtime: liveRuntimeResult.summary.stable_runtime,
      isolated_controlled_vsix_runtime: liveRuntimeResult.summary.isolated_controlled_vsix_runtime,
      stale_debug_runtime: liveRuntimeResult.summary.stale_debug_runtime,
      unknown_devseek_bridge_runtime: liveRuntimeResult.summary.unknown_devseek_bridge_runtime,
      live_runtime_policy_ok: liveRuntimeResult.ok,
      live_runtime_errors: liveRuntimeResult.errors,
      full_commandline_recorded: false,
      environment_variables_recorded: false,
      secrets_recorded: false,
      provider_account_observed: false,
      network_or_live_holdout_observed: false,
    },
    blockers,
    next_required_authority: [
      'explicit-user-window-action-authorization-for-extension-activation-or-runtime-isolation',
      'or-external-clean-candidate-identity-receipt',
    ],
    counts: {
      blockers: blockers.length,
      stable_runtime_count: liveRuntimeResult.summary.stable_runtime_count,
      live_runs_authorized: 0,
      qualification_claims: 0,
    },
    observation_sha256: '',
  };

  report.observation_sha256 = r4CleanRuntimeLimitedObservationHash(report);
  return report;
}

export function validateR4CleanRuntimeLimitedObservation(report, { repoRoot, homeDir } = {}) {
  const errors = [];
  if (!isObject(report)) {
    return {
      ok: false,
      errors: ['observation:expected-object'],
      summary: null,
    };
  }

  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildR4CleanRuntimeLimitedObservation({ repoRoot, homeDir });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(report) !== canonicalJson(expected)) {
    errors.push('observation:expected-current-clean-runtime-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeR4CleanRuntimeLimitedObservation(expected) : null,
  };
}

export function renderR4CleanRuntimeLimitedObservationMarkdown(report) {
  const lines = [
    '# DevSeek R4 Clean Runtime 受限观察报告',
    '',
    '## 摘要',
    '',
    `- Observation ID: \`${report.observation_id}\``,
    `- Current leaf: \`${report.current_leaf}\``,
    `- Terminal state: \`${report.terminal_state}\``,
    `- Clean runtime identity established: \`${report.clean_runtime_identity_established}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${report.claims_permitted}\``,
    `- Gate assertion: \`${report.asserts_gate_pass}\``,
    '',
    '## 授权边界',
    '',
    `- Runtime process observation: \`${report.observation_authority.runtime_process_observation}\``,
    `- Provider actions: \`${report.observation_authority.provider_actions}\``,
    `- Live holdout actions: \`${report.observation_authority.live_holdout_actions}\``,
    `- Install/window actions: \`${report.observation_authority.install_or_window_actions}\``,
    `- Secret observation: \`${report.observation_authority.secret_observation}\``,
    '',
    '## 候选身份',
    '',
    `- Expected candidate source commit: \`${report.expected_candidate_identity.candidate_source_commit}\``,
    `- Expected VSIX SHA-256: \`${report.expected_candidate_identity.vsix_sha256}\``,
    `- Expected bridge path: \`${report.expected_candidate_identity.expected_bridge_server_path}\``,
    `- Matches release candidate manifest: \`${report.expected_candidate_identity.matches_release_candidate_manifest}\``,
    '',
    '## Tracked Registry 对比',
    '',
    `- Tracked artifact git commit: \`${report.tracked_registry_comparison.tracked_artifact_git_commit}\``,
    `- Tracked observe status: \`${report.tracked_registry_comparison.tracked_observe_status}\``,
    `- Tracked matches expected identity: \`${report.tracked_registry_comparison.tracked_matches_expected_identity}\``,
    '',
    '## Runtime 观察',
    '',
    `- Stable runtime count: \`${report.live_runtime_observation.stable_runtime_count}\``,
    `- Isolated controlled VSIX runtime count: \`${report.live_runtime_observation.isolated_controlled_vsix_runtime_count}\``,
    `- Stale debug runtime count: \`${report.live_runtime_observation.stale_debug_runtime_count}\``,
    `- Unknown DevSeek bridge runtime count: \`${report.live_runtime_observation.unknown_devseek_bridge_runtime_count}\``,
    `- Unreadable runtime identity count: \`${report.live_runtime_observation.unreadable_runtime_identity_count}\``,
    `- Live runtime policy ok: \`${report.live_runtime_observation.live_runtime_policy_ok}\``,
    '',
    '## Blockers',
    '',
    ...report.blockers.map(blocker => `- \`${blocker}\``),
    '',
    '## 下一授权',
    '',
    ...report.next_required_authority.map(authority => `- \`${authority}\``),
    '',
    '## Observation Identity',
    '',
    `- Observation SHA-256: \`${report.observation_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeR4CleanRuntimeLimitedObservation(report) {
  return {
    observation_sha256: report.observation_sha256,
    terminal_state: report.terminal_state,
    clean_runtime_identity_established: report.clean_runtime_identity_established,
    expected_candidate_source_commit: report.expected_candidate_identity.candidate_source_commit,
    expected_vsix_sha256: report.expected_candidate_identity.vsix_sha256,
    tracked_matches_expected_identity: report.tracked_registry_comparison.tracked_matches_expected_identity,
    stable_runtime_count: report.live_runtime_observation.stable_runtime_count,
    blockers: report.counts.blockers,
    live_runs_authorized: report.counts.live_runs_authorized,
    qualification_effect: report.qualification_effect,
    claims_permitted: report.claims_permitted,
    asserts_gate_pass: report.asserts_gate_pass,
  };
}

function buildBlockers({
  trackedIdentityMatchesExpected,
  expectedMatchesReleaseCandidate,
  liveRuntimeResult,
}) {
  const blockers = [];
  if (!trackedIdentityMatchesExpected) {
    blockers.push('current-candidate-identity-registry-stale-or-not-refreshed');
  }
  if (!expectedMatchesReleaseCandidate) {
    blockers.push('expected-candidate-identity-does-not-match-release-candidate-manifest');
  }
  blockers.push(...liveRuntimeResult.errors);
  if (!liveRuntimeResult.ok) {
    blockers.push('clean-runtime-requires-window-action-authorization-or-external-clean-candidate-identity-receipt');
  }
  return [...new Set(blockers)];
}

function semanticValidate(report, errors) {
  if (report.schema_version !== R4_CLEAN_RUNTIME_LIMITED_OBSERVATION_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (report.observation_id !== R4_CLEAN_RUNTIME_LIMITED_OBSERVATION_ID) errors.push('observation_id:invalid');
  if (report.observation_version !== 1) errors.push('observation_version:must-be-1');
  if (report.source_status !== 'generated-limited-runtime-observation-only') errors.push('source_status:invalid');
  if (report.integrity_scope !== R4_CLEAN_RUNTIME_LIMITED_OBSERVATION_SCOPE) errors.push('integrity_scope:invalid');
  if (report.current_leaf !== 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME') errors.push('current_leaf:invalid');
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (report.observation_authority?.semantic_authority !== 'R4CleanRuntimeLimitedObservation') {
    errors.push('observation_authority.semantic_authority:invalid');
  }
  if (report.observation_authority?.writes_product_state !== false) {
    errors.push('observation_authority.writes_product_state:must-be-false');
  }
  if (report.observation_authority?.runtime_process_observation !== 'LIMITED_READ_ONLY') {
    errors.push('observation_authority.runtime_process_observation:must-be-LIMITED_READ_ONLY');
  }
  for (const field of ['provider_actions', 'live_holdout_actions', 'install_or_window_actions', 'secret_observation']) {
    if (report.observation_authority?.[field] !== 'FORBIDDEN') {
      errors.push(`observation_authority.${field}:must-be-FORBIDDEN`);
    }
  }
  if (report.clean_runtime_identity_established === true && report.terminal_state !== 'COMPLETED') {
    errors.push('terminal_state:must-be-COMPLETED-when-clean-runtime-established');
  }
  if (report.clean_runtime_identity_established === false && report.terminal_state !== 'BLOCKED') {
    errors.push('terminal_state:must-be-BLOCKED-when-clean-runtime-not-established');
  }
  if (report.terminal_state === 'BLOCKED' && (report.blockers ?? []).length === 0) {
    errors.push('blockers:required-when-blocked');
  }
  if (report.terminal_state === 'COMPLETED' && (report.blockers ?? []).length !== 0) {
    errors.push('blockers:must-be-empty-when-completed');
  }
  if (report.expected_candidate_identity?.matches_release_candidate_manifest !== true) {
    errors.push('expected_candidate_identity.matches_release_candidate_manifest:must-be-true');
  }
  if (report.live_runtime_observation?.full_commandline_recorded !== false
    || report.live_runtime_observation?.environment_variables_recorded !== false
    || report.live_runtime_observation?.secrets_recorded !== false
    || report.live_runtime_observation?.provider_account_observed !== false
    || report.live_runtime_observation?.network_or_live_holdout_observed !== false) {
    errors.push('live_runtime_observation:forbidden-secret-or-live-field-recorded');
  }
  if (report.counts?.blockers !== (report.blockers ?? []).length) errors.push('counts.blockers:invalid');
  if (report.counts?.stable_runtime_count !== report.live_runtime_observation?.stable_runtime_count) {
    errors.push('counts.stable_runtime_count:invalid');
  }
  if (report.counts?.live_runs_authorized !== 0) errors.push('counts.live_runs_authorized:must-be-0');
  if (report.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  const computedHash = r4CleanRuntimeLimitedObservationHash(report);
  if (!/^[a-f0-9]{64}$/u.test(report.observation_sha256 ?? '')) {
    errors.push('observation_sha256:invalid');
  } else if (report.observation_sha256 !== computedHash) {
    errors.push('observation_sha256:mismatch');
  }
}

function sourceBinding(repoRoot, relativePath, extra = {}) {
  return {
    path: relativePath,
    source_sha256: sha256File(path.join(repoRoot, relativePath)),
    ...extra,
  };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function withoutKeys(value, keys) {
  if (!isObject(value)) return value;
  const clone = {};
  for (const [key, child] of Object.entries(value)) {
    if (!keys.includes(key)) clone[key] = child;
  }
  return clone;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
