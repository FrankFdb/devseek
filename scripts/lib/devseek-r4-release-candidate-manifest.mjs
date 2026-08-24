import crypto from 'node:crypto';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';
import {
  assertR4ActiveCandidateIdentity,
  buildR4ReleaseCandidateVersionLineage,
  R4_ACTIVE_CANDIDATE,
  R4_CANDIDATE_VERIFICATION_RECEIPTS,
  R4_REMAINING_LEAVES_AT_FREEZE,
  R4_VERIFICATION_RECORD,
  validateR4VerificationRecordSource,
} from './devseek-r4-release-candidate-freeze.mjs';
import {
  R4_RELEASE_CANDIDATE_PREDECESSOR,
  R4_RELEASE_CANDIDATE_HISTORY,
  validateArchivedR4ReleaseCandidate,
} from './devseek-r4-release-candidate-history.mjs';
import {
  comparableVsixIdentity,
  readVsixIdentity,
} from './devseek-vsix-artifact-identity.mjs';

export { validateArchivedR4ReleaseCandidate };

export const R4_RELEASE_CANDIDATE_MANIFEST_SCHEMA_VERSION = 'devseek.r4-release-candidate-manifest/v4';
export const R4_RELEASE_CANDIDATE_MANIFEST_ID = 'R4-RELEASE-CANDIDATE-MANIFEST/v4';
export const R4_RELEASE_CANDIDATE_INTEGRITY_SCOPE = 'local-r4-release-candidate-manifest';
export const R4_RELEASE_CANDIDATE_QUALIFICATION_EFFECT = 'NONE';

const PRIMARY_VSIX_PATH = R4_ACTIVE_CANDIDATE.vsix_name;
const PACKAGE_COPY_VSIX_PATH = `packages/vscode-extension/${R4_ACTIVE_CANDIDATE.vsix_name}`;

export function r4ReleaseCandidateManifestHash(manifest) {
  return sha256Object(withoutKeys(manifest, ['manifest_sha256']), manifest?.integrity);
}

