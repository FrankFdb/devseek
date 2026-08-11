import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const repoRoot = path.resolve(rootDir, '../..');
const bundlePath = path.join(rootDir, 'test/unit/task-history-projection-service.bundle.cjs');

execSync('npm run build --workspace=packages/shared', { cwd: repoRoot, stdio: 'pipe' });
execSync(
  `npx esbuild src/app/task-history-projection-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  ProductRunEvidenceSession,
  createProductRunEvidenceAuthorityToken,
  productRunEvidenceIdempotencyKey,
} = req('@devseek-netai/shared');
const { TaskHistoryProjectionService } = req(bundlePath);

function withTempWorkspace(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-task-history-projection-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempWorkspaceAsync(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-task-history-projection-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get(key, defaultValue) {
      return data.has(key) ? data.get(key) : defaultValue;
    },
    update(key, value) {
      if (value === undefined) data.delete(key);
      else data.set(key, value);
    },
  };
}

function createEvidenceRun(workspaceRoot, input) {
  const ownerToken = createProductRunEvidenceAuthorityToken();
  const participantToken = createProductRunEvidenceAuthorityToken();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: input.runId,
    surface: 'vscode',
    authority: { role: 'owner', token: ownerToken, participantToken },
    openIfMissing: true,
    openIdempotencyKey: `${input.runId}:open`,
    openPayload: {
      owner_surface: 'vscode',
      session_id: input.sessionId,
      mode: 'edit',
    },
  });
  session.record({
    type: 'command.accepted',
    idempotencyKey: productRunEvidenceIdempotencyKey('r3-05e-command', { runId: input.runId }),
    occurredAt: input.startedAt,
    payload: {
      prompt_length: 32,
      prompt_sha256: input.promptSha256,
      task_contract_fingerprint: `${input.runId}:task-contract`,
      requires_source_claim_artifact_verification: false,
    },
  });
  session.record({
    type: 'agent.status',
    idempotencyKey: productRunEvidenceIdempotencyKey('r3-05e-status', { runId: input.runId }),
    occurredAt: input.statusAt,
    payload: {
      trust: 'product-runtime-observation',
      status: input.status ? 'settling' : 'paused',
      phase: input.status ? 'complete' : 'checkpoint',
      task_id: `${input.runId}:task`,
      task_index: 0,
      summary: { length: 12, sha256: input.summarySha256 },
    },
  });
  if (input.checkpointAt) {
    session.record({
      type: 'checkpoint.created',
      idempotencyKey: productRunEvidenceIdempotencyKey('r3-05e-checkpoint', { runId: input.runId }),
      occurredAt: input.checkpointAt,
      payload: {
        trust: 'product-runtime-observation',
        status: 'created',
        first_unfinished_index: 1,
        remaining_count: 2,
        reason: input.checkpointReason || 'provider interrupted after partial work',
      },
    });
  }
  if (input.status) {
    session.settleAndSeal({
      status: input.status,
      idempotencyKey: productRunEvidenceIdempotencyKey('r3-05e-settled', { runId: input.runId, status: input.status }),
      occurredAt: input.settledAt,
      payload: {
        task_contract_fingerprint: `${input.runId}:task-contract`,
        completion_summary: { length: 10, sha256: input.summarySha256 },
      },
    });
  }
}

test('R3-05E TaskHistoryProjectionService: projects list, detail, and timeline from run evidence', () => {
  withTempWorkspace((workspace) => {
    createEvidenceRun(workspace, {
      runId: 'run-failed',
      sessionId: 'session-failed',
      status: 'failed',
      startedAt: '2026-07-21T01:00:00.000Z',
      statusAt: '2026-07-21T01:00:05.000Z',
      checkpointAt: '2026-07-21T01:00:10.000Z',
      settledAt: '2026-07-21T01:00:20.000Z',
      promptSha256: 'a'.repeat(64),
      summarySha256: 'b'.repeat(64),
    });
    createEvidenceRun(workspace, {
      runId: 'run-completed',
      sessionId: 'session-completed',
      status: 'completed',
      startedAt: '2026-07-21T02:00:00.000Z',
      statusAt: '2026-07-21T02:00:05.000Z',
      settledAt: '2026-07-21T02:00:20.000Z',
      promptSha256: 'c'.repeat(64),
      summarySha256: 'd'.repeat(64),
    });
    createEvidenceRun(workspace, {
      runId: 'run-recoverable',
      sessionId: 'session-recoverable',
      startedAt: '2026-07-21T03:00:00.000Z',
      statusAt: '2026-07-21T03:00:05.000Z',
      checkpointAt: '2026-07-21T03:00:15.000Z',
      promptSha256: 'e'.repeat(64),
      summarySha256: 'f'.repeat(64),
    });

    const service = new TaskHistoryProjectionService({ workspaceRoot: workspace });
    const records = service.list();
    assert.deepEqual(records.map(record => record.id), ['run-recoverable', 'run-completed', 'run-failed']);
    assert.equal(records.find(record => record.id === 'run-failed').status, 'failed');
    assert.equal(records.find(record => record.id === 'run-completed').status, 'completed');
    assert.equal(records.find(record => record.id === 'run-recoverable').status, 'recoverable');
    assert.match(records.find(record => record.id === 'run-recoverable').checkpointRef, /^run-evidence-checkpoint:run-recoverable:/);

    const failed = service.get('run-failed');
    assert.equal(failed.task.status, 'failed');
    assert.ok(failed.task.evidenceRefs.every(ref => ref.startsWith('run-evidence:')));
    assert.ok(failed.timeline.some(item => item.type === 'checkpoint.created' && item.status === 'created'));
    assert.ok(failed.timeline.some(item => item.type === 'run.settled' && item.status === 'failed'));
    assert.notEqual(service.get('run-completed').task.id, failed.task.id);
  });
});

test('TaskHistoryProjectionService preserves blocked as a distinct durable terminal state', () => {
  withTempWorkspace((workspace) => {
    createEvidenceRun(workspace, {
      runId: 'run-blocked',
      sessionId: 'session-blocked',
      status: 'blocked',
      startedAt: '2026-07-21T03:30:00.000Z',
      statusAt: '2026-07-21T03:30:05.000Z',
      settledAt: '2026-07-21T03:30:20.000Z',
      promptSha256: '1'.repeat(64),
      summarySha256: '2'.repeat(64),
    });

    const detail = new TaskHistoryProjectionService({ workspaceRoot: workspace }).get('run-blocked');
    assert.equal(detail.task.status, 'blocked');
    assert.ok(detail.timeline.some(item => item.type === 'run.settled' && item.status === 'blocked'));
  });
});

test('R3-05F TaskHistoryProjectionService: lifecycle receipts preserve evidence, redact export, and gate cross-window resume', async () => {
  await withTempWorkspaceAsync(async (workspace) => {
    createEvidenceRun(workspace, {
      runId: 'run-sensitive',
      sessionId: 'session-sensitive',
      status: 'failed',
      startedAt: '2026-07-21T04:00:00.000Z',
      statusAt: '2026-07-21T04:00:05.000Z',
      checkpointAt: '2026-07-21T04:00:10.000Z',
      settledAt: '2026-07-21T04:00:20.000Z',
      promptSha256: 'a'.repeat(64),
      summarySha256: 'b'.repeat(64),
      checkpointReason: 'provider interrupted with token=supersecretvalue12345',
    });

    const storage = memoryStore();
    const service = new TaskHistoryProjectionService({
      workspaceRoot: workspace,
      storage,
      now: () => 10_000,
      checkpointMaxAgeMs: 100,
      retentionMs: 1_000,
    });

    const archived = await service.archive('run-sensitive');
    assert.equal(archived.lifecycleReceipt.action, 'archive');
    assert.equal(archived.task.status, 'archived');
    assert.equal(service.get('run-sensitive').task.status, 'archived');

    const exported = await service.exportRecord('run-sensitive');
    assert.match(exported, /devseek\.task-history-export\/v1/);
    assert.match(exported, /\[REDACTED_SECRET\]/);
    assert.doesNotMatch(exported, /supersecretvalue12345/);
    assert.match(exported, /"retentionUntil"/);
    assert.match(exported, /"lifecycleReceipts"/);

    const deleted = await service.delete('run-sensitive');
    assert.equal(deleted.lifecycleReceipt.action, 'delete');
    assert.match(deleted.lifecycleReceipt.reason, /evidence-retained/);
    assert.deepEqual(service.list().map(record => record.id), []);
    assert.equal(service.get('run-sensitive').task.id, 'run-sensitive');

    const blocked = await service.requestContinue('run-sensitive', { now: 20_000 });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.blockedReason, 'checkpoint-unavailable-or-expired');

    const freshCheckpoint = {
      userPrompt: 'resume with authorization: Bearer abcdefgh1234567890',
      displayPrompt: 'resume with authorization: Bearer abcdefgh1234567890',
      wsRootFsPath: workspace,
      allTasks: [{ title: 'remaining' }],
      startFromIndex: 0,
      completedCount: 0,
      savedAt: 9_950,
      sessionId: 'session-sensitive',
      checkpointProtocol: 'devseek.checkpoint-resume/v1',
      checkpointEpoch: 1,
      taskFingerprint: 'fingerprint',
      resumeReceipt: 'receipt',
    };
    const freshService = new TaskHistoryProjectionService({
      workspaceRoot: workspace,
      storage: memoryStore(),
      now: () => 10_000,
      checkpointMaxAgeMs: 100,
      checkpointStore: {
        loadScoped: () => freshCheckpoint,
        loadFresh: async () => ({ checkpoint: freshCheckpoint, stale: false }),
      },
    });

    const resumed = await freshService.requestContinue('run-sensitive');
    const resumedAgain = await freshService.requestContinue('run-sensitive');
    assert.equal(resumed.status, 'resumable');
    assert.match(resumed.checkpointRef, /^checkpoint:session-sensitive:/);
    assert.equal(resumed.lifecycleReceipt.id, resumedAgain.lifecycleReceipt.id);
  });
});

console.log('\nTask history projection service tests passed.\n');
