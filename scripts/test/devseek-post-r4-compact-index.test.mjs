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
  POST_R4_REQUIRED_SOURCE_PATHS,
  buildPostR4CompactIndex,
  loadPostR4CompactIndexSources,
  renderPostR4CompactIndexMarkdown,
  validatePostR4CompactIndex,
} from '../lib/devseek-post-r4-compact-index.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadPostR4CompactIndexSources(repoRoot);
const expected = buildPostR4CompactIndex({ repoRoot, sources });

test('Post-R4 compact index is source-bound and non-qualifying', () => {
  const actual = readJson('docs/process/devseek-post-r4-compact-index.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);
  assert.equal(
    actual.r4_current_state.clean_runtime_leaf_terminal_state,
    expected.r4_current_state.clean_runtime_leaf_terminal_state,
  );
  assert.equal(
    actual.r4_current_state.clean_runtime_limited_observation_terminal_state,
    expected.r4_current_state.clean_runtime_limited_observation_terminal_state,
  );
  assert.equal(actual.r4_current_state.stable_runtime_count, expected.r4_current_state.stable_runtime_count);
  assert.equal(actual.r4_current_state.gate0_status, 'NOT_PASSED');
  assert.equal(actual.r4_current_state.r1_qualification_status, 'NOT_STARTED');
  assert.equal(actual.counts.live_runs_authorized, 0);
  assert.equal(actual.counts.qualification_claims, 0);

  const sourcePaths = Object.values(actual.source_bindings).map(binding => binding.path);
  for (const sourcePath of POST_R4_REQUIRED_SOURCE_PATHS) {
    assert.ok(sourcePaths.includes(sourcePath), `missing ${sourcePath}`);
  }

  const validation = validatePostR4CompactIndex(actual, { repoRoot, sources });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('Post-R4 compact index captures suspended authorization branches without local unblock', () => {
  const actual = readJson('docs/process/devseek-post-r4-compact-index.json');

  assert.equal(
    actual.suspended_authorization_branches.clean_runtime.terminal_state,
    expected.suspended_authorization_branches.clean_runtime.terminal_state,
  );
  assert.equal(
    actual.suspended_authorization_branches.clean_runtime.local_repository_may_unblock_without_new_authority,
    false,
  );
  assert.equal(
    actual.suspended_authorization_branches.r4_live_authorization_requests.every(
      request => request.terminal_state === 'BLOCKED' && request.repository_may_decide === false,
    ),
    true,
  );
  assert.equal(
    actual.suspended_authorization_branches.gate0_external_authority_requests.every(
      request => request.terminal_state === 'BLOCKED' && request.repository_may_decide === false,
    ),
    true,
  );
  assert.deepEqual(actual.permission_recovery_boundary.currently_not_authorized, [
    'existing-window-action',
    'vsix-install-package-action',
    'live-provider-action',
    'external-authority-import',
  ]);
  assert.equal(actual.permission_recovery_boundary.repository_may_change_gate0_or_r1, false);
});

test('Post-R4 compact index generated view is Chinese-readable and schema-valid', () => {
  const actual = readJson('docs/process/devseek-post-r4-compact-index.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-post-r4-compact-index.md'),
    'utf8',
  );

  assert.equal(actualView, renderPostR4CompactIndexMarkdown(actual));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 当前权限/u);
  assert.match(actualView, /## 挂起授权支线/u);
  assert.match(actualView, /## 非权限队列/u);

  const validate = compileSchema();
  assert.equal(validate(actual), true, JSON.stringify(validate.errors, null, 2));
});

test('Post-R4 compact index schema rejects qualification promotion and unblocked live requests', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const gatePass = structuredClone(expected);
  gatePass.asserts_gate_pass = true;
  assert.equal(validate(gatePass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/asserts_gate_pass'));

  const approvedLive = structuredClone(expected);
  approvedLive.suspended_authorization_branches.r4_live_authorization_requests[0].terminal_state = 'APPROVED';
  assert.equal(validate(approvedLive), false);
  assert.ok(
    validate.errors.some(error => (
      error.instancePath === '/suspended_authorization_branches/r4_live_authorization_requests/0/terminal_state'
    )),
  );
});

test('Post-R4 compact index runtime validation fails closed on source, script, or blocker drift', () => {
  const sourceBindingDrift = structuredClone(expected);
  sourceBindingDrift.source_bindings.r4_iteration_status_rollup.path = 'docs/process/other.json';
  sourceBindingDrift.index_sha256 = '0'.repeat(64);
  assertHasIndexError(sourceBindingDrift, 'source_bindings:missing-docs/process/devseek-r4-iteration-status-rollup.json');

  const cleanRuntimeDrift = structuredClone(expected);
  cleanRuntimeDrift.r4_current_state.clean_runtime_leaf_terminal_state =
    expected.r4_current_state.clean_runtime_leaf_terminal_state === 'COMPLETED' ? 'BLOCKED' : 'COMPLETED';
  cleanRuntimeDrift.index_sha256 = '0'.repeat(64);
  assertHasIndexError(
    cleanRuntimeDrift,
    'r4_current_state.clean_runtime_leaf_terminal_state:must-match-clean-runtime-branch',
  );

  const noScriptSources = loadPostR4CompactIndexSources(repoRoot, {
    packageJson: {
      ...sources.packageJson,
      scripts: {
        ...sources.packageJson.scripts,
        'verify:post-r4-compact-index': undefined,
      },
    },
  });
  delete noScriptSources.packageJson.scripts['verify:post-r4-compact-index'];
  const noScript = buildPostR4CompactIndex({ repoRoot, sources: noScriptSources });
  assertHasIndexErrorWithSources(
    noScript,
    noScriptSources,
    'source_bindings.package_scripts.required_script_present:must-be-true',
  );
});

test('Post-R4 compact index checker command validates the generated index', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-post-r4-compact-index-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    index_sha256: expected.index_sha256,
    historical_support_documents: 3,
    nonpermission_queue_items: 10,
    r4_total_leaves: 6,
    r4_completed_leaves: expected.counts.r4_completed_leaves,
    r4_blocked_leaves: expected.counts.r4_blocked_leaves,
    clean_runtime_state: expected.r4_current_state.clean_runtime_leaf_terminal_state,
    live_authorization_blocked: 5,
    external_authority_blocked: 5,
    live_runs_authorized: 0,
    qualification_claims: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasIndexError(value, expectedError) {
  assertHasIndexErrorWithSources(value, sources, expectedError);
}

function assertHasIndexErrorWithSources(value, activeSources, expectedError) {
  const result = validatePostR4CompactIndex(value, { repoRoot, sources: activeSources });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-post-r4-compact-index.schema.json'));
}
