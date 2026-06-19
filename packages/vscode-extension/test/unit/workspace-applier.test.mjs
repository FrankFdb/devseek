/**
 * Unit tests for src/workspace-applier.ts path anchoring.
 *
 * Run: node --test test/unit/workspace-applier.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/workspace-applier.bundle.cjs');

execSync(
  `npx esbuild src/workspace-applier.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' }
);

class Uri {
  constructor(fsPath) {
    this.fsPath = path.resolve(fsPath);
  }
  static file(fsPath) {
    return new Uri(fsPath);
  }
  static joinPath(base, ...segments) {
    return new Uri(path.join(base.fsPath, ...segments));
  }
}

const fakeWorkspace = {
  workspaceFolders: [],
  getWorkspaceFolder(uri) {
    return this.workspaceFolders.find((folder) => {
      const rel = path.relative(folder.uri.fsPath, uri.fsPath);
      return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    });
  },
  getConfiguration() {
    return {
      get(_key, defaultValue) {
        return defaultValue;
      },
    };
  },
  fs: {
    async stat(uri) {
      return statSync(uri.fsPath);
    },
    async readFile(uri) {
      return readFileSync(uri.fsPath);
    },
    async writeFile(uri, bytes) {
      mkdirSync(path.dirname(uri.fsPath), { recursive: true });
      writeFileSync(uri.fsPath, Buffer.from(bytes));
    },
    async createDirectory(uri) {
      mkdirSync(uri.fsPath, { recursive: true });
    },
    async delete(uri) {
      rmSync(uri.fsPath, { recursive: true, force: true });
    },
    async readDirectory(uri) {
      return readdirSync(uri.fsPath).map((name) => [name, 1]);
    },
  },
};

const fakeVscode = {
  Uri,
  ProgressLocation: { Notification: 1 },
  workspace: fakeWorkspace,
  window: {
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => '应用全部',
    showTextDocument: async () => ({}),
    withProgress: async (_options, task) => task(),
  },
  commands: {
    executeCommand: async () => undefined,
  },
  ThemeColor: class ThemeColor {
    constructor(id) { this.id = id; }
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const {
  applyGeneratedArtifactsWithPrompt,
  resolveGeneratedArtifactPathForPrompt,
} = req(bundlePath);

function createShapeManagerWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-applier-'));
  const projectDir = path.join(root, 'code', 'shape_manager');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'project(old_shape_manager)\n');
  for (const name of ['Circle.cpp', 'Rectangle.cpp', 'Triangle.cpp', 'Circle.h', 'Rectangle.h', 'Triangle.h', 'Shape.h', 'main.cpp']) {
    writeFileSync(path.join(projectDir, name), `// old ${name}\n`);
  }
  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  return { root, projectDir };
}

function hasCommand(command) {
  try {
    execSync(`${command} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('workspace-applier: short project path anchors to explicit code subdirectory', async () => {
  const { root, projectDir } = createShapeManagerWorkspace();
  try {
    const raw = [
      'shape_manager/CMakeLists.txt',
      '```cmake',
      'cmake_minimum_required(VERSION 3.16)',
      'project(shape_manager)',
      'add_executable(shape_manager main.cpp)',
      '```',
    ].join('\n');
    const prompt = `请分析：${projectDir}中实现代码，然后添加图形显示功能，最后编译运行`;
    const statuses = [];

    const result = await applyGeneratedArtifactsWithPrompt(raw, prompt, (status) => statuses.push(status), true);

    assert.equal(result.applied, true);
    assert.deepEqual(result.changedPaths, ['code/shape_manager/CMakeLists.txt']);
    assert.match(readFileSync(path.join(projectDir, 'CMakeLists.txt'), 'utf8'), /project\(shape_manager\)/);
    assert.equal(existsSync(path.join(root, 'shape_manager', 'CMakeLists.txt')), false);
    assert.equal(statuses.some((status) => status.title === '已阻止写入（路径漂移）'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace-applier: bare CMakeLists.txt prefers the explicit project directory over code root', async () => {
  const { root, projectDir } = createShapeManagerWorkspace();
  try {
    const raw = [
      'CMakeLists.txt',
      '```cmake',
      'cmake_minimum_required(VERSION 3.16)',
      'project(shape_manager_bare)',
      '```',
    ].join('\n');
    const prompt = `在 ${projectDir} 目录中修改原有代码，不要创建新项目`;

    const result = await applyGeneratedArtifactsWithPrompt(raw, prompt, undefined, true);

    assert.equal(result.applied, true);
    assert.deepEqual(result.changedPaths, ['code/shape_manager/CMakeLists.txt']);
    assert.match(readFileSync(path.join(projectDir, 'CMakeLists.txt'), 'utf8'), /shape_manager_bare/);
    assert.equal(existsSync(path.join(root, 'code', 'CMakeLists.txt')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace-applier: single explicit file fix rejects stale unrelated generated artifacts', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-applier-single-target-'));
  const appDir = path.join(root, 'packages', 'vscode-extension', 'src', 'app');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(path.join(appDir, 'workflow-service.ts'), 'export const ok = true;\n');
  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];

  try {
    const raw = [
      '文件 1: Rectangle.cpp',
      '```cpp',
      '#include "Rectangle.h"',
      'double Rectangle::area() const { return width * height; }',
      '```',
    ].join('\n');
    const prompt = '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题';

    const result = await applyGeneratedArtifactsWithPrompt(raw, prompt, undefined, true);

    assert.equal(result.applied, false);
    assert.deepEqual(result.changedPaths, []);
    assert.equal(existsSync(path.join(appDir, 'Rectangle.cpp')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace-applier: generated basename files use project path hints instead of code root', async () => {
  const { root, projectDir } = createShapeManagerWorkspace();
  try {
    const raw = [
      'Circle.cpp',
      '```cpp',
      '#include "Circle.h"',
      'void drawCircle() {}',
      '```',
      '',
      'Rectangle.cpp',
      '```cpp',
      '#include "Rectangle.h"',
      'void drawRectangle() {}',
      '```',
      '',
      'Triangle.cpp',
      '```cpp',
      '#include "Triangle.h"',
      'void drawTriangle() {}',
      '```',
    ].join('\n');
    const prompt = '请应用识别到的候选文件修改';
    const preferredFiles = ['Circle.cpp', 'Rectangle.cpp', 'Triangle.cpp']
      .map(name => path.join(projectDir, name));

    const result = await applyGeneratedArtifactsWithPrompt(
      raw,
      prompt,
      undefined,
      true,
      undefined,
      preferredFiles,
      { rollbackOnValidationFailure: false },
    );

    assert.equal(result.applied, true);
    assert.deepEqual(result.changedPaths, [
      'code/shape_manager/Circle.cpp',
      'code/shape_manager/Rectangle.cpp',
      'code/shape_manager/Triangle.cpp',
    ]);
    assert.match(readFileSync(path.join(projectDir, 'Circle.cpp'), 'utf8'), /drawCircle/);
    assert.equal(existsSync(path.join(root, 'code', 'Circle.cpp')), false);
    assert.equal(existsSync(path.join(root, 'code', 'Rectangle.cpp')), false);
    assert.equal(existsSync(path.join(root, 'code', 'Triangle.cpp')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace-applier: explicit code subdirectory wins over same-name root directory', async () => {
  const { root, projectDir } = createShapeManagerWorkspace();
  const wrongDir = path.join(root, 'shape_manager');
  try {
    mkdirSync(wrongDir, { recursive: true });
    writeFileSync(path.join(wrongDir, 'main.cpp'), 'int main() { return 99; }\n');
    writeFileSync(path.join(wrongDir, 'CMakeLists.txt'), 'project(wrong_root_shape_manager)\n');

    const prompt = `请分析：${projectDir}中现代码，然后添加图形显示功能，输出信息同时，希望也画出图形的形状`;

    assert.equal(
      resolveGeneratedArtifactPathForPrompt('shape_manager/main.cpp', prompt),
      'code/shape_manager/main.cpp',
    );
    assert.equal(
      resolveGeneratedArtifactPathForPrompt('shape_manager/shape.cpp', prompt),
      'code/shape_manager/shape.cpp',
    );

    const raw = [
      'shape_manager/CMakeLists.txt',
      '```cmake',
      'cmake_minimum_required(VERSION 3.16)',
      'project(correct_code_shape_manager)',
      '```',
    ].join('\n');

    const result = await applyGeneratedArtifactsWithPrompt(raw, prompt, undefined, true);

    assert.equal(result.applied, true);
    assert.deepEqual(result.changedPaths, ['code/shape_manager/CMakeLists.txt']);
    assert.match(readFileSync(path.join(projectDir, 'CMakeLists.txt'), 'utf8'), /correct_code_shape_manager/);
    assert.match(readFileSync(path.join(wrongDir, 'CMakeLists.txt'), 'utf8'), /wrong_root_shape_manager/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace-applier: explicit missing code subdirectory still wins over same-name root directory', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-applier-'));
  const projectDir = path.join(root, 'code', 'shape_manager');
  const wrongDir = path.join(root, 'shape_manager');
  try {
    mkdirSync(wrongDir, { recursive: true });
    writeFileSync(path.join(wrongDir, 'main.cpp'), 'int main() { return 99; }\n');
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];

    const prompt = `请分析：${projectDir}中实现代码，然后添加图形显示功能，输出信息同时，希望也画出图形的形状`;

    assert.equal(
      resolveGeneratedArtifactPathForPrompt('shape_manager/main.cpp', prompt),
      'code/shape_manager/main.cpp',
    );
    assert.equal(
      resolveGeneratedArtifactPathForPrompt('main.cpp', prompt),
      'code/shape_manager/main.cpp',
    );

    const raw = [
      'shape_manager/main.cpp',
      '```cpp',
      '#include <iostream>',
      'int main() { std::cout << "correct"; return 0; }',
      '```',
    ].join('\n');

    const result = await applyGeneratedArtifactsWithPrompt(raw, prompt, undefined, true);

    assert.equal(result.applied, true);
    assert.deepEqual(result.changedPaths, ['code/shape_manager/main.cpp']);
    assert.match(readFileSync(path.join(projectDir, 'main.cpp'), 'utf8'), /correct/);
    assert.match(readFileSync(path.join(wrongDir, 'main.cpp'), 'utf8'), /return 99/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace-applier: compile-only C++ validation does not run the produced program', { skip: !hasCommand('g++') && 'g++ is not installed' }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-applier-'));
  const projectDir = path.join(root, 'code', 'compile_only_demo');
  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'main.cpp'), 'int main() { return 0; }\n');
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];

    const raw = [
      'compile_only_demo/main.cpp',
      '```cpp',
      'int main() { return 17; }',
      '```',
    ].join('\n');
    const prompt = `请修改 ${projectDir}，只做本地编译确认`;
    const statuses = [];

    const result = await applyGeneratedArtifactsWithPrompt(
      raw,
      prompt,
      (status) => statuses.push(status),
      true,
      undefined,
      undefined,
      { rollbackOnValidationFailure: false },
    );

    assert.equal(result.applied, true);
    assert.equal(result.validation?.ok, true);
    assert.equal(result.validation?.mode, 'compile-only');
    assert.doesNotMatch(result.validation?.reason || '', /post-compile/i);
    assert.match(result.validation?.command || '', /-fsyntax-only/);
    assert.doesNotMatch(result.validation?.command || '', /deepseek_auto_exec/);
    assert.equal(
      statuses.some((status) => status.phase === 'validate' && status.state === 'passed' && /自动验证通过/.test(status.title)),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace-applier: requested CMake runtime validation catches segfault', { skip: !hasCommand('cmake') && 'cmake is not installed' }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-applier-'));
  const projectDir = path.join(root, 'code', 'shape_manager');
  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'CMakeLists.txt'), [
      'cmake_minimum_required(VERSION 3.10)',
      'project(shape_manager)',
      'add_executable(shape_manager main.cpp)',
      '',
    ].join('\n'));
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];

    const raw = [
      'shape_manager/main.cpp',
      '```cpp',
      '#include <iostream>',
      'int main() {',
      '  std::cout << "before crash" << std::endl;',
      '  int *p = nullptr;',
      '  *p = 1;',
      '  return 0;',
      '}',
      '```',
    ].join('\n');
    const prompt = `请修改 ${projectDir}，然后编译和测试，看结果`;
    const statuses = [];

    const result = await applyGeneratedArtifactsWithPrompt(
      raw,
      prompt,
      (status) => statuses.push(status),
      true,
      undefined,
      undefined,
      { rollbackOnValidationFailure: false },
    );

    assert.equal(result.applied, true);
    assert.equal(result.validation?.ok, false);
    assert.equal(result.validation?.reason, 'cmake-build-and-run-requested');
    assert.match(result.validation?.command || '', /if test -x/);
    assert.match(result.validation?.output || '', /before crash|Segmentation fault|core dumped/i);
    assert.equal(
      statuses.some((status) => status.phase === 'validate' && status.state === 'failed' && /自动验证失败/.test(status.title)),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log('\nWorkspace applier path anchoring tests passed.\n');
