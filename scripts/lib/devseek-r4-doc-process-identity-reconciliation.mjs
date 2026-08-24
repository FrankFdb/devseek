import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  readJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';

export const R4_DOC_PROCESS_IDENTITY_RECONCILIATION_SCHEMA_VERSION = 'devseek.r4-doc-process-identity-reconciliation/v2';
export const R4_DOC_PROCESS_IDENTITY_RECONCILIATION_ID = 'R4-DOC-PROCESS-IDENTITY-RECONCILIATION/v2';
export const R4_DOC_PROCESS_IDENTITY_RECONCILIATION_SCOPE = 'local-r4-doc-process-identity-reconciliation';

const CURRENT_IDENTITY_JSON = 'docs/process/devseek-current-candidate-identity.json';
const CURRENT_IDENTITY_MD = 'docs/process/generated/devseek-current-candidate-identity.md';
const ARCHIVED_FAILED_IDENTITY_JSON = 'docs/process/archive/devseek-current-candidate-identity-failed-observe-20260723-t185546.json';
const ARCHIVED_FAILED_IDENTITY_MD = 'docs/process/archive/devseek-current-candidate-identity-failed-observe-20260723-t185546.md';
const R4_RELEASE_MANIFEST_JSON = 'docs/process/devseek-r4-release-candidate-manifest.json';
const DOC14 = 'docs/top-agent-convergence-audit-20260711/archive/14-未完成事项与后续整体迭代计划.md';
const DOC19 = 'docs/top-agent-convergence-audit-20260711/archive/19-GPT5.5新窗口启动与授权指令.md';

const DOC14_ANCHORS = Object.freeze([
  '### 7.8 2026-07-23 当前窗口性能退化与 R3 live-provider 接续点',
  '### 7.9 2026-07-23 R3 scoped write-authority 修复、release 与 fresh live 新 blocker 回执',
  '### 7.10 2026-07-23 R3 live recovery blockers 修复、输入源交付误判修复与当前剩余项',
  '### 7.11 2026-07-23 fresh fe2d895 headed live rerun 失败分析与当前 R3 剩余项',
  '### 7.12 2026-07-23 3510aac headed live 安全继续后结果复核与本地修复',
  '### 7.13 2026-07-23 6d3e064 headed live 缺逐字锚点失败与 QualityGate 修复',
  '### 7.14 2026-07-23 2100acc package、controlled VSIX 与 fresh headed live PASS 回执',
]);

const DOC19_ANCHORS = Object.freeze([
  '## 6. 2026-07-23 R3 慢窗口接续提示',
  'terminal_state=READY_FOR_USER_CONFIRMATION',
]);

export function r4DocProcessIdentityReconciliationHash(report) {
  return sha256Object(withoutKeys(report, ['reconciliation_sha256']), report?.integrity);
}

