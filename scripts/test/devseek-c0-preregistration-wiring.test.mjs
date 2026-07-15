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
  PREREGISTRATION_CAPABILITY_ID,
  buildC0PreregistrationWiring,
  collectInventorySources,
  renderC0PreregistrationWiringMarkdown,
  validateC0PreregistrationWiring,
} from '../lib/devseek-c0-preregistration-wiring.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();
const expected = buildC0PreregistrationWiring(sources);

test('current C0 preregistration wiring covers production declarations and receipt gates without qualification effect', () => {
  const actual = readJson('docs/process/devseek-c0-preregistration-wiring.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.preregistration_owner.capability_id, PREREGISTRATION_CAPABILITY_ID);
  assert.equal(actual.preregistration_owner.implementation_state, 'wired');
  assert.equal(actual.preregistration_owner.verification_has_qualification_protocol, true);
  assert.equal(actual.preregistration_owner.verification_has_qualification_runner, true);
  assert.equal(actual.preregistration_owner.verification_has_preregistration_wiring, true);
  assert.deepEqual(actual.counts, {
    production_declaration_entries: 4,
    production_declaration_entries_covered: 4,
    runner_roots: 1,
    chain_steps: 7,
    chain_steps_covered: 7,
    protocol_guards: 4,
    protocol_guards_covered: 4,
    zero_dispatch_oracles: 4,
    zero_dispatch_oracles_covered: 4,
    dispatch_bypasses: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.production_entrypoints.every(entry => entry.coverage_status === 'covered'), true);
  assert.equal(actual.zero_dispatch_oracles.every(oracle => oracle.expected_external_actions === 0), true);
  assert.equal(actual.bypass_guards.tofu_registration_allowed, false);
  assert.equal(actual.bypass_guards.durable_registration_after_dispatch_allowed, false);
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateC0PreregistrationWiring(actual, sources);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated C0 preregistration wiring view is source-bound', () => {
  const actualRegistry = readJson('docs/process/devseek-c0-preregistration-wiring.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-c0-preregistration-wiring.md'),
    'utf8',
  );

  assert.equal(actualView, renderC0PreregistrationWiringMarkdown(actualRegistry));
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

test('runtime fails closed when C0 preregistration owner is not wired or lacks evidence', () => {
  const notWiredSources = structuredClone(sources);
  const prereg = notWiredSources.ledger.capabilities.find(
    capability => capability.capability_id === PREREGISTRATION_CAPABILITY_ID,
  );
  prereg.implementation_state = 'implemented';
  const notWired = buildC0PreregistrationWiring(notWiredSources);
  assertHasWiringErrorWithSources(
    notWired,
    notWiredSources,
    'preregistration_owner.implementation_state:must-be-wired',
  );

  const missingVerification = structuredClone(expected);
  missingVerification.preregistration_owner.verification_has_preregistration_wiring = false;
  assertHasWiringError(missingVerification, 'preregistration_owner.verification:missing-verify-c0-preregistration-wiring');
});

test('runtime fails closed when a production entry is enabled as qualification', () => {
  const mutatedSources = structuredClone(sources);
  const entry = mutatedSources.runnerInventory.entries.find(item => item.entry_id === 'production/vscode-chat');
  entry.qualification_enabled = true;
  entry.composition_root = 'scripts/lib/devseek-qualification-runner.mjs#createQualificationRunner';
  entry.status = 'wired-local-nonqualification';
  const mutated = buildC0PreregistrationWiring(mutatedSources);

  assertHasWiringErrorWithSources(
    mutated,
    mutatedSources,
    'production_entrypoints.production/vscode-chat:not-covered',
  );
  assertHasWiringErrorWithSources(mutated, mutatedSources, 'counts.dispatch_bypasses:must-be-0');
});

test('runtime fails closed when runner chain, Phase gate, or package script is bypassed', () => {
  const directDispatchSources = structuredClone(sources);
  directDispatchSources.sourceContents['scripts/lib/devseek-qualification-runner.mjs'] =
    directDispatchSources.sourceContents['scripts/lib/devseek-qualification-runner.mjs']
      .replace('guardedAction.execute({ plan, receipt: actionReceipt, action })', 'dispatch(action)');
  const directDispatch = buildC0PreregistrationWiring(directDispatchSources);
  assertHasWiringErrorWithSources(
    directDispatch,
    directDispatchSources,
    'runner_composition.direct_dispatch_bypass_present:must-be-false',
  );

  const noPhaseSources = structuredClone(sources);
  noPhaseSources.sourceContents['scripts/devseek-phase0-12-verify.mjs'] =
    noPhaseSources.sourceContents['scripts/devseek-phase0-12-verify.mjs']
      .replace("id: 'c0-preregistration-wiring-conformance'", "id: 'c0-preregistration-wiring-removed'");
  const noPhase = buildC0PreregistrationWiring(noPhaseSources);
  assertHasWiringErrorWithSources(noPhase, noPhaseSources, 'runner_composition.phase_gate_present:missing');

  const noScriptSources = structuredClone(sources);
  delete noScriptSources.packageJson.scripts['verify:c0-preregistration-wiring'];
  noScriptSources.sourceContents['package.json'] = noScriptSources.sourceContents['package.json']
    .replace('"verify:c0-preregistration-wiring"', '"verify:c0-preregistration-wiring-removed"');
  const noScript = buildC0PreregistrationWiring(noScriptSources);
  assertHasWiringErrorWithSources(noScript, noScriptSources, 'runner_composition.package_script_present:missing');
});

test('runtime fails closed when receipt guard oracles for missing expired replay or rollback dispatch drift', () => {
  for (const [sourceRef, fragment, expectedError] of [
    ['scripts/test/devseek-qualification-runner.test.mjs', 'ACTION_RECEIPT_REQUIRED', 'zero_dispatch_oracles.missing-receipt:not-covered'],
    ['scripts/test/devseek-qualification-protocol.test.mjs', 'ACTION_RECEIPT_EXPIRED', 'zero_dispatch_oracles.expired-receipt:not-covered'],
    ['scripts/test/devseek-qualification-protocol.test.mjs', 'ACTION_RECEIPT_ALREADY_CONSUMED', 'zero_dispatch_oracles.replay-receipt:not-covered'],
    ['scripts/test/devseek-qualification-protocol.test.mjs', 'CLOCK_ROLLBACK', 'zero_dispatch_oracles.clock-rollback:not-covered'],
  ]) {
    const mutatedSources = structuredClone(sources);
    mutatedSources.sourceContents[sourceRef] = mutatedSources.sourceContents[sourceRef]
      .split(fragment)
      .join(`REMOVED_${expectedError}`);
    const mutated = buildC0PreregistrationWiring(mutatedSources);
    assertHasWiringErrorWithSources(mutated, mutatedSources, expectedError);
  }
});

test('checker command validates C0 preregistration wiring and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-c0-preregistration-wiring-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    ledger_sha256: expected.sources.capability_ledger.source_sha256,
    preregistration_owner: PREREGISTRATION_CAPABILITY_ID,
    owner_state: 'wired',
    production_entries: 4,
    production_entries_covered: 4,
    runner_roots: 1,
    chain_steps_covered: 7,
    zero_dispatch_oracles_covered: 4,
    dispatch_bypasses: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasWiringError(value, expectedError) {
  assertHasWiringErrorWithSources(value, sources, expectedError);
}

function assertHasWiringErrorWithSources(value, activeSources, expectedError) {
  const result = validateC0PreregistrationWiring(value, activeSources);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function loadSources() {
  const runnerInventory = readJson('docs/process/devseek-qualification-runner-inventory.json');
  return {
    repoRoot,
    ledger: readJson('docs/process/devseek-capability-ledger.json'),
    runnerInventory,
    executorContracts: readJson('docs/process/devseek-profile-executor-contracts.json'),
    packageJson: readJson('package.json'),
    sourceContents: {
      ...collectInventorySources(repoRoot, runnerInventory),
      'package.json': readText('package.json'),
      'scripts/devseek-phase0-12-verify.mjs': readText('scripts/devseek-phase0-12-verify.mjs'),
      'docs/process/devseek-qualification-plan.schema.json': readText('docs/process/devseek-qualification-plan.schema.json'),
      'docs/process/devseek-qualification-event.schema.json': readText('docs/process/devseek-qualification-event.schema.json'),
      'docs/process/devseek-qualification-receipt.schema.json': readText('docs/process/devseek-qualification-receipt.schema.json'),
      'scripts/lib/devseek-qualification-protocol.mjs': readText('scripts/lib/devseek-qualification-protocol.mjs'),
      'scripts/lib/devseek-qualification-runner.mjs': readText('scripts/lib/devseek-qualification-runner.mjs'),
      'scripts/test/devseek-qualification-runner.test.mjs': readText('scripts/test/devseek-qualification-runner.test.mjs'),
      'scripts/test/devseek-qualification-protocol.test.mjs': readText('scripts/test/devseek-qualification-protocol.test.mjs'),
      'scripts/devseek-c0-preregistration-wiring-check.mjs': readText('scripts/devseek-c0-preregistration-wiring-check.mjs'),
      'scripts/test/devseek-c0-preregistration-wiring.test.mjs': readText('scripts/test/devseek-c0-preregistration-wiring.test.mjs'),
    },
  };
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-c0-preregistration-wiring.schema.json'));
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
