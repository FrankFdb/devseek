import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  ledgerHash,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const C0_LEDGER_WIRING_SCHEMA_VERSION = 'devseek.c0-ledger-wiring/v1';
export const C0_LEDGER_WIRING_ID = 'DEVSEEK-GATE0-C0-LEDGER-WIRING/v1';
export const C0_LEDGER_WIRING_INTEGRITY_SCOPE = 'local-ledger-wiring-conformance';
export const C0_LEDGER_WIRING_QUALIFICATION_EFFECT = 'NONE';
export const LEDGER_OWNER_CAPABILITY_ID = 'C0-CAPABILITY-LEDGER-SCHEMA';
export const LEDGER_SOURCE_PATH = 'docs/process/devseek-capability-ledger.json';
export const LEDGER_SCHEMA_PATH = 'docs/process/devseek-capability-ledger.schema.json';

export const REQUIRED_OWNER_COMPONENTS = Object.freeze([
  'docs/process/devseek-c0-ledger-wiring.json',
  'docs/process/devseek-c0-ledger-wiring.schema.json',
  'docs/process/generated/devseek-c0-ledger-wiring.md',
  'scripts/devseek-c0-ledger-wiring-check.mjs',
  'scripts/lib/devseek-c0-ledger-wiring.mjs',
  'scripts/test/devseek-c0-ledger-wiring.test.mjs',
]);

export const REQUIRED_LEDGER_CONSUMERS = Object.freeze([
  {
    consumer_id: 'capability-ledger-owner',
    command: 'npm run verify:capability-ledger',
    package_script: 'verify:capability-ledger',
    phase_gate_id: 'capability-ledger-governance',
    reader_path: 'scripts/devseek-capability-ledger-check.mjs',
    direct_ledger_reader: true,
  },
  {
    consumer_id: 'c0-ledger-wiring',
    command: 'npm run verify:c0-ledger-wiring',
    package_script: 'verify:c0-ledger-wiring',
    phase_gate_id: 'c0-ledger-wiring-conformance',
    reader_path: 'scripts/devseek-c0-ledger-wiring-check.mjs',
    direct_ledger_reader: true,
  },
  {
    consumer_id: 'profile-denominator-registry',
    command: 'npm run verify:profile-denominator-registry',
    package_script: 'verify:profile-denominator-registry',
    phase_gate_id: 'profile-denominator-registry-governance',
    reader_path: 'scripts/devseek-profile-denominator-registry-check.mjs',
    direct_ledger_reader: true,
  },
  {
    consumer_id: 'c0-run-evidence-wiring',
    command: 'npm run verify:c0-run-evidence-wiring',
    package_script: 'verify:c0-run-evidence-wiring',
    phase_gate_id: 'c0-run-evidence-wiring-conformance',
    reader_path: 'scripts/devseek-c0-run-evidence-wiring-check.mjs',
    direct_ledger_reader: true,
  },
  {
    consumer_id: 'gate0-machine-decision',
    command: 'npm run verify:gate0-decision',
    package_script: 'verify:gate0-decision',
    phase_gate_id: 'gate0-machine-decision-contract',
    reader_path: 'scripts/devseek-gate0-decision-check.mjs',
    direct_ledger_reader: true,
  },
]);

const FORBIDDEN_PROCESS_STATE_FILE = /(?:^|-)capability-(?:status|state)(?:-|\.|$)|(?:^|-)ledger-(?:status|state)(?:-|\.|$)/u;