export function buildR4DocProcessIdentityReconciliation({ repoRoot } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const releaseManifest = readJson(path.join(repoRoot, R4_RELEASE_MANIFEST_JSON));
  const trackedCurrentIdentity = readIdentityArtifact({
    repoRoot,
    jsonPath: CURRENT_IDENTITY_JSON,
    markdownPath: CURRENT_IDENTITY_MD,
    status: 'tracked-stale-deferred',
    archive_status: 'not-archived',
  });
  const archivedFailedIdentity = readIdentityArtifact({
    repoRoot,
    jsonPath: ARCHIVED_FAILED_IDENTITY_JSON,
    markdownPath: ARCHIVED_FAILED_IDENTITY_MD,
    status: 'archived-failed-observe',
    archive_status: 'archived',
  });
  const handoffDocuments = [
    readHandoffDocument({
      repoRoot,
      relativePath: DOC14,
      status: 'archived-in-place',
      requiredAnchors: DOC14_ANCHORS,
    }),
    readHandoffDocument({
      repoRoot,
      relativePath: DOC19,
      status: 'archived-in-place',
      requiredAnchors: DOC19_ANCHORS,
    }),
  ];
  const trackedCurrentMatchesReleaseCandidate = identityMatchesReleaseCandidate(
    trackedCurrentIdentity,
    releaseManifest,
  );
  trackedCurrentIdentity.status = trackedCurrentMatchesReleaseCandidate
    ? 'tracked-current-clean-runtime'
    : 'tracked-stale-deferred';
  const currentCandidateIdentityStatus = trackedCurrentMatchesReleaseCandidate
    ? 'clean-runtime-identity-established'
    : 'deferred-unusable-until-clean-runtime';
  const authorityToRefreshCurrentCandidateIdentity = trackedCurrentMatchesReleaseCandidate
    ? 'not-required-current-identity-already-release-candidate'
    : 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME';

  const report = {
    schema_version: R4_DOC_PROCESS_IDENTITY_RECONCILIATION_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    reconciliation_id: R4_DOC_PROCESS_IDENTITY_RECONCILIATION_ID,
    reconciliation_version: 2,
    source_status: 'verified-local-doc-process-boundary',
    integrity_scope: R4_DOC_PROCESS_IDENTITY_RECONCILIATION_SCOPE,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'R4DocProcessIdentityReconciliation',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_boundaries: {
      product_implementation_commit: releaseManifest.source_identity.artifact_source_commit,
      artifact_source_commit: releaseManifest.source_identity.artifact_source_commit,
      verification_record_path: releaseManifest.source_identity.verification_record_path,
      verification_record_commit: releaseManifest.source_identity.verification_record_commit,
      release_candidate_manifest_path: R4_RELEASE_MANIFEST_JSON,
      release_candidate_manifest_sha256: releaseManifest.manifest_sha256,
      identity_reconciliation_commit_bound: false,
    },
    identity_artifacts: {
      tracked_current_candidate_identity: trackedCurrentIdentity,
      archived_failed_observe_identity: archivedFailedIdentity,
      release_candidate_identity: {
        path: R4_RELEASE_MANIFEST_JSON,
        status: 'current-local-release-smoke-reference',
        artifact_source_commit: releaseManifest.source_identity.artifact_source_commit,
        vsix_sha256: releaseManifest.artifact_identity.primary_vsix.sha256,
        manifest_sha256: releaseManifest.manifest_sha256,
        usable_for_qualification: false,
        qualification_effect: releaseManifest.qualification_effect,
      },
      tracked_current_matches_release_candidate: trackedCurrentMatchesReleaseCandidate,
      archived_failed_matches_release_candidate: archivedFailedIdentity.artifact_git_commit === releaseManifest.source_identity.artifact_source_short
        && archivedFailedIdentity.vsix_sha256 === releaseManifest.artifact_identity.primary_vsix.sha256,
    },
    handoff_documents: handoffDocuments,
    conclusions: {
      current_candidate_identity_status: currentCandidateIdentityStatus,
      failed_identity_snapshot_status: 'archived-not-current',
      handoff_drift_status: 'archived-in-place',
      authority_to_refresh_current_candidate_identity: authorityToRefreshCurrentCandidateIdentity,
      release_candidate_manifest_remains_source_of_local_release_smoke: true,
      claims_empty: true,
      gate0_status: 'NOT_PASSED',
      r1_qualification_status: 'NOT_STARTED',
    },
    counts: {
      identity_artifacts_reconciled: 3,
      archived_failed_identity_snapshots: 1,
      handoff_documents_reconciled: 2,
      tracked_current_identity_usable_for_qualification: 0,
      qualification_claims: 0,
    },
    reconciliation_sha256: '',
  };

  report.reconciliation_sha256 = r4DocProcessIdentityReconciliationHash(report);
  return report;
}

export function validateR4DocProcessIdentityReconciliation(report, { repoRoot } = {}) {
  const errors = [];
  if (!isObject(report)) {
    return {
      ok: false,
      errors: ['reconciliation:expected-object'],
      summary: null,
    };
  }

  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildR4DocProcessIdentityReconciliation({ repoRoot });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(report) !== canonicalJson(expected)) {
    errors.push('reconciliation:expected-current-doc-process-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeR4DocProcessIdentityReconciliation(expected) : null,
  };
}

