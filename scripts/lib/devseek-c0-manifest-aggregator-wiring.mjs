import crypto from 'node:crypto';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  ledgerHash,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const C0_MANIFEST_AGGREGATOR_WIRING_SCHEMA_VERSION = 'devseek.c0-manifest-aggregator-wiring/v1';
export const C0_MANIFEST_AGGREGATOR_WIRING_ID = 'DEVSEEK-GATE0-C0-MANIFEST-AGGREGATOR-WIRING/v1';
export const C0_MANIFEST_AGGREGATOR_WIRING_INTEGRITY_SCOPE = 'local-manifest-aggregator-wiring-conformance';
export const C0_MANIFEST_AGGREGATOR_WIRING_QUALIFICATION_EFFECT = 'NONE';
export const AGGREGATOR_CAPABILITY_ID = 'C0-QUALIFICATION-AGGREGATOR';
export const MANIFEST_CAPABILITY_ID = 'C0-QUALIFICATION-EVIDENCE-MANIFEST';

export const REQUIRED_AGGREGATOR_COMPONENTS = Object.freeze([
  'docs/process/devseek-qualification-aggregator-policy.schema.json',
  'docs/process/devseek-qualification-aggregator-policy.json',
  'docs/process/generated/devseek-qualification-evidence-manifest.md',
  'docs/process/devseek-c0-manifest-aggregator-wiring.json',
  'docs/process/devseek-c0-manifest-aggregator-wiring.schema.json',
  'docs/process/generated/devseek-c0-manifest-aggregator-wiring.md',
  'scripts/devseek-qualification-evidence-manifest-check.mjs',
  'scripts/devseek-c0-manifest-aggregator-wiring-check.mjs',
  'scripts/lib/devseek-c0-manifest-aggregator-wiring.mjs',
  'scripts/lib/devseek-qualification-evidence-manifest.mjs',
  'scripts/test/devseek-c0-manifest-aggregator-wiring.test.mjs',
  'scripts/test/devseek-qualification-evidence-manifest.test.mjs',
]);

export const REQUIRED_MANIFEST_COMPONENTS = Object.freeze([
  'docs/process/devseek-qualification-evidence-manifest.schema.json',
  'docs/process/devseek-qualification-retention-lock.schema.json',
  'docs/process/generated/devseek-qualification-evidence-manifest.md',
  'docs/process/devseek-c0-manifest-aggregator-wiring.json',
  'docs/process/devseek-c0-manifest-aggregator-wiring.schema.json',
  'docs/process/generated/devseek-c0-manifest-aggregator-wiring.md',
  'scripts/devseek-qualification-evidence-manifest-check.mjs',
  'scripts/devseek-c0-manifest-aggregator-wiring-check.mjs',
  'scripts/lib/devseek-c0-manifest-aggregator-wiring.mjs',
  'scripts/lib/devseek-qualification-evidence-manifest.mjs',
  'scripts/test/devseek-c0-manifest-aggregator-wiring.test.mjs',
  'scripts/test/devseek-qualification-evidence-manifest.test.mjs',
]);

