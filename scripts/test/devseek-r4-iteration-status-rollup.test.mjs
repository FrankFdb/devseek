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
    completed_leaves: 5,
    blocked_leaves: 1,
    remaining_window_sensitive_leaves: 1,
    live_runs_authorized: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.r4_scope.local_process_artifacts_complete_except_clean_runtime, true);
  assert.equal(actual.r4_scope.clean_runtime_leaf_terminal_state, 'BLOCKED');
  assert.equal(actual.r4_scope.current_candidate_identity_status, 'deferred-unusable-until-clean-runtime');
  assert.equal(actual.r4_scope.gate0_status, 'NOT_PASSED');
  assert.equal(actual.r4_scope.r1_qualification_status, 'NOT_STARTED');
  assert.equal(actual.r4_scope.scenario_language_source, 'scenario-contract');
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const cleanRuntime = actual.leaves.find(leaf => leaf.leaf_id === 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME');
  assert.equal(cleanRuntime.terminal_state, 'BLOCKED');
  assert.equal(cleanRuntime.implementation_commit, null);
  assert.equal(actual.leaves.filter(leaf => leaf.terminal_state === 'COMPLETED').length, 5);

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
});

test('runtime validation fails closed on clean-runtime completion, window action expansion, or stale counts', () => {
  const cleanRuntimeCompleted = structuredClone(expected);
  cleanRuntimeCompleted.leaves[0].terminal_state = 'COMPLETED';
  cleanRuntimeCompleted.rollup_sha256 = '0'.repeat(64);
  assertHasRollupError(
    cleanRuntimeCompleted,
    'leaves.R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME.terminal_state:must-be-BLOCKED',
  );

  const windowExpansion = structuredClone(expected);
  windowExpansion.clean_runtime_boundary.may_close_existing_vscode_or_deepseek_pages = true;
  windowExpansion.rollup_sha256 = '0'.repeat(64);
  assertHasRollupError(
    windowExpansion,
    'clean_runtime_boundary.may_close_existing_vscode_or_deepseek_pages:must-be-false',
  );

  const staleCounts = structuredClone(expected);
  staleCounts.counts.completed_leaves = 6;
  staleCounts.rollup_sha256 = '0'.repeat(64);
  assertHasRollupError(staleCounts, 'counts.completed_leaves:must-be-5');
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
    completed_leaves: 5,
    blocked_leaves: 1,
    clean_runtime_leaf_terminal_state: 'BLOCKED',
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