export function buildR4ReleaseCandidateManifest({ repoRoot } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const predecessorValidation = validateArchivedR4ReleaseCandidate({ repoRoot });
  if (!predecessorValidation.ok) {
    throw new Error(`predecessor-archive:${predecessorValidation.errors.join(',')}`);
  }

  const primaryVsix = readVsixIdentity(path.join(repoRoot, PRIMARY_VSIX_PATH), repoRoot);
  const packageCopyVsix = readVsixIdentity(path.join(repoRoot, PACKAGE_COPY_VSIX_PATH), repoRoot);
  const artifactGitCommit = primaryVsix.package_identity.devseekBuild.gitCommit;
  const artifactSourceCommit = resolveGitCommit(repoRoot, artifactGitCommit);
  const currentIdentityText = fs.readFileSync(
    path.join(repoRoot, R4_ACTIVE_CANDIDATE.current_identity_path),
    'utf8',
  );
  const currentIdentity = JSON.parse(currentIdentityText);
  const currentIdentityFileSha256 = sha256Buffer(Buffer.from(currentIdentityText, 'utf8'));
  const verificationRecordText = readGitFile(
    repoRoot,
    R4_VERIFICATION_RECORD.commit,
    R4_VERIFICATION_RECORD.path,
  );

  assertR4ActiveCandidateIdentity({
    artifactSourceCommit,
    primaryVsix,
    packageCopyVsix,
    currentIdentity,
    currentIdentityFileSha256,
  });

  const artifactComparable = comparableVsixIdentity(primaryVsix);
  const copyComparable = comparableVsixIdentity(packageCopyVsix);
  const manifest = {
    schema_version: R4_RELEASE_CANDIDATE_MANIFEST_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    manifest_id: R4_RELEASE_CANDIDATE_MANIFEST_ID,
    manifest_version: R4_ACTIVE_CANDIDATE.manifest_version,
    source_status: 'user-authorized-versioned-local-candidate-freeze',
    integrity_scope: R4_RELEASE_CANDIDATE_INTEGRITY_SCOPE,
    local_evidence_class: R4_ACTIVE_CANDIDATE.local_evidence_class,
    qualification_eligible: false,
    qualification_effect: R4_RELEASE_CANDIDATE_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    selection_boundary: {
      authorization: 'explicit-user-authorization',
      scope: 'local-versioned-r4-candidate-freeze-only',
      predecessor_mutation: 'FORBIDDEN',
      protected_release_candidate: false,
      artifact_channel: 'debug',
      external_qualification_authority: false,
      qualification_effect: 'NONE',
    },
    observation_authority: {
      semantic_authority: 'R4ReleaseCandidateManifest',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    version_lineage: buildR4ReleaseCandidateVersionLineage(R4_RELEASE_CANDIDATE_PREDECESSOR),
    source_identity: {
      artifact_source_commit: artifactSourceCommit,
      artifact_source_short: artifactGitCommit,
      artifact_source_resolution: 'git rev-parse <vsix.devseekBuild.gitCommit>^{commit}',
      verification_record_path: R4_VERIFICATION_RECORD.path,
      verification_record_ref: R4_VERIFICATION_RECORD.ref,
      verification_record_commit: R4_VERIFICATION_RECORD.commit,
      current_candidate_identity_path: R4_ACTIVE_CANDIDATE.current_identity_path,
      current_candidate_identity_file_sha256: currentIdentityFileSha256,
      current_candidate_identity_probe_sha256: currentIdentity.identity_probe_sha256,
      artifact_source_matches_current_identity: artifactSourceCommit === currentIdentity.source_identity.candidate_source_commit,
    },
    artifact_identity: {
      primary_vsix: primaryVsix,
      package_copy_vsix: packageCopyVsix,
      exact_match: canonicalJson(artifactComparable) === canonicalJson(copyComparable),
    },
    verification_receipts: R4_CANDIDATE_VERIFICATION_RECEIPTS.map(receipt => ({
      ...receipt,
      status: 'recorded-passed',
      source_ref: R4_VERIFICATION_RECORD.ref,
      source_commit: R4_VERIFICATION_RECORD.commit,
      qualification_effect: 'NONE',
    })),
    current_identity_probe_boundary: {
      path: R4_ACTIVE_CANDIDATE.current_identity_path,
      status: 'verified-current-candidate',
      identity_probe_sha256: currentIdentity.identity_probe_sha256,
      identity_source_sha256: currentIdentityFileSha256,
      candidate_source_commit: currentIdentity.source_identity.candidate_source_commit,
      artifact_source_matches_current_identity: true,
      stable_runtime_count: currentIdentity.counts.active_runtime_identities,
      observe_status: currentIdentity.release_state.observe.status,
      qualification_effect: 'NONE',
      reason: 'Tracked current identity already proves artifact, stable install, and exactly-one local runtime for this candidate; the manifest performs no live observation.',
    },
    r4_leaf_context: {
      current_leaf: 'R4-RELEASE-CANDIDATE-MANIFEST',
      closure_effect: 'version-selects the local R4 candidate without adding qualification authority',
      remaining_leaves_at_freeze: [...R4_REMAINING_LEAVES_AT_FREEZE],
    },
    counts: {
      vsix_artifacts: 2,
      historical_candidates: R4_RELEASE_CANDIDATE_HISTORY.length,
      verification_receipts: R4_CANDIDATE_VERIFICATION_RECEIPTS.length,
      remaining_r4_leaves_at_freeze: R4_REMAINING_LEAVES_AT_FREEZE.length,
      qualification_claims: 0,
    },
    manifest_sha256: '',
  };

  validateR4VerificationRecordSource(verificationRecordText, manifest).forEach(error => {
    throw new Error(error);
  });
  manifest.manifest_sha256 = r4ReleaseCandidateManifestHash(manifest);
  return manifest;
}

export function validateR4ReleaseCandidateManifest(report, { repoRoot } = {}) {
  const errors = [];
  if (!isObject(report)) {
    return { ok: false, errors: ['manifest:expected-object'], summary: null };
  }

  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildR4ReleaseCandidateManifest({ repoRoot });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }
  if (expected && canonicalJson(report) !== canonicalJson(expected)) {
    errors.push('manifest:expected-frozen-candidate-version-and-source-bindings');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeR4ReleaseCandidateManifest(expected) : null,
  };
}

