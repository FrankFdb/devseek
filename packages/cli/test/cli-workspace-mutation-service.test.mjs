import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { loadUserSimulationCase } from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-workspace-mutation-'));
const bundlePath = path.join(bundleRoot, 'mutation-service.cjs');

buildSync({
  stdin: {
    contents: `
      export {
        CliWorkspaceMutationHostAdapter,
        collectCliWorkspaceMutationPaths,
      } from './src/cli-workspace-mutation-service';
      export {
        CanonicalWorkspaceMutationTransaction,
        FileSystemCodingOperationJournal,
        buildCodingWorkspaceMutationPlan,
        codingWorkspaceMutationOperationSha256,
      } from '@devseek-netai/shared';
    `,
    resolveDir: cliRoot,
    sourcefile: 'mutation-test-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const {
  CanonicalWorkspaceMutationTransaction,
  FileSystemCodingOperationJournal,
  CliWorkspaceMutationHostAdapter,
  buildCodingWorkspaceMutationPlan,
  codingWorkspaceMutationOperationSha256,
  collectCliWorkspaceMutationPaths,
} = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createWorkspace(name) {
  const root = mkdtempSync(path.join(tmpdir(), `devseek-cli-mutation-${name}-`));
  const workspace = path.join(root, 'workspace');
  mkdirSync(workspace);
  return { root, workspace };
}

function plan(workspaceRoot, proposal, actionId) {
  return buildCodingWorkspaceMutationPlan({
    runId: `run-${actionId}`,
    sequence: 1,
    actionId,
    idempotencyKey: `run-${actionId}:${actionId}`,
    paths: collectCliWorkspaceMutationPaths(proposal),
    payload: { workspaceRoot, proposal },
    evidenceRefs: [`test-plan:${actionId}`],
  });
}

async function execute(workspaceRoot, proposal, actionId, host = new CliWorkspaceMutationHostAdapter()) {
  return new CanonicalWorkspaceMutationTransaction().execute(
    plan(workspaceRoot, proposal, actionId),
    host,
  );
}

test('shared transaction commits CLI tool and diff mutations after exact readback', async () => {
  const { root, workspace } = createWorkspace('apply');
  try {
    const outcome = await execute(workspace, {
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
    }, 'apply-1');

    assert.equal(outcome.receipt.status, 'committed');
    assert.deepEqual(outcome.receipt.result, ['src/value.ts']);
    assert.match(outcome.receipt.baselineRef, /^cli-workspace-baseline:sha256:/);
    assert.match(outcome.receipt.readbackRef, /^cli-workspace-readback:sha256:/);
    assert.equal(readFileSync(path.join(workspace, 'src/value.ts'), 'utf8'), 'export const value = 2;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shared mutation plan rejects traversal before creating an outside artifact', () => {
  const { root, workspace } = createWorkspace('traversal');
  try {
    const proposal = {
      fileToolCalls: [{ name: 'create_file', filePath: '../outside.txt', content: 'blocked\n' }],
      unifiedDiffs: [],
    };
    assert.throws(
      () => plan(workspace, proposal, 'traversal-1'),
      /coding-workspace-mutation:unsafe-path/,
    );
    assert.equal(existsSync(path.join(root, 'outside.txt')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI host rejects a stale patch without replacing the current file', async () => {
  const { root, workspace } = createWorkspace('stale-patch');
  const target = path.join(workspace, 'value.txt');
  writeFileSync(target, 'current\n', 'utf8');
  try {
    const outcome = await execute(workspace, {
      fileToolCalls: [],
      unifiedDiffs: [{
        filePath: 'value.txt',
        hunks: [{ oldStart: 1, lines: ['-stale', '+replacement'] }],
      }],
    }, 'stale-1');

    assert.equal(outcome.receipt.status, 'failed');
    assert.equal(outcome.receipt.errorCode, 'workspace-patch-context-mismatch');
    assert.equal(outcome.receipt.rollbackRef, undefined);
    assert.equal(readFileSync(target, 'utf8'), 'current\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI baseline CAS preserves a concurrent user edit without rollback', async () => {
  const { root, workspace } = createWorkspace('concurrent-edit');
  const target = path.join(workspace, 'value.txt');
  writeFileSync(target, 'baseline\n', 'utf8');
  const adapter = new CliWorkspaceMutationHostAdapter();
  const host = {
    async captureBaseline(mutationPlan) {
      const baseline = await adapter.captureBaseline(mutationPlan);
      writeFileSync(target, 'user edit\n', 'utf8');
      return baseline;
    },
    apply: adapter.apply.bind(adapter),
    readback: adapter.readback.bind(adapter),
    rollback: adapter.rollback.bind(adapter),
  };
  try {
    const outcome = await execute(workspace, {
      fileToolCalls: [{ name: 'create_file', filePath: 'value.txt', content: 'agent edit\n' }],
      unifiedDiffs: [],
    }, 'concurrent-1', host);

    assert.equal(outcome.receipt.status, 'failed');
    assert.equal(outcome.receipt.errorCode, 'workspace-baseline-changed');
    assert.equal(outcome.receipt.rollbackRef, undefined);
    assert.equal(readFileSync(target, 'utf8'), 'user edit\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('I14-CLI-01 user journey: CLI restart recognizes a committed file and skips a second apply', async () => {
  const scenario = loadUserSimulationCase('I14', 'I14-CLI-01');
  const { root, workspace } = createWorkspace('restart-reconcile');
  const target = path.join(workspace, scenario.input.path);
  const proposal = {
    fileToolCalls: [{
      name: 'create_file',
      filePath: scenario.input.path,
      content: scenario.input.content,
    }],
    unifiedDiffs: [],
  };
  try {
    const mutationPlan = plan(workspace, proposal, 'restart-1');
    const host = new CliWorkspaceMutationHostAdapter();
    const baseline = await host.captureBaseline(mutationPlan);
    const journal = FileSystemCodingOperationJournal.forWorkspace(workspace);
    await journal.prepare({
      kind: 'workspace-mutation',
      runId: mutationPlan.runId,
      actionId: mutationPlan.actionId,
      operationSha256: codingWorkspaceMutationOperationSha256(mutationPlan),
      preparation: { plan: mutationPlan, baseline },
    });
    writeFileSync(target, scenario.input.content, 'utf8');

    let applyCalls = 0;
    const recoveryHost = {
      reconcile: host.reconcile.bind(host),
      captureBaseline: host.captureBaseline.bind(host),
      async apply(...args) {
        applyCalls += 1;
        return host.apply(...args);
      },
      readback: host.readback.bind(host),
      rollback: host.rollback.bind(host),
    };
    const outcome = await new CanonicalWorkspaceMutationTransaction(
      FileSystemCodingOperationJournal.forWorkspace(workspace),
    ).execute(mutationPlan, recoveryHost);

    assert.equal(outcome.receipt.status, 'committed');
    assert.equal(outcome.replayed, true);
    assert.equal(applyCalls, 0);
    assert.match(outcome.receipt.readbackRef, /^cli-workspace-reconcile:sha256:/);
    assert.equal(readFileSync(target, 'utf8'), scenario.input.content);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
