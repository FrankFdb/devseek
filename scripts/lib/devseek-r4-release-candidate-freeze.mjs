import { currentCandidateIdentityHash } from './devseek-current-candidate-identity.mjs';

export const R4_ACTIVE_CANDIDATE = Object.freeze({
  manifest_version: 4,
  source_commit: '2db5768a70ebd53aea6c279328e2c87a9ad1aab2',
  source_short: '2db5768',
  vsix_sha256: '236d45d9ad7559e82912435e3f47bd0633e4259617e8bb2cda235a1b96875951',
  vsix_name: 'devseek-netai-2.0.32-debug.20260824.t170937.g2db5768.vsix',
  current_identity_path: 'docs/process/devseek-current-candidate-identity.json',
  current_identity_file_sha256: 'd23332ad4994a3e58ff494b491f1308a7625322d4d9e5cb61c52651981c9fe51',
  current_identity_probe_sha256: '1f1a0ff45cfcdef73dfb47bbf4915209f57e97264511f03625e99b5c6fea15d8',
  local_evidence_class: 'local-protocol-conformance',
});

export const R4_VERIFICATION_RECORD = Object.freeze({
  path: 'docs/top-agent-convergence-audit-20260711/HANDOFF-20260813-意图识别与真实用户仿真迭代.md',
  ref: 'docs/top-agent-convergence-audit-20260711/HANDOFF-20260813-意图识别与真实用户仿真迭代.md#2026-08-24-n4-最终候选-provider-authority-与原始-turn-收敛',
  commit: 'fb2db0efe4271907b28b3063e10be7a710b5aaae',
});

export const R4_REMAINING_LEAVES_AT_FREEZE = Object.freeze([]);

export const R4_CANDIDATE_VERIFICATION_RECEIPTS = Object.freeze([
  {
    receipt_id: 'shared-full-suite',
    receipt_kind: 'recorded-local-test',
    verification_scope: 'shared-full-suite',
    evidence: 'PASS; 366/366 tests',
  },
  {
    receipt_id: 'bridge-full-suite',
    receipt_kind: 'recorded-local-test',
    verification_scope: 'bridge-full-suite',
    evidence: 'PASS; 42/42 tests',
  },
  {
    receipt_id: 'cli-full-suite',
    receipt_kind: 'recorded-local-test',
    verification_scope: 'cli-full-suite',
    evidence: 'PASS; 84/84 tests',
  },
  {
    receipt_id: 'headless-full-suite',
    receipt_kind: 'recorded-local-test',
    verification_scope: 'headless-full-suite',
    evidence: 'PASS; 25/25 tests',
  },
  {
    receipt_id: 'extension-full-unit-runner',
    receipt_kind: 'recorded-local-test',
    verification_scope: 'vscode-extension-full-unit-runner',
    evidence: 'PASS; 175/175 suites',
  },
  {
    receipt_id: 'phase10-and-architecture-drift',
    receipt_kind: 'recorded-local-regression',
    verification_scope: 'phase10-and-architecture-drift',
    evidence: 'PASS; Phase 10; architecture drift 0 violation',
  },
  {
    receipt_id: 'vsix-release-loop',
    receipt_kind: 'recorded-local-install',
    verification_scope: 'package-bridge-install-and-exactly-one-runtime',
    evidence: `PASS; ${R4_ACTIVE_CANDIDATE.vsix_name}; sha256 ${R4_ACTIVE_CANDIDATE.vsix_sha256}`,
  },
  {
    receipt_id: 'real-provider-natural-ui-canary',
    receipt_kind: 'recorded-local-user-simulation',
    verification_scope: 'headed-vscode-natural-ui-real-deepseek-web',
    evidence: 'FOREGROUND PASS; 3/3 tasks; 22/22 provider requests terminal; 26 raw tool events; 3 committed mutations; replay 0; R3-09A background full-idle not observed',
  },
]);

export function assertR4ActiveCandidateIdentity({
  artifactSourceCommit,
  primaryVsix,
  packageCopyVsix,
  currentIdentity,
  currentIdentityFileSha256,
}) {
  const expected = R4_ACTIVE_CANDIDATE;
  const errors = [];
  if (artifactSourceCommit !== expected.source_commit) errors.push('artifact-source-commit-mismatch');
  if (primaryVsix.sha256 !== expected.vsix_sha256) errors.push('primary-vsix-sha256-mismatch');
  if (packageCopyVsix.sha256 !== expected.vsix_sha256) errors.push('package-copy-vsix-sha256-mismatch');
  if (currentIdentityFileSha256 !== expected.current_identity_file_sha256) {
    errors.push('current-identity-file-sha256-mismatch');
  }
  if (currentIdentity.identity_probe_sha256 !== expected.current_identity_probe_sha256
    || currentCandidateIdentityHash(currentIdentity) !== expected.current_identity_probe_sha256) {
    errors.push('current-identity-probe-sha256-mismatch');
  }
  if (currentIdentity.source_identity?.candidate_source_commit !== expected.source_commit) {
    errors.push('current-identity-candidate-source-commit-mismatch');
  }
  if (currentIdentity.artifact_identity?.primary_vsix?.sha256 !== expected.vsix_sha256
    || currentIdentity.artifact_identity?.exact_match !== true) {
    errors.push('current-identity-artifact-mismatch');
  }
  if (currentIdentity.stable_install_identity?.exact_match_artifact !== true
    || currentIdentity.active_runtime_identity?.exact_match_stable_install !== true
    || currentIdentity.counts?.active_runtime_identities !== 1
    || currentIdentity.release_state?.observe?.status !== 'passed') {
    errors.push('current-identity-install-or-runtime-mismatch');
  }
  if (currentIdentity.qualification_effect !== 'NONE'
    || currentIdentity.qualification_eligible !== false
    || currentIdentity.claims_permitted !== false
    || currentIdentity.asserts_gate_pass !== false) {
    errors.push('current-identity-qualification-boundary-invalid');
  }
  if (errors.length > 0) throw new Error(`active-candidate:${errors.join(',')}`);
}

export function buildR4ReleaseCandidateVersionLineage(predecessor) {
  return {
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
}

export function validateR4VerificationRecordSource(recordText, manifest) {
  const requiredSnippets = [
    '`2.0.32`',
    'T12',
    '366/366',
    '42/42',
    '84/84',
    '25/25',
    '175/175 suites',
    'Phase 10',
    'architecture drift',
    R4_ACTIVE_CANDIDATE.vsix_name,
    R4_ACTIVE_CANDIDATE.vsix_sha256,
    '3/3 PASS',
    'full-idle',
    manifest.source_identity.artifact_source_short,
  ];
  return requiredSnippets
    .filter(snippet => !recordText.includes(snippet))
    .map(snippet => `verification-record:missing-snippet:${snippet}`);
}
