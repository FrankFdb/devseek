import crypto from 'node:crypto';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  sha256Object,
} from './devseek-capability-ledger.mjs';
import {
  externalAuthorityAdapterHash,
} from './devseek-external-authority-adapter.mjs';
import {
  gate0DecisionHash,
} from './devseek-gate0-decision.mjs';
import {
  c0WiringReconciliationHash,
} from './devseek-c0-wiring-reconciliation.mjs';

export const EXTERNAL_AUTHORITY_REQUESTS_SCHEMA_VERSION = 'devseek.external-authority-requests/v1';
export const EXTERNAL_AUTHORITY_REQUEST_SCHEMA_VERSION = 'devseek.external-authority-request/v1';
export const EXTERNAL_AUTHORITY_REQUEST_SET_ID = 'DEVSEEK-GATE0-EXTERNAL-AUTHORITY-REQUESTS/v1';
export const EXTERNAL_AUTHORITY_REQUESTS_INTEGRITY_SCOPE = 'external-authority-request-generation';
export const EXTERNAL_AUTHORITY_REQUESTS_QUALIFICATION_EFFECT = 'NONE';
export const GATE0_REQUIRED_EXTERNAL_BLOCKERS = 6;

export const REQUIRED_EXTERNAL_AUTHORITY_REQUEST_FIELDS = Object.freeze([
  'request_id',
  'atomic_id',
  'requesting_owner',
  'independent_decision_owner',
  'requested_decision_and_scope',
  'required_input_digests',
  'required_artifact_schema_and_signature_purpose',
  'trusted_root_or_registry_reference',
  'role_separation_and_conflict_rules',
  'valid_from',
  'expires_at',
  'revocation_source',
  'repository_import_port_and_fail_closed_verifier',
  'redaction_and_secret_non_observation',
  'terminal_state',
]);

export const REQUIRED_GATE0_EXTERNAL_REQUESTS = Object.freeze([
  {
    atomic_id: 'EXT-01-SOURCE-REGISTRY-BINDING',
    independent_decision_owner: 'registry-owner',
    requested_decision:
      'Approve profile and evidence registry digests, versions, and revocation policy for Gate 0 protected qualification.',
    signature_purpose: 'source-registry-digest-binding',
    trusted_reference: 'external-profile-and-evidence-registry',
    external_delivery:
      'Independently approved profile/evidence registry digests with version and revocation policy.',
    role_rules: [
      'registry owner must be independent from repository implementer',
      'registry digest approval must bind exact source digests',
      'revocation source must be external to this repository',
    ],
  },
  {
    atomic_id: 'EXT-02-INDEPENDENT-ATTESTATION',
    independent_decision_owner: 'independent-attestation-security-authority',
    requested_decision:
      'Issue verifiable external authority attestation and trusted root for Gate 0 protected qualification.',
    signature_purpose: 'independent-authority-attestation',
    trusted_reference: 'audited-external-trust-root-registry',
    external_delivery: 'Verifiable external authority attestation and trusted root.',
    role_rules: [
      'attestation signer must be organizationally independent from local runner',
      'trust root must be audited and revocation-aware',
      'local self-signatures and repository fixtures are forbidden',
    ],
  },
  {
    atomic_id: 'EXT-03-PROTECTED-PROFILE-POLICY',
    independent_decision_owner: 'qualification-policy-owner',
    requested_decision:
      'Approve protected profile, aggregator allowlist, and exact claim rules for Gate 0.',
    signature_purpose: 'protected-profile-policy-approval',
    trusted_reference: 'external-qualification-policy-registry',
    external_delivery: 'Protected profile, aggregator allowlist, and claim rules.',
    role_rules: [
      'policy owner must approve qualification eligibility outside local fixtures',
      'aggregator allowlist must bind exact profile and policy digests',
      'local qualification_eligible flips are forbidden',
    ],
  },
  {
    atomic_id: 'EXT-04-ROLES-KEYS',
    independent_decision_owner: 'organizational-identity-key-management-authority',
    requested_decision:
      'Approve active non-test plan, runner, watchdog, oracle, adjudicator, and aggregator role identities and keys.',
    signature_purpose: 'role-key-separation-and-revocation',
    trusted_reference: 'external-role-key-registry',
    external_delivery:
      'Separated active non-test role identities, keys, purpose binding, and revocation controls.',
    role_rules: [
      'plan, runner, watchdog, oracle, adjudicator, and aggregator roles must be conflict-checked',
      'one operator changing key ids cannot satisfy role separation',
      'private keys and secrets must never be committed to the repository',
    ],
  },
  {
    atomic_id: 'EXT-05-RETENTION-TIME',
    independent_decision_owner: 'external-storage-time-authority',
    requested_decision:
      'Approve WORM or retention lock storage, external stream anchor, and trusted non-rollback time receipts.',
    signature_purpose: 'retention-lock-time-anchor',
    trusted_reference: 'external-retention-time-service',
    external_delivery:
      'External WORM or retention lock, stream anchor, and trusted non-rollback time receipts.',
    role_rules: [
      'retention lock must be outside local filesystem control',
      'time source must be non-rollback and independently anchored',
      'local CAS, hard links, or same-machine high water files are forbidden substitutes',
    ],
  },
]);

