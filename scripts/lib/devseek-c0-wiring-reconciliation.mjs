import crypto from 'node:crypto';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  ledgerHash,
  sha256Object,
} from './devseek-capability-ledger.mjs';
import {
  c0LedgerWiringHash,
  renderC0LedgerWiringMarkdown,
} from './devseek-c0-ledger-wiring.mjs';
import {
  c0PreregistrationWiringHash,
  renderC0PreregistrationWiringMarkdown,
} from './devseek-c0-preregistration-wiring.mjs';
import {
  c0RunEvidenceWiringHash,
  renderC0RunEvidenceWiringMarkdown,
} from './devseek-c0-run-evidence-wiring.mjs';
import {
  c0ManifestAggregatorWiringHash,
  renderC0ManifestAggregatorWiringMarkdown,
} from './devseek-c0-manifest-aggregator-wiring.mjs';
import {
  externalAuthorityAdapterHash,
  renderExternalAuthorityAdapterMarkdown,
} from './devseek-external-authority-adapter.mjs';
import {
  gate0DecisionHash,
} from './devseek-gate0-decision.mjs';

export const C0_WIRING_RECONCILIATION_SCHEMA_VERSION = 'devseek.c0-wiring-reconciliation/v1';
export const C0_WIRING_RECONCILIATION_ID = 'DEVSEEK-GATE0-C0-WIRING-RECONCILIATION/v1';
export const C0_WIRING_RECONCILIATION_INTEGRITY_SCOPE = 'local-c0-wiring-reconciliation';
export const C0_WIRING_RECONCILIATION_QUALIFICATION_EFFECT = 'NONE';
export const EXPECTED_GATE0_EXTERNAL_BLOCKERS = 6;
export const EXPECTED_GATE0_CAPABILITIES = 7;

export const RECONCILED_REPORT_SPECS = Object.freeze([
  {
    report_id: 'c0-ledger-wiring',
    path: 'docs/process/devseek-c0-ledger-wiring.json',
    schema_version: 'devseek.c0-ledger-wiring/v1',
    hash_field: 'wiring_sha256',
    package_script: 'verify:c0-ledger-wiring',
    phase_gate_id: 'c0-ledger-wiring-conformance',
    checker_path: 'scripts/devseek-c0-ledger-wiring-check.mjs',
    generated_view_path: 'docs/process/generated/devseek-c0-ledger-wiring.md',
    hashReport: c0LedgerWiringHash,
    renderMarkdown: renderC0LedgerWiringMarkdown,
  },
  {
    report_id: 'c0-preregistration-wiring',
    path: 'docs/process/devseek-c0-preregistration-wiring.json',
    schema_version: 'devseek.c0-preregistration-wiring/v1',
    hash_field: 'wiring_sha256',
    package_script: 'verify:c0-preregistration-wiring',
    phase_gate_id: 'c0-preregistration-wiring-conformance',
    checker_path: 'scripts/devseek-c0-preregistration-wiring-check.mjs',
    generated_view_path: 'docs/process/generated/devseek-c0-preregistration-wiring.md',
    hashReport: c0PreregistrationWiringHash,
    renderMarkdown: renderC0PreregistrationWiringMarkdown,
  },
  {
    report_id: 'c0-run-evidence-wiring',
    path: 'docs/process/devseek-c0-run-evidence-wiring.json',
    schema_version: 'devseek.c0-run-evidence-wiring/v1',
    hash_field: 'wiring_sha256',
    package_script: 'verify:c0-run-evidence-wiring',
    phase_gate_id: 'c0-run-evidence-wiring-conformance',
    checker_path: 'scripts/devseek-c0-run-evidence-wiring-check.mjs',
    generated_view_path: 'docs/process/generated/devseek-c0-run-evidence-wiring.md',
    hashReport: c0RunEvidenceWiringHash,
    renderMarkdown: renderC0RunEvidenceWiringMarkdown,
  },
  {
    report_id: 'c0-manifest-aggregator-wiring',
    path: 'docs/process/devseek-c0-manifest-aggregator-wiring.json',
    schema_version: 'devseek.c0-manifest-aggregator-wiring/v1',
    hash_field: 'wiring_sha256',
    package_script: 'verify:c0-manifest-aggregator-wiring',
    phase_gate_id: 'c0-manifest-aggregator-wiring-conformance',
    checker_path: 'scripts/devseek-c0-manifest-aggregator-wiring-check.mjs',
    generated_view_path: 'docs/process/generated/devseek-c0-manifest-aggregator-wiring.md',
    hashReport: c0ManifestAggregatorWiringHash,
    renderMarkdown: renderC0ManifestAggregatorWiringMarkdown,
  },
  {
    report_id: 'external-authority-adapter',
    path: 'docs/process/devseek-external-authority-adapter.json',
    schema_version: 'devseek.external-authority-adapter/v1',
    hash_field: 'adapter_sha256',
    package_script: 'verify:external-authority-adapter',
    phase_gate_id: 'external-authority-adapter-contract',
    checker_path: 'scripts/devseek-external-authority-adapter-check.mjs',
    generated_view_path: 'docs/process/generated/devseek-external-authority-adapter.md',
    hashReport: externalAuthorityAdapterHash,
    renderMarkdown: renderExternalAuthorityAdapterMarkdown,
  },
  {
    report_id: 'gate0-decision',
    path: 'docs/process/devseek-gate0-decision-report.json',
    schema_version: 'devseek.gate0-decision/v1',
    hash_field: 'decision_sha256',
    package_script: 'verify:gate0-decision',
    phase_gate_id: 'gate0-machine-decision-contract',
    checker_path: 'scripts/devseek-gate0-decision-check.mjs',
    generated_view_path: null,
    hashReport: gate0DecisionHash,
    renderMarkdown: null,
  },
]);

