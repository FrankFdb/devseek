import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-context-investigation-'));
const bundlePath = path.join(tempRoot, 'context-investigation-ledger.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/context-investigation-ledger.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: rootDir, stdio: 'pipe' });

const { ContextInvestigationLedger } = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

const fullRead = {
  path: '/workspace/src/controller.cpp',
  startLine: 1,
  endLine: 314,
  totalLines: 314,
  sourceSegmentIndex: 0,
};

function visibleRead(path, sourceSegmentIndex = 0, sequence = 1) {
  return [{ kind: 'read', path, sourceSegmentIndex, sequence }];
}

test('a successful broad read covers a later narrow request in the same progress epoch', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  ledger.record({
    tools: [{ name: 'read_file', input: { path: '/workspace/src/controller.cpp' } }],
    progressEpoch: 0,
  });
  ledger.recordVisibleReadExposures([fullRead], visibleRead(fullRead.path));

  const result = ledger.screen([
    { name: 'read_file', input: { path: '/workspace/src/controller.cpp', startLine: 1, endLine: 100 } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });

  assert.deepEqual([...result.blockedToolIndexes], [0]);
  assert.equal(result.suppressedTools[0].reason, 'covered-context-without-progress');
  assert.match(result.warnings[0], /模型已经收到的内容实施修改或形成结论/u);
});

test('only a same-path write, uncovered lines, or an authorized failure refresh permits another read', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  ledger.record({
    tools: [{ name: 'read_file', input: { path: 'src/controller.cpp' } }],
    progressEpoch: 0,
  });
  ledger.recordVisibleReadExposures([fullRead], visibleRead(fullRead.path));
  const request = {
    name: 'read_file',
    input: { path: 'src/controller.cpp', startLine: 300, endLine: 340 },
  };

  assert.equal(ledger.screen([request], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  }).blockedToolIndexes.size, 0);
  assert.deepEqual([...ledger.screen([{ ...request, input: { ...request.input, endLine: 310 } }], {
    progressEpoch: 1,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  }).blockedToolIndexes], [0]);
  ledger.recordVisibleReadExposures([], [
    { kind: 'write', path: '/workspace/src/controller.cpp', sequence: 1 },
  ]);
  assert.equal(ledger.screen([{ ...request, input: { ...request.input, endLine: 310 } }], {
    progressEpoch: 1,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  }).blockedToolIndexes.size, 0);
  assert.equal(ledger.screen([{ ...request, input: { ...request.input, endLine: 310 } }], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => true,
  }).blockedToolIndexes.size, 0);
});

test('Provider session reset forgets coverage that the rebuilt model can no longer see', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  ledger.record({
    tools: [{ name: 'read_file', input: { path: 'src/controller.cpp' } }],
    progressEpoch: 0,
  });
  ledger.recordVisibleReadExposures([fullRead], visibleRead(fullRead.path));
  ledger.reset();

  const result = ledger.screen([
    { name: 'read_file', input: { path: 'src/controller.cpp', startLine: 1, endLine: 100 } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });
  assert.equal(result.blockedToolIndexes.size, 0);
});

test('omitted projected lines remain readable and cannot authorize a source overwrite', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  ledger.recordVisibleReadExposures([
    { path: 'src/main.cpp', startLine: 1, endLine: 66, totalLines: 280, sourceSegmentIndex: 0 },
    { path: 'src/main.cpp', startLine: 215, endLine: 280, totalLines: 280, sourceSegmentIndex: 0 },
  ], visibleRead('src/main.cpp'));

  const result = ledger.screen([
    { name: 'read_file', input: { path: 'src/main.cpp', startLine: 67, endLine: 214 } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });

  assert.equal(result.blockedToolIndexes.size, 0);
  assert.deepEqual(ledger.completeReadPaths(), []);
  ledger.recordVisibleReadExposures([
    { path: 'src/main.cpp', startLine: 67, endLine: 214, totalLines: 280, sourceSegmentIndex: 1 },
  ], visibleRead('src/main.cpp', 1));
  assert.deepEqual(ledger.completeReadPaths(), ['/workspace/src/main.cpp']);
});

test('write ordering keeps only reads of the current file version', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const exposure = {
    path: 'src/main.cpp',
    startLine: 1,
    endLine: 280,
    totalLines: 280,
    sourceSegmentIndex: 0,
  };

  ledger.recordVisibleReadExposures([exposure], [
    { kind: 'read', path: 'src/main.cpp', sequence: 1, sourceSegmentIndex: 0 },
    { kind: 'write', path: 'src/main.cpp', sequence: 2 },
  ]);
  assert.deepEqual(ledger.completeReadPaths(), []);

  ledger.recordVisibleReadExposures([{ ...exposure, sourceSegmentIndex: 1 }], [
    { kind: 'write', path: 'src/main.cpp', sequence: 1 },
    { kind: 'read', path: 'src/main.cpp', sequence: 2, sourceSegmentIndex: 1 },
  ]);
  assert.deepEqual(ledger.completeReadPaths(), ['/workspace/src/main.cpp']);
});
