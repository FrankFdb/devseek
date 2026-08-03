import crypto from 'node:crypto';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';

export const R4_RELEASE_CANDIDATE_MANIFEST_SCHEMA_VERSION = 'devseek.r4-release-candidate-manifest/v1';
export const R4_RELEASE_CANDIDATE_MANIFEST_ID = 'R4-RELEASE-CANDIDATE-MANIFEST/v1';
export const R4_RELEASE_CANDIDATE_INTEGRITY_SCOPE = 'local-r4-release-candidate-manifest';
export const R4_RELEASE_CANDIDATE_QUALIFICATION_EFFECT = 'NONE';

const PRIMARY_VSIX_PATH = 'devseek-netai-latest.vsix';
const PACKAGE_COPY_VSIX_PATH = 'packages/vscode-extension/devseek-netai-latest.vsix';
const CURRENT_CANDIDATE_IDENTITY_PATH = 'docs/process/devseek-current-candidate-identity.json';
const R3_HANDOFF_DOC_PATH = 'docs/top-agent-convergence-audit-20260711/archive/20-R3收尾与下一阶段任务.md';
const BRIDGE_ENTRY = 'extension/bridge/server.js';
const PACKAGE_ENTRY = 'extension/package.json';
const RECEIPT_DOC_SOURCE = 'docs/top-agent-convergence-audit-20260711/archive/20-R3收尾与下一阶段任务.md#3-本轮实现回执';

const REMAINING_R4_LEAVES = Object.freeze([
  'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME',
  'R4-LIVE-QUALIFICATION-REQUEST-PACKET',
  'R4-LIVE-USER-WAY-HOLDOUT-MATRIX',
  'R4-DOC-PROCESS-IDENTITY-RECONCILIATION',
  'R4-REAL-PROVIDER-FAILURE-TAXONOMY',
]);

export function r4ReleaseCandidateManifestHash(manifest) {
  return sha256Object(withoutKeys(manifest, ['manifest_sha256']), manifest?.integrity);
}

export function buildR4ReleaseCandidateManifest({ repoRoot } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const primaryVsix = readVsixIdentity(path.join(repoRoot, PRIMARY_VSIX_PATH), repoRoot);
  const packageCopyVsix = readVsixIdentity(path.join(repoRoot, PACKAGE_COPY_VSIX_PATH), repoRoot);
  const artifactGitCommit = primaryVsix.package_identity.devseekBuild.gitCommit;
  const artifactSourceCommit = resolveGitCommit(repoRoot, artifactGitCommit);
  const handoffDocCommit = resolveLastCommitForPath(repoRoot, R3_HANDOFF_DOC_PATH);
  const handoffDocText = readGitFile(repoRoot, handoffDocCommit, R3_HANDOFF_DOC_PATH);

  const artifactComparable = artifactComparableIdentity(primaryVsix);
  const copyComparable = artifactComparableIdentity(packageCopyVsix);
  const manifest = {
    schema_version: R4_RELEASE_CANDIDATE_MANIFEST_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    manifest_id: R4_RELEASE_CANDIDATE_MANIFEST_ID,
    manifest_version: 1,
    source_status: 'verified-local-artifact-and-recorded-smoke',
    integrity_scope: R4_RELEASE_CANDIDATE_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: R4_RELEASE_CANDIDATE_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'R4ReleaseCandidateManifest',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_identity: {
      artifact_source_commit: artifactSourceCommit,
      artifact_source_short: artifactGitCommit,
      artifact_source_resolution: 'git rev-parse <vsix.devseekBuild.gitCommit>^{commit}',
      handoff_doc_path: R3_HANDOFF_DOC_PATH,
      handoff_doc_commit: handoffDocCommit,
      handoff_doc_short: handoffDocCommit.slice(0, 7),
      handoff_doc_commit_resolution: 'git log -1 --format=%H -- <handoff_doc_path>',
      artifact_source_differs_from_handoff: artifactSourceCommit !== handoffDocCommit,
    },
    artifact_identity: {
      primary_vsix: primaryVsix,
      package_copy_vsix: packageCopyVsix,
      exact_match: canonicalJson(artifactComparable) === canonicalJson(copyComparable),
    },
    verification_receipts: buildVerificationReceipts({
      primaryVsix,
      artifactSourceCommit,
      handoffDocCommit,
    }),
    current_identity_probe_boundary: {
      path: CURRENT_CANDIDATE_IDENTITY_PATH,
      status: 'deferred-not-refreshed',
      authority_to_refresh: 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME',
      reason: 'Clean runtime identity requires separate user authorization; this manifest does not inspect live bridge processes or rewrite candidate identity artifacts.',
    },
    r4_leaf_context: {
      current_leaf: 'R4-RELEASE-CANDIDATE-MANIFEST',
      closure_effect: 'closes release candidate manifest only',
      remaining_leaves: [...REMAINING_R4_LEAVES],
    },
    counts: {
      vsix_artifacts: 2,
      verification_receipts: 6,
      remaining_r4_leaves: REMAINING_R4_LEAVES.length,
      qualification_claims: 0,
    },
    manifest_sha256: '',
  };

  validateHandoffReceiptSource(handoffDocText, manifest).forEach(error => {
    throw new Error(error);
  });
  manifest.manifest_sha256 = r4ReleaseCandidateManifestHash(manifest);
  return manifest;
}

