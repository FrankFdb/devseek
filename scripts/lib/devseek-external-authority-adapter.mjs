import crypto from 'node:crypto';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  ledgerHash,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const EXTERNAL_AUTHORITY_ADAPTER_SCHEMA_VERSION = 'devseek.external-authority-adapter/v1';
export const EXTERNAL_AUTHORITY_ATTESTATION_SCHEMA_VERSION = 'devseek.external-authority-attestation/v1';
export const EXTERNAL_AUTHORITY_ADAPTER_ID = 'DEVSEEK-GATE0-EXTERNAL-AUTHORITY-ADAPTER/v1';
export const EXTERNAL_AUTHORITY_INTEGRITY_SCOPE = 'external-authority-import-contract';
export const EXTERNAL_AUTHORITY_QUALIFICATION_EFFECT = 'NONE';
export const SIGNED_EVIDENCE_AUTHORITY_MODE = 'signed-evidence-validator';

export const REQUIRED_EXTERNAL_AUTHORITY_CONTROLS = Object.freeze([
  'source-digest-binding',
  'independent-authority-attestation',
  'organizational-role-separation',
  'revocation-aware-trust-root',
  'trusted-nonrollback-time',
  'retention-lock-or-worm',
  'manifest-provenance-binding',
]);

export const REQUIRED_EXTERNAL_AUTHORITY_GUARDS = Object.freeze([
  {
    guard_id: 'gate0-consumes-adapter-result',
    source_ref: 'scripts/lib/devseek-gate0-decision.mjs',
    required_fragments: [
      'evaluateExternalAuthorityBinding',
      'externalAuthorityAdapter',
      'external_authority_adapter',
    ],
  },
  {
    guard_id: 'ordinary-object-and-boolean-rejected',
    source_ref: 'scripts/lib/devseek-external-authority-adapter.mjs',
    required_fragments: [
      'REJECTED_ATTESTATION_NOT_OBJECT',
      "typeof attestation !== 'object'",
      'attestation === null',
    ],
  },
  {
    guard_id: 'no-local-trust-root-fallback',
    source_ref: 'scripts/lib/devseek-external-authority-adapter.mjs',
    required_fragments: [
      'TRUSTED_EXTERNAL_AUTHORITY_REGISTRY_DIGESTS = new Set()',
      'REJECTED_TRUST_ROOT_NOT_AUDITED',
      'UNAVAILABLE_NO_EXTERNAL_TRUST_ROOT',
    ],
  },
  {
    guard_id: 'revocation-and-role-reuse-rejected',
    source_ref: 'scripts/lib/devseek-external-authority-adapter.mjs',
    required_fragments: [
      'REJECTED_TRUST_ROOT_REVOKED',
      'REJECTED_ROLE_REUSE',
      'hasDuplicateRoleKey',
    ],
  },
  {
    guard_id: 'clock-rollback-rejected',
    source_ref: 'scripts/lib/devseek-external-authority-adapter.mjs',
    required_fragments: [
      'REJECTED_CLOCK_ROLLBACK',
      'previous_observed_at',
      'observed_at',
    ],
  },
  {
    guard_id: 'manifest-provenance-mismatch-rejected',
    source_ref: 'scripts/lib/devseek-external-authority-adapter.mjs',
    required_fragments: [
      'REJECTED_MANIFEST_OR_PROVENANCE_MISMATCH',
      'expected_manifest_sha256',
      'expected_provenance_sha256',
    ],
  },
  {
    guard_id: 'detached-signature-verified-before-trust',
    source_ref: 'scripts/lib/devseek-external-authority-adapter.mjs',
    required_fragments: [
      'crypto.verify',
      'ATTESTATION_SIGNATURE_INVALID',
      'externalAuthorityAttestationPayloadHash',
    ],
  },
  {
    guard_id: 'gate0-schema-remains-nonqualifying',
    source_ref: 'docs/process/devseek-gate0-decision.schema.json',
    required_fragments: [
      '"external_authority_trust_anchored": { "const": false }',
      '"independent_authority_attested": { "const": false }',
      '"configured_and_bound": { "const": false }',
    ],
  },
]);

