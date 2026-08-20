import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-context-selector-bundle-'));
const bundlePath = path.join(bundleRoot, 'context-selector.cjs');

buildSync({
  entryPoints: [path.join(cliRoot, 'src/cli-legacy-workspace-context-selector.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { CliLegacyWorkspaceContextSelector } = require(bundlePath);
const selector = new CliLegacyWorkspaceContextSelector();
const workspaceRoots = [];

after(() => {
  for (const workspaceRoot of workspaceRoots) {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
  rmSync(bundleRoot, { recursive: true, force: true });
});

function createWorkspace() {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-context-workspace-'));
  workspaceRoots.push(workspaceRoot);
  return workspaceRoot;
}

function writeWorkspaceFile(workspaceRoot, relativePath, content = '') {
  const absolutePath = path.join(workspaceRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

test('CLI context selector resolves explicit files once and ignores unsafe or missing mentions', async () => {
  const workspaceRoot = createWorkspace();
  writeWorkspaceFile(workspaceRoot, 'src/入口.ts', 'export const value = 1;\n');
  writeWorkspaceFile(workspaceRoot, 'src/large.ts', 'x'.repeat(256 * 1024 + 1));

  const files = await selector.select(
    workspaceRoot,
    'Inspect `src/入口.ts`, src/入口.ts, ../outside.ts, missing.ts and src/large.ts without changing the project.',
  );

  assert.deepEqual(files, ['src/入口.ts']);
});

test('CLI context selector preserves explicit paths in noisy multilingual wording without task keywords', async () => {
  const workspaceRoot = createWorkspace();
  writeWorkspaceFile(workspaceRoot, 'src/入口.ts', 'export const value = 1;\n');
  writeWorkspaceFile(workspaceRoot, 'src/unrelated.ts', 'export const stale = true;\n');

  const files = await selector.select(
    workspaceRoot,
    '请祥细看下 `src/入口.ts`，窝可能有错字，但不要猜其他文件。',
  );

  assert.deepEqual(files, ['src/入口.ts']);
});

test('CLI context selector does not attach implicit project files for a non-coding prompt', async () => {
  const workspaceRoot = createWorkspace();
  writeWorkspaceFile(workspaceRoot, 'package.json', '{}\n');
  writeWorkspaceFile(workspaceRoot, 'src/main.ts', 'export {};\n');

  assert.deepEqual(await selector.select(workspaceRoot, 'Say hello.'), []);
});

test('CLI context selector discovers deterministic bounded project context and skips generated trees', async () => {
  const workspaceRoot = createWorkspace();
  writeWorkspaceFile(workspaceRoot, 'package.json', '{}\n');
  writeWorkspaceFile(workspaceRoot, 'main.ts', 'export {};\n');
  writeWorkspaceFile(workspaceRoot, 'node_modules/ignored.ts', 'ignored\n');
  writeWorkspaceFile(workspaceRoot, 'dist/ignored.ts', 'ignored\n');
  for (let index = 0; index < 30; index++) {
    writeWorkspaceFile(workspaceRoot, `src/file-${String(index).padStart(2, '0')}.ts`, `export const value${index} = ${index};\n`);
  }

  const first = await selector.select(workspaceRoot, 'Fix and test this project.');
  const second = await selector.select(workspaceRoot, 'Fix and test this project.');

  assert.deepEqual(second, first);
  assert.equal(first.length, 20);
  assert.deepEqual(first.slice(0, 4), [
    'package.json',
    'main.ts',
    'src/file-00.ts',
    'src/file-01.ts',
  ]);
  assert.equal(first.some(file => file.includes('node_modules')), false);
  assert.equal(first.some(file => file.includes('dist')), false);
});

test('CLI context selector applies separate byte budgets to explicit and implicit files', async () => {
  const workspaceRoot = createWorkspace();
  writeWorkspaceFile(workspaceRoot, 'src/medium.ts', 'x'.repeat(160 * 1024));

  assert.deepEqual(await selector.select(workspaceRoot, 'Fix this project.'), []);
  assert.deepEqual(
    await selector.select(workspaceRoot, 'Fix src/medium.ts in this project.'),
    ['src/medium.ts'],
  );
});
