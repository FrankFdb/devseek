/**
 * Unit tests for workspace/edit-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/workspace-edit-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/edit-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const { WorkspaceEditService } = req(bundlePath);

test('WorkspaceEditService: creates parent directories and writes text files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'nested', 'hello.txt');
    const service = new WorkspaceEditService();
    const result = service.writeTextFileSync(target, 'hello');
    assert.deepEqual(result, { existed: false, oldContent: '', newContent: 'hello' });
    assert.equal(readFileSync(target, 'utf8'), 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: returns old content when overwriting', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'hello.txt');
    const service = new WorkspaceEditService();
    service.writeTextFileSync(target, 'old');
    const result = service.writeTextFileSync(target, 'new');
    assert.deepEqual(result, { existed: true, oldContent: 'old', newContent: 'new' });
    assert.equal(readFileSync(target, 'utf8'), 'new');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: proposes text writes without touching disk', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'draft.txt');
    const service = new WorkspaceEditService();
    const proposal = service.proposeTextFileWrite(target, 'draft');

    assert.equal(proposal.kind, 'write-text-file');
    assert.equal(proposal.absPath, target);
    assert.equal(proposal.content, 'draft');
    assert.equal(readFileSyncSafe(target), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: snapshots file state before applying a proposal', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'hello.txt');
    const service = new WorkspaceEditService();

    assert.deepEqual(service.snapshotTextFile(target), {
      absPath: target,
      existed: false,
      content: '',
    });

    service.writeTextFileSync(target, 'old');
    assert.deepEqual(service.snapshotTextFile(target), {
      absPath: target,
      existed: true,
      content: 'old',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: applies proposals with attached snapshot evidence', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'nested', 'hello.txt');
    const service = new WorkspaceEditService();
    const proposal = service.proposeTextFileWrite(target, 'new');
    const applied = service.applyTextFileProposal(proposal);

    assert.equal(applied.proposal, proposal);
    assert.deepEqual(applied.snapshot, {
      absPath: target,
      existed: false,
      content: '',
    });
    assert.deepEqual(applied.result, {
      existed: false,
      oldContent: '',
      newContent: 'new',
    });
    assert.equal(readFileSync(target, 'utf8'), 'new');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readFileSyncSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

console.log('\nWorkspace edit service tests passed.\n');
