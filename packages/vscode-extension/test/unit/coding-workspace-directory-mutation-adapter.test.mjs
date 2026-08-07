import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { CanonicalWorkspaceMutationTransaction } from '../../../shared/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/coding-workspace-directory-mutation-adapter.bundle.cjs');
const editServiceBundlePath = path.join(rootDir, 'test/unit/coding-workspace-directory-edit-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/coding-workspace-directory-mutation-adapter.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/workspace/edit-service.ts --bundle ` +
  `--outfile=${editServiceBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { VsCodeWorkspaceDirectoryMutationAdapter } = req(bundlePath);
const { WorkspaceEditService } = req(editServiceBundlePath);

test('VS Code directory adapter creates nested parents under one canonical receipt', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-directory-'));
  const target = path.join(root, 'generated', 'nested', 'output');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceDirectoryMutationAdapter(edits);
    const outcome = await adapter.execute({
      transaction: new CanonicalWorkspaceMutationTransaction(),
      runId: 'directory-run-1',
      sequence: 1,
      actionId: 'create-output-directory',
      absPath: target,
      workspaceRoot: root,
      baseline: edits.captureWorkspaceDirectoryBaseline(target, root),
      evidenceRefs: ['authority:create-directory'],
    });

    assert.equal(outcome.receipt.status, 'committed');
    assert.deepEqual(outcome.receipt.paths, ['generated/nested/output']);
    assert.equal(outcome.receipt.result.created, true);
    assert.equal(existsSync(target), true);
    assert.match(outcome.receipt.readbackRef, /^vscode-directory-readback:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('VS Code directory adapter rejects a stale baseline without deleting the user directory', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-directory-stale-'));
  const target = path.join(root, 'user-created');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceDirectoryMutationAdapter(edits);
    const baseline = edits.captureWorkspaceDirectoryBaseline(target, root);
    mkdirSync(target);

    const outcome = await adapter.execute({
      transaction: new CanonicalWorkspaceMutationTransaction(),
      runId: 'directory-run-2',
      sequence: 1,
      actionId: 'reject-stale-directory',
      absPath: target,
      workspaceRoot: root,
      baseline,
      evidenceRefs: ['authority:create-directory'],
    });

    assert.equal(outcome.receipt.status, 'failed');
    assert.equal(outcome.receipt.errorCode, 'workspace-directory-baseline-conflict');
    assert.equal(existsSync(target), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('VS Code directory adapter rolls back the target and created parents after readback rejection', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-directory-rollback-'));
  const target = path.join(root, 'generated', 'nested', 'output');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceDirectoryMutationAdapter(edits);
    const outcome = await adapter.execute({
      transaction: new CanonicalWorkspaceMutationTransaction(),
      runId: 'directory-run-3',
      sequence: 1,
      actionId: 'rollback-directory',
      absPath: target,
      workspaceRoot: root,
      baseline: edits.captureWorkspaceDirectoryBaseline(target, root),
      evidenceRefs: ['authority:create-directory'],
      verifyReadback: () => ({
        matches: false,
        evidenceRefs: ['directory-quality:failed'],
      }),
    });

    assert.equal(outcome.receipt.status, 'rolled-back');
    assert.equal(outcome.receipt.errorCode, 'readback-mismatch');
    assert.ok(outcome.receipt.evidenceRefs.includes('directory-quality:failed'));
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(path.join(root, 'generated')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
