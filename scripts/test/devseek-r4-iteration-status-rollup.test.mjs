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
  buildR4IterationStatusRollup,
  renderR4IterationStatusRollupMarkdown,
  validateR4IterationStatusRollup,
} from '../lib/devseek-r4-iteration-status-rollup.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4IterationStatusRollup({ repoRoot });

test('R4 iteration status rollup counts six original leaves without adding a new leaf', () => {
  const actual = readJson('docs/process/devseek-r4-iteration-status-rollup.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.does_not_add_r4_leaf, true);
  assert.deepEqual(actual.counts, {
    r4_total_leaves: 6,
    completed_leaves: expected.counts.completed_leaves,
    blocked_leaves: expected.counts.blocked_leaves,
    remaining_window_sensitive_leaves: expected.counts.remaining_window_sensitive_leaves,
    live_runs_authorized: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.r4_scope.local_process_artifacts_complete_except_clean_runtime, true);
  assert.equal(actual.r4_scope.clean_runtime_leaf_terminal_state, expected.r4_scope.clean_runtime_leaf_terminal_state);
  assert.equal(
    actual.r4_scope.clean_runtime_limited_observation_terminal_state,
    expected.r4_scope.clean_runtime_limited_observation_terminal_state,
  );
  assert.match(actual.r4_scope.clean_runtime_limited_observation_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(actual.r4_scope.clean_runtime_stable_runtime_count, expected.r4_scope.clean_runtime_stable_runtime_count);
  assert.equal(actual.r4_scope.current_candidate_identity_status, expected.r4_scope.current_candidate_identity_status);
  assert.equal(actual.r4_scope.gate0_status, 'NOT_PASSED');
  assert.equal(actual.r4_scope.r1_qualification_status, 'NOT_STARTED');
  assert.equal(actual.r4_scope.scenario_language_source, 'scenario-contract');
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);
  assert.equal(actual.source_bindings.authorization_guide.path, 'docs/process/devseek-r4-authorization-and-permission-guide.md');
  assert.equal(
    actual.source_bindings.clean_runtime_limited_observation.path,
    'docs/process/devseek-r4-clean-runtime-limited-observation.json',
  );
  assert.equal(
    actual.source_bindings.clean_runtime_limited_observation.terminal_state,
    expected.source_bindings.clean_runtime_limited_observation.terminal_state,
  );
  assert.equal(
    actual.source_bindings.clean_runtime_limited_observation.clean_runtime_identity_established,
    expected.source_bindings.clean_runtime_limited_observation.clean_runtime_identity_established,
  );
  assert.equal(
    actual.source_bindings.clean_runtime_limited_observation.stable_runtime_count,
    expected.source_bindings.clean_runtime_limited_observation.stable_runtime_count,
  );
  assert.equal(
    actual.clean_runtime_boundary.latest_limited_observation_path,
    'docs/process/devseek-r4-clean-runtime-limited-observation.json',
  );
  assert.equal(
    actual.clean_runtime_boundary.latest_limited_observation_terminal_state,
    expected.clean_runtime_boundary.latest_limited_observation_terminal_state,
  );
  assert.equal(
    actual.clean_runtime_boundary.latest_limited_observation_clean_runtime_identity_established,
    expected.clean_runtime_boundary.latest_limited_observation_clean_runtime_identity_established,
  );

  const cleanRuntime = actual.leaves.find(leaf => leaf.leaf_id === 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME');
  const expectedCleanRuntime = expected.leaves.find(leaf => leaf.leaf_id === 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME');
  assert.equal(cleanRuntime.terminal_state, expectedCleanRuntime.terminal_state);
  assert.equal(cleanRuntime.implementation_commit, expectedCleanRuntime.implementation_commit);
  assert.equal(
    actual.leaves.filter(leaf => leaf.terminal_state === 'COMPLETED').length,
    expected.counts.completed_leaves,
  );

  const validation = validateR4IterationStatusRollup(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated R4 iteration status view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-iteration-status-rollup.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-iteration-status-rollup.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4IterationStatusRollupMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## R4 叶子状态/u);
  assert.match(actualView, /## Clean Runtime 边界/u);
  assert.match(actualView, /## 资格边界/u);
  assert.match(actualView, /## 追加来源绑定/u);
});

test('schema rejects claim promotion, live authorization, and leaf-count drift', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const liveAuthorized = structuredClone(expected);
  liveAuthorized.counts.live_runs_authorized = 1;
  assert.equal(validate(liveAuthorized), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/counts/live_runs_authorized'));

  const leafCountDrift = structuredClone(expected);
  leafCountDrift.counts.r4_total_leaves = 7;
  assert.equal(validate(leafCountDrift), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/counts/r4_total_leaves'));

  const invalidTerminal = structuredClone(expected);
  invalidTerminal.clean_runtime_boundary.latest_limited_observation_terminal_state = 'DONE';
  assert.equal(validate(invalidTerminal), false);
  assert.ok(validate.errors.some(error => (
    error.instancePath === '/clean_runtime_boundary/latest_limited_observation_terminal_state'
  )));
});

test('runtime validation fails closed on clean-runtime drift, window action expansion, or stale counts', () => {
  const cleanRuntimeDrift = structuredClone(expected);
  cleanRuntimeDrift.leaves[0].terminal_state =
    expected.leaves[0].terminal_state === 'COMPLETED' ? 'BLOCKED' : 'COMPLETED';
  cleanRuntimeDrift.rollup_sha256 = '0'.repeat(64);
  assertHasRollupError(
    cleanRuntimeDrift,
    'leaves.R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME.terminal_state:must-match-clean-runtime-observation',
  );

  const windowExpansion = structuredClone(expected);
  windowExpansion.clean_runtime_boundary.may_close_existing_vscode_or_deepseek_pages = true;
  windowExpansion.rollup_sha256 = '0'.repeat(64);
  assertHasRollupError(
    windowExpansion,
    'clean_runtime_boundary.may_close_existing_vscode_or_deepseek_pages:must-be-false',
  );

  const staleCounts = structuredClone(expected);
  staleCounts.counts.completed_leaves =
    expected.counts.completed_leaves === 6 ? 5 : expected.counts.completed_leaves + 1;
  staleCounts.rollup_sha256 = '0'.repeat(64);
  assertHasRollupError(staleCounts, 'counts.completed_leaves:invalid');

  const cleanRuntimeObservationCompleted = structuredClone(expected);
  cleanRuntimeObservationCompleted.r4_scope.clean_runtime_limited_observation_terminal_state =
    expected.r4_scope.clean_runtime_limited_observation_terminal_state === 'COMPLETED' ? 'BLOCKED' : 'COMPLETED';
  cleanRuntimeObservationCompleted.rollup_sha256 = '0'.repeat(64);
  assertHasRollupError(
    cleanRuntimeObservationCompleted,
    'r4_scope.clean_runtime_limited_observation_terminal_state:must-match-boundary',
  );

  const blockedStateDrift = structuredClone(expected);
  blockedStateDrift.clean_runtime_boundary.blocked_until_authority = !expected.clean_runtime_boundary.blocked_until_authority;
  blockedStateDrift.rollup_sha256 = '0'.repeat(64);
  assertHasRollupError(
    blockedStateDrift,
    'clean_runtime_boundary.blocked_until_authority:must-match-identity-state',
  );
});

test('checker command validates R4 iteration status rollup and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-r4-iteration-status-rollup-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    rollup_sha256: expected.rollup_sha256,
    total_leaves: 6,
    completed_leaves: expected.counts.completed_leaves,
    blocked_leaves: expected.counts.blocked_leaves,
    clean_runtime_leaf_terminal_state: expected.r4_scope.clean_runtime_leaf_terminal_state,
    clean_runtime_limited_observation_terminal_state: expected.r4_scope.clean_runtime_limited_observation_terminal_state,
    clean_runtime_identity_established: expected.clean_runtime_boundary.latest_limited_observation_clean_runtime_identity_established,
    clean_runtime_stable_runtime_count: expected.r4_scope.clean_runtime_stable_runtime_count,
    live_runs_authorized: 0,
    gate0_status: 'NOT_PASSED',
    r1_qualification_status: 'NOT_STARTED',
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasRollupError(value, expectedError) {
  const result = validateR4IterationStatusRollup(value, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-r4-iteration-status-rollup.schema.json'));
}
