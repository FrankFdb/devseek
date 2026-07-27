import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  readJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';

export const R4_LIVE_QUALIFICATION_REQUEST_PACKET_SCHEMA_VERSION = 'devseek.r4-live-qualification-request-packet/v1';
export const R4_LIVE_QUALIFICATION_REQUEST_PACKET_ID = 'R4-LIVE-QUALIFICATION-REQUEST-PACKET/v1';
export const R4_LIVE_QUALIFICATION_REQUEST_PACKET_SCOPE = 'local-r4-live-qualification-request-packet';

const RELEASE_MANIFEST = 'docs/process/devseek-r4-release-candidate-manifest.json';
const DOC_PROCESS_RECONCILIATION = 'docs/process/devseek-r4-doc-process-identity-reconciliation.json';
const EXTERNAL_AUTHORITY_REQUESTS = 'docs/process/devseek-external-authority-requests.json';
const EXTERNAL_AUTHORITY_ADAPTER = 'docs/process/devseek-external-authority-adapter.json';
const GATE0_DECISION = 'docs/process/devseek-gate0-decision-report.json';
const MILESTONE_PROFILES = 'docs/process/devseek-milestone-profiles.json';
const QUALIFICATION_PROFILES = 'docs/process/devseek-qualification-profiles.json';
const QUALIFICATION_RUNNER_INVENTORY = 'docs/process/devseek-qualification-runner-inventory.json';

const REQUESTS = Object.freeze([
  {
    request_id: 'R4-LIVE-AUTH-01-USER-WINDOW-AUTHORIZATION/request-v1',
    atomic_id: 'R4-LIVE-AUTH-01-USER-WINDOW-AUTHORIZATION',
    decision_owner: 'human-user',
    requested_decision: 'Authorize a headed user-way DeepSeek live qualification attempt with keep-window and keep-deepseek-page terms.',
    blocker_reason: 'explicit-user-live-qualification-authorization-not-provided',
  },
  {
    request_id: 'R4-LIVE-AUTH-02-CLEAN-RUNTIME-CANDIDATE/request-v1',
    atomic_id: 'R4-LIVE-AUTH-02-CLEAN-RUNTIME-CANDIDATE',
    decision_owner: 'human-user-and-runtime-owner',
    requested_decision: 'Authorize clean runtime identity refresh or isolation for exactly-one stable DevSeek bridge runtime.',
    blocker_reason: 'clean-runtime-identity-authorization-not-provided',
  },
  {
    request_id: 'R4-LIVE-AUTH-03-HOLDOUT-PROFILE/request-v1',
    atomic_id: 'R4-LIVE-AUTH-03-HOLDOUT-PROFILE',
    decision_owner: 'qualification-profile-owner',
    requested_decision: 'Approve the DeepSeek headed user-way holdout profile, scenario language policy, retry budget, and failure taxonomy.',
    blocker_reason: 'protected-live-holdout-profile-not-approved',
  },
  {
    request_id: 'R4-LIVE-AUTH-04-TRUSTED-EVIDENCE/request-v1',
    atomic_id: 'R4-LIVE-AUTH-04-TRUSTED-EVIDENCE',
    decision_owner: 'external-evidence-authority',
    requested_decision: 'Provide trusted evidence manifest, nonrollback time, retention lock, and externally anchored stream head.',
    blocker_reason: 'trusted-live-evidence-manifest-not-provided',
  },
  {
    request_id: 'R4-LIVE-AUTH-05-QUALIFICATION-IMPORT/request-v1',
    atomic_id: 'R4-LIVE-AUTH-05-QUALIFICATION-IMPORT',
    decision_owner: 'independent-qualification-import-authority',
    requested_decision: 'Approve external import of live evidence into Gate0/R1 qualification after all protected prerequisites are satisfied.',
    blocker_reason: 'independent-qualification-import-decision-not-provided',
  },
]);

export function r4LiveQualificationRequestPacketHash(packet) {
  return sha256Object(withoutKeys(packet, ['packet_sha256']), packet?.integrity);
}