export const REQUIRED_AGGREGATION_GUARDS = Object.freeze([
  {
    guard_id: 'independent-derived-manifest',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'const derived = independentlyAggregateFrozenEvidence(frozenEvidence, aggregationPolicy, generatedAt);',
      'MANIFEST_DERIVATION_MISMATCH',
      'qualificationEvidenceManifestHash(manifest)',
    ],
  },
  {
    guard_id: 'denominator-and-slot-accounting',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'deriveSlotAccounting({ plan, streams })',
      'planned_coverage',
      'attempt_slot_bindings',
      'ATTEMPT_SLOT_BINDING_INVALID',
    ],
  },
  {
    guard_id: 'failure-and-veto-preservation',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'failures_and_vetoes',
      "outcome === 'product-miss'",
      "outcome === 'veto'",
      'preflight_vetoes',
    ],
  },
  {
    guard_id: 'retention-lock-and-anchor',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'ImmutableQualificationManifestStore',
      'RETENTION_EXPECTED_ANCHOR_MISMATCH',
      'MANIFEST_ID_REBIND_FORBIDDEN',
      'RETAINED_MANIFEST_REPLACED',
    ],
  },
  {
    guard_id: 'current-state-and-provenance-invalidates',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'assertCurrentStateMatchesManifest(currentState, manifest)',
      'CURRENT_STATE_REQUIRED_OR_MISMATCH',
      'MANIFEST_EVENT_HEAD_INVALIDATED',
      'MANIFEST_CURRENT_IDENTITY_INVALIDATED',
    ],
  },
  {
    guard_id: 'exact-claim-and-dependency-binding',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'findExactDependency(required, claims)',
      'claim.profile_sha256 === required.profile_sha256',
      'claim.surface === required.surface',
      'claim.platform_profile === required.platform_profile',
    ],
  },
  {
    guard_id: 'local-policy-cannot-claim',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'assertPolicyQualificationBoundary(policy)',
      'qualification_claims: manifest.qualification_eligible',
      'policy.qualification_eligible !== false',
    ],
  },
  {
    guard_id: 'run-evidence-auxiliary-only',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'validateRunEvidenceAuxiliary(frozenEvidence.run_evidence_auxiliary',
      'auxiliary_only: true',
      'RUN_EVIDENCE_OUTCOME_BINDING_MISMATCH',
    ],
  },
]);

export const REQUIRED_FAILURE_ORACLES = Object.freeze([
  {
    oracle_id: 'writer-forged-summary',
    expected_error: 'MANIFEST_DERIVATION_MISMATCH',
    required_fragments: [
      'allowlisted signer cannot omit a signed failure or invent a cross-tuple claim',
      'MANIFEST_DERIVATION_MISMATCH',
    ],
  },
  {
    oracle_id: 'denominator-conserved',
    expected_error: 'denominator',
    required_fragments: [
      'independent aggregation freezes all slots/attempts, conserves denominator',
      'planned_coverage_slot_count',
    ],
  },
  {
    oracle_id: 'primary-failure-sticky',
    expected_error: 'product-miss',
    required_fragments: [
      'a valid infra retry preserves the failed primary attempt instead of last-pass overwrite',
      'product-miss',
    ],
  },
  {
    oracle_id: 'preflight-session-veto',
    expected_error: 'veto',
    required_fragments: [
      'preflight/session semantic failures are explicit claim vetoes',
      'preflight-blocked-ready-conflict',
    ],
  },
  {
    oracle_id: 'current-state-provenance-drift',
    expected_error: 'MANIFEST_EVENT_HEAD_INVALIDATED',
    required_fragments: [
      'candidate, dependency, provider, surface, platform, environment, and event-head changes invalidate the manifest',
      'CURRENT_STATE_REQUIRED_OR_MISMATCH',
    ],
  },
  {
    oracle_id: 'dependency-exactness',
    expected_error: 'DEPENDENCY_MANIFEST_NOT_QUALIFICATION_ELIGIBLE',
    required_fragments: [
      'recursive dependency current validity uses top-level now, not the dependency historical generated_at',
      'DEPENDENCY_MANIFEST_NOT_QUALIFICATION_ELIGIBLE',
    ],
  },
  {
    oracle_id: 'retention-anchor-and-rebind',
    expected_error: 'MANIFEST_ID_REBIND_FORBIDDEN',
    required_fragments: [
      'immutable retention store detects re-sign/rebind, deletion, and replacement with an independent anchor',
      'MANIFEST_ID_REBIND_FORBIDDEN',
    ],
  },
  {
    oracle_id: 'run-evidence-correlation-not-verdict',
    expected_error: 'RUN_EVIDENCE_OUTCOME_BINDING_MISMATCH',
    required_fragments: [
      'run evidence correlation exact-binds operation, attempt, candidate, anchor, scope, and failed outcome',
      'RUN_EVIDENCE_OUTCOME_BINDING_MISMATCH',
    ],
  },
]);

