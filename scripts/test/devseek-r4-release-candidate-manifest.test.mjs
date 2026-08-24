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
import {
  R4_ACTIVE_CANDIDATE,
  R4_CANDIDATE_VERIFICATION_RECEIPTS,
  R4_REMAINING_LEAVES_AT_FREEZE,
} from '../lib/devseek-r4-release-candidate-freeze.mjs';
import {
  R4_RELEASE_CANDIDATE_HISTORY,
  R4_RELEASE_CANDIDATE_PREDECESSOR,
} from '../lib/devseek-r4-release-candidate-history.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4ReleaseCandidateManifest({ repoRoot });

test('R4 v4 manifest freezes 2db5768 as local protocol conformance without qualification effect', () => {
  const actual = readJson('docs/process/devseek-r4-release-candidate-manifest.json');
  const activeCurrentIdentity = readJson('docs/process/devseek-current-candidate-identity.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(
    activeCurrentIdentity.source_identity.candidate_source_commit,
    actual.source_identity.artifact_source_commit,
  );
  assert.deepEqual(actual.counts, {
    vsix_artifacts: 2,
    historical_candidates: R4_RELEASE_CANDIDATE_HISTORY.length,
    verification_receipts: R4_CANDIDATE_VERIFICATION_RECEIPTS.length,
    remaining_r4_leaves_at_freeze: R4_REMAINING_LEAVES_AT_FREEZE.length,
    qualification_claims: 0,
  });
  assert.equal(actual.manifest_version, R4_ACTIVE_CANDIDATE.manifest_version);
  assert.equal(actual.local_evidence_class, R4_ACTIVE_CANDIDATE.local_evidence_class);
  assert.equal(actual.selection_boundary.protected_release_candidate, false);
  assert.equal(actual.selection_boundary.artifact_channel, 'debug');
  assert.equal(actual.source_identity.artifact_source_commit, R4_ACTIVE_CANDIDATE.source_commit);
  assert.equal(actual.source_identity.artifact_source_matches_current_identity, true);
  assert.equal(actual.artifact_identity.primary_vsix.sha256, R4_ACTIVE_CANDIDATE.vsix_sha256);
  assert.equal(actual.artifact_identity.primary_vsix.path, R4_ACTIVE_CANDIDATE.vsix_name);
  assert.equal(actual.artifact_identity.package_copy_vsix.path, `packages/vscode-extension/${R4_ACTIVE_CANDIDATE.vsix_name}`);
  assert.equal(actual.artifact_identity.exact_match, true);
  assert.equal(actual.current_identity_probe_boundary.status, 'verified-current-candidate');
  assert.equal(actual.current_identity_probe_boundary.stable_runtime_count, 1);
  assert.equal(actual.version_lineage.predecessor_candidate_source_commit, R4_RELEASE_CANDIDATE_PREDECESSOR.candidate_source_commit);
  assert.equal(actual.version_lineage.predecessor_status, 'immutable-history');
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateR4ReleaseCandidateManifest(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('archived v1 through v3 candidates remain byte-for-byte immutable and lineage-consistent', () => {
  const validation = validateArchivedR4ReleaseCandidate({ repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
  assert.deepEqual(validation.summary, {
    historical_candidates: R4_RELEASE_CANDIDATE_HISTORY.length,
    predecessor_manifest_id: 'R4-RELEASE-CANDIDATE-MANIFEST/v3',
    predecessor_candidate_source_commit: 'a47ffe37f01817d14358b0ef4040e885b7867c8f',
    predecessor_manifest_sha256: '345f01d8bcb35c9bafac781cf2b035fa8d348b1bee9c370e095e10a689fd6976',
    archive_status: 'immutable-history',
    artifact_retention: 'manifest-identity-only',
  });

  const archiveBindings = [
    ['v1-a034e5e', 'eb93f971f1dcd877dbde75a032919c7d02389661aaaed6429b0bd34943091c66', '6adf54c38b9fb0b8ae7c95a721dee9815f6a9a9b96edac2416d62b6b1256977f', 'b8c684c959545dd8bd6c0228e59df09f036416a2edc5b6b9db35f17d4fc2f3eb'],
    ['v2-4f8a567', '8c051ecfbb718820332804f4cc690f26a54d2e243e26f91d030acbde5b94ea82', 'face1ace312bdf8478301c8357222a697f750a210a58ddab769a50e4e5206b7f', '56ac05c11e2f25c6e84066066eac06286cee13a154c9683b9a2eabfb49614e46'],
    ['v3-a47ffe3', 'e01dd51a1643e164309f5de95a5ec51c449950965445d6e468d05159743c0d8b', '107edec646955f1f05fd511c4cdc9ddc32ff98e91ceaa5febffe7b66092758f5', '3e2fc76344c2fa4302af62f04e865a4c856a19f3d300ac954f1ae304c5f88e6a'],
  ];
  for (const [directory, manifestSha256, schemaSha256, viewSha256] of archiveBindings) {
    const archiveRoot = path.join(repoRoot, 'docs/process/archive/r4-release-candidates', directory);
    assert.equal(fileSha256(path.join(archiveRoot, 'manifest.json')), manifestSha256);
    assert.equal(fileSha256(path.join(archiveRoot, 'manifest.schema.json')), schemaSha256);
    assert.equal(fileSha256(path.join(archiveRoot, 'manifest.md')), viewSha256);
  }
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
  assertHasManifestError(promotedReceipt, 'verification_receipts.shared-full-suite.qualification_effect:must-be-NONE');
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
    manifest_version: R4_ACTIVE_CANDIDATE.manifest_version,
    artifact_source_commit: R4_ACTIVE_CANDIDATE.source_commit,
    primary_vsix_sha256: R4_ACTIVE_CANDIDATE.vsix_sha256,
    package_copy_exact_match: true,
    predecessor_candidate_source_commit: R4_RELEASE_CANDIDATE_PREDECESSOR.candidate_source_commit,
    predecessor_status: 'immutable-history',
    verification_receipts: R4_CANDIDATE_VERIFICATION_RECEIPTS.length,
    current_identity_status: 'verified-current-candidate',
    current_leaf: 'R4-RELEASE-CANDIDATE-MANIFEST',
    remaining_r4_leaves_at_freeze: R4_REMAINING_LEAVES_AT_FREEZE.length,
    local_evidence_class: R4_ACTIVE_CANDIDATE.local_evidence_class,
    protected_release_candidate: false,
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
