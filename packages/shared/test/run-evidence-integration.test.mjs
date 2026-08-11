import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  FileSystemRunEvidenceLedger,
  LEGACY_EVIDENCE_TRUST,
  PRODUCT_RUNTIME_OBSERVATION_TRUST,
  ProductRunEvidenceSession,
  RUN_EVIDENCE_TERMINAL_VALIDATION_FAILURE_RECOVERY_RESOLUTION,
  RUN_EVIDENCE_TERMINAL_VALIDATION_FAILURE_RECOVERY_TRIGGER,
  createProductRunEvidenceAuthorityToken,
  createProductRunEvidenceId,
  productRunEvidenceRoot,
  projectLegacyDiagnosticJsonl,
  projectLegacyReviewLedger,
  projectLegacyTaskHistory,
} from '../dist/index.js';

function tempWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-product-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function authoritySet() {
  const ownerToken = createProductRunEvidenceAuthorityToken();
  const participantToken = createProductRunEvidenceAuthorityToken();
  return {
    ownerOpen: { role: 'owner', token: ownerToken, participantToken },
    owner: { role: 'owner', token: ownerToken },
    participant: { role: 'participant', token: participantToken },
  };
}

function observed(status, payload = {}) {
  return { ...payload, status, trust: PRODUCT_RUNTIME_OBSERVATION_TRUST };
}

function successfulRecoveryProof(recoveryOperationId, sideEffectOperationId, verificationOperationId) {
  const correlatedSideEffect = status => observed(status, {
    operation_id: sideEffectOperationId,
    recovery_operation_id: recoveryOperationId,
  });
  return [
    ['side_effect.requested', correlatedSideEffect('requested')],
    ['side_effect.authorized', correlatedSideEffect('authorized')],
    ['side_effect.started', correlatedSideEffect('started')],
    ['side_effect.committed', correlatedSideEffect('committed')],
    ['verification.started', observed('started', { operation_id: verificationOperationId })],
    ['verification.completed', observed('completed', { operation_id: verificationOperationId })],
    ['quality_gate.started', observed('started', { operation_id: verificationOperationId })],
    ['quality_gate.passed', observed('passed', { operation_id: verificationOperationId })],
  ];
}

function appendRawObservation(
  workspaceRoot,
  runId,
  type,
  payload,
  credential,
  idempotencyKey = `raw:${type}`,
) {
  const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
  const head = ledger.head(runId);
  return ledger.append({
    runId,
    expectedHead: {
      sequence: head.sequence,
      eventSha256: head.eventSha256,
      recordSha256: head.recordSha256,
    },
    type,
    surface: 'raw-attack',
    idempotencyKey,
    payload: { ...payload, correlation_id: runId },
    credential,
  });
}

test('product run ids retain time for operators and add collision-resistant entropy', () => {
  const now = new Date('2026-07-12T08:09:10.123Z');
  assert.equal(createProductRunEvidenceId(now, () => '0123456789abcdef'), '20260712-080910123-0123456789abcdef');
  assert.notEqual(createProductRunEvidenceId(now), createProductRunEvidenceId(now));
  const firstToken = createProductRunEvidenceAuthorityToken();
  const secondToken = createProductRunEvidenceAuthorityToken();
  assert.match(firstToken, /^devseek-ra1_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(firstToken, secondToken);
});

test('owner and participant capabilities are explicit, role-separated, and secret-free on disk', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();

  assert.throws(
    () => ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'no-authority',
      surface: 'vscode',
      openIfMissing: true,
    }),
    error => error?.code === 'AUTHORITY_DENIED',
  );
  assert.throws(
    () => ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'participant-create',
      surface: 'bridge',
      authority: authority.participant,
      openIfMissing: true,
    }),
    error => error?.code === 'AUTHORITY_DENIED',
  );

  const owner = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'authority-run',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  owner.record({ type: 'command.accepted', idempotencyKey: 'command:1' });

  assert.throws(
    () => ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'authority-run',
      surface: 'bridge',
      authority: { role: 'participant', token: createProductRunEvidenceAuthorityToken() },
    }),
    error => error?.code === 'AUTHORITY_DENIED',
  );

  const participant = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'authority-run',
    surface: 'bridge',
    authority: authority.participant,
  });
  participant.record({ type: 'checkpoint.created', idempotencyKey: 'checkpoint:1' });
  assert.throws(
    () => participant.record({ type: 'run.settled', idempotencyKey: 'stolen:settlement' }),
    error => error?.code === 'AUTHORITY_DENIED',
  );
  assert.throws(
    () => participant.settleAndSeal({ status: 'failed', idempotencyKey: 'stolen:settlement' }),
    error => error?.code === 'AUTHORITY_DENIED',
  );

  const openedPayload = new FileSystemRunEvidenceLedger({
    rootDir: productRunEvidenceRoot(workspaceRoot),
  }).read('authority-run')[0].payload;
  const persisted = JSON.stringify(openedPayload);
  assert.equal(persisted.includes(authority.owner.token), false);
  assert.equal(persisted.includes(authority.participant.token), false);
  assert.match(openedPayload._devseek_run_evidence_authority.owner_token_sha256, /^[a-f0-9]{64}$/);
  assert.match(openedPayload._devseek_run_evidence_authority.participant_token_sha256, /^[a-f0-9]{64}$/);

  owner.authority = { role: 'owner', token: authority.participant.token };
  assert.throws(
    () => owner.settleAndSeal({ status: 'failed', idempotencyKey: 'replaced:authority' }),
    error => error?.code === 'AUTHORITY_DENIED',
  );
  owner.authority = authority.owner;
  owner.settleAndSeal({ status: 'failed', idempotencyKey: 'owner:settlement' });
});

test('settleAndSeal rejects a capability-bearing seal request before committing settlement', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const owner = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'secret-seal-boundary',
    surface: 'cli',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  owner.record({ type: 'command.accepted', idempotencyKey: 'command:1' });
  const before = owner.head();

  assert.throws(
    () => owner.settleAndSeal({
      status: 'failed',
      idempotencyKey: 'settlement',
      sealReason: `embedded:${authority.owner.token}`,
    }),
    error => error?.code === 'INVALID_INPUT' && !String(error?.message).includes(authority.owner.token),
  );
  assert.deepEqual(owner.head(), before);
  assert.equal(owner.readEvents().some(event => event.type === 'run.settled'), false);
});