export function buildR4LiveQualificationRequestPacket({ repoRoot } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const releaseManifest = readJson(path.join(repoRoot, RELEASE_MANIFEST));
  const docProcessReconciliation = readJson(path.join(repoRoot, DOC_PROCESS_RECONCILIATION));
  const externalRequests = readJson(path.join(repoRoot, EXTERNAL_AUTHORITY_REQUESTS));
  const externalAdapter = readJson(path.join(repoRoot, EXTERNAL_AUTHORITY_ADAPTER));
  const gate0Decision = readJson(path.join(repoRoot, GATE0_DECISION));
  const milestoneProfiles = readJson(path.join(repoRoot, MILESTONE_PROFILES));
  const qualificationProfiles = readJson(path.join(repoRoot, QUALIFICATION_PROFILES));
  const runnerInventory = readJson(path.join(repoRoot, QUALIFICATION_RUNNER_INVENTORY));

  const r1Profile = milestoneProfiles.profiles.find(profile => profile.profile_id === 'R1-MINIMAL-SEAM/v1');
  const gate0ClaimProfile = milestoneProfiles.claim_profiles.find(profile => profile.profile_id === 'DEVSEEK-GATE0-INFRASTRUCTURE/v1');
  const localProtocolProfile = qualificationProfiles.profiles.find(profile => profile.profile_id === 'GATE0-G0B-LOCAL-PROTOCOL-CONFORMANCE/v1');

  const packet = {
    schema_version: R4_LIVE_QUALIFICATION_REQUEST_PACKET_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    packet_id: R4_LIVE_QUALIFICATION_REQUEST_PACKET_ID,
    packet_version: 1,
    source_status: 'generated-request-only',
    integrity_scope: R4_LIVE_QUALIFICATION_REQUEST_PACKET_SCOPE,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'R4LiveQualificationRequestPacket',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_bindings: {
      release_candidate_manifest: sourceBinding(repoRoot, RELEASE_MANIFEST, {
        manifest_sha256: releaseManifest.manifest_sha256,
        artifact_source_commit: releaseManifest.source_identity.artifact_source_commit,
        vsix_sha256: releaseManifest.artifact_identity.primary_vsix.sha256,
      }),
      doc_process_identity_reconciliation: sourceBinding(repoRoot, DOC_PROCESS_RECONCILIATION, {
        reconciliation_sha256: docProcessReconciliation.reconciliation_sha256,
        current_candidate_identity_status: docProcessReconciliation.conclusions.current_candidate_identity_status,
      }),
      external_authority_requests: sourceBinding(repoRoot, EXTERNAL_AUTHORITY_REQUESTS, {
        request_set_id: externalRequests.request_set_id,
        external_authority_blockers: externalRequests.gate0_current_state.external_authority_blockers,
      }),
      external_authority_adapter: sourceBinding(repoRoot, EXTERNAL_AUTHORITY_ADAPTER, {
        adapter_id: externalAdapter.adapter_id,
        source_status: externalAdapter.source_status,
        trust_roots: externalAdapter.trust_roots.length,
      }),
      gate0_decision: sourceBinding(repoRoot, GATE0_DECISION, {
        decision_id: gate0Decision.decision_id,
        status: gate0Decision.qualification.status,
        observed_claims: gate0Decision.claims.length,
      }),
      milestone_profiles: sourceBinding(repoRoot, MILESTONE_PROFILES, {
        r1_profile_id: r1Profile.profile_id,
        r1_profile_sha256: r1Profile.profile_sha256,
        gate0_claim_profile_sha256: gate0ClaimProfile.profile_sha256,
      }),
      qualification_profiles: sourceBinding(repoRoot, QUALIFICATION_PROFILES, {
        local_protocol_profile_id: localProtocolProfile.profile_id,
        qualification_eligible: qualificationProfiles.qualification_eligible,
      }),
      qualification_runner_inventory: sourceBinding(repoRoot, QUALIFICATION_RUNNER_INVENTORY, {
        qualification_enabled_entries: runnerInventory.entries.filter(entry => entry.qualification_enabled).length,
        production_qualification_enabled_entries: runnerInventory.entries.filter(entry => entry.classification === 'production' && entry.qualification_enabled).length,
      }),
    },
    candidate_scope: {
      release_candidate_manifest_sha256: releaseManifest.manifest_sha256,
      artifact_source_commit: releaseManifest.source_identity.artifact_source_commit,
      vsix_sha256: releaseManifest.artifact_identity.primary_vsix.sha256,
      current_candidate_identity_status: docProcessReconciliation.conclusions.current_candidate_identity_status,
      clean_runtime_identity_required: true,
      clean_runtime_identity_authority: 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME',
      repository_current_identity_may_substitute: false,
    },
    qualification_boundary: {
      gate0_status: gate0Decision.qualification.status,
      r1_qualification_status: 'NOT_STARTED',
      external_authority_blockers: externalRequests.gate0_current_state.external_authority_blockers,
      external_authority_trust_anchored: gate0Decision.qualification.external_authority_trust_anchored,
      claims_empty: gate0Decision.claims.length === 0,
      repository_may_decide: false,
      local_smoke_may_substitute: false,
      live_run_may_substitute: false,
      markdown_may_approve: false,
    },
    live_terms: {
      provider: 'deepseek-web',
      execution_mode: 'headed',
      keep_window: true,
      keep_deepseek_page: true,
      user_auth_required_before_live_run: true,
      close_or_reuse_existing_windows_without_user: false,
      secret_capture_allowed: false,
      repeat_red_loop_policy: 'analyze-report-log-paths-terminal-provider-quality-before-rerun',
      scenario_language_policy: 'language-comes-from-scenario-contract-not-product-default',
    },
    requests: REQUESTS.map(request => ({
      ...request,
      terminal_state: 'BLOCKED',
      required_before_qualification: true,
      repository_may_decide: false,
      qualification_effect: 'NONE',
      claims_permitted: false,
      asserts_gate_pass: false,
    })),
    counts: {
      requests: REQUESTS.length,
      blocked_requests: REQUESTS.length,
      approved_requests: 0,
      live_runs_authorized: 0,
      qualification_claims: 0,
    },
    packet_sha256: '',
  };

  packet.packet_sha256 = r4LiveQualificationRequestPacketHash(packet);
  return packet;
}

