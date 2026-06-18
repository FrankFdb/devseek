/**
 * Unit tests for src/execution-planner.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/execution-planner.bundle.cjs');

execSync(
  `npx esbuild src/execution-planner.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  planLocalExecution,
  shouldPreferLocalExecution,
} = req(bundlePath);

test('ExecutionPlanner: absolute directory run request produces a local CMake run plan', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-exec-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'shape_manager');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'CMakeLists.txt'), [
      'cmake_minimum_required(VERSION 3.10)',
      'project(ShapeManager)',
      'add_executable(shape_manager main.cpp)',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(projectDir, 'main.cpp'), [
      '#include <iostream>',
      'int main() {',
      '  std::cout << "ok" << std::endl;',
      '  return 0;',
      '}',
      '',
    ].join('\n'));
    const cmakeProbeDir = path.join(projectDir, '.devseek-build', 'CMakeFiles', 'CompilerIdCXX');
    fs.mkdirSync(cmakeProbeDir, { recursive: true });
    fs.writeFileSync(path.join(cmakeProbeDir, 'CMakeCXXCompilerId.cpp'), 'int main() { return 0; }\n');

    const prompt = `${projectDir} 针对这个路径代码，编译，执行，看结果`;
    assert.equal(shouldPreferLocalExecution(prompt, [], workspaceRoot), true);

    const plan = planLocalExecution(prompt, [], workspaceRoot);
    assert.ok(plan);
    assert.equal(plan.mode, 'cmake');
    assert.equal(plan.cwd, projectDir);
    assert.match(plan.command, /cmake -S/);
    assert.match(plan.command, /if test -x/);
    assert.match(plan.command, /shape_manager/);
    assert.equal(
      plan.command.includes('|| ctest'),
      false,
      'runtime failure must not be masked by falling through to ctest',
    );
    assert.ok(plan.attachedFiles.some((filePath) => filePath.endsWith('main.cpp')));
    assert.equal(
      plan.attachedFiles.some((filePath) => filePath.includes('CMakeCXXCompilerId.cpp')),
      false,
      'CMake compiler probe sources must not enter DevSeek repair context',
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ExecutionPlanner: CMake test request runs executable instead of build-only', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-exec-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'shape_manager');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'CMakeLists.txt'), [
      'cmake_minimum_required(VERSION 3.10)',
      'project(ShapeManager)',
      'add_executable(shape_manager main.cpp)',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(projectDir, 'main.cpp'), 'int main() { return 0; }\n');

    const plan = planLocalExecution(`${projectDir} 请编译和测试`, [], workspaceRoot);
    assert.ok(plan);
    assert.equal(plan.mode, 'cmake');
    assert.equal(plan.reason, 'cmake-local-build-and-test');
    assert.match(plan.command, /if test -x/);
    assert.match(plan.command, /shape_manager/);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

console.log('\nExecution planner tests passed.\n');
