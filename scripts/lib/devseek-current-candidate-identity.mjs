import crypto from 'node:crypto';
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalJson,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const CURRENT_CANDIDATE_IDENTITY_SCHEMA_VERSION = 'devseek.current-candidate-identity/v1';
export const CURRENT_CANDIDATE_IDENTITY_PROBE_ID = 'DEVSEEK-GATE0-CURRENT-CANDIDATE-IDENTITY/v1';
export const CURRENT_CANDIDATE_INTEGRITY_SCOPE = 'local-current-candidate-identity-probe';
export const CURRENT_CANDIDATE_QUALIFICATION_EFFECT = 'NONE';
export const RELEASE_STATE_SCHEMA_VERSION = 'devseek.release-state/v1';

const PRIMARY_VSIX_PATH = 'devseek-netai-latest.vsix';
const PACKAGE_COPY_VSIX_PATH = 'packages/vscode-extension/devseek-netai-latest.vsix';
const BRIDGE_ENTRY = 'extension/bridge/server.js';
const PACKAGE_ENTRY = 'extension/package.json';

export function currentCandidateIdentityHash(report) {
  return sha256Object(withoutKeys(report, ['identity_probe_sha256']), report?.integrity);
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

export function buildCurrentCandidateIdentity({
  repoRoot,
  homeDir = os.homedir(),
} = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const primaryVsix = readVsixIdentity(path.join(repoRoot, PRIMARY_VSIX_PATH), repoRoot);
  const packageCopyVsix = readVsixIdentity(path.join(repoRoot, PACKAGE_COPY_VSIX_PATH), repoRoot);
  const stableInstall = readStableInstallIdentity(homeDir, primaryVsix.package_identity);
  const artifactGitCommit = primaryVsix.package_identity.devseekBuild.gitCommit;
  const candidateSourceCommit = resolveGitCommit(repoRoot, artifactGitCommit);
  const releaseState = buildReleaseState({
    repoRoot,
    primaryVsix,
    packageCopyVsix,
    stableInstall,
  });

  const report = {
    schema_version: CURRENT_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    integrity: {
      hash_algorithm: 'sha256',
      canonicalization_version: 'devseek-canonical-json/v1',
    },
    probe_id: CURRENT_CANDIDATE_IDENTITY_PROBE_ID,
    probe_version: 1,
    source_status: 'verified',
    integrity_scope: CURRENT_CANDIDATE_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: CURRENT_CANDIDATE_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'CurrentCandidateIdentityProbe',
      caller_identity_trusted: false,
      caller_identity_effect: 'IGNORED',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_identity: {
      artifact_git_commit: artifactGitCommit,
      candidate_source_commit: candidateSourceCommit,
      commit_resolution: 'git rev-parse <artifact_git_commit>^{commit}',
      commit_resolvable: true,
    },
    artifact_identity: {
      primary_vsix: primaryVsix,
      package_copy_vsix: packageCopyVsix,
      exact_match: canonicalJson({
        sha256: primaryVsix.sha256,
        package_identity: primaryVsix.package_identity,
        packaged_bridge_server_sha256: primaryVsix.packaged_bridge_server_sha256,
      }) === canonicalJson({
        sha256: packageCopyVsix.sha256,
        package_identity: packageCopyVsix.package_identity,
        packaged_bridge_server_sha256: packageCopyVsix.packaged_bridge_server_sha256,
      }),
    },
    stable_install_identity: {
      package_root: stableInstall.package_root,
      package_json_path: stableInstall.package_json_path,
      bridge_server_path: stableInstall.bridge_server_path,
      package_identity: stableInstall.package_identity,
      installed_bridge_server_sha256: stableInstall.installed_bridge_server_sha256,
      exact_match_artifact: canonicalJson(stableInstall.package_identity) === canonicalJson(primaryVsix.package_identity)
        && stableInstall.installed_bridge_server_sha256 === primaryVsix.packaged_bridge_server_sha256,
    },
    active_runtime_identity: {
      expected_package_root: stableInstall.package_root,
      expected_bridge_server_path: stableInstall.bridge_server_path,
      expected_package_identity: stableInstall.package_identity,
      expected_bridge_server_sha256: stableInstall.installed_bridge_server_sha256,
      exact_match_stable_install: true,
      live_process_required: true,
    },
    live_runtime_policy: {
      stable_runtime_cardinality: 'exactly-one',
      isolated_controlled_vsix_runtime_allowed: true,
      stale_debug_runtime_allowed: false,
      unknown_devseek_bridge_runtime_allowed: false,
      unreadable_runtime_identity: 'fail-closed',
    },
    release_state: releaseState,
    no_secret_observation: {
      environment_variables: false,
      provider_account: false,
      tokens: false,
      full_commandline: false,
      network_or_live_holdout: false,
      observed_runtime_process_fields: ['pid', 'executable_path', 'script_path'],
    },
    counts: {
      vsix_artifacts: 2,
      stable_installed_packages: 1,
      active_runtime_identities: 1,
      qualification_claims: 0,
    },
    identity_probe_sha256: null,
  };
  report.identity_probe_sha256 = currentCandidateIdentityHash(report);
  return report;
}

export function validateCurrentCandidateIdentity(report, buildOptions = {}) {
  const errors = [];
  if (!isObject(report)) {
    return {
      ok: false,
      errors: ['identity:expected-object'],
      summary: null,
    };
  }

  semanticValidate(report, errors);

  let expected = null;
  try {
    expected = buildCurrentCandidateIdentity(buildOptions);
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(report) !== canonicalJson(expected)) {
    errors.push('identity:expected-current-source-artifact-install-runtime-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeIdentity(expected) : null,
  };
}

export function observeBridgeRuntimeProcesses({ procRoot = '/proc' } = {}) {
  const rows = [];
  let entries = [];
  try {
    entries = fs.readdirSync(procRoot, { withFileTypes: true });
  } catch {
    return rows;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9]+$/u.test(entry.name)) continue;
    const pid = Number(entry.name);
    const pidRoot = path.join(procRoot, entry.name);
    let args = [];
    try {
      args = fs.readFileSync(path.join(pidRoot, 'cmdline')).toString('utf8').split('\0').filter(Boolean);
    } catch {
      continue;
    }
    const scriptPath = args.find(argument => (
      argument.endsWith('/bridge/server.js') && argument.includes('devseek-netai')
    ));
    if (!scriptPath) continue;
    let executablePath = null;
    try {
      executablePath = fs.readlinkSync(path.join(pidRoot, 'exe'));
    } catch {
      executablePath = null;
    }
    rows.push({
      pid,
      executable_path: executablePath,
      script_path: path.normalize(scriptPath),
    });
  }

  return rows.sort((left, right) => left.pid - right.pid);
}

