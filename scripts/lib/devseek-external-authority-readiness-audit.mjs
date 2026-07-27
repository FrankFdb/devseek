import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const EXTERNAL_AUTHORITY_READINESS_AUDIT_SCHEMA_VERSION =
  'devseek.external-authority-readiness-audit/v1';
export const EXTERNAL_AUTHORITY_READINESS_AUDIT_ID =
  'DEVSEEK-EXTERNAL-AUTHORITY-READINESS-AUDIT/v1';
export const EXTERNAL_AUTHORITY_READINESS_AUDIT_SCOPE =
  'local-external-authority-readiness-audit';
export const EXTERNAL_AUTHORITY_READINESS_AUDIT_PATH =
  'docs/process/devseek-external-authority-readiness-audit.json';
export const EXTERNAL_AUTHORITY_READINESS_AUDIT_VIEW_PATH =
  'docs/process/generated/devseek-external-authority-readiness-audit.md';

const TEXT_SOURCE_PATHS = Object.freeze([
  'docs/process/devseek-r4-authorization-and-permission-guide.md',
  'package.json',
  'scripts/devseek-phase0-12-verify.mjs',
  'scripts/devseek-external-authority-readiness-audit-check.mjs',
  'scripts/test/devseek-external-authority-readiness-audit.test.mjs',
]);

const JSON_SOURCE_PATHS = Object.freeze({
  externalAuthorityRequests: 'docs/process/devseek-external-authority-requests.json',
  liveQualificationRequestPacket: 'docs/process/devseek-r4-live-qualification-request-packet.json',
  holdoutMatrix: 'docs/process/devseek-r4-live-user-way-holdout-matrix.json',
  realProviderFailureTaxonomy: 'docs/process/devseek-r4-real-provider-failure-taxonomy.json',
  processArtifactsAggregate: 'docs/process/devseek-r4-process-artifacts-aggregate.json',
  gate0Decision: 'docs/process/devseek-gate0-decision-report.json',
});

export const EXTERNAL_AUTHORITY_READINESS_REQUIRED_SOURCE_PATHS = Object.freeze([
  ...Object.values(JSON_SOURCE_PATHS),
  'docs/process/devseek-r4-authorization-and-permission-guide.md',
]);

const LIVE_READINESS_BY_ATOMIC_ID = Object.freeze({
  'R4-LIVE-AUTH-01-USER-WINDOW-AUTHORIZATION': {
    readiness_status: 'BLOCKED_AWAITING_USER_AUTHORIZATION',
    next_authorization_action:
      'User must explicitly authorize one headed DeepSeek live qualification attempt with keep-window and keep-deepseek-page terms.',
  },
  'R4-LIVE-AUTH-02-CLEAN-RUNTIME-CANDIDATE': {
    readiness_status: 'BLOCKED_AWAITING_RUNTIME_OWNER_AUTHORIZATION',
    next_authorization_action:
      'User and runtime owner must authorize clean runtime identity refresh, isolation, or provide an external clean candidate identity receipt.',
  },
  'R4-LIVE-AUTH-03-HOLDOUT-PROFILE': {
    readiness_status: 'BLOCKED_AWAITING_PROFILE_OWNER',
    next_authorization_action:
      'Qualification profile owner must approve the headed user-way holdout profile, scenario language policy, retry budget, and failure taxonomy.',
  },
  'R4-LIVE-AUTH-04-TRUSTED-EVIDENCE': {
    readiness_status: 'BLOCKED_AWAITING_EXTERNAL_EVIDENCE_AUTHORITY',
    next_authorization_action:
      'External evidence authority must provide trusted manifest, nonrollback time, retention lock, and externally anchored stream head.',
  },
  'R4-LIVE-AUTH-05-QUALIFICATION-IMPORT': {
    readiness_status: 'BLOCKED_AWAITING_QUALIFICATION_IMPORT_AUTHORITY',
    next_authorization_action:
      'Independent qualification import authority must approve importing trusted live evidence into Gate0/R1 only after all protected prerequisites pass.',
  },
});

