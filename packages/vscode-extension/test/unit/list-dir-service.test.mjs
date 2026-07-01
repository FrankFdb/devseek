/**
 * Unit tests for workspace/list-dir-service.ts.
 *
 * Contract: AI directory exploration should expose source context, not legacy
 * build output aliases. Build layout compatibility stays in cpp-build-layout.
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
const bundlePath = path.join(rootDir, 'test/unit/list-dir-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/list-dir-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { listWorkspaceDirectoryForAi } = req(bundlePath);

test('list_dir hides legacy C++ build directories from project listings', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-list-dir-'));
  try {
    mkdirSync(path.join(root, 'src'));
    mkdirSync(path.join(root, 'build'));
    mkdirSync(path.join(root, '.devseek-build'));
    writeFileSync(path.join(root, 'CMakeLists.txt'), 'project(example)\n');

    const listing = listWorkspaceDirectoryForAi(root, '.');

    assert.match(listing, /\[dir\]\s+src/);
    assert.match(listing, /\[dir\]\s+build/);
    assert.match(listing, /\[file\]\s+CMakeLists\.txt/);
    assert.doesNotMatch(listing, /devseek-build/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('list_dir returns a stable notice when a legacy build directory is requested explicitly', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-list-dir-'));
  try {
    mkdirSync(path.join(root, '.devseek-build'));
    writeFileSync(path.join(root, '.devseek-build', 'stale'), 'old');

    const listing = listWorkspaceDirectoryForAi(root, '.devseek-build');

    assert.match(listing, /旧构建目录已隐藏/);
    assert.match(listing, /build\//);
    assert.doesNotMatch(listing, /stale/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log('\nList dir service tests passed.\n');
