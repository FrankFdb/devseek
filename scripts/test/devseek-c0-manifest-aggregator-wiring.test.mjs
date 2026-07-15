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
  AGGREGATOR_CAPABILITY_ID,
  MANIFEST_CAPABILITY_ID,
  buildC0ManifestAggregatorWiring,
  renderC0ManifestAggregatorWiringMarkdown,
  validateC0ManifestAggregatorWiring,
} from '../lib/devseek-c0-manifest-aggregator-wiring.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();
const expected = buildC0ManifestAggregatorWiring(sources);

test('current C0 manifest aggregator wiring recomputes manifest evidence without qualification effect', () => {
  const actual = readJson('docs/process/devseek-c0-manifest-aggregator-wiring.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.owners.aggregator.capability_id, AGGREGATOR_CAPABILITY_ID);
  assert.equal(actual.owners.evidence_manifest.capability_id, MANIFEST_CAPABILITY_ID);
  assert.equal(actual.owners.aggregator.implementation_state, 'wired');
  assert.equal(actual.owners.evidence_manifest.implementation_state, 'wired');
  assert.equal(actual.owners.aggregator.verification_has_qualification_evidence_manifest, true);
  assert.equal(actual.owners.aggregator.verification_has_c0_manifest_aggregator_wiring, true);
  assert.equal(actual.owners.evidence_manifest.verification_has_qualification_evidence_manifest, true);
  assert.equal(actual.owners.evidence_manifest.verification_has_c0_manifest_aggregator_wiring, true);
  assert.deepEqual(actual.counts, {
    owners: 2,
    owner_required_components: 24,
    owner_required_components_present: 24,
    aggregation_guards: 8,
    aggregation_guards_covered: 8,
    failure_oracles: 8,
    failure_oracles_covered: 8,
    bypasses: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.aggregation_contract.reader_recomputes_manifest_derivation, true);
  assert.equal(actual.aggregation_contract.reader_rejects_writer_summary, true);
  assert.equal(actual.aggregation_contract.same_repository_hash_is_trust_root, false);
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateC0ManifestAggregatorWiring(actual, sources);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated C0 manifest aggregator wiring view is source-bound', () => {
  const actualRegistry = readJson('docs/process/devseek-c0-manifest-aggregator-wiring.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-c0-manifest-aggregator-wiring.md'),
    'utf8',
  );

  assert.equal(actualView, renderC0ManifestAggregatorWiringMarkdown(actualRegistry));
});

test('schema rejects claim promotion, Gate 0 assertion, and local protected-claim production', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const gatePass = structuredClone(expected);
  gatePass.asserts_gate_pass = true;
  assert.equal(validate(gatePass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/asserts_gate_pass'));

  const protectedClaim = structuredClone(expected);
  protectedClaim.aggregation_contract.aggregator_produces_protected_claims_locally = true;
  assert.equal(validate(protectedClaim), false);
  assert.ok(validate.errors.some(
    error => error.instancePath === '/aggregation_contract/aggregator_produces_protected_claims_locally',
  ));
});

test('runtime fails closed when either C0 owner is not wired or lacks wiring evidence', () => {
  for (const capabilityId of [AGGREGATOR_CAPABILITY_ID, MANIFEST_CAPABILITY_ID]) {
    const notWiredSources = structuredClone(sources);
    const owner = notWiredSources.ledger.capabilities.find(
      capability => capability.capability_id === capabilityId,
    );
    owner.implementation_state = 'implemented';
    const notWired = buildC0ManifestAggregatorWiring(notWiredSources);
    assertHasWiringErrorWithSources(
      notWired,
      notWiredSources,
      capabilityId === AGGREGATOR_CAPABILITY_ID
        ? 'owners.aggregator.implementation_state:not-wired'
        : 'owners.evidence_manifest.implementation_state:not-wired',
    );

    const missingEvidenceSources = structuredClone(sources);
    const missingOwner = missingEvidenceSources.ledger.capabilities.find(
      capability => capability.capability_id === capabilityId,
    );
    missingOwner.implementation_components = missingOwner.implementation_components.filter(
      component => component.path !== 'scripts/test/devseek-c0-manifest-aggregator-wiring.test.mjs',
    );
    const missingEvidence = buildC0ManifestAggregatorWiring(missingEvidenceSources);
    assertHasWiringErrorWithSources(
      missingEvidence,
      missingEvidenceSources,
      capabilityId === AGGREGATOR_CAPABILITY_ID
        ? 'owners.aggregator.component:scripts/test/devseek-c0-manifest-aggregator-wiring.test.mjs:missing'
        : 'owners.evidence_manifest.component:scripts/test/devseek-c0-manifest-aggregator-wiring.test.mjs:missing',
    );
  }
});

test('runtime fails closed on missing aggregation guards, failure oracles, package script, or Phase gate', () => {
  const noDerivationSources = structuredClone(sources);
  noDerivationSources.sourceContents['scripts/lib/devseek-qualification-evidence-manifest.mjs'] =
    noDerivationSources.sourceContents['scripts/lib/devseek-qualification-evidence-manifest.mjs']
      .replace('MANIFEST_DERIVATION_MISMATCH', 'MANIFEST_DERIVATION_REMOVED');
  const noDerivation = buildC0ManifestAggregatorWiring(noDerivationSources);
  assertHasWiringErrorWithSources(noDerivation, noDerivationSources, 'aggregation_contract.reader_recomputes_manifest_derivation:missing');
  assertHasWiringErrorWithSources(noDerivation, noDerivationSources, 'aggregation_guards.independent-derived-manifest:not-covered');

  const noRetentionSources = structuredClone(sources);
  noRetentionSources.sourceContents['scripts/lib/devseek-qualification-evidence-manifest.mjs'] =
    noRetentionSources.sourceContents['scripts/lib/devseek-qualification-evidence-manifest.mjs']
      .replace('RETENTION_EXPECTED_ANCHOR_MISMATCH', 'RETENTION_EXPECTED_ANCHOR_REMOVED');
  const noRetention = buildC0ManifestAggregatorWiring(noRetentionSources);
  assertHasWiringErrorWithSources(noRetention, noRetentionSources, 'aggregation_contract.reader_verifies_retention_and_anchor:missing');
  assertHasWiringErrorWithSources(noRetention, noRetentionSources, 'aggregation_guards.retention-lock-and-anchor:not-covered');

  const noOracleSources = structuredClone(sources);
  noOracleSources.sourceContents['scripts/test/devseek-qualification-evidence-manifest.test.mjs'] =
    noOracleSources.sourceContents['scripts/test/devseek-qualification-evidence-manifest.test.mjs']
      .replace('allowlisted signer cannot omit a signed failure or invent a cross-tuple claim', 'allowlisted signer removed');
  const noOracle = buildC0ManifestAggregatorWiring(noOracleSources);
  assertHasWiringErrorWithSources(noOracle, noOracleSources, 'failure_oracles.writer-forged-summary:not-covered');

  const noPackageSources = structuredClone(sources);
  delete noPackageSources.packageJson.scripts['verify:c0-manifest-aggregator-wiring'];
  noPackageSources.sourceContents['package.json'] =
    noPackageSources.sourceContents['package.json'].replace(
      '"verify:c0-manifest-aggregator-wiring"',
      '"verify:c0-manifest-aggregator-wiring-removed"',
    );
  const noPackage = buildC0ManifestAggregatorWiring(noPackageSources);
  assertHasWiringErrorWithSources(noPackage, noPackageSources, 'aggregation_contract.package_script_present:missing');

  const noPhaseSources = structuredClone(sources);
  noPhaseSources.sourceContents['scripts/devseek-phase0-12-verify.mjs'] =
    noPhaseSources.sourceContents['scripts/devseek-phase0-12-verify.mjs']
      .replace("id: 'c0-manifest-aggregator-wiring-conformance'", "id: 'c0-manifest-aggregator-wiring-removed'");
  const noPhase = buildC0ManifestAggregatorWiring(noPhaseSources);
  assertHasWiringErrorWithSources(noPhase, noPhaseSources, 'aggregation_contract.phase_gate_present:missing');
});

test('checker command validates C0 manifest aggregator wiring and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-c0-manifest-aggregator-wiring-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    ledger_sha256: expected.sources.capability_ledger.source_sha256,
    aggregator_owner: AGGREGATOR_CAPABILITY_ID,
    manifest_owner: MANIFEST_CAPABILITY_ID,
    aggregator_state: 'wired',
    manifest_state: 'wired',
    owner_components_present: 24,
    aggregation_guards_covered: 8,
    failure_oracles_covered: 8,
    bypasses: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasWiringErrorWithSources(value, activeSources, expectedError) {
  const result = validateC0ManifestAggregatorWiring(value, activeSources);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function loadSources() {
  const sourcePaths = [
    'docs/process/devseek-qualification-aggregator-policy.json',
    'docs/process/devseek-qualification-aggregator-policy.schema.json',
    'docs/process/devseek-qualification-evidence-manifest.schema.json',
    'docs/process/devseek-qualification-retention-lock.schema.json',
    'docs/process/devseek-qualification-plan.schema.json',
    'docs/process/devseek-qualification-event.schema.json',
    'docs/process/devseek-qualification-receipt.schema.json',
    'docs/process/devseek-run-evidence-correlation.schema.json',
    'docs/process/devseek-c0-run-evidence-wiring.json',
    'scripts/lib/devseek-qualification-evidence-manifest.mjs',
    'scripts/devseek-qualification-evidence-manifest-check.mjs',
    'scripts/test/devseek-qualification-evidence-manifest.test.mjs',
    'package.json',
    'scripts/devseek-phase0-12-verify.mjs',
    'scripts/devseek-c0-manifest-aggregator-wiring-check.mjs',
    'scripts/test/devseek-c0-manifest-aggregator-wiring.test.mjs',
  ];
  return {
    ledger: readJson('docs/process/devseek-capability-ledger.json'),
    aggregationPolicy: readJson('docs/process/devseek-qualification-aggregator-policy.json'),
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
  return ajv.compile(readJson('docs/process/devseek-c0-manifest-aggregator-wiring.schema.json'));
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
