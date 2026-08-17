import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/evidence-aware-memory-write.bundle.cjs');

execFileSync('npx', [
  'esbuild',
  'test/fixtures/evidence-aware-memory-write-entry.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const {
  createDevSeekRunContext,
  createEvidenceAwareMemoryWriteFactory,
  MemoryService,
} = req(bundlePath);

function withTempWorkspace(fn) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'devseek-evidence-memory-'));
  const previousMemoryHome = process.env.DEVSEEK_MEMORY_HOME;
  process.env.DEVSEEK_MEMORY_HOME = path.join(workspace, '.memory-home');
  return Promise.resolve()
    .then(() => fn(workspace))
    .finally(() => {
      if (previousMemoryHome === undefined) delete process.env.DEVSEEK_MEMORY_HOME;
      else process.env.DEVSEEK_MEMORY_HOME = previousMemoryHome;
      rmSync(workspace, { recursive: true, force: true });
    });
}

function createContext(workspace, runId) {
  return createDevSeekRunContext({
    workspaceRoot: workspace,
    userPrompt: '记住这个项目约定',
    mode: 'change',
    runId,
  });
}

function createProposal(workspace) {
  return new MemoryService({ workspaceRoot: workspace }).proposeWrite({
    content: 'src/bridge.ts 的聚焦验证命令是 npm run test:bridge。',
    reason: 'Explicit user memory request',
    tags: ['path:src/bridge.ts'],
  });
}

test('Evidence-aware memory write: rejected confirmation never persists the proposal', async () => {
  await withTempWorkspace(async workspace => {
    const runContext = createContext(workspace, 'memory-write-denied');
    const prepare = createEvidenceAwareMemoryWriteFactory({
      requestConfirmation: async () => ({ allow: false, reason: 'user-declined' }),
    })(runContext, workspace, false);
    const prepared = await prepare(createProposal(workspace));

    assert.equal(prepared.constraint.decision, 'deny');
    const result = await prepared.execute();
    assert.equal(result.status, 'failed');
    assert.equal(new MemoryService({ workspaceRoot: workspace }).retrieve().length, 0);
    runContext.complete('failed', { reason: 'expected user rejection' });
  });
});

test('Evidence-aware memory write: confirmed proposal persists and proves active readback', async () => {
  await withTempWorkspace(async workspace => {
    const runContext = createContext(workspace, 'memory-write-confirmed');
    const prepare = createEvidenceAwareMemoryWriteFactory({
      requestConfirmation: async () => ({
        allow: true,
        confirmationRef: 'unit-test:memory-write-confirmed',
      }),
    })(runContext, workspace, false);
    const prepared = await prepare(createProposal(workspace));

    assert.equal(prepared.constraint.decision, 'require-confirmation');
    assert.equal((await prepared.reconcile()).status, 'not-started');
    const result = await prepared.execute();
    assert.equal(result.status, 'completed');
    assert.equal((await prepared.reconcile()).status, 'committed');
    const records = new MemoryService({ workspaceRoot: workspace }).retrieve();
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'active');
    assert.match(records[0].content, /npm run test:bridge/);
    runContext.complete('completed', { memory_record_id: records[0].id });
  });
});
