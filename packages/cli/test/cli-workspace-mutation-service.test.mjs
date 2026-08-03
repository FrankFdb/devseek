import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-workspace-mutation-'));
const bundlePath = path.join(bundleRoot, 'mutation-service.cjs');

buildSync({
  entryPoints: [path.join(cliRoot, 'src/cli-workspace-mutation-service.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { CliWorkspaceMutationService } = require(bundlePath);
const service = new CliWorkspaceMutationService();

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createWorkspace(name) {
  const root = mkdtempSync(path.join(tmpdir(), `devseek-cli-mutation-${name}-`));
  const workspace = path.join(root, 'workspace');
  mkdirSync(workspace);
  return { root, workspace };
}

test('CLI workspace mutation service owns ordered tool and diff application with deduplicated receipts', async () => {
  const { root, workspace } = createWorkspace('apply');
  try {
    const files = await service.apply(workspace, {
      fileToolCalls: [{
        name: 'create_file',
        filePath: 'src/value.ts',
        content: 'export const value = 1;\n',
      }],
      unifiedDiffs: [{
        filePath: 'src/value.ts',
        hunks: [{
          oldStart: 1,
          lines: ['-export const value = 1;', '+export const value = 2;'],
        }],
      }],
    });

    assert.deepEqual(files, ['src/value.ts']);
    assert.equal(readFileSync(path.join(workspace, 'src/value.ts'), 'utf8'), 'export const value = 2;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI workspace mutation service rejects traversal before creating an outside artifact', async () => {
  const { root, workspace } = createWorkspace('traversal');
  try {
    await assert.rejects(
      service.apply(workspace, {
        fileToolCalls: [{ name: 'create_file', filePath: '../outside.txt', content: 'blocked\n' }],
        unifiedDiffs: [],
      }),
      /Refusing to write outside workspace/,
    );
    assert.equal(existsSync(path.join(root, 'outside.txt')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI workspace mutation service fails a stale patch without replacing the current file', async () => {
  const { root, workspace } = createWorkspace('stale-patch');
  const target = path.join(workspace, 'value.txt');
  writeFileSync(target, 'current\n', 'utf8');
  try {
    await assert.rejects(
      service.apply(workspace, {
        fileToolCalls: [],
        unifiedDiffs: [{
          filePath: 'value.txt',
          hunks: [{ oldStart: 1, lines: ['-stale', '+replacement'] }],
        }],
      }),
      /Patch context mismatch/,
    );
    assert.equal(readFileSync(target, 'utf8'), 'current\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
