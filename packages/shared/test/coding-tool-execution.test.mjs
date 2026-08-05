import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODING_TOOL_ACTION_VERSION,
  CanonicalToolExecutor,
  InMemoryCodingToolExecutionJournal,
  buildCodingToolAction,
} from '../dist/index.js';

function action(overrides = {}) {
  return buildCodingToolAction({
    runId: 'run-1',
    sequence: 1,
    actionId: 'read-1',
    tool: 'read_file',
    effects: ['read'],
    input: { path: 'src/main.ts' },
    authority: {
      decision: 'allow',
      status: 'authorized',
      reason: 'read-only-policy',
      evidenceRefs: ['authority:read-1'],
    },
    ...overrides,
  });
}

test('CanonicalToolExecutor invokes an authorized host once and emits immutable evidence', async () => {
  let calls = 0;
  const executor = new CanonicalToolExecutor();
  const outcome = await executor.execute(action(), {
    async execute(received) {
      calls++;
      assert.equal(received.version, CODING_TOOL_ACTION_VERSION);
      assert.equal(Object.isFrozen(received), true);
      return {
        status: 'completed',
        result: { content: 'export const value = 1;' },
        evidenceRefs: ['host:readback'],
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(outcome.replayed, false);
  assert.equal(outcome.receipt.status, 'completed');
  assert.deepEqual(outcome.receipt.evidenceRefs, ['authority:read-1', 'host:readback']);
  assert.equal(Object.isFrozen(outcome.receipt), true);
  assert.equal(Object.isFrozen(outcome.receipt.result), true);
});

test('CanonicalToolExecutor denies before host execution', async () => {
  let calls = 0;
  const executor = new CanonicalToolExecutor();
  const outcome = await executor.execute(action({
    actionId: 'write-denied',
    tool: 'write_file',
    effects: ['workspace-mutation'],
    authority: {
      decision: 'deny',
      status: 'denied',
      reason: 'task-contract-read-only',
      evidenceRefs: ['authority:write-denied'],
    },
  }), {
    async execute() {
      calls++;
      return { status: 'completed', evidenceRefs: ['must-not-exist'] };
    },
  });

  assert.equal(calls, 0);
  assert.equal(outcome.receipt.status, 'denied');
  assert.equal(outcome.receipt.permission.decision, 'deny');
  assert.deepEqual(outcome.receipt.evidenceRefs, ['authority:write-denied']);
});

test('CanonicalToolExecutor requires confirmation evidence before an authorized effect', async () => {
  assert.throws(() => action({
    actionId: 'terminal-1',
    tool: 'run_terminal',
    effects: ['process'],
    authority: {
      decision: 'require-confirmation',
      status: 'authorized',
      reason: 'terminal-requires-confirmation',
      evidenceRefs: ['authority:terminal-1'],
    },
  }), /missing-confirmation-reference/);
});

test('CanonicalToolExecutor coalesces concurrent retries and rejects identity drift', async () => {
  let calls = 0;
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const executor = new CanonicalToolExecutor();
  const host = {
    async execute() {
      calls++;
      await blocked;
      return { status: 'completed', result: 'ok', evidenceRefs: ['host:read-1'] };
    },
  };
  const first = executor.execute(action(), host);
  const replay = executor.execute(action(), host);
  release();
  const [firstOutcome, replayOutcome] = await Promise.all([first, replay]);

  assert.equal(calls, 1);
  assert.equal(firstOutcome.replayed, false);
  assert.equal(replayOutcome.replayed, true);
  assert.equal(firstOutcome.receipt, replayOutcome.receipt);
  await assert.rejects(
    executor.execute(action({ input: { path: 'src/other.ts' } }), host),
    /conflicting-action-identity/,
  );
});

test('CanonicalToolExecutor replays a journaled receipt across executor instances', async () => {
  let calls = 0;
  const journal = new InMemoryCodingToolExecutionJournal();
  const host = {
    async execute() {
      calls++;
      return { status: 'completed', result: ['src/main.ts'], evidenceRefs: ['host:journaled'] };
    },
  };
  await new CanonicalToolExecutor(journal).execute(action(), host);
  const replay = await new CanonicalToolExecutor(journal).execute(action(), host);

  assert.equal(calls, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.status, 'completed');
  assert.deepEqual(replay.receipt.result, ['src/main.ts']);
});

test('CanonicalToolExecutor fails closed when host evidence is absent or execution throws', async () => {
  const executor = new CanonicalToolExecutor();
  const noEvidence = await executor.execute(action({ actionId: 'read-no-evidence' }), {
    async execute() {
      return { status: 'completed', result: 'unproven', evidenceRefs: [] };
    },
  });
  const thrown = await executor.execute(action({ actionId: 'read-throws', sequence: 2 }), {
    async execute() {
      throw new Error('sensitive host details');
    },
  });

  assert.equal(noEvidence.receipt.status, 'failed');
  assert.equal(noEvidence.receipt.errorCode, 'missing-tool-host-evidence');
  assert.equal(thrown.receipt.status, 'failed');
  assert.equal(thrown.receipt.errorCode, 'tool-host-threw');
  assert.equal(JSON.stringify(thrown.receipt).includes('sensitive host details'), false);
});

test('CanonicalToolExecutor preserves structured failure feedback in the terminal receipt', async () => {
  const executor = new CanonicalToolExecutor();
  const outcome = await executor.execute(action({
    actionId: 'verification-failed',
    sequence: 2,
    tool: 'run_terminal',
    effects: ['process'],
  }), {
    async execute() {
      return {
        status: 'failed',
        result: { verifier: 'focused-test', status: 'failed' },
        errorCode: 'verification-failed',
        evidenceRefs: ['verification:focused-test:failed'],
      };
    },
  });

  assert.equal(outcome.receipt.status, 'failed');
  assert.equal(outcome.receipt.errorCode, 'verification-failed');
  assert.deepEqual(outcome.receipt.result, { verifier: 'focused-test', status: 'failed' });
  assert.equal(Object.isFrozen(outcome.receipt.result), true);
});
