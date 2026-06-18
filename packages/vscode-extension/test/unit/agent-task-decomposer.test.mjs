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

console.log('\nAgent task decomposer path anchoring tests passed.\n');
