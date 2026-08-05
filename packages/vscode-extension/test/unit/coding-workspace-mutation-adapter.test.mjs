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
const bundlePath = path.join(rootDir, 'test/unit/coding-workspace-mutation-adapter.bundle.cjs');
const editServiceBundlePath = path.join(rootDir, 'test/unit/coding-workspace-edit-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/coding-workspace-mutation-adapter.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/workspace/edit-service.ts --bundle ` +
  `--outfile=${editServiceBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { VsCodeWorkspaceMutationAdapter } = req(bundlePath);
const { WorkspaceEditService } = req(editServiceBundlePath);

test('VS Code workspace adapter commits and independently reads back exact content', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-mutation-'));
  const target = path.join(root, 'main.ts');
  writeFileSync(target, 'export const value = 1;\n');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceMutationAdapter(edits);
    const baseline = edits.captureTextFileBaseline(target, root);
    const outcome = await adapter.executeTextFileWrite({
      runId: 'run-1',
      sequence: 1,
      actionId: 'write-main',
      absPath: target,
      workspaceRoot: root,
      content: 'export const value = 2;\n',
      applyOptions: { validateSourceSanity: true },
      baseline,
      evidenceRefs: ['authority:file-write'],
    });

    assert.equal(outcome.receipt.status, 'committed');
    assert.equal(outcome.receipt.result.result.newContent, 'export const value = 2;\n');
    assert.equal(readFileSync(target, 'utf8'), 'export const value = 2;\n');
    assert.match(outcome.receipt.readbackRef, /^vscode-text-readback:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('VS Code workspace adapter rejects a stale authorized baseline without overwriting user edits', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-mutation-stale-'));
  const target = path.join(root, 'main.ts');
  writeFileSync(target, 'export const value = 1;\n');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceMutationAdapter(edits);
    const baseline = edits.captureTextFileBaseline(target, root);
    writeFileSync(target, 'export const userValue = 7;\n');

    const outcome = await adapter.executeTextFileWrite({
      runId: 'run-2',
      sequence: 1,
      actionId: 'write-stale-main',
      absPath: target,
      workspaceRoot: root,
      content: 'export const value = 2;\n',
      applyOptions: { validateSourceSanity: true },
      baseline,
      evidenceRefs: ['authority:file-write'],
    });

    assert.equal(outcome.receipt.status, 'failed');
    assert.equal(outcome.receipt.errorCode, 'workspace-baseline-conflict');
    assert.equal(readFileSync(target, 'utf8'), 'export const userValue = 7;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('VS Code workspace adapter rolls back when the caller-owned readback oracle rejects committed content', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-mutation-oracle-'));
  const target = path.join(root, 'report.md');
  writeFileSync(target, '# Original\n');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceMutationAdapter(edits);
    let observedContent = '';
    const outcome = await adapter.executeTextFileWrite({
      runId: 'run-oracle',
      sequence: 1,
      actionId: 'write-report',
      absPath: target,
      workspaceRoot: root,
      content: '# Candidate\n',
      applyOptions: {},
      baseline: edits.captureTextFileBaseline(target, root),
      evidenceRefs: ['authority:file-write'],
      verifyReadback: ({ content }) => {
        observedContent = content;
        return { matches: false, evidenceRefs: ['report-oracle:failed'] };
      },
    });

    assert.equal(observedContent, '# Candidate\n');
    assert.equal(outcome.receipt.status, 'rolled-back');
    assert.equal(outcome.receipt.errorCode, 'readback-mismatch');
    assert.ok(outcome.receipt.evidenceRefs.includes('report-oracle:failed'));
    assert.equal(readFileSync(target, 'utf8'), '# Original\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('VS Code workspace adapter replays a settled write without applying it twice', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-mutation-replay-'));
  const target = path.join(root, 'main.ts');
  writeFileSync(target, 'one\n');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceMutationAdapter(edits);
    const request = {
      runId: 'run-3',
      sequence: 1,
      actionId: 'write-replay',
      absPath: target,
      workspaceRoot: root,
      content: 'two\n',
      applyOptions: {},
      baseline: edits.captureTextFileBaseline(target, root),
      evidenceRefs: ['authority:file-write'],
    };

    const first = await adapter.executeTextFileWrite(request);
    writeFileSync(target, 'later user edit\n');
    const replay = await adapter.executeTextFileWrite(request);

    assert.equal(first.receipt.status, 'committed');
    assert.equal(replay.replayed, true);
    assert.equal(readFileSync(target, 'utf8'), 'later user edit\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('VS Code workspace adapter deletes through baseline, readback, and receipt settlement', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-delete-'));
  const target = path.join(root, 'obsolete.ts');
  writeFileSync(target, 'export const obsolete = true;\n');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceMutationAdapter(edits);
    const outcome = await adapter.executeTextFileDelete({
      runId: 'run-delete-1',
      sequence: 1,
      actionId: 'delete-obsolete',
      absPath: target,
      workspaceRoot: root,
      baseline: edits.captureTextFileBaseline(target, root),
      evidenceRefs: ['authority:file-delete'],
    });

    assert.equal(outcome.receipt.status, 'committed');
    assert.equal(outcome.receipt.result.deleted, true);
    assert.equal(existsSync(target), false);
    assert.match(outcome.receipt.readbackRef, /^vscode-delete-readback:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('VS Code workspace adapter rejects stale delete authority without removing the replacement file', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-delete-stale-'));
  const target = path.join(root, 'keep.ts');
  writeFileSync(target, 'export const before = 1;\n');
  try {
    const edits = new WorkspaceEditService();
    const adapter = new VsCodeWorkspaceMutationAdapter(edits);
    const baseline = edits.captureTextFileBaseline(target, root);
    writeFileSync(target, 'export const userReplacement = 2;\n');
    const outcome = await adapter.executeTextFileDelete({
      runId: 'run-delete-2',
      sequence: 1,
      actionId: 'delete-stale',
      absPath: target,
      workspaceRoot: root,
      baseline,
      evidenceRefs: ['authority:file-delete'],
    });

    assert.equal(outcome.receipt.status, 'failed');
    assert.equal(outcome.receipt.errorCode, 'workspace-baseline-conflict');
    assert.equal(readFileSync(target, 'utf8'), 'export const userReplacement = 2;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