export function loadExternalAuthorityReadinessAuditSources(repoRoot = process.cwd(), overrides = {}) {
  const sourceContents = {};
  for (const sourcePath of TEXT_SOURCE_PATHS) {
    sourceContents[sourcePath] = overrides.sourceContents?.[sourcePath]
      ?? readText(path.join(repoRoot, sourcePath));
  }
  for (const sourcePath of Object.values(JSON_SOURCE_PATHS)) {
    sourceContents[sourcePath] = overrides.sourceContents?.[sourcePath]
      ?? readText(path.join(repoRoot, sourcePath));
  }

  return {
    sourceContents,
    packageJson: overrides.packageJson
      ?? JSON.parse(sourceContents['package.json']),
    externalAuthorityRequests: overrides.externalAuthorityRequests
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.externalAuthorityRequests]),
    liveQualificationRequestPacket: overrides.liveQualificationRequestPacket
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.liveQualificationRequestPacket]),
    holdoutMatrix: overrides.holdoutMatrix
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.holdoutMatrix]),
    realProviderFailureTaxonomy: overrides.realProviderFailureTaxonomy
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.realProviderFailureTaxonomy]),
    processArtifactsAggregate: overrides.processArtifactsAggregate
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.processArtifactsAggregate]),
    gate0Decision: overrides.gate0Decision
      ?? JSON.parse(sourceContents[JSON_SOURCE_PATHS.gate0Decision]),
  };
}

