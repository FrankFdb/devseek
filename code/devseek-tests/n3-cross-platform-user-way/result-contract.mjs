import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RESULT_SCHEMA_VERSION = 'devseek.cross-platform-user-way-result/v1';

const TEXT_EVIDENCE_EXTENSIONS = new Set(['.json', '.log', '.md', '.tap', '.txt']);
const FORBIDDEN_EVIDENCE_PATTERNS = [
  /DEVSEEK_BRIDGE_TOKEN\s*[:=]/i,
  /authorization\s*:\s*bearer\s+\S+/i,
  /(?:api[_-]?key|access[_-]?token|session[_-]?cookie)\s*[:=]\s*\S+/i,
  /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/,
];

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function packetSha256(packetPath) {
  return sha256Bytes(fs.readFileSync(packetPath));
}

export function buildResultTemplate(packet, packetHash, platformProfile, runId) {
  const profile = findPlatformProfile(packet, platformProfile);
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    packet_id: packet.packet_id,
    packet_sha256: packetHash,
    run_id: runId,
    platform_profile: profile.profile_id,
    candidate: structuredClone(packet.candidate),
    tester: {
      tester_id: '',
      organization: '',
      implementation_contributor: false,
      saw_implementation_or_hidden_oracles_before_execution: false,
      case_order_preserved: true,
      selective_rerun_performed: false,
      consent_to_share_redacted_evidence: false,
    },
    environment: {
      os: profile.os,
      architecture: profile.architecture,
      host_kind: profile.host_kind,
      os_version: '',
      vscode_version: '',
      vscode_commit: '',
      shell: '',
      node_version: '',
      workspace_path: '',
      extension_version: packet.candidate.extension_version,
      vsix_sha256: packet.candidate.vsix_sha256,
    },
    started_at: '',
    completed_at: '',
    case_results: packet.cases.map(testCase => ({
      case_id: testCase.case_id,
      status: 'NOT_RUN',
      started_at: '',
      completed_at: '',
      observations: '',
      blocker: '',
      evidence: testCase.required_evidence_kinds.map(kind => ({
        kind,
        path: '',
        sha256: '',
      })),
    })),
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  };
}