export function validateR4ReleaseCandidateManifest(report, { repoRoot } = {}) {
  const errors = [];
  if (!isObject(report)) {
    return {
      ok: false,
      errors: ['manifest:expected-object'],
      summary: null,
    };
  }

  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildR4ReleaseCandidateManifest({ repoRoot });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(report) !== canonicalJson(expected)) {
    errors.push('manifest:expected-current-artifact-and-handoff-source-binding');
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
  const lines = [
    '# DevSeek R4 Release Candidate Manifest',
    '',
    '## 摘要',
    '',
    `- Manifest ID: \`${report.manifest_id}\``,
    `- Source status: \`${report.source_status}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${report.claims_permitted}\``,
    `- Gate assertion: \`${report.asserts_gate_pass}\``,
    `- Live/runtime/provider actions: \`${report.observation_authority.live_holdout_actions}/${report.observation_authority.runtime_process_observation}/${report.observation_authority.provider_actions}\``,
    '',
    '## 源身份边界',
    '',
    `- Artifact source commit: \`${source.artifact_source_commit}\``,
    `- Handoff doc commit: \`${source.handoff_doc_commit}\``,
    `- Artifact source differs from handoff: \`${source.artifact_source_differs_from_handoff}\``,
    `- Handoff doc path: \`${source.handoff_doc_path}\``,
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
    '| Receipt | Status | Command | Evidence |',
    '| --- | --- | --- | --- |',
    ...report.verification_receipts.map(receipt => (
      `| \`${receipt.receipt_id}\` | \`${receipt.status}\` | \`${receipt.command}\` | ${escapeTableText(receipt.evidence)} |`
    )),
    '',
    '## Current Candidate Identity 边界',
    '',
    `- Path: \`${report.current_identity_probe_boundary.path}\``,
    `- Status: \`${report.current_identity_probe_boundary.status}\``,
    `- Authority to refresh: \`${report.current_identity_probe_boundary.authority_to_refresh}\``,
    `- Reason: ${report.current_identity_probe_boundary.reason}`,
    '',
    '## R4 叶子状态',
    '',
    `- Current leaf: \`${report.r4_leaf_context.current_leaf}\``,
    `- Closure effect: \`${report.r4_leaf_context.closure_effect}\``,
    `- Remaining leaves: \`${report.r4_leaf_context.remaining_leaves.join(', ')}\``,
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
    artifact_source_commit: report.source_identity.artifact_source_commit,
    handoff_doc_commit: report.source_identity.handoff_doc_commit,
    artifact_source_differs_from_handoff: report.source_identity.artifact_source_differs_from_handoff,
    primary_vsix_sha256: report.artifact_identity.primary_vsix.sha256,
    package_copy_exact_match: report.artifact_identity.exact_match,
    verification_receipts: report.verification_receipts.length,
    current_leaf: report.r4_leaf_context.current_leaf,
    remaining_r4_leaves: report.r4_leaf_context.remaining_leaves.length,
    qualification_effect: report.qualification_effect,
    claims_permitted: report.claims_permitted,
    asserts_gate_pass: report.asserts_gate_pass,
  };
}