export function validateR4LiveQualificationRequestPacket(packet, { repoRoot } = {}) {
  const errors = [];
  if (!isObject(packet)) {
    return {
      ok: false,
      errors: ['packet:expected-object'],
      summary: null,
    };
  }

  semanticValidate(packet, errors);

  let expected = null;
  try {
    expected = buildR4LiveQualificationRequestPacket({ repoRoot });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(packet) !== canonicalJson(expected)) {
    errors.push('packet:expected-current-request-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeR4LiveQualificationRequestPacket(expected) : null,
  };
}

export function renderR4LiveQualificationRequestPacketMarkdown(packet) {
  const lines = [
    '# DevSeek R4 Live Qualification Request Packet',
    '',
    '## 摘要',
    '',
    `- Packet ID: \`${packet.packet_id}\``,
    `- Source status: \`${packet.source_status}\``,
    `- Qualification effect: \`${packet.qualification_effect}\``,
    `- Claims permitted: \`${packet.claims_permitted}\``,
    `- Gate assertion: \`${packet.asserts_gate_pass}\``,
    '',
    '## 候选与资格边界',
    '',
    `- Artifact source commit: \`${packet.candidate_scope.artifact_source_commit}\``,
    `- VSIX SHA-256: \`${packet.candidate_scope.vsix_sha256}\``,
    `- Current candidate identity: \`${packet.candidate_scope.current_candidate_identity_status}\``,
    `- Clean runtime identity required: \`${packet.candidate_scope.clean_runtime_identity_required}\``,
    `- Gate0: \`${packet.qualification_boundary.gate0_status}\``,
    `- R1 qualification: \`${packet.qualification_boundary.r1_qualification_status}\``,
    `- External authority blockers: \`${packet.qualification_boundary.external_authority_blockers}\``,
    '',
    '## Live 条款',
    '',
    `- Provider: \`${packet.live_terms.provider}\``,
    `- Execution mode: \`${packet.live_terms.execution_mode}\``,
    `- Keep window/page: \`${packet.live_terms.keep_window}/${packet.live_terms.keep_deepseek_page}\``,
    `- User auth required: \`${packet.live_terms.user_auth_required_before_live_run}\``,
    `- Scenario language policy: \`${packet.live_terms.scenario_language_policy}\``,
    `- Repeat red loop policy: \`${packet.live_terms.repeat_red_loop_policy}\``,
    '',
    '## 请求清单',
    '',
    '| Request | Owner | Terminal | Blocker |',
    '| --- | --- | --- | --- |',
    ...packet.requests.map(request => (
      `| \`${request.atomic_id}\` | \`${request.decision_owner}\` | \`${request.terminal_state}\` | ${request.blocker_reason} |`
    )),
    '',
    '## Source Bindings',
    '',
    '| Source | SHA-256 |',
    '| --- | --- |',
    ...Object.entries(packet.source_bindings).map(([sourceId, binding]) => (
      `| \`${sourceId}: ${binding.path}\` | \`${binding.source_sha256}\` |`
    )),
    '',
    '## Packet Identity',
    '',
    `- Packet SHA-256: \`${packet.packet_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeR4LiveQualificationRequestPacket(packet) {
  return {
    packet_sha256: packet.packet_sha256,
    artifact_source_commit: packet.candidate_scope.artifact_source_commit,
    vsix_sha256: packet.candidate_scope.vsix_sha256,
    current_candidate_identity_status: packet.candidate_scope.current_candidate_identity_status,
    gate0_status: packet.qualification_boundary.gate0_status,
    r1_qualification_status: packet.qualification_boundary.r1_qualification_status,
    external_authority_blockers: packet.qualification_boundary.external_authority_blockers,
    requests: packet.requests.length,
    blocked_requests: packet.counts.blocked_requests,
    live_runs_authorized: packet.counts.live_runs_authorized,
    qualification_effect: packet.qualification_effect,
    claims_permitted: packet.claims_permitted,
    asserts_gate_pass: packet.asserts_gate_pass,
  };
}

function semanticValidate(packet, errors) {
  if (packet.schema_version !== R4_LIVE_QUALIFICATION_REQUEST_PACKET_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (packet.packet_id !== R4_LIVE_QUALIFICATION_REQUEST_PACKET_ID) errors.push('packet_id:invalid');
  if (packet.packet_version !== 1) errors.push('packet_version:must-be-1');
  if (packet.source_status !== 'generated-request-only') errors.push('source_status:invalid');
  if (packet.integrity_scope !== R4_LIVE_QUALIFICATION_REQUEST_PACKET_SCOPE) errors.push('integrity_scope:invalid');
  if (packet.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (packet.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (packet.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (packet.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (packet.observation_authority?.semantic_authority !== 'R4LiveQualificationRequestPacket') {
    errors.push('observation_authority.semantic_authority:invalid');
  }
  if (packet.observation_authority?.writes_product_state !== false) {
    errors.push('observation_authority.writes_product_state:must-be-false');
  }
  for (const field of ['provider_actions', 'live_holdout_actions', 'runtime_process_observation', 'install_or_window_actions', 'secret_observation']) {
    if (packet.observation_authority?.[field] !== 'FORBIDDEN') {
      errors.push(`observation_authority.${field}:must-be-FORBIDDEN`);
    }
  }
  if (packet.candidate_scope?.clean_runtime_identity_required !== true) errors.push('candidate_scope.clean_runtime_identity_required:must-be-true');
  if (![
    'deferred-unusable-until-clean-runtime',
    'clean-runtime-identity-established',
  ].includes(packet.candidate_scope?.current_candidate_identity_status)) {
    errors.push('candidate_scope.current_candidate_identity_status:invalid');
  }
  if (packet.candidate_scope?.repository_current_identity_may_substitute !== false) errors.push('candidate_scope.repository_current_identity_may_substitute:must-be-false');
  if (packet.qualification_boundary?.gate0_status !== 'NOT_PASSED') errors.push('qualification_boundary.gate0_status:must-be-NOT_PASSED');
  if (packet.qualification_boundary?.r1_qualification_status !== 'NOT_STARTED') errors.push('qualification_boundary.r1_qualification_status:must-be-NOT_STARTED');
  if (packet.qualification_boundary?.external_authority_trust_anchored !== false) errors.push('qualification_boundary.external_authority_trust_anchored:must-be-false');
  if (packet.qualification_boundary?.claims_empty !== true) errors.push('qualification_boundary.claims_empty:must-be-true');
  for (const field of ['repository_may_decide', 'local_smoke_may_substitute', 'live_run_may_substitute', 'markdown_may_approve']) {
    if (packet.qualification_boundary?.[field] !== false) {
      errors.push(`qualification_boundary.${field}:must-be-false`);
    }
  }
  if (packet.live_terms?.execution_mode !== 'headed') errors.push('live_terms.execution_mode:must-be-headed');
  if (packet.live_terms?.keep_window !== true || packet.live_terms?.keep_deepseek_page !== true) {
    errors.push('live_terms.keep_window_page:must-be-true');
  }
  if (packet.live_terms?.user_auth_required_before_live_run !== true) {
    errors.push('live_terms.user_auth_required_before_live_run:must-be-true');
  }
  if (packet.live_terms?.secret_capture_allowed !== false) errors.push('live_terms.secret_capture_allowed:must-be-false');
  for (const request of packet.requests ?? []) {
    if (request.terminal_state !== 'BLOCKED') errors.push(`requests.${request.atomic_id}.terminal_state:must-be-BLOCKED`);
    if (request.repository_may_decide !== false) errors.push(`requests.${request.atomic_id}.repository_may_decide:must-be-false`);
    if (request.qualification_effect !== 'NONE') errors.push(`requests.${request.atomic_id}.qualification_effect:must-be-NONE`);
    if (request.claims_permitted !== false) errors.push(`requests.${request.atomic_id}.claims_permitted:must-be-false`);
    if (request.asserts_gate_pass !== false) errors.push(`requests.${request.atomic_id}.asserts_gate_pass:must-be-false`);
  }
  if (packet.counts?.requests !== REQUESTS.length) errors.push('counts.requests:invalid');
  if (packet.counts?.blocked_requests !== REQUESTS.length) errors.push('counts.blocked_requests:invalid');
  if (packet.counts?.approved_requests !== 0) errors.push('counts.approved_requests:must-be-0');
  if (packet.counts?.live_runs_authorized !== 0) errors.push('counts.live_runs_authorized:must-be-0');
  if (packet.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  const computedHash = r4LiveQualificationRequestPacketHash(packet);
  if (!/^[a-f0-9]{64}$/u.test(packet.packet_sha256 ?? '')) {
    errors.push('packet_sha256:invalid');
  } else if (packet.packet_sha256 !== computedHash) {
    errors.push('packet_sha256:mismatch');
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
