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
const bundlePath = path.join(rootDir, 'test/unit/workspace-roots.bundle.cjs');

execSync(
  `npx esbuild src/workspace-roots.ts --bundle ` +
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
  getTaskWorkspaceRootFsPath,
  getWorkspaceRootFsPath,
} = req(bundlePath);

test('workspace-roots: task root prefers external active project marker over single workspace fallback', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-open-workspace-'));
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'huida-uav-'));
  try {
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot), name: 'devseek', index: 0 }];
    mkdirSync(path.join(externalRoot, '.devseek'), { recursive: true });
    const activeDoc = path.join(
      externalRoot,
      'src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md',
    );
    mkdirSync(path.dirname(activeDoc), { recursive: true });
    writeFileSync(activeDoc, '# warranty plan\n');

    assert.equal(getWorkspaceRootFsPath('添加正式项目功能', [activeDoc]), workspaceRoot);
    assert.equal(getTaskWorkspaceRootFsPath('添加正式项目功能', [activeDoc], activeDoc), externalRoot);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

console.log('\nWorkspace root tests passed.\n');