export function c0WiringReconciliationHash(report) {
  return sha256Object(withoutKeys(report, ['reconciliation_sha256']), report?.integrity);
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function buildC0WiringReconciliation({
  ledger,
  reports,
  packageJson,
  sourceContents,
} = {}) {
  assertSourceObject(ledger, 'ledger');
  assertSourceObject(reports, 'reports');
  assertSourceObject(packageJson, 'packageJson');
  assertSourceObject(sourceContents, 'sourceContents');

  const phaseSource = getSource(sourceContents, 'scripts/devseek-phase0-12-verify.mjs');
  const reconciledReports = RECONCILED_REPORT_SPECS.map(spec => buildReportBinding({
    spec,
    report: reports[spec.report_id],
    packageJson,
    phaseSource,
    sourceContents,
  }));
  const gate0Report = reports['gate0-decision'];
  const externalAuthorityAdapter = reports['external-authority-adapter'];
  const ledgerSourceSha256 = ledgerHash(ledger);
  const externalAuthorityAdapterSha256 = externalAuthorityAdapterHash(externalAuthorityAdapter);

  const report = {
    schema_version: C0_WIRING_RECONCILIATION_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    reconciliation_id: C0_WIRING_RECONCILIATION_ID,
    reconciliation_version: 1,
    source_status: 'verified',
    integrity_scope: C0_WIRING_RECONCILIATION_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: C0_WIRING_RECONCILIATION_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    sources: {
      capability_ledger: {
        path: 'docs/process/devseek-capability-ledger.json',
        schema_version: ledger.schema_version,
        ledger_id: ledger.ledger_id,
        source_sha256: ledgerSourceSha256,
      },
      package_scripts: {
        path: 'package.json',
        source_sha256: sha256Text(getSource(sourceContents, 'package.json')),
      },
      phase_gate_source: {
        path: 'scripts/devseek-phase0-12-verify.mjs',
        source_sha256: sha256Text(phaseSource),
      },
      checker_source: {
        path: 'scripts/devseek-c0-wiring-reconciliation-check.mjs',
        source_sha256: sha256Text(getSource(sourceContents, 'scripts/devseek-c0-wiring-reconciliation-check.mjs')),
      },
      oracle_source: {
        path: 'scripts/test/devseek-c0-wiring-reconciliation.test.mjs',
        source_sha256: sha256Text(getSource(sourceContents, 'scripts/test/devseek-c0-wiring-reconciliation.test.mjs')),
      },
    },
    reconciled_reports: reconciledReports,
    gate0_decision: {
      status: gate0Report.qualification?.status ?? null,
      gate_passed: gate0Report.qualification?.gate_passed ?? null,
      asserts_gate_pass: gate0Report.asserts_gate_pass ?? null,
      capabilities: gate0Report.counts?.capabilities ?? null,
      implementation_requirements_satisfied: gate0Report.counts?.implementation_requirements_satisfied ?? null,
      exact_claim_requirements_satisfied: gate0Report.counts?.exact_claim_requirements_satisfied ?? null,
      observed_claims: gate0Report.counts?.observed_claims ?? null,
      repository_pending_blockers: gate0Report.counts?.repository_pending_blockers ?? null,
      external_authority_blockers: gate0Report.counts?.external_authority_blockers ?? null,
      claims_empty: Array.isArray(gate0Report.claims) && gate0Report.claims.length === 0,
      repository_blockers_empty: Array.isArray(gate0Report.blockers?.repository_pending)
        && gate0Report.blockers.repository_pending.length === 0,
      external_blockers_preserved: gate0Report.counts?.external_authority_blockers === EXPECTED_GATE0_EXTERNAL_BLOCKERS,
      source_bindings: [
        {
          binding_id: 'gate0-ledger-source',
          observed_sha256: gate0Report.sources?.capability_ledger?.source_sha256 ?? null,
          expected_sha256: ledgerSourceSha256,
          status: gate0Report.sources?.capability_ledger?.source_sha256 === ledgerSourceSha256 ? 'matched' : 'mismatch',
        },
        {
          binding_id: 'gate0-external-authority-adapter-source',
          observed_sha256: gate0Report.sources?.external_authority_adapter?.source_sha256 ?? null,
          expected_sha256: externalAuthorityAdapterSha256,
          status: gate0Report.sources?.external_authority_adapter?.source_sha256 === externalAuthorityAdapterSha256
            ? 'matched'
            : 'mismatch',
        },
      ],
      independent_authority_status:
        gate0Report.sources?.capability_ledger?.qualification_claim_authority?.independent_authority_status ?? null,
    },
    bypass_guards: {
      local_reports_may_issue_claims: false,
      markdown_may_lower_external_blockers: false,
      local_fixture_claims_permitted: false,
      repository_blockers_may_be_manually_cleared: false,
      external_blockers_may_be_removed_by_local_report: false,
      r1_may_start_before_gate0_pass: false,
    },
    counts: {
      reconciled_reports: reconciledReports.length,
      report_hashes_matched: reconciledReports.filter(entry => entry.hash_status === 'matched').length,
      package_scripts_covered: reconciledReports.filter(entry => entry.package_script_present).length + (
        Boolean(packageJson.scripts?.['verify:c0-wiring-reconciliation']) ? 1 : 0
      ),
      phase_gates_covered: reconciledReports.filter(entry => entry.phase_gate_present).length + (
        phaseSource.includes('c0-wiring-reconciliation-conformance') ? 1 : 0
      ),
      generated_views: reconciledReports.filter(entry => entry.generated_view.status !== 'not-applicable').length,
      generated_views_current: reconciledReports.filter(entry => entry.generated_view.status === 'current').length,
      gate0_repository_pending_blockers: gate0Report.counts?.repository_pending_blockers ?? null,
      gate0_external_authority_blockers: gate0Report.counts?.external_authority_blockers ?? null,
      observed_claims: gate0Report.counts?.observed_claims ?? null,
      bypasses: 0,
    },
    reconciliation_sha256: null,
  };
  report.counts.bypasses = countBypasses(report);
  report.reconciliation_sha256 = c0WiringReconciliationHash(report);
  return report;
}

export function validateC0WiringReconciliation(report, sources) {
  const errors = [];
  if (!isObject(report)) {
    return { ok: false, errors: ['reconciliation:expected-object'], summary: null };
  }
  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildC0WiringReconciliation(sources);
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }
  if (expected && canonicalJson(report) !== canonicalJson(expected)) {
    errors.push('reconciliation:deterministic-source-drift');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeReconciliation(expected) : null,
  };
}

