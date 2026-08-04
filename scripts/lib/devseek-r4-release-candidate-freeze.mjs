import { currentCandidateIdentityHash } from './devseek-current-candidate-identity.mjs';

export const R4_FROZEN_CANDIDATE = Object.freeze({
  source_commit: '4f8a56797090079914b4d921b56d9c34fe4d2abc',
  source_short: '4f8a567',
  vsix_sha256: '68b360307e4104909829d9e6f921757520f535cf79a33eff77f4b69590849ecc',
  vsix_name: 'devseek-netai-1.0.0-debug.20260804.t093020.g4f8a567.vsix',
  current_identity_path: 'docs/process/devseek-current-candidate-identity.json',
  current_identity_file_sha256: '80a68b5207f65625458b18320c15e1b89514125d7e77d1b3f7f2928c585b294e',
  current_identity_probe_sha256: 'c629bfa4bdf1c7a1843a34e6c5e1277c6260dc5829072510c933b5a14664eafd',
});

export const R4_VERIFICATION_RECORD = Object.freeze({
  path: 'docs/top-agent-convergence-audit-20260711/README.md',
  ref: 'docs/top-agent-convergence-audit-20260711/README.md#5-本轮验证记录',
  commit: '8f30f1b79285c2e2141cbbcacf69b30969487768',
});

export const R4_REMAINING_LEAVES_AT_FREEZE = Object.freeze([
  'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME',
]);

export const R4_CANDIDATE_VERIFICATION_RECEIPTS = Object.freeze([
  {
    receipt_id: 'extension-full-unit-runner',
    receipt_kind: 'recorded-local-test',
    verification_scope: 'vscode-extension-full-unit-runner',
    evidence: 'PASS; 158/158 suites',
  },
  {
    receipt_id: 'intent-routing-focused-matrix',
    receipt_kind: 'recorded-local-test',
    verification_scope: 'intent-routing-focused-matrix',
    evidence: 'PASS; 524/524 tests',
  },
  {
    receipt_id: 'natural-intent-ui-corpus',
    receipt_kind: 'recorded-local-user-simulation',
    verification_scope: 'natural-intent-ui-corpus',
    evidence: 'PASS; 48/48 scenarios',
  },
  {
    receipt_id: 'architecture-static-suites',
    receipt_kind: 'recorded-local-test',
    verification_scope: 'affected-architecture-static-suites',
    evidence: 'PASS; 325/325 tests',
  },
  {
    receipt_id: 'vsix-release-loop',
    receipt_kind: 'recorded-local-install',
    verification_scope: 'package-bridge-install-and-exactly-one-runtime',
    evidence: `PASS; ${R4_FROZEN_CANDIDATE.vsix_name}; sha256 ${R4_FROZEN_CANDIDATE.vsix_sha256}`,
  },
  {
    receipt_id: 'phase0-12-local-regression',
    receipt_kind: 'recorded-local-regression',
    verification_scope: 'phase0-12-deterministic-and-local-gates',
    evidence: 'PASS; 32/32; Gate 0 remains NOT_PASSED',
  },
]);

export function assertR4FrozenCandidateIdentity({
  artifactSourceCommit,
  primaryVsix,
  packageCopyVsix,
  currentIdentity,
  currentIdentityFileSha256,
}) {
  const expected = R4_FROZEN_CANDIDATE;
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
    || currentIdentity.claims_permitted !== false
    || currentIdentity.asserts_gate_pass !== false) {
    errors.push('current-identity-qualification-boundary-invalid');
  }
  if (errors.length > 0) throw new Error(`frozen-candidate:${errors.join(',')}`);
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
    '当前 Extension 行为候选：`4f8a567`',
    '158/158',
    '524/524',
    '48/48',
    '325/325',
    manifest.artifact_identity.primary_vsix.package_identity.version,
    R4_FROZEN_CANDIDATE.vsix_sha256,
    '32/32',
    'Gate 0 仍为 `NOT_PASSED`',
    manifest.source_identity.artifact_source_short,
  ];
  return requiredSnippets
    .filter(snippet => !recordText.includes(snippet))
    .map(snippet => `verification-record:missing-snippet:${snippet}`);
}
