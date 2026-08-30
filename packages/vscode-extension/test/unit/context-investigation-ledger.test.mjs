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

test('visible read progress advances only when the Provider receives uncovered source lines', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const first = ledger.recordVisibleReadExposures([{
    ...fullRead,
    endLine: 120,
  }], visibleRead(fullRead.path, 0, 1));
  const overlap = ledger.recordVisibleReadExposures([{
    ...fullRead,
    startLine: 40,
    endLine: 80,
  }], visibleRead(fullRead.path, 0, 2));
  const extension = ledger.recordVisibleReadExposures([{
    ...fullRead,
    startLine: 100,
    endLine: 180,
  }], visibleRead(fullRead.path, 0, 3));

  assert.equal(first.novelExposureCount, 1);
  assert.equal(overlap.novelExposureCount, 0);
  assert.equal(extension.novelExposureCount, 1);
  assert.deepEqual([...ledger.screen([{
    name: 'read_file',
    input: { path: 'src/controller.cpp', startLine: 1, endLine: 180 },
  }], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  }).blockedToolIndexes], [0]);
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
  const acceptedRefresh = ledger.screen([{ ...request, input: { ...request.input, endLine: 310 } }], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => true,
  });
  assert.equal(acceptedRefresh.blockedToolIndexes.size, 0);
  assert.equal(acceptedRefresh.acceptedRecoveryContextRefresh, true);
});

test('an authorized failure refresh is reported even for a previously unread range', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const result = ledger.screen([{
    name: 'read_file',
    input: { path: 'src/controller.cpp', startLine: 410, endLine: 430 },
  }], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: path => path === 'src/controller.cpp',
  });

  assert.equal(result.blockedToolIndexes.size, 0);
  assert.equal(result.acceptedRecoveryContextRefresh, true);
});

test('distinct context proposals stay open while repeated proposals are suppressed', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const proposals = [
    { name: 'read_file', input: { path: 'src/controller.cpp', startLine: 300, endLine: 340 } },
    { name: 'grep_search', input: { path: 'src', pattern: 'render' } },
  ];
  const first = ledger.screen(proposals, {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });
  assert.equal(first.blockedToolIndexes.size, 0);
  assert.equal(first.admittedNovelContextToolCount, 2);
  assert.equal(first.admittedNovelReadToolCount, 1);
  assert.equal(first.suppressedContextToolCount, 0);

  ledger.record({ tools: proposals, progressEpoch: 0 });
  const repeated = ledger.screen(proposals, {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });
  assert.deepEqual([...repeated.blockedToolIndexes], [0, 1]);
  assert.equal(repeated.admittedNovelContextToolCount, 0);
  assert.equal(repeated.suppressedContextToolCount, 2);
  assert.equal(repeated.suppressedTools[0].reason, 'repeated-context-without-progress');
});

test('fair read projection preserves continuations without closing unrelated novel context', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const projectedExposures = [
    { path: '/workspace/src/controller.cpp', startLine: 1, endLine: 30, totalLines: 358, sourceSegmentIndex: 0 },
    { path: '/workspace/src/controller.cpp', startLine: 330, endLine: 358, totalLines: 358, sourceSegmentIndex: 0 },
    { path: '/workspace/src/main.cpp', startLine: 1, endLine: 39, totalLines: 344, sourceSegmentIndex: 1 },
    { path: '/workspace/src/main.cpp', startLine: 306, endLine: 344, totalLines: 344, sourceSegmentIndex: 1 },
  ];
  ledger.recordVisibleReadExposures(projectedExposures, [
    ...visibleRead('/workspace/src/controller.cpp', 0, 1),
    ...visibleRead('/workspace/src/main.cpp', 1, 2),
  ]);

  const result = ledger.screen([
    { name: 'read_file', input: { path: 'src/controller.cpp', startLine: 31, endLine: 329 } },
    { name: 'read_file', input: { path: 'src/main.cpp', startLine: 40, endLine: 305 } },
    { name: 'read_file', input: { path: 'src/unrelated.cpp' } },
    { name: 'grep_search', input: { path: 'src', pattern: 'render' } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });

  assert.deepEqual([...result.blockedToolIndexes], []);
  assert.equal(result.suppressedContextToolCount, 0);

  const widened = ledger.screen([{
    name: 'read_file',
    input: { path: 'src/controller.cpp', startLine: 31, endLine: 340 },
  }], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });
  assert.deepEqual([...widened.blockedToolIndexes], []);
});

