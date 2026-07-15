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
  RUN_EVIDENCE_CAPABILITY_ID,
  buildC0RunEvidenceWiring,
  renderC0RunEvidenceWiringMarkdown,
  validateC0RunEvidenceWiring,
} from '../lib/devseek-c0-run-evidence-wiring.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();
const expected = buildC0RunEvidenceWiring(sources);

test('current C0 run evidence wiring exact-binds product evidence to qualification attempts without qualification effect', () => {
  const actual = readJson('docs/process/devseek-c0-run-evidence-wiring.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.run_evidence_owner.capability_id, RUN_EVIDENCE_CAPABILITY_ID);
  assert.equal(actual.run_evidence_owner.implementation_state, 'wired');
  assert.equal(actual.run_evidence_owner.verification_has_run_evidence_contract, true);
  assert.equal(actual.run_evidence_owner.verification_has_qualification_evidence_manifest, true);
  assert.equal(actual.run_evidence_owner.verification_has_c0_run_evidence_wiring, true);
  assert.deepEqual(actual.counts, {
    owner_required_components: 9,
    owner_required_components_present: 9,
    binding_guards: 7,
    binding_guards_covered: 7,
    failure_oracles: 7,
    failure_oracles_covered: 7,
    bypasses: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.correlation_contract.adapter_produces_verdict, false);
  assert.equal(actual.correlation_contract.second_ledger_created, false);
  assert.equal(actual.correlation_contract.hides_original_failure, false);
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateC0RunEvidenceWiring(actual, sources);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated C0 run evidence wiring view is source-bound', () => {
  const actualRegistry = readJson('docs/process/devseek-c0-run-evidence-wiring.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-c0-run-evidence-wiring.md'),
    'utf8',
  );

  assert.equal(actualView, renderC0RunEvidenceWiringMarkdown(actualRegistry));
});

test('schema rejects claim promotion, Gate 0 assertion, and local adapter verdicts', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const gatePass = structuredClone(expected);
  gatePass.asserts_gate_pass = true;
  assert.equal(validate(gatePass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/asserts_gate_pass'));

  const verdict = structuredClone(expected);
  verdict.correlation_contract.adapter_produces_verdict = true;
  assert.equal(validate(verdict), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/correlation_contract/adapter_produces_verdict'));
});

test('runtime fails closed when owner is not wired or wiring evidence is absent', () => {
  const notWiredSources = structuredClone(sources);
  const owner = notWiredSources.ledger.capabilities.find(
    capability => capability.capability_id === RUN_EVIDENCE_CAPABILITY_ID,
  );
  owner.implementation_state = 'implemented';
  const notWired = buildC0RunEvidenceWiring(notWiredSources);
  assertHasWiringErrorWithSources(
    notWired,
    notWiredSources,
    'run_evidence_owner.implementation_state:must-be-wired',
  );

  const missingCommand = structuredClone(expected);
  missingCommand.run_evidence_owner.verification_has_c0_run_evidence_wiring = false;
  assertHasWiringError(missingCommand, 'run_evidence_owner.verification:missing-verify-c0-run-evidence-wiring');
});

test('runtime fails closed on missing binding guards, failure oracles, package script, or Phase gate', () => {
  const noOperationGuardSources = structuredClone(sources);
  noOperationGuardSources.sourceContents['scripts/lib/devseek-qualification-evidence-manifest.mjs'] =
    noOperationGuardSources.sourceContents['scripts/lib/devseek-qualification-evidence-manifest.mjs']
      .replace('RUN_EVIDENCE_OPERATION_BINDING_MISMATCH', 'RUN_EVIDENCE_OPERATION_REMOVED');
  const noOperationGuard = buildC0RunEvidenceWiring(noOperationGuardSources);
  assertHasWiringErrorWithSources(noOperationGuard, noOperationGuardSources, 'binding_guards.operation-event-binding:not-covered');

  const noOracleSources = structuredClone(sources);
  noOracleSources.sourceContents['scripts/test/devseek-qualification-evidence-manifest.test.mjs'] =
    noOracleSources.sourceContents['scripts/test/devseek-qualification-evidence-manifest.test.mjs']
      .replace("correlation.attempt_outcome = 'pass'", "correlation.attempt_outcome = 'product-miss'");
  const noOracle = buildC0RunEvidenceWiring(noOracleSources);
  assertHasWiringErrorWithSources(noOracle, noOracleSources, 'failure_oracles.hidden-original-failure:not-covered');

  const noPackageSources = structuredClone(sources);
  delete noPackageSources.packageJson.scripts['verify:c0-run-evidence-wiring'];
  noPackageSources.sourceContents['package.json'] =
    noPackageSources.sourceContents['package.json'].replace('"verify:c0-run-evidence-wiring"', '"verify:c0-run-evidence-wiring-removed"');
  const noPackage = buildC0RunEvidenceWiring(noPackageSources);
  assertHasWiringErrorWithSources(noPackage, noPackageSources, 'correlation_contract.package_script_present:missing');

  const noPhaseSources = structuredClone(sources);
  noPhaseSources.sourceContents['scripts/devseek-phase0-12-verify.mjs'] =
    noPhaseSources.sourceContents['scripts/devseek-phase0-12-verify.mjs']
      .replace("id: 'c0-run-evidence-wiring-conformance'", "id: 'c0-run-evidence-wiring-removed'");
  const noPhase = buildC0RunEvidenceWiring(noPhaseSources);
  assertHasWiringErrorWithSources(noPhase, noPhaseSources, 'correlation_contract.phase_gate_present:missing');
});

test('checker command validates C0 run evidence wiring and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-c0-run-evidence-wiring-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    ledger_sha256: expected.sources.capability_ledger.source_sha256,
    run_evidence_owner: RUN_EVIDENCE_CAPABILITY_ID,
    owner_state: 'wired',
    owner_components_present: 9,
    binding_guards_covered: 7,
    failure_oracles_covered: 7,
    bypasses: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasWiringError(value, expectedError) {
  assertHasWiringErrorWithSources(value, sources, expectedError);
}

function assertHasWiringErrorWithSources(value, activeSources, expectedError) {
  const result = validateC0RunEvidenceWiring(value, activeSources);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function loadSources() {
  const sourcePaths = [
    'docs/process/devseek-qualification-evidence-manifest.schema.json',
    'docs/process/devseek-run-evidence-event.schema.json',
    'docs/process/devseek-run-evidence-snapshot.schema.json',
    'docs/process/devseek-run-evidence-expected-anchor.schema.json',
    'docs/process/devseek-run-evidence-correlation.schema.json',
    'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    'scripts/test/devseek-qualification-evidence-manifest.test.mjs',
    'scripts/devseek-run-evidence-contract-check.mjs',
    'scripts/test/devseek-run-evidence-contract.test.mjs',
    'package.json',
    'scripts/devseek-phase0-12-verify.mjs',
    'scripts/devseek-c0-run-evidence-wiring-check.mjs',
    'scripts/test/devseek-c0-run-evidence-wiring.test.mjs',
  ];
  return {
    ledger: readJson('docs/process/devseek-capability-ledger.json'),
    packageJson: readJson('package.json'),
    sourceContents: Object.fromEntries(sourcePaths.map(relativePath => [
      relativePath,
      readText(relativePath),
    ])),
  };
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-c0-run-evidence-wiring.schema.json'));
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
