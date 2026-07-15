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
  LEDGER_OWNER_CAPABILITY_ID,
  buildC0LedgerWiring,
  renderC0LedgerWiringMarkdown,
  validateC0LedgerWiring,
} from '../lib/devseek-c0-ledger-wiring.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();
const expected = buildC0LedgerWiring(sources);

test('current C0 ledger wiring has one ledger owner and complete consumer coverage without qualification effect', () => {
  const actual = readJson('docs/process/devseek-c0-ledger-wiring.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    ledger_source_owners: 1,
    ledger_schema_owners: 1,
    governed_consumers: 7,
    governed_consumers_covered: 7,
    bypasses: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.ledger_owner.capability_id, LEDGER_OWNER_CAPABILITY_ID);
  assert.equal(actual.ledger_owner.implementation_state, 'wired');
  assert.equal(actual.ledger_owner.verification_has_capability_ledger, true);
  assert.equal(actual.ledger_owner.verification_has_c0_wiring, true);
  assert.equal(actual.governed_consumers.every(consumer => consumer.coverage_status === 'covered'), true);
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateC0LedgerWiring(actual, sources);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated C0 ledger wiring view is source-bound', () => {
  const actualRegistry = readJson('docs/process/devseek-c0-ledger-wiring.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-c0-ledger-wiring.md'),
    'utf8',
  );

  assert.equal(actualView, renderC0LedgerWiringMarkdown(actualRegistry));
});

test('schema rejects claim promotion and Gate 0 assertion', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const gatePass = structuredClone(expected);
  gatePass.asserts_gate_pass = true;
  assert.equal(validate(gatePass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/asserts_gate_pass'));
});

test('runtime fails closed when ledger owner is not wired', () => {
  const mutated = structuredClone(expected);
  mutated.ledger_owner.implementation_state = 'implemented';

  assertHasWiringError(mutated, 'ledger_owner.implementation_state:must-be-wired');
});

test('runtime fails closed on second ledger owner or missing wiring evidence', () => {
  const duplicateOwnerSources = structuredClone(sources);
  duplicateOwnerSources.ledger.capabilities[1].implementation_components.push({
    role: 'unauthorized-source-of-truth',
    path: 'docs/process/devseek-capability-ledger.json',
  });
  const duplicateOwner = buildC0LedgerWiring(duplicateOwnerSources);
  assertHasWiringErrorWithSources(
    duplicateOwner,
    duplicateOwnerSources,
    'counts.ledger_source_owners:must-be-1',
  );

  const missingEvidence = structuredClone(expected);
  missingEvidence.ledger_owner.verification_has_c0_wiring = false;
  assertHasWiringError(missingEvidence, 'ledger_owner.verification:missing-verify-c0-ledger-wiring');
});

test('runtime fails closed on consumer bypass, missing phase gate, or manual state file', () => {
  const consumerBypass = structuredClone(expected);
  consumerBypass.governed_consumers[0].coverage_status = 'blocked';
  consumerBypass.counts.governed_consumers_covered = 6;
  consumerBypass.counts.bypasses = 1;
  assertHasWiringError(consumerBypass, 'counts.governed_consumers_covered:must-equal-governed-consumers');

  const noPhaseSources = structuredClone(sources);
  noPhaseSources.sourceContents['scripts/devseek-phase0-12-verify.mjs'] =
    noPhaseSources.sourceContents['scripts/devseek-phase0-12-verify.mjs']
      .replace("id: 'c0-ledger-wiring-conformance'", "id: 'c0-ledger-wiring-removed'");
  const noPhase = buildC0LedgerWiring(noPhaseSources);
  assert.equal(noPhase.governed_consumers.find(
    consumer => consumer.consumer_id === 'c0-ledger-wiring',
  ).coverage_status, 'blocked');
  assertHasWiringErrorWithSources(noPhase, noPhaseSources, 'governed_consumers.c0-ledger-wiring:not-covered');

  const manualStateSources = structuredClone(sources);
  manualStateSources.processFiles.push('docs/process/devseek-capability-state.json');
  const manualState = buildC0LedgerWiring(manualStateSources);
  assertHasWiringErrorWithSources(
    manualState,
    manualStateSources,
    'bypass_guards.forbidden_process_state_files:must-be-empty',
  );
});

test('checker command validates C0 ledger wiring and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-c0-ledger-wiring-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    ledger_sha256: expected.sources.capability_ledger.source_sha256,
    ledger_owner: LEDGER_OWNER_CAPABILITY_ID,
    ledger_owner_state: 'wired',
    ledger_source_owners: 1,
    ledger_schema_owners: 1,
    governed_consumers: 7,
    governed_consumers_covered: 7,
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
  const result = validateC0LedgerWiring(value, activeSources);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function loadSources() {
  return {
    repoRoot,
    ledger: readJson('docs/process/devseek-capability-ledger.json'),
    packageJson: readJson('package.json'),
    processFiles: collectProcessFiles('docs/process'),
    sourceContents: {
      'package.json': readText('package.json'),
      'scripts/devseek-phase0-12-verify.mjs': readText('scripts/devseek-phase0-12-verify.mjs'),
      'scripts/devseek-capability-ledger-check.mjs': readText('scripts/devseek-capability-ledger-check.mjs'),
      'scripts/devseek-c0-ledger-wiring-check.mjs': readText('scripts/devseek-c0-ledger-wiring-check.mjs'),
      'scripts/devseek-c0-run-evidence-wiring-check.mjs': readText('scripts/devseek-c0-run-evidence-wiring-check.mjs'),
      'scripts/devseek-c0-manifest-aggregator-wiring-check.mjs': readText('scripts/devseek-c0-manifest-aggregator-wiring-check.mjs'),
      'scripts/devseek-external-authority-adapter-check.mjs': readText('scripts/devseek-external-authority-adapter-check.mjs'),
      'scripts/devseek-profile-denominator-registry-check.mjs': readText('scripts/devseek-profile-denominator-registry-check.mjs'),
      'scripts/devseek-gate0-decision-check.mjs': readText('scripts/devseek-gate0-decision-check.mjs'),
      'scripts/test/devseek-c0-ledger-wiring.test.mjs': readText('scripts/test/devseek-c0-ledger-wiring.test.mjs'),
    },
  };
}

function collectProcessFiles(relativeDirectory) {
  const result = [];
  collect(relativeDirectory);
  return result.sort();

  function collect(directory) {
    for (const entry of fs.readdirSync(path.join(repoRoot, directory), { withFileTypes: true })) {
      const relativePath = path.join(directory, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) collect(relativePath);
      else if (entry.isFile()) result.push(relativePath);
    }
  }
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-c0-ledger-wiring.schema.json'));
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
