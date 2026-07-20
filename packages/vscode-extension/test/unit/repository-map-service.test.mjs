/**
 * Unit tests for R2-03B RepositoryMapService.
 *
 * Repository mapping turns roots, packages, entries, build/test commands,
 * generated boundaries and excludes into EvidenceRefs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/repository-map-service.bundle.cjs');

execSync(
  `npx esbuild src/app/repository-map-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { buildRepositoryMap } = createRequire(import.meta.url)(bundlePath);

function withTempWorkspace(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-repo-map-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(root, relPath, content = '') {
  const absPath = path.join(root, relPath);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
  return absPath;
}

test('RepositoryMapService: maps monorepo packages, entries, build/test commands and excludes', () => {
  withTempWorkspace((workspace) => {
    write(workspace, 'package.json', JSON.stringify({
      main: 'src/index.ts',
      scripts: { build: 'tsc -b', test: 'node --test' },
    }));
    write(workspace, 'src/index.ts', 'export const root = true;\n');
    write(workspace, 'packages/app/package.json', JSON.stringify({
      main: 'src/main.ts',
      scripts: { build: 'vite build', test: 'vitest run' },
    }));
    write(workspace, 'packages/app/src/main.ts', 'export const app = true;\n');
    write(workspace, 'dist/generated.js', 'generated\n');
    write(workspace, 'node_modules/pkg/index.js', 'ignored\n');

    const map = buildRepositoryMap({ workspaceRoots: [workspace] });
    const evidence = (kind) => map.evidence.filter(item => item.kind === kind);

    assert.equal(map.version, 'devseek.repository-map/v1');
    assert.ok(evidence('root').some(item => item.absPath === workspace));
    assert.deepEqual(evidence('package-manifest').map(item => item.relPath).sort(), [
      'package.json',
      'packages/app/package.json',
    ]);
    assert.ok(evidence('entrypoint').some(item => item.relPath === 'src/index.ts'));
    assert.ok(evidence('entrypoint').some(item => item.relPath === 'packages/app/src/main.ts'));
    assert.ok(evidence('build-command').some(item => item.value === 'npm run build' && item.relPath === 'package.json'));
    assert.ok(evidence('test-command').some(item => item.value === 'npm run test' && item.relPath === 'packages/app/package.json'));
    assert.ok(evidence('generated-boundary').some(item => item.relPath === 'dist/'));
    assert.ok(evidence('excluded-path').some(item => (
      item.relPath === 'node_modules/'
      && item.securityEffect === 'performance-skip-not-security-deny'
    )));
    assert.deepEqual(map.diagnostics.filter(item => item.kind === 'symlink-escape'), []);
  });
});

test('RepositoryMapService: refuses symlink escapes without treating ignores as safety deny', () => {
  withTempWorkspace((workspace) => {
    const outside = mkdtempSync(path.join(tmpdir(), 'devseek-repo-map-outside-'));
    try {
      write(workspace, 'package.json', '{"scripts":{"test":"node --test"}}');
      write(outside, 'secret.ts', 'export const outside = true;\n');
      mkdirSync(path.join(workspace, 'vendor'), { recursive: true });
      symlinkSync(outside, path.join(workspace, 'vendor', 'outside'));

      const map = buildRepositoryMap({ workspaceRoots: [workspace] });
      const symlink = map.diagnostics.find(item => item.kind === 'symlink-escape');

      assert.equal(symlink.relPath, 'vendor/outside');
      assert.ok(!map.evidence.some(item => item.absPath === path.join(outside, 'secret.ts')));
      assert.ok(map.evidence.every(item => item.securityEffect !== 'security-deny'));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('RepositoryMapService: large trees are truncated with evidence instead of broad scans', () => {
  withTempWorkspace((workspace) => {
    write(workspace, 'package.json', '{"scripts":{"build":"tsc"}}');
    for (let i = 0; i < 20; i += 1) {
      write(workspace, `src/file-${i}.ts`, `export const v${i} = ${i};\n`);
    }

    const map = buildRepositoryMap({ workspaceRoots: [workspace], maxEntriesPerRoot: 8 });
    const truncated = map.diagnostics.find(item => item.kind === 'large-tree-truncated');

    assert.equal(truncated.rootAbsPath, workspace);
    assert.ok(map.evidence.some(item => item.kind === 'root' && item.absPath === workspace));
    assert.ok(map.evidence.some(item => item.kind === 'scan-policy' && item.value === 'maxEntriesPerRoot:8'));
  });
});

console.log('\nRepository map service tests passed.\n');