function buildVerificationReceipts({
  primaryVsix,
  artifactSourceCommit,
  handoffDocCommit,
}) {
  const build = primaryVsix.package_identity.devseekBuild;
  return [
    {
      receipt_id: 'r3-focused-verification',
      receipt_kind: 'recorded-local-test',
      status: 'recorded-passed',
      command: 'node --test packages/vscode-extension/test/unit/run-context.test.mjs packages/vscode-extension/test/unit/workflow-compliance.test.mjs packages/vscode-extension/test/unit/fake-tool-parser.test.mjs packages/vscode-extension/test/unit/provider-output-integrity.test.mjs packages/vscode-extension/test/unit/web-reliability.test.mjs packages/vscode-extension/test/unit/run-log-replay.test.mjs packages/vscode-extension/test/unit/agent-loop-task-state.test.mjs',
      evidence: 'tests 528/528',
      source_ref: RECEIPT_DOC_SOURCE,
      source_commit: handoffDocCommit,
      qualification_effect: 'NONE',
    },
    {
      receipt_id: 'r3-full-verification',
      receipt_kind: 'recorded-local-test',
      status: 'recorded-passed',
      command: 'npm run compile --workspace=packages/vscode-extension && npm run test --workspace=packages/vscode-extension && git diff --check -- changed runtime files',
      evidence: 'compile PASS; Suites 151/151; diff check PASS',
      source_ref: RECEIPT_DOC_SOURCE,
      source_commit: handoffDocCommit,
      qualification_effect: 'NONE',
    },
    {
      receipt_id: 'r3-package-debug',
      receipt_kind: 'recorded-local-smoke',
      status: 'recorded-passed',
      command: 'npm run extension:package:debug',
      evidence: `package devseek-netai-1.0.0-debug.20260723.t193110.ga034e5e.vsix; vsix_sha256 ${primaryVsix.sha256}`,
      source_ref: RECEIPT_DOC_SOURCE,
      source_commit: handoffDocCommit,
      qualification_effect: 'NONE',
    },
    {
      receipt_id: 'r3-packaged-bridge',
      receipt_kind: 'recorded-local-smoke',
      status: 'recorded-passed',
      command: 'npm run verify:packaged-bridge',
      evidence: `packaged bridge server SHA-256 ${primaryVsix.packaged_bridge_server_sha256}`,
      source_ref: RECEIPT_DOC_SOURCE,
      source_commit: handoffDocCommit,
      qualification_effect: 'NONE',
    },
    {
      receipt_id: 'r3-local-vsix-install',
      receipt_kind: 'recorded-local-install',
      status: 'recorded-passed',
      command: 'code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force',
      evidence: 'local VSIX install PASS',
      source_ref: RECEIPT_DOC_SOURCE,
      source_commit: handoffDocCommit,
      qualification_effect: 'NONE',
    },
    {
      receipt_id: 'r3-controlled-vsix-self-loop',
      receipt_kind: 'recorded-controlled-harness',
      status: 'recorded-passed',
      command: 'npm run test:controlled-vsix --workspace=packages/vscode-extension -- --scenario normal',
      evidence: `PASS exact-head; artifactSourceCommit=${artifactSourceCommit}; build=${build.buildId}`,
      source_ref: RECEIPT_DOC_SOURCE,
      source_commit: handoffDocCommit,
      qualification_effect: 'NONE',
    },
  ];
}