test('product evidence rejects qualification fields at session and raw ledger boundaries', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'qualification-boundary',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  assert.throws(
    () => session.record({
      type: 'command.accepted',
      idempotencyKey: 'forged-claim',
      payload: { qualification_claim: 'R3', qualification_level: 'L2' },
    }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /reserved qualification field/.test(error.message),
  );
  assert.throws(
    () => session.record({
      type: 'command.accepted',
      idempotencyKey: 'nested-forged-claim',
      payload: { details: { qualificationClaims: ['C0-RUN-EVIDENCE-LEDGER/L2'] } },
    }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /reserved qualification field/.test(error.message),
  );
  assert.throws(
    () => appendRawObservation(
      workspaceRoot,
      'qualification-boundary',
      'command.accepted',
      { qualification_eligible: true },
      authority.owner,
      'eligible-attack',
    ),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /qualification-eligible/.test(error.message),
  );
  assert.deepEqual(session.readEvents().map(event => event.type), ['run.opened']);
});

test('semantic guard rejects open-direct settlement without writing run.settled', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const owner = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'empty-run',
    surface: 'cli',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  assert.throws(
    () => owner.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }),
    error => error?.code === 'RUN_SEMANTIC_INVALID',
  );
  assert.equal(owner.head().sequence, 1);
  assert.equal(owner.verify().status, 'valid-open');
});

test('blocked is retained as a distinct sealed terminal instead of being rewritten as failed', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const owner = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'blocked-run',
    surface: 'headless',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  owner.record({ type: 'command.accepted', idempotencyKey: 'command:blocked' });
  owner.settleAndSeal({
    status: 'blocked',
    idempotencyKey: 'settlement:blocked',
    payload: { reason: 'permission-denied' },
  });

  const events = owner.readEvents();
  assert.equal(events.at(-1).type, 'run.settled');
  assert.equal(events.at(-1).payload.status, 'blocked');
  assert.equal(owner.verify().status, 'valid-sealed');
});

test('semantic guard requires operation ids and terminal closure before settlement', t => {
  const workspaceRoot = tempWorkspace(t);
  const missingIdAuthority = authoritySet();
  const missingId = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'missing-operation-id',
    surface: 'bridge',
    authority: missingIdAuthority.ownerOpen,
    openIfMissing: true,
  });
  assert.throws(
    () => missingId.record({
      type: 'provider.requested',
      idempotencyKey: 'provider:requested',
      payload: observed('requested'),
    }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /operation_id/.test(error.message),
  );
  assert.equal(missingId.head().sequence, 1);

  const pendingAuthority = authoritySet();
  const pending = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'pending-provider',
    surface: 'bridge',
    authority: pendingAuthority.ownerOpen,
    openIfMissing: true,
  });
  pending.record({
    type: 'provider.requested',
    idempotencyKey: 'provider:requested',
    payload: observed('requested', { operation_id: 'provider:1' }),
  });
  assert.throws(
    () => pending.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /not terminal/.test(error.message),
  );
  assert.equal(pending.head().sequence, 2);
  pending.record({
    type: 'provider.completed',
    idempotencyKey: 'provider:completed',
    payload: observed('completed', { operation_id: 'provider:1' }),
  });
  assert.equal(
    pending.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }).head.sealed,
    true,
  );
});

test('semantic guard rejects contradictory lifecycle terminals and completed failure claims', t => {
  const workspaceRoot = tempWorkspace(t);
  const conflictAuthority = authoritySet();
  const conflict = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'conflicting-terminals',
    surface: 'vscode',
    authority: conflictAuthority.ownerOpen,
    openIfMissing: true,
  });
  conflict.record({
    type: 'verification.started',
    idempotencyKey: 'verify:start',
    payload: observed('started', { operation_id: 'verify:1' }),
  });
  conflict.record({
    type: 'verification.completed',
    idempotencyKey: 'verify:complete',
    payload: observed('completed', { operation_id: 'verify:1' }),
  });
  const conflictHead = conflict.head();
  assert.throws(
    () => conflict.record({
      type: 'verification.failed',
      idempotencyKey: 'verify:failed',
      payload: observed('failed', { operation_id: 'verify:1' }),
    }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /conflicting terminals/.test(error.message),
  );
  assert.deepEqual(conflict.head(), conflictHead);
  assert.equal(conflict.readEvents().some(event => event.idempotency_key === 'verify:failed'), false);

  const failedAuthority = authoritySet();
  const failed = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'completed-with-failure',
    surface: 'vscode',
    authority: failedAuthority.ownerOpen,
    openIfMissing: true,
  });
  failed.record({
    type: 'quality_gate.started',
    idempotencyKey: 'gate:start',
    payload: observed('started', { operation_id: 'gate:1' }),
  });
  failed.record({
    type: 'quality_gate.vetoed',
    idempotencyKey: 'gate:veto',
    payload: observed('vetoed', { operation_id: 'gate:1' }),
  });
  assert.throws(
    () => failed.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement:completed' }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /completed run/.test(error.message),
  );
  assert.equal(
    failed.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement:failed' }).head.sealed,
    true,
  );
});

test('side-effect settlement rejects started or committed evidence that bypassed authorization', t => {
  const workspaceRoot = tempWorkspace(t);
  const bypassAuthority = authoritySet();
  const bypass = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'side-effect-auth-bypass',
    surface: 'cli',
    authority: bypassAuthority.ownerOpen,
    openIfMissing: true,
  });
  bypass.record({
    type: 'side_effect.requested',
    idempotencyKey: 'effect:requested',
    payload: observed('requested', { operation_id: 'effect:1' }),
  });
  const bypassHead = bypass.head();
  assert.throws(
    () => bypass.record({
      type: 'side_effect.started',
      idempotencyKey: 'effect:started',
      payload: observed('started', { operation_id: 'effect:1' }),
    }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /invalid start transition/.test(error.message),
  );
  assert.deepEqual(bypass.head(), bypassHead);
  assert.equal(bypass.readEvents().some(event => event.type === 'side_effect.started'), false);

  const validAuthority = authoritySet();
  const valid = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'authorized-side-effect',
    surface: 'cli',
    authority: validAuthority.ownerOpen,
    openIfMissing: true,
  });
  for (const [type, key] of [
    ['side_effect.requested', 'requested'],
    ['side_effect.authorized', 'authorized'],
    ['side_effect.started', 'started'],
    ['side_effect.committed', 'committed'],
  ]) {
    valid.record({
      type,
      idempotencyKey: `effect:${key}`,
      payload: observed(type.slice(type.indexOf('.') + 1), { operation_id: 'effect:1' }),
    });
  }
  assert.equal(valid.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }).head.sealed, true);
});

