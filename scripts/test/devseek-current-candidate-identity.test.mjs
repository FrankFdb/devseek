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
  buildCurrentCandidateIdentity,
  classifyBridgeRuntimeProcesses,
  renderCurrentCandidateIdentityMarkdown,
  validateCurrentCandidateIdentity,
  validateLiveRuntimeProcesses,
} from '../lib/devseek-current-candidate-identity.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const buildOptions = { repoRoot };
const expected = buildCurrentCandidateIdentity(buildOptions);

test('current candidate identity binds source, VSIX, stable install, and runtime without qualification effect', () => {
  const actual = readJson('docs/process/devseek-current-candidate-identity.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    vsix_artifacts: 2,
    stable_installed_packages: 1,
    active_runtime_identities: 1,
    qualification_claims: 0,
  });
  assert.equal(actual.artifact_identity.exact_match, true);
  assert.equal(actual.stable_install_identity.exact_match_artifact, true);
  assert.equal(actual.active_runtime_identity.exact_match_stable_install, true);
  assert.equal(actual.release_state.version, 'devseek.release-state/v1');
  assert.equal(actual.release_state.deploy.status, 'installed-local');
  assert.equal(actual.release_state.deploy.production_deploy_authorized, false);
  assert.equal(actual.release_state.smoke.status, 'passed');
  assert.equal(actual.release_state.observe.status, 'passed');
  assert.equal(actual.release_state.rollback.status, 'available');
  assert.notEqual(
    actual.release_state.rollback.target_artifact.sha256,
    actual.release_state.current_artifact.sha256,
  );
  assert.equal(actual.release_state.mixed_kernel.detected, false);
  assert.equal(actual.observation_authority.caller_identity_trusted, false);
  assert.equal(actual.observation_authority.caller_identity_effect, 'IGNORED');
  assert.equal(actual.no_secret_observation.environment_variables, false);
  assert.equal(actual.no_secret_observation.tokens, false);
  assert.equal(actual.no_secret_observation.full_commandline, false);
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateCurrentCandidateIdentity(actual, buildOptions);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('R2-09E release state machine rejects missing rollback and mixed kernel delivery', () => {
  const missingRollback = structuredClone(expected);
  missingRollback.release_state.rollback = {
    status: 'not-available',
    target_artifact: null,
    evidenceRefs: [],
    reason: 'no previous artifact',
  };
  assertHasIdentityError(missingRollback, 'release_state.rollback.status:must-be-available');

  const mixedKernel = structuredClone(expected);
  mixedKernel.release_state.mixed_kernel.detected = true;
  assertHasIdentityError(mixedKernel, 'release_state.mixed_kernel.detected:must-be-false');
});

test('generated current candidate identity view is source-bound', () => {
  const actualRegistry = readJson('docs/process/devseek-current-candidate-identity.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-current-candidate-identity.md'),
    'utf8',
  );

  assert.equal(actualView, renderCurrentCandidateIdentityMarkdown(actualRegistry));
});

test('schema rejects claim promotion and caller supplied identity', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const forged = structuredClone(expected);
  forged.caller_supplied_identity = {
    active_runtime_identity: 'pretend-current',
  };
  assert.equal(validate(forged), false);
  assert.ok(validate.errors.some(error => error.instancePath === ''));
});

test('runtime rejects caller-trusted identity and source binding drift', () => {
  const forged = structuredClone(expected);
  forged.observation_authority.caller_identity_trusted = true;
  assertHasIdentityError(forged, 'observation_authority.caller_identity_trusted:must-be-false');

  const drifted = structuredClone(expected);
  drifted.source_identity.candidate_source_commit = '0'.repeat(40);
  assertHasIdentityError(drifted, 'identity:expected-current-source-artifact-install-runtime-binding');
});

test('runtime fails closed when packaged git commit is missing', () => {
  const mutated = structuredClone(expected);
  delete mutated.artifact_identity.primary_vsix.package_identity.devseekBuild.gitCommit;

  assertHasIdentityError(
    mutated,
    'artifact_identity.primary_vsix.package_identity.devseekBuild.gitCommit:required',
  );
});

test('runtime fails closed when package, install, or active runtime identity drifts', () => {
  const installDrift = structuredClone(expected);
  installDrift.stable_install_identity.package_identity.devseekBuild.buildId = 'forged-build';
  assertHasIdentityError(installDrift, 'identity:expected-current-source-artifact-install-runtime-binding');

  const runtimeDrift = structuredClone(expected);
  runtimeDrift.active_runtime_identity.expected_bridge_server_sha256 = '0'.repeat(64);
  assertHasIdentityError(
    runtimeDrift,
    'active_runtime_identity.expected_bridge_server_sha256:must-match-stable-install',
  );
});