export function buildExternalAuthorityReadinessAudit({ repoRoot = process.cwd(), sources = null } = {}) {
  const activeSources = sources ?? loadExternalAuthorityReadinessAuditSources(repoRoot);
  const {
    sourceContents,
    packageJson,
    externalAuthorityRequests,
    liveQualificationRequestPacket,
    holdoutMatrix,
    realProviderFailureTaxonomy,
    processArtifactsAggregate,
    gate0Decision,
  } = activeSources;
  const packageScriptPresent = Boolean(packageJson.scripts?.['verify:external-authority-readiness-audit']);
  const phaseSource = sourceContents['scripts/devseek-phase0-12-verify.mjs'] ?? '';
  const phaseGatePresent = phaseSource.includes('external-authority-readiness-audit');
  const externalRequestAudits = externalAuthorityRequests.requests.map(buildExternalRequestAudit);
  const liveRequestAudits = liveQualificationRequestPacket.requests.map(buildLiveRequestAudit);
  const requestAudits = [...externalRequestAudits, ...liveRequestAudits];

  const audit = {
    schema_version: EXTERNAL_AUTHORITY_READINESS_AUDIT_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    audit_id: EXTERNAL_AUTHORITY_READINESS_AUDIT_ID,
    audit_version: 1,
    source_status: 'generated-readiness-audit-only',
    integrity_scope: EXTERNAL_AUTHORITY_READINESS_AUDIT_SCOPE,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'ExternalAuthorityReadinessAudit',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
      request_terminal_state_writes: 'FORBIDDEN',
      qualification_ledger_writes: 'FORBIDDEN',
    },
    source_bindings: {
      external_authority_requests: {
        ...sourceRef(JSON_SOURCE_PATHS.externalAuthorityRequests, sourceContents),
        request_set_id: externalAuthorityRequests.request_set_id,
        request_set_sha256: externalAuthorityRequests.request_set_sha256,
        blocked_requests: externalAuthorityRequests.counts?.blocked_requests ?? null,
      },
      r4_live_qualification_request_packet: {
        ...sourceRef(JSON_SOURCE_PATHS.liveQualificationRequestPacket, sourceContents),
        packet_id: liveQualificationRequestPacket.packet_id,
        packet_sha256: liveQualificationRequestPacket.packet_sha256,
        blocked_requests: liveQualificationRequestPacket.counts?.blocked_requests ?? null,
      },
      r4_live_user_way_holdout_matrix: {
        ...sourceRef(JSON_SOURCE_PATHS.holdoutMatrix, sourceContents),
        matrix_sha256: holdoutMatrix.matrix_sha256,
        blocked_cases: holdoutMatrix.counts?.blocked_cases ?? null,
      },
      r4_real_provider_failure_taxonomy: {
        ...sourceRef(JSON_SOURCE_PATHS.realProviderFailureTaxonomy, sourceContents),
        taxonomy_sha256: realProviderFailureTaxonomy.taxonomy_sha256,
        categories: realProviderFailureTaxonomy.counts?.categories ?? null,
      },
      r4_authorization_and_permission_guide: sourceRef(
        'docs/process/devseek-r4-authorization-and-permission-guide.md',
        sourceContents,
      ),
      r4_process_artifacts_aggregate: {
        ...sourceRef(JSON_SOURCE_PATHS.processArtifactsAggregate, sourceContents),
        aggregate_sha256: processArtifactsAggregate.aggregate_sha256,
        artifact_errors: processArtifactsAggregate.counts?.artifact_errors ?? null,
      },
      gate0_decision: {
        ...sourceRef(JSON_SOURCE_PATHS.gate0Decision, sourceContents),
        decision_id: gate0Decision.decision_id,
        qualification_status: gate0Decision.qualification?.status ?? null,
        external_authority_blockers: gate0Decision.counts?.external_authority_blockers ?? null,
      },
      package_scripts: {
        ...sourceRef('package.json', sourceContents),
        required_script: 'verify:external-authority-readiness-audit',
        required_script_present: packageScriptPresent,
      },
      phase_gate_source: {
        ...sourceRef('scripts/devseek-phase0-12-verify.mjs', sourceContents),
        required_gate: 'external-authority-readiness-audit',
        required_gate_present: phaseGatePresent,
      },
      checker_source: sourceRef(
        'scripts/devseek-external-authority-readiness-audit-check.mjs',
        sourceContents,
      ),
      oracle_source: sourceRef(
        'scripts/test/devseek-external-authority-readiness-audit.test.mjs',
        sourceContents,
      ),
    },
    audit_scope: {
      families: [
        'Gate0ExternalAuthorityRequest',
        'R4LiveQualificationAuthorization',
      ],
      request_terminal_states_changed: false,
      request_terminal_state_writes: false,
      qualification_ledger_writes: false,
      local_repository_may_unblock: false,
      provider_or_window_actions_performed: false,
      live_rerun_performed: false,
    },
    readiness_boundary: {
      gate0_status: gate0Decision.qualification?.status ?? null,
      gate0_gate_passed: gate0Decision.qualification?.gate_passed ?? null,
      gate0_external_authority_blockers: gate0Decision.counts?.external_authority_blockers ?? null,
      external_authority_trust_anchored:
        gate0Decision.qualification?.external_authority_trust_anchored ?? null,
      r4_live_authorization_blocked: liveQualificationRequestPacket.counts?.blocked_requests ?? null,
      holdout_cases_blocked: holdoutMatrix.counts?.blocked_cases ?? null,
      live_runs_authorized: liveQualificationRequestPacket.counts?.live_runs_authorized ?? null,
      approved_live_requests: liveQualificationRequestPacket.counts?.approved_requests ?? null,
      qualification_claims: liveQualificationRequestPacket.counts?.qualification_claims ?? null,
      process_artifact_errors: processArtifactsAggregate.counts?.artifact_errors ?? null,
      local_repository_may_approve_requests: false,
      markdown_may_change_terminal_state: false,
    },
    request_audits: requestAudits,
    terminal_state_preservation: {
      external_request_states: externalAuthorityRequests.requests.map(request => ({
        atomic_id: request.atomic_id,
        source_terminal_state: request.terminal_state,
        audit_terminal_state: request.terminal_state,
        preserved: true,
      })),
      live_request_states: liveQualificationRequestPacket.requests.map(request => ({
        atomic_id: request.atomic_id,
        source_terminal_state: request.terminal_state,
        audit_terminal_state: request.terminal_state,
        preserved: true,
      })),
    },
    counts: {
      request_audits: requestAudits.length,
      gate0_external_request_audits: externalRequestAudits.length,
      r4_live_request_audits: liveRequestAudits.length,
      blocked_requests: requestAudits.filter(request => request.terminal_state === 'BLOCKED').length,
      approved_requests: requestAudits.filter(request => request.terminal_state === 'APPROVED').length,
      local_unblockable_requests: requestAudits.filter(
        request => request.local_repository_may_unblock === true,
      ).length,
      executable_recovery_statements: requestAudits.filter(
        request => Boolean(request.next_authorization_action),
      ).length,
      blocker_precision_ok: requestAudits.filter(
        request => request.blocker_precision === 'PRECISE',
      ).length,
      terminal_states_preserved: requestAudits.filter(
        request => request.terminal_state_preserved === true,
      ).length,
      live_runs_authorized: liveQualificationRequestPacket.counts?.live_runs_authorized ?? null,
      qualification_claims: liveQualificationRequestPacket.counts?.qualification_claims ?? null,
      gate_pass_assertions: 0,
      ledger_writes: 0,
      provider_actions_performed: 0,
    },
    audit_sha256: null,
  };
  audit.audit_sha256 = externalAuthorityReadinessAuditHash(audit);
  return audit;
}