export function renderR4DocProcessIdentityReconciliationMarkdown(report) {
  const current = report.identity_artifacts.tracked_current_candidate_identity;
  const archived = report.identity_artifacts.archived_failed_observe_identity;
  const release = report.identity_artifacts.release_candidate_identity;
  const lines = [
    '# DevSeek R4 Doc Process Identity Reconciliation',
    '',
    '## 摘要',
    '',
    `- Reconciliation ID: \`${report.reconciliation_id}\``,
    `- Source status: \`${report.source_status}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${report.claims_permitted}\``,
    `- Gate0: \`${report.conclusions.gate0_status}\``,
    `- R1 qualification: \`${report.conclusions.r1_qualification_status}\``,
    '',
    '## 身份边界',
    '',
    `- Product implementation commit: \`${report.source_boundaries.product_implementation_commit}\``,
    `- Artifact source commit: \`${report.source_boundaries.artifact_source_commit}\``,
    `- Verification record: \`${report.source_boundaries.verification_record_path}\` @ \`${report.source_boundaries.verification_record_commit}\``,
    '',
    '| Identity | Status | Artifact | VSIX SHA-256 | Observe | Usable For Qualification |',
    '| --- | --- | --- | --- | --- | --- |',
    identityRow('tracked-current-candidate', current),
    identityRow('archived-failed-observe', archived),
    `| release-candidate-manifest: \`${release.path}\` | \`${release.status}\` | \`${release.artifact_source_commit}\` | \`${release.vsix_sha256}\` | \`n/a\` | \`${release.usable_for_qualification}\` |`,
    '',
    `- Tracked current matches release candidate: \`${report.identity_artifacts.tracked_current_matches_release_candidate}\``,
    `- Archived failed snapshot matches release candidate: \`${report.identity_artifacts.archived_failed_matches_release_candidate}\``,
    `- Authority to refresh current candidate identity: \`${report.conclusions.authority_to_refresh_current_candidate_identity}\``,
    '',
    '## Handoff Drift',
    '',
    '| Document | Status | SHA-256 | Anchors Present |',
    '| --- | --- | --- | --- |',
    ...report.handoff_documents.map(doc => (
      `| \`${doc.path}\` | \`${doc.status}\` | \`${doc.file_sha256}\` | \`${doc.required_anchors_present}/${doc.required_anchors_total}\` |`
    )),
    '',
    '## 结论',
    '',
    `- Current candidate identity: \`${report.conclusions.current_candidate_identity_status}\``,
    `- Failed identity snapshot: \`${report.conclusions.failed_identity_snapshot_status}\``,
    `- Handoff drift: \`${report.conclusions.handoff_drift_status}\``,
    `- Release candidate manifest remains local smoke source: \`${report.conclusions.release_candidate_manifest_remains_source_of_local_release_smoke}\``,
    '',
    '## Reconciliation Identity',
    '',
    `- Reconciliation SHA-256: \`${report.reconciliation_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeR4DocProcessIdentityReconciliation(report) {
  return {
    reconciliation_sha256: report.reconciliation_sha256,
    artifact_source_commit: report.source_boundaries.artifact_source_commit,
    verification_record_path: report.source_boundaries.verification_record_path,
    verification_record_commit: report.source_boundaries.verification_record_commit,
    tracked_current_identity_artifact: report.identity_artifacts.tracked_current_candidate_identity.artifact_git_commit,
    archived_failed_identity_artifact: report.identity_artifacts.archived_failed_observe_identity.artifact_git_commit,
    release_candidate_artifact: report.identity_artifacts.release_candidate_identity.artifact_source_commit,
    tracked_current_matches_release_candidate: report.identity_artifacts.tracked_current_matches_release_candidate,
    archived_failed_matches_release_candidate: report.identity_artifacts.archived_failed_matches_release_candidate,
    handoff_documents_reconciled: report.handoff_documents.length,
    qualification_effect: report.qualification_effect,
    claims_permitted: report.claims_permitted,
    asserts_gate_pass: report.asserts_gate_pass,
  };
}

function readIdentityArtifact({
  repoRoot,
  jsonPath,
  markdownPath,
  status,
  archive_status,
}) {
  const fullJsonPath = path.join(repoRoot, jsonPath);
  const fullMarkdownPath = path.join(repoRoot, markdownPath);
  const identity = readJson(fullJsonPath);
  return {
    path: jsonPath,
    generated_view_path: markdownPath,
    status,
    archive_status,
    file_sha256: sha256File(fullJsonPath),
    generated_view_sha256: sha256File(fullMarkdownPath),
    artifact_git_commit: identity.source_identity.artifact_git_commit,
    candidate_source_commit: identity.source_identity.candidate_source_commit,
    vsix_sha256: identity.artifact_identity.primary_vsix.sha256,
    build_id: identity.artifact_identity.primary_vsix.package_identity.devseekBuild.buildId,
    observe_status: identity.release_state.observe.status,
    identity_probe_sha256: identity.identity_probe_sha256,
    usable_for_qualification: false,
    qualification_effect: identity.qualification_effect,
  };
}

function readHandoffDocument({
  repoRoot,
  relativePath,
  status,
  requiredAnchors,
}) {
  const fullPath = path.join(repoRoot, relativePath);
  const text = fs.readFileSync(fullPath, 'utf8');
  const anchors = requiredAnchors.map(anchor => ({
    anchor,
    present: text.includes(anchor),
  }));
  return {
    path: relativePath,
    status,
    file_sha256: sha256File(fullPath),
    required_anchors_total: requiredAnchors.length,
    required_anchors_present: anchors.filter(anchor => anchor.present).length,
    anchors,
  };
}

function semanticValidate(report, errors) {
  if (report.schema_version !== R4_DOC_PROCESS_IDENTITY_RECONCILIATION_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (report.reconciliation_id !== R4_DOC_PROCESS_IDENTITY_RECONCILIATION_ID) errors.push('reconciliation_id:invalid');
  if (report.reconciliation_version !== 2) errors.push('reconciliation_version:must-be-2');
  if (report.source_status !== 'verified-local-doc-process-boundary') errors.push('source_status:invalid');
  if (report.integrity_scope !== R4_DOC_PROCESS_IDENTITY_RECONCILIATION_SCOPE) errors.push('integrity_scope:invalid');
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (report.observation_authority?.semantic_authority !== 'R4DocProcessIdentityReconciliation') {
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
  if (report.source_boundaries?.identity_reconciliation_commit_bound !== false) {
    errors.push('source_boundaries.identity_reconciliation_commit_bound:must-be-false');
  }
  const tracked = report.identity_artifacts?.tracked_current_candidate_identity;
  const archived = report.identity_artifacts?.archived_failed_observe_identity;
  const release = report.identity_artifacts?.release_candidate_identity;
  const trackedMatchesReleaseCandidate = report.identity_artifacts?.tracked_current_matches_release_candidate === true;
  const expectedTrackedStatus = trackedMatchesReleaseCandidate
    ? 'tracked-current-clean-runtime'
    : 'tracked-stale-deferred';
  if (tracked?.status !== expectedTrackedStatus) errors.push('identity_artifacts.tracked_current_candidate_identity.status:invalid');
  if (archived?.status !== 'archived-failed-observe') errors.push('identity_artifacts.archived_failed_observe_identity.status:invalid');
  if (release?.status !== 'current-local-release-smoke-reference') errors.push('identity_artifacts.release_candidate_identity.status:invalid');
  if (tracked?.usable_for_qualification !== false || archived?.usable_for_qualification !== false || release?.usable_for_qualification !== false) {
    errors.push('identity_artifacts.usable_for_qualification:must-all-be-false');
  }
  if (typeof report.identity_artifacts?.tracked_current_matches_release_candidate !== 'boolean') {
    errors.push('identity_artifacts.tracked_current_matches_release_candidate:must-be-boolean');
  }
  if (report.identity_artifacts?.archived_failed_matches_release_candidate !== false) {
    errors.push('identity_artifacts.archived_failed_matches_release_candidate:must-be-false');
  }
  for (const doc of report.handoff_documents ?? []) {
    if (doc.required_anchors_present !== doc.required_anchors_total) {
      errors.push(`handoff_documents.${doc.path}:missing-anchors`);
    }
  }
  const expectedCurrentCandidateStatus = trackedMatchesReleaseCandidate
    ? 'clean-runtime-identity-established'
    : 'deferred-unusable-until-clean-runtime';
  if (report.conclusions?.current_candidate_identity_status !== expectedCurrentCandidateStatus) {
    errors.push('conclusions.current_candidate_identity_status:invalid');
  }
  const expectedRefreshAuthority = trackedMatchesReleaseCandidate
    ? 'not-required-current-identity-already-release-candidate'
    : 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME';
  if (report.conclusions?.authority_to_refresh_current_candidate_identity !== expectedRefreshAuthority) {
    errors.push('conclusions.authority_to_refresh_current_candidate_identity:invalid');
  }
  if (report.conclusions?.claims_empty !== true) errors.push('conclusions.claims_empty:must-be-true');
  if (report.conclusions?.gate0_status !== 'NOT_PASSED') errors.push('conclusions.gate0_status:must-be-NOT_PASSED');
  if (report.conclusions?.r1_qualification_status !== 'NOT_STARTED') errors.push('conclusions.r1_qualification_status:must-be-NOT_STARTED');
  if (report.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  if (report.counts?.archived_failed_identity_snapshots !== 1) errors.push('counts.archived_failed_identity_snapshots:must-be-1');
  if (report.counts?.handoff_documents_reconciled !== 2) errors.push('counts.handoff_documents_reconciled:must-be-2');
  const computedHash = r4DocProcessIdentityReconciliationHash(report);
  if (!/^[a-f0-9]{64}$/u.test(report.reconciliation_sha256 ?? '')) {
    errors.push('reconciliation_sha256:invalid');
  } else if (report.reconciliation_sha256 !== computedHash) {
    errors.push('reconciliation_sha256:mismatch');
  }
}

function identityMatchesReleaseCandidate(identity, releaseManifest) {
  return identity.candidate_source_commit === releaseManifest.source_identity.artifact_source_commit
    && identity.artifact_git_commit === releaseManifest.source_identity.artifact_source_short
    && identity.vsix_sha256 === releaseManifest.artifact_identity.primary_vsix.sha256
    && identity.observe_status === 'passed';
}

function identityRow(label, identity) {
  return `| ${label}: \`${identity.path}\` | \`${identity.status}\` | \`${identity.artifact_git_commit}\` | \`${identity.vsix_sha256}\` | \`${identity.observe_status}\` | \`${identity.usable_for_qualification}\` |`;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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
