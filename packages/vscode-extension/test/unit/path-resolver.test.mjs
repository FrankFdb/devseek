/**
 * Unit tests for the shared workspace path resolver.
 *
 * Run: node --test test/unit/path-resolver.test.mjs
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
const bundlePath = path.join(rootDir, 'test/unit/path-resolver.bundle.cjs');

execSync(
  `npx esbuild src/workspace/path-resolver.ts --bundle ` +
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
  detectWorkspacePathScope,
  resolveGeneratedArtifactPathForPrompt,
  resolveWorkspaceWritePath,
} = req(bundlePath);

function createWorkspaceWithDuplicateShapeManager() {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-path-resolver-'));
  const projectDir = path.join(root, 'code', 'shape_manager');
  const wrongDir = path.join(root, 'shape_manager');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(wrongDir, { recursive: true });
  writeFileSync(path.join(wrongDir, 'main.cpp'), 'int main() { return 99; }\n');
  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  return { root, projectDir, wrongDir };
}

test('path-resolver: explicit code subdirectory beats same-name root directory for artifacts and tool writes', () => {
  const { root, projectDir, wrongDir } = createWorkspaceWithDuplicateShapeManager();
  try {
    const prompt = `请分析：${projectDir}中现代码，然后添加图形显示功能，输出信息同时，希望也画出图形的形状`;

    assert.equal(
      resolveGeneratedArtifactPathForPrompt('shape_manager/main.cpp', prompt),
      'code/shape_manager/main.cpp',
    );
    assert.equal(
      resolveGeneratedArtifactPathForPrompt('shape_manager/main.cpp', '请按既有代码修改', [projectDir]),
      'code/shape_manager/main.cpp',
    );

    const scopedWrite = resolveWorkspaceWritePath('shape_manager/main.cpp', {
      requestPrompt: prompt,
      content: '#include <iostream>\nint main() { return 0; }\n',
      workspaceRootFsPath: root,
      defaultWorkdir: wrongDir,
    });
    assert.equal(scopedWrite.relPath, 'code/shape_manager/main.cpp');
    assert.equal(scopedWrite.absPath, path.join(projectDir, 'main.cpp'));

    const bareWrite = resolveWorkspaceWritePath('main.cpp', {
      requestPrompt: prompt,
      content: '#include <iostream>\nint main() { return 0; }\n',
      workspaceRootFsPath: root,
      defaultWorkdir: wrongDir,
    });
    assert.equal(bareWrite.relPath, 'code/shape_manager/main.cpp');
    assert.equal(bareWrite.absPath, path.join(projectDir, 'main.cpp'));

    const scope = detectWorkspacePathScope(prompt);
    assert.equal(scope.promptDir, projectDir);
    assert.equal(scope.promptDirIsExplicit, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log('\nShared path resolver tests passed.\n');
