import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/coding-workspace-batch-mutation-adapter.bundle.cjs');
const editServiceBundlePath = path.join(rootDir, 'test/unit/coding-workspace-batch-edit-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/coding-workspace-batch-mutation-adapter.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/workspace/edit-service.ts --bundle ` +
  `--outfile=${editServiceBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { VsCodeWorkspaceBatchMutationAdapter } = req(bundlePath);
const { WorkspaceEditService } = req(editServiceBundlePath);

function batchItem(edits, root, relPath, content) {
  const absPath = path.join(root, relPath);
  return {
    absPath,
    relPath,
    content,
    baseline: edits.captureTextFileBaseline(absPath, root),
  };
}

test('VS Code batch mutation commits every file under one canonical receipt', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-batch-'));
  const first = path.join(root, 'first.ts');
  const second = path.join(root, 'second.ts');
  writeFileSync(first, 'export const first = 1;\n');
  writeFileSync(second, 'export const second = 1;\n');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceBatchMutationAdapter(edits);
    const outcome = await adapter.execute({
      runId: 'batch-run-1',
      sequence: 1,
      actionId: 'apply-two-files',
      workspaceRoot: root,
      items: [
        batchItem(edits, root, 'first.ts', 'export const first = 2;\n'),
        batchItem(edits, root, 'second.ts', 'export const second = 2;\n'),
      ],
      evidenceRefs: ['authority:workspace-batch'],
    });

    assert.equal(outcome.receipt.status, 'committed');
    assert.deepEqual(outcome.receipt.paths, ['first.ts', 'second.ts']);
    assert.equal(outcome.receipt.result.length, 2);
    assert.equal(readFileSync(first, 'utf8'), 'export const first = 2;\n');
    assert.equal(readFileSync(second, 'utf8'), 'export const second = 2;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('VS Code batch mutation rejects one stale baseline before writing any file', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-batch-stale-'));
  const first = path.join(root, 'first.ts');
  const second = path.join(root, 'second.ts');
  writeFileSync(first, 'export const first = 1;\n');
  writeFileSync(second, 'export const second = 1;\n');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceBatchMutationAdapter(edits);
    const items = [
      batchItem(edits, root, 'first.ts', 'export const first = 2;\n'),
      batchItem(edits, root, 'second.ts', 'export const second = 2;\n'),
    ];
    writeFileSync(second, 'export const userSecond = 7;\n');

    const outcome = await adapter.execute({
      runId: 'batch-run-2',
      sequence: 1,
      actionId: 'reject-stale-batch',
      workspaceRoot: root,
      items,
      evidenceRefs: ['authority:workspace-batch'],
    });

    assert.equal(outcome.receipt.status, 'failed');
    assert.equal(outcome.receipt.errorCode, 'workspace-batch-baseline-conflict');
    assert.equal(readFileSync(first, 'utf8'), 'export const first = 1;\n');
    assert.equal(readFileSync(second, 'utf8'), 'export const userSecond = 7;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('VS Code batch mutation rolls back all files and new directories when readback rejects', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-batch-rollback-'));
  const existing = path.join(root, 'existing.ts');
  const created = path.join(root, 'generated', 'nested', 'created.ts');
  writeFileSync(existing, 'export const existing = 1;\n');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceBatchMutationAdapter(edits);
    let observedCount = 0;
    const outcome = await adapter.execute({
      runId: 'batch-run-3',
      sequence: 1,
      actionId: 'rollback-rejected-batch',
      workspaceRoot: root,
      items: [
        batchItem(edits, root, 'existing.ts', 'export const existing = 2;\n'),
        batchItem(edits, root, 'generated/nested/created.ts', 'export const created = true;\n'),
      ],
      evidenceRefs: ['authority:workspace-batch'],
      verifyReadback: ({ committed }) => {
        observedCount = committed.length;
        return { matches: false, evidenceRefs: ['workspace-quality:failed'] };
      },
    });

    assert.equal(observedCount, 2);
    assert.equal(outcome.receipt.status, 'rolled-back');
    assert.equal(outcome.receipt.errorCode, 'readback-mismatch');
    assert.ok(outcome.receipt.evidenceRefs.includes('workspace-quality:failed'));
    assert.equal(readFileSync(existing, 'utf8'), 'export const existing = 1;\n');
    assert.equal(existsSync(created), false);
    assert.equal(existsSync(path.join(root, 'generated')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