export const REQUIRED_EXTERNAL_AUTHORITY_FAILURE_ORACLES = Object.freeze([
  {
    oracle_id: 'boolean-pass-rejected',
    expected_status: 'REJECTED_ATTESTATION_NOT_OBJECT',
    required_fragments: ['boolean pass cannot forge external authority'],
  },
  {
    oracle_id: 'ordinary-object-rejected',
    expected_status: 'REJECTED_ATTESTATION_SCHEMA_VERSION',
    required_fragments: ['ordinary object cannot forge external authority'],
  },
  {
    oracle_id: 'revoked-root-rejected',
    expected_status: 'REJECTED_TRUST_ROOT_REVOKED',
    required_fragments: ['revoked trust root is rejected before any claim effect'],
  },
  {
    oracle_id: 'role-reuse-rejected',
    expected_status: 'REJECTED_ROLE_REUSE',
    required_fragments: ['role reuse is rejected before any claim effect'],
  },
  {
    oracle_id: 'clock-rollback-rejected',
    expected_status: 'REJECTED_CLOCK_ROLLBACK',
    required_fragments: ['clock rollback is rejected before any claim effect'],
  },
  {
    oracle_id: 'manifest-provenance-mismatch-rejected',
    expected_status: 'REJECTED_MANIFEST_OR_PROVENANCE_MISMATCH',
    required_fragments: ['manifest provenance mismatch is rejected before any claim effect'],
  },
  {
    oracle_id: 'valid-local-crypto-still-not-audited',
    expected_status: 'REJECTED_TRUST_ROOT_NOT_AUDITED',
    required_fragments: ['valid local crypto remains untrusted without audited registry digest'],
  },
]);

// Empty by design. Adding an external registry digest here must come from an
// independent authority review, not from a local repository edit or test fixture.
export const TRUSTED_EXTERNAL_AUTHORITY_REGISTRY_DIGESTS = new Set();

export function externalAuthorityAdapterHash(report) {
  return sha256Object(withoutKeys(report, ['adapter_sha256']), report?.integrity);
}

export function externalAuthorityAttestationPayloadHash(attestation) {
  return sha256Text(canonicalJson(withoutKeys(attestation, ['signature'])));
}

