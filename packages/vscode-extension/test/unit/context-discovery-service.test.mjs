import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/context-discovery-service.bundle.cjs');

execSync(
  `npx esbuild src/app/context-discovery-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { workspaceFolders: [] },
      extensions: { getExtension: () => undefined },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const { discoverFilesFromDirectoryPrompt } = req(bundlePath);

function folder(root) {
  return { uri: { fsPath: root }, name: path.basename(root), index: 0 };
}

test('ContextDiscoveryService: discovers source files from bare project directory names', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-context-discovery-'));
  const targetDir = path.join(root, 'code', 'shape_manager');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(path.join(targetDir, 'Renderer.cpp'), 'void draw() {}\n');
  writeFileSync(path.join(targetDir, 'Renderer.h'), '#pragma once\n');
  writeFileSync(path.join(targetDir, 'CMakeLists.txt'), 'add_executable(shape Renderer.cpp)\n');
  writeFileSync(path.join(targetDir, 'README.md'), '# shape manager\n');

  try {
    const files = discoverFilesFromDirectoryPrompt(
      '现在的 shape_manager 图形绘画需要继续优化',
      [folder(root)],
    ).map(filePath => path.relative(root, filePath).replace(/\\/g, '/'));

    assert.ok(files.includes('code/shape_manager/Renderer.cpp'));
    assert.ok(files.includes('code/shape_manager/Renderer.h'));
    assert.ok(files.includes('code/shape_manager/CMakeLists.txt'));
    assert.ok(!files.includes('code/shape_manager/README.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ContextDiscoveryService: does not treat ordinary prompt words as directory targets', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-context-discovery-'));
  const targetDir = path.join(root, 'code', 'current');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(path.join(targetDir, 'main.cpp'), 'int main() { return 0; }\n');

  try {
    const files = discoverFilesFromDirectoryPrompt(
      'current rendering should be optimized',
      [folder(root)],
    );

    assert.deepEqual(files, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