export function renderC0WiringReconciliationMarkdown(report) {
  const lines = [
    '# DevSeek C0 Wiring Reconciliation',
    '',
    '> Generated by `npm run generate:c0-wiring-reconciliation`. Do not edit manually.',
    '> This is local wiring reconciliation only. It is not qualification evidence and cannot issue a claim.',
    '',
    '## Scope',
    '',
    `- Reconciliation ID: \`${report.reconciliation_id}\``,
    `- Integrity scope: \`${report.integrity_scope}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${String(report.claims_permitted)}\``,
    `- Asserts Gate 0 pass: \`${String(report.asserts_gate_pass)}\``,
    '',
    '## Reconciled Reports',
    '',
    '| Report | Hash | Package | Phase | Generated view |',
    '| --- | --- | --- | --- | --- |',
    ...report.reconciled_reports.map(entry => [
      `| \`${entry.report_id}\``,
      `\`${entry.hash_status}\``,
      `\`${entry.package_script_present ? 'present' : 'missing'}\``,
      `\`${entry.phase_gate_present ? 'present' : 'missing'}\``,
      `\`${entry.generated_view.status}\` |`,
    ].join(' | ')),
    '',
    '## Gate 0 Decision',
    '',
    `- Status: \`${report.gate0_decision.status}\``,
    `- Claims: \`${report.gate0_decision.observed_claims}\``,
    `- Repository blockers: \`${report.gate0_decision.repository_pending_blockers}\``,
    `- External blockers: \`${report.gate0_decision.external_authority_blockers}\``,
    `- Independent authority status: \`${report.gate0_decision.independent_authority_status}\``,
    '',
    '## Counts',
    '',
    `- Reconciled reports: \`${report.counts.reconciled_reports}\``,
    `- Report hashes matched: \`${report.counts.report_hashes_matched}\``,
    `- Package scripts covered: \`${report.counts.package_scripts_covered}\``,
    `- Phase gates covered: \`${report.counts.phase_gates_covered}\``,
    `- Generated views current: \`${report.counts.generated_views_current}/${report.counts.generated_views}\``,
    `- Bypasses: \`${report.counts.bypasses}\``,
    `- SHA-256: \`${report.reconciliation_sha256}\``,
  ];
  return `${lines.join('\n')}\n`;
}

