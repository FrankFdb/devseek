import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256Object } from './devseek-capability-ledger.mjs';

const ARCHIVED_CANDIDATES = [
  {
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
  },
  {
    manifest_id: 'R4-RELEASE-CANDIDATE-MANIFEST/v2',
    manifest_version: 2,
    candidate_source_commit: '4f8a56797090079914b4d921b56d9c34fe4d2abc',
    candidate_vsix_sha256: '68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc',
    manifest_sha256: '0fda85f4ad71f13d6410d61f5249e327b299642cfee17226f708f979e12bed1b',
    manifest_path: 'docs/process/archive/r4-release-candidates/v2-4f8a567/manifest.json',
    manifest_file_sha256: '8c051ecfbb718820332804f4cc690f26a54d2e243e26f91d030acbde5b94ea82',
    schema_path: 'docs/process/archive/r4-release-candidates/v2-4f8a567/manifest.schema.json',
    schema_file_sha256: 'face1ace312bdf8478301c8357222a697f750a210a58ddab769a50e4e5206b7f',
    generated_view_path: 'docs/process/archive/r4-release-candidates/v2-4f8a567/manifest.md',
    generated_view_file_sha256: '56ac05c11e2f25c6e84066066eac06286cee13a154c9683b9a2eabfb49614e46',
  },
];

export const R4_RELEASE_CANDIDATE_HISTORY = Object.freeze(
  ARCHIVED_CANDIDATES.map(candidate => Object.freeze({
    ...candidate,
    artifact_retention: 'manifest-identity-only',
  })),
);

export const R4_RELEASE_CANDIDATE_PREDECESSOR = R4_RELEASE_CANDIDATE_HISTORY.at(-1);

export function validateArchivedR4ReleaseCandidate({ repoRoot } = {}) {
  const errors = [];
  if (!repoRoot) {
    return { ok: false, errors: ['repoRoot:required'], summary: null };
  }

  for (const [index, candidate] of R4_RELEASE_CANDIDATE_HISTORY.entries()) {
    const label = `history.v${candidate.manifest_version}`;
    for (const binding of archivedFileBindings(candidate)) {
      validateFileBinding(repoRoot, label, binding, errors);
    }

    let archivedManifest = null;
    try {
      archivedManifest = readJsonFile(path.join(repoRoot, candidate.manifest_path));
    } catch (error) {
      errors.push(`${label}.manifest:read:${error.message}`);
    }
    if (archivedManifest) {
      validateManifestIdentity(archivedManifest, candidate, errors);
      if (index > 0) validateManifestLineage(archivedManifest, R4_RELEASE_CANDIDATE_HISTORY[index - 1], label, errors);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      historical_candidates: R4_RELEASE_CANDIDATE_HISTORY.length,
      predecessor_manifest_id: R4_RELEASE_CANDIDATE_PREDECESSOR.manifest_id,
      predecessor_candidate_source_commit: R4_RELEASE_CANDIDATE_PREDECESSOR.candidate_source_commit,
      predecessor_manifest_sha256: R4_RELEASE_CANDIDATE_PREDECESSOR.manifest_sha256,
      archive_status: 'immutable-history',
      artifact_retention: 'manifest-identity-only',
    },
  };
}

function archivedFileBindings(candidate) {
  return [
    ['manifest', candidate.manifest_path, candidate.manifest_file_sha256],
    ['schema', candidate.schema_path, candidate.schema_file_sha256],
    ['generated-view', candidate.generated_view_path, candidate.generated_view_file_sha256],
  ];
}

function validateFileBinding(repoRoot, label, [fileKind, relativePath, expectedSha256], errors) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`${label}.${fileKind}:missing:${relativePath}`);
    return;
  }
  if (sha256File(absolutePath) !== expectedSha256) {
    errors.push(`${label}.${fileKind}:byte-sha256-mismatch`);
  }
}

function validateManifestIdentity(manifest, candidate, errors) {
  const label = `history.v${candidate.manifest_version}`;
  if (manifest.manifest_id !== candidate.manifest_id) errors.push(`${label}.manifest_id:mismatch`);
  if (manifest.manifest_version !== candidate.manifest_version) errors.push(`${label}.manifest_version:mismatch`);
  if (manifest.source_identity?.artifact_source_commit !== candidate.candidate_source_commit) {
    errors.push(`${label}.candidate_source_commit:mismatch`);
  }
  const primarySha256 = manifest.artifact_identity?.primary_vsix?.sha256;
  const packageCopySha256 = manifest.artifact_identity?.package_copy_vsix?.sha256;
  if (primarySha256 !== candidate.candidate_vsix_sha256
    || packageCopySha256 !== candidate.candidate_vsix_sha256
    || manifest.artifact_identity?.exact_match !== true) {
    errors.push(`${label}.candidate_vsix_identity:mismatch`);
  }
  if (manifest.manifest_sha256 !== candidate.manifest_sha256) {
    errors.push(`${label}.manifest_sha256:mismatch`);
  } else if (manifestHash(manifest) !== candidate.manifest_sha256) {
    errors.push(`${label}.manifest_sha256:invalid`);
  }
  if (manifest.qualification_effect !== 'NONE'
    || manifest.claims_permitted !== false
    || manifest.asserts_gate_pass !== false) {
    errors.push(`${label}.qualification_boundary:invalid`);
  }
}

function validateManifestLineage(manifest, predecessor, label, errors) {
  const expected = {
    predecessor_manifest_id: predecessor.manifest_id,
    predecessor_manifest_version: predecessor.manifest_version,
    predecessor_candidate_source_commit: predecessor.candidate_source_commit,
    predecessor_candidate_vsix_sha256: predecessor.candidate_vsix_sha256,
    predecessor_manifest_sha256: predecessor.manifest_sha256,
    predecessor_manifest_path: predecessor.manifest_path,
    predecessor_manifest_file_sha256: predecessor.manifest_file_sha256,
    predecessor_schema_path: predecessor.schema_path,
    predecessor_schema_file_sha256: predecessor.schema_file_sha256,
    predecessor_generated_view_path: predecessor.generated_view_path,
    predecessor_generated_view_file_sha256: predecessor.generated_view_file_sha256,
    predecessor_status: 'immutable-history',
    supersession_reason: 'explicit-user-authorized-versioned-candidate-freeze',
    mutation_policy: 'byte-for-byte-predecessor-preservation',
  };
  if (canonicalJson(manifest.version_lineage) !== canonicalJson(expected)) {
    errors.push(`${label}.version_lineage:invalid`);
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
