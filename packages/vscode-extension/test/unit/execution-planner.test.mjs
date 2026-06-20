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
  parseLocalExecutionDiagnostics,
  planLocalExecution,
  planRepeatLocalExecution,
  selectRepairFiles,
  shouldRepairLocalExecutionFailure,
  shouldRebuildRepeatExecution,
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
    const cmakeFilesDir = path.join(projectDir, 'CMakeFiles', 'CompilerIdC');
    fs.mkdirSync(cmakeFilesDir, { recursive: true });
    fs.writeFileSync(path.join(cmakeFilesDir, 'CMakeCCompilerId.c'), 'int main() { return 0; }\n');
    fs.writeFileSync(path.join(projectDir, 'CMakeCompilerId.c'), 'int main() { return 0; }\n');
    fs.writeFileSync(path.join(projectDir, 'compiler_depend.ts'), 'timestamp\n');
    fs.writeFileSync(path.join(projectDir, 'compiler_dependent.ts'), 'timestamp\n');

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
    assert.equal(
      plan.attachedFiles.some((filePath) => /CMake(?:C)?CompilerId\.c|compiler_depend(?:ent)?\.ts/.test(filePath)),
      false,
      'CMake root-level compiler probes and dependency timestamps must not enter DevSeek repair context',
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

test('ExecutionPlanner: repeat recompile request replans build instead of stale run-only executable', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-repeat-rebuild-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'shape_manager');
    const buildDir = path.join(projectDir, '.devseek-build');
    fs.mkdirSync(buildDir, { recursive: true });
    const cmakeFile = path.join(projectDir, 'CMakeLists.txt');
    const mainCpp = path.join(projectDir, 'main.cpp');
    fs.writeFileSync(cmakeFile, [
      'cmake_minimum_required(VERSION 3.10)',
      'project(ShapeManager)',
      'add_executable(shape_manager main.cpp)',
      '',
    ].join('\n'));
    fs.writeFileSync(mainCpp, 'int main() { return 0; }\n');

    const staleExecutable = path.join(buildDir, 'shape_manager');
    const lastPlan = {
      command: `'${staleExecutable}'`,
      cwd: projectDir,
      mode: 'run-only',
      reason: 'cmake-existing-executable-run',
      attachedFiles: [mainCpp, cmakeFile],
      targetFiles: [mainCpp, cmakeFile],
    };

    assert.equal(shouldRebuildRepeatExecution('重新编译，执行'), true);
    const plan = planRepeatLocalExecution('重新编译，执行', lastPlan, workspaceRoot);

    assert.ok(plan);
    assert.equal(plan.mode, 'cmake');
    assert.match(plan.reason, /repeat-replanned-build/);
    assert.match(plan.reason, /cmake-local-rebuild-and-test/);
    assert.match(plan.command, /cmake -S/);
    assert.doesNotMatch(plan.command, new RegExp(`^'${staleExecutable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'$`));
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ExecutionPlanner: Chinese execute-result request runs an existing C++ executable before compiling', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-exec-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'shape_manager');
    fs.mkdirSync(projectDir, { recursive: true });
    const mainCpp = path.join(projectDir, 'main.cpp');
    const existingExe = path.join(projectDir, 'deepseek_auto_exec');
    fs.writeFileSync(mainCpp, 'int main() { return 0; }\n');
    fs.writeFileSync(existingExe, '#!/bin/sh\necho EXISTING_OK\n');
    fs.chmodSync(existingExe, 0o755);

    const prompt = '请执行，给出执行结果';
    assert.equal(shouldPreferLocalExecution(prompt, [mainCpp], workspaceRoot), true);
    const plan = planLocalExecution(prompt, [mainCpp], workspaceRoot);
    assert.ok(plan);
    assert.equal(plan.mode, 'run-only');
    assert.equal(plan.reason, 'cpp-existing-executable-run');
    assert.equal(plan.command, `'${existingExe}'`);
    assert.equal(plan.command.includes('g++'), false);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ExecutionPlanner: C++ run request compiles and runs only when no executable exists', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-exec-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'hello');
    fs.mkdirSync(projectDir, { recursive: true });
    const mainCpp = path.join(projectDir, 'main.cpp');
    fs.writeFileSync(mainCpp, 'int main() { return 0; }\n');

    const plan = planLocalExecution('请执行，给出执行结果', [mainCpp], workspaceRoot);
    assert.ok(plan);
    assert.equal(plan.mode, 'compile-run');
    assert.match(plan.command, /g\+\+ -std=c\+\+17/);
    assert.match(plan.command, /deepseek_auto_exec/);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ExecutionPlanner: local execution repair is reserved for build failures', () => {
  const basePlan = {
    command: './app',
    cwd: '/tmp',
    reason: 'test',
    attachedFiles: [],
    targetFiles: [],
  };
  assert.equal(
    shouldRepairLocalExecutionFailure(
      { ...basePlan, mode: 'run-only' },
      { ok: false, command: './app', cwd: '/tmp', exitCode: 1, output: 'runtime error: bad input' },
    ),
    false,
  );
  assert.equal(
    shouldRepairLocalExecutionFailure(
      { ...basePlan, mode: 'compile-run' },
      { ok: false, command: 'g++ main.cpp -o app && ./app', cwd: '/tmp', exitCode: 1, output: 'main.cpp:3:5: error: expected ;' },
    ),
    true,
  );
});