export function validateExternalAuthorityReadinessAudit(
  audit,
  { repoRoot = process.cwd(), sources = null } = {},
) {
  const errors = [];
  if (!isObject(audit)) {
    return {
      ok: false,
      errors: ['audit:expected-object'],
      summary: null,
    };
  }
  semanticValidate(audit, errors);

  let expected = null;
  try {
    expected = buildExternalAuthorityReadinessAudit({ repoRoot, sources });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }
  if (expected && canonicalJson(audit) !== canonicalJson(expected)) {
    errors.push('audit:expected-current-external-authority-readiness-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeExternalAuthorityReadinessAudit(expected) : null,
  };
}

export function renderExternalAuthorityReadinessAuditMarkdown(audit) {
  const rows = audit.request_audits.map(request => (
    `| \`${request.atomic_id}\` | \`${request.request_family}\` | \`${request.decision_owner}\` | \`${request.terminal_state}\` | \`${request.readiness_status}\` |`
  ));
  return [
    '# DevSeek 外部授权就绪审计',
    '',
    '## 摘要',
    '',
    `- Audit ID: \`${audit.audit_id}\``,
    `- Source status: \`${audit.source_status}\``,
    `- Qualification effect: \`${audit.qualification_effect}\``,
    `- Claims permitted: \`${audit.claims_permitted}\``,
    `- Gate assertion: \`${audit.asserts_gate_pass}\``,
    `- Request audits: \`${audit.counts.request_audits}\``,
    `- Blocked requests: \`${audit.counts.blocked_requests}\``,
    `- Local unblockable requests: \`${audit.counts.local_unblockable_requests}\``,
    `- Executable recovery statements: \`${audit.counts.executable_recovery_statements}\``,
    '',
    '## 审计边界',
    '',
    `- Gate0: \`${audit.readiness_boundary.gate0_status}\``,
    `- Gate0 external blockers: \`${audit.readiness_boundary.gate0_external_authority_blockers}\``,
    `- R4 live authorization blocked: \`${audit.readiness_boundary.r4_live_authorization_blocked}\``,
    `- Live runs authorized: \`${audit.readiness_boundary.live_runs_authorized}\``,
    `- Qualification claims: \`${audit.readiness_boundary.qualification_claims}\``,
    `- Request terminal states changed: \`${audit.audit_scope.request_terminal_states_changed}\``,
    `- Qualification ledger writes: \`${audit.audit_scope.qualification_ledger_writes}\``,
    '',
    '## Request Readiness',
    '',
    '| Atomic ID | Family | Owner | State | Readiness |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## 下一步授权动作',
    '',
    ...audit.request_audits.map(request => (
      `- \`${request.atomic_id}\`: ${request.next_authorization_action}`
    )),
    '',
    '## Source Bindings',
    '',
    ...Object.entries(audit.source_bindings).map(([key, binding]) => (
      `- \`${key}\`: \`${binding.path}\` -> \`${binding.source_sha256}\``
    )),
    '',
    '## Audit Identity',
    '',
    `- Audit SHA-256: \`${audit.audit_sha256}\``,
    '',
  ].join('\n');
}

export function externalAuthorityReadinessAuditHash(audit) {
  return sha256Object(withoutKeys(audit, ['audit_sha256']), audit?.integrity);
}

export function summarizeExternalAuthorityReadinessAudit(audit) {
  return {
    audit_sha256: audit.audit_sha256,
    request_audits: audit.counts.request_audits,
    gate0_external_request_audits: audit.counts.gate0_external_request_audits,
    r4_live_request_audits: audit.counts.r4_live_request_audits,
    blocked_requests: audit.counts.blocked_requests,
    approved_requests: audit.counts.approved_requests,
    local_unblockable_requests: audit.counts.local_unblockable_requests,
    executable_recovery_statements: audit.counts.executable_recovery_statements,
    blocker_precision_ok: audit.counts.blocker_precision_ok,
    terminal_states_preserved: audit.counts.terminal_states_preserved,
    live_runs_authorized: audit.counts.live_runs_authorized,
    qualification_claims: audit.counts.qualification_claims,
    qualification_effect: audit.qualification_effect,
    claims_permitted: audit.claims_permitted,
    asserts_gate_pass: audit.asserts_gate_pass,
  };
}

function buildExternalRequestAudit(request) {
  return {
    request_family: 'Gate0ExternalAuthorityRequest',
    request_id: request.request_id,
    atomic_id: request.atomic_id,
    decision_owner: request.independent_decision_owner,
    requested_decision: request.requested_decision_and_scope?.decision ?? '',
    terminal_state: request.terminal_state,
    source_blocker_reason: request.blocker_reason,
    readiness_status: 'BLOCKED_AWAITING_EXTERNAL_AUTHORITY',
    blocker_precision: preciseExternalBlocker(request) ? 'PRECISE' : 'NEEDS_DETAIL',
    blocker_evidence_fields: [
      'requested_decision_and_scope',
      'required_input_digests',
      'required_artifact_schema_and_signature_purpose',
      'trusted_root_or_registry_reference',
      'repository_import_port_and_fail_closed_verifier',
      'redaction_and_secret_non_observation',
    ],
    local_repository_may_unblock: false,
    next_authorization_action:
      `Obtain an approved external authority artifact for ${request.atomic_id} from ${request.independent_decision_owner}, then import it only through the fail-closed external authority adapter.`,
    terminal_state_preserved: true,
    qualification_effect: request.qualification_effect,
    claims_permitted: request.claims_permitted,
    asserts_gate_pass: request.asserts_gate_pass,
  };
}

function buildLiveRequestAudit(request) {
  const readiness = LIVE_READINESS_BY_ATOMIC_ID[request.atomic_id] ?? {
    readiness_status: 'BLOCKED_AWAITING_AUTHORITY',
    next_authorization_action: `Obtain explicit authority for ${request.atomic_id}.`,
  };
  return {
    request_family: 'R4LiveQualificationAuthorization',
    request_id: request.request_id,
    atomic_id: request.atomic_id,
    decision_owner: request.decision_owner,
    requested_decision: request.requested_decision,
    terminal_state: request.terminal_state,
    source_blocker_reason: request.blocker_reason,
    readiness_status: readiness.readiness_status,
    blocker_precision: nonEmpty(request.blocker_reason) && nonEmpty(request.requested_decision)
      ? 'PRECISE'
      : 'NEEDS_DETAIL',
    blocker_evidence_fields: [
      'requested_decision',
      'blocker_reason',
      'decision_owner',
      'required_before_qualification',
      'repository_may_decide',
    ],
    local_repository_may_unblock: false,
    next_authorization_action: readiness.next_authorization_action,
    terminal_state_preserved: true,
    qualification_effect: request.qualification_effect,
    claims_permitted: request.claims_permitted,
    asserts_gate_pass: request.asserts_gate_pass,
  };
}

function semanticValidate(audit, errors) {
  if (audit.schema_version !== EXTERNAL_AUTHORITY_READINESS_AUDIT_SCHEMA_VERSION) {
    errors.push('schema_version:invalid');
  }
  if (audit.audit_id !== EXTERNAL_AUTHORITY_READINESS_AUDIT_ID) errors.push('audit_id:invalid');
  if (audit.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (audit.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (audit.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (audit.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (audit.observation_authority?.request_terminal_state_writes !== 'FORBIDDEN') {
    errors.push('observation_authority.request_terminal_state_writes:must-be-FORBIDDEN');
  }
  if (audit.observation_authority?.qualification_ledger_writes !== 'FORBIDDEN') {
    errors.push('observation_authority.qualification_ledger_writes:must-be-FORBIDDEN');
  }
  if (audit.source_bindings?.package_scripts?.required_script_present !== true) {
    errors.push('source_bindings.package_scripts.required_script_present:must-be-true');
  }
  if (audit.source_bindings?.phase_gate_source?.required_gate_present !== true) {
    errors.push('source_bindings.phase_gate_source.required_gate_present:must-be-true');
  }
  const sourcePaths = Object.values(audit.source_bindings ?? {}).map(binding => binding?.path);
  for (const requiredPath of EXTERNAL_AUTHORITY_READINESS_REQUIRED_SOURCE_PATHS) {
    if (!sourcePaths.includes(requiredPath)) errors.push(`source_bindings:missing-${requiredPath}`);
  }
  if (audit.audit_scope?.request_terminal_states_changed !== false) {
    errors.push('audit_scope.request_terminal_states_changed:must-be-false');
  }
  if (audit.audit_scope?.qualification_ledger_writes !== false) {
    errors.push('audit_scope.qualification_ledger_writes:must-be-false');
  }
  if (audit.audit_scope?.local_repository_may_unblock !== false) {
    errors.push('audit_scope.local_repository_may_unblock:must-be-false');
  }
  if (audit.readiness_boundary?.gate0_status !== 'NOT_PASSED') {
    errors.push('readiness_boundary.gate0_status:must-be-NOT_PASSED');
  }
  if (audit.readiness_boundary?.gate0_external_authority_blockers !== 6) {
    errors.push('readiness_boundary.gate0_external_authority_blockers:must-be-6');
  }
  if (audit.readiness_boundary?.r4_live_authorization_blocked !== 5) {
    errors.push('readiness_boundary.r4_live_authorization_blocked:must-be-5');
  }
  if (audit.readiness_boundary?.live_runs_authorized !== 0) {
    errors.push('readiness_boundary.live_runs_authorized:must-be-0');
  }
  if (audit.readiness_boundary?.qualification_claims !== 0) {
    errors.push('readiness_boundary.qualification_claims:must-be-0');
  }
  if (!Array.isArray(audit.request_audits) || audit.request_audits.length !== 10) {
    errors.push('request_audits:must-contain-10-requests');
  } else {
    for (const [index, request] of audit.request_audits.entries()) {
      if (request.terminal_state !== 'BLOCKED') {
        errors.push(`request_audits[${index}].terminal_state:must-be-BLOCKED`);
      }
      if (request.blocker_precision !== 'PRECISE') {
        errors.push(`request_audits[${index}].blocker_precision:must-be-PRECISE`);
      }
      if (request.local_repository_may_unblock !== false) {
        errors.push(`request_audits[${index}].local_repository_may_unblock:must-be-false`);
      }
      if (!nonEmpty(request.next_authorization_action)) {
        errors.push(`request_audits[${index}].next_authorization_action:required`);
      }
      if (request.terminal_state_preserved !== true) {
        errors.push(`request_audits[${index}].terminal_state_preserved:must-be-true`);
      }
      if (request.qualification_effect !== 'NONE') {
        errors.push(`request_audits[${index}].qualification_effect:must-be-NONE`);
      }
      if (request.claims_permitted !== false) {
        errors.push(`request_audits[${index}].claims_permitted:must-be-false`);
      }
      if (request.asserts_gate_pass !== false) {
        errors.push(`request_audits[${index}].asserts_gate_pass:must-be-false`);
      }
    }
  }
  if (audit.counts?.request_audits !== 10) errors.push('counts.request_audits:must-be-10');
  if (audit.counts?.gate0_external_request_audits !== 5) {
    errors.push('counts.gate0_external_request_audits:must-be-5');
  }
  if (audit.counts?.r4_live_request_audits !== 5) {
    errors.push('counts.r4_live_request_audits:must-be-5');
  }
  if (audit.counts?.blocked_requests !== 10) errors.push('counts.blocked_requests:must-be-10');
  if (audit.counts?.approved_requests !== 0) errors.push('counts.approved_requests:must-be-0');
  if (audit.counts?.local_unblockable_requests !== 0) {
    errors.push('counts.local_unblockable_requests:must-be-0');
  }
  if (audit.counts?.executable_recovery_statements !== 10) {
    errors.push('counts.executable_recovery_statements:must-be-10');
  }
  if (audit.counts?.blocker_precision_ok !== 10) {
    errors.push('counts.blocker_precision_ok:must-be-10');
  }
  if (audit.counts?.terminal_states_preserved !== 10) {
    errors.push('counts.terminal_states_preserved:must-be-10');
  }
  if (audit.counts?.live_runs_authorized !== 0) errors.push('counts.live_runs_authorized:must-be-0');
  if (audit.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  if (audit.counts?.gate_pass_assertions !== 0) errors.push('counts.gate_pass_assertions:must-be-0');
  if (audit.counts?.ledger_writes !== 0) errors.push('counts.ledger_writes:must-be-0');
  if (audit.counts?.provider_actions_performed !== 0) {
    errors.push('counts.provider_actions_performed:must-be-0');
  }
  if (audit.audit_sha256 !== externalAuthorityReadinessAuditHash(audit)) {
    errors.push('audit_sha256:mismatch');
  }
}

function preciseExternalBlocker(request) {
  return nonEmpty(request.blocker_reason)
    && nonEmpty(request.requested_decision_and_scope?.decision)
    && Array.isArray(request.required_input_digests)
    && request.required_input_digests.length > 0
    && nonEmpty(request.required_artifact_schema_and_signature_purpose?.signature_purpose)
    && request.trusted_root_or_registry_reference?.local_fallback_accepted === false
    && request.repository_import_port_and_fail_closed_verifier?.fail_closed_without_external_artifact === true;
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

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
