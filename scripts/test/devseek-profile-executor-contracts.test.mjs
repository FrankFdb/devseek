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
  buildProfileExecutorContracts,
  renderProfileExecutorContractsMarkdown,
  validateProfileExecutorContracts,
} from '../lib/devseek-profile-executor-contracts.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();
const expected = buildProfileExecutorContracts(sources);

test('current profile executor contracts cover every G0-04 slot semantic without qualification effect', () => {
  const actual = readJson('docs/process/devseek-profile-executor-contracts.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    slot_semantics: 5,
    denominator_slots: 35,
    denominator_attempts: 70,
    executor_contracts: 5,
    oracle_contracts: 5,
    zero_action_attack_oracles: 25,
    execution_results: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.executor_policy.composition_root, 'scripts/lib/devseek-qualification-runner.mjs#createQualificationRunner');
  assert.equal(actual.executor_policy.catalog_metadata_counts_as_execution, false);
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateProfileExecutorContracts(actual, sources);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
  assert.equal(validation.summary.executor_coverage, 1);
});

test('generated profile executor contract view is source-bound', () => {
  const actualRegistry = readJson('docs/process/devseek-profile-executor-contracts.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-profile-executor-contracts.md'),
    'utf8',
  );

  assert.equal(actualView, renderProfileExecutorContractsMarkdown(actualRegistry));
});

test('schema rejects claim promotion and missing executor policy', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const missingPolicy = structuredClone(expected);
  delete missingPolicy.executor_policy;
  assert.equal(validate(missingPolicy), false);
  assert.ok(validate.errors.some(error => error.instancePath === ''));
});

test('runtime fails closed when a declared slot semantic has no executor contract', () => {
  const mutated = structuredClone(expected);
  mutated.contracts.pop();

  assertHasContractError(mutated, 'contracts:expected-5-got-4');
  assertHasContractError(mutated, 'contracts:semantic-coverage-mismatch');
});

test('runtime rejects one generic contract or oracle reused across semantics', () => {
  const duplicateContract = structuredClone(expected);
  duplicateContract.contracts[1].contract_id = duplicateContract.contracts[0].contract_id;
  assertHasContractError(duplicateContract, 'contracts.contract_id:duplicate-');

  const duplicateOracle = structuredClone(expected);
  duplicateOracle.contracts[1].oracle_ref.oracle_id = duplicateOracle.contracts[0].oracle_ref.oracle_id;
  assertHasContractError(duplicateOracle, 'contracts.oracle_ref.oracle_id:duplicate-');
});

test('runtime fails closed when registry source binding drifts', () => {
  const mutated = structuredClone(expected);
  mutated.sources.profile_denominator_registry.source_sha256 = '0'.repeat(64);

  assertHasContractError(mutated, 'sources:expected-current-denominator-runner-and-source-binding');
});

test('runtime fails closed when slot or attempt identity is replaced', () => {
  const mutated = structuredClone(expected);
  mutated.contracts[0].denominator_binding.slot_ids[0] = 'G0-05:DRIFTED-SLOT';
  mutated.contracts[0].denominator_binding.attempt_ids[0] = 'G0-05:DRIFTED-ATTEMPT';

  assertHasContractError(mutated, 'contracts[0]:expected-exact-executor-contract');
});

test('runtime requires every zero-action attack oracle for every semantic', () => {
  const mutated = structuredClone(expected);
  mutated.contracts[0].zero_action_attack_oracles = mutated.contracts[0]
    .zero_action_attack_oracles
    .filter(attack => attack.attack_id !== 'missing-authorization-receipt');

  assertHasContractError(mutated, '.zero_action_attack_oracles:expected-5-got-4');
  assertHasContractError(mutated, '.zero_action_attack_oracles:attack-coverage-mismatch');
});

test('checker command validates profile executor contracts and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-profile-executor-contracts-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    slot_semantics: 5,
    denominator_slots: 35,
    denominator_attempts: 70,
    executor_coverage: 1,
    oracle_contracts: 5,
    zero_action_attack_oracles: 25,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasContractError(value, expectedError) {
  const result = validateProfileExecutorContracts(value, sources);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function loadSources() {
  return {
    denominatorRegistry: readJson('docs/process/devseek-profile-denominator-registry.json'),
    runnerInventory: readJson('docs/process/devseek-qualification-runner-inventory.json'),
    sourceContents: {
      'scripts/lib/devseek-qualification-runner.mjs': readText('scripts/lib/devseek-qualification-runner.mjs'),
      'scripts/test/devseek-profile-executor-contracts.test.mjs': readText('scripts/test/devseek-profile-executor-contracts.test.mjs'),
    },
  };
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-profile-executor-contracts.schema.json'));
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