export function c0ManifestAggregatorWiringHash(report) {
  return sha256Object(withoutKeys(report, ['wiring_sha256']), report?.integrity);
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function buildC0ManifestAggregatorWiring({
  ledger,
  aggregationPolicy,
  packageJson,
  sourceContents,
} = {}) {
  assertSourceObject(ledger, 'ledger');
  assertSourceObject(aggregationPolicy, 'aggregationPolicy');
  assertSourceObject(packageJson, 'packageJson');
  assertSourceObject(sourceContents, 'sourceContents');

  const aggregator = findCapability(ledger, AGGREGATOR_CAPABILITY_ID);
  const manifest = findCapability(ledger, MANIFEST_CAPABILITY_ID);
  const aggregatorComponents = new Set((aggregator.implementation_components ?? []).map(component => component.path));
  const manifestComponents = new Set((manifest.implementation_components ?? []).map(component => component.path));
  const manifestSource = getSource(sourceContents, 'scripts/lib/devseek-qualification-evidence-manifest.mjs');
  const manifestTest = getSource(sourceContents, 'scripts/test/devseek-qualification-evidence-manifest.test.mjs');
  const packageSource = getSource(sourceContents, 'package.json');
  const phaseSource = getSource(sourceContents, 'scripts/devseek-phase0-12-verify.mjs');
  const manifestSchema = getSource(sourceContents, 'docs/process/devseek-qualification-evidence-manifest.schema.json');
  const retentionSchema = getSource(sourceContents, 'docs/process/devseek-qualification-retention-lock.schema.json');
  const policySchema = getSource(sourceContents, 'docs/process/devseek-qualification-aggregator-policy.schema.json');
  const runEvidenceWiring = getSource(sourceContents, 'docs/process/devseek-c0-run-evidence-wiring.json');

  const aggregationGuards = REQUIRED_AGGREGATION_GUARDS.map(guard => buildCoverageEntry(guard, sourceContents));
  const failureOracles = REQUIRED_FAILURE_ORACLES.map(oracle => buildOracleEntry(oracle, manifestTest));
  const bypassGuards = {
    writer_summary_trusted: false,
    same_repository_self_hash_trusted_as_protected_authority: false,
    any_profile_some_claim_allowed: false,
    local_manifest_claims_permitted: false,
    external_authority_fabricated: false,
    product_run_evidence_may_promote_claim: false,
  };
  const bypassCount = Object.values(bypassGuards).filter(Boolean).length
    + aggregationGuards.filter(guard => guard.coverage_status !== 'covered').length
    + failureOracles.filter(oracle => oracle.coverage_status !== 'covered').length;

  const report = {
    schema_version: C0_MANIFEST_AGGREGATOR_WIRING_SCHEMA_VERSION,
    integrity: { ...SUPPORTED_INTEGRITY },
    wiring_id: C0_MANIFEST_AGGREGATOR_WIRING_ID,
    wiring_version: 1,
    source_status: 'verified',
    integrity_scope: C0_MANIFEST_AGGREGATOR_WIRING_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: C0_MANIFEST_AGGREGATOR_WIRING_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    sources: {
      capability_ledger: {
        path: 'docs/process/devseek-capability-ledger.json',
        schema_version: ledger.schema_version,
        ledger_id: ledger.ledger_id,
        source_sha256: ledgerHash(ledger),
      },
      aggregator_policy: {
        path: 'docs/process/devseek-qualification-aggregator-policy.json',
        policy_id: aggregationPolicy.policy_id,
        policy_sha256: aggregationPolicy.policy_sha256,
        source_sha256: sha256Text(getSource(sourceContents, 'docs/process/devseek-qualification-aggregator-policy.json')),
      },
      aggregator_policy_schema: sourceRef('docs/process/devseek-qualification-aggregator-policy.schema.json', sourceContents),
      qualification_evidence_manifest_schema: sourceRef('docs/process/devseek-qualification-evidence-manifest.schema.json', sourceContents),
      qualification_retention_lock_schema: sourceRef('docs/process/devseek-qualification-retention-lock.schema.json', sourceContents),
      qualification_plan_schema: sourceRef('docs/process/devseek-qualification-plan.schema.json', sourceContents),
      qualification_event_schema: sourceRef('docs/process/devseek-qualification-event.schema.json', sourceContents),
      qualification_receipt_schema: sourceRef('docs/process/devseek-qualification-receipt.schema.json', sourceContents),
      run_evidence_correlation_schema: sourceRef('docs/process/devseek-run-evidence-correlation.schema.json', sourceContents),
      run_evidence_wiring_source: {
        path: 'docs/process/devseek-c0-run-evidence-wiring.json',
        source_sha256: sha256Text(runEvidenceWiring),
      },
      qualification_evidence_manifest_source: sourceRef('scripts/lib/devseek-qualification-evidence-manifest.mjs', sourceContents),
      qualification_evidence_manifest_checker: sourceRef('scripts/devseek-qualification-evidence-manifest-check.mjs', sourceContents),
      qualification_evidence_manifest_oracle: sourceRef('scripts/test/devseek-qualification-evidence-manifest.test.mjs', sourceContents),
      package_scripts: sourceRef('package.json', sourceContents),
      phase_gate_source: sourceRef('scripts/devseek-phase0-12-verify.mjs', sourceContents),
      checker_source: sourceRef('scripts/devseek-c0-manifest-aggregator-wiring-check.mjs', sourceContents),
      oracle_source: sourceRef('scripts/test/devseek-c0-manifest-aggregator-wiring.test.mjs', sourceContents),
    },
    owners: {
      aggregator: ownerSummary({
        capability: aggregator,
        requiredComponents: REQUIRED_AGGREGATOR_COMPONENTS,
        componentSet: aggregatorComponents,
        expectedPort: 'QualificationAggregationPort',
      }),
      evidence_manifest: ownerSummary({
        capability: manifest,
        requiredComponents: REQUIRED_MANIFEST_COMPONENTS,
        componentSet: manifestComponents,
        expectedPort: 'QualificationEvidenceManifestPort',
      }),
    },
    aggregation_contract: {
      adapter_id: 'G0-C-MANIFEST-AGGREGATOR-ADAPTER/v1',
      adapter_source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs#aggregateQualificationEvidence',
      policy_path: 'docs/process/devseek-qualification-aggregator-policy.json',
      manifest_schema_path: 'docs/process/devseek-qualification-evidence-manifest.schema.json',
      retention_schema_path: 'docs/process/devseek-qualification-retention-lock.schema.json',
      package_script_present: Boolean(packageJson.scripts?.['verify:c0-manifest-aggregator-wiring'])
        && packageSource.includes('"verify:c0-manifest-aggregator-wiring"'),
      phase_gate_id: 'c0-manifest-aggregator-wiring-conformance',
      phase_gate_present: phaseSource.includes("id: 'c0-manifest-aggregator-wiring-conformance'"),
      policy_local_only: aggregationPolicy.integrity_scope === 'local-protocol-conformance'
        && aggregationPolicy.qualification_eligible === false
        && aggregationPolicy.source_status === 'test-fixture',
      policy_has_zero_repository_claim_rules: Array.isArray(aggregationPolicy.claim_rules)
        && aggregationPolicy.claim_rules.length === 0,
      manifest_schema_requires_run_evidence_auxiliary: manifestSchema.includes('"run_evidence_auxiliary"'),
      retention_schema_requires_external_anchor_boundary: retentionSchema.includes('"retention-lock-or-worm"')
        && retentionSchema.includes('"append-only-local-cas"'),
      policy_schema_forbids_unknowns: policySchema.includes('"additionalProperties": false'),
      run_evidence_wiring_is_prerequisite: runEvidenceWiring.includes('"run_evidence_owner"')
        && runEvidenceWiring.includes('"qualification_effect": "NONE"'),
      reader_recomputes_manifest_derivation: manifestSource.includes('const expected = independentlyAggregateFrozenEvidence(')
        && manifestSource.includes('MANIFEST_DERIVATION_MISMATCH'),
      reader_rejects_writer_summary: manifestSource.includes('MANIFEST_DERIVATION_MISMATCH')
        && !manifestSource.includes('writer_summary_trusted'),
      reader_verifies_retention_and_anchor: manifestSource.includes('verifyRetentionLock(')
        && manifestSource.includes('RETENTION_EXPECTED_ANCHOR_MISMATCH'),
      reader_checks_current_state_and_provenance: manifestSource.includes('assertCurrentStateMatchesManifest(state, manifest)')
        && manifestSource.includes('MANIFEST_EVENT_HEAD_INVALIDATED'),
      reader_preserves_failures_and_vetoes: manifestSource.includes('failures_and_vetoes')
        && manifestSource.includes("outcome === 'product-miss'")
        && manifestSource.includes("outcome === 'veto'"),
      reader_requires_exact_dependency_tuple: manifestSource.includes('findExactDependency(required, claims)')
        && manifestSource.includes('claim.profile_sha256 === required.profile_sha256')
        && manifestSource.includes('claim.surface === required.surface'),
      reader_consumes_run_evidence_as_auxiliary: manifestSource.includes('validateRunEvidenceAuxiliary(')
        && manifestSource.includes('auxiliary_only: true'),
      aggregator_produces_protected_claims_locally: false,
      same_repository_hash_is_trust_root: false,
      writer_summary_is_authoritative: false,
      qualification_effect: 'NONE',
    },
    aggregation_guards: aggregationGuards,
    failure_oracles: failureOracles,
    bypass_guards: bypassGuards,
    counts: {
      owners: 2,
      owner_required_components: REQUIRED_AGGREGATOR_COMPONENTS.length + REQUIRED_MANIFEST_COMPONENTS.length,
      owner_required_components_present: countPresent(REQUIRED_AGGREGATOR_COMPONENTS, aggregatorComponents)
        + countPresent(REQUIRED_MANIFEST_COMPONENTS, manifestComponents),
      aggregation_guards: aggregationGuards.length,
      aggregation_guards_covered: aggregationGuards.filter(guard => guard.coverage_status === 'covered').length,
      failure_oracles: failureOracles.length,
      failure_oracles_covered: failureOracles.filter(oracle => oracle.coverage_status === 'covered').length,
      bypasses: bypassCount,
      qualification_claims: 0,
    },
    wiring_sha256: null,
  };
  report.wiring_sha256 = c0ManifestAggregatorWiringHash(report);
  return report;
}

export function validateC0ManifestAggregatorWiring(report, sources) {
  const errors = [];
  if (!isObject(report)) {
    return { ok: false, errors: ['wiring:expected-object'], summary: null };
  }
  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildC0ManifestAggregatorWiring(sources);
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }
  if (expected && canonicalJson(report) !== canonicalJson(expected)) {
    errors.push('wiring:deterministic-source-drift');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeWiring(expected) : null,
  };
}

