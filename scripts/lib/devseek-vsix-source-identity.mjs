import cp from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const VSIX_SOURCE_FINGERPRINT_VERSION = 'devseek.vsix-source-fingerprint/v1';

export function isAllowedVsixUnpackagedNonRuntimePath(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  return normalized.startsWith('docs/')
    || normalized.startsWith('packages/vscode-extension/test/')
    || normalized.startsWith('scripts/test/')
    || isAllowedVsixProcessToolPath(normalized);
}

export function isAllowedVsixProcessToolPath(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  return [
    'scripts/devseek-phase0-12-verify.mjs',
    'scripts/devseek-post-r4-local-regression-manifest-check.mjs',
    'scripts/devseek-top-agent-user-simulation-runner.mjs',
    'scripts/lib/devseek-post-r4-compact-index.mjs',
    'scripts/lib/devseek-post-r4-local-regression-manifest.mjs',
    'scripts/lib/devseek-r4-clean-runtime-limited-observation.mjs',
    'scripts/lib/devseek-vsix-source-identity.mjs',
    'scripts/package-vsix.mjs',
  ].includes(normalized);
}

export function gitDirtyTrackedPaths(repoRoot) {
  return Array.from(new Set([
    ...gitOutputLines(repoRoot, ['diff', '--name-only']),
    ...gitOutputLines(repoRoot, ['diff', '--cached', '--name-only']),
  ])).map(normalizeRepoPath).sort();
}

export function computeVsixDirtyRuntimeFingerprint({
  repoRoot,
  dirtyTrackedPaths = gitDirtyTrackedPaths(repoRoot),
  isAllowedNonRuntimePath = isAllowedVsixUnpackagedNonRuntimePath,
} = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const dirtyRuntimePaths = dirtyTrackedPaths
    .map(normalizeRepoPath)
    .filter(relativePath => relativePath && !isAllowedNonRuntimePath(relativePath))
    .sort();
  const hash = crypto.createHash('sha256');
  hash.update(`${VSIX_SOURCE_FINGERPRINT_VERSION}\n`);
  for (const relativePath of dirtyRuntimePaths) {
    const absolutePath = path.join(repoRoot, relativePath);
    hash.update(relativePath);
    hash.update('\0');
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      hash.update('file');
      hash.update('\0');
      hash.update(crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex'));
    } else {
      hash.update('missing');
    }
    hash.update('\n');
  }
  return {
    version: VSIX_SOURCE_FINGERPRINT_VERSION,
    dirtyRuntimePaths,
    sha256: hash.digest('hex'),
  };
}

export function normalizeVsixSourceFingerprint(value) {
  if (!value || typeof value !== 'object') return null;
  const version = String(value.version || '');
  const sha256 = String(value.sha256 || '');
  const dirtyRuntimePaths = Array.isArray(value.dirtyRuntimePaths)
    ? value.dirtyRuntimePaths.map(normalizeRepoPath).filter(Boolean).sort()
    : [];
  if (version !== VSIX_SOURCE_FINGERPRINT_VERSION || !/^[a-f0-9]{64}$/i.test(sha256)) return null;
  return { version, dirtyRuntimePaths, sha256 };
}

export function sameVsixSourceFingerprint(left, right) {
  const normalizedLeft = normalizeVsixSourceFingerprint(left);
  const normalizedRight = normalizeVsixSourceFingerprint(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.sha256 === normalizedRight.sha256
    && normalizedLeft.dirtyRuntimePaths.length === normalizedRight.dirtyRuntimePaths.length
    && normalizedLeft.dirtyRuntimePaths.every((value, index) => value === normalizedRight.dirtyRuntimePaths[index]);
}

function gitOutputLines(repoRoot, args) {
  const result = cp.spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function normalizeRepoPath(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}