export function externalAuthorityRequestsHash(report) {
  return sha256Object(withoutKeys(report, ['request_set_sha256']), report?.integrity);
}

export function buildExternalAuthorityRequests({
  gate0Decision,
  externalAuthorityAdapter,
  c0WiringReconciliation,
  packageJson,
  phaseSource,
  sourceContents,
} = {}) {
  assertSourceObject(gate0Decision, 'gate0Decision');
  assertSourceObject(externalAuthorityAdapter, 'externalAuthorityAdapter');
  assertSourceObject(c0WiringReconciliation, 'c0WiringReconciliation');
  assertSourceObject(packageJson, 'packageJson');
  assertSourceObject(sourceContents, 'sourceContents');

  const gate0DecisionSha256 = gate0DecisionHash(gate0Decision);
  const externalAuthorityAdapterSha256 = externalAuthorityAdapterHash(externalAuthorityAdapter);
  const c0WiringReconciliationSha256 = c0WiringReconciliationHash(c0WiringReconciliation);
  const packageSource = getSource(sourceContents, 'package.json');
  const phaseGatePresent = String(phaseSource).includes('external-authority-request-packets');
  const packageScriptPresent = Boolean(packageJson.scripts?.['verify:external-authority-requests']);

  const sharedDigests = buildSharedInputDigests({
    gate0Decision,
    externalAuthorityAdapter,
    c0WiringReconciliation,
    gate0DecisionSha256,
    externalAuthorityAdapterSha256,
    c0WiringReconciliationSha256,
  });

  const requests = REQUIRED_GATE0_EXTERNAL_REQUESTS.map(spec => buildRequest(spec, sharedDigests));
  const report = {
    schema_version: EXTERNAL_AUTHORITY_REQUESTS_SCHEMA_VERSION,
    integrity: { ...SUPPORTED_INTEGRITY },
    request_set_id: EXTERNAL_AUTHORITY_REQUEST_SET_ID,
    request_set_version: 1,
    source_status: 'generated-awaiting-external-authority',
    integrity_scope: EXTERNAL_AUTHORITY_REQUESTS_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: EXTERNAL_AUTHORITY_REQUESTS_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    sources: {
      gate0_decision: {
        path: 'docs/process/devseek-gate0-decision-report.json',
        schema_version: gate0Decision.schema_version,
        decision_id: gate0Decision.decision_id,
        source_sha256: gate0DecisionSha256,
      },
      external_authority_adapter: {
        path: 'docs/process/devseek-external-authority-adapter.json',
        schema_version: externalAuthorityAdapter.schema_version,
        adapter_id: externalAuthorityAdapter.adapter_id,
        source_sha256: externalAuthorityAdapterSha256,
      },
      c0_wiring_reconciliation: {
        path: 'docs/process/devseek-c0-wiring-reconciliation.json',
        schema_version: c0WiringReconciliation.schema_version,
        reconciliation_id: c0WiringReconciliation.reconciliation_id,
        source_sha256: c0WiringReconciliationSha256,
      },
      package_scripts: {
        path: 'package.json',
        source_sha256: sha256Text(packageSource),
        required_script: 'verify:external-authority-requests',
        required_script_present: packageScriptPresent,
      },
      phase_gate_source: {
        path: 'scripts/devseek-phase0-12-verify.mjs',
        source_sha256: sha256Text(String(phaseSource)),
        required_gate: 'external-authority-request-packets',
        required_gate_present: phaseGatePresent,
      },
      checker_source: {
        path: 'scripts/devseek-external-authority-requests-check.mjs',
        source_sha256: sha256Text(getSource(
          sourceContents,
          'scripts/devseek-external-authority-requests-check.mjs',
        )),
      },
      oracle_source: {
        path: 'scripts/test/devseek-external-authority-requests.test.mjs',
        source_sha256: sha256Text(getSource(
          sourceContents,
          'scripts/test/devseek-external-authority-requests.test.mjs',
        )),
      },
    },
    request_contract: {
      schema_version: EXTERNAL_AUTHORITY_REQUEST_SCHEMA_VERSION,
      required_fields: [...REQUIRED_EXTERNAL_AUTHORITY_REQUEST_FIELDS],
      allowed_terminal_states: ['APPROVED', 'DENIED', 'EXPIRED', 'BLOCKED'],
      requested_atomic_ids: REQUIRED_GATE0_EXTERNAL_REQUESTS.map(spec => spec.atomic_id),
      repository_may_decide: false,
      local_fixture_may_substitute: false,
      markdown_may_approve: false,
    },
    gate0_current_state: {
      status: gate0Decision.qualification?.status ?? null,
      gate_passed: gate0Decision.qualification?.gate_passed ?? null,
      external_authority_trust_anchored:
        gate0Decision.qualification?.external_authority_trust_anchored ?? null,
      implementation_requirements_satisfied:
        gate0Decision.counts?.implementation_requirements_satisfied ?? null,
      exact_claim_requirements_satisfied:
        gate0Decision.counts?.exact_claim_requirements_satisfied ?? null,
      observed_claims: gate0Decision.counts?.observed_claims ?? null,
      repository_pending_blockers: gate0Decision.counts?.repository_pending_blockers ?? null,
      external_authority_blockers: gate0Decision.counts?.external_authority_blockers ?? null,
      claims_empty: Array.isArray(gate0Decision.claims) && gate0Decision.claims.length === 0,
    },
    requests,
    bypass_guards: {
      repository_may_approve_requests: false,
      local_fixture_may_act_as_external_authority: false,
      request_packet_may_issue_claims: false,
      markdown_may_change_terminal_state: false,
      provider_or_network_required: false,
    },
    counts: {
      requests: requests.length,
      blocked_requests: requests.filter(request => request.terminal_state === 'BLOCKED').length,
      approved_requests: requests.filter(request => request.terminal_state === 'APPROVED').length,
      denied_requests: requests.filter(request => request.terminal_state === 'DENIED').length,
      expired_requests: requests.filter(request => request.terminal_state === 'EXPIRED').length,
      gate0_external_authority_blockers: gate0Decision.counts?.external_authority_blockers ?? null,
      claims: gate0Decision.counts?.observed_claims ?? null,
      gate_pass_assertions: 0,
      bypasses: 0,
    },
    request_set_sha256: null,
  };
  report.request_set_sha256 = externalAuthorityRequestsHash(report);
  return report;
}