export function buildExternalAuthorityAdapterReport({
  ledger,
  qualificationProfiles,
  aggregatorPolicy,
  packageJson,
  sourceContents,
} = {}) {
  assertSourceObject(ledger, 'ledger');
  assertSourceObject(qualificationProfiles, 'qualificationProfiles');
  assertSourceObject(aggregatorPolicy, 'aggregatorPolicy');
  assertSourceObject(packageJson, 'packageJson');
  assertSourceObject(sourceContents, 'sourceContents');

  const implementationSources = Object.entries(sourceContents)
    .map(([path, source]) => ({ path, source_sha256: sha256Text(source) }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const sourceGuards = REQUIRED_EXTERNAL_AUTHORITY_GUARDS.map(guard => buildCoverageEntry(guard, sourceContents));
  const testSource = getSource(sourceContents, 'scripts/test/devseek-external-authority-adapter.test.mjs');
  const failureOracles = REQUIRED_EXTERNAL_AUTHORITY_FAILURE_ORACLES.map(oracle => buildOracleEntry(oracle, testSource));

  const report = {
    schema_version: EXTERNAL_AUTHORITY_ADAPTER_SCHEMA_VERSION,
    integrity: { ...SUPPORTED_INTEGRITY },
    adapter_id: EXTERNAL_AUTHORITY_ADAPTER_ID,
    adapter_version: 1,
    source_status: 'unconfigured',
    integrity_scope: EXTERNAL_AUTHORITY_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: EXTERNAL_AUTHORITY_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    accepted_attestation_schema: EXTERNAL_AUTHORITY_ATTESTATION_SCHEMA_VERSION,
    trust_roots: [],
    required_controls: [...REQUIRED_EXTERNAL_AUTHORITY_CONTROLS],
    deny_policy: {
      boolean_pass_rejected: true,
      ordinary_object_rejected: true,
      local_fixture_fallback_rejected: true,
      self_hash_trust_rejected: true,
      revoked_or_expired_root_rejected: true,
      role_reuse_rejected: true,
      clock_rollback_rejected: true,
      manifest_or_provenance_mismatch_rejected: true,
    },
    sources: {
      capability_ledger: {
        path: 'docs/process/devseek-capability-ledger.json',
        schema_version: ledger.schema_version,
        ledger_id: ledger.ledger_id,
        source_sha256: ledgerHash(ledger),
      },
      qualification_profiles: {
        path: 'docs/process/devseek-qualification-profiles.json',
        schema_version: qualificationProfiles.schema_version,
        document_sha256: qualificationProfiles.document_sha256,
        source_sha256: sha256Object(qualificationProfiles),
      },
      aggregator_policy: {
        path: 'docs/process/devseek-qualification-aggregator-policy.json',
        schema_version: aggregatorPolicy.schema_version,
        policy_id: aggregatorPolicy.policy_id,
        policy_sha256: aggregatorPolicy.policy_sha256,
        source_sha256: aggregatorPolicySourceHash(aggregatorPolicy),
      },
      package_json: {
        path: 'package.json',
        source_sha256: sha256Text(JSON.stringify(packageJson, null, 2)),
      },
      implementation_sources: implementationSources,
    },
    source_guards: sourceGuards,
    failure_oracles: failureOracles,
    current_binding: null,
    counts: null,
  };
  report.current_binding = evaluateExternalAuthorityBinding({
    ledger,
    qualificationProfiles,
    aggregatorPolicy,
    externalAuthorityAdapter: report,
    attestation: null,
  });
  report.counts = {
    required_controls: report.required_controls.length,
    trust_roots: report.trust_roots.length,
    source_guards: sourceGuards.length,
    source_guards_covered: sourceGuards.filter(guard => guard.coverage_status === 'covered').length,
    failure_oracles: failureOracles.length,
    failure_oracles_covered: failureOracles.filter(oracle => oracle.coverage_status === 'covered').length,
    bypasses: countBypasses(report),
  };
  report.adapter_sha256 = externalAuthorityAdapterHash(report);
  return report;
}

export function evaluateExternalAuthorityBinding({
  ledger,
  qualificationProfiles,
  aggregatorPolicy,
  externalAuthorityAdapter,
  attestation = null,
  now = '2026-07-15T00:00:00.000Z',
  expectedManifestSha256 = null,
  expectedProvenanceSha256 = null,
} = {}) {
  const policy = ledger?.qualification_claim_policy ?? {};
  const profileSourceSha256 = sha256Object(qualificationProfiles);
  const evidenceSourceSha256 = sha256Object(aggregatorPolicy);
  const profileBound = policy.profile_registry_sha256 === profileSourceSha256;
  const evidenceBound = policy.evidence_registry_sha256 === evidenceSourceSha256;
  const sourceDigestsBound = policy.mode === SIGNED_EVIDENCE_AUTHORITY_MODE
    && profileBound
    && evidenceBound;
  const verification = verifyExternalAuthorityAttestation({
    externalAuthorityAdapter,
    attestation,
    expected: {
      capability_ledger_sha256: ledgerHash(ledger),
      profile_source_sha256: profileSourceSha256,
      evidence_source_sha256: evidenceSourceSha256,
      expected_manifest_sha256: expectedManifestSha256,
      expected_provenance_sha256: expectedProvenanceSha256,
    },
    now,
  });
  return {
    mode: policy.mode ?? null,
    profile_registry_sha256: policy.profile_registry_sha256 ?? null,
    evidence_registry_sha256: policy.evidence_registry_sha256 ?? null,
    profile_source_sha256: profileSourceSha256,
    evidence_source_sha256: evidenceSourceSha256,
    profile_bound: profileBound,
    evidence_bound: evidenceBound,
    source_digests_bound: sourceDigestsBound,
    independent_authority_attested: verification.accepted,
    independent_authority_status: verification.status,
    configured_and_bound: sourceDigestsBound && verification.accepted,
  };
}

export function verifyExternalAuthorityAttestation({
  externalAuthorityAdapter,
  attestation,
  expected,
  now = '2026-07-15T00:00:00.000Z',
} = {}) {
  if (!isPlainObject(externalAuthorityAdapter)) {
    return rejected('UNAVAILABLE_EXTERNAL_AUTHORITY_ADAPTER_INVALID');
  }
  if (externalAuthorityAdapter.schema_version !== EXTERNAL_AUTHORITY_ADAPTER_SCHEMA_VERSION) {
    return rejected('UNAVAILABLE_EXTERNAL_AUTHORITY_ADAPTER_INVALID');
  }
  if (!Array.isArray(externalAuthorityAdapter.trust_roots) || externalAuthorityAdapter.trust_roots.length === 0) {
    return rejected('UNAVAILABLE_NO_EXTERNAL_TRUST_ROOT');
  }
  if (externalAuthorityAdapter.source_status !== 'verified') {
    return rejected('UNAVAILABLE_EXTERNAL_AUTHORITY_REGISTRY_NOT_VERIFIED');
  }
  if (attestation === null || typeof attestation !== 'object' || Array.isArray(attestation)) {
    return rejected('REJECTED_ATTESTATION_NOT_OBJECT');
  }
  if (attestation.schema_version !== EXTERNAL_AUTHORITY_ATTESTATION_SCHEMA_VERSION) {
    return rejected('REJECTED_ATTESTATION_SCHEMA_VERSION');
  }
  const root = externalAuthorityAdapter.trust_roots.find(entry => entry.root_id === attestation.root_id);
  if (!root) return rejected('REJECTED_TRUST_ROOT_UNKNOWN');
  if (root.status === 'revoked' || attestation.status === 'revoked') return rejected('REJECTED_TRUST_ROOT_REVOKED');
  if (root.status !== 'active' || attestation.status !== 'active') return rejected('REJECTED_TRUST_ROOT_NOT_ACTIVE');
  if (root.control_plane !== 'external-protected') return rejected('REJECTED_LOCAL_TRUST_ROOT');
  if (hasDuplicateRoleKey(attestation.role_bindings)) return rejected('REJECTED_ROLE_REUSE');
  if (isClockRollback(attestation.time_anchor)) return rejected('REJECTED_CLOCK_ROLLBACK');
  if (!timeWindowCovers({ root, attestation, now })) return rejected('REJECTED_ATTESTATION_TIME_WINDOW');
  if (!controlsSatisfied(attestation.controls)) return rejected('REJECTED_PROTECTED_CONTROL_MISSING');
  if (!sourceBindingsMatch(attestation.source_bindings, expected)) return rejected('REJECTED_SOURCE_DIGEST_MISMATCH');
  if (!manifestBindingMatches(attestation.manifest_binding, expected)) {
    return rejected('REJECTED_MANIFEST_OR_PROVENANCE_MISMATCH');
  }
  if (!signaturePayloadMatches(attestation)) return rejected('ATTESTATION_SIGNATURE_PAYLOAD_MISMATCH');
  if (!verifyDetachedSignature(attestation, root)) return rejected('ATTESTATION_SIGNATURE_INVALID');
  if (!TRUSTED_EXTERNAL_AUTHORITY_REGISTRY_DIGESTS.has(externalAuthorityAdapterHash(externalAuthorityAdapter))) {
    return rejected('REJECTED_TRUST_ROOT_NOT_AUDITED');
  }
  return { accepted: true, status: 'ACCEPTED_EXTERNAL_AUTHORITY_ATTESTATION' };
}

export function validateExternalAuthorityAdapterReport(report, sources) {
  const errors = [];
  if (report?.schema_version !== EXTERNAL_AUTHORITY_ADAPTER_SCHEMA_VERSION) errors.push('schema_version:unexpected');
  if (report?.adapter_id !== EXTERNAL_AUTHORITY_ADAPTER_ID) errors.push('adapter_id:unexpected');
  if (report?.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report?.qualification_effect !== EXTERNAL_AUTHORITY_QUALIFICATION_EFFECT) errors.push('qualification_effect:must-be-none');
  if (report?.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report?.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if ((report?.trust_roots ?? []).length !== 0) errors.push('trust_roots:current-repository-must-not-ship-root');
  if (report?.accepted_attestation_schema !== EXTERNAL_AUTHORITY_ATTESTATION_SCHEMA_VERSION) {
    errors.push('accepted_attestation_schema:unexpected');
  }
  if (report?.adapter_sha256 !== externalAuthorityAdapterHash(report)) errors.push('adapter_sha256:mismatch');

  const expected = buildExternalAuthorityAdapterReport(sources);
  if (canonicalJson(report) !== canonicalJson(expected)) errors.push('report:source-binding-drift');

  const sourceGuardCount = report?.source_guards?.length ?? 0;
  const sourceGuardsCovered = report?.source_guards?.filter(guard => guard.coverage_status === 'covered').length ?? 0;
  const failureOracleCount = report?.failure_oracles?.length ?? 0;
  const failureOraclesCovered = report?.failure_oracles?.filter(oracle => oracle.coverage_status === 'covered').length ?? 0;
  if (sourceGuardCount !== REQUIRED_EXTERNAL_AUTHORITY_GUARDS.length) errors.push('source_guards:count-mismatch');
  if (sourceGuardsCovered !== REQUIRED_EXTERNAL_AUTHORITY_GUARDS.length) errors.push('source_guards:not-covered');
  if (failureOracleCount !== REQUIRED_EXTERNAL_AUTHORITY_FAILURE_ORACLES.length) errors.push('failure_oracles:count-mismatch');
  if (failureOraclesCovered !== REQUIRED_EXTERNAL_AUTHORITY_FAILURE_ORACLES.length) errors.push('failure_oracles:not-covered');
  if (countBypasses(report) !== 0) errors.push('bypasses:nonzero');
  if (report?.counts?.bypasses !== 0) errors.push('counts.bypasses:must-be-zero');
  if (report?.current_binding?.independent_authority_attested !== false) {
    errors.push('current_binding.independent_authority_attested:must-be-false');
  }
  if (report?.current_binding?.configured_and_bound !== false) {
    errors.push('current_binding.configured_and_bound:must-be-false');
  }
  return errors;
}

export function renderExternalAuthorityAdapterMarkdown(report) {
  const lines = [
    '# External Authority Adapter Contract',
    '',
    '> Generated from local machine sources. Do not hand edit.',
    '',
    `- Adapter ID: \`${report.adapter_id}\``,
    `- Adapter SHA-256: \`${report.adapter_sha256}\``,
    `- Source status: \`${report.source_status}\``,
    `- Trust roots: \`${report.counts.trust_roots}\``,
    `- Source guard coverage: \`${report.counts.source_guards_covered}/${report.counts.source_guards}\``,
    `- Failure oracle coverage: \`${report.counts.failure_oracles_covered}/${report.counts.failure_oracles}\``,
    `- Bypasses: \`${report.counts.bypasses}\``,
    `- Current authority status: \`${report.current_binding.independent_authority_status}\``,
    `- Claims permitted: \`${report.claims_permitted}\``,
    `- Asserts Gate 0 pass: \`${report.asserts_gate_pass}\``,
    '',
    '## Required Controls',
    '',
    ...report.required_controls.map(control => `- \`${control}\``),
    '',
    '## Source Guards',
    '',
    '| Guard | Source | Status |',
    '| --- | --- | --- |',
    ...report.source_guards.map(guard => (
      `| \`${guard.guard_id}\` | \`${guard.source_ref}\` | ${guard.coverage_status} |`
    )),
    '',
    '## Failure Oracles',
    '',
    '| Oracle | Expected Status | Status |',
    '| --- | --- | --- |',
    ...report.failure_oracles.map(oracle => (
      `| \`${oracle.oracle_id}\` | \`${oracle.expected_status}\` | ${oracle.coverage_status} |`
    )),
    '',
    'This adapter is an import contract only. The repository ships no trusted external root, creates no qualification claim, and cannot turn local evidence into Gate 0 PASS.',
  ];
  return `${lines.join('\n')}\n`;
}

function buildCoverageEntry(guard, sourceContents) {
  const source = getSource(sourceContents, guard.source_ref);
  const missing = guard.required_fragments.filter(fragment => !source.includes(fragment));
  return {
    guard_id: guard.guard_id,
    source_ref: guard.source_ref,
    required_fragments: [...guard.required_fragments],
    missing_fragments: missing,
    coverage_status: missing.length === 0 ? 'covered' : 'missing',
  };
}

function buildOracleEntry(oracle, testSource) {
  const missing = oracle.required_fragments.filter(fragment => !testSource.includes(fragment));
  return {
    oracle_id: oracle.oracle_id,
    expected_status: oracle.expected_status,
    required_fragments: [...oracle.required_fragments],
    missing_fragments: missing,
    coverage_status: missing.length === 0 ? 'covered' : 'missing',
  };
}

function countBypasses(report) {
  return [
    report?.claims_permitted !== false,
    report?.asserts_gate_pass !== false,
    report?.qualification_eligible !== false,
    report?.deny_policy?.boolean_pass_rejected !== true,
    report?.deny_policy?.ordinary_object_rejected !== true,
    report?.deny_policy?.local_fixture_fallback_rejected !== true,
    report?.deny_policy?.self_hash_trust_rejected !== true,
    report?.deny_policy?.revoked_or_expired_root_rejected !== true,
    report?.deny_policy?.role_reuse_rejected !== true,
    report?.deny_policy?.clock_rollback_rejected !== true,
    report?.deny_policy?.manifest_or_provenance_mismatch_rejected !== true,
    (report?.trust_roots ?? []).length !== 0,
    report?.current_binding?.independent_authority_attested !== false,
    report?.current_binding?.configured_and_bound !== false,
  ].filter(Boolean).length;
}

function hasDuplicateRoleKey(roleBindings = []) {
  const seen = new Set();
  for (const binding of roleBindings) {
    if (!binding?.key_id) continue;
    if (seen.has(binding.key_id)) return true;
    seen.add(binding.key_id);
  }
  return false;
}

function isClockRollback(timeAnchor = {}) {
  if (!timeAnchor.trusted_nonrollback_time) return true;
  const observed = Date.parse(timeAnchor.observed_at);
  const previous = Date.parse(timeAnchor.previous_observed_at);
  if (!Number.isFinite(observed) || !Number.isFinite(previous)) return true;
  return observed < previous;
}

function timeWindowCovers({ root, attestation, now }) {
  const instant = Date.parse(now);
  const rootNotBefore = Date.parse(root.not_before);
  const rootNotAfter = Date.parse(root.not_after);
  const validFrom = Date.parse(attestation.valid_from);
  const expiresAt = Date.parse(attestation.expires_at);
  const issuedAt = Date.parse(attestation.issued_at);
  return [instant, rootNotBefore, rootNotAfter, validFrom, expiresAt, issuedAt].every(Number.isFinite)
    && rootNotBefore <= instant
    && instant < rootNotAfter
    && validFrom <= issuedAt
    && issuedAt <= instant
    && instant < expiresAt;
}

function controlsSatisfied(controls = {}) {
  return REQUIRED_EXTERNAL_AUTHORITY_CONTROLS.every(control => controls[control] === true);
}

function sourceBindingsMatch(bindings = {}, expected = {}) {
  return bindings.capability_ledger_sha256 === expected.capability_ledger_sha256
    && bindings.profile_source_sha256 === expected.profile_source_sha256
    && bindings.evidence_source_sha256 === expected.evidence_source_sha256;
}

function manifestBindingMatches(binding = {}, expected = {}) {
  if (expected.expected_manifest_sha256 && binding.evidence_manifest_sha256 !== expected.expected_manifest_sha256) return false;
  if (expected.expected_provenance_sha256 && binding.provenance_sha256 !== expected.expected_provenance_sha256) return false;
  return true;
}

function signaturePayloadMatches(attestation) {
  return attestation?.signature?.payload_sha256 === externalAuthorityAttestationPayloadHash(attestation);
}

function verifyDetachedSignature(attestation, root) {
  try {
    if (attestation.signature?.algorithm !== 'ed25519') return false;
    const payload = canonicalJson(withoutKeys(attestation, ['signature']));
    return crypto.verify(
      null,
      Buffer.from(payload, 'utf8'),
      root.public_key_pem,
      Buffer.from(attestation.signature.signature_base64, 'base64'),
    );
  } catch {
    return false;
  }
}

function rejected(status) {
  return { accepted: false, status };
}

function getSource(sourceContents, sourceRef) {
  const source = sourceContents?.[sourceRef];
  if (typeof source !== 'string') throw new Error(`Missing source content for ${sourceRef}`);
  return source;
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function aggregatorPolicySourceHash(policy) {
  return sha256Object(withoutKeys(policy, ['policy_sha256']));
}

function withoutKeys(value, keys) {
  const copy = structuredClone(value);
  for (const key of keys) delete copy[key];
  return copy;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSourceObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name}:object-required`);
  }
}
