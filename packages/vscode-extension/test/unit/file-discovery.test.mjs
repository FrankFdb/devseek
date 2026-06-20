/**
 * Unit tests for src/file-discovery.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/file-discovery.bundle.cjs');

execSync(
  `npx esbuild src/file-discovery.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  DEFAULT_SOURCE_FILE_RE,
  EXECUTION_SOURCE_FILE_RE,
  PROJECT_CONTEXT_SOURCE_FILE_RE,
  isGeneratedBuildArtifactPath,
  shouldIncludeDiscoveredSourceFile,
  shouldSkipDiscoveryDir,
} = req(bundlePath);

test('file discovery skips generated CMake/build trees', () => {
  assert.equal(shouldSkipDiscoveryDir('CMakeFiles'), true);
  assert.equal(shouldSkipDiscoveryDir('devseek-build'), true);
  assert.equal(shouldSkipDiscoveryDir('.devseek-build'), true);
  assert.equal(shouldSkipDiscoveryDir('.devseek-builds'), true);
  assert.equal(shouldSkipDiscoveryDir('cmake-build-debug'), true);
  assert.equal(shouldSkipDiscoveryDir('src'), false);

  assert.equal(
    isGeneratedBuildArtifactPath('/tmp/project/CMakeFiles/CompilerIdCXX/CMakeCXXCompilerId.cpp'),
    true,
  );
});

test('file discovery rejects CMake compiler probes and dependency timestamps', () => {
  const generated = [
    '/tmp/project/CMakeCCompilerId.c',
    '/tmp/project/CMakeCXXCompilerId.cpp',
    '/tmp/project/CMakeCompilerId.c',
    '/tmp/project/compiler_depend.ts',
    '/tmp/project/compiler_dependent.ts',
  ];

  for (const filePath of generated) {
    assert.equal(isGeneratedBuildArtifactPath(filePath), true, filePath);
    assert.equal(shouldIncludeDiscoveredSourceFile(filePath, DEFAULT_SOURCE_FILE_RE), false, filePath);
    assert.equal(shouldIncludeDiscoveredSourceFile(filePath, EXECUTION_SOURCE_FILE_RE), false, filePath);
    assert.equal(shouldIncludeDiscoveredSourceFile(filePath, PROJECT_CONTEXT_SOURCE_FILE_RE), false, filePath);
  }

  assert.equal(
    shouldIncludeDiscoveredSourceFile('/tmp/project/src/main.cpp', DEFAULT_SOURCE_FILE_RE),
    true,
  );
});

test('project context discovery keeps code and build manifests but skips prose docs', () => {
  assert.equal(
    shouldIncludeDiscoveredSourceFile('/tmp/project/code/shape_manager/CMakeLists.txt', PROJECT_CONTEXT_SOURCE_FILE_RE),
    true,
  );
  assert.equal(
    shouldIncludeDiscoveredSourceFile('/tmp/project/code/shape_manager/Renderer.cpp', PROJECT_CONTEXT_SOURCE_FILE_RE),
    true,
  );
  assert.equal(
    shouldIncludeDiscoveredSourceFile('/tmp/project/code/shape_manager/package.json', PROJECT_CONTEXT_SOURCE_FILE_RE),
    true,
  );
  assert.equal(
    shouldIncludeDiscoveredSourceFile('/tmp/project/code/shape_manager/README.md', PROJECT_CONTEXT_SOURCE_FILE_RE),
    false,
  );
});

console.log('\nFile discovery tests passed.\n');
