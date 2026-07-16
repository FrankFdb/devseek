import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-checkpoint-store.bundle.cjs');

execSync(
  `npx esbuild src/app/task-checkpoint-store.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { TaskCheckpointStore } = req(bundlePath);

class MemoryStorage {
  data = new Map();
  get(key) { return this.data.get(key); }
  update(key, value) {
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, value);
  }
}

function checkpoint(overrides = {}) {
  return {
    userPrompt: 'continue task',
    displayPrompt: 'continue task',
    mode: 'fast',
    wsRootFsPath: '/repo',
    allTasks: [{ title: 'one' }, { title: 'two' }],
    startFromIndex: 0,
    completedCount: 0,
    savedAt: 1_000,
    sessionId: 's1',
    ...overrides,
  };
}

test('TaskCheckpointStore: save/load normalizes task indexes', async () => {
  const storage = new MemoryStorage();
  const store = new TaskCheckpointStore(storage);

  await store.save(checkpoint({ startFromIndex: 99, completedCount: -4 }));

  const loaded = store.load();
  assert.equal(loaded.startFromIndex, 2);
  assert.equal(loaded.completedCount, 0);
  assert.equal(loaded.allTasks.length, 2);
});

test('TaskCheckpointStore: loadFresh clears stale checkpoint', async () => {
  const storage = new MemoryStorage();
  const store = new TaskCheckpointStore(storage);
  await store.save(checkpoint({ savedAt: 100 }));

  const fresh = await store.loadFresh(200, 1_000);

  assert.equal(fresh, undefined);
  assert.equal(store.load(), undefined);
});

test('TaskCheckpointStore: loadFresh returns current checkpoint', async () => {
  const storage = new MemoryStorage();
  const store = new TaskCheckpointStore(storage);
  await store.save(checkpoint({ savedAt: 900 }));

  const fresh = await store.loadFresh(200, 1_000);

  assert.equal(fresh.checkpoint.sessionId, 's1');
  assert.equal(fresh.stale, false);
});

test('TaskCheckpointStore: loadFresh clears checkpoint from a different workspace or session', async () => {
  const wrongWorkspaceStorage = new MemoryStorage();
  const wrongWorkspaceStore = new TaskCheckpointStore(wrongWorkspaceStorage);
  await wrongWorkspaceStore.save(checkpoint({ savedAt: 900, wsRootFsPath: '/repo-a', sessionId: 's1' }));

  const wrongWorkspace = await wrongWorkspaceStore.loadFresh(200, 1_000, {
    wsRootFsPath: '/repo-b',
    sessionId: 's1',
  });

  assert.equal(wrongWorkspace, undefined);
  assert.equal(wrongWorkspaceStore.load(), undefined);

  const wrongSessionStorage = new MemoryStorage();
  const wrongSessionStore = new TaskCheckpointStore(wrongSessionStorage);
  await wrongSessionStore.save(checkpoint({ savedAt: 900, wsRootFsPath: '/repo-a', sessionId: 's1' }));

  const wrongSession = await wrongSessionStore.loadFresh(200, 1_000, {
    wsRootFsPath: '/repo-a',
    sessionId: 's2',
  });

  assert.equal(wrongSession, undefined);
  assert.equal(wrongSessionStore.load(), undefined);
});

test('TaskCheckpointStore: loadScoped refuses mismatched checkpoint without returning resumable facts', async () => {
  const storage = new MemoryStorage();
  const store = new TaskCheckpointStore(storage);
  await store.save(checkpoint({ wsRootFsPath: '/repo-a', sessionId: 's1' }));

  assert.equal(store.loadScoped({ wsRootFsPath: '/repo-a', sessionId: 's1' }).sessionId, 's1');
  assert.equal(store.loadScoped({ wsRootFsPath: '/repo-a', sessionId: 's2' }), undefined);
  assert.equal(store.loadScoped({ wsRootFsPath: '/repo-b', sessionId: 's1' }), undefined);
});

test('TaskCheckpointStore: loadFresh clears completed checkpoint', async () => {
  const storage = new MemoryStorage();
  const store = new TaskCheckpointStore(storage);
  await store.save(checkpoint({ savedAt: 900, startFromIndex: 2, completedCount: 2 }));

  const fresh = await store.loadFresh(200, 1_000);

  assert.equal(fresh, undefined);
  assert.equal(store.load(), undefined);
});

console.log('\nTask checkpoint store tests passed.\n');