test('one provider operation closes independently at client and server boundaries', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const client = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'provider-boundaries',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  const server = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'provider-boundaries',
    surface: 'bridge',
    authority: authority.participant,
  });
  const operationId = 'provider:shared:1';
  client.record({
    type: 'provider.requested',
    idempotencyKey: 'client:requested',
    payload: observed('requested', { operation_id: operationId, boundary: 'client' }),
  });
  server.record({
    type: 'provider.requested',
    idempotencyKey: 'server:requested',
    payload: observed('requested', { operation_id: operationId, boundary: 'server' }),
  });
  server.record({
    type: 'provider.completed',
    idempotencyKey: 'server:completed',
    payload: observed('completed', { operation_id: operationId, boundary: 'server' }),
  });
  client.record({
    type: 'provider.completed',
    idempotencyKey: 'client:completed',
    payload: observed('completed', { operation_id: operationId, boundary: 'client' }),
  });

  const replay = client.readEvents();
  assert.equal(replay.filter(event => event.payload.operation_id === operationId).length, 4);
  replay[1].payload.operation_id = 'mutated-copy';
  assert.equal(client.readEvents()[1].payload.operation_id, operationId);
  assert.equal(client.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }).head.sealed, true);
});

test('lifecycle observation status and trust spoofing cannot reach settlement', t => {
  const workspaceRoot = tempWorkspace(t);
  const attacks = [
    {
      runId: 'spoofed-provider-status',
      events: [
        ['provider.requested', observed('completed', { operation_id: 'provider:1' })],
        ['provider.completed', observed('completed', { operation_id: 'provider:1' })],
      ],
      message: /status=requested/,
    },
    {
      runId: 'spoofed-verification-trust',
      events: [
        ['verification.started', observed('started', { operation_id: 'verify:1' })],
        ['verification.completed', { operation_id: 'verify:1', status: 'completed', trust: 'self-reported' }],
      ],
      message: /invalid trust/,
    },
  ];

  for (const attack of attacks) {
    const authority = authoritySet();
    const session = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: attack.runId,
      surface: 'attack-test',
      authority: authority.ownerOpen,
      openIfMissing: true,
    });
    let rejected = false;
    for (const [index, [type, payload]] of attack.events.entries()) {
      try {
        session.record({ type, idempotencyKey: `${attack.runId}:${index}`, payload });
      } catch (error) {
        assert.equal(error?.code, 'RUN_SEMANTIC_INVALID');
        assert.match(error.message, attack.message);
        rejected = true;
        break;
      }
    }
    assert.equal(rejected, true);
    assert.equal(session.readEvents().some(event => event.type === 'run.settled'), false);
  }
});

test('raw ledger rejects malformed observation before it can poison settlement replay', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const owner = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'raw-observation-bypass',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  assert.throws(
    () => appendRawObservation(
      workspaceRoot,
      'raw-observation-bypass',
      'provider.requested',
      observed('completed', { operation_id: 'provider:1' }),
      authority.owner,
    ),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /status=requested/.test(error.message),
  );
  assert.equal(owner.head().sequence, 1);
  assert.equal(owner.readEvents().some(event => event.type === 'run.settled'), false);
});

test('evidence.degraded requires a trusted reason and vetoes completed settlement', t => {
  const workspaceRoot = tempWorkspace(t);
  const malformedPayloads = [
    { status: 'ok', trust: PRODUCT_RUNTIME_OBSERVATION_TRUST, reason: 'missing bridge terminal' },
    { status: 'degraded', trust: 'self-reported', reason: 'missing bridge terminal' },
    { status: 'degraded', trust: PRODUCT_RUNTIME_OBSERVATION_TRUST },
  ];
  for (const [index, payload] of malformedPayloads.entries()) {
    const authority = authoritySet();
    const session = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: `malformed-degraded-${index}`,
      surface: 'vscode',
      authority: authority.ownerOpen,
      openIfMissing: true,
    });
    assert.throws(
      () => session.record({ type: 'evidence.degraded', idempotencyKey: 'degraded', payload }),
      error => error?.code === 'RUN_SEMANTIC_INVALID',
    );
    assert.equal(session.head().sequence, 1);
    assert.equal(session.readEvents().some(event => event.type === 'run.settled'), false);
  }

  const authority = authoritySet();
  const degraded = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'valid-degraded',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  degraded.record({
    type: 'evidence.degraded',
    idempotencyKey: 'degraded',
    payload: observed('degraded', { reason: 'bridge server terminal was not observed' }),
  });
  assert.throws(
    () => degraded.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement:completed' }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /degraded evidence/.test(error.message),
  );
  assert.equal(
    degraded.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement:failed' }).head.sealed,
    true,
  );
});

test('R3-09A-RUN-METRICS-SCHEMA records append-only metrics with explicit unknowns', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'r3-09a-run-metrics',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });

  const first = session.recordRunMetrics({
    token: { input: 120, total: 190 },
    tool: { calls: 3, successes: 2, failures: 1 },
    latencyMs: { provider: 512, total: 900 },
    retry: { provider: 1, total: 1 },
    cost: { currency: 'USD' },
    evidenceSize: { refs: 4, bytes: 2048 },
  });
  const second = session.recordRunMetrics({
    idempotencyKey: 'metrics:second',
    token: { input: 121, output: 70, total: 191 },
    tool: { calls: 4, successes: 4, failures: 0 },
    latencyMs: { provider: 600, tool: 40, total: 1000 },
    retry: { provider: 0, tool: 0, total: 0 },
    cost: { amountMicros: 17 },
    evidenceSize: { refs: 5, bytes: 4096 },
  });

  assert.equal(first.event.type, 'run.metrics');
  assert.equal(first.event.sequence, 2);
  assert.equal(second.event.sequence, 3);
  assert.deepEqual(session.readEvents().map(event => event.type), ['run.opened', 'run.metrics', 'run.metrics']);
  assert.equal(first.event.payload.schema, 'devseek.run-metrics/v1');
  assert.equal(first.event.payload.trust, PRODUCT_RUNTIME_OBSERVATION_TRUST);
  assert.deepEqual(first.event.payload.token, { input: 120, output: 'unknown', total: 190 });
  assert.deepEqual(first.event.payload.latency_ms, { provider: 512, tool: 'unknown', total: 900 });
  assert.deepEqual(first.event.payload.cost, { currency: 'USD', amount_micros: 'unknown' });
  assert.deepEqual(first.event.payload.evidence_size, { refs: 4, bytes: 2048 });
  assert.equal(JSON.stringify(first.event.payload).includes('prompt'), false);
  assert.equal(JSON.stringify(first.event.payload).includes('content'), false);
  assert.equal(session.verify().valid, true);
});

