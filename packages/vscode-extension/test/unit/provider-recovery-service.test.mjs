import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/provider-recovery-service.bundle.cjs');
const historyBundlePath = path.join(rootDir, 'test/unit/provider-recovery-history.bundle.cjs');

execSync(
  `npx esbuild src/app/provider-recovery-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/task-history-store.ts --bundle ` +
  `--outfile=${historyBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ProviderRecoveryService } = req(bundlePath);
const { TaskHistoryStore } = req(historyBundlePath);

class MemoryStorage {
  data = new Map();
  get(key) { return this.data.get(key); }
  update(key, value) {
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, value);
  }
}

function task(overrides = {}) {
  return {
    id: 'task-1',
    workspaceId: 'workspace-1',
    title: 'Recover provider failure',
    userGoal: 'continue safely',
    provider: { type: 'bridge' },
    status: 'running',
    workflowMode: 'edit',
    todos: [],
    changedFiles: [],
    operationRefs: [],
    changeSetRefs: [],
    validationRefs: [],
    evidenceRefs: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

test('ProviderRecoveryService: login required pauses task for user action', () => {
  const plan = new ProviderRecoveryService().classify({
    providerType: 'bridge',
    statusCode: 401,
    message: 'LOGIN_REQUIRED',
  });

  assert.equal(plan.kind, 'LoginRequired');
  assert.equal(plan.taskStatus, 'paused');
  assert.equal(plan.requiresUserAction, true);
  assert.equal(plan.safeToContinueFromCheckpoint, false);
});

test('ProviderRecoveryService: corrupted response is recoverable from checkpoint', () => {
  const plan = new ProviderRecoveryService().classify({
    providerType: 'bridge',
    message: 'tool parse failed because response was truncated',
    partialResponse: '[TOOL:write_file {"path":"a.ts"',
  });

  assert.equal(plan.kind, 'ResponseCorrupted');
  assert.equal(plan.taskStatus, 'recoverable');
  assert.equal(plan.canRetry, true);
  assert.equal(plan.safeToContinueFromCheckpoint, true);
});

test('ProviderRecoveryService: bridge restart records recoverable task history', async () => {
  const history = new TaskHistoryStore(new MemoryStorage());
  const service = new ProviderRecoveryService(history);
  await history.upsert(task());

  const saved = await service.recordRecovery(task(), {
    providerType: 'bridge',
    bridgeRestarted: true,
    message: 'bridge restarted',
  }, 'checkpoint-1');

  assert.equal(saved.status, 'recoverable');
  assert.equal(saved.checkpointRef, 'checkpoint-1');
  assert.ok(saved.evidenceRefs.includes('provider:BridgeRestarted'));
});

console.log('\nProvider recovery service tests passed.\n');
