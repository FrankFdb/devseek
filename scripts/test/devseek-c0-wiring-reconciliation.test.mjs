import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  canonicalJson,
} from '../lib/devseek-capability-ledger.mjs';
import {
  EXPECTED_GATE0_EXTERNAL_BLOCKERS,
  buildC0WiringReconciliation,
  renderC0WiringReconciliationMarkdown,
  validateC0WiringReconciliation,
} from '../lib/devseek-c0-wiring-reconciliation.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();
const expected = buildC0WiringReconciliation(sources);

test('current C0 wiring reconciliation closes local reports without qualification effect', () => {
  const actual = readJson('docs/process/devseek-c0-wiring-reconciliation.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    reconciled_reports: 6,
    report_hashes_matched: 6,
    package_scripts_covered: 7,
    phase_gates_covered: 7,
    generated_views: 5,
    generated_views_current: 5,
    gate0_repository_pending_blockers: 0,
    gate0_external_authority_blockers: EXPECTED_GATE0_EXTERNAL_BLOCKERS,
    observed_claims: 0,
    bypasses: 0,
  });
  assert.equal(actual.gate0_decision.status, 'NOT_PASSED');
  assert.equal(actual.gate0_decision.claims_empty, true);
  assert.equal(actual.gate0_decision.repository_blockers_empty, true);
  assert.equal(actual.gate0_decision.external_blockers_preserved, true);
  assert.equal(actual.reconciled_reports.every(entry => entry.hash_status === 'matched'), true);
  assert.equal(actual.reconciled_reports.every(entry => entry.phase_gate_present), true);
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateC0WiringReconciliation(actual, sources);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated reconciliation view is source-bound', () => {
  const actualRegistry = readJson('docs/process/devseek-c0-wiring-reconciliation.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-c0-wiring-reconciliation.md'),
    'utf8',
  );

  assert.equal(actualView, renderC0WiringReconciliationMarkdown(actualRegistry));
});

test('schema rejects claim promotion, Gate 0 assertion, and lowered external blockers', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const gatePass = structuredClone(expected);
  gatePass.asserts_gate_pass = true;
  assert.equal(validate(gatePass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/asserts_gate_pass'));

  const lowered = structuredClone(expected);
  lowered.gate0_decision.external_authority_blockers = 0;
  lowered.counts.gate0_external_authority_blockers = 0;
  assert.equal(validate(lowered), false);
  assert.ok(validate.errors.some(error => error.instancePath.includes('external_authority_blockers')));
});

test('runtime fails closed when a reconciled report hash, package script, or Phase gate is missing', () => {
  const hashDrift = structuredClone(expected);
  hashDrift.reconciled_reports[0].reported_sha256 = '0'.repeat(64);
  hashDrift.reconciled_reports[0].hash_status = 'mismatch';
  hashDrift.counts.report_hashes_matched -= 1;
  hashDrift.counts.bypasses += 1;
  assertHasReconciliationError(hashDrift, 'reconciled_reports.c0-ledger-wiring:hash-mismatch');

  const noPackageScript = structuredClone(expected);
  noPackageScript.reconciled_reports[1].package_script_present = false;
  noPackageScript.counts.package_scripts_covered -= 1;
  noPackageScript.counts.bypasses += 1;
  assertHasReconciliationError(noPackageScript, 'reconciled_reports.c0-preregistration-wiring:missing-package-script');

  const noPhase = structuredClone(expected);
  noPhase.reconciled_reports[2].phase_gate_present = false;
  noPhase.counts.phase_gates_covered -= 1;
  noPhase.counts.bypasses += 1;
  assertHasReconciliationError(noPhase, 'reconciled_reports.c0-run-evidence-wiring:missing-phase-gate');
});

test('runtime fails closed when claims, external blockers, source bindings, or generated view drift', () => {
  const localClaim = structuredClone(expected);
  localClaim.gate0_decision.observed_claims = 1;
  localClaim.gate0_decision.claims_empty = false;
  localClaim.counts.observed_claims = 1;
  localClaim.counts.bypasses += 1;
  assertHasReconciliationError(localClaim, 'gate0_decision.claims:must-be-empty');

  const externalBlockerRemoved = structuredClone(expected);
  externalBlockerRemoved.gate0_decision.external_authority_blockers = 5;
  externalBlockerRemoved.gate0_decision.external_blockers_preserved = false;
  externalBlockerRemoved.counts.gate0_external_authority_blockers = 5;
  externalBlockerRemoved.counts.bypasses += 1;
  assertHasReconciliationError(
    externalBlockerRemoved,
    'gate0_decision.external_authority_blockers:must-remain-6',
  );

  const sourceDrift = structuredClone(expected);
  sourceDrift.gate0_decision.source_bindings[0].status = 'mismatch';
  sourceDrift.counts.bypasses += 1;
  assertHasReconciliationError(sourceDrift, 'gate0_decision.source_bindings.gate0-ledger-source:mismatch');

  const staleView = structuredClone(expected);
  staleView.reconciled_reports[3].generated_view.status = 'stale';
  staleView.counts.generated_views_current -= 1;
  staleView.counts.bypasses += 1;
  assertHasReconciliationError(staleView, 'reconciled_reports.c0-manifest-aggregator-wiring:generated-view-stale');
});

test('checker command validates C0 wiring reconciliation and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-c0-wiring-reconciliation-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    reconciliation_sha256: expected.reconciliation_sha256,
    reconciled_reports: 6,
    report_hashes_matched: 6,
    package_scripts_covered: 7,
    phase_gates_covered: 7,
    generated_views_current: '5/5',
    gate0_status: 'NOT_PASSED',
    repository_pending_blockers: 0,
    external_authority_blockers: EXPECTED_GATE0_EXTERNAL_BLOCKERS,
    claims: 0,
    qualification_effect: 'NONE',
    bypasses: 0,
  });
});

