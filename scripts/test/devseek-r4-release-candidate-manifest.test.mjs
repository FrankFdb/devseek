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
  buildR4ReleaseCandidateManifest,
  renderR4ReleaseCandidateManifestMarkdown,
  validateR4ReleaseCandidateManifest,
} from '../lib/devseek-r4-release-candidate-manifest.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4ReleaseCandidateManifest({ repoRoot });

test('R4 release candidate manifest binds artifact source, handoff source, and recorded smoke without qualification effect', () => {
  const actual = readJson('docs/process/devseek-r4-release-candidate-manifest.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    vsix_artifacts: 2,
    verification_receipts: 6,
    remaining_r4_leaves: 5,
    qualification_claims: 0,
  });
  assert.equal(actual.source_identity.artifact_source_commit, 'a034e5e050c044460fb07705639d9d41e6b193c0');
  assert.equal(actual.source_identity.artifact_source_differs_from_handoff, true);
  assert.equal(actual.artifact_identity.primary_vsix.sha256, '027ef950a79a576444eaf3075d689b44ef0af8bec3d22df65ca61ed2cc1df19d');
  assert.equal(actual.artifact_identity.primary_vsix.path, 'devseek-netai-1.0.0-debug.20260723.t193110.ga034e5e.vsix');
  assert.equal(actual.artifact_identity.package_copy_vsix.path, 'packages/vscode-extension/devseek-netai-1.0.0-debug.20260723.t193110.ga034e5e.vsix');
  assert.equal(actual.artifact_identity.exact_match, true);
  assert.equal(actual.current_identity_probe_boundary.status, 'deferred-not-refreshed');
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateR4ReleaseCandidateManifest(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated R4 manifest view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-release-candidate-manifest.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-release-candidate-manifest.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4ReleaseCandidateManifestMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
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

test('runtime validation fails closed on artifact mismatch, stale current leaf, or receipt promotion', () => {
  const mismatch = structuredClone(expected);
  mismatch.artifact_identity.package_copy_vsix.sha256 = '0'.repeat(64);
  mismatch.artifact_identity.exact_match = false;
  mismatch.manifest_sha256 = '0'.repeat(64);
  assertHasManifestError(mismatch, 'artifact_identity.exact_match:must-be-true');

  const wrongLeaf = structuredClone(expected);
  wrongLeaf.r4_leaf_context.current_leaf = 'R4-LIVE-QUALIFICATION-REQUEST-PACKET';
  wrongLeaf.manifest_sha256 = '0'.repeat(64);
  assertHasManifestError(wrongLeaf, 'r4_leaf_context.current_leaf:invalid');

  const promotedReceipt = structuredClone(expected);
  promotedReceipt.verification_receipts[0].qualification_effect = 'PROMOTE_GATE0';
  promotedReceipt.manifest_sha256 = '0'.repeat(64);
  assertHasManifestError(promotedReceipt, 'verification_receipts.r3-focused-verification.qualification_effect:must-be-NONE');
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
    artifact_source_commit: 'a034e5e050c044460fb07705639d9d41e6b193c0',
    handoff_doc_commit: expected.source_identity.handoff_doc_commit,
    artifact_source_differs_from_handoff: true,
    primary_vsix_sha256: '027ef950a79a576444eaf3075d689b44ef0af8bec3d22df65ca61ed2cc1df19d',
    package_copy_exact_match: true,
    verification_receipts: 6,
    current_leaf: 'R4-RELEASE-CANDIDATE-MANIFEST',
    remaining_r4_leaves: 5,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

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
