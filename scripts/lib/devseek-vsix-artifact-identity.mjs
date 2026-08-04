import crypto from 'node:crypto';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BRIDGE_ENTRY = 'extension/bridge/server.js';
const DEFAULT_PACKAGE_ENTRY = 'extension/package.json';

export function readVsixIdentity(vsixPath, repoRoot, {
  bridgeEntry = DEFAULT_BRIDGE_ENTRY,
  packageEntry = DEFAULT_PACKAGE_ENTRY,
} = {}) {
  const packageJson = JSON.parse(readVsixEntry(vsixPath, packageEntry).toString('utf8'));
  const bridgeBuffer = readVsixEntry(vsixPath, bridgeEntry);
  return {
    path: path.relative(repoRoot, vsixPath),
    sha256: sha256File(vsixPath),
    package_identity: packageIdentityFromPackageJson(packageJson),
    packaged_bridge_server_sha256: sha256Buffer(bridgeBuffer),
  };
}

export function packageIdentityFromPackageJson(packageJson) {
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

export function comparableVsixIdentity(artifact) {
  return {
    sha256: artifact?.sha256,
    package_identity: artifact?.package_identity,
    packaged_bridge_server_sha256: artifact?.packaged_bridge_server_sha256,
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