function buildReportBinding({ spec, report, packageJson, phaseSource, sourceContents }) {
  assertSourceObject(report, spec.report_id);
  const reportedHash = report[spec.hash_field] ?? null;
  const computedHash = spec.hashReport(report);
  const generatedView = buildGeneratedViewBinding({ spec, report, sourceContents });
  return {
    report_id: spec.report_id,
    path: spec.path,
    schema_version: report.schema_version ?? null,
    expected_schema_version: spec.schema_version,
    hash_field: spec.hash_field,
    reported_sha256: reportedHash,
    computed_sha256: computedHash,
    hash_status: reportedHash === computedHash ? 'matched' : 'mismatch',
    package_script: spec.package_script,
    package_script_present: Boolean(packageJson.scripts?.[spec.package_script]),
    phase_gate_id: spec.phase_gate_id,
    phase_gate_present: phaseSource.includes(spec.phase_gate_id),
    checker_path: spec.checker_path,
    checker_source_sha256: sha256Text(getSource(sourceContents, spec.checker_path)),
    generated_view: generatedView,
  };
}

function buildGeneratedViewBinding({ spec, report, sourceContents }) {
  if (!spec.generated_view_path) {
    return { path: null, status: 'not-applicable', source_sha256: null };
  }
  const actual = sourceContents[spec.generated_view_path];
  if (actual === undefined) {
    return { path: spec.generated_view_path, status: 'missing', source_sha256: null };
  }
  const expected = spec.renderMarkdown(report);
  return {
    path: spec.generated_view_path,
    status: actual === expected ? 'current' : 'stale',
    source_sha256: sha256Text(actual),
  };
}