test('R3-09A-RUN-METRICS-SCHEMA rejects contents secrets and incomplete raw metrics payloads', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'r3-09a-run-metrics-rejects-content',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });

  assert.throws(
    () => session.recordRunMetrics({
      prompt: 'copy this raw user prompt into metrics',
      token: { input: 1 },
    }),
    error => error?.code === 'INVALID_INPUT' && /run metrics cannot carry prompt/.test(error.message),
  );
  assert.throws(
    () => session.record({
      type: 'run.metrics',
      idempotencyKey: 'metrics:raw:missing-dimensions',
      payload: {
        schema: 'devseek.run-metrics/v1',
        trust: PRODUCT_RUNTIME_OBSERVATION_TRUST,
        token: { input: 1, output: 'unknown', total: 1 },
      },
    }),
    error => error?.code === 'RUN_SEMANTIC_INVALID',
  );
  assert.throws(
    () => session.record({
      type: 'run.metrics',
      idempotencyKey: 'metrics:raw:content-leak',
      payload: {
        schema: 'devseek.run-metrics/v1',
        trust: PRODUCT_RUNTIME_OBSERVATION_TRUST,
        token: { input: 1, output: 'unknown', total: 1 },
        tool: { calls: 'unknown', successes: 'unknown', failures: 'unknown' },
        latency_ms: { provider: 'unknown', tool: 'unknown', total: 'unknown' },
        retry: { provider: 'unknown', tool: 'unknown', total: 'unknown' },
        cost: { currency: 'unknown', amount_micros: 'unknown' },
        evidence_size: { refs: 'unknown', bytes: 'unknown' },
        content: 'raw assistant response',
      },
    }),
    error => error?.code === 'RUN_SEMANTIC_INVALID',
  );
  assert.deepEqual(session.readEvents().map(event => event.type), ['run.opened']);
});

test('bounded recovery can explicitly resolve an adverse terminal and permit completed settlement', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'bounded-repair-success',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  session.record({
    type: 'provider.requested',
    idempotencyKey: 'provider:requested',
    payload: observed('requested', { operation_id: 'provider:1' }),
  });
  session.record({
    type: 'provider.failed',
    idempotencyKey: 'provider:failed',
    payload: observed('failed', { operation_id: 'provider:1' }),
  });
  session.record({
    type: 'recovery.detected',
    idempotencyKey: 'recovery:detected',
    payload: observed('detected', { operation_id: 'recovery:1' }),
  });
  for (const [index, [type, payload]] of successfulRecoveryProof(
    'recovery:1',
    'repair-write:1',
    'repair-verify:1',
  ).entries()) {
    session.record({ type, idempotencyKey: `recovery:proof:${index}`, payload });
  }
  session.record({
    type: 'recovery.completed',
    idempotencyKey: 'recovery:completed',
    payload: observed('completed', {
      operation_id: 'recovery:1',
      resolves_operation_ids: ['provider:1'],
      verification_operation_id: 'repair-verify:1',
    }),
  });
  assert.equal(
    session.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }).head.sealed,
    true,
  );
});

test('bounded recovery can be proven by a captured validation command', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'bounded-validation-recovery-success',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  const recoveryOperationId = 'recovery:1';
  const validationCommandOperationId = 'validation-terminal:1';
  const verificationOperationId = 'auto-validation:1';
  const correlatedSideEffect = status => observed(status, {
    operation_id: validationCommandOperationId,
    recovery_operation_id: recoveryOperationId,
  });
  for (const [index, [type, payload]] of [
    ['side_effect.requested', observed('requested', { operation_id: 'terminal:python' })],
    ['side_effect.failed', observed('failed', { operation_id: 'terminal:python' })],
    ['verification.started', observed('started', { operation_id: verificationOperationId })],
    ['recovery.detected', observed('detected', { operation_id: recoveryOperationId })],
    ['side_effect.requested', correlatedSideEffect('requested')],
    ['side_effect.authorized', correlatedSideEffect('authorized')],
    ['side_effect.started', correlatedSideEffect('started')],
    ['side_effect.committed', correlatedSideEffect('committed')],
    ['verification.completed', observed('completed', { operation_id: verificationOperationId })],
    ['quality_gate.started', observed('started', { operation_id: verificationOperationId })],
    ['quality_gate.passed', observed('passed', { operation_id: verificationOperationId })],
  ].entries()) {
    session.record({ type, idempotencyKey: `validation-recovery:proof:${index}`, payload });
  }
  session.record({
    type: 'recovery.completed',
    idempotencyKey: 'validation-recovery:completed',
    payload: observed('completed', {
      operation_id: recoveryOperationId,
      resolves_operation_ids: ['terminal:python'],
      verification_operation_id: verificationOperationId,
    }),
  });
  assert.equal(
    session.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }).head.sealed,
    true,
  );
});

test('a verified workspace result supersedes an earlier terminal validation failure', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'terminal-validation-workspace-supersession',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  const terminal = status => observed(status, {
    operation_id: 'terminal:test-before-change',
    boundary: 'vscode-terminal-coordinator',
  });
  const workspace = status => observed(status, {
    operation_id: 'workspace:replacement',
    boundary: 'vscode-workspace-mutation-adapter',
  });
  const verification = status => observed(status, { operation_id: 'verification:replacement' });
  const events = [
    ['side_effect.requested', terminal('requested')],
    ['side_effect.authorized', terminal('authorized')],
    ['side_effect.started', terminal('started')],
    ['side_effect.failed', { ...terminal('failed'), exit_code: 8 }],
    ['side_effect.requested', workspace('requested')],
    ['side_effect.authorized', workspace('authorized')],
    ['side_effect.started', workspace('started')],
    ['side_effect.committed', workspace('committed')],
    ['recovery.detected', observed('detected', {
      operation_id: 'recovery:validation-replacement',
      recovery_lane: 'validation',
    })],
    ['verification.started', verification('started')],
    ['verification.completed', verification('completed')],
    ['quality_gate.started', verification('started')],
    ['quality_gate.passed', verification('passed')],
    ['recovery.completed', observed('completed', {
      operation_id: 'recovery:validation-replacement',
      resolves_operation_ids: ['terminal:test-before-change'],
      verification_operation_id: 'verification:replacement',
      recovery_lane: 'validation',
      recovery_trigger: RUN_EVIDENCE_TERMINAL_VALIDATION_FAILURE_RECOVERY_TRIGGER,
      recovery_resolution: RUN_EVIDENCE_TERMINAL_VALIDATION_FAILURE_RECOVERY_RESOLUTION,
    })],
  ];
  for (const [index, [type, payload]] of events.entries()) {
    session.record({ type, idempotencyKey: `validation-workspace:${index}`, payload });
  }

  assert.equal(session.settleAndSeal({
    status: 'completed',
    idempotencyKey: 'settlement',
  }).head.sealed, true);
});