function semanticValidate(report, errors) {
  if (report.schema_version !== R4_RELEASE_CANDIDATE_MANIFEST_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (report.manifest_id !== R4_RELEASE_CANDIDATE_MANIFEST_ID) errors.push('manifest_id:invalid');
  if (report.manifest_version !== 1) errors.push('manifest_version:must-be-1');
  if (report.source_status !== 'verified-local-artifact-and-recorded-smoke') errors.push('source_status:invalid');
  if (report.integrity_scope !== R4_RELEASE_CANDIDATE_INTEGRITY_SCOPE) errors.push('integrity_scope:invalid');
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== R4_RELEASE_CANDIDATE_QUALIFICATION_EFFECT) errors.push('qualification_effect:must-be-NONE');
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
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
  if (!isFullCommit(report.source_identity?.artifact_source_commit)) {
    errors.push('source_identity.artifact_source_commit:invalid');
  }
  if (!isFullCommit(report.source_identity?.handoff_doc_commit)) {
    errors.push('source_identity.handoff_doc_commit:invalid');
  }
  if (report.source_identity?.artifact_source_differs_from_handoff !== true) {
    errors.push('source_identity.artifact_source_differs_from_handoff:must-be-true');
  }
  if (report.source_identity?.handoff_doc_path !== R3_HANDOFF_DOC_PATH) {
    errors.push('source_identity.handoff_doc_path:invalid');
  }
  if (report.artifact_identity?.exact_match !== true) {
    errors.push('artifact_identity.exact_match:must-be-true');
  }
  const primary = report.artifact_identity?.primary_vsix;
  const copy = report.artifact_identity?.package_copy_vsix;
  if (primary && copy && canonicalJson(artifactComparableIdentity(primary)) !== canonicalJson(artifactComparableIdentity(copy))) {
    errors.push('artifact_identity:primary-and-package-copy-mismatch');
  }
  if (report.current_identity_probe_boundary?.status !== 'deferred-not-refreshed') {
    errors.push('current_identity_probe_boundary.status:must-be-deferred-not-refreshed');
  }
  if (report.current_identity_probe_boundary?.authority_to_refresh !== 'R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME') {
    errors.push('current_identity_probe_boundary.authority_to_refresh:invalid');
  }
  if (report.r4_leaf_context?.current_leaf !== 'R4-RELEASE-CANDIDATE-MANIFEST') {
    errors.push('r4_leaf_context.current_leaf:invalid');
  }
  if (!Array.isArray(report.r4_leaf_context?.remaining_leaves)
    || canonicalJson(report.r4_leaf_context.remaining_leaves) !== canonicalJson([...REMAINING_R4_LEAVES])) {
    errors.push('r4_leaf_context.remaining_leaves:invalid');
  }
  if (report.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  if (report.counts?.verification_receipts !== 6) errors.push('counts.verification_receipts:must-be-6');
  if (report.counts?.remaining_r4_leaves !== REMAINING_R4_LEAVES.length) errors.push('counts.remaining_r4_leaves:invalid');
  for (const receipt of report.verification_receipts ?? []) {
    if (receipt.status !== 'recorded-passed') errors.push(`verification_receipts.${receipt.receipt_id}.status:must-be-recorded-passed`);
    if (receipt.qualification_effect !== 'NONE') errors.push(`verification_receipts.${receipt.receipt_id}.qualification_effect:must-be-NONE`);
  }
  const computedHash = r4ReleaseCandidateManifestHash(report);
  if (!/^[a-f0-9]{64}$/u.test(report.manifest_sha256 ?? '')) {
    errors.push('manifest_sha256:invalid');
  } else if (report.manifest_sha256 !== computedHash) {
    errors.push('manifest_sha256:mismatch');
  }
}

function validateHandoffReceiptSource(handoffDocText, manifest) {
  const errors = [];
  const primary = manifest.artifact_identity.primary_vsix;
  const requiredSnippets = [
    'R4-RELEASE-CANDIDATE-MANIFEST',
    manifest.source_identity.artifact_source_commit,
    primary.sha256,
    'npm run extension:package:debug',
    'npm run verify:packaged-bridge',
    'code --install-extension /home/ff/work/devseek_netai/devseek-netai-latest.vsix --force',
    'npm run test:controlled-vsix --workspace=packages/vscode-extension -- --scenario normal',
  ];
  for (const snippet of requiredSnippets) {
    if (!handoffDocText.includes(snippet)) {
      errors.push(`handoff-doc:missing-snippet:${snippet}`);
    }
  }
  return errors;
}

function readVsixIdentity(vsixPath, repoRoot) {
  const packageJson = JSON.parse(readVsixEntry(vsixPath, PACKAGE_ENTRY).toString('utf8'));
  const packageIdentity = packageIdentityFromPackageJson(packageJson);
  const bridgeBuffer = readVsixEntry(vsixPath, BRIDGE_ENTRY);
  return {
    path: path.relative(repoRoot, vsixPath),
    sha256: sha256File(vsixPath),
    package_identity: packageIdentity,
    packaged_bridge_server_sha256: sha256Buffer(bridgeBuffer),
  };
}

function readVsixEntry(vsixPath, entryPath) {
  if (!fs.existsSync(vsixPath)) throw new Error(`vsix:missing:${vsixPath}`);
  const result = cp.spawnSync('unzip', ['-p', vsixPath, entryPath], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`vsix:read-entry:${entryPath}:${String(result.stderr ?? '').trim() || result.status}`);
  }
  return result.stdout;
}

