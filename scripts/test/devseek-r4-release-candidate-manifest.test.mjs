import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
  buildR4ReleaseCandidateManifest,
  renderR4ReleaseCandidateManifestMarkdown,
  validateArchivedR4ReleaseCandidate,
  validateR4ReleaseCandidateManifest,
} from '../lib/devseek-r4-release-candidate-manifest.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4ReleaseCandidateManifest({ repoRoot });

test('R4 v2 manifest freezes 4f8a567 and binds current identity without qualification effect', () => {
  const actual = readJson('docs/process/devseek-r4-release-candidate-manifest.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    vsix_artifacts: 2,
    historical_candidates: 1,
    verification_receipts: 6,
    remaining_r4_leaves_at_freeze: 1,
    qualification_claims: 0,
  });
  assert.equal(actual.manifest_version, 2);
  assert.equal(actual.source_identity.artifact_source_commit, '4f8a56797090079914b4d921b56d9c34fe4d2abc');
  assert.equal(actual.source_identity.artifact_source_matches_current_identity, true);
  assert.equal(actual.artifact_identity.primary_vsix.sha256, '68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc');
  assert.equal(actual.artifact_identity.primary_vsix.path, 'devseek-netai-1.0.0-debug.20260804.t093020.g4f8a567.vsix');
  assert.equal(actual.artifact_identity.package_copy_vsix.path, 'packages/vscode-extension/devseek-netai-1.0.0-debug.20260804.t093020.g4f8a567.vsix');
  assert.equal(actual.artifact_identity.exact_match, true);
  assert.equal(actual.current_identity_probe_boundary.status, 'verified-current-candidate');
  assert.equal(actual.current_identity_probe_boundary.stable_runtime_count, 1);
  assert.equal(actual.version_lineage.predecessor_candidate_source_commit, 'a034e5e050c044460fb07705639d9d41e6b193c0');
  assert.equal(actual.version_lineage.predecessor_status, 'immutable-history');
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateR4ReleaseCandidateManifest(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('archived a034e5e v1 candidate remains byte-for-byte immutable and self-consistent', () => {
  const validation = validateArchivedR4ReleaseCandidate({ repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
  assert.deepEqual(validation.summary, {
    manifest_id: 'R4-RELEASE-CANDIDATE-MANIFEST/v1',
    candidate_source_commit: 'a034e5e050c044460fb07705639d9d41e6b193c0',
    manifest_sha256: '67e4025b2743012648c36312870130a3773f0b79dc44ce9abbc4200c4dab50b3',
    manifest_file_sha256: 'eb93f971f1dcd877dbde75a032919c7d02389661aaaed6429b0bd34943091c66',
    archive_status: 'immutable-history',
  });

  const archiveRoot = path.join(repoRoot, 'docs/process/archive/r4-release-candidates/v1-a034e5e');
  assert.equal(fileSha256(path.join(archiveRoot, 'manifest.json')), 'eb93f971f1dcd877dbde75a032919c7d02389661aaaed6429b0bd34943091c66');
  assert.equal(fileSha256(path.join(archiveRoot, 'manifest.schema.json')), '6adf54c38b9fb0b8ae7c95a721dee9815f6a9a9b96edac2416d62b6b1256977f');
  assert.equal(fileSha256(path.join(archiveRoot, 'manifest.md')), 'b8c684c959545dd8bd6c0228e59df09f036416a2edc5b6b9db35f17d4fc2f3eb');
});

test('generated R4 manifest view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-release-candidate-manifest.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-release-candidate-manifest.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4ReleaseCandidateManifestMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 版本链/u);
  assert.match(actualView, /## 候选制品/u);
  assert.match(actualView, /## 记录型验证回执/u);
});

test('schema rejects qualification promotion and live/runtime authority expansion', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const gatePass = structuredClone(expected);
  gatePass.asserts_gate_pass = true;
  assert.equal(validate(gatePass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/asserts_gate_pass'));

  const runtimeObserved = structuredClone(expected);
  runtimeObserved.observation_authority.runtime_process_observation = 'ALLOWED';
  assert.equal(validate(runtimeObserved), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/observation_authority/runtime_process_observation'));
});

test('runtime validation fails closed on artifact, lineage, leaf, or receipt mutation', () => {
  const mismatch = structuredClone(expected);
  mismatch.artifact_identity.package_copy_vsix.sha256 = '0'.repeat(64);
  mismatch.artifact_identity.exact_match = false;
  mismatch.manifest_sha256 = '0'.repeat(64);
  assertHasManifestError(mismatch, 'artifact_identity:frozen-candidate-mismatch');

  const predecessorMutation = structuredClone(expected);
  predecessorMutation.version_lineage.predecessor_manifest_file_sha256 = '0'.repeat(64);
  predecessorMutation.manifest_sha256 = '0'.repeat(64);
  assertHasManifestError(predecessorMutation, 'version_lineage:invalid-or-predecessor-mutated');

  const wrongLeaf = structuredClone(expected);
  wrongLeaf.r4_leaf_context.current_leaf = 'R4-LIVE-QUALIFICATION-REQUEST-PACKET';
  wrongLeaf.manifest_sha256 = '0'.repeat(64);
  assertHasManifestError(wrongLeaf, 'r4_leaf_context.current_leaf:invalid');

  const promotedReceipt = structuredClone(expected);
  promotedReceipt.verification_receipts[0].qualification_effect = 'PROMOTE_GATE0';
  promotedReceipt.manifest_sha256 = '0'.repeat(64);
  assertHasManifestError(promotedReceipt, 'verification_receipts.extension-full-unit-runner.qualification_effect:must-be-NONE');
});

test('checker command validates R4 release candidate manifest and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-r4-release-candidate-manifest-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    manifest_sha256: expected.manifest_sha256,
    manifest_version: 2,
    artifact_source_commit: '4f8a56797090079914b4d921b56d9c34fe4d2abc',
    primary_vsix_sha256: '68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc',
    package_copy_exact_match: true,
    predecessor_candidate_source_commit: 'a034e5e050c044460fb07705639d9d41e6b193c0',
    predecessor_status: 'immutable-history',
    verification_receipts: 6,
    current_identity_status: 'verified-current-candidate',
    current_leaf: 'R4-RELEASE-CANDIDATE-MANIFEST',
    remaining_r4_leaves_at_freeze: 1,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertHasManifestError(value, expectedError) {
  const result = validateR4ReleaseCandidateManifest(value, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-r4-release-candidate-manifest.schema.json'));
}