test('terminal validation supersession cannot complete without a later workspace commit', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'terminal-validation-supersession-without-workspace',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  const events = [
    ['side_effect.requested', observed('requested', {
      operation_id: 'terminal:test-before-change',
      boundary: 'vscode-terminal-coordinator',
    })],
    ['side_effect.authorized', observed('authorized', {
      operation_id: 'terminal:test-before-change',
      boundary: 'vscode-terminal-coordinator',
    })],
    ['side_effect.started', observed('started', {
      operation_id: 'terminal:test-before-change',
      boundary: 'vscode-terminal-coordinator',
    })],
    ['side_effect.failed', observed('failed', {
      operation_id: 'terminal:test-before-change',
      boundary: 'vscode-terminal-coordinator',
      exit_code: 8,
    })],
    ['recovery.detected', observed('detected', {
      operation_id: 'recovery:validation-replacement',
      recovery_lane: 'validation',
    })],
    ['verification.started', observed('started', { operation_id: 'verification:replacement' })],
    ['verification.completed', observed('completed', { operation_id: 'verification:replacement' })],
    ['quality_gate.started', observed('started', { operation_id: 'verification:replacement' })],
    ['quality_gate.passed', observed('passed', { operation_id: 'verification:replacement' })],
  ];
  for (const [index, [type, payload]] of events.entries()) {
    session.record({ type, idempotencyKey: `validation-no-workspace:${index}`, payload });
  }

  assert.throws(() => session.record({
    type: 'recovery.completed',
    idempotencyKey: 'validation-no-workspace:completed',
    payload: observed('completed', {
      operation_id: 'recovery:validation-replacement',
      resolves_operation_ids: ['terminal:test-before-change'],
      verification_operation_id: 'verification:replacement',
      recovery_lane: 'validation',
      recovery_trigger: RUN_EVIDENCE_TERMINAL_VALIDATION_FAILURE_RECOVERY_TRIGGER,
      recovery_resolution: RUN_EVIDENCE_TERMINAL_VALIDATION_FAILURE_RECOVERY_RESOLUTION,
    }),
  }), error => error?.code === 'RUN_SEMANTIC_INVALID');
});

test('recovery completion requires one fully correlated post-detection mutation and ordered verification gate', t => {
  const workspaceRoot = tempWorkspace(t);
  const correlated = (status, operationId = 'repair-write:1', recoveryOperationId = 'recovery:1') => observed(status, {
    operation_id: operationId,
    recovery_operation_id: recoveryOperationId,
  });
  const adverse = [
    ['provider.requested', observed('requested', { operation_id: 'provider:1' })],
    ['provider.failed', observed('failed', { operation_id: 'provider:1' })],
  ];
  const verification = [
    ['verification.started', observed('started', { operation_id: 'repair-verify:1' })],
    ['verification.completed', observed('completed', { operation_id: 'repair-verify:1' })],
    ['quality_gate.started', observed('started', { operation_id: 'repair-verify:1' })],
    ['quality_gate.passed', observed('passed', { operation_id: 'repair-verify:1' })],
  ];
  const attacks = [
    {
      runId: 'recovery-commit-only-correlated',
      prefix: [
        ...adverse,
        ['side_effect.requested', observed('requested', { operation_id: 'repair-write:1' })],
        ['side_effect.authorized', observed('authorized', { operation_id: 'repair-write:1' })],
        ['side_effect.started', observed('started', { operation_id: 'repair-write:1' })],
        ['recovery.detected', observed('detected', { operation_id: 'recovery:1' })],
        ['side_effect.committed', correlated('committed')],
        ...verification,
      ],
    },
    {
      runId: 'recovery-authorization-not-correlated',
      prefix: [
        ...adverse,
        ['recovery.detected', observed('detected', { operation_id: 'recovery:1' })],
        ['side_effect.requested', correlated('requested')],
        ['side_effect.authorized', observed('authorized', { operation_id: 'repair-write:1' })],
        ['side_effect.started', correlated('started')],
        ['side_effect.committed', correlated('committed')],
        ...verification,
      ],
    },
    {
      runId: 'recovery-quality-started-before-verification-completed',
      prefix: [
        ...adverse,
        ['recovery.detected', observed('detected', { operation_id: 'recovery:1' })],
        ['side_effect.requested', correlated('requested')],
        ['side_effect.authorized', correlated('authorized')],
        ['side_effect.started', correlated('started')],
        ['side_effect.committed', correlated('committed')],
        ['verification.started', observed('started', { operation_id: 'repair-verify:1' })],
        ['quality_gate.started', observed('started', { operation_id: 'repair-verify:1' })],
        ['verification.completed', observed('completed', { operation_id: 'repair-verify:1' })],
        ['quality_gate.passed', observed('passed', { operation_id: 'repair-verify:1' })],
      ],
    },
  ];

  for (const attack of attacks) {
    const authority = authoritySet();
    const session = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: attack.runId,
      surface: 'strict-recovery-attack-test',
      authority: authority.ownerOpen,
      openIfMissing: true,
    });
    for (const [index, [type, payload]] of attack.prefix.entries()) {
      session.record({ type, idempotencyKey: `${attack.runId}:prefix:${index}`, payload });
    }
    const before = session.head();
    assert.throws(
      () => session.record({
        type: 'recovery.completed',
        idempotencyKey: `${attack.runId}:recovery:completed`,
        payload: observed('completed', {
          operation_id: 'recovery:1',
          resolves_operation_ids: ['provider:1'],
          verification_operation_id: 'repair-verify:1',
        }),
      }),
      error => error?.code === 'RUN_SEMANTIC_INVALID'
        && /correlated requested < authorized < started < committed < verification < quality gate/.test(error.message),
    );
    assert.deepEqual(session.head(), before);
    assert.equal(session.readEvents().some(event => event.type === 'recovery.completed'), false);
  }
});

