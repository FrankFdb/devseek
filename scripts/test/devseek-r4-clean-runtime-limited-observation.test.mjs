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
  readJson,
} from '../lib/devseek-capability-ledger.mjs';
import {
  buildR4CleanRuntimeLimitedObservation,
  renderR4CleanRuntimeLimitedObservationMarkdown,
  validateR4CleanRuntimeLimitedObservation,
} from '../lib/devseek-r4-clean-runtime-limited-observation.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4CleanRuntimeLimitedObservation({ repoRoot });

test('R4 clean runtime limited observation records the current identity boundary without qualification effect', () => {
  const actual = readJson('docs/process/devseek-r4-clean-runtime-limited-observation.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.current_leaf, 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME');
  assert.equal(actual.terminal_state, expected.terminal_state);
  assert.equal(actual.clean_runtime_identity_established, expected.clean_runtime_identity_established);
  assert.equal(actual.expected_candidate_identity.candidate_source_commit, 'a034e5e050c044460fb07705639d9d41e6b193c0');
  assert.equal(actual.expected_candidate_identity.matches_release_candidate_manifest, true);
  assert.equal(
    actual.tracked_registry_comparison.tracked_matches_expected_identity,
    expected.tracked_registry_comparison.tracked_matches_expected_identity,
  );
  assert.equal(actual.live_runtime_observation.stable_runtime_count, expected.live_runtime_observation.stable_runtime_count);
  assert.equal(actual.live_runtime_observation.full_commandline_recorded, false);
  assert.equal(actual.live_runtime_observation.environment_variables_recorded, false);
  assert.equal(actual.live_runtime_observation.secrets_recorded, false);
  assert.equal(actual.counts.live_runs_authorized, 0);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);
  assert.equal(actual.source_bindings.r4_iteration_status_rollup, undefined);
  assert.deepEqual(actual.context_references.r4_iteration_status_rollup, {
    path: 'docs/process/devseek-r4-iteration-status-rollup.json',
    binding_mode: 'context-reference-not-hash-input',
    reason: 'avoid-recursive-hash-cycle-because-rollup-binds-this-observation',
    expected_clean_runtime_leaf_terminal_state: expected.terminal_state,
  });

  const validation = validateR4CleanRuntimeLimitedObservation(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated R4 clean runtime observation view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-clean-runtime-limited-observation.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-clean-runtime-limited-observation.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4CleanRuntimeLimitedObservationMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 授权边界/u);
  assert.match(actualView, /## 上下文引用/u);
  assert.match(actualView, /## Runtime 观察/u);
  assert.match(actualView, /## 下一授权/u);
});

test('schema rejects claim promotion, window authority expansion, and live run authorization', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const windowExpansion = structuredClone(expected);
  windowExpansion.observation_authority.install_or_window_actions = 'ALLOWED';
  assert.equal(validate(windowExpansion), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/observation_authority/install_or_window_actions'));

  const liveAuthorized = structuredClone(expected);
  liveAuthorized.counts.live_runs_authorized = 1;
  assert.equal(validate(liveAuthorized), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/counts/live_runs_authorized'));

  const hashCycle = structuredClone(expected);
  hashCycle.source_bindings.r4_iteration_status_rollup = {
    path: 'docs/process/devseek-r4-iteration-status-rollup.json',
    source_sha256: '0'.repeat(64),
  };
  assert.equal(validate(hashCycle), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/source_bindings'));
});

test('runtime validation fails closed on false completion, secret capture, or stale counts', () => {
  const terminalDrift = structuredClone(expected);
  terminalDrift.terminal_state = expected.clean_runtime_identity_established ? 'BLOCKED' : 'COMPLETED';
  terminalDrift.observation_sha256 = '0'.repeat(64);
  assertHasObservationError(
    terminalDrift,
    expected.clean_runtime_identity_established
      ? 'terminal_state:must-be-COMPLETED-when-clean-runtime-established'
      : 'terminal_state:must-be-BLOCKED-when-clean-runtime-not-established',
  );

  const secretCapture = structuredClone(expected);
  secretCapture.live_runtime_observation.secrets_recorded = true;
  secretCapture.observation_sha256 = '0'.repeat(64);
  assertHasObservationError(secretCapture, 'live_runtime_observation:forbidden-secret-or-live-field-recorded');

  const staleCounts = structuredClone(expected);
  staleCounts.counts.blockers += 1;
  staleCounts.observation_sha256 = '0'.repeat(64);
  assertHasObservationError(staleCounts, 'counts.blockers:invalid');

  const contextPromoted = structuredClone(expected);
  contextPromoted.context_references.r4_iteration_status_rollup.expected_clean_runtime_leaf_terminal_state =
    expected.terminal_state === 'COMPLETED' ? 'BLOCKED' : 'COMPLETED';
  contextPromoted.observation_sha256 = '0'.repeat(64);
  assertHasObservationError(
    contextPromoted,
    'context_references.r4_iteration_status_rollup.expected_clean_runtime_leaf_terminal_state:must-match-terminal-state',
  );
});

test('checker command validates R4 clean runtime limited observation and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-r4-clean-runtime-limited-observation-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    observation_sha256: expected.observation_sha256,
    terminal_state: expected.terminal_state,
    clean_runtime_identity_established: expected.clean_runtime_identity_established,
    expected_candidate_source_commit: 'a034e5e050c044460fb07705639d9d41e6b193c0',
    expected_vsix_sha256: expected.expected_candidate_identity.vsix_sha256,
    tracked_matches_expected_identity: expected.tracked_registry_comparison.tracked_matches_expected_identity,
    stable_runtime_count: expected.live_runtime_observation.stable_runtime_count,
    blockers: expected.counts.blockers,
    live_runs_authorized: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasObservationError(value, expectedError) {
  const result = validateR4CleanRuntimeLimitedObservation(value, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-r4-clean-runtime-limited-observation.schema.json'));
}