export function sealEvidenceHashes(result, resultPath) {
  const sealed = structuredClone(result);
  const errors = [];
  for (const caseResult of sealed.case_results ?? []) {
    for (const evidence of caseResult.evidence ?? []) {
      const resolved = resolveEvidencePath(resultPath, evidence.path, errors, caseResult.case_id, evidence.kind);
      if (!resolved) continue;
      evidence.sha256 = sha256Bytes(fs.readFileSync(resolved));
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return sealed;
}

export function verifyResult({ packet, packetHash, result, resultPath, validateSchema }) {
  const errors = [];
  if (!validateSchema(result)) {
    errors.push(...(validateSchema.errors ?? []).map(error => (
      `schema:${error.instancePath || '/'}:${error.message}`
    )));
  }

  if (result?.packet_id !== packet.packet_id) errors.push('packet_id:mismatch');
  if (result?.packet_sha256 !== packetHash) errors.push('packet_sha256:mismatch');
  if (JSON.stringify(result?.candidate) !== JSON.stringify(packet.candidate)) errors.push('candidate:mismatch');

  let profile;
  try {
    profile = findPlatformProfile(packet, result?.platform_profile);
  } catch (error) {
    errors.push(`platform_profile:${error.message}`);
  }
  if (profile) {
    for (const field of ['os', 'architecture', 'host_kind']) {
      if (result?.environment?.[field] !== profile[field]) errors.push(`environment.${field}:profile-mismatch`);
    }
  }
  if (result?.environment?.extension_version !== packet.candidate.extension_version) {
    errors.push('environment.extension_version:candidate-mismatch');
  }
  if (result?.environment?.vsix_sha256 !== packet.candidate.vsix_sha256) {
    errors.push('environment.vsix_sha256:candidate-mismatch');
  }
  if (!isCompatibleVSCodeVersion(result?.environment?.vscode_version)) {
    errors.push('environment.vscode_version:below-1.85');
  }

  validateTester(result?.tester, errors);
  validateTimeWindow(result?.started_at, result?.completed_at, 'run', errors);
  validateCaseResults({ packet, result, resultPath, errors });

  return {
    ok: errors.length === 0,
    accepted: errors.length === 0,
    summary: {
      packet_id: packet.packet_id,
      packet_sha256: packetHash,
      run_id: result?.run_id ?? null,
      platform_profile: result?.platform_profile ?? null,
      required_cases: packet.cases.length,
      passed_cases: (result?.case_results ?? []).filter(item => item.status === 'PASS').length,
      failed_cases: (result?.case_results ?? []).filter(item => item.status === 'FAIL').length,
      blocked_cases: (result?.case_results ?? []).filter(item => item.status === 'BLOCKED').length,
      not_run_cases: (result?.case_results ?? []).filter(item => item.status === 'NOT_RUN').length,
      qualification_effect: 'NONE',
      claims_permitted: false,
      asserts_gate_pass: false,
    },
    errors,
  };
}

export function verifyResultMatrix(packet, entries) {
  const errors = [];
  const byProfile = new Map();
  for (const entry of entries) {
    const profile = entry.verification?.summary?.platform_profile;
    if (!profile) {
      errors.push(`matrix:result-profile-missing:${entry.resultPath}`);
      continue;
    }
    if (byProfile.has(profile)) errors.push(`matrix:duplicate-profile:${profile}`);
    byProfile.set(profile, entry);
    if (entry.verification.accepted !== true) errors.push(`matrix:result-rejected:${profile}`);
  }
  const requiredProfiles = packet.platform_profiles
    .filter(profile => profile.required_for_n3)
    .map(profile => profile.profile_id);
  for (const profileId of requiredProfiles) {
    if (!byProfile.has(profileId)) errors.push(`matrix:required-profile-missing:${profileId}`);
  }
  return {
    ok: errors.length === 0,
    accepted: errors.length === 0,
    summary: {
      packet_id: packet.packet_id,
      required_profiles: requiredProfiles,
      observed_profiles: [...byProfile.keys()].sort(),
      accepted_profiles: entries
        .filter(entry => entry.verification.accepted)
        .map(entry => entry.verification.summary.platform_profile)
        .sort(),
      rejected_profiles: entries
        .filter(entry => !entry.verification.accepted)
        .map(entry => entry.verification.summary.platform_profile)
        .filter(Boolean)
        .sort(),
      qualification_effect: 'NONE',
      claims_permitted: false,
      asserts_gate_pass: false,
    },
    results: entries.map(entry => ({
      result_path: entry.resultPath,
      accepted: entry.verification.accepted,
      summary: entry.verification.summary,
      errors: entry.verification.errors,
    })),
    errors,
  };
}

export function validatePacket(packet) {
  const errors = [];
  if (packet?.schema_version !== 'devseek.cross-platform-user-way-test-packet/v1') {
    errors.push('schema_version:unexpected');
  }
  if (packet?.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-none');
  if (packet?.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (packet?.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (!Array.isArray(packet?.platform_profiles) || packet.platform_profiles.length === 0) {
    errors.push('platform_profiles:missing');
  }
  if (!Array.isArray(packet?.cases) || packet.cases.length === 0) errors.push('cases:missing');
  assertUniqueValues(packet?.platform_profiles ?? [], 'profile_id', 'platform_profiles', errors);
  assertUniqueValues(packet?.cases ?? [], 'case_id', 'cases', errors);
  const allowedKinds = new Set(packet?.evidence_policy?.allowed_kinds ?? []);
  for (const testCase of packet?.cases ?? []) {
    if (!Array.isArray(testCase.required_evidence_kinds) || testCase.required_evidence_kinds.length === 0) {
      errors.push(`case:${testCase.case_id}:required-evidence-missing`);
      continue;
    }
    for (const kind of testCase.required_evidence_kinds) {
      if (!allowedKinds.has(kind)) errors.push(`case:${testCase.case_id}:evidence-kind-not-allowed:${kind}`);
    }
  }
  return errors;
}

function findPlatformProfile(packet, profileId) {
  const profile = packet.platform_profiles.find(item => item.profile_id === profileId);
  if (!profile) throw new Error(`unknown profile ${String(profileId)}`);
  return profile;
}

function validateTester(tester, errors) {
  if (!tester || typeof tester !== 'object') return;
  if (tester.implementation_contributor !== false) errors.push('tester:implementation-contributor');
  if (tester.saw_implementation_or_hidden_oracles_before_execution !== false) {
    errors.push('tester:implementation-or-hidden-oracle-exposure');
  }
  if (tester.case_order_preserved !== true) errors.push('tester:case-order-not-preserved');
  if (tester.selective_rerun_performed !== false) errors.push('tester:selective-rerun');
  if (tester.consent_to_share_redacted_evidence !== true) errors.push('tester:evidence-sharing-not-consented');
}

function validateTimeWindow(start, end, prefix, errors) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs)) errors.push(`${prefix}.started_at:invalid`);
  if (!Number.isFinite(endMs)) errors.push(`${prefix}.completed_at:invalid`);
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs < startMs) {
    errors.push(`${prefix}:time-order-invalid`);
  }
}

function validateCaseResults({ packet, result, resultPath, errors }) {
  const caseResults = Array.isArray(result?.case_results) ? result.case_results : [];
  const expectedIds = packet.cases.map(item => item.case_id);
  const observedIds = caseResults.map(item => item.case_id);
  if (JSON.stringify(observedIds) !== JSON.stringify(expectedIds)) errors.push('case_results:identity-or-order-mismatch');

  const usedEvidencePaths = new Set();
  const runStartMs = Date.parse(result?.started_at);
  const runEndMs = Date.parse(result?.completed_at);
  let previousCaseEndMs = runStartMs;
  for (const [index, testCase] of packet.cases.entries()) {
    const caseResult = caseResults[index];
    if (!caseResult || caseResult.case_id !== testCase.case_id) continue;
    if (caseResult.status !== 'PASS') errors.push(`case:${testCase.case_id}:status-${caseResult.status ?? 'missing'}`);
    if (!String(caseResult.observations ?? '').trim()) errors.push(`case:${testCase.case_id}:observations-missing`);
    validateTimeWindow(caseResult.started_at, caseResult.completed_at, `case:${testCase.case_id}`, errors);
    const caseStartMs = Date.parse(caseResult.started_at);
    const caseEndMs = Date.parse(caseResult.completed_at);
    if (Number.isFinite(caseStartMs) && Number.isFinite(previousCaseEndMs) && caseStartMs < previousCaseEndMs) {
      errors.push(`case:${testCase.case_id}:sequence-overlap`);
    }
    if (Number.isFinite(caseStartMs) && Number.isFinite(runStartMs) && caseStartMs < runStartMs) {
      errors.push(`case:${testCase.case_id}:starts-before-run`);
    }
    if (Number.isFinite(caseEndMs) && Number.isFinite(runEndMs) && caseEndMs > runEndMs) {
      errors.push(`case:${testCase.case_id}:ends-after-run`);
    }
    if (Number.isFinite(caseEndMs)) previousCaseEndMs = caseEndMs;

    const evidence = Array.isArray(caseResult.evidence) ? caseResult.evidence : [];
    const kinds = new Set(evidence.map(item => item.kind));
    if (kinds.size !== evidence.length) errors.push(`case:${testCase.case_id}:evidence-kind-duplicate`);
    for (const requiredKind of testCase.required_evidence_kinds) {
      if (!kinds.has(requiredKind)) errors.push(`case:${testCase.case_id}:evidence-kind-missing:${requiredKind}`);
    }
    for (const item of evidence) {
      if (!(packet.evidence_policy.allowed_kinds ?? []).includes(item.kind)) {
        errors.push(`case:${testCase.case_id}:evidence-kind-forbidden:${item.kind}`);
      }
      const normalizedPath = String(item.path ?? '').replaceAll('\\', '/');
      if (normalizedPath) {
        if (usedEvidencePaths.has(normalizedPath)) errors.push(`evidence:path-reused:${normalizedPath}`);
        usedEvidencePaths.add(normalizedPath);
      }
      const resolved = resolveEvidencePath(resultPath, item.path, errors, testCase.case_id, item.kind);
      if (!resolved) continue;
      const observedHash = sha256Bytes(fs.readFileSync(resolved));
      if (item.sha256 !== observedHash) errors.push(`evidence:sha256-mismatch:${normalizedPath}`);
      validateEvidenceHasNoObviousSecret(resolved, normalizedPath, errors);
    }
  }
}

function resolveEvidencePath(resultPath, relativePath, errors, caseId, kind) {
  const label = `${caseId}:${kind}`;
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    errors.push(`evidence:path-missing:${label}`);
    return null;
  }
  const portablePath = relativePath.replace(/[\\/]+/g, path.sep);
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    errors.push(`evidence:path-absolute:${label}`);
    return null;
  }
  const root = path.resolve(path.dirname(resultPath));
  const resolved = path.resolve(root, portablePath);
  if (!isInside(root, resolved)) {
    errors.push(`evidence:path-escape:${label}`);
    return null;
  }
  try {
    assertNoSymlinkComponents(root, resolved);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('not-regular-file');
    if (stat.size === 0) throw new Error('empty-file');
    const real = fs.realpathSync.native(resolved);
    if (!isInside(fs.realpathSync.native(root), real)) throw new Error('realpath-escape');
  } catch (error) {
    errors.push(`evidence:file-invalid:${label}:${error.message}`);
    return null;
  }
  return resolved;
}

function assertNoSymlinkComponents(root, target) {
  let current = root;
  const relative = path.relative(root, target);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('symlink-forbidden');
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateEvidenceHasNoObviousSecret(filePath, displayPath, errors) {
  if (!TEXT_EVIDENCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;
  const stat = fs.statSync(filePath);
  if (stat.size > 2 * 1024 * 1024) return;
  const text = fs.readFileSync(filePath, 'utf8');
  if (FORBIDDEN_EVIDENCE_PATTERNS.some(pattern => pattern.test(text))) {
    errors.push(`evidence:possible-secret:${displayPath}`);
  }
}

function isCompatibleVSCodeVersion(value) {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(String(value ?? '').trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 85);
}

function assertUniqueValues(items, field, prefix, errors) {
  const values = items.map(item => item?.[field]);
  if (new Set(values).size !== values.length) errors.push(`${prefix}:${field}-duplicate`);
}
