import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-history-store.bundle.cjs');

execSync(
  `npx esbuild src/app/task-history-store.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { TaskHistoryStore } = req(bundlePath);

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
    id: 'task-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    repositoryRoot: '/repo',
    branch: 'main',
    title: 'Implement task recovery',
    userGoal: 'make recovery safe',
    provider: { type: 'bridge', model: 'deepseek' },
    status: 'running',
    workflowMode: 'edit',
    todos: [{ id: 'todo-1', title: 'write store', status: 'completed' }],
    changedFiles: ['src/a.ts', 'src/a.ts', 'src/b.ts'],
    operationRefs: ['op-1'],
    changeSetRefs: ['change-1'],
    validationRefs: ['validation-1'],
    qualityGateRef: 'qg-1',
    checkpointRef: 'cp-1',
    pauseReason: '',
    evidenceRefs: ['e1', 'e1', 'e2'],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

test('TaskHistoryStore: upsert normalizes and de-duplicates task refs', async () => {
  const store = new TaskHistoryStore(new MemoryStorage());

  const saved = await store.upsert(record());

  assert.deepEqual(saved.changedFiles, ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(saved.evidenceRefs, ['e1', 'e2']);
  assert.equal(store.get('task-1').title, 'Implement task recovery');
});

test('TaskHistoryStore: markPaused preserves checkpoint and pause reason', async () => {
  const store = new TaskHistoryStore(new MemoryStorage());
  await store.upsert(record());

  const paused = await store.markPaused('task-1', 'recoverable', 'Bridge restarted', 'cp-2');

  assert.equal(paused.status, 'recoverable');
  assert.equal(paused.pauseReason, 'Bridge restarted');
  assert.equal(paused.checkpointRef, 'cp-2');
});

test('TaskHistoryStore: archive moves a task out of active history state', async () => {
  const store = new TaskHistoryStore(new MemoryStorage());
  await store.upsert(record());

  const archived = await store.archive('task-1');

  assert.equal(archived.status, 'archived');
  assert.equal(store.list()[0].id, 'task-1');
});

console.log('\nTask history store tests passed.\n');
