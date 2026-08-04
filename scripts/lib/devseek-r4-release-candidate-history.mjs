import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sha256Object } from './devseek-capability-ledger.mjs';

export const R4_RELEASE_CANDIDATE_PREDECESSOR = Object.freeze({
  manifest_id: 'R4-RELEASE-CANDIDATE-MANIFEST/v1',
  manifest_version: 1,
  candidate_source_commit: 'a034e5e050c044460fb07705639d9d41e6b193c0',
  candidate_vsix_sha256: '027ef950a79a576444eaf3075d689b44ef0af8bec3d22df65ca61ed2cc1df19d',
  manifest_sha256: '67e4025b2743012648c36312870130a3773f0b79dc44ce9abbc4200c4dab50b3',
  manifest_path: 'docs/process/archive/r4-release-candidates/v1-a034e5e/manifest.json',
  manifest_file_sha256: 'eb93f971f1dcd877dbde75a032919c7d02389661aaaed6429b0bd34943091c66',
  schema_path: 'docs/process/archive/r4-release-candidates/v1-a034e5e/manifest.schema.json',
  schema_file_sha256: '6adf54c38b9fb0b8ae7c95a721dee9815f6a9a9b96edac2416d62b6b1256977f',
  generated_view_path: 'docs/process/archive/r4-release-candidates/v1-a034e5e/manifest.md',
  generated_view_file_sha256: 'b8c684c959545dd8bd6c0228e59df09f036416a2edc5b6b9db35f17d4fc2f3eb',
  primary_vsix_path: 'devseek-netai-1.0.0-debug.20260723.t193110.ga034e5e.vsix',
  package_copy_vsix_path: 'packages/vscode-extension/devseek-netai-1.0.0-debug.20260723.t193110.ga034e5e.vsix',
});

export function validateArchivedR4ReleaseCandidate({ repoRoot } = {}) {
  const errors = [];
  if (!repoRoot) {
    return { ok: false, errors: ['repoRoot:required'], summary: null };
  }

  for (const binding of predecessorFileBindings()) {
    validateFileBinding(repoRoot, binding, errors);
  }

  let archivedManifest = null;
  try {
    archivedManifest = readJsonFile(path.join(repoRoot, R4_RELEASE_CANDIDATE_PREDECESSOR.manifest_path));
  } catch (error) {
    errors.push(`predecessor.manifest:read:${error.message}`);
  }
  if (archivedManifest) validateManifestIdentity(archivedManifest, errors);

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      manifest_id: R4_RELEASE_CANDIDATE_PREDECESSOR.manifest_id,
      candidate_source_commit: R4_RELEASE_CANDIDATE_PREDECESSOR.candidate_source_commit,
      manifest_sha256: R4_RELEASE_CANDIDATE_PREDECESSOR.manifest_sha256,
      manifest_file_sha256: R4_RELEASE_CANDIDATE_PREDECESSOR.manifest_file_sha256,
      archive_status: 'immutable-history',
    },
  };
}

function predecessorFileBindings() {
  const predecessor = R4_RELEASE_CANDIDATE_PREDECESSOR;
  return [
    ['manifest', predecessor.manifest_path, predecessor.manifest_file_sha256],
    ['schema', predecessor.schema_path, predecessor.schema_file_sha256],
    ['generated-view', predecessor.generated_view_path, predecessor.generated_view_file_sha256],
    ['primary-vsix', predecessor.primary_vsix_path, predecessor.candidate_vsix_sha256],
    ['package-copy-vsix', predecessor.package_copy_vsix_path, predecessor.candidate_vsix_sha256],
  ];
}

function validateFileBinding(repoRoot, [label, relativePath, expectedSha256], errors) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`predecessor.${label}:missing:${relativePath}`);
    return;
  }
  if (sha256File(absolutePath) !== expectedSha256) {
    errors.push(`predecessor.${label}:byte-sha256-mismatch`);
  }
}

function validateManifestIdentity(manifest, errors) {
  const predecessor = R4_RELEASE_CANDIDATE_PREDECESSOR;
  if (manifest.manifest_id !== predecessor.manifest_id) errors.push('predecessor.manifest_id:mismatch');
  if (manifest.manifest_version !== predecessor.manifest_version) errors.push('predecessor.manifest_version:mismatch');
  if (manifest.source_identity?.artifact_source_commit !== predecessor.candidate_source_commit) {
    errors.push('predecessor.candidate_source_commit:mismatch');
  }
  if (manifest.artifact_identity?.primary_vsix?.sha256 !== predecessor.candidate_vsix_sha256) {
    errors.push('predecessor.candidate_vsix_sha256:mismatch');
  }
  if (manifest.manifest_sha256 !== predecessor.manifest_sha256) {
    errors.push('predecessor.manifest_sha256:mismatch');
  } else if (manifestHash(manifest) !== predecessor.manifest_sha256) {
    errors.push('predecessor.manifest_sha256:invalid');
  }
  if (manifest.qualification_effect !== 'NONE'
    || manifest.claims_permitted !== false
    || manifest.asserts_gate_pass !== false) {
    errors.push('predecessor.qualification_boundary:invalid');
  }
}

function manifestHash(manifest) {
  return sha256Object(withoutKey(manifest, 'manifest_sha256'), manifest?.integrity);
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