export function c0LedgerWiringHash(report) {
  return sha256Object(withoutKeys(report, ['wiring_sha256']), report?.integrity);
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function buildC0LedgerWiring({
  repoRoot,
  ledger,
  packageJson,
  sourceContents,
  processFiles,
} = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  assertSourceObject(ledger, 'ledger');
  assertSourceObject(packageJson, 'packageJson');
  assertSourceObject(sourceContents, 'sourceContents');
  if (!Array.isArray(processFiles)) throw new Error('processFiles must be an array');

  const owner = findCapability(ledger, LEDGER_OWNER_CAPABILITY_ID);
  const ownerComponents = new Set((owner.implementation_components ?? []).map(component => component.path));
  const ledgerSourceOwners = ownerCapabilitiesForPath(ledger, LEDGER_SOURCE_PATH);
  const ledgerSchemaOwners = ownerCapabilitiesForPath(ledger, LEDGER_SCHEMA_PATH);
  const consumers = REQUIRED_LEDGER_CONSUMERS.map(consumer => buildConsumerBinding({
    consumer,
    packageJson,
    sourceContents,
  }));
  const forbiddenStateFiles = processFiles
    .filter(relativePath => relativePath.startsWith('docs/process/'))
    .filter(relativePath => relativePath.endsWith('.json'))
    .filter(relativePath => FORBIDDEN_PROCESS_STATE_FILE.test(path.basename(relativePath)))
    .filter(relativePath => !new Set([
      LEDGER_SOURCE_PATH,
      'docs/process/devseek-c0-ledger-wiring.json',
      'docs/process/devseek-gate0-decision-report.json',
    ]).has(relativePath))
    .sort();

  const report = {
    schema_version: C0_LEDGER_WIRING_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    wiring_id: C0_LEDGER_WIRING_ID,
    wiring_version: 1,
    source_status: 'verified',
    integrity_scope: C0_LEDGER_WIRING_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: C0_LEDGER_WIRING_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    sources: {
      capability_ledger: {
        path: LEDGER_SOURCE_PATH,
        schema_version: ledger.schema_version,
        ledger_id: ledger.ledger_id,
        source_sha256: ledgerHash(ledger),
      },
      package_scripts: {
        path: 'package.json',
        source_sha256: sha256Text(sourceContents['package.json']),
      },
      phase_gate_source: {
        path: 'scripts/devseek-phase0-12-verify.mjs',
        source_sha256: sha256Text(sourceContents['scripts/devseek-phase0-12-verify.mjs']),
      },
      checker_source: {
        path: 'scripts/devseek-c0-ledger-wiring-check.mjs',
        source_sha256: sha256Text(sourceContents['scripts/devseek-c0-ledger-wiring-check.mjs']),
      },
      oracle_source: {
        path: 'scripts/test/devseek-c0-ledger-wiring.test.mjs',
        source_sha256: sha256Text(sourceContents['scripts/test/devseek-c0-ledger-wiring.test.mjs']),
      },
    },
    ledger_owner: {
      capability_id: owner.capability_id,
      implementation_state: owner.implementation_state,
      semantic_authority_port: owner.semantic_authority?.port,
      source_of_truth_path: LEDGER_SOURCE_PATH,
      schema_path: LEDGER_SCHEMA_PATH,
      source_owner_capability_ids: ledgerSourceOwners.map(capability => capability.capability_id).sort(),
      schema_owner_capability_ids: ledgerSchemaOwners.map(capability => capability.capability_id).sort(),
      required_component_paths: REQUIRED_OWNER_COMPONENTS.map(componentPath => ({
        path: componentPath,
        present: ownerComponents.has(componentPath),
      })),
      verification_commands: owner.verification?.commands ?? [],
      verification_has_capability_ledger: (owner.verification?.commands ?? []).includes('npm run verify:capability-ledger'),
      verification_has_c0_wiring: (owner.verification?.commands ?? []).includes('npm run verify:c0-ledger-wiring'),
      direct_state_edit_guard: 'wired-state-requires-c0-ledger-wiring-evidence',
    },
    governed_consumers: consumers,
    bypass_guards: {
      markdown_drives_ledger: false,
      manual_capability_state_files_allowed: false,
      second_capability_ledger_allowed: false,
      direct_state_edit_without_wiring_evidence_allowed: false,
      forbidden_process_state_files: forbiddenStateFiles,
    },
    document_governance_boundary: {
      active_baseline_selector_path: 'docs/process/devseek-active-baseline-selector.json',
      doc_governance_status_path: 'docs/process/generated/devseek-doc-governance-status.md',
      capability_state_source: LEDGER_SOURCE_PATH,
      document_status_may_assert_gate_pass: false,
      markdown_may_promote_capability_state: false,
    },
    counts: {
      ledger_source_owners: ledgerSourceOwners.length,
      ledger_schema_owners: ledgerSchemaOwners.length,
      governed_consumers: consumers.length,
      governed_consumers_covered: consumers.filter(consumer => consumer.coverage_status === 'covered').length,
      bypasses: forbiddenStateFiles.length + consumers.filter(consumer => consumer.coverage_status !== 'covered').length,
      qualification_claims: 0,
    },
    wiring_sha256: null,
  };
  report.wiring_sha256 = c0LedgerWiringHash(report);
  return report;
}

export function validateC0LedgerWiring(report, sources) {
  const errors = [];
  if (!isObject(report)) {
    return { ok: false, errors: ['wiring:expected-object'], summary: null };
  }
  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildC0LedgerWiring(sources);
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

export function renderC0LedgerWiringMarkdown(report) {
  const lines = [
    '# DevSeek C0 Ledger Wiring',
    '',
    '> Generated by `npm run generate:c0-ledger-wiring`. Do not edit manually.',
    '> This is local wiring-conformance evidence only. It is not qualification evidence and cannot issue a claim.',
    '',
    '## Scope',
    '',
    `- Wiring ID: \`${report.wiring_id}\``,
    `- Integrity scope: \`${report.integrity_scope}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${String(report.claims_permitted)}\``,
    `- Asserts Gate 0 pass: \`${String(report.asserts_gate_pass)}\``,
    '',
    '## Ledger Owner',
    '',
    `- Capability: \`${report.ledger_owner.capability_id}\``,
    `- Implementation state: \`${report.ledger_owner.implementation_state}\``,
    `- Source owners: \`${report.counts.ledger_source_owners}\``,
    `- Schema owners: \`${report.counts.ledger_schema_owners}\``,
    `- Source SHA-256: \`${report.sources.capability_ledger.source_sha256}\``,
    '',
    '## Governed Consumers',
    '',
    '| Consumer | Command | Phase gate | Direct ledger reader | Coverage |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const consumer of report.governed_consumers) {
    lines.push(`| \`${consumer.consumer_id}\` | \`${consumer.command}\` | \`${consumer.phase_gate_id}\` | \`${String(consumer.direct_ledger_reader)}\` | \`${consumer.coverage_status}\` |`);
  }
  lines.push(
    '',
    '## Bypass Guards',
    '',
    `- Manual capability state files allowed: \`${String(report.bypass_guards.manual_capability_state_files_allowed)}\``,
    `- Second capability ledger allowed: \`${String(report.bypass_guards.second_capability_ledger_allowed)}\``,
    `- Markdown may promote capability state: \`${String(report.document_governance_boundary.markdown_may_promote_capability_state)}\``,
    `- Bypasses: \`${report.counts.bypasses}\``,
    '',
    '## Wiring Identity',
    '',
    `- Wiring SHA-256: \`${report.wiring_sha256}\``,
    '',
  );
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function collectProcessFiles(repoRoot) {
  const result = [];
  collect('docs/process');
  return result.sort();

  function collect(relativeDirectory) {
    const absoluteDirectory = path.join(repoRoot, relativeDirectory);
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) collect(relativePath);
      else if (entry.isFile()) result.push(relativePath);
    }
  }
}

function buildConsumerBinding({
  consumer,
  packageJson,
  sourceContents,
}) {
  const readerSource = sourceContents[consumer.reader_path] ?? '';
  const phaseSource = sourceContents['scripts/devseek-phase0-12-verify.mjs'] ?? '';
  const packageScriptValue = packageJson.scripts?.[consumer.package_script] ?? null;
  const commandScriptPresent = typeof packageScriptValue === 'string' && packageScriptValue.length > 0;
  const phaseGatePresent = phaseSource.includes(`id: '${consumer.phase_gate_id}'`)
    && phaseSource.includes(`command: ['npm', 'run', '${consumer.package_script}']`);
  const readsLedgerSource = readerSource.includes(LEDGER_SOURCE_PATH);
  const directLedgerReader = consumer.direct_ledger_reader === true && readsLedgerSource;
  const coverageStatus = commandScriptPresent && phaseGatePresent && directLedgerReader
    ? 'covered'
    : 'blocked';

  return {
    consumer_id: consumer.consumer_id,
    command: consumer.command,
    package_script: consumer.package_script,
    package_script_present: commandScriptPresent,
    phase_gate_id: consumer.phase_gate_id,
    phase_gate_present: phaseGatePresent,
    reader_path: consumer.reader_path,
    reader_source_sha256: sha256Text(readerSource),
    direct_ledger_reader: directLedgerReader,
    coverage_status: coverageStatus,
  };
}

function semanticValidate(report, errors) {
  if (report.schema_version !== C0_LEDGER_WIRING_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== C0_LEDGER_WIRING_QUALIFICATION_EFFECT) {
    errors.push('qualification_effect:must-be-NONE');
  }
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (report.ledger_owner?.capability_id !== LEDGER_OWNER_CAPABILITY_ID) {
    errors.push('ledger_owner.capability_id:invalid');
  }
  if (report.ledger_owner?.implementation_state !== 'wired') {
    errors.push('ledger_owner.implementation_state:must-be-wired');
  }
  if (report.counts?.ledger_source_owners !== 1) errors.push('counts.ledger_source_owners:must-be-1');
  if (report.counts?.ledger_schema_owners !== 1) errors.push('counts.ledger_schema_owners:must-be-1');
  if (report.ledger_owner?.source_owner_capability_ids?.[0] !== LEDGER_OWNER_CAPABILITY_ID) {
    errors.push('ledger_owner.source_owner_capability_ids:must-be-single-ledger-owner');
  }
  if (report.ledger_owner?.schema_owner_capability_ids?.[0] !== LEDGER_OWNER_CAPABILITY_ID) {
    errors.push('ledger_owner.schema_owner_capability_ids:must-be-single-ledger-owner');
  }
  if (report.ledger_owner?.verification_has_capability_ledger !== true) {
    errors.push('ledger_owner.verification:missing-verify-capability-ledger');
  }
  if (report.ledger_owner?.verification_has_c0_wiring !== true) {
    errors.push('ledger_owner.verification:missing-verify-c0-ledger-wiring');
  }
  for (const component of report.ledger_owner?.required_component_paths ?? []) {
    if (component.present !== true) errors.push(`ledger_owner.required_component_paths:missing-${component.path}`);
  }
  if (report.counts?.governed_consumers !== REQUIRED_LEDGER_CONSUMERS.length) {
    errors.push(`counts.governed_consumers:expected-${REQUIRED_LEDGER_CONSUMERS.length}`);
  }
  if (report.counts?.governed_consumers_covered !== report.counts?.governed_consumers) {
    errors.push('counts.governed_consumers_covered:must-equal-governed-consumers');
  }
  for (const consumer of report.governed_consumers ?? []) {
    if (consumer.coverage_status !== 'covered') errors.push(`governed_consumers.${consumer.consumer_id}:not-covered`);
    if (consumer.direct_ledger_reader !== true) errors.push(`governed_consumers.${consumer.consumer_id}:not-direct-ledger-reader`);
    if (consumer.package_script_present !== true) errors.push(`governed_consumers.${consumer.consumer_id}:missing-package-script`);
    if (consumer.phase_gate_present !== true) errors.push(`governed_consumers.${consumer.consumer_id}:missing-phase-gate`);
  }
  if ((report.bypass_guards?.forbidden_process_state_files ?? []).length !== 0) {
    errors.push('bypass_guards.forbidden_process_state_files:must-be-empty');
  }
  if (report.counts?.bypasses !== 0) errors.push('counts.bypasses:must-be-0');
  if (report.document_governance_boundary?.document_status_may_assert_gate_pass !== false) {
    errors.push('document_governance_boundary.document_status_may_assert_gate_pass:must-be-false');
  }
  if (report.document_governance_boundary?.markdown_may_promote_capability_state !== false) {
    errors.push('document_governance_boundary.markdown_may_promote_capability_state:must-be-false');
  }
  const computedHash = c0LedgerWiringHash(report);
  if (!/^[a-f0-9]{64}$/u.test(report.wiring_sha256 ?? '')) errors.push('wiring_sha256:invalid');
  else if (report.wiring_sha256 !== computedHash) errors.push('wiring_sha256:mismatch');
}

function summarizeWiring(report) {
  return {
    ledger_sha256: report.sources.capability_ledger.source_sha256,
    ledger_owner: report.ledger_owner.capability_id,
    ledger_owner_state: report.ledger_owner.implementation_state,
    ledger_source_owners: report.counts.ledger_source_owners,
    ledger_schema_owners: report.counts.ledger_schema_owners,
    governed_consumers: report.counts.governed_consumers,
    governed_consumers_covered: report.counts.governed_consumers_covered,
    bypasses: report.counts.bypasses,
    qualification_effect: report.qualification_effect,
    claims_permitted: report.claims_permitted,
    asserts_gate_pass: report.asserts_gate_pass,
  };
}

function ownerCapabilitiesForPath(ledger, componentPath) {
  return (ledger.capabilities ?? []).filter(capability => (
    (capability.implementation_components ?? []).some(component => component.path === componentPath)
  ));
}

function findCapability(ledger, capabilityId) {
  const capability = (ledger.capabilities ?? []).find(entry => entry.capability_id === capabilityId);
  if (!capability) throw new Error(`ledger:missing-${capabilityId}`);
  return capability;
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