test('projected read debt corrects a stale same-file range and closes after visible delivery', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  ledger.recordVisibleReadExposures([
    { path: '/workspace/src/controller.cpp', startLine: 1, endLine: 115, totalLines: 369, sourceSegmentIndex: 0 },
    { path: '/workspace/src/controller.cpp', startLine: 256, endLine: 369, totalLines: 369, sourceSegmentIndex: 0 },
  ], visibleRead('/workspace/src/controller.cpp', 0, 7));

  const proposed = [{
    name: 'read_file',
    input: { path: 'src/controller.cpp', startLine: 1, endLine: 115 },
  }];
  const continuation = ledger.reconcileProjectedReadContinuations(proposed);
  assert.deepEqual([...continuation.continuationToolIndexes], [0]);
  assert.deepEqual(continuation.inputOverrides.get(0), {
    path: 'src/controller.cpp',
    startLine: 116,
    endLine: 255,
  });
  assert.match(continuation.warnings[0], /实际读取范围：startLine=116, endLine=255/u);

  const reconciled = [{ ...proposed[0], input: continuation.inputOverrides.get(0) }];
  const screened = ledger.screen(reconciled, {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });
  assert.deepEqual([...screened.blockedToolIndexes], []);

  ledger.recordVisibleReadExposures([{
    path: '/workspace/src/controller.cpp',
    startLine: 116,
    endLine: 255,
    totalLines: 369,
    sourceSegmentIndex: 0,
  }], visibleRead('/workspace/src/controller.cpp', 0, 8));
  const settled = ledger.reconcileProjectedReadContinuations(proposed);
  assert.deepEqual([...settled.continuationToolIndexes], []);
  assert.equal(settled.inputOverrides.size, 0);
});

test('separate partial reads never create host-owned projected read debt', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  ledger.recordVisibleReadExposures([
    { path: '/workspace/src/controller.cpp', startLine: 1, endLine: 115, totalLines: 369, sourceSegmentIndex: 0 },
    { path: '/workspace/src/controller.cpp', startLine: 256, endLine: 369, totalLines: 369, sourceSegmentIndex: 1 },
  ], [
    ...visibleRead('/workspace/src/controller.cpp', 0, 7),
    ...visibleRead('/workspace/src/controller.cpp', 1, 8),
  ]);

  const resolution = ledger.reconcileProjectedReadContinuations([{
    name: 'read_file',
    input: { path: 'src/controller.cpp', startLine: 1, endLine: 115 },
  }]);
  assert.equal(resolution.continuationToolIndexes.size, 0);
  assert.equal(resolution.inputOverrides.size, 0);
});

test('projected read debt tracks only the undelivered remainder and expires on mutation', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  ledger.recordVisibleReadExposures([
    { path: '/workspace/src/controller.cpp', startLine: 1, endLine: 115, totalLines: 369, sourceSegmentIndex: 0 },
    { path: '/workspace/src/controller.cpp', startLine: 256, endLine: 369, totalLines: 369, sourceSegmentIndex: 0 },
  ], visibleRead('/workspace/src/controller.cpp', 0, 7));
  ledger.recordVisibleReadExposures([{
    path: '/workspace/src/controller.cpp',
    startLine: 116,
    endLine: 200,
    totalLines: 369,
    sourceSegmentIndex: 0,
  }], visibleRead('/workspace/src/controller.cpp', 0, 8));

  const proposed = [{
    name: 'read_file',
    input: { path: 'src/controller.cpp', startLine: 1, endLine: 115 },
  }];
  const remainder = ledger.reconcileProjectedReadContinuations(proposed);
  assert.deepEqual(remainder.inputOverrides.get(0), {
    path: 'src/controller.cpp',
    startLine: 201,
    endLine: 255,
  });

  ledger.recordVisibleReadExposures([], [{
    kind: 'write',
    path: '/workspace/src/controller.cpp',
    sequence: 9,
  }]);
  const invalidated = ledger.reconcileProjectedReadContinuations(proposed);
  assert.equal(invalidated.continuationToolIndexes.size, 0);
  assert.equal(invalidated.inputOverrides.size, 0);
});

