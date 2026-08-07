import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODING_TOOL_ACTION_VERSION,
  CanonicalToolExecutor,
  CanonicalToolAuthorityService,
  InMemoryCodingToolExecutionJournal,
  buildCodingToolAction,
  codingToolExecutionFailureReason,
  resolveCodingKernelTaskContract,
} from '../dist/index.js';

const authorityByAction = new WeakMap();

function action(overrides = {}, options = {}) {
  const input = {
    runId: 'run-1',
    sequence: 1,
    actionId: 'read-1',
    tool: 'read_file',
    purpose: 'observe',
    effects: ['read'],
    input: { path: 'src/main.ts' },
    ...overrides,
  };
  const issued = input.authority
    ? { receipt: input.authority }
    : issuedAuthorization(input, options);
  const built = buildCodingToolAction({
    ...input,
    authority: issued.receipt,
  });
  if (issued.session) authorityByAction.set(built, issued.session);
  return built;
}

function issuedAuthorization(input, options = {}) {
  const taskContract = resolveCodingKernelTaskContract({
    prompt: `Exercise ${input.tool} through the canonical executor.`,
    surface: 'headless',
    modeHint: options.mode ?? 'change',
  });
  const session = new CanonicalToolAuthorityService().bind({
    runId: input.runId,
    surface: 'headless',
    workspaceRoot: '/workspace',
    taskContract,
  });
  const receipt = session.authorize({
    actionId: input.actionId,
    tool: input.tool,
    purpose: input.purpose,
    effects: input.effects,
    input: input.input,
    ...(options.surfaceConstraint ? { surfaceConstraint: options.surfaceConstraint } : {}),
  }).receipt;
  return { receipt, session };
}

function issuedAuthority(input, options = {}) {
  return issuedAuthorization(input, options).receipt;
}

function executeAction(executor, candidate, host) {
  const authority = authorityByAction.get(candidate);
  assert.ok(authority, 'test action must retain its issuing authority session');
  return executor.execute(candidate, host, authority);
}

test('CanonicalToolExecutor invokes an authorized host once and emits immutable evidence', async () => {
  let calls = 0;
  const executor = new CanonicalToolExecutor();
  const outcome = await executeAction(executor, action(), {
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
  assert.equal(outcome.receipt.evidenceRefs.includes('host:readback'), true);
  assert.equal(outcome.receipt.evidenceRefs.some(ref => ref.startsWith('authority-policy:')), true);
  assert.equal(outcome.receipt.evidenceRefs.some(ref => ref.startsWith('sandbox-policy:')), true);
  assert.equal(outcome.receipt.inputSha256, outcome.receipt.permission.inputSha256);
  assert.equal(Object.isFrozen(outcome.receipt), true);
  assert.equal(Object.isFrozen(outcome.receipt.result), true);
});

test('CanonicalToolExecutor denies before host execution', async () => {
  let calls = 0;
  const executor = new CanonicalToolExecutor();
  const outcome = await executeAction(executor, action({
    actionId: 'write-denied',
    tool: 'write_file',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
  }, { mode: 'review' }), {
    async execute() {
      calls++;
      return { status: 'completed', evidenceRefs: ['must-not-exist'] };
    },
  });

  assert.equal(calls, 0);
  assert.equal(outcome.receipt.status, 'denied');
  assert.equal(outcome.receipt.permission.decision, 'deny');
  assert.equal(
    codingToolExecutionFailureReason(outcome.receipt),
    outcome.receipt.permission.reason,
  );
  assert.equal(outcome.receipt.evidenceRefs.some(ref => ref.startsWith('authority-policy:')), true);
});

test('CanonicalToolExecutor requires confirmation evidence before an authorized effect', async () => {
  const input = {
    runId: 'run-1',
    sequence: 1,
    actionId: 'terminal-1',
    tool: 'run_terminal',
    purpose: 'external-effect',
    effects: ['process'],
    input: { command: 'npm publish' },
  };
  const issued = issuedAuthority(input, {
    surfaceConstraint: {
      decision: 'require-confirmation',
      reason: 'test-confirmed',
      confirmationRef: 'confirmation:terminal-1',
      evidenceRefs: ['surface:terminal-1:confirmed'],
    },
  });
  const { confirmationRef: _omitted, ...missingConfirmation } = issued;
  assert.throws(
    () => action({ ...input, authority: missingConfirmation }),
    /missing-confirmation-reference/,
  );
  assert.throws(
    () => action({ ...input, authority: { ...issued, status: 'denied' } }),
    /inconsistent-confirmation-status/,
  );
});

test('CanonicalToolExecutor rejects a Kernel receipt reused outside its bound action scope', () => {
  const original = {
    runId: 'run-scope',
    sequence: 1,
    actionId: 'read-original',
    tool: 'read_file',
    purpose: 'observe',
    effects: ['read'],
    input: { path: 'src/main.ts' },
  };
  const authority = issuedAuthority(original);

  assert.throws(
    () => action({ ...original, actionId: 'read-reused', authority }),
    /authority-scope-mismatch/u,
  );
  assert.throws(
    () => action({ ...original, tool: 'grep_search', authority }),
    /authority-scope-mismatch/u,
  );
  assert.throws(
    () => action({ ...original, input: { path: 'src/other.ts' }, authority }),
    /authority-scope-mismatch/u,
  );
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
  const first = executeAction(executor, action(), host);
  const replay = executeAction(executor, action(), host);
  release();
  const [firstOutcome, replayOutcome] = await Promise.all([first, replay]);

  assert.equal(calls, 1);
  assert.equal(firstOutcome.replayed, false);
  assert.equal(replayOutcome.replayed, true);
  assert.equal(firstOutcome.receipt, replayOutcome.receipt);
  await assert.rejects(
    executeAction(executor, action({ input: { path: 'src/other.ts' } }), host),
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
  await executeAction(new CanonicalToolExecutor(journal), action(), host);
  const replay = await executeAction(new CanonicalToolExecutor(journal), action(), host);

  assert.equal(calls, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.status, 'completed');
  assert.deepEqual(replay.receipt.result, ['src/main.ts']);
});

test('CanonicalToolExecutor rejects a journal receipt substituted for another action', async () => {
  let stored;
  const journal = {
    async load() {
      if (!stored) return undefined;
      return {
        action: stored.action,
        receipt: { ...stored.receipt, sequence: stored.receipt.sequence + 1 },
      };
    },
    async append(record) {
      stored = record;
    },
  };
  const host = {
    async execute() {
      return { status: 'completed', result: 'ok', evidenceRefs: ['host:journal-bound'] };
    },
  };
  await executeAction(new CanonicalToolExecutor(journal), action(), host);

  await assert.rejects(
    executeAction(new CanonicalToolExecutor(journal), action(), host),
    /receipt-action-mismatch/u,
  );
});

test('CanonicalToolExecutor fails closed when host evidence is absent or execution throws', async () => {
  const executor = new CanonicalToolExecutor();
  const noEvidence = await executeAction(executor, action({ actionId: 'read-no-evidence' }), {
    async execute() {
      return { status: 'completed', result: 'unproven', evidenceRefs: [] };
    },
  });
  const thrown = await executeAction(executor, action({ actionId: 'read-throws', sequence: 2 }), {
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
  const outcome = await executeAction(executor, action({
    actionId: 'verification-failed',
    sequence: 2,
    tool: 'run_terminal',
    purpose: 'verify',
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
