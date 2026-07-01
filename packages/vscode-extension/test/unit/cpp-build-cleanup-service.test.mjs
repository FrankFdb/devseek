/**
 * Unit tests for workspace/cpp-build-cleanup-service.ts.
 *
 * Contract: model-driven terminal commands may mention old build locations, but
 * DevSeek keeps C/C++ project artifacts converged on project-local build/.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/cpp-build-cleanup-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/cpp-build-cleanup-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  cleanupLegacyCppBuildDirsForCommand,
  normalizeLegacyCppBuildCommandForRun,
} = req(bundlePath);

test('C++ build cleanup removes legacy dirs before model-driven CMake commands', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cpp-cleanup-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'shape_manager');
    mkdirSync(path.join(projectDir, '.devseek-build'), { recursive: true });
    mkdirSync(path.join(projectDir, 'build'), { recursive: true });
    writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'project(shape_manager)\n');
    writeFileSync(path.join(projectDir, '.devseek-build', 'stale'), 'old');
    writeFileSync(path.join(projectDir, 'build', 'keep'), 'new');

    const result = cleanupLegacyCppBuildDirsForCommand({
      workspaceRoot,
      workdir: workspaceRoot,
      command: 'cd code/shape_manager && cmake -S . -B build && cmake --build build',
    });

    assert.equal(existsSync(path.join(projectDir, '.devseek-build')), false);
    assert.equal(existsSync(path.join(projectDir, 'build', 'keep')), true);
    assert.equal(result.cleaned.length, 1);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('C++ build cleanup ignores non-build commands', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cpp-cleanup-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'shape_manager');
    mkdirSync(path.join(projectDir, '.devseek-build'), { recursive: true });
    writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'project(shape_manager)\n');

    const result = cleanupLegacyCppBuildDirsForCommand({
      workspaceRoot,
      workdir: projectDir,
      command: 'ls -la',
    });

    assert.equal(existsSync(path.join(projectDir, '.devseek-build')), true);
    assert.deepEqual(result.cleaned, []);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('C++ build normalization rewrites absolute legacy build paths to project build', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cpp-cleanup-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'shape_manager');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'project(shape_manager)\n');

    const result = normalizeLegacyCppBuildCommandForRun({
      workspaceRoot,
      workdir: workspaceRoot,
      command: `cmake -S '${projectDir}' -B '${projectDir}/.devseek-build' && cmake --build '${projectDir}/.devseek-build'`,
    });

    assert.equal(result.changed, true);
    assert.doesNotMatch(result.command, /\.devseek-build/);
    assert.match(result.command, new RegExp(`${escapeRegExp(projectDir)}/build`));
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('C++ build normalization rewrites relative legacy build args after cd project', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cpp-cleanup-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'shape_manager');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'project(shape_manager)\n');

    const result = normalizeLegacyCppBuildCommandForRun({
      workspaceRoot,
      workdir: workspaceRoot,
      command: 'cd code/shape_manager && cmake -S . -B .devseek-build && cmake --build .devseek-build',
    });

    assert.equal(result.changed, true);
    assert.doesNotMatch(result.command, /\.devseek-build/);
    assert.match(result.command, /-B build/);
    assert.match(result.command, /--build build/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

console.log('\nC++ build cleanup service tests passed.\n');
