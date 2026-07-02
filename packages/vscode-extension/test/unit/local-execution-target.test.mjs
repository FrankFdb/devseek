/**
 * Unit tests for workspace/local-execution-target.ts.
 *
 * Contract: compile/run validation treats build artifacts as outputs and
 * resolves back to the nearest real project directory before executing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
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
const bundlePath = path.join(rootDir, 'test/unit/local-execution-target.bundle.cjs');

execSync(
  `npx esbuild src/workspace/local-execution-target.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  resolveLocalExecutionProjectDirFromCandidate,
  resolveLocalExecutionWorkdir,
} = req(bundlePath);

test('local execution target maps existing build/bin executable back to CMake project root', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-local-target-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'shape_manager');
    const exePath = path.join(projectDir, 'build', 'bin', 'shape_manager');
    mkdirSync(path.dirname(exePath), { recursive: true });
    writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'project(shape_manager)\n');
    writeFileSync(exePath, '');

    assert.equal(resolveLocalExecutionWorkdir(exePath), projectDir);
    assert.equal(
      resolveLocalExecutionProjectDirFromCandidate('code/shape_manager/build/bin/shape_manager', [workspaceRoot]),
      projectDir,
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('local execution target maps nested source files back to project root', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-local-target-'));
  try {
    const projectDir = path.join(workspaceRoot, 'demo');
    const sourcePath = path.join(projectDir, 'src', 'main.cpp');
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'project(demo)\n');
    writeFileSync(sourcePath, 'int main(){return 0;}\n');

    assert.equal(resolveLocalExecutionWorkdir(sourcePath), projectDir);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('local execution target resolves project directory candidates directly', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-local-target-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'shape_manager');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'project(shape_manager)\n');
    writeFileSync(path.join(projectDir, 'main.cpp'), 'int main(){return 0;}\n');

    assert.equal(
      resolveLocalExecutionProjectDirFromCandidate('code/shape_manager', [workspaceRoot]),
      projectDir,
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