export function renderC0ManifestAggregatorWiringMarkdown(report) {
  const lines = [
    '# C0 Manifest Aggregator Wiring',
    '',
    '> Generated from local machine sources. Do not hand edit.',
    '',
    `- Wiring ID: \`${report.wiring_id}\``,
    `- Wiring SHA-256: \`${report.wiring_sha256}\``,
    `- Capability ledger SHA-256: \`${report.sources.capability_ledger.source_sha256}\``,
    `- Aggregator owner: \`${report.owners.aggregator.capability_id}\` / \`${report.owners.aggregator.implementation_state}\``,
    `- Manifest owner: \`${report.owners.evidence_manifest.capability_id}\` / \`${report.owners.evidence_manifest.implementation_state}\``,
    `- Guard coverage: \`${report.counts.aggregation_guards_covered}/${report.counts.aggregation_guards}\``,
    `- Failure oracle coverage: \`${report.counts.failure_oracles_covered}/${report.counts.failure_oracles}\``,
    `- Bypasses: \`${report.counts.bypasses}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${report.claims_permitted}\``,
    `- Asserts Gate 0 pass: \`${report.asserts_gate_pass}\``,
    '',
    '## Aggregation Guards',
    '',
    '| Guard | Source | Status |',
    '| --- | --- | --- |',
    ...report.aggregation_guards.map(guard => (
      `| \`${guard.guard_id}\` | \`${guard.source_ref}\` | ${guard.coverage_status} |`
    )),
    '',
    '## Failure Oracles',
    '',
    '| Oracle | Expected Evidence | Status |',
    '| --- | --- | --- |',
    ...report.failure_oracles.map(oracle => (
      `| \`${oracle.oracle_id}\` | \`${oracle.expected_error}\` | ${oracle.coverage_status} |`
    )),
    '',
    'This wiring proves only local manifest aggregation reachability and bypass coverage. The local policy is not protected qualification authority; it cannot create claims, promote Gate 0, or replace external attestation and WORM retention.',
  ];
  return `${lines.join('\n')}\n`;
}