export function validateExternalAuthorityRequests(report, sources) {
  const errors = [];
  if (!isObject(report)) {
    return { ok: false, errors: ['requests:expected-object'], summary: null };
  }
  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildExternalAuthorityRequests(sources);
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }
  if (expected && canonicalJson(report) !== canonicalJson(expected)) {
    errors.push('requests:deterministic-source-drift');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeExternalAuthorityRequests(expected) : null,
  };
}

export function renderExternalAuthorityRequestsMarkdown(report) {
  const lines = [
    '# DevSeek External Authority Requests',
    '',
    '> Generated by `npm run generate:external-authority-requests`. Do not edit manually.',
    '> This is a request packet only. It is not an approval, qualification claim, or Gate 0 pass.',
    '',
    '## Scope',
    '',
    `- Request set: \`${report.request_set_id}\``,
    `- Integrity scope: \`${report.integrity_scope}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${String(report.claims_permitted)}\``,
    `- Asserts Gate 0 pass: \`${String(report.asserts_gate_pass)}\``,
    '',
    '## Gate 0 Current State',
    '',
    `- Status: \`${report.gate0_current_state.status}\``,
    `- Claims: \`${report.gate0_current_state.observed_claims}\``,
    `- Repository blockers: \`${report.gate0_current_state.repository_pending_blockers}\``,
    `- External authority blockers: \`${report.gate0_current_state.external_authority_blockers}\``,
    '',
    '## Requests',
    '',
    '| Atomic ID | Decision owner | Terminal state |',
    '| --- | --- | --- |',
    ...report.requests.map(request => [
      `| \`${request.atomic_id}\``,
      `\`${request.independent_decision_owner}\``,
      `\`${request.terminal_state}\` |`,
    ].join(' | ')),
    '',
    '## Counts',
    '',
    `- Requests: \`${report.counts.requests}\``,
    `- Blocked requests: \`${report.counts.blocked_requests}\``,
    `- Approved requests: \`${report.counts.approved_requests}\``,
    `- Bypasses: \`${report.counts.bypasses}\``,
    `- SHA-256: \`${report.request_set_sha256}\``,
  ];
  return `${lines.join('\n')}\n`;
}

