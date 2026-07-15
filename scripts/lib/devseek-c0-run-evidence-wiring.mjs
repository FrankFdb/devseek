import crypto from 'node:crypto';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  ledgerHash,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const C0_RUN_EVIDENCE_WIRING_SCHEMA_VERSION = 'devseek.c0-run-evidence-wiring/v1';
export const C0_RUN_EVIDENCE_WIRING_ID = 'DEVSEEK-GATE0-C0-RUN-EVIDENCE-WIRING/v1';
export const C0_RUN_EVIDENCE_WIRING_INTEGRITY_SCOPE = 'local-run-evidence-wiring-conformance';
export const C0_RUN_EVIDENCE_WIRING_QUALIFICATION_EFFECT = 'NONE';
export const RUN_EVIDENCE_CAPABILITY_ID = 'C0-RUN-EVIDENCE-LEDGER';

export const REQUIRED_OWNER_COMPONENTS = Object.freeze([
  'docs/process/devseek-c0-run-evidence-wiring.json',
  'docs/process/devseek-c0-run-evidence-wiring.schema.json',
  'docs/process/devseek-run-evidence-correlation.schema.json',
  'docs/process/generated/devseek-c0-run-evidence-wiring.md',
  'scripts/devseek-c0-run-evidence-wiring-check.mjs',
  'scripts/lib/devseek-c0-run-evidence-wiring.mjs',
  'scripts/lib/devseek-qualification-evidence-manifest.mjs',
  'scripts/test/devseek-c0-run-evidence-wiring.test.mjs',
  'scripts/test/devseek-qualification-evidence-manifest.test.mjs',
]);

export const REQUIRED_BINDING_GUARDS = Object.freeze([
  {
    guard_id: 'sealed-independent-anchor',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'RUN_EVIDENCE_SEALED_ANCHOR_MISMATCH',
      'verifyRunEvidenceSnapshot(snapshot);',
    ],
  },
  {
    guard_id: 'correlation-schema-and-local-scope',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'SCHEMAS.runCorrelation',
      'RUN_EVIDENCE_CORRELATION_SCHEMA_INVALID',
    ],
  },
  {
    guard_id: 'plan-candidate-attempt-binding',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'RUN_EVIDENCE_PLAN_BINDING_MISMATCH',
      'RUN_EVIDENCE_CANDIDATE_BINDING_MISMATCH',
      'RUN_EVIDENCE_ATTEMPT_BINDING_MISMATCH',
    ],
  },
  {
    guard_id: 'run-observed-payload-binding',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'RUN_EVIDENCE_OBSERVATION_PAYLOAD_BINDING_MISMATCH',
      'payload.run_evidence_auxiliary !== true',
      "payload.qualification_effect !== 'NONE'",
    ],
  },
  {
    guard_id: 'operation-event-binding',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'RUN_EVIDENCE_OPERATION_BINDING_MISMATCH',
      "operationEvent.payload?.trust !== 'product-runtime-observation'",
      "operationEvent.type === 'run.opened'",
    ],
  },
  {
    guard_id: 'oracle-outcome-preserved',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'RUN_EVIDENCE_OUTCOME_BINDING_MISMATCH',
      'correlation.attempt_outcome !== attemptOutcome',
      "terminal.event_type !== 'AttemptTerminated'",
    ],
  },
  {
    guard_id: 'auxiliary-only-manifest-output',
    source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    required_fragments: [
      'auxiliary_only: true',
      'qualification_eligible: false',
      'correlation_sha256: sha256Object(correlation)',
    ],
  },
]);

export const REQUIRED_FAILURE_ORACLES = Object.freeze([
  {
    oracle_id: 'wrong-candidate',
    expected_error: 'RUN_EVIDENCE_CANDIDATE_BINDING_MISMATCH',
  },
  {
    oracle_id: 'wrong-attempt',
    expected_error: 'RUN_EVIDENCE_ATTEMPT_BINDING_MISMATCH',
  },
  {
    oracle_id: 'wrong-operation',
    expected_error: 'RUN_EVIDENCE_OPERATION_BINDING_MISMATCH',
  },
  {
    oracle_id: 'wrong-anchor',
    expected_error: 'RUN_EVIDENCE_ANCHOR_BINDING_MISMATCH',
  },
  {
    oracle_id: 'wrong-scope',
    expected_error: 'RUN_EVIDENCE_CORRELATION_SCHEMA_INVALID',
  },
  {
    oracle_id: 'unsealed-evidence',
    expected_error: 'RUN_EVIDENCE_SEALED_ANCHOR_MISMATCH',
    required_fragments: [
      'snapshot.seal = null',
      'snapshot.head.sealed = false',
    ],
  },
  {
    oracle_id: 'hidden-original-failure',
    expected_error: 'RUN_EVIDENCE_OUTCOME_BINDING_MISMATCH',
    required_fragments: [
      "outcome: 'product-miss'",
      "correlation.attempt_outcome = 'pass'",
    ],
  },
]);

