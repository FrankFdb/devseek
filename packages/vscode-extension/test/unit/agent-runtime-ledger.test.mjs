import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCanonicalCheckpointFixture } from '../helpers/canonical-checkpoint-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-runtime-ledger.bundle.cjs');

execSync(
  `npx esbuild src/app/agent-runtime-ledger.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  AgentRuntimeLedger,
  makeOperationId,
  stableHash,
  TaskCheckpointStore,
  TaskHistoryStore,
} = req(bundlePath);

class MemoryStorage {
  data = new Map();
  get(key) { return this.data.get(key); }
  update(key, value) {
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, value);
  }
}

function record(overrides = {}) {
  return {
    id: 'run-1',
    workspaceId: '/tmp/ws',
    title: 'Refactor DevSeek',
    userGoal: 'fix runtime settlement',
    provider: { type: 'bridge' },
    status: 'planned',
    workflowMode: 'edit',
    todos: [],
    changedFiles: [],
    operationRefs: [],
    changeSetRefs: [],
    validationRefs: [],
    evidenceRefs: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test('AgentRuntimeLedger: records task history settlement with evidence refs', async () => {
  const storage = new MemoryStorage();
  const ledger = new AgentRuntimeLedger({
    historyStore: new TaskHistoryStore(storage),
    checkpointStore: new TaskCheckpointStore(storage),
  });

  await ledger.recordTaskStarted(record({ evidenceRefs: ['read:a'] }));
  const settled = await ledger.recordSettlement({
    id: 'run-1',
    status: 'completed',
    changedFiles: ['src/a.ts'],
    evidenceRefs: ['read:a', 'edit:src/a.ts'],
    operationRefs: ['op:write'],
    validationRefs: ['test:unit'],
  });

  assert.equal(settled.status, 'completed');
  assert.deepEqual(settled.evidenceRefs, ['read:a', 'edit:src/a.ts']);
  assert.deepEqual(settled.changedFiles, ['src/a.ts']);
  assert.deepEqual(settled.operationRefs, ['op:write']);
  assert.deepEqual(settled.validationRefs, ['test:unit']);
});

test('AgentRuntimeLedger: checkpoint refs are stable audit handles', async () => {
  const storage = new MemoryStorage();
  const ledger = new AgentRuntimeLedger({
    historyStore: new TaskHistoryStore(storage),
    checkpointStore: new TaskCheckpointStore(storage),
  });

  const tasks = [{ id: 't1' }];
  const ref = await ledger.saveCheckpoint({
    userPrompt: 'continue task',
    displayPrompt: 'continue task',
    wsRootFsPath: '/tmp/ws',
    allTasks: tasks,
    startFromIndex: 0,
    completedCount: 0,
    savedAt: 123,
    sessionId: 'session-1',
    canonicalCheckpoint: createCanonicalCheckpointFixture({
      tasks,
      workspaceRoot: '/tmp/ws',
      userPrompt: 'continue task',
    }),
  });

  assert.equal(ref, 'checkpoint:session-1:0:123');
});

test('AgentRuntimeLedger: committed side effects are not replayed', () => {
  const storage = new MemoryStorage();
  const ledger = new AgentRuntimeLedger({
    historyStore: new TaskHistoryStore(storage),
    checkpointStore: new TaskCheckpointStore(storage),
  });
  const input = { path: 'src/a.ts', content: 'new content' };
  const request = {
    workflowId: 'run-1',
    operationId: makeOperationId('run-1', 'edit', input),
    kind: 'edit',
    inputHash: stableHash(input),
  };

  assert.equal(ledger.decideOperationReplay(request).action, 'execute');
  ledger.markOperationCommitted(request, 'edit:src/a.ts');
  const replay = ledger.decideOperationReplay(request);

  assert.equal(replay.action, 'cached');
  assert.equal(replay.resultRef, 'edit:src/a.ts');
});

console.log('\nAgent runtime ledger tests passed.\n');