test('late provider failure can be superseded only by an already verified local result', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'late-provider-superseded-by-verified-local-result',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  for (const [index, [type, payload]] of [
    ['side_effect.requested', observed('requested', { operation_id: 'local-write:1' })],
    ['side_effect.authorized', observed('authorized', { operation_id: 'local-write:1' })],
    ['side_effect.started', observed('started', { operation_id: 'local-write:1' })],
    ['side_effect.committed', observed('committed', { operation_id: 'local-write:1' })],
    ['verification.started', observed('started', { operation_id: 'verify-local:1' })],
    ['verification.completed', observed('completed', { operation_id: 'verify-local:1' })],
    ['quality_gate.started', observed('started', { operation_id: 'verify-local:1' })],
    ['quality_gate.passed', observed('passed', { operation_id: 'verify-local:1' })],
    ['provider.requested', observed('requested', { operation_id: 'provider:late', boundary: 'bridge-server' })],
    ['provider.failed', observed('failed', { operation_id: 'provider:late', boundary: 'bridge-server' })],
    ['recovery.detected', observed('detected', {
      operation_id: 'recovery:late-provider',
      target_operation_ids: ['provider:late'],
      recovery_trigger: 'provider-failure-after-verified-local-result',
    })],
    ['recovery.completed', observed('completed', {
      operation_id: 'recovery:late-provider',
      resolves_operation_ids: ['provider:late'],
      verification_operation_id: 'verify-local:1',
      recovery_trigger: 'provider-failure-after-verified-local-result',
      recovery_resolution: 'provider-failure-superseded-by-verified-local-result',
    })],
  ].entries()) {
    session.record({ type, idempotencyKey: `late-provider-supersession:${index}`, payload });
  }
  assert.equal(
    session.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }).head.sealed,
    true,
  );
});

test('provider failure before verification settles only through a verified workspace result', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'provider-failure-before-verified-workspace-result',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  for (const [index, [type, payload]] of [
    ['provider.requested', observed('requested', { operation_id: 'provider:timed-out', boundary: 'bridge-server' })],
    ['provider.failed', observed('failed', { operation_id: 'provider:timed-out', boundary: 'bridge-server' })],
    ['side_effect.requested', observed('requested', { operation_id: 'workspace-write:1' })],
    ['side_effect.authorized', observed('authorized', { operation_id: 'workspace-write:1' })],
    ['side_effect.started', observed('started', { operation_id: 'workspace-write:1' })],
    ['side_effect.committed', observed('committed', { operation_id: 'workspace-write:1' })],
    ['verification.started', observed('started', { operation_id: 'verify-workspace:1' })],
    ['verification.completed', observed('completed', { operation_id: 'verify-workspace:1' })],
    ['quality_gate.started', observed('started', { operation_id: 'verify-workspace:1' })],
    ['quality_gate.passed', observed('passed', { operation_id: 'verify-workspace:1' })],
    ['recovery.detected', observed('detected', {
      operation_id: 'recovery:provider-before-workspace',
      target_operation_ids: ['provider:timed-out'],
      recovery_trigger: 'provider-failure-before-verified-workspace-result',
    })],
    ['recovery.completed', observed('completed', {
      operation_id: 'recovery:provider-before-workspace',
      resolves_operation_ids: ['provider:timed-out'],
      verification_operation_id: 'verify-workspace:1',
      recovery_trigger: 'provider-failure-before-verified-workspace-result',
      recovery_resolution: 'provider-failure-superseded-by-verified-workspace-result',
    })],
  ].entries()) {
    session.record({ type, idempotencyKey: `provider-before-workspace:${index}`, payload });
  }

  assert.equal(
    session.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }).head.sealed,
    true,
  );
});

test('provider failure recovery cannot claim verification without a committed workspace result', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'provider-failure-without-workspace-result',
    surface: 'strict-provider-recovery-test',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  for (const [index, [type, payload]] of [
    ['provider.requested', observed('requested', { operation_id: 'provider:timed-out' })],
    ['provider.failed', observed('failed', { operation_id: 'provider:timed-out' })],
    ['verification.started', observed('started', { operation_id: 'verify-without-write' })],
    ['verification.completed', observed('completed', { operation_id: 'verify-without-write' })],
    ['quality_gate.started', observed('started', { operation_id: 'verify-without-write' })],
    ['quality_gate.passed', observed('passed', { operation_id: 'verify-without-write' })],
    ['recovery.detected', observed('detected', {
      operation_id: 'recovery:provider-without-write',
      target_operation_ids: ['provider:timed-out'],
      recovery_trigger: 'provider-failure-before-verified-workspace-result',
    })],
  ].entries()) {
    session.record({ type, idempotencyKey: `provider-without-write:${index}`, payload });
  }
  const before = session.head();

  assert.throws(() => session.record({
    type: 'recovery.completed',
    idempotencyKey: 'provider-without-write:recovery-completed',
    payload: observed('completed', {
      operation_id: 'recovery:provider-without-write',
      resolves_operation_ids: ['provider:timed-out'],
      verification_operation_id: 'verify-without-write',
      recovery_trigger: 'provider-failure-before-verified-workspace-result',
      recovery_resolution: 'provider-failure-superseded-by-verified-workspace-result',
    }),
  }), error => error?.code === 'RUN_SEMANTIC_INVALID');
  assert.deepEqual(session.head(), before);
});

