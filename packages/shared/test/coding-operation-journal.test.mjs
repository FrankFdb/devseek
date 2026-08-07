import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadUserSimulationCase } from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';
import {
  CODING_OPERATION_JOURNAL_DIRECTORY,
  FileSystemCodingOperationJournal,
  codingSemanticDigest,
} from '../dist/index.js';

function preparation(overrides = {}) {
  return {
    kind: 'workspace-mutation',
    runId: 'journal-run',
    actionId: 'write-value',
    operationSha256: codingSemanticDigest({ path: 'src/value.ts', content: 'value' }),
    preparation: { path: 'src/value.ts', baseline: 'absent' },
    ...overrides,
  };
}

test('filesystem operation journal persists one immutable preparation and settlement', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'devseek-operation-journal-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const first = FileSystemCodingOperationJournal.forWorkspace(workspaceRoot);
  const input = preparation();
  await first.prepare(input);
  await first.prepare(input);

  const prepared = await FileSystemCodingOperationJournal.forWorkspace(workspaceRoot).load(
    input.kind,
    input.runId,
    input.actionId,
  );
  assert.equal(prepared.state, 'prepared');
  assert.deepEqual(prepared.preparation, input.preparation);

  const receipt = { status: 'committed', evidenceRefs: ['readback:matched'] };
  await first.settle({ ...input, receipt });
  await first.settle({ ...input, receipt });
  const settled = await FileSystemCodingOperationJournal.forWorkspace(workspaceRoot).load(
    input.kind,
    input.runId,
    input.actionId,
  );
  assert.equal(settled.state, 'settled');
  assert.deepEqual(settled.receipt, receipt);
  assert.equal(Object.isFrozen(settled), true);

  const files = await readdir(join(workspaceRoot, CODING_OPERATION_JOURNAL_DIRECTORY));
  assert.equal(files.filter(file => file.endsWith('.prepared.json')).length, 1);
  assert.equal(files.filter(file => file.endsWith('.settled.json')).length, 1);
});

test('filesystem operation journal rejects identity reuse and record tampering', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'devseek-operation-tamper-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const journal = FileSystemCodingOperationJournal.forWorkspace(workspaceRoot);
  const input = preparation();
  await journal.prepare(input);
  await assert.rejects(
    journal.prepare(preparation({ preparation: { path: 'src/other.ts', baseline: 'absent' } })),
    /coding-operation-journal:conflicting-operation-record|coding-operation-journal:conflicting-operation-identity/u,
  );

  const directory = join(workspaceRoot, CODING_OPERATION_JOURNAL_DIRECTORY);
  const preparedFile = (await readdir(directory)).find(file => file.endsWith('.prepared.json'));
  const preparedPath = join(directory, preparedFile);
  const record = JSON.parse(await readFile(preparedPath, 'utf8'));
  await writeFile(preparedPath, `${JSON.stringify({ ...record, operationSha256: '0'.repeat(64) })}\n`);
  await assert.rejects(
    FileSystemCodingOperationJournal.forWorkspace(workspaceRoot).load(
      input.kind,
      input.runId,
      input.actionId,
    ),
    /coding-operation-journal:record-sha256-mismatch/u,
  );
});

test('filesystem operation journal rejects a symbolic-link record file', async t => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'devseek-operation-record-link-'));
  const outsideRoot = await mkdtemp(join(tmpdir(), 'devseek-operation-record-target-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  t.after(() => rm(outsideRoot, { recursive: true, force: true }));
  const journal = FileSystemCodingOperationJournal.forWorkspace(workspaceRoot);
  const input = preparation();
  await journal.prepare(input);
  const directory = join(workspaceRoot, CODING_OPERATION_JOURNAL_DIRECTORY);
  const preparedFile = (await readdir(directory)).find(file => file.endsWith('.prepared.json'));
  const preparedPath = join(directory, preparedFile);
  const outsidePath = join(outsideRoot, 'forged-record.json');
  await writeFile(outsidePath, '{}\n');
  await unlink(preparedPath);
  await symlink(outsidePath, preparedPath, 'file');

  await assert.rejects(
    journal.load(input.kind, input.runId, input.actionId),
    /coding-operation-journal:record-not-regular-file/u,
  );
});

test('I14-JRN-01 user journey: workspace metadata symlink cannot redirect durable evidence', async t => {
  const scenario = loadUserSimulationCase('I14', 'I14-JRN-01');
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'devseek-operation-symlink-'));
  const outsideRoot = await mkdtemp(join(tmpdir(), 'devseek-operation-outside-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  t.after(() => rm(outsideRoot, { recursive: true, force: true }));
  await symlink(outsideRoot, join(workspaceRoot, scenario.input.workspace_entry), 'dir');

  await assert.rejects(
    FileSystemCodingOperationJournal.forWorkspace(workspaceRoot).prepare(preparation()),
    /coding-operation-journal:unsafe-journal-directory/u,
  );
  assert.equal((await readdir(outsideRoot)).length, scenario.input.expected_external_files);
});