export function summarizeExternalAuthorityRequests(report) {
  return {
    request_set_sha256: report.request_set_sha256,
    requests: report.counts.requests,
    blocked_requests: report.counts.blocked_requests,
    approved_requests: report.counts.approved_requests,
    gate0_status: report.gate0_current_state.status,
    gate0_external_authority_blockers: report.counts.gate0_external_authority_blockers,
    claims: report.counts.claims,
    qualification_effect: report.qualification_effect,
    bypasses: report.counts.bypasses,
  };
}

function buildRequest(spec, sharedDigests) {
  return {
    schema_version: EXTERNAL_AUTHORITY_REQUEST_SCHEMA_VERSION,
    request_id: `${spec.atomic_id}/request-v1`,
    atomic_id: spec.atomic_id,
    requesting_owner: 'DevSeek local convergence runner',
    independent_decision_owner: spec.independent_decision_owner,
    requested_decision_and_scope: {
      decision: spec.requested_decision,
      scope: 'gate0-protected-profile-execution-prerequisite',
      external_delivery: spec.external_delivery,
      repository_may_decide: false,
      qualification_claim_effect: 'NONE',
    },
    required_input_digests: sharedDigests,
    required_artifact_schema_and_signature_purpose: {
      schema_version: 'devseek.external-authority-attestation/v1',
      schema_path: 'docs/process/devseek-external-authority-attestation.schema.json',
      signature_purpose: spec.signature_purpose,
      detached_signature_required: true,
    },
    trusted_root_or_registry_reference: {
      status: 'required-external-not-present',
      reference: spec.trusted_reference,
      local_fallback_accepted: false,
    },
    role_separation_and_conflict_rules: spec.role_rules,
    valid_from: null,
    expires_at: null,
    revocation_source: null,
    repository_import_port_and_fail_closed_verifier: {
      adapter_report_path: 'docs/process/devseek-external-authority-adapter.json',
      attestation_schema_path: 'docs/process/devseek-external-authority-attestation.schema.json',
      adapter_checker: 'scripts/devseek-external-authority-adapter-check.mjs',
      gate0_decision_checker: 'scripts/devseek-gate0-decision-check.mjs',
      fail_closed_without_external_artifact: true,
    },
    redaction_and_secret_non_observation: {
      secret_material_must_not_enter_repository: true,
      secret_values_observed_by_request_generator: false,
      redaction_required_for_external_receipts: true,
    },
    terminal_state: 'BLOCKED',
    blocker_reason: 'external-decision-artifact-not-provided',
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  };
}