test('late provider supersession cannot resolve pre-verification provider or side-effect failures', t => {
  const workspaceRoot = tempWorkspace(t);
  const verifiedLocalResult = [
    ['side_effect.requested', observed('requested', { operation_id: 'local-write:1' })],
    ['side_effect.authorized', observed('authorized', { operation_id: 'local-write:1' })],
    ['side_effect.started', observed('started', { operation_id: 'local-write:1' })],
    ['side_effect.committed', observed('committed', { operation_id: 'local-write:1' })],
    ['verification.started', observed('started', { operation_id: 'verify-local:1' })],
    ['verification.completed', observed('completed', { operation_id: 'verify-local:1' })],
    ['quality_gate.started', observed('started', { operation_id: 'verify-local:1' })],
    ['quality_gate.passed', observed('passed', { operation_id: 'verify-local:1' })],
  ];
  const attacks = [
    {
      runId: 'provider-before-verification-supersession-rejected',
      prefix: [
        ['provider.requested', observed('requested', { operation_id: 'provider:early' })],
        ['provider.failed', observed('failed', { operation_id: 'provider:early' })],
        ...verifiedLocalResult,
        ['recovery.detected', observed('detected', {
          operation_id: 'recovery:late-provider',
          target_operation_ids: ['provider:early'],
          recovery_trigger: 'provider-failure-after-verified-local-result',
        })],
      ],
      resolvesOperationId: 'provider:early',
    },
    {
      runId: 'side-effect-supersession-rejected',
      prefix: [
        ...verifiedLocalResult,
        ['side_effect.requested', observed('requested', { operation_id: 'side-effect:late' })],
        ['side_effect.failed', observed('failed', { operation_id: 'side-effect:late' })],
        ['recovery.detected', observed('detected', {
          operation_id: 'recovery:late-provider',
          target_operation_ids: ['side-effect:late'],
          recovery_trigger: 'provider-failure-after-verified-local-result',
        })],
      ],
      resolvesOperationId: 'side-effect:late',
    },
  ];

  for (const attack of attacks) {
    const authority = authoritySet();
    const session = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: attack.runId,
      surface: 'strict-supersession-attack-test',
      authority: authority.ownerOpen,
      openIfMissing: true,
    });
    for (const [index, [type, payload]] of attack.prefix.entries()) {
      session.record({ type, idempotencyKey: `${attack.runId}:prefix:${index}`, payload });
    }
    const before = session.head();
    assert.throws(
      () => session.record({
        type: 'recovery.completed',
        idempotencyKey: `${attack.runId}:recovery:completed`,
        payload: observed('completed', {
          operation_id: 'recovery:late-provider',
          resolves_operation_ids: [attack.resolvesOperationId],
          verification_operation_id: 'verify-local:1',
          recovery_trigger: 'provider-failure-after-verified-local-result',
          recovery_resolution: 'provider-failure-superseded-by-verified-local-result',
        }),
      }),
      error => error?.code === 'RUN_SEMANTIC_INVALID'
        && /correlated requested < authorized < started < committed < verification < quality gate/.test(error.message),
    );
    assert.deepEqual(session.head(), before);
    assert.equal(session.readEvents().some(event => event.type === 'recovery.completed'), false);
  }
});

test('recovery cannot resolve pending, unknown, duplicate, or undetected operations', t => {
  const workspaceRoot = tempWorkspace(t);
  const attacks = [
    {
      runId: 'recovery-resolves-pending',
      prefix: [
        ['provider.requested', observed('requested', { operation_id: 'provider:pending' })],
        ['recovery.detected', observed('detected', { operation_id: 'recovery:1' })],
        ...successfulRecoveryProof('recovery:1', 'repair-write:1', 'repair-verify:1'),
      ],
      terminal: observed('completed', {
        operation_id: 'recovery:1',
        resolves_operation_ids: ['provider:pending'],
        verification_operation_id: 'repair-verify:1',
      }),
      message: /pending, unknown, or already resolved/,
    },
    {
      runId: 'recovery-resolves-unknown',
      prefix: [
        ['command.accepted', {}],
        ['recovery.detected', observed('detected', { operation_id: 'recovery:1' })],
        ...successfulRecoveryProof('recovery:1', 'repair-write:1', 'repair-verify:1'),
      ],
      terminal: observed('completed', {
        operation_id: 'recovery:1',
        resolves_operation_ids: ['missing:1'],
        verification_operation_id: 'repair-verify:1',
      }),
      message: /pending, unknown, or already resolved/,
    },
    {
      runId: 'recovery-duplicate-resolution',
      prefix: [
        ['provider.requested', observed('requested', { operation_id: 'provider:1' })],
        ['provider.failed', observed('failed', { operation_id: 'provider:1' })],
        ['recovery.detected', observed('detected', { operation_id: 'recovery:1' })],
        ...successfulRecoveryProof('recovery:1', 'repair-write:1', 'repair-verify:1'),
      ],
      terminal: observed('completed', {
        operation_id: 'recovery:1',
        resolves_operation_ids: ['provider:1', 'provider:1'],
        verification_operation_id: 'repair-verify:1',
      }),
      message: /repeats resolved operation/,
    },
    {
      runId: 'recovery-without-detection',
      prefix: [
        ['provider.requested', observed('requested', { operation_id: 'provider:1' })],
        ['provider.failed', observed('failed', { operation_id: 'provider:1' })],
      ],
      terminal: observed('completed', {
        operation_id: 'recovery:1',
        resolves_operation_ids: ['provider:1'],
        verification_operation_id: 'repair-verify:1',
      }),
      message: /terminated before detection/,
    },
  ];

  for (const attack of attacks) {
    const authority = authoritySet();
    const session = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: attack.runId,
      surface: 'attack-test',
      authority: authority.ownerOpen,
      openIfMissing: true,
    });
    for (const [index, [type, payload]] of attack.prefix.entries()) {
      session.record({ type, idempotencyKey: `${attack.runId}:prefix:${index}`, payload });
    }
    const before = session.head();
    assert.throws(
      () => session.record({
        type: 'recovery.completed',
        idempotencyKey: `${attack.runId}:recovery:completed`,
        payload: attack.terminal,
      }),
      error => error?.code === 'RUN_SEMANTIC_INVALID' && attack.message.test(error.message),
    );
    assert.deepEqual(session.head(), before);
    assert.equal(session.readEvents().some(event => event.type === 'recovery.completed'), false);
  }
});

test('recovery.failed closes recovery but does not resolve the original adverse terminal', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'bounded-repair-failed',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  for (const [type, payload] of [
    ['verification.started', observed('started', { operation_id: 'verify:1' })],
    ['verification.failed', observed('failed', { operation_id: 'verify:1' })],
    ['recovery.detected', observed('detected', { operation_id: 'recovery:1' })],
    ['recovery.failed', observed('failed', { operation_id: 'recovery:1' })],
  ]) {
    session.record({ type, idempotencyKey: type, payload });
  }
  assert.throws(
    () => session.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement:completed' }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /unresolved adverse/.test(error.message),
  );
  assert.equal(
    session.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement:failed' }).head.sealed,
    true,
  );
});