function semanticValidate(report, errors) {
  if (report.schema_version !== C0_WIRING_RECONCILIATION_SCHEMA_VERSION) errors.push('schema_version:unexpected');
  if (report.source_status !== 'verified') errors.push('source_status:must-be-verified');
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== C0_WIRING_RECONCILIATION_QUALIFICATION_EFFECT) {
    errors.push('qualification_effect:must-be-NONE');
  }
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  for (const entry of report.reconciled_reports ?? []) {
    if (entry.schema_version !== entry.expected_schema_version) {
      errors.push(`reconciled_reports.${entry.report_id}:schema-version-mismatch`);
    }
    if (entry.hash_status !== 'matched') errors.push(`reconciled_reports.${entry.report_id}:hash-mismatch`);
    if (entry.package_script_present !== true) errors.push(`reconciled_reports.${entry.report_id}:missing-package-script`);
    if (entry.phase_gate_present !== true) errors.push(`reconciled_reports.${entry.report_id}:missing-phase-gate`);
    if (!['current', 'not-applicable'].includes(entry.generated_view?.status)) {
      errors.push(`reconciled_reports.${entry.report_id}:generated-view-${entry.generated_view?.status ?? 'missing'}`);
    }
  }
  const gate0 = report.gate0_decision ?? {};
  if (gate0.status !== 'NOT_PASSED') errors.push('gate0_decision.status:must-remain-NOT_PASSED');
  if (gate0.gate_passed !== false) errors.push('gate0_decision.gate_passed:must-be-false');
  if (gate0.asserts_gate_pass !== false) errors.push('gate0_decision.asserts_gate_pass:must-be-false');
  if (gate0.capabilities !== EXPECTED_GATE0_CAPABILITIES) errors.push('gate0_decision.capabilities:expected-7');
  if (gate0.implementation_requirements_satisfied !== EXPECTED_GATE0_CAPABILITIES) {
    errors.push('gate0_decision.implementation_requirements_satisfied:expected-7');
  }
  if (gate0.exact_claim_requirements_satisfied !== 0) {
    errors.push('gate0_decision.exact_claim_requirements_satisfied:must-be-0');
  }
  if (gate0.observed_claims !== 0 || gate0.claims_empty !== true) {
    errors.push('gate0_decision.claims:must-be-empty');
  }
  if (gate0.repository_pending_blockers !== 0 || gate0.repository_blockers_empty !== true) {
    errors.push('gate0_decision.repository_pending_blockers:must-be-0');
  }
  if (gate0.external_authority_blockers !== EXPECTED_GATE0_EXTERNAL_BLOCKERS
    || gate0.external_blockers_preserved !== true) {
    errors.push('gate0_decision.external_authority_blockers:must-remain-6');
  }
  if (gate0.independent_authority_status !== 'UNAVAILABLE_NO_EXTERNAL_TRUST_ROOT') {
    errors.push('gate0_decision.independent_authority_status:must-remain-no-trust-root');
  }
  for (const binding of gate0.source_bindings ?? []) {
    if (binding.status !== 'matched') errors.push(`gate0_decision.source_bindings.${binding.binding_id}:mismatch`);
  }
  if (Object.values(report.bypass_guards ?? {}).some(value => value !== false)) {
    errors.push('bypass_guards:all-must-be-false');
  }
  const computedHash = c0WiringReconciliationHash(report);
  if (!/^[a-f0-9]{64}$/u.test(report.reconciliation_sha256 ?? '')) errors.push('reconciliation_sha256:invalid');
  else if (report.reconciliation_sha256 !== computedHash) errors.push('reconciliation_sha256:mismatch');
  if (report.counts?.reconciled_reports !== RECONCILED_REPORT_SPECS.length) {
    errors.push(`counts.reconciled_reports:expected-${RECONCILED_REPORT_SPECS.length}`);
  }
  if (report.counts?.report_hashes_matched !== report.counts?.reconciled_reports) {
    errors.push('counts.report_hashes_matched:must-equal-reconciled-reports');
  }
  if (report.counts?.generated_views_current !== report.counts?.generated_views) {
    errors.push('counts.generated_views_current:must-equal-generated-views');
  }
  if (report.counts?.bypasses !== 0) errors.push('counts.bypasses:must-be-0');
}

function summarizeReconciliation(report) {
  return {
    reconciliation_sha256: report.reconciliation_sha256,
    reconciled_reports: report.counts.reconciled_reports,
    report_hashes_matched: report.counts.report_hashes_matched,
    package_scripts_covered: report.counts.package_scripts_covered,
    phase_gates_covered: report.counts.phase_gates_covered,
    generated_views_current: `${report.counts.generated_views_current}/${report.counts.generated_views}`,
    gate0_status: report.gate0_decision.status,
    repository_pending_blockers: report.gate0_decision.repository_pending_blockers,
    external_authority_blockers: report.gate0_decision.external_authority_blockers,
    claims: report.gate0_decision.observed_claims,
    qualification_effect: report.qualification_effect,
    bypasses: report.counts.bypasses,
  };
}

function countBypasses(report) {
  return [
    report.reconciled_reports.some(entry => entry.hash_status !== 'matched'),
    report.reconciled_reports.some(entry => entry.package_script_present !== true),
    report.reconciled_reports.some(entry => entry.phase_gate_present !== true),
    report.reconciled_reports.some(entry => !['current', 'not-applicable'].includes(entry.generated_view.status)),
    report.gate0_decision.status !== 'NOT_PASSED',
    report.gate0_decision.repository_pending_blockers !== 0,
    report.gate0_decision.external_authority_blockers !== EXPECTED_GATE0_EXTERNAL_BLOCKERS,
    report.gate0_decision.observed_claims !== 0,
    report.gate0_decision.source_bindings.some(binding => binding.status !== 'matched'),
    Object.values(report.bypass_guards).some(value => value !== false),
  ].filter(Boolean).length;
}

function getSource(sourceContents, sourcePath) {
  if (typeof sourceContents?.[sourcePath] !== 'string') {
    throw new Error(`missing source content: ${sourcePath}`);
  }
  return sourceContents[sourcePath];
}

function assertSourceObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
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
