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
  POST_R4_LOCAL_REGRESSION_REQUIRED_SOURCE_PATHS,
  buildPostR4LocalRegressionManifest,
  loadPostR4LocalRegressionManifestSources,
  renderPostR4LocalRegressionManifestMarkdown,
  validatePostR4LocalRegressionManifest,
} from '../lib/devseek-post-r4-local-regression-manifest.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadPostR4LocalRegressionManifestSources(repoRoot);
const expected = buildPostR4LocalRegressionManifest({ repoRoot, sources });

test('Post-R4 local regression manifest binds NP-05 through NP-07 without qualification effect', () => {
  const actual = readJson('docs/process/devseek-post-r4-local-regression-manifest.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);
  assert.deepEqual(actual.regression_scope.covered_nonpermission_items, ['NP-05', 'NP-06', 'NP-07']);
  assert.equal(actual.regression_scope.provider_or_window_actions_performed, false);
  assert.equal(actual.regression_scope.live_rerun_performed, false);
  assert.equal(actual.regression_scope.qualification_ledger_writes, false);
  assert.equal(actual.regression_scope.gate0_status, 'NOT_PASSED');
  assert.equal(actual.regression_scope.r1_qualification_status, 'NOT_STARTED');
  assert.equal(actual.counts.regression_tracks, actual.regression_tracks.length);
  assert.equal(actual.counts.covered_nonpermission_items, actual.regression_scope.covered_nonpermission_items.length);
  assert.equal(actual.counts.covered_sources, sumTrackCounts(actual, 'covered_sources'));
  assert.equal(actual.counts.anchor_checks, sumTrackCounts(actual, 'anchor_checks'));
  assert.equal(actual.counts.anchors_present, actual.counts.anchor_checks);
  assert.equal(actual.counts.verification_commands, sumTrackCounts(actual, 'verification_commands'));
  assert.equal(actual.counts.local_only_commands, actual.counts.verification_commands);
  for (const field of ['live_provider_runs', 'install_or_window_actions', 'qualification_claims', 'gate_pass_assertions', 'bypasses']) {
    assert.equal(actual.counts[field], 0);
  }

  const sourcePaths = Object.values(actual.source_bindings).map(binding => binding.path);
  for (const sourcePath of POST_R4_LOCAL_REGRESSION_REQUIRED_SOURCE_PATHS) {
    assert.ok(sourcePaths.includes(sourcePath), `missing ${sourcePath}`);
  }

  const validation = validatePostR4LocalRegressionManifest(actual, { repoRoot, sources });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('Post-R4 local regression manifest covers provider protocol and evidence settlement anchors', () => {
  const actual = readJson('docs/process/devseek-post-r4-local-regression-manifest.json');
  const byId = new Map(actual.regression_tracks.map(track => [track.item_id, track]));

  assert.deepEqual([...byId.keys()], ['NP-05', 'NP-06', 'NP-07']);
  assert.equal(
    byId.get('NP-05').anchor_checks.some(check => check.category === 'prose-not-tool-authority'),
    true,
  );
  assert.equal(
    byId.get('NP-05').anchor_checks.some(check => check.category === 'structural-transport-integrity'),
    true,
  );
  assert.equal(
    byId.get('NP-06').anchor_checks.some(check => check.category === 'late-provider-failure-after-local-success'),
    true,
  );
  assert.equal(
    byId.get('NP-06').anchor_checks.some(check => check.category === 'quality-gate-required-for-mutation'),
    true,
  );
  assert.equal(
    byId.get('NP-07').anchor_checks.some(check => check.category === 'source-claim-contract'),
    true,
  );
  assert.equal(
    byId.get('NP-07').anchor_checks.some(check => check.category === 'legacy-domain-oracle-retired'),
    true,
  );
  assert.equal(actual.regression_tracks.every(track => track.plan_heading_present === true), true);
  assert.equal(
    actual.regression_tracks.every(track => track.anchor_checks.every(check => check.present === true)),
    true,
  );
  assert.equal(
    actual.regression_tracks.every(track => track.verification_commands.every(command => (
      command.command_is_local_only === true
        && command.live_provider_actions === 'FORBIDDEN'
        && command.install_or_window_actions === 'FORBIDDEN'
        && command.qualification_effect === 'NONE'
    ))),
    true,
  );
});

test('Post-R4 local regression manifest generated view is source-bound and Chinese-readable', () => {
  const actual = readJson('docs/process/devseek-post-r4-local-regression-manifest.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-post-r4-local-regression-manifest.md'),
    'utf8',
  );

  assert.equal(actualView, renderPostR4LocalRegressionManifestMarkdown(actual));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 资格边界/u);
  assert.match(actualView, /## Track 覆盖/u);
  assert.match(actualView, /## Anchor Checks/u);

  const validate = compileSchema();
  assert.equal(validate(actual), true, JSON.stringify(validate.errors, null, 2));
});

test('Post-R4 local regression manifest schema rejects claim promotion, live actions, and missing anchors', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const liveRun = structuredClone(expected);
  liveRun.counts.live_provider_runs = 1;
  assert.equal(validate(liveRun), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/counts/live_provider_runs'));

  const missingAnchor = structuredClone(expected);
  missingAnchor.regression_tracks[0].anchor_checks[0].present = false;
  assert.equal(validate(missingAnchor), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/regression_tracks/0/anchor_checks/0/present'));
});

test('Post-R4 local regression manifest runtime validation fails closed on source, script, or command drift', () => {
  const anchorDrift = structuredClone(expected);
  anchorDrift.regression_tracks[0].anchor_checks[0].present = false;
  anchorDrift.manifest_sha256 = '0'.repeat(64);
  assertHasManifestError(anchorDrift, 'regression_tracks[0].anchor_checks[0].present:must-be-true');

  const unsafeCommand = structuredClone(expected);
  unsafeCommand.regression_tracks[0].verification_commands[0].command =
    'npm run verify:agent-loop-eval:real';
  unsafeCommand.regression_tracks[0].verification_commands[0].command_is_local_only = false;
  unsafeCommand.manifest_sha256 = '0'.repeat(64);
  assertHasManifestError(unsafeCommand, 'regression_tracks[0].verification_commands[0].command:must-be-local-only');

  const noScriptSources = loadPostR4LocalRegressionManifestSources(repoRoot, {
    packageJson: {
      ...sources.packageJson,
      scripts: {
        ...sources.packageJson.scripts,
        'verify:post-r4-local-regression-manifest': undefined,
      },
    },
  });
  delete noScriptSources.packageJson.scripts['verify:post-r4-local-regression-manifest'];
  const noScript = buildPostR4LocalRegressionManifest({ repoRoot, sources: noScriptSources });
  assertHasManifestErrorWithSources(
    noScript,
    noScriptSources,
    'source_bindings.package_scripts.required_script_present:must-be-true',
  );
});

test('Post-R4 local regression manifest checker command validates the generated manifest', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-post-r4-local-regression-manifest-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    manifest_sha256: expected.manifest_sha256,
    regression_tracks: 3,
    covered_nonpermission_items: ['NP-05', 'NP-06', 'NP-07'],
    covered_sources: expected.counts.covered_sources,
    anchor_checks: expected.counts.anchor_checks,
    anchors_present: expected.counts.anchors_present,
    verification_commands: expected.counts.verification_commands,
    local_only_commands: expected.counts.local_only_commands,
    live_provider_runs: 0,
    install_or_window_actions: 0,
    qualification_claims: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasManifestError(value, expectedError) {
  assertHasManifestErrorWithSources(value, sources, expectedError);
}

function sumTrackCounts(manifest, field) {
  return manifest.regression_tracks.reduce((total, track) => total + track.counts[field], 0);
}

function assertHasManifestErrorWithSources(value, activeSources, expectedError) {
  const result = validatePostR4LocalRegressionManifest(value, { repoRoot, sources: activeSources });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-post-r4-local-regression-manifest.schema.json'));
}