export function c0RunEvidenceWiringHash(report) {
  return sha256Object(withoutKeys(report, ['wiring_sha256']), report?.integrity);
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function buildC0RunEvidenceWiring({
  ledger,
  packageJson,
  sourceContents,
} = {}) {
  assertSourceObject(ledger, 'ledger');
  assertSourceObject(packageJson, 'packageJson');
  assertSourceObject(sourceContents, 'sourceContents');

  const capability = findCapability(ledger, RUN_EVIDENCE_CAPABILITY_ID);
  const ownerComponents = new Set((capability.implementation_components ?? []).map(component => component.path));
  const verificationCommands = capability.verification?.commands ?? [];
  const packageSource = sourceContents['package.json'] ?? '';
  const phaseSource = sourceContents['scripts/devseek-phase0-12-verify.mjs'] ?? '';
  const manifestSource = sourceContents['scripts/lib/devseek-qualification-evidence-manifest.mjs'] ?? '';
  const manifestSchema = sourceContents['docs/process/devseek-qualification-evidence-manifest.schema.json'] ?? '';
  const correlationSchema = sourceContents['docs/process/devseek-run-evidence-correlation.schema.json'] ?? '';

  const bindingGuards = REQUIRED_BINDING_GUARDS.map(guard => buildFragmentBinding(guard, sourceContents));
  const failureOracles = REQUIRED_FAILURE_ORACLES.map(oracle => {
    const source = sourceContents['scripts/test/devseek-qualification-evidence-manifest.test.mjs'] ?? '';
    const fragmentsPresent = source.includes(oracle.expected_error)
      && (oracle.required_fragments ?? [oracle.oracle_id]).every(fragment => source.includes(fragment));
    return {
      oracle_id: oracle.oracle_id,
      expected_error: oracle.expected_error,
      source_ref: 'scripts/test/devseek-qualification-evidence-manifest.test.mjs',
      fragments_present: fragmentsPresent,
      coverage_status: fragmentsPresent ? 'covered' : 'blocked',
    };
  });

  const report = {
    schema_version: C0_RUN_EVIDENCE_WIRING_SCHEMA_VERSION,
    integrity: structuredClone(SUPPORTED_INTEGRITY),
    wiring_id: C0_RUN_EVIDENCE_WIRING_ID,
    wiring_version: 1,
    source_status: 'verified',
    integrity_scope: C0_RUN_EVIDENCE_WIRING_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: C0_RUN_EVIDENCE_WIRING_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    sources: {
      capability_ledger: {
        path: 'docs/process/devseek-capability-ledger.json',
        schema_version: ledger.schema_version,
        ledger_id: ledger.ledger_id,
        source_sha256: ledgerHash(ledger),
      },
      qualification_evidence_manifest_schema: sourceRef(
        'docs/process/devseek-qualification-evidence-manifest.schema.json',
        sourceContents,
      ),
      run_evidence_event_schema: sourceRef('docs/process/devseek-run-evidence-event.schema.json', sourceContents),
      run_evidence_snapshot_schema: sourceRef('docs/process/devseek-run-evidence-snapshot.schema.json', sourceContents),
      run_evidence_expected_anchor_schema: sourceRef(
        'docs/process/devseek-run-evidence-expected-anchor.schema.json',
        sourceContents,
      ),
      run_evidence_correlation_schema: sourceRef('docs/process/devseek-run-evidence-correlation.schema.json', sourceContents),
      qualification_evidence_manifest_source: sourceRef(
        'scripts/lib/devseek-qualification-evidence-manifest.mjs',
        sourceContents,
      ),
      qualification_evidence_manifest_oracle: sourceRef(
        'scripts/test/devseek-qualification-evidence-manifest.test.mjs',
        sourceContents,
      ),
      run_evidence_contract_checker: sourceRef('scripts/devseek-run-evidence-contract-check.mjs', sourceContents),
      run_evidence_contract_oracle: sourceRef('scripts/test/devseek-run-evidence-contract.test.mjs', sourceContents),
      package_scripts: sourceRef('package.json', sourceContents),
      phase_gate_source: sourceRef('scripts/devseek-phase0-12-verify.mjs', sourceContents),
      checker_source: sourceRef('scripts/devseek-c0-run-evidence-wiring-check.mjs', sourceContents),
      oracle_source: sourceRef('scripts/test/devseek-c0-run-evidence-wiring.test.mjs', sourceContents),
    },
    run_evidence_owner: {
      capability_id: capability.capability_id,
      implementation_state: capability.implementation_state,
      authority_port: capability.semantic_authority?.port,
      required_component_paths: REQUIRED_OWNER_COMPONENTS.map(componentPath => ({
        path: componentPath,
        present: ownerComponents.has(componentPath),
      })),
      verification_commands: verificationCommands,
      verification_has_run_evidence_contract: verificationCommands.includes('npm run verify:run-evidence-contract'),
      verification_has_qualification_evidence_manifest: verificationCommands.includes('npm run verify:qualification-evidence-manifest'),
      verification_has_c0_run_evidence_wiring: verificationCommands.includes('npm run verify:c0-run-evidence-wiring'),
    },
    correlation_contract: {
      adapter_id: 'G0-D-RUN-EVIDENCE-CORRELATION-ADAPTER/v1',
      adapter_source_ref: 'scripts/lib/devseek-qualification-evidence-manifest.mjs#validateRunEvidenceAuxiliary',
      correlation_schema_path: 'docs/process/devseek-run-evidence-correlation.schema.json',
      manifest_output_schema_path: 'docs/process/devseek-qualification-evidence-manifest.schema.json#/$defs/runEvidence',
      schema_has_local_scope: correlationSchema.includes('"integrity_scope": { "const": "local-run-evidence-correlation-conformance" }'),
      schema_forbids_claims: correlationSchema.includes('"claims_permitted": { "const": false }')
        && correlationSchema.includes('"asserts_gate_pass": { "const": false }'),
      manifest_output_has_exact_binding_fields: [
        'operation_event_sha256',
        'candidate_identity_sha256',
        'attempt_correlation_id',
        'run_observed_event_sha256',
        'attempt_outcome',
        'correlation_sha256',
      ].every(fragment => manifestSchema.includes(fragment)),
      package_script_present: Boolean(packageJson.scripts?.['verify:c0-run-evidence-wiring'])
        && packageSource.includes('"verify:c0-run-evidence-wiring"'),
      phase_gate_id: 'c0-run-evidence-wiring-conformance',
      phase_gate_present: phaseSource.includes("id: 'c0-run-evidence-wiring-conformance'"),
      adapter_produces_verdict: false,
      second_ledger_created: false,
      hides_original_failure: false,
      qualification_effect: 'NONE',
      manifest_reader_uses_correlation: manifestSource.includes('verifyRunEvidenceCorrelation({'),
    },
    binding_guards: bindingGuards,
    failure_oracles: failureOracles,
    bypass_guards: {
      g0d_adapter_may_produce_verdict: false,
      product_run_evidence_may_be_qualification_eligible: false,
      second_run_evidence_ledger_allowed: false,
      unsealed_run_evidence_aggregable: false,
      wrong_anchor_aggregable: false,
      wrong_scope_aggregable: false,
      hidden_original_failure_allowed: false,
    },
    counts: {
      owner_required_components: REQUIRED_OWNER_COMPONENTS.length,
      owner_required_components_present: REQUIRED_OWNER_COMPONENTS
        .filter(componentPath => ownerComponents.has(componentPath)).length,
      binding_guards: bindingGuards.length,
      binding_guards_covered: bindingGuards.filter(guard => guard.coverage_status === 'covered').length,
      failure_oracles: failureOracles.length,
      failure_oracles_covered: failureOracles.filter(oracle => oracle.coverage_status === 'covered').length,
      bypasses: bindingGuards.filter(guard => guard.coverage_status !== 'covered').length
        + failureOracles.filter(oracle => oracle.coverage_status !== 'covered').length
        + (capability.implementation_state === 'wired' ? 0 : 1),
      qualification_claims: 0,
    },
    wiring_sha256: null,
  };
  report.wiring_sha256 = c0RunEvidenceWiringHash(report);
  return report;
}

export function validateC0RunEvidenceWiring(report, sources) {
  const errors = [];
  if (!isObject(report)) {
    return { ok: false, errors: ['wiring:expected-object'], summary: null };
  }
  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildC0RunEvidenceWiring(sources);
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

export function renderC0RunEvidenceWiringMarkdown(report) {
  const lines = [
    '# DevSeek C0 Run Evidence Wiring',
    '',
    '> Generated by `npm run generate:c0-run-evidence-wiring`. Do not edit manually.',
    '> This is local wiring-conformance evidence only. It is not qualification evidence and cannot issue a claim.',
    '',
    '## Scope',
    '',
    `- Wiring ID: \`${report.wiring_id}\``,
    `- Integrity scope: \`${report.integrity_scope}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${report.claims_permitted}\``,
    `- Gate pass assertion: \`${report.asserts_gate_pass}\``,
    `- Wiring SHA-256: \`${report.wiring_sha256}\``,
    '',
    '## Owner',
    '',
    `- Capability: \`${report.run_evidence_owner.capability_id}\``,
    `- State: \`${report.run_evidence_owner.implementation_state}\``,
    `- Authority port: \`${report.run_evidence_owner.authority_port}\``,
    `- Required components present: ${report.counts.owner_required_components_present}/${report.counts.owner_required_components}`,
    '',
    '## Correlation Contract',
    '',
    `- Adapter: \`${report.correlation_contract.adapter_id}\``,
    `- Source: \`${report.correlation_contract.adapter_source_ref}\``,
    `- Phase gate: \`${report.correlation_contract.phase_gate_id}\``,
    `- Adapter produces verdict: \`${report.correlation_contract.adapter_produces_verdict}\``,
    `- Second ledger created: \`${report.correlation_contract.second_ledger_created}\``,
    '',
    '## Binding Guards',
    '',
    ...report.binding_guards.map(guard => (
      `- \`${guard.guard_id}\`: ${guard.coverage_status}`
    )),
    '',
    '## Failure Oracles',
    '',
    ...report.failure_oracles.map(oracle => (
      `- \`${oracle.oracle_id}\`: ${oracle.coverage_status} (${oracle.expected_error})`
    )),
    '',
    '## Counts',
    '',
    `- Binding guards covered: ${report.counts.binding_guards_covered}/${report.counts.binding_guards}`,
    `- Failure oracles covered: ${report.counts.failure_oracles_covered}/${report.counts.failure_oracles}`,
    `- Bypasses: ${report.counts.bypasses}`,
    `- Qualification claims: ${report.counts.qualification_claims}`,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeWiring(report) {
  return {
    ledger_sha256: report.sources.capability_ledger.source_sha256,
    run_evidence_owner: report.run_evidence_owner.capability_id,
    owner_state: report.run_evidence_owner.implementation_state,
    owner_components_present: report.counts.owner_required_components_present,
    binding_guards_covered: report.counts.binding_guards_covered,
    failure_oracles_covered: report.counts.failure_oracles_covered,
    bypasses: report.counts.bypasses,
    qualification_effect: report.qualification_effect,
    claims_permitted: report.claims_permitted,
    asserts_gate_pass: report.asserts_gate_pass,
  };
}

function semanticValidate(report, errors) {
  if (report.schema_version !== C0_RUN_EVIDENCE_WIRING_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (report.wiring_id !== C0_RUN_EVIDENCE_WIRING_ID) errors.push('wiring_id:invalid');
  if (report.integrity_scope !== C0_RUN_EVIDENCE_WIRING_INTEGRITY_SCOPE) errors.push('integrity_scope:invalid');
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== C0_RUN_EVIDENCE_WIRING_QUALIFICATION_EFFECT) {
    errors.push('qualification_effect:must-be-NONE');
  }
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (report.wiring_sha256 !== c0RunEvidenceWiringHash(report)) errors.push('wiring_sha256:mismatch');

  const owner = report.run_evidence_owner ?? {};
  if (owner.capability_id !== RUN_EVIDENCE_CAPABILITY_ID) errors.push('run_evidence_owner.capability_id:invalid');
  if (owner.implementation_state !== 'wired') errors.push('run_evidence_owner.implementation_state:must-be-wired');
  if (owner.authority_port !== 'RunEvidenceLedgerPort') errors.push('run_evidence_owner.authority_port:invalid');
  for (const requiredPath of REQUIRED_OWNER_COMPONENTS) {
    const component = owner.required_component_paths?.find(entry => entry.path === requiredPath);
    if (component?.present !== true) errors.push(`run_evidence_owner.required_component_paths:missing-${requiredPath}`);
  }
  if (owner.verification_has_run_evidence_contract !== true) {
    errors.push('run_evidence_owner.verification:missing-verify-run-evidence-contract');
  }
  if (owner.verification_has_qualification_evidence_manifest !== true) {
    errors.push('run_evidence_owner.verification:missing-verify-qualification-evidence-manifest');
  }
  if (owner.verification_has_c0_run_evidence_wiring !== true) {
    errors.push('run_evidence_owner.verification:missing-verify-c0-run-evidence-wiring');
  }

  const contract = report.correlation_contract ?? {};
  for (const flag of [
    'schema_has_local_scope',
    'schema_forbids_claims',
    'manifest_output_has_exact_binding_fields',
    'package_script_present',
    'phase_gate_present',
    'manifest_reader_uses_correlation',
  ]) {
    if (contract[flag] !== true) errors.push(`correlation_contract.${flag}:missing`);
  }
  for (const flag of [
    'adapter_produces_verdict',
    'second_ledger_created',
    'hides_original_failure',
  ]) {
    if (contract[flag] !== false) errors.push(`correlation_contract.${flag}:must-be-false`);
  }
  if (contract.qualification_effect !== 'NONE') errors.push('correlation_contract.qualification_effect:must-be-NONE');

  for (const guard of report.binding_guards ?? []) {
    if (guard.coverage_status !== 'covered') errors.push(`binding_guards.${guard.guard_id}:not-covered`);
  }
  for (const oracle of report.failure_oracles ?? []) {
    if (oracle.coverage_status !== 'covered') errors.push(`failure_oracles.${oracle.oracle_id}:not-covered`);
  }
  const bypasses = [
    report.bypass_guards?.g0d_adapter_may_produce_verdict,
    report.bypass_guards?.product_run_evidence_may_be_qualification_eligible,
    report.bypass_guards?.second_run_evidence_ledger_allowed,
    report.bypass_guards?.unsealed_run_evidence_aggregable,
    report.bypass_guards?.wrong_anchor_aggregable,
    report.bypass_guards?.wrong_scope_aggregable,
    report.bypass_guards?.hidden_original_failure_allowed,
  ].filter(Boolean).length;
  if (bypasses !== 0) errors.push('bypass_guards:must-all-be-false');

  if (report.counts?.owner_required_components_present !== report.counts?.owner_required_components) {
    errors.push('counts.owner_required_components_present:must-equal-total');
  }
  if (report.counts?.binding_guards_covered !== report.counts?.binding_guards) {
    errors.push('counts.binding_guards_covered:must-equal-total');
  }
  if (report.counts?.failure_oracles_covered !== report.counts?.failure_oracles) {
    errors.push('counts.failure_oracles_covered:must-equal-total');
  }
  if (report.counts?.bypasses !== 0) errors.push('counts.bypasses:must-be-0');
  if (report.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
}

function buildFragmentBinding(definition, sourceContents) {
  const source = sourceContents[definition.source_ref] ?? '';
  const fragmentsPresent = definition.required_fragments.every(fragment => source.includes(fragment));
  return {
    guard_id: definition.guard_id,
    source_ref: definition.source_ref,
    required_fragments: definition.required_fragments,
    fragments_present: fragmentsPresent,
    coverage_status: fragmentsPresent ? 'covered' : 'blocked',
  };
}

function sourceRef(relativePath, sourceContents) {
  return {
    path: relativePath,
    source_sha256: sha256Text(sourceContents[relativePath] ?? ''),
  };
}

function findCapability(ledger, capabilityId) {
  const capability = (ledger.capabilities ?? []).find(entry => entry.capability_id === capabilityId);
  if (!capability) throw new Error(`Missing capability ${capabilityId}`);
  return capability;
}

function assertSourceObject(value, name) {
  if (!isObject(value)) throw new Error(`${name} is required`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withoutKeys(value, keys) {
  const copy = structuredClone(value);
  for (const key of keys) delete copy[key];
  return copy;
}