function buildSharedInputDigests({
  gate0Decision,
  externalAuthorityAdapter,
  c0WiringReconciliation,
  gate0DecisionSha256,
  externalAuthorityAdapterSha256,
  c0WiringReconciliationSha256,
}) {
  return [
    {
      input_id: 'gate0-decision-report',
      path: 'docs/process/devseek-gate0-decision-report.json',
      sha256: gate0DecisionSha256,
      purpose: 'current Gate 0 machine decision and blocker counts',
    },
    {
      input_id: 'external-authority-adapter',
      path: 'docs/process/devseek-external-authority-adapter.json',
      sha256: externalAuthorityAdapterSha256,
      purpose: 'fail-closed external authority import adapter',
    },
    {
      input_id: 'c0-wiring-reconciliation',
      path: 'docs/process/devseek-c0-wiring-reconciliation.json',
      sha256: c0WiringReconciliationSha256,
      purpose: 'local C0 wiring and decision reconciliation',
    },
    {
      input_id: 'capability-ledger-source',
      path: gate0Decision.sources?.capability_ledger?.path ?? 'docs/process/devseek-capability-ledger.json',
      sha256: gate0Decision.sources?.capability_ledger?.source_sha256,
      purpose: 'C0 capability source digest',
    },
    {
      input_id: 'qualification-profile-source',
      path: gate0Decision.sources?.qualification_profiles?.path ?? 'docs/process/devseek-qualification-profiles.json',
      sha256: gate0Decision.sources?.capability_ledger?.qualification_claim_authority?.profile_source_sha256,
      purpose: 'qualification profile source digest requested for external binding',
    },
    {
      input_id: 'qualification-evidence-source',
      path: gate0Decision.sources?.aggregator_policy?.path ?? 'docs/process/devseek-qualification-aggregator-policy.json',
      sha256: gate0Decision.sources?.capability_ledger?.qualification_claim_authority?.evidence_source_sha256,
      purpose: 'evidence policy source digest requested for external binding',
    },
  ];
}

