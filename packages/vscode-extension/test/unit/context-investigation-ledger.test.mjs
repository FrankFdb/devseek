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

test('delivery convergence admits one precise read and blocks later investigation tools', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const finalRead = ledger.screen([
    { name: 'read_file', input: { path: 'src/controller.cpp', startLine: 300, endLine: 340 } },
    { name: 'grep_search', input: { path: 'src', pattern: 'render' } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
    deliveryContextAdmission: 'one-precise-read',
  });

  assert.equal(finalRead.consumedPreciseContextRead, true);
  assert.equal(finalRead.exhaustedPreciseContextAllowance, false);
  assert.deepEqual([...finalRead.blockedToolIndexes], [1]);
  assert.equal(finalRead.deliveryBlockedToolCount, 1);
  assert.equal(finalRead.suppressedTools[0].reason, 'delivery-context-budget-exhausted');

  const closed = ledger.screen([
    { name: 'read_file', input: { path: 'src/view.cpp', startLine: 1, endLine: 40 } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
    deliveryContextAdmission: 'closed',
  });

  assert.deepEqual([...closed.blockedToolIndexes], [0]);
  assert.match(closed.warnings[0], /必须依据已有证据提交最小修改/u);
});

test('an ineligible final context request exhausts the allowance instead of leaving it open', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const result = ledger.screen([
    { name: 'grep_search', input: { path: 'src', pattern: 'render' } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
    deliveryContextAdmission: 'one-precise-read',
  });

  assert.equal(result.consumedPreciseContextRead, false);
  assert.equal(result.exhaustedPreciseContextAllowance, true);
  assert.equal(result.deliveryBlockedToolCount, 1);
  assert.deepEqual([...result.blockedToolIndexes], [0]);
});

test('a mutation wave or explicit failed-write refresh bypasses delivery context closure', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const mutationWave = ledger.screen([
    { name: 'read_file', input: { path: 'src/controller.cpp', startLine: 1, endLine: 40 } },
    { name: 'replace_in_file', input: { path: 'src/controller.cpp', old_str: 'old', new_str: 'new' } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: true,
    consumeContextRefresh: () => false,
    deliveryContextAdmission: 'closed',
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
    deliveryContextAdmission: 'closed',
  });

  assert.equal(failedWriteRefresh.acceptedRecoveryContextRefresh, true);
  assert.equal(failedWriteRefresh.blockedToolIndexes.size, 0);
});

test('a Provider-recovery-authorized read bypasses only its concrete tool index', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const result = ledger.screen([
    { name: 'read_file', input: { path: 'src/rejected-write.cpp' } },
    { name: 'read_file', input: { path: 'src/unrelated.cpp' } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
    providerRecoveryContextRefreshToolIndexes: new Set([0]),
    deliveryContextAdmission: 'closed',
  });

  assert.deepEqual([...result.blockedToolIndexes], [1]);
  assert.equal(result.deliveryBlockedToolCount, 1);
});

test('delivery convergence does not recount a tool rejected by an earlier admission owner', () => {
  const ledger = new ContextInvestigationLedger('/workspace');
  const result = ledger.screen([
    { name: 'read_file', input: { path: 'src/rejected-by-provider.cpp' } },
  ], {
    progressEpoch: 0,
    hasWorkspaceMutation: false,
    consumeContextRefresh: () => false,
    alreadyBlockedToolIndexes: new Set([0]),
    deliveryContextAdmission: 'closed',
  });

  assert.equal(result.blockedToolIndexes.size, 0);
  assert.equal(result.deliveryBlockedToolCount, 0);
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