export function classifyBridgeRuntimeProcesses(processes, {
  stableBridgeServerPath,
  controlledExtensionDirName,
} = {}) {
  const normalizedStablePath = stableBridgeServerPath ? path.normalize(stableBridgeServerPath) : null;
  const summary = {
    stable_runtime: [],
    isolated_controlled_vsix_runtime: [],
    stale_debug_runtime: [],
    unknown_devseek_bridge_runtime: [],
    unreadable_runtime_identity: [],
  };

  for (const process of processes ?? []) {
    const safeProcess = projectRuntimeProcess(process);
    const scriptPath = safeProcess.script_path ? path.normalize(safeProcess.script_path) : null;
    if (!scriptPath || !safeProcess.executable_path) {
      summary.unreadable_runtime_identity.push(safeProcess);
    } else if (scriptPath === normalizedStablePath) {
      summary.stable_runtime.push(safeProcess);
    } else if (isControlledVsixRuntimePath(scriptPath, controlledExtensionDirName)) {
      summary.isolated_controlled_vsix_runtime.push(safeProcess);
    } else if (isStaleDebugRuntimePath(scriptPath)) {
      summary.stale_debug_runtime.push(safeProcess);
    } else if (scriptPath.includes(`${path.sep}devseek-netai.devseek-netai-`) && scriptPath.endsWith(`${path.sep}bridge${path.sep}server.js`)) {
      summary.unknown_devseek_bridge_runtime.push(safeProcess);
    } else {
      summary.unknown_devseek_bridge_runtime.push(safeProcess);
    }
  }

  return summary;
}

