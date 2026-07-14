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
  sha256Object,
} from '../lib/devseek-capability-ledger.mjs';
import {
  buildProfileDenominatorRegistry,
  renderProfileDenominatorRegistryMarkdown,
  validateProfileDenominatorRegistry,
} from '../lib/devseek-profile-denominator-registry.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();
const expected = buildProfileDenominatorRegistry(sources);

test('current profile denominator registry is exact, local-only, and non-qualifying', () => {
  const actual = readJson('docs/process/devseek-profile-denominator-registry.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    capabilities: 7,
    slots_per_capability: 5,
    total_slots: 35,
    attempts_per_slot: 2,
    total_attempts: 70,
    catalog_metadata_executions: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateProfileDenominatorRegistry(actual, sources);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated denominator view is source-bound', () => {
  const actualRegistry = readJson('docs/process/devseek-profile-denominator-registry.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-profile-denominator-registry.md'),
    'utf8',
  );

  assert.equal(actualView, renderProfileDenominatorRegistryMarkdown(actualRegistry));
});

test('schema rejects claim promotion and missing denominator policy', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const missingPolicy = structuredClone(expected);
  delete missingPolicy.denominator_policy;
  assert.equal(validate(missingPolicy), false);
  assert.ok(validate.errors.some(error => error.instancePath === ''));
});

test('runtime fails closed when a C0 denominator is missing', () => {
  const mutated = structuredClone(expected);
  mutated.capability_denominators.pop();

  assertHasRegistryError(mutated, 'capability_denominators:expected-7-got-6');
});

test('runtime fails closed on duplicate slot identity', () => {
  const mutated = structuredClone(expected);
  const [first, second] = mutated.capability_denominators[0].slots;
  second.slot_id = first.slot_id;

  assertHasRegistryError(mutated, 'slots.slot_id:duplicate-');
});

test('runtime fails closed on attempt identity drift', () => {
  const mutated = structuredClone(expected);
  const attempt = mutated.capability_denominators[0].slots[0].attempts[0];
  attempt.attempt_identity.slot_id = 'G0-04:DRIFTED-SLOT';
  attempt.attempt_identity_sha256 = sha256Object(attempt.attempt_identity);

  assertHasRegistryError(mutated, '.attempt_identity:parent-denominator-mismatch');
});

test('runtime fails closed when profile applicability is lowered', () => {
  const mutated = structuredClone(expected);
  mutated.capability_denominators[0].applicability_denominator.platform_profiles = [];

  assertHasRegistryError(mutated, '.applicability_denominator.platform_profiles:expected-single-platform-denominator');
});

test('runtime fails closed on wildcard or default claim tuple', () => {
  const wildcard = structuredClone(expected);
  wildcard.capability_denominators[0].profile_denominator.provider = '*';
  assertHasRegistryError(wildcard, '.profile_denominator.provider:wildcard-or-default-forbidden');

  const defaulted = structuredClone(expected);
  defaulted.capability_denominators[0].profile_denominator.surface = 'default';
  assertHasRegistryError(defaulted, '.profile_denominator.surface:wildcard-or-default-forbidden');
});

test('checker command validates registry and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-profile-denominator-registry-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    capabilities: 7,
    slots: 35,
    attempts: 70,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasRegistryError(value, expectedError) {
  const result = validateProfileDenominatorRegistry(value, sources);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function loadSources() {
  return {
    ledger: readJson('docs/process/devseek-capability-ledger.json'),
    milestoneProfiles: readJson('docs/process/devseek-milestone-profiles.json'),
  };
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-profile-denominator-registry.schema.json'));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}