function assertHasReconciliationError(value, expectedError) {
  const result = validateC0WiringReconciliation(value, sources);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function loadSources() {
  return {
    ledger: readJson('docs/process/devseek-capability-ledger.json'),
    reports: {
      'c0-ledger-wiring': readJson('docs/process/devseek-c0-ledger-wiring.json'),
      'c0-preregistration-wiring': readJson('docs/process/devseek-c0-preregistration-wiring.json'),
      'c0-run-evidence-wiring': readJson('docs/process/devseek-c0-run-evidence-wiring.json'),
      'c0-manifest-aggregator-wiring': readJson('docs/process/devseek-c0-manifest-aggregator-wiring.json'),
      'external-authority-adapter': readJson('docs/process/devseek-external-authority-adapter.json'),
      'gate0-decision': readJson('docs/process/devseek-gate0-decision-report.json'),
    },
    packageJson: readJson('package.json'),
    sourceContents: Object.fromEntries([
      'package.json',
      'scripts/devseek-phase0-12-verify.mjs',
      'scripts/devseek-c0-ledger-wiring-check.mjs',
      'scripts/devseek-c0-preregistration-wiring-check.mjs',
      'scripts/devseek-c0-run-evidence-wiring-check.mjs',
      'scripts/devseek-c0-manifest-aggregator-wiring-check.mjs',
      'scripts/devseek-external-authority-adapter-check.mjs',
      'scripts/devseek-gate0-decision-check.mjs',
      'scripts/devseek-c0-wiring-reconciliation-check.mjs',
      'scripts/test/devseek-c0-wiring-reconciliation.test.mjs',
      'docs/process/generated/devseek-c0-ledger-wiring.md',
      'docs/process/generated/devseek-c0-preregistration-wiring.md',
      'docs/process/generated/devseek-c0-run-evidence-wiring.md',
      'docs/process/generated/devseek-c0-manifest-aggregator-wiring.md',
      'docs/process/generated/devseek-external-authority-adapter.md',
    ].map(relativePath => [relativePath, readText(relativePath)])),
  };
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-c0-wiring-reconciliation.schema.json'));
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