export function validateLiveRuntimeProcesses(report, processes = observeBridgeRuntimeProcesses()) {
  const stableBridgeServerPath = report?.active_runtime_identity?.expected_bridge_server_path;
  const controlledExtensionDirName = extensionDirectoryName(report?.active_runtime_identity?.expected_package_identity, {
    strict: false,
  });
  const classified = classifyBridgeRuntimeProcesses(processes, {
    stableBridgeServerPath,
    controlledExtensionDirName,
  });
  const errors = [];
  if (classified.stable_runtime.length !== 1) {
    errors.push(`active_runtime:stable-runtime-cardinality-expected-1-got-${classified.stable_runtime.length}`);
  }
  if (classified.stale_debug_runtime.length !== 0) {
    errors.push(`active_runtime:stale-debug-runtime-active-${classified.stale_debug_runtime.length}`);
  }
  if (classified.unknown_devseek_bridge_runtime.length !== 0) {
    errors.push(`active_runtime:unknown-devseek-bridge-runtime-${classified.unknown_devseek_bridge_runtime.length}`);
  }
  if (classified.unreadable_runtime_identity.length !== 0) {
    errors.push(`active_runtime:unreadable-runtime-identity-${classified.unreadable_runtime_identity.length}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    summary: summarizeRuntimeProcesses(classified),
  };
}

export function renderCurrentCandidateIdentityMarkdown(report) {
  const lines = [
    '# DevSeek Current Candidate Identity Probe',
    '',
    `- Probe ID: \`${report.probe_id}\``,
    `- Source status: \`${report.source_status}\``,
    `- Qualification effect: \`${report.qualification_effect}\``,
    `- Claims permitted: \`${report.claims_permitted}\``,
    `- Gate assertion: \`${report.asserts_gate_pass}\``,
    `- Caller identity trusted: \`${report.observation_authority.caller_identity_trusted}\``,
    `- Secret observation: \`${report.observation_authority.secret_observation}\``,
    '',
    '## Source',
    '',
    `- Artifact git commit: \`${report.source_identity.artifact_git_commit}\``,
    `- Candidate source commit: \`${report.source_identity.candidate_source_commit}\``,
    '',
    '## VSIX Artifacts',
    '',
    '| Artifact | SHA-256 | Build | Git commit | Bridge SHA-256 |',
    '| --- | --- | --- | --- | --- |',
    artifactRow('primary', report.artifact_identity.primary_vsix),
    artifactRow('package-copy', report.artifact_identity.package_copy_vsix),
    '',
    '## Stable Install And Runtime',
    '',
    `- Stable package root: \`${report.stable_install_identity.package_root}\``,
    `- Stable bridge path: \`${report.stable_install_identity.bridge_server_path}\``,
    `- Active runtime expected bridge: \`${report.active_runtime_identity.expected_bridge_server_path}\``,
    `- Package/install/runtime exact match: \`${report.artifact_identity.exact_match && report.stable_install_identity.exact_match_artifact && report.active_runtime_identity.exact_match_stable_install}\``,
    '',
    '## Release State',
    '',
    `- State: \`${report.release_state.state}\``,
    `- Deploy: \`${report.release_state.deploy.status}\``,
    `- Production deploy authorized: \`${report.release_state.deploy.production_deploy_authorized}\``,
    `- Smoke: \`${report.release_state.smoke.status}\``,
    `- Observe: \`${report.release_state.observe.status}\``,
    `- Rollback: \`${report.release_state.rollback.status}\` -> \`${report.release_state.rollback.target_artifact.path}\``,
    `- Mixed kernel detected: \`${report.release_state.mixed_kernel.detected}\``,
    '',
    '## Runtime Process Policy',
    '',
    `- Stable runtime cardinality: \`${report.live_runtime_policy.stable_runtime_cardinality}\``,
    `- Isolated controlled VSIX runtime allowed: \`${report.live_runtime_policy.isolated_controlled_vsix_runtime_allowed}\``,
    `- Stale debug runtime allowed: \`${report.live_runtime_policy.stale_debug_runtime_allowed}\``,
    `- Unknown DevSeek Bridge runtime allowed: \`${report.live_runtime_policy.unknown_devseek_bridge_runtime_allowed}\``,
    `- Unreadable runtime identity: \`${report.live_runtime_policy.unreadable_runtime_identity}\``,
    '',
    '## Probe Identity',
    '',
    `- Identity probe SHA-256: \`${report.identity_probe_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
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

function buildReleaseState({
  repoRoot,
  primaryVsix,
  packageCopyVsix,
  stableInstall,
}) {
  const currentArtifact = releaseArtifactSummary(primaryVsix);
  const rollbackTarget = findPreviousCompleteArtifact(repoRoot, primaryVsix.sha256);
  return {
    version: RELEASE_STATE_SCHEMA_VERSION,
    state: 'observed-local-install',
    current_artifact: currentArtifact,
    deploy: {
      status: 'installed-local',
      production_deploy_authorized: false,
      evidenceRefs: ['stable-install:exact-match-artifact'],
      reason: 'local VSIX install observed; production deploy not authorized',
    },
    smoke: {
      status: releaseSmokePassed({ primaryVsix, packageCopyVsix, stableInstall }) ? 'passed' : 'failed',
      evidenceRefs: [
        'artifact:primary-package-copy-exact-match',
        'packaged-bridge:server-js-present',
        'stable-install:bridge-exact-match',
      ],
    },
    observe: {
      status: releaseObservePassed(stableInstall) ? 'passed' : 'failed',
      evidenceRefs: [
        'runtime-policy:stable-runtime-cardinality-exactly-one',
        'runtime-policy:stale-debug-runtime-disallowed',
      ],
    },
    rollback: {
      status: rollbackTarget ? 'available' : 'not-available',
      target_artifact: rollbackTarget,
      evidenceRefs: rollbackTarget ? ['rollback:previous-complete-artifact'] : [],
      reason: rollbackTarget
        ? 'previous complete VSIX artifact retained locally'
        : 'no previous complete VSIX artifact retained locally',
    },
    mixed_kernel: {
      allowed: false,
      detected: false,
      evidenceRefs: [
        'artifact:primary-package-copy-exact-match',
        'stable-install:exact-match-artifact',
        'active-runtime:exact-match-stable-install',
      ],
    },
  };
}

function releaseSmokePassed({
  primaryVsix,
  packageCopyVsix,
  stableInstall,
}) {
  return canonicalJson(artifactComparableIdentity(primaryVsix)) === canonicalJson(artifactComparableIdentity(packageCopyVsix))
    && canonicalJson(stableInstall.package_identity) === canonicalJson(primaryVsix.package_identity)
    && stableInstall.installed_bridge_server_sha256 === primaryVsix.packaged_bridge_server_sha256;
}

function releaseObservePassed(stableInstall) {
  const classified = classifyBridgeRuntimeProcesses(observeBridgeRuntimeProcesses(), {
    stableBridgeServerPath: stableInstall.bridge_server_path,
    controlledExtensionDirName: extensionDirectoryName(stableInstall.package_identity, { strict: false }),
  });
  return classified.stable_runtime.length === 1
    && classified.stale_debug_runtime.length === 0
    && classified.unknown_devseek_bridge_runtime.length === 0
    && classified.unreadable_runtime_identity.length === 0;
}

function findPreviousCompleteArtifact(repoRoot, currentSha256) {
  const candidates = fs.readdirSync(repoRoot, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => /^devseek-netai-1\.0\.0-debug\..+\.vsix$/u.test(name))
    .sort((left, right) => right.localeCompare(left));

  for (const candidate of candidates) {
    const candidatePath = path.join(repoRoot, candidate);
    let identity = null;
    try {
      identity = readVsixIdentity(candidatePath, repoRoot);
    } catch {
      continue;
    }
    if (identity.sha256 !== currentSha256) return releaseArtifactSummary(identity);
  }

  return null;
}

function releaseArtifactSummary(vsixIdentity) {
  return {
    path: vsixIdentity.path,
    sha256: vsixIdentity.sha256,
    build_id: vsixIdentity.package_identity.devseekBuild.buildId,
    git_commit: vsixIdentity.package_identity.devseekBuild.gitCommit,
    packaged_bridge_server_sha256: vsixIdentity.packaged_bridge_server_sha256,
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

function readStableInstallIdentity(homeDir, expectedPackageIdentity) {
  const packageRoot = path.join(homeDir, '.vscode', 'extensions', extensionDirectoryName(expectedPackageIdentity));
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const bridgeServerPath = path.join(packageRoot, 'bridge', 'server.js');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return {
    package_root: packageRoot,
    package_json_path: packageJsonPath,
    bridge_server_path: bridgeServerPath,
    package_identity: packageIdentityFromPackageJson(packageJson),
    installed_bridge_server_sha256: sha256File(bridgeServerPath),
  };
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

function semanticValidate(report, errors) {
  if (report.schema_version !== CURRENT_CANDIDATE_IDENTITY_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (report.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (report.qualification_effect !== CURRENT_CANDIDATE_QUALIFICATION_EFFECT) errors.push('qualification_effect:must-be-NONE');
  if (report.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (report.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (report.observation_authority?.caller_identity_trusted !== false) {
    errors.push('observation_authority.caller_identity_trusted:must-be-false');
  }
  if (report.observation_authority?.caller_identity_effect !== 'IGNORED') {
    errors.push('observation_authority.caller_identity_effect:must-be-IGNORED');
  }
  if (report.observation_authority?.writes_product_state !== false) {
    errors.push('observation_authority.writes_product_state:must-be-false');
  }
  if (report.observation_authority?.secret_observation !== 'FORBIDDEN') {
    errors.push('observation_authority.secret_observation:must-be-FORBIDDEN');
  }
  if (!report.source_identity?.artifact_git_commit) {
    errors.push('source_identity.artifact_git_commit:required');
  }
  if (!report.source_identity?.candidate_source_commit) {
    errors.push('source_identity.candidate_source_commit:required');
  }
  const primary = report.artifact_identity?.primary_vsix;
  const copy = report.artifact_identity?.package_copy_vsix;
  if (!primary?.package_identity?.devseekBuild?.gitCommit) {
    errors.push('artifact_identity.primary_vsix.package_identity.devseekBuild.gitCommit:required');
  }
  if (!copy?.package_identity?.devseekBuild?.gitCommit) {
    errors.push('artifact_identity.package_copy_vsix.package_identity.devseekBuild.gitCommit:required');
  }
  if (primary && copy && canonicalJson(artifactComparableIdentity(primary)) !== canonicalJson(artifactComparableIdentity(copy))) {
    errors.push('artifact_identity:primary-and-package-copy-mismatch');
  }
  if (report.artifact_identity?.exact_match !== true) {
    errors.push('artifact_identity.exact_match:must-be-true');
  }
  if (report.stable_install_identity?.exact_match_artifact !== true) {
    errors.push('stable_install_identity.exact_match_artifact:must-be-true');
  }
  if (report.active_runtime_identity?.exact_match_stable_install !== true) {
    errors.push('active_runtime_identity.exact_match_stable_install:must-be-true');
  }
  if (report.active_runtime_identity?.live_process_required !== true) {
    errors.push('active_runtime_identity.live_process_required:must-be-true');
  }
  if (report.active_runtime_identity?.expected_bridge_server_path !== report.stable_install_identity?.bridge_server_path) {
    errors.push('active_runtime_identity.expected_bridge_server_path:must-match-stable-install');
  }
  if (report.active_runtime_identity?.expected_bridge_server_sha256 !== report.stable_install_identity?.installed_bridge_server_sha256) {
    errors.push('active_runtime_identity.expected_bridge_server_sha256:must-match-stable-install');
  }
  if (report.live_runtime_policy?.stable_runtime_cardinality !== 'exactly-one') {
    errors.push('live_runtime_policy.stable_runtime_cardinality:must-be-exactly-one');
  }
  if (report.live_runtime_policy?.stale_debug_runtime_allowed !== false) {
    errors.push('live_runtime_policy.stale_debug_runtime_allowed:must-be-false');
  }
  if (report.live_runtime_policy?.unknown_devseek_bridge_runtime_allowed !== false) {
    errors.push('live_runtime_policy.unknown_devseek_bridge_runtime_allowed:must-be-false');
  }
  validateReleaseState(report, errors);
  if (report.no_secret_observation?.environment_variables !== false
    || report.no_secret_observation?.tokens !== false
    || report.no_secret_observation?.full_commandline !== false
    || report.no_secret_observation?.network_or_live_holdout !== false) {
    errors.push('no_secret_observation:forbidden-field-observed');
  }
  const computedHash = currentCandidateIdentityHash(report);
  if (!/^[a-f0-9]{64}$/u.test(report.identity_probe_sha256 ?? '')) {
    errors.push('identity_probe_sha256:invalid');
  } else if (report.identity_probe_sha256 !== computedHash) {
    errors.push('identity_probe_sha256:mismatch');
  }
}

function validateReleaseState(report, errors) {
  const releaseState = report.release_state;
  if (!isObject(releaseState)) {
    errors.push('release_state:required');
    return;
  }
  if (releaseState.version !== RELEASE_STATE_SCHEMA_VERSION) {
    errors.push('release_state.version:invalid');
  }
  if (releaseState.state !== 'observed-local-install') {
    errors.push('release_state.state:must-be-observed-local-install');
  }
  const currentArtifact = releaseState.current_artifact;
  const primary = report.artifact_identity?.primary_vsix;
  if (!isObject(currentArtifact)) {
    errors.push('release_state.current_artifact:required');
  } else {
    if (currentArtifact.sha256 !== primary?.sha256) {
      errors.push('release_state.current_artifact.sha256:must-match-primary-vsix');
    }
    if (currentArtifact.git_commit !== primary?.package_identity?.devseekBuild?.gitCommit) {
      errors.push('release_state.current_artifact.git_commit:must-match-primary-vsix');
    }
    if (currentArtifact.packaged_bridge_server_sha256 !== primary?.packaged_bridge_server_sha256) {
      errors.push('release_state.current_artifact.packaged_bridge_server_sha256:must-match-primary-vsix');
    }
  }
  if (releaseState.deploy?.status !== 'installed-local') {
    errors.push('release_state.deploy.status:must-be-installed-local');
  }
  if (releaseState.deploy?.production_deploy_authorized !== false) {
    errors.push('release_state.deploy.production_deploy_authorized:must-be-false');
  }
  if (!hasEvidenceRefs(releaseState.deploy)) {
    errors.push('release_state.deploy.evidenceRefs:required');
  }
  if (releaseState.smoke?.status !== 'passed') {
    errors.push('release_state.smoke.status:must-be-passed');
  }
  if (!hasEvidenceRefs(releaseState.smoke)) {
    errors.push('release_state.smoke.evidenceRefs:required');
  }
  if (releaseState.observe?.status !== 'passed') {
    errors.push('release_state.observe.status:must-be-passed');
  }
  if (!hasEvidenceRefs(releaseState.observe)) {
    errors.push('release_state.observe.evidenceRefs:required');
  }
  if (releaseState.rollback?.status !== 'available') {
    errors.push('release_state.rollback.status:must-be-available');
  }
  if (!isObject(releaseState.rollback?.target_artifact)) {
    errors.push('release_state.rollback.target_artifact:required');
  } else if (releaseState.rollback.target_artifact.sha256 === currentArtifact?.sha256) {
    errors.push('release_state.rollback.target_artifact.sha256:must-differ-from-current');
  }
  if (!hasEvidenceRefs(releaseState.rollback)) {
    errors.push('release_state.rollback.evidenceRefs:required');
  }
  if (releaseState.mixed_kernel?.allowed !== false) {
    errors.push('release_state.mixed_kernel.allowed:must-be-false');
  }
  if (releaseState.mixed_kernel?.detected !== false) {
    errors.push('release_state.mixed_kernel.detected:must-be-false');
  }
  if (!hasEvidenceRefs(releaseState.mixed_kernel)) {
    errors.push('release_state.mixed_kernel.evidenceRefs:required');
  }
}

function resolveGitCommit(repoRoot, commit) {
  const result = cp.spawnSync('git', ['rev-parse', `${commit}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git:rev-parse:${commit}:${result.stderr.trim() || result.status}`);
  }
  return result.stdout.trim();
}

function summarizeIdentity(report) {
  return {
    artifact_git_commit: report.source_identity.artifact_git_commit,
    candidate_source_commit: report.source_identity.candidate_source_commit,
    vsix_sha256: report.artifact_identity.primary_vsix.sha256,
    build_id: report.artifact_identity.primary_vsix.package_identity.devseekBuild.buildId,
    build_git_commit: report.artifact_identity.primary_vsix.package_identity.devseekBuild.gitCommit,
    stable_install_package_root: report.stable_install_identity.package_root,
    active_runtime_expected_bridge_path: report.active_runtime_identity.expected_bridge_server_path,
    release_state: report.release_state.state,
    rollback_status: report.release_state.rollback.status,
    rollback_target_artifact: report.release_state.rollback.target_artifact?.path ?? null,
    mixed_kernel_detected: report.release_state.mixed_kernel.detected,
    qualification_effect: report.qualification_effect,
    claims_permitted: report.claims_permitted,
    asserts_gate_pass: report.asserts_gate_pass,
  };
}

function summarizeRuntimeProcesses(classified) {
  return {
    stable_runtime_count: classified.stable_runtime.length,
    isolated_controlled_vsix_runtime_count: classified.isolated_controlled_vsix_runtime.length,
    stale_debug_runtime_count: classified.stale_debug_runtime.length,
    unknown_devseek_bridge_runtime_count: classified.unknown_devseek_bridge_runtime.length,
    unreadable_runtime_identity_count: classified.unreadable_runtime_identity.length,
    stable_runtime: classified.stable_runtime,
    isolated_controlled_vsix_runtime: classified.isolated_controlled_vsix_runtime,
    stale_debug_runtime: classified.stale_debug_runtime,
    unknown_devseek_bridge_runtime: classified.unknown_devseek_bridge_runtime,
  };
}

function projectRuntimeProcess(process) {
  return {
    pid: Number.isFinite(Number(process?.pid)) ? Number(process.pid) : null,
    executable_path: process?.executable_path ?? null,
    script_path: process?.script_path ? path.normalize(process.script_path) : null,
  };
}

function artifactRow(label, artifact) {
  const build = artifact.package_identity.devseekBuild;
  return `| ${label}: \`${artifact.path}\` | \`${artifact.sha256}\` | \`${build.buildId}\` | \`${build.gitCommit}\` | \`${artifact.packaged_bridge_server_sha256}\` |`;
}

function artifactComparableIdentity(artifact) {
  return {
    sha256: artifact.sha256,
    package_identity: artifact.package_identity,
    packaged_bridge_server_sha256: artifact.packaged_bridge_server_sha256,
  };
}

function hasEvidenceRefs(value) {
  return Array.isArray(value?.evidenceRefs)
    && value.evidenceRefs.length > 0
    && value.evidenceRefs.every(ref => typeof ref === 'string' && ref.length > 0);
}

function isStaleDebugRuntimePath(scriptPath) {
  return scriptPath.includes(`${path.sep}devseek-netai-1.0.0-debug.`)
    || scriptPath.includes(`${path.sep}devseek-netai.devseek-netai-1.0.0-debug.`);
}

function isControlledVsixRuntimePath(scriptPath, controlledExtensionDirName) {
  if (!controlledExtensionDirName) return false;
  return scriptPath.includes(`${path.sep}devseek-controlled-vsix-`)
    && scriptPath.endsWith(`${path.sep}extensions${path.sep}${controlledExtensionDirName}${path.sep}bridge${path.sep}server.js`);
}

function extensionDirectoryName(packageIdentity, { strict = true } = {}) {
  const publisher = packageIdentity?.publisher;
  const name = packageIdentity?.name;
  const version = packageIdentity?.version;
  if ([publisher, name, version].some(value => typeof value !== 'string' || value.length === 0)) {
    if (!strict) return null;
    requiredString(publisher, 'package.publisher');
    requiredString(name, 'package.name');
    requiredString(version, 'package.version');
  }
  return `${publisher}.${name}-${version}`;
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