test('ExecutionPlanner: repair file selection follows concrete compiler diagnostics', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-repair-scope-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'multi');
    fs.mkdirSync(projectDir, { recursive: true });
    const mainCpp = path.join(projectDir, 'main.cpp');
    const utilCpp = path.join(projectDir, 'util.cpp');
    const helperCpp = path.join(projectDir, 'helper.cpp');
    fs.writeFileSync(mainCpp, 'int main() { return 0; }\n');
    fs.writeFileSync(utilCpp, 'int broken() { return missing; }\n');
    fs.writeFileSync(helperCpp, 'int helper() { return 1; }\n');

    const plan = {
      command: `g++ '${mainCpp}' '${utilCpp}' '${helperCpp}' -o app`,
      cwd: projectDir,
      mode: 'compile-only',
      reason: 'test',
      attachedFiles: [mainCpp, utilCpp, helperCpp],
      targetFiles: [mainCpp, utilCpp, helperCpp],
    };
    const result = {
      ok: false,
      command: plan.command,
      cwd: projectDir,
      exitCode: 1,
      output: `main.cpp:1: note: included for context\nutil.cpp:1:23: error: 'missing' was not declared in this scope\ncollect2: error: ld returned 1 exit status`,
    };

    const diagnostics = parseLocalExecutionDiagnostics(plan, result);
    assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 1);
    assert.equal(diagnostics.find((d) => d.severity === 'error')?.filePath, utilCpp);
    assert.deepEqual(selectRepairFiles(plan, result), [utilCpp]);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ExecutionPlanner: CMake diagnostics can target CMakeLists without broad source fallback', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-cmake-repair-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'cmake_bad');
    fs.mkdirSync(projectDir, { recursive: true });
    const mainCpp = path.join(projectDir, 'main.cpp');
    const utilCpp = path.join(projectDir, 'util.cpp');
    const cmakeFile = path.join(projectDir, 'CMakeLists.txt');
    fs.writeFileSync(mainCpp, 'int main() { return 0; }\n');
    fs.writeFileSync(utilCpp, 'int util() { return 1; }\n');
    fs.writeFileSync(cmakeFile, 'cmake_minimum_required(VERSION 3.10)\nnot_a_cmake_command()\n');

    const plan = {
      command: `cmake -S '${projectDir}' -B '${path.join(projectDir, '.devseek-build')}'`,
      cwd: projectDir,
      mode: 'cmake',
      reason: 'test',
      attachedFiles: [mainCpp, utilCpp],
      targetFiles: [mainCpp, utilCpp],
    };
    const result = {
      ok: false,
      command: plan.command,
      cwd: projectDir,
      exitCode: 1,
      output: 'CMake Error at CMakeLists.txt:2 (not_a_cmake_command):\n  Unknown CMake command "not_a_cmake_command".',
    };

    assert.deepEqual(selectRepairFiles(plan, result), [cmakeFile]);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ExecutionPlanner: repair file selection falls back only when no location is known', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-repair-fallback-'));
  try {
    const projectDir = path.join(workspaceRoot, 'code', 'link');
    fs.mkdirSync(projectDir, { recursive: true });
    const mainCpp = path.join(projectDir, 'main.cpp');
    const utilCpp = path.join(projectDir, 'util.cpp');
    fs.writeFileSync(mainCpp, 'int main() { return 0; }\n');
    fs.writeFileSync(utilCpp, 'int util() { return 1; }\n');

    const plan = {
      command: `g++ '${mainCpp}' '${utilCpp}' -o app`,
      cwd: projectDir,
      mode: 'compile-run',
      reason: 'test',
      attachedFiles: [mainCpp, utilCpp],
      targetFiles: [mainCpp, utilCpp],
    };
    const result = {
      ok: false,
      command: plan.command,
      cwd: projectDir,
      exitCode: 1,
      output: 'collect2: error: ld returned 1 exit status',
    };

    assert.deepEqual(selectRepairFiles(plan, result), [mainCpp, utilCpp]);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

console.log('\nExecution planner tests passed.\n');