function semanticValidate(report, errors) {
  if (report.schema_version !== C0_MANIFEST_AGGREGATOR_WIRING_SCHEMA_VERSION) errors.push('schema_version:unexpected');
  if (report.wiring_id !== C0_MANIFEST_AGGREGATOR_WIRING_ID) errors.push('wiring_id:unexpected');
  if (report.integrity_scope !== C0_MANIFEST_AGGREGATOR_WIRING_INTEGRITY_SCOPE) errors.push('integrity_scope:unexpected');
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (report.wiring_sha256 !== c0ManifestAggregatorWiringHash(report)) errors.push('wiring_sha256:mismatch');

  for (const [ownerKey, expectedId] of [
    ['aggregator', AGGREGATOR_CAPABILITY_ID],
    ['evidence_manifest', MANIFEST_CAPABILITY_ID],
  ]) {
    const owner = report.owners?.[ownerKey];
    if (!owner) {
      errors.push(`owners.${ownerKey}:missing`);
      continue;
    }
    if (owner.capability_id !== expectedId) errors.push(`owners.${ownerKey}.capability_id:unexpected`);
    if (owner.implementation_state !== 'wired') errors.push(`owners.${ownerKey}.implementation_state:not-wired`);
    for (const component of owner.required_component_paths ?? []) {
      if (component.present !== true) errors.push(`owners.${ownerKey}.component:${component.path}:missing`);
    }
    if (!owner.verification_has_qualification_evidence_manifest) {
      errors.push(`owners.${ownerKey}.verification_has_qualification_evidence_manifest:missing`);
    }
    if (!owner.verification_has_c0_manifest_aggregator_wiring) {
      errors.push(`owners.${ownerKey}.verification_has_c0_manifest_aggregator_wiring:missing`);
    }
  }

  const contract = report.aggregation_contract ?? {};
  for (const field of [
    'package_script_present',
    'phase_gate_present',
    'policy_local_only',
    'policy_has_zero_repository_claim_rules',
    'manifest_schema_requires_run_evidence_auxiliary',
    'retention_schema_requires_external_anchor_boundary',
    'policy_schema_forbids_unknowns',
    'run_evidence_wiring_is_prerequisite',
    'reader_recomputes_manifest_derivation',
    'reader_rejects_writer_summary',
    'reader_verifies_retention_and_anchor',
    'reader_checks_current_state_and_provenance',
    'reader_preserves_failures_and_vetoes',
    'reader_requires_exact_dependency_tuple',
    'reader_consumes_run_evidence_as_auxiliary',
  ]) {
    if (contract[field] !== true) errors.push(`aggregation_contract.${field}:missing`);
  }
  for (const field of [
    'aggregator_produces_protected_claims_locally',
    'same_repository_hash_is_trust_root',
    'writer_summary_is_authoritative',
  ]) {
    if (contract[field] !== false) errors.push(`aggregation_contract.${field}:must-be-false`);
  }
  if (contract.qualification_effect !== 'NONE') errors.push('aggregation_contract.qualification_effect:must-be-NONE');

  for (const guard of report.aggregation_guards ?? []) {
    if (guard.coverage_status !== 'covered' || guard.fragments_present !== true) {
      errors.push(`aggregation_guards.${guard.guard_id}:not-covered`);
    }
  }
  for (const oracle of report.failure_oracles ?? []) {
    if (oracle.coverage_status !== 'covered' || oracle.fragments_present !== true) {
      errors.push(`failure_oracles.${oracle.oracle_id}:not-covered`);
    }
  }
  for (const [key, value] of Object.entries(report.bypass_guards ?? {})) {
    if (value !== false) errors.push(`bypass_guards.${key}:must-be-false`);
  }
  if (report.counts?.bypasses !== 0) errors.push('counts.bypasses:must-be-zero');
  if (report.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-zero');
}

function summarizeWiring(report) {
  return {
    ledger_sha256: report.sources.capability_ledger.source_sha256,
    aggregator_owner: report.owners.aggregator.capability_id,
    manifest_owner: report.owners.evidence_manifest.capability_id,
    aggregator_state: report.owners.aggregator.implementation_state,
    manifest_state: report.owners.evidence_manifest.implementation_state,
    owner_components_present: report.counts.owner_required_components_present,
    aggregation_guards_covered: report.counts.aggregation_guards_covered,
    failure_oracles_covered: report.counts.failure_oracles_covered,
    bypasses: report.counts.bypasses,
    qualification_effect: report.qualification_effect,
    claims_permitted: report.claims_permitted,
    asserts_gate_pass: report.asserts_gate_pass,
  };
}

function ownerSummary({ capability, requiredComponents, componentSet, expectedPort }) {
  const verificationCommands = capability.verification?.commands ?? [];
  return {
    capability_id: capability.capability_id,
    implementation_state: capability.implementation_state,
    authority_port: capability.semantic_authority?.port,
    required_component_paths: requiredComponents.map(componentPath => ({
      path: componentPath,
      present: componentSet.has(componentPath),
    })),
    verification_commands: verificationCommands,
    verification_has_qualification_evidence_manifest: verificationCommands.includes('npm run verify:qualification-evidence-manifest'),
    verification_has_c0_manifest_aggregator_wiring: verificationCommands.includes('npm run verify:c0-manifest-aggregator-wiring'),
    expected_authority_port: expectedPort,
  };
}

function buildCoverageEntry(guard, sourceContents) {
  const source = getSource(sourceContents, guard.source_ref);
  const fragmentsPresent = guard.required_fragments.every(fragment => source.includes(fragment));
  return {
    ...guard,
    fragments_present: fragmentsPresent,
    coverage_status: fragmentsPresent ? 'covered' : 'not-covered',
  };
}

function buildOracleEntry(oracle, testSource) {
  const fragmentsPresent = oracle.required_fragments.every(fragment => testSource.includes(fragment));
  return {
    oracle_id: oracle.oracle_id,
    expected_error: oracle.expected_error,
    source_ref: 'scripts/test/devseek-qualification-evidence-manifest.test.mjs',
    fragments_present: fragmentsPresent,
    coverage_status: fragmentsPresent ? 'covered' : 'not-covered',
  };
}

function sourceRef(relativePath, sourceContents) {
  return {
    path: relativePath,
    source_sha256: sha256Text(getSource(sourceContents, relativePath)),
  };
}

function getSource(sourceContents, relativePath) {
  const source = sourceContents?.[relativePath];
  if (typeof source !== 'string') throw new Error(`missing source content: ${relativePath}`);
  return source;
}

function countPresent(paths, componentSet) {
  return paths.filter(componentPath => componentSet.has(componentPath)).length;
}

function findCapability(ledger, capabilityId) {
  const capability = ledger.capabilities?.find(entry => entry.capability_id === capabilityId);
  if (!capability) throw new Error(`missing capability ${capabilityId}`);
  return capability;
}

function assertSourceObject(value, name) {
  if (!isObject(value)) throw new Error(`${name} must be an object`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withoutKeys(value, keys) {
  const clone = structuredClone(value);
  for (const key of keys) delete clone[key];
  return clone;
}