test('a novel search remains admitted until duplicate evidence proves stagnation', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const result = ledger.screen([
    { name: 'grep_search', input: { path: 'src', pattern: 'render' } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
  });

  assert.equal(result.suppressedContextToolCount, 0);
  assert.equal(result.admittedNovelContextToolCount, 1);
  assert.equal(result.admittedNovelReadToolCount, 0);
  assert.deepEqual([...result.blockedToolIndexes], []);
});

test('a mutation wave and explicit failed-write refresh leave dependency reads available', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const mutationWave = ledger.screen([
    { name: 'read_file', input: { path: 'src/controller.cpp', startLine: 1, endLine: 40 } },
    { name: 'replace_in_file', input: { path: 'src/controller.cpp', old_str: 'old', new_str: 'new' } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: true,
    consumeContextRefresh: () => false,
  });
  assert.equal(mutationWave.blockedToolIndexes.size, 0);

  let refreshAvailable = true;
  const failedWriteRefresh = ledger.screen([
    { name: 'read_file', input: { path: 'src/controller.cpp', startLine: 40, endLine: 80 } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: path => {
      if (refreshAvailable && path === 'src/controller.cpp') {
        refreshAvailable = false;
        return true;
      }
      return false;
    },
  });

  assert.equal(failedWriteRefresh.acceptedRecoveryContextRefresh, true);
  assert.equal(failedWriteRefresh.blockedToolIndexes.size, 0);
});

test('a Provider-recovery-authorized read bypasses only its concrete tool index', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const proposals = [
    { name: 'read_file', input: { path: 'src/rejected-write.cpp' } },
    { name: 'read_file', input: { path: 'src/unrelated.cpp' } },
  ];
  ledger.record({ tools: proposals, progressEpoch: 0 });
  const result = ledger.screen(proposals, {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
    providerRecoveryContextRefreshToolIndexes: new Set([0]),
  });

  assert.deepEqual([...result.blockedToolIndexes], [1]);
  assert.equal(result.suppressedContextToolCount, 1);
});

test('context investigation does not recount a tool rejected by an earlier admission owner', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const result = ledger.screen([
    { name: 'read_file', input: { path: 'src/rejected-by-provider.cpp' } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
    alreadyBlockedToolIndexes: new Set([0]),
  });

  assert.equal(result.blockedToolIndexes.size, 0);
  assert.equal(result.suppressedContextToolCount, 0);
  assert.equal(result.suppressedTools.length, 0);
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

test('a visible partial read authorizes targeted repair evidence but not full-file overwrite evidence', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const partialRead = {
    path: '/workspace/src/controller.cpp',
    startLine: 120,
    endLine: 170,
    totalLines: 356,
    sourceSegmentIndex: 0,
  };
  ledger.recordVisibleReadExposures([partialRead], visibleRead(partialRead.path));

  assert.deepEqual(ledger.visibleReadPaths(), ['/workspace/src/controller.cpp']);
  assert.deepEqual(ledger.completeReadPaths(), []);

  ledger.recordVisibleReadExposures([], [
    { kind: 'write', path: partialRead.path, sequence: 2 },
  ]);
  assert.deepEqual(ledger.visibleReadPaths(), []);
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