function semanticValidate(report, errors) {
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (report.sources?.package_scripts?.required_script_present !== true) {
    errors.push('sources.package_scripts.required_script_present:must-be-true');
  }
  if (report.sources?.phase_gate_source?.required_gate_present !== true) {
    errors.push('sources.phase_gate_source.required_gate_present:must-be-true');
  }

  const expectedIds = REQUIRED_GATE0_EXTERNAL_REQUESTS.map(spec => spec.atomic_id);
  const observedIds = (report.requests ?? []).map(request => request.atomic_id).sort();
  if (canonicalJson(observedIds) !== canonicalJson([...expectedIds].sort())) {
    errors.push('requests.atomic_ids:must-match-gate0-ext01-ext05');
  }
  if (report.gate0_current_state?.status !== 'NOT_PASSED') errors.push('gate0_current_state.status:must-be-NOT_PASSED');
  if (report.gate0_current_state?.gate_passed !== false) errors.push('gate0_current_state.gate_passed:must-be-false');
  if (report.gate0_current_state?.observed_claims !== 0) errors.push('gate0_current_state.observed_claims:must-be-0');
  if (report.gate0_current_state?.external_authority_blockers !== GATE0_REQUIRED_EXTERNAL_BLOCKERS) {
    errors.push('gate0_current_state.external_authority_blockers:must-remain-6');
  }

  for (const [index, request] of (report.requests ?? []).entries()) {
    validateRequest(request, index, errors);
  }

  if (report.counts?.requests !== REQUIRED_GATE0_EXTERNAL_REQUESTS.length) errors.push('counts.requests:must-be-5');
  if (report.counts?.blocked_requests !== REQUIRED_GATE0_EXTERNAL_REQUESTS.length) {
    errors.push('counts.blocked_requests:must-be-5');
  }
  if (report.counts?.approved_requests !== 0) errors.push('counts.approved_requests:must-be-0');
  if (report.counts?.claims !== 0) errors.push('counts.claims:must-be-0');
  if (report.counts?.gate_pass_assertions !== 0) errors.push('counts.gate_pass_assertions:must-be-0');
  if (report.counts?.bypasses !== 0) errors.push('counts.bypasses:must-be-0');
  if (report.request_set_sha256 !== externalAuthorityRequestsHash(report)) {
    errors.push('request_set_sha256:mismatch');
  }
}

function validateRequest(request, index, errors) {
  const prefix = `requests[${index}]`;
  if (request.schema_version !== EXTERNAL_AUTHORITY_REQUEST_SCHEMA_VERSION) {
    errors.push(`${prefix}.schema_version:invalid`);
  }
  if (request.requested_decision_and_scope?.repository_may_decide !== false) {
    errors.push(`${prefix}.requested_decision_and_scope.repository_may_decide:must-be-false`);
  }
  if (request.terminal_state !== 'BLOCKED') errors.push(`${prefix}.terminal_state:must-be-BLOCKED-until-external-decision`);
  if (request.valid_from !== null) errors.push(`${prefix}.valid_from:must-be-null-until-approved`);
  if (request.expires_at !== null) errors.push(`${prefix}.expires_at:must-be-null-until-approved`);
  if (request.revocation_source !== null) errors.push(`${prefix}.revocation_source:must-be-null-until-approved`);
  if (request.trusted_root_or_registry_reference?.local_fallback_accepted !== false) {
    errors.push(`${prefix}.trusted_root_or_registry_reference.local_fallback_accepted:must-be-false`);
  }
  if (request.repository_import_port_and_fail_closed_verifier?.fail_closed_without_external_artifact !== true) {
    errors.push(`${prefix}.repository_import_port_and_fail_closed_verifier.fail_closed_without_external_artifact:must-be-true`);
  }
  if (request.redaction_and_secret_non_observation?.secret_values_observed_by_request_generator !== false) {
    errors.push(`${prefix}.redaction_and_secret_non_observation.secret_values_observed_by_request_generator:must-be-false`);
  }
  if (request.qualification_effect !== 'NONE') errors.push(`${prefix}.qualification_effect:must-be-NONE`);
  if (request.claims_permitted !== false) errors.push(`${prefix}.claims_permitted:must-be-false`);
  if (request.asserts_gate_pass !== false) errors.push(`${prefix}.asserts_gate_pass:must-be-false`);
  for (const digest of request.required_input_digests ?? []) {
    if (!/^[a-f0-9]{64}$/u.test(digest.sha256 ?? '')) {
      errors.push(`${prefix}.required_input_digests.${digest.input_id}:sha256-required`);
    }
  }
}

function assertSourceObject(value, name) {
  if (!isObject(value)) throw new Error(`${name}:expected-object`);
}

function getSource(sourceContents, relativePath) {
  const source = sourceContents?.[relativePath];
  if (typeof source !== 'string') throw new Error(`source:${relativePath}:missing`);
  return source;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutKeys(value, keys) {
  const copy = structuredClone(value);
  for (const key of keys) delete copy[key];
  return copy;
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
