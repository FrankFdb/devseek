/**
 * Unit tests for R2-03C EnvironmentProfileService.
 *
 * Environment discovery separates repository shape from runtime availability
 * and dependency mutation policy. It must not guess install/build commands from
 * manifests alone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/environment-profile-service.bundle.cjs');

execSync(
  `npx esbuild src/app/environment-profile-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  buildEnvironmentProfile,
  evaluateDependencyCommand,
  resolveRuntimeCommand,
} = createRequire(import.meta.url)(bundlePath);

function withTempWorkspace(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-env-profile-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(root, relPath, content = '') {
  const absPath = path.join(root, relPath);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
  return absPath;
}

function makeExecutable(dir, name) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return file;
}

test('EnvironmentProfileService: maps toolchain, versions and lockfiles without guessing commands', () => {
  withTempWorkspace((workspace) => {
    const binDir = path.join(workspace, 'bin');
    makeExecutable(binDir, 'node');
    makeExecutable(binDir, 'npm');
    write(workspace, 'package.json', JSON.stringify({
      engines: { node: '>=22' },
      scripts: { build: 'vite build', test: 'vitest run' },
    }));
    write(workspace, 'package-lock.json', '{"lockfileVersion":3}\n');
    write(workspace, 'src/app.ts', 'export const app = true;\n');

    const profile = buildEnvironmentProfile({
      workspaceRoots: [workspace],
      envPath: binDir,
      runtimeVersions: { node: 'v22.3.0', npm: '10.8.0' },
    });

    assert.equal(profile.version, 'devseek.environment-profile/v1');
    assert.ok(profile.runtimes.some(item => (
      item.id === 'node'
      && item.available
      && item.version === 'v22.3.0'
      && item.declaredVersion === '>=22'
    )));
    assert.ok(profile.runtimes.some(item => item.id === 'npm' && item.available && item.version === '10.8.0'));
    assert.deepEqual(profile.dependencyPolicy.lockfiles.map(item => item.relPath), ['package-lock.json']);
    assert.equal(profile.dependencyPolicy.packageManagers[0], 'npm');
    assert.deepEqual(profile.commandCandidates, []);
  });
});

test('EnvironmentProfileService: blocks offline dependency mutation and preserves lockfile risk evidence', () => {
  withTempWorkspace((workspace) => {
    const binDir = path.join(workspace, 'bin');
    makeExecutable(binDir, 'node');
    makeExecutable(binDir, 'npm');
    write(workspace, 'package.json', '{"scripts":{"test":"node --test"}}\n');
    write(workspace, 'package-lock.json', '{"lockfileVersion":3}\n');

    const profile = buildEnvironmentProfile({
      workspaceRoots: [workspace],
      envPath: binDir,
      offline: true,
    });
    const install = evaluateDependencyCommand({ profile, command: 'npm install left-pad' });
    const testCommand = evaluateDependencyCommand({ profile, command: 'npm test' });

    assert.equal(profile.dependencyPolicy.offline, true);
    assert.equal(install.blocked, true);
    assert.equal(install.reason, 'offline-dependency-install-blocked');
    assert.equal(install.mutatesDependencies, true);
    assert.ok(install.risks.includes('lockfile-change'));
    assert.ok(install.evidenceIds.some(id => id.includes('package-lock.json')));
    assert.equal(testCommand.blocked, false);
    assert.equal(testCommand.mutatesDependencies, false);
  });
});

test('EnvironmentProfileService: missing runtime blocks execution instead of inventing fallback commands', () => {
  withTempWorkspace((workspace) => {
    const emptyBin = path.join(workspace, 'empty-bin');
    mkdirSync(emptyBin, { recursive: true });
    write(workspace, 'tools/run.py', 'print("ok")\n');

    const profile = buildEnvironmentProfile({
      workspaceRoots: [workspace],
      envPath: emptyBin,
    });
    const resolution = resolveRuntimeCommand({
      profile,
      command: 'python tools/run.py',
      workspaceRoot: workspace,
      workdir: workspace,
    });

    assert.equal(profile.diagnostics.some(item => item.kind === 'missing-runtime' && item.runtimeId === 'python'), true);
    assert.equal(resolution.blocked, true);
    assert.equal(resolution.reason, 'missing-runtime');
    assert.equal(resolution.command, 'python tools/run.py');
    assert.deepEqual(profile.commandCandidates, []);
  });
});

test('EnvironmentProfileService: rewrites known python alias only from profile evidence', () => {
  withTempWorkspace((workspace) => {
    const binDir = path.join(workspace, 'bin');
    makeExecutable(binDir, 'python3');
    write(workspace, 'tools/run.py', 'print("ok")\n');

    const profile = buildEnvironmentProfile({
      workspaceRoots: [workspace],
      envPath: binDir,
      runtimeVersions: { python3: 'Python 3.12.0' },
    });
    const resolution = resolveRuntimeCommand({
      profile,
      command: 'python tools/run.py',
      workspaceRoot: workspace,
      workdir: path.join(workspace, 'tools'),
    });

    assert.equal(resolution.blocked, false);
    assert.equal(resolution.changed, true);
    assert.equal(resolution.reason, 'rewritten-runtime-alias');
    assert.match(resolution.command, /^python3 '/);
    assert.match(resolution.command, /tools\/run\.py'/);
    assert.ok(resolution.evidenceIds.some(id => id.includes('python3')));
  });
});

test('EnvironmentProfileService: conflicting lockfiles make dependency manager ambiguous', () => {
  withTempWorkspace((workspace) => {
    const binDir = path.join(workspace, 'bin');
    makeExecutable(binDir, 'npm');
    makeExecutable(binDir, 'pnpm');
    write(workspace, 'package.json', '{}\n');
    write(workspace, 'package-lock.json', '{}\n');
    write(workspace, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');

    const profile = buildEnvironmentProfile({
      workspaceRoots: [workspace],
      envPath: binDir,
    });

    assert.equal(profile.dependencyPolicy.packageManagerDecision, 'ambiguous-lockfiles');
    assert.ok(profile.diagnostics.some(item => item.kind === 'lockfile-manager-conflict'));
  });
});

console.log('\nEnvironment profile service tests passed.\n');