function packageIdentityFromPackageJson(packageJson) {
  const devseekBuild = packageJson?.devseekBuild ?? {};
  const identity = {
    publisher: requiredString(packageJson?.publisher, 'package.publisher'),
    name: requiredString(packageJson?.name, 'package.name'),
    version: requiredString(packageJson?.version, 'package.version'),
    devseekBuild: {
      baseVersion: requiredString(devseekBuild.baseVersion, 'package.devseekBuild.baseVersion'),
      channel: requiredString(devseekBuild.channel, 'package.devseekBuild.channel'),
      buildId: requiredString(devseekBuild.buildId, 'package.devseekBuild.buildId'),
      gitCommit: requiredString(devseekBuild.gitCommit, 'package.devseekBuild.gitCommit'),
      packagedAt: requiredString(devseekBuild.packagedAt, 'package.devseekBuild.packagedAt'),
    },
  };
  if (!/^[a-f0-9]{7,64}$/u.test(identity.devseekBuild.gitCommit)) {
    throw new Error('package.devseekBuild.gitCommit:invalid');
  }
  return identity;
}

function resolveGitCommit(repoRoot, commit) {
  return git(repoRoot, ['rev-parse', `${commit}^{commit}`]);
}

function resolveLastCommitForPath(repoRoot, relativePath) {
  return git(repoRoot, ['log', '-1', '--format=%H', '--', relativePath]);
}

function readGitFile(repoRoot, commit, relativePath) {
  return git(repoRoot, ['show', `${commit}:${relativePath}`]);
}

function git(repoRoot, args) {
  const result = cp.spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git:${args.join(' ')}:${String(result.stderr ?? '').trim() || result.status}`);
  }
  return result.stdout.trim();
}

function artifactComparableIdentity(artifact) {
  return {
    sha256: artifact?.sha256,
    package_identity: artifact?.package_identity,
    packaged_bridge_server_sha256: artifact?.packaged_bridge_server_sha256,
  };
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

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field}:required`);
  return value;
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

function isFullCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}