export function renderR4ReleaseCandidateManifestMarkdown(report) {
  const primary = report.artifact_identity.primary_vsix;
  const copy = report.artifact_identity.package_copy_vsix;
  const source = report.source_identity;
  const lineage = report.version_lineage;
  const lines = [
    '# DevSeek R4 Release Candidate Manifest',
    '',
    '## 摘要',
    '',
    `- Manifest ID: \`${report.manifest_id}\``,
    `- Source status: \`${report.source_status}\``,
    `- Local evidence class: \`${report.local_evidence_class}\``,
    `- Selection scope: \`${report.selection_boundary.scope}\``,
    `- Protected release candidate: \`${report.selection_boundary.protected_release_candidate}\``,
    `- Artifact channel: \`${report.selection_boundary.artifact_channel}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${report.claims_permitted}\``,
    `- Gate assertion: \`${report.asserts_gate_pass}\``,
    `- Live/runtime/provider actions: \`${report.observation_authority.live_holdout_actions}/${report.observation_authority.runtime_process_observation}/${report.observation_authority.provider_actions}\``,
    '',
    '## 版本链',
    '',
    `- Predecessor: \`${lineage.predecessor_manifest_id}\``,
    `- Historical candidate: \`${lineage.predecessor_candidate_source_commit}\``,
    `- Archive status: \`${lineage.predecessor_status}\``,
    `- Archived manifest: \`${lineage.predecessor_manifest_path}\``,
    `- Archived manifest file SHA-256: \`${lineage.predecessor_manifest_file_sha256}\``,
    `- Mutation policy: \`${lineage.mutation_policy}\``,
    '',
    '## 源身份边界',
    '',
    `- Artifact source commit: \`${source.artifact_source_commit}\``,
    `- Verification record: \`${source.verification_record_ref}\` @ \`${source.verification_record_commit}\``,
    `- Current identity: \`${source.current_candidate_identity_path}\``,
    `- Artifact source matches current identity: \`${source.artifact_source_matches_current_identity}\``,
    '',
    '## 候选制品',
    '',
    '| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |',
    '| --- | --- | --- | --- | --- |',
    artifactRow('primary', primary),
    artifactRow('package-copy', copy),
    '',
    `- Primary/package-copy exact match: \`${report.artifact_identity.exact_match}\``,
    '',
    '## 记录型验证回执',
    '',
    '| Receipt | Status | Scope | Evidence |',
    '| --- | --- | --- | --- |',
    ...report.verification_receipts.map(receipt => (
      `| \`${receipt.receipt_id}\` | \`${receipt.status}\` | \`${receipt.verification_scope}\` | ${escapeTableText(receipt.evidence)} |`
    )),
    '',
    '## Current Candidate Identity 边界',
    '',
    `- Path: \`${report.current_identity_probe_boundary.path}\``,
    `- Status: \`${report.current_identity_probe_boundary.status}\``,
    `- Candidate source commit: \`${report.current_identity_probe_boundary.candidate_source_commit}\``,
    `- Stable runtime count: \`${report.current_identity_probe_boundary.stable_runtime_count}\``,
    `- Observe status: \`${report.current_identity_probe_boundary.observe_status}\``,
    `- Qualification effect: \`${report.current_identity_probe_boundary.qualification_effect}\``,
    `- Reason: ${report.current_identity_probe_boundary.reason}`,
    '',
    '## R4 叶子状态',
    '',
    `- Current leaf: \`${report.r4_leaf_context.current_leaf}\``,
    `- Closure effect: \`${report.r4_leaf_context.closure_effect}\``,
    `- Remaining leaves at freeze: \`${report.r4_leaf_context.remaining_leaves_at_freeze.join(', ')}\``,
    '',
    '## Manifest Identity',
    '',
    `- Manifest SHA-256: \`${report.manifest_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeR4ReleaseCandidateManifest(report) {
  return {
    manifest_sha256: report.manifest_sha256,
    manifest_version: report.manifest_version,
    artifact_source_commit: report.source_identity.artifact_source_commit,
    primary_vsix_sha256: report.artifact_identity.primary_vsix.sha256,
    package_copy_exact_match: report.artifact_identity.exact_match,
    predecessor_candidate_source_commit: report.version_lineage.predecessor_candidate_source_commit,
    predecessor_status: report.version_lineage.predecessor_status,
    verification_receipts: report.verification_receipts.length,
    current_identity_status: report.current_identity_probe_boundary.status,
    current_leaf: report.r4_leaf_context.current_leaf,
    remaining_r4_leaves_at_freeze: report.r4_leaf_context.remaining_leaves_at_freeze.length,
    local_evidence_class: report.local_evidence_class,
    protected_release_candidate: report.selection_boundary.protected_release_candidate,
    qualification_effect: report.qualification_effect,
    claims_permitted: report.claims_permitted,
    asserts_gate_pass: report.asserts_gate_pass,
  };
}

function semanticValidate(report, errors) {
  if (report.schema_version !== R4_RELEASE_CANDIDATE_MANIFEST_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (report.manifest_id !== R4_RELEASE_CANDIDATE_MANIFEST_ID) errors.push('manifest_id:invalid');
  if (report.manifest_version !== R4_ACTIVE_CANDIDATE.manifest_version) errors.push(`manifest_version:must-be-${R4_ACTIVE_CANDIDATE.manifest_version}`);
  if (report.source_status !== 'user-authorized-versioned-local-candidate-freeze') errors.push('source_status:invalid');
  if (report.integrity_scope !== R4_RELEASE_CANDIDATE_INTEGRITY_SCOPE) errors.push('integrity_scope:invalid');
  if (report.local_evidence_class !== R4_ACTIVE_CANDIDATE.local_evidence_class) errors.push('local_evidence_class:invalid');
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== R4_RELEASE_CANDIDATE_QUALIFICATION_EFFECT) errors.push('qualification_effect:must-be-NONE');
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (report.selection_boundary?.authorization !== 'explicit-user-authorization') errors.push('selection_boundary.authorization:invalid');
  if (report.selection_boundary?.scope !== 'local-versioned-r4-candidate-freeze-only') errors.push('selection_boundary.scope:invalid');
  if (report.selection_boundary?.predecessor_mutation !== 'FORBIDDEN') errors.push('selection_boundary.predecessor_mutation:must-be-FORBIDDEN');
  if (report.selection_boundary?.protected_release_candidate !== false) errors.push('selection_boundary.protected_release_candidate:must-be-false');
  if (report.selection_boundary?.artifact_channel !== 'debug') errors.push('selection_boundary.artifact_channel:must-be-debug');
  if (report.selection_boundary?.external_qualification_authority !== false) errors.push('selection_boundary.external_qualification_authority:must-be-false');
  if (report.selection_boundary?.qualification_effect !== 'NONE') errors.push('selection_boundary.qualification_effect:must-be-NONE');
  if (report.observation_authority?.semantic_authority !== 'R4ReleaseCandidateManifest') {
    errors.push('observation_authority.semantic_authority:invalid');
  }
  if (report.observation_authority?.writes_product_state !== false) {
    errors.push('observation_authority.writes_product_state:must-be-false');
  }
  for (const field of ['provider_actions', 'live_holdout_actions', 'runtime_process_observation', 'install_or_window_actions', 'secret_observation']) {
    if (report.observation_authority?.[field] !== 'FORBIDDEN') {
      errors.push(`observation_authority.${field}:must-be-FORBIDDEN`);
    }
  }
  const expectedLineage = buildR4ReleaseCandidateVersionLineage(R4_RELEASE_CANDIDATE_PREDECESSOR);
  if (canonicalJson(report.version_lineage) !== canonicalJson(expectedLineage)) {
    errors.push('version_lineage:invalid-or-predecessor-mutated');
  }
  if (report.source_identity?.artifact_source_commit !== R4_ACTIVE_CANDIDATE.source_commit) {
    errors.push('source_identity.artifact_source_commit:invalid');
  }
  if (report.source_identity?.verification_record_path !== R4_VERIFICATION_RECORD.path
    || report.source_identity?.verification_record_ref !== R4_VERIFICATION_RECORD.ref
    || report.source_identity?.verification_record_commit !== R4_VERIFICATION_RECORD.commit) {
    errors.push('source_identity.verification_record:invalid');
  }
  if (report.source_identity?.current_candidate_identity_path !== R4_ACTIVE_CANDIDATE.current_identity_path
    || report.source_identity?.current_candidate_identity_file_sha256 !== R4_ACTIVE_CANDIDATE.current_identity_file_sha256
    || report.source_identity?.current_candidate_identity_probe_sha256 !== R4_ACTIVE_CANDIDATE.current_identity_probe_sha256
    || report.source_identity?.artifact_source_matches_current_identity !== true) {
    errors.push('source_identity.current_candidate_identity:invalid');
  }
  if (report.artifact_identity?.primary_vsix?.path !== PRIMARY_VSIX_PATH
    || report.artifact_identity?.package_copy_vsix?.path !== PACKAGE_COPY_VSIX_PATH
    || report.artifact_identity?.primary_vsix?.sha256 !== R4_ACTIVE_CANDIDATE.vsix_sha256
    || report.artifact_identity?.package_copy_vsix?.sha256 !== R4_ACTIVE_CANDIDATE.vsix_sha256
    || report.artifact_identity?.exact_match !== true) {
    errors.push('artifact_identity:frozen-candidate-mismatch');
  }
  const primary = report.artifact_identity?.primary_vsix;
  const copy = report.artifact_identity?.package_copy_vsix;
  if (primary && copy && canonicalJson(comparableVsixIdentity(primary)) !== canonicalJson(comparableVsixIdentity(copy))) {
    errors.push('artifact_identity:primary-and-package-copy-mismatch');
  }
  const identityBoundary = report.current_identity_probe_boundary;
  if (identityBoundary?.status !== 'verified-current-candidate'
    || identityBoundary?.identity_probe_sha256 !== R4_ACTIVE_CANDIDATE.current_identity_probe_sha256
    || identityBoundary?.identity_source_sha256 !== R4_ACTIVE_CANDIDATE.current_identity_file_sha256
    || identityBoundary?.candidate_source_commit !== R4_ACTIVE_CANDIDATE.source_commit
    || identityBoundary?.artifact_source_matches_current_identity !== true
    || identityBoundary?.stable_runtime_count !== 1
    || identityBoundary?.observe_status !== 'passed'
    || identityBoundary?.qualification_effect !== 'NONE') {
    errors.push('current_identity_probe_boundary:invalid');
  }
  if (report.r4_leaf_context?.current_leaf !== 'R4-RELEASE-CANDIDATE-MANIFEST') {
    errors.push('r4_leaf_context.current_leaf:invalid');
  }
  if (!Array.isArray(report.r4_leaf_context?.remaining_leaves_at_freeze)
    || canonicalJson(report.r4_leaf_context.remaining_leaves_at_freeze) !== canonicalJson([...R4_REMAINING_LEAVES_AT_FREEZE])) {
    errors.push('r4_leaf_context.remaining_leaves_at_freeze:invalid');
  }
  if (report.counts?.vsix_artifacts !== 2) errors.push('counts.vsix_artifacts:must-be-2');
  if (report.counts?.historical_candidates !== R4_RELEASE_CANDIDATE_HISTORY.length) {
    errors.push(`counts.historical_candidates:must-be-${R4_RELEASE_CANDIDATE_HISTORY.length}`);
  }
  if (report.counts?.verification_receipts !== R4_CANDIDATE_VERIFICATION_RECEIPTS.length) errors.push('counts.verification_receipts:invalid');
  if (report.counts?.remaining_r4_leaves_at_freeze !== R4_REMAINING_LEAVES_AT_FREEZE.length) {
    errors.push('counts.remaining_r4_leaves_at_freeze:invalid');
  }
  if (report.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  for (const receipt of report.verification_receipts ?? []) {
    if (receipt.status !== 'recorded-passed') errors.push(`verification_receipts.${receipt.receipt_id}.status:must-be-recorded-passed`);
    if (receipt.source_ref !== R4_VERIFICATION_RECORD.ref || receipt.source_commit !== R4_VERIFICATION_RECORD.commit) {
      errors.push(`verification_receipts.${receipt.receipt_id}.source:invalid`);
    }
    if (receipt.qualification_effect !== 'NONE') errors.push(`verification_receipts.${receipt.receipt_id}.qualification_effect:must-be-NONE`);
  }
  const computedHash = r4ReleaseCandidateManifestHash(report);
  if (!/^[a-f0-9]{64}$/u.test(report.manifest_sha256 ?? '')) {
    errors.push('manifest_sha256:invalid');
  } else if (report.manifest_sha256 !== computedHash) {
    errors.push('manifest_sha256:mismatch');
  }
}

function resolveGitCommit(repoRoot, commit) {
  return git(repoRoot, ['rev-parse', `${commit}^{commit}`]);
}

function readGitFile(repoRoot, commit, relativePath) {
  return git(repoRoot, ['show', `${commit}:${relativePath}`], { trim: false });
}

function git(repoRoot, args, { trim = true } = {}) {
  const result = cp.spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git:${args.join(' ')}:${String(result.stderr ?? '').trim() || result.status}`);
  }
  return trim ? result.stdout.trim() : result.stdout;
}

function artifactRow(label, artifact) {
  const build = artifact.package_identity.devseekBuild;
  return `| ${label}: \`${artifact.path}\` | \`${artifact.sha256}\` | \`${build.buildId}\` | \`${build.gitCommit}\` | \`${artifact.packaged_bridge_server_sha256}\` |`;
}

function escapeTableText(value) {
  return String(value).replace(/\|/gu, '\\|');
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function withoutKeys(value, keys) {
  if (!isObject(value)) return value;
  const clone = {};
  for (const [key, child] of Object.entries(value)) {
    if (!keys.includes(key)) clone[key] = child;
  }
  return clone;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
