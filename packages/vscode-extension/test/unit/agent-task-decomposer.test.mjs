/**
 * Regression tests for Agent task path anchoring.
 *
 * The Claude Code/Codex-style contract: once the user or discovered workset
 * establishes a project directory, bare filenames from the planner are scoped
 * to that directory before the editor loop writes anything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
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
const bundlePath = path.join(rootDir, 'test/unit/agent-task-decomposer.bundle.cjs');

execSync(
  `npx esbuild src/agent-task-decomposer.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
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
};

const fakeVscode = {
  Uri,
  workspace: fakeWorkspace,
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const {
  decomposeTask,
  inferTasksFromFiles,
} = req(bundlePath);

function createShapeManagerWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-decompose-'));
  const projectDir = path.join(root, 'code', 'shape_manager');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'project(shape_manager)\n');
  const files = ['Circle.cpp', 'Rectangle.cpp', 'Triangle.cpp'].map((name) => {
    const abs = path.join(projectDir, name);
    writeFileSync(abs, `// ${name}\n`);
    return abs;
  });
  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  return { root, projectDir, files };
}

test('agent-task-decomposer: bare planner filenames stay anchored to discovered project directory', async () => {
  const { root, projectDir, files } = createShapeManagerWorkspace();
  try {
    const rawPlan = JSON.stringify({
      tasks: [
        { id: 't1', file: 'Circle.cpp', action: 'modify', desc: '增强圆形灰度绘制' },
        { id: 't2', file: 'code/Rectangle.cpp', action: 'modify', desc: '增强矩形灰度绘制' },
        { id: 't3', file: 'shape_manager/Triangle.cpp', action: 'modify', desc: '增强三角形灰度绘制' },
        { id: 't4', file: 'PixelCanvas.cpp', action: 'create', desc: '新增像素画布辅助实现' },
      ],
    });

    const result = await decomposeTask(
      '请基于这些文件优化灰度绘制效果',
      files,
      undefined,
      () => {},
      undefined,
      async () => rawPlan,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.tasks.map(t => t.file),
      [
        'code/shape_manager/Circle.cpp',
        'code/shape_manager/Rectangle.cpp',
        'code/shape_manager/Triangle.cpp',
        'code/shape_manager/PixelCanvas.cpp',
      ],
    );
    assert.deepEqual(
      result.tasks.map(t => t.absPath),
      [
        path.join(projectDir, 'Circle.cpp'),
        path.join(projectDir, 'Rectangle.cpp'),
        path.join(projectDir, 'Triangle.cpp'),
        path.join(projectDir, 'PixelCanvas.cpp'),
      ],
    );
    assert.equal(result.tasks.some(t => t.absPath === path.join(root, 'code', path.basename(t.file))), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agent-task-decomposer: validation tasks targeting build artifacts are anchored to project dir', async () => {
  const { root, projectDir, files } = createShapeManagerWorkspace();
  try {
    const rawPlan = JSON.stringify({
      tasks: [
        {
          id: 't1',
          file: 'code/shape_manager/build/bin/shape_manager',
          action: 'analyze',
          desc: '编译并运行项目确认窗口标题',
        },
      ],
    });

    const result = await decomposeTask(
      '请重新编译执行确认 title 是否正常',
      files,
      undefined,
      () => {},
      undefined,
      async () => rawPlan,
    );

    assert.equal(result.ok, true);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].file, 'code/shape_manager');
    assert.equal(result.tasks[0].absPath, projectDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agent-task-decomposer: fallback tasks expose workspace-relative paths', () => {
  const { root, files } = createShapeManagerWorkspace();
  try {
    const tasks = inferTasksFromFiles(files, '分析这些文件');
    assert.deepEqual(
      tasks.map(t => t.file),
      [
        'code/shape_manager/Circle.cpp',
        'code/shape_manager/Rectangle.cpp',
        'code/shape_manager/Triangle.cpp',
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agent-task-decomposer: explicit fix target is not downgraded to explore-only', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-explicit-fix-'));
  try {
    const targetDir = path.join(root, 'packages', 'vscode-extension', 'src', 'app');
    mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, 'workflow-service.ts');
    writeFileSync(targetFile, 'export class WorkflowService {}\n');
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];

    const rawPlan = JSON.stringify({
      tasks: [
        {
          id: 't1',
          file: 'packages/vscode-extension/src/app/workflow-service.ts',
          action: 'explore',
          desc: '使用 read_file 确认文件当前完整内容，检查明显问题',
        },
      ],
    });

    const result = await decomposeTask(
      '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题',
      [],
      undefined,
      () => {},
      undefined,
      async () => rawPlan,
    );

    assert.equal(result.ok, true);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].file, 'packages/vscode-extension/src/app/workflow-service.ts');
    assert.equal(result.tasks[0].action, 'modify');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agent-task-decomposer: UI title mojibake edit is not completed as explore-only', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-title-mojibake-'));
  try {
    const projectDir = path.join(root, 'code', 'shape_manager');
    mkdirSync(projectDir, { recursive: true });
    const targetFile = path.join(projectDir, 'main.cpp');
    writeFileSync(targetFile, 'int main() { glutCreateWindow("三维图形展示"); return 0; }\n');
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];

    const rawPlan = JSON.stringify({
      tasks: [
        {
          id: 't1',
          file: 'main.cpp',
          action: 'explore',
          desc: '探索 title乱码原因，检查 glutCreateWindow 标题',
        },
        {
          id: 't2',
          file: 'code/shape_manager',
          action: 'explore',
          desc: '搜索 title 标题 窗口 glutCreateWindow',
        },
        {
          id: 't3',
          file: 'code/shape_manager/build/bin',
          action: 'explore',
          desc: '列出 build/bin 确认当前程序',
        },
      ],
    });

    const result = await decomposeTask(
      'title乱码，是不是存在中文的原因，请修改为英文吧',
      [targetFile],
      undefined,
      () => {},
      undefined,
      async () => rawPlan,
    );

    assert.equal(result.ok, true);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].file, 'code/shape_manager/main.cpp');
    assert.equal(result.tasks[0].absPath, targetFile);
    assert.equal(result.tasks[0].action, 'modify');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agent-task-decomposer: explicit edit drops redundant exploration but keeps validation task', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-edit-validation-'));
  try {
    const projectDir = path.join(root, 'code', 'shape_manager');
    mkdirSync(projectDir, { recursive: true });
    const mainFile = path.join(projectDir, 'main.cpp');
    const cmakeFile = path.join(projectDir, 'CMakeLists.txt');
    writeFileSync(mainFile, 'int main() { glutCreateWindow("三维图形展示"); return 0; }\n');
    writeFileSync(cmakeFile, 'add_executable(shape_manager main.cpp)\n');
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];

    const rawPlan = JSON.stringify({
      tasks: [
        {
          id: 't1',
          file: 'main.cpp',
          action: 'modify',
          desc: '修改窗口标题为英文',
        },
        {
          id: 't2',
          file: 'main.cpp',
          action: 'explore',
          desc: '再次读取 main.cpp 确认标题位置',
        },
        {
          id: 't3',
          file: 'CMakeLists.txt',
          action: 'analyze',
          desc: '使用 cmake 编译验证',
        },
      ],
    });

    const result = await decomposeTask(
      'title乱码，是不是存在中文的原因，请修改为英文吧',
      [mainFile, cmakeFile],
      undefined,
      () => {},
      undefined,
      async () => rawPlan,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.tasks.map(t => t.action), ['modify', 'analyze']);
    assert.deepEqual(
      result.tasks.map(t => t.file),
      ['code/shape_manager/main.cpp', 'code/shape_manager'],
    );
    assert.equal(result.tasks[1].absPath, projectDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log('\nAgent task decomposer path anchoring tests passed.\n');