test('workspace owner and bridge participant append one durable product run then owner seals it', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const owner = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'shared-run-1',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
    openPayload: { owner: 'vscode' },
  });
  owner.record({
    type: 'command.accepted',
    idempotencyKey: 'command:1',
    payload: { prompt_sha256: 'a'.repeat(64) },
  });

  const bridge = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'shared-run-1',
    surface: 'bridge',
    authority: authority.participant,
  });
  bridge.record({
    type: 'provider.requested',
    idempotencyKey: 'provider:1:requested',
    payload: observed('requested', { operation_id: 'provider:1', provider: 'deepseek-web' }),
  });
  bridge.record({
    type: 'provider.completed',
    idempotencyKey: 'provider:1:completed',
    payload: observed('completed', { operation_id: 'provider:1', response_sha256: 'b'.repeat(64) }),
  });

  const result = owner.settleAndSeal({
    status: 'completed',
    idempotencyKey: 'run:settled',
    payload: { changed_file_count: 1 },
  });
  assert.equal(result.head.sealed, true);
  assert.equal(owner.verify().status, 'valid-sealed');

  const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
  assert.deepEqual(
    ledger.read('shared-run-1').map(event => `${event.surface}:${event.type}`),
    [
      'vscode:run.opened',
      'vscode:command.accepted',
      'bridge:provider.requested',
      'bridge:provider.completed',
      'vscode:run.settled',
    ],
  );
  assert.equal(ledger.read('shared-run-1').every(event => event.payload.correlation_id === 'shared-run-1'), true);
  assert.equal(ledger.readSnapshot('shared-run-1').qualificationEligible, false);
});

test('participant cannot invent a missing owner run and sealed runs reject late events', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  assert.throws(
    () => ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'missing-run',
      surface: 'bridge',
      authority: authority.participant,
    }),
    error => error?.code === 'RUN_NOT_FOUND',
  );

  const owner = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'sealed-run',
    surface: 'cli',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  owner.record({ type: 'command.accepted', idempotencyKey: 'command:1' });
  owner.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement' });
  assert.throws(
    () => ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'sealed-run',
      surface: 'bridge',
      authority: authority.participant,
    }),
    error => error?.code === 'RUN_SEALED',
  );
});

test('product session exposes non-mutating recovery without rewriting evidence', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const owner = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'recoverable-run',
    surface: 'vscode',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  owner.record({ type: 'checkpoint.created', idempotencyKey: 'checkpoint:1' });
  const before = owner.head();

  const resumed = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'recoverable-run',
    surface: 'vscode-resume',
    authority: authority.owner,
  });
  const report = resumed.recover();
  assert.equal(report.valid, true);
  assert.equal(report.status, 'valid-open');
  assert.equal(report.recoveryAction, 'none');
  assert.equal(report.mutated, false);
  assert.deepEqual(resumed.head(), before);
});

test('legacy sources are projected as legacy-unverified metadata and never qualification evidence', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'legacy-run',
    surface: 'vscode-migration',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });

  const taskHistory = projectLegacyTaskHistory([
    {
      id: 'old-task-1',
      status: 'completed',
      workflowMode: 'edit',
      provider: { type: 'bridge' },
      changedFiles: ['secret-name.ts'],
      evidenceRefs: ['mutable-ref'],
      createdAt: 1,
      updatedAt: 2,
    },
  ]);
  const review = projectLegacyReviewLedger({
    files: { changedPaths: ['a.ts'] },
    validation: { ran: true, ok: true },
    qualityGate: { status: 'pass' },
    unfinishedItems: [],
  }, 'review-ledger:old-task-1');
  const diagnostic = projectLegacyDiagnosticJsonl([
    JSON.stringify({ runId: 'old-run', source: 'extension', phase: 'provider', content: 'not-copied' }),
    '{bad json',
  ].join('\n'), 'trace:old-run.log');

  assert.equal(taskHistory.projection.trust, LEGACY_EVIDENCE_TRUST);
  assert.equal(review.projection.trust, LEGACY_EVIDENCE_TRUST);
  assert.equal(diagnostic.projection.trust, LEGACY_EVIDENCE_TRUST);
  assert.equal(diagnostic.projection.invalid_line_count, 1);

  session.importLegacy(taskHistory);
  session.importLegacy(review);
  session.importLegacy(diagnostic);
  const events = new FileSystemRunEvidenceLedger({
    rootDir: productRunEvidenceRoot(workspaceRoot),
  }).read('legacy-run').slice(1);

  assert.equal(events.length, 3);
  assert.equal(events.every(event => event.type === 'legacy.imported'), true);
  assert.equal(events.every(event => event.qualification_eligible === false), true);
  assert.equal(events.every(event => event.payload.trust === LEGACY_EVIDENCE_TRUST), true);
  assert.equal(JSON.stringify(events).includes('secret-name.ts'), false);
  assert.equal(JSON.stringify(events).includes('not-copied'), false);
});

test('legacy import is idempotent by kind, reference and source digest', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'legacy-idempotency',
    surface: 'migration',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  const descriptor = projectLegacyDiagnosticJsonl('{"runId":"old"}\n', 'old.log');
  const first = session.importLegacy(descriptor);
  const second = session.importLegacy(descriptor);
  assert.equal(first.event.event_sha256, second.event.event_sha256);
  assert.equal(second.idempotent, true);
  assert.equal(session.head().sequence, 2);
});

test('session inputs are snapshotted once and reject non-JSON payloads without mutation', t => {
  const workspaceRoot = tempWorkspace(t);
  const authority = authoritySet();
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId: 'session-strict-json',
    surface: 'integration-test',
    authority: authority.ownerOpen,
    openIfMissing: true,
  });
  let payloadReads = 0;
  const input = {
    type: 'command.accepted',
    idempotencyKey: 'session:single-read',
  };
  Object.defineProperty(input, 'payload', {
    enumerable: true,
    get() {
      payloadReads += 1;
      return payloadReads === 1 ? { command: 'single-snapshot' } : { command: authority.owner.token };
    },
  });
  session.record(input);
  assert.equal(payloadReads, 1);
  assert.equal(session.readEvents().at(-1).payload.command, 'single-snapshot');

  const before = session.head();
  const cycle = {};
  cycle.self = cycle;
  for (const payload of [
    new Date(),
    new Map([['key', 'value']]),
    new Set(['value']),
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: undefined },
    { value: () => 'value' },
    cycle,
  ]) {
    assert.throws(() => session.record({
      type: 'command.accepted',
      idempotencyKey: `session:invalid:${Object.prototype.toString.call(payload)}`,
      payload,
    }), error => error?.code === 'INVALID_INPUT');
    assert.deepEqual(session.head(), before);
  }

  const unopenedWorkspace = tempWorkspace(t);
  assert.throws(() => ProductRunEvidenceSession.forWorkspace({
    workspaceRoot: unopenedWorkspace,
    runId: 'session-invalid-open-payload',
    surface: 'integration-test',
    authority: authoritySet().ownerOpen,
    openIfMissing: true,
    openPayload: new Date(),
  }), error => error?.code === 'INVALID_INPUT');
  assert.equal(fs.existsSync(productRunEvidenceRoot(unopenedWorkspace)), false);
});