test('live runtime classifier separates stable, isolated, stale debug, unknown, and unreadable processes', () => {
  const stable = expected.active_runtime_identity.expected_bridge_server_path;
  const extensionDir = path.basename(expected.stable_install_identity.package_root);
  const classified = classifyBridgeRuntimeProcesses([
    { pid: 1, executable_path: '/usr/bin/node', script_path: stable },
    {
      pid: 2,
      executable_path: '/usr/bin/node',
      script_path: `/tmp/devseek-controlled-vsix-abc/extensions/${extensionDir}/bridge/server.js`,
    },
    {
      pid: 3,
      executable_path: '/usr/bin/node',
      script_path: '/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260711/bridge/server.js',
    },
    {
      pid: 4,
      executable_path: '/usr/bin/node',
      script_path: '/opt/devseek-netai.devseek-netai-1.0.0/bridge/server.js',
    },
    { pid: 5, executable_path: '/usr/bin/node', script_path: null },
  ], { stableBridgeServerPath: stable, controlledExtensionDirName: extensionDir });

  assert.equal(classified.stable_runtime.length, 1);
  assert.equal(classified.isolated_controlled_vsix_runtime.length, 1);
  assert.equal(classified.stale_debug_runtime.length, 1);
  assert.equal(classified.unknown_devseek_bridge_runtime.length, 1);
  assert.equal(classified.unreadable_runtime_identity.length, 1);
});

test('live runtime validation allows isolated harness but rejects stale debug and unreadable identities', () => {
  const stable = expected.active_runtime_identity.expected_bridge_server_path;
  const extensionDir = path.basename(expected.stable_install_identity.package_root);
  const isolated = `/tmp/devseek-controlled-vsix-abc/extensions/${extensionDir}/bridge/server.js`;

  const allowed = validateLiveRuntimeProcesses(expected, [
    { pid: 1, executable_path: '/usr/bin/node', script_path: stable },
    { pid: 2, executable_path: '/usr/bin/node', script_path: isolated },
  ]);
  assert.equal(allowed.ok, true, JSON.stringify(allowed.errors, null, 2));

  const staleDebug = validateLiveRuntimeProcesses(expected, [
    {
      pid: 3,
      executable_path: '/usr/bin/node',
      script_path: '/home/ff/.vscode/extensions/devseek-netai.devseek-netai-1.0.0-debug.20260711/bridge/server.js',
    },
  ]);
  assert.equal(staleDebug.ok, false);
  assert.ok(staleDebug.errors.some(error => error.includes('stable-runtime-cardinality-expected-1-got-0')));
  assert.ok(staleDebug.errors.some(error => error.includes('stale-debug-runtime-active-1')));

  const unreadable = validateLiveRuntimeProcesses(expected, [
    { pid: 4, executable_path: '/usr/bin/node', script_path: null },
  ]);
  assert.equal(unreadable.ok, false);
  assert.ok(unreadable.errors.some(error => error.includes('unreadable-runtime-identity-1')));

  const missingExecutable = validateLiveRuntimeProcesses(expected, [
    { pid: 5, executable_path: null, script_path: stable },
  ]);
  assert.equal(missingExecutable.ok, false);
  assert.ok(missingExecutable.errors.some(error => error.includes('unreadable-runtime-identity-1')));
});

test('live runtime validation rejects controlled VSIX paths that do not match the DevSeek extension layout', () => {
  const stable = expected.active_runtime_identity.expected_bridge_server_path;
  const spoofedControlledPath = '/tmp/devseek-controlled-vsix-abc/extensions/other.publisher-1.0.0/bridge/server.js';

  const result = validateLiveRuntimeProcesses(expected, [
    { pid: 1, executable_path: '/usr/bin/node', script_path: stable },
    { pid: 2, executable_path: '/usr/bin/node', script_path: spoofedControlledPath },
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('unknown-devseek-bridge-runtime-1')));
});

test('checker command validates current candidate identity and live runtime process policy', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-current-candidate-identity-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.summary.qualification_effect, 'NONE');
  assert.equal(result.summary.claims_permitted, false);
  assert.equal(result.summary.asserts_gate_pass, false);
  assert.equal(result.live_runtime_summary.stable_runtime_count, 1);
  assert.equal(result.live_runtime_summary.stale_debug_runtime_count, 0);
  assert.equal(result.live_runtime_summary.unknown_devseek_bridge_runtime_count, 0);
  assert.equal(result.live_runtime_summary.unreadable_runtime_identity_count, 0);
});

function assertHasIdentityError(value, expectedError) {
  const result = validateCurrentCandidateIdentity(value, buildOptions);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-current-candidate-identity.schema.json'));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}
