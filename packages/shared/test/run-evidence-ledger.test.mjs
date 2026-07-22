import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  FileSystemRunEvidenceLedger,
  RUN_EVIDENCE_EVENT_TYPES,
  RUN_EVIDENCE_INTEGRITY_SCOPE,
  canonicalRunEvidenceJson,
  runEvidenceReplayDigest,
  sha256RunEvidence,
} from '../dist/index.js';

const FIXED_TIME = '2026-07-12T08:00:00.000Z';
const OWNER_TOKEN = `devseek-ra1_${'A'.repeat(43)}`;
const PARTICIPANT_TOKEN = `devseek-ra1_${'B'.repeat(43)}`;
const OWNER_OPEN_CREDENTIAL = Object.freeze({
  role: 'owner',
  token: OWNER_TOKEN,
  participantToken: PARTICIPANT_TOKEN,
});
const OWNER_CREDENTIAL = Object.freeze({ role: 'owner', token: OWNER_TOKEN });
const PARTICIPANT_CREDENTIAL = Object.freeze({ role: 'participant', token: PARTICIPANT_TOKEN });

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-run-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function ledgerAt(root) {
  return new FileSystemRunEvidenceLedger({
    rootDir: root,
    now: () => new Date(FIXED_TIME),
  });
}

function headRef(result) {
  const head = result.currentHead ?? result.head;
  return {
    sequence: head.sequence,
    eventSha256: head.eventSha256,
    recordSha256: head.recordSha256,
  };
}

function anchorFromSeal(result) {
  return {
    eventCount: result.seal.event_count,
    finalEventSha256: result.seal.final_event_sha256,
    finalRecordSha256: result.seal.final_record_sha256,
    sealSha256: result.seal.seal_sha256,
  };
}

function openRun(ledger, runId = 'run-1', surface = 'cli') {
  return ledger.openRun({
    runId,
    surface,
    idempotencyKey: `${runId}:open`,
    occurredAt: FIXED_TIME,
    payload: { workspace: '/workspace', source: surface },
    credential: OWNER_OPEN_CREDENTIAL,
  });
}

function appendEvent(ledger, runId, expectedHead, overrides = {}) {
  return ledger.append({
    runId,
    expectedHead,
    type: 'command.accepted',
    surface: 'cli',
    idempotencyKey: `${runId}:command:1`,
    occurredAt: FIXED_TIME,
    payload: { command: 'test' },
    credential: OWNER_CREDENTIAL,
    ...overrides,
  });
}

function settleRun(ledger, runId, expectedHead, status = 'completed') {
  return ledger.append({
    runId,
    expectedHead,
    type: 'run.settled',
    surface: 'shared',
    idempotencyKey: `${runId}:settled:${status}`,
    occurredAt: FIXED_TIME,
    payload: { status },
    credential: OWNER_CREDENTIAL,
  });
}

function taxonomySequence(type, index) {
  const operationId = `taxonomy-operation:${index}`;
  const event = (eventType, payload = contractPayload(eventType, index)) => ({
    type: eventType,
    payload,
  });
  if (type === 'run.opened') return [];
  if (type === 'run.settled') {
    return [event('command.accepted'), event(type, { status: 'completed' })];
  }
  if (type === 'provider.requested') return [event(type)];
  if (type === 'provider.completed' || type === 'provider.failed') {
    return [event('provider.requested'), event(type)];
  }
  if (type === 'side_effect.requested') return [event(type)];
  if (type === 'side_effect.authorized') {
    return [event('side_effect.requested'), event(type)];
  }
  if (type === 'side_effect.started') {
    return [event('side_effect.requested'), event('side_effect.authorized'), event(type)];
  }
  if (type === 'side_effect.committed' || type === 'side_effect.indeterminate') {
    return [
      event('side_effect.requested'),
      event('side_effect.authorized'),
      event('side_effect.started'),
      event(type),
    ];
  }
  if (type === 'side_effect.failed') {
    return [event('side_effect.requested'), event(type)];
  }
  if (type === 'verification.started') return [event(type)];
  if (type === 'verification.completed' || type === 'verification.failed') {
    return [event('verification.started'), event(type)];
  }
  if (type === 'quality_gate.started') return [event(type)];
  if (type === 'quality_gate.passed' || type === 'quality_gate.failed' || type === 'quality_gate.vetoed') {
    return [event('quality_gate.started'), event(type)];
  }
  if (type === 'recovery.detected') return [event(type)];
  if (type === 'recovery.failed') {
    return [event('recovery.detected'), event(type)];
  }
  if (type === 'recovery.completed') {
    const recoveryOperationId = `taxonomy-recovery:${index}`;
    const repairOperationId = `taxonomy-repair:${index}`;
    const verificationOperationId = `taxonomy-verification:${index}`;
    const lifecyclePayload = (status, operationId, extra = {}) => ({
      operation_id: operationId,
      status,
      trust: 'product-runtime-observation',
      ...extra,
    });
    return [
      event('provider.requested'),
      event('provider.failed'),
      event('recovery.detected', lifecyclePayload('detected', recoveryOperationId)),
      event('side_effect.requested', lifecyclePayload('requested', repairOperationId, {
        recovery_operation_id: recoveryOperationId,
      })),
      event('side_effect.authorized', lifecyclePayload('authorized', repairOperationId, {
        recovery_operation_id: recoveryOperationId,
      })),
      event('side_effect.started', lifecyclePayload('started', repairOperationId, {
        recovery_operation_id: recoveryOperationId,
      })),
      event('side_effect.committed', lifecyclePayload('committed', repairOperationId, {
        recovery_operation_id: recoveryOperationId,
      })),
      event('verification.started', lifecyclePayload('started', verificationOperationId)),
      event('verification.completed', lifecyclePayload('completed', verificationOperationId)),
      event('quality_gate.started', lifecyclePayload('started', verificationOperationId)),
      event('quality_gate.passed', lifecyclePayload('passed', verificationOperationId)),
      event(type, lifecyclePayload('completed', recoveryOperationId, {
        resolves_operation_ids: [operationId],
        verification_operation_id: verificationOperationId,
      })),
    ];
  }
  return [event(type)];
}

function contractPayload(type, index = 0) {
  if (type === 'run.metrics') {
    return {
      schema: 'devseek.run-metrics/v1',
      trust: 'product-runtime-observation',
      correlation_id: 'taxonomy-run',
      token: { input: index, output: 'unknown', total: index },
      tool: { calls: index, successes: index, failures: 0 },
      latency_ms: { provider: index * 10, tool: 'unknown', total: index * 20 },
      retry: { provider: 0, tool: 0, total: 0 },
      cost: { currency: 'unknown', amount_micros: 'unknown' },
      evidence_size: { refs: index, bytes: index * 100 },
    };
  }
  if (type === 'evidence.degraded') {
    return { status: 'degraded', trust: 'product-runtime-observation', reason: `degraded:${index}` };
  }
  if (type === 'legacy.imported') {
    return {
      trust: 'legacy-unverified',
      qualification_eligible: false,
      correlation_id: 'taxonomy-run',
      source_kind: 'other',
      source_ref: `taxonomy-source:${index}`,
      source_sha256: 'a'.repeat(64),
      record_count: 0,
      projection: {},
    };
  }
  if (/^(provider|side_effect|verification|quality_gate|recovery)\./.test(type)) {
    return {
      operation_id: `taxonomy-operation:${index}`,
      status: type.slice(type.indexOf('.') + 1),
      trust: 'product-runtime-observation',
    };
  }
  return { index, type };
}

function expectLedgerError(fn, code) {
  assert.throws(fn, error => {
    assert.equal(error?.name, 'RunEvidenceLedgerError');
    assert.equal(error?.code, code);
    return true;
  });
}

function recordPath(ledger, runId, sequence) {
  return path.join(
    ledger.location(runId).recordsDirectory,
    `${String(sequence).padStart(20, '0')}.json`,
  );
}

test('canonical JSON authority is stable, strict, and hashes key order identically', () => {
  assert.equal(canonicalRunEvidenceJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  assert.equal(sha256RunEvidence({ b: 2, a: 1 }), sha256RunEvidence({ a: 1, b: 2 }));
  const cycle = {};
  cycle.self = cycle;
  for (const invalid of [
    { invalid: undefined },
    { invalid: Number.NaN },
    { invalid: Number.POSITIVE_INFINITY },
    { invalid: () => undefined },
    new Date(),
    new Map([['key', 'value']]),
    new Set(['value']),
    cycle,
  ]) {
    assert.throws(() => canonicalRunEvidenceJson(invalid), error => (
      error?.name === 'RunEvidenceLedgerError'
      && error?.code === 'INVALID_INPUT'
    ));
  }
});

test('public inputs are snapshotted once and all strict guards run before directory creation', t => {
  const root = tempRoot(t);
  const ledger = ledgerAt(root);
  let payloadReads = 0;
  let requestPayloadReads = 0;
  const payload = {};
  Object.defineProperty(payload, 'source', {
    enumerable: true,
    get() {
      payloadReads += 1;
      return payloadReads === 1 ? 'single-snapshot' : OWNER_TOKEN;
    },
  });
  const rawRequest = {
    runId: 'single-snapshot-run',
    surface: 'cli',
    idempotencyKey: 'single-snapshot:open',
    occurredAt: FIXED_TIME,
    payload,
    credential: OWNER_OPEN_CREDENTIAL,
  };
  const request = new Proxy(rawRequest, {
    get(target, key, receiver) {
      if (key === 'payload') requestPayloadReads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  ledger.openRun(request);
  assert.equal(requestPayloadReads, 1);
  assert.equal(payloadReads, 1);
  assert.equal(ledger.read('single-snapshot-run')[0].payload.source, 'single-snapshot');

  let arrayLengthReads = 0;
  let arrayValueReads = 0;
  const arrayPayload = new Proxy(['unused'], {
    get(target, key, receiver) {
      if (key === 'length') {
        arrayLengthReads += 1;
        return 1;
      }
      if (key === '0') {
        arrayValueReads += 1;
        return arrayValueReads === 1 ? 'array-single-snapshot' : OWNER_TOKEN;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  ledger.openRun({
    runId: 'array-single-snapshot-run',
    surface: 'cli',
    idempotencyKey: 'array-single-snapshot:open',
    occurredAt: FIXED_TIME,
    payload: { values: arrayPayload },
    credential: OWNER_OPEN_CREDENTIAL,
  });
  assert.equal(arrayLengthReads, 1);
  assert.equal(arrayValueReads, 1);
  assert.deepEqual(ledger.read('array-single-snapshot-run')[0].payload.values, ['array-single-snapshot']);

  let driftingLengthReads = 0;
  const driftingArray = new Proxy(['must-not-be-dropped'], {
    get(target, key, receiver) {
      if (key === 'length') {
        driftingLengthReads += 1;
        return 0;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const beforeDriftingArray = directoryDigest(root);
  expectLedgerError(() => ledger.openRun({
    runId: 'array-length-drift',
    surface: 'cli',
    idempotencyKey: 'array-length-drift:open',
    occurredAt: FIXED_TIME,
    payload: { values: driftingArray },
    credential: OWNER_OPEN_CREDENTIAL,
  }), 'INVALID_INPUT');
  assert.equal(driftingLengthReads, 1);
  assert.equal(directoryDigest(root), beforeDriftingArray);

  const invalidInputs = [
    { runId: 'date-payload', payload: { invalid: new Date(FIXED_TIME) } },
    { runId: 'map-payload', payload: { invalid: new Map([['key', 'value']]) } },
    { runId: 'set-payload', payload: { invalid: new Set(['value']) } },
    { runId: 'nan-payload', payload: { invalid: Number.NaN } },
    { runId: 'infinity-payload', payload: { invalid: Number.POSITIVE_INFINITY } },
    { runId: 'undefined-payload', payload: { invalid: undefined } },
    { runId: 'function-payload', payload: { invalid: () => 'value' } },
    { runId: 'boxed-secret', payload: { invalid: new String(OWNER_TOKEN) } },
  ];
  const cycle = {};
  cycle.self = cycle;
  invalidInputs.push({ runId: 'cycle-payload', payload: cycle });
  for (const { runId, payload: invalidPayload } of invalidInputs) {
    const before = directoryDigest(root);
    expectLedgerError(() => ledger.openRun({
      runId,
      surface: 'cli',
      idempotencyKey: `${runId}:open`,
      occurredAt: FIXED_TIME,
      payload: invalidPayload,
      credential: OWNER_OPEN_CREDENTIAL,
    }), 'INVALID_INPUT');
    assert.equal(directoryDigest(root), before);
  }
});

test('runtime text and timestamp rules match code-point and canonical UTC semantics', t => {
  const root = tempRoot(t);
  const ledger = ledgerAt(root);
  const codePointRunId = '😀'.repeat(512);
  ledger.openRun({
    runId: codePointRunId,
    surface: 'cli',
    idempotencyKey: 'code-point:open',
    occurredAt: FIXED_TIME,
    payload: {},
    credential: OWNER_OPEN_CREDENTIAL,
  });

  for (const [runId, occurredAt, payload] of [
    ['too-many-code-points-' + '😀'.repeat(513), FIXED_TIME, {}],
    ['edge-whitespace ', FIXED_TIME, {}],
    ['control\u0000text', FIXED_TIME, {}],
    ['extended-year', '+010000-01-01T00:00:00.000Z', {}],
    ['leap-second', '2026-07-12T08:00:60.000Z', {}],
    ['payload-edge-whitespace', FIXED_TIME, { text: ' value' }],
    ['payload-control', FIXED_TIME, { text: 'value\u0000' }],
  ]) {
    const before = directoryDigest(root);
    assert.throws(() => ledger.openRun({
      runId,
      surface: 'cli',
      idempotencyKey: 'strict:open',
      occurredAt,
      payload,
      credential: OWNER_OPEN_CREDENTIAL,
    }), error => (
      error?.name === 'RunEvidenceLedgerError'
      && (error?.code === 'INVALID_INPUT' || error?.code === 'RUN_SEMANTIC_INVALID')
    ));
    assert.equal(directoryDigest(root), before);
  }

  const opened = openRun(ledger, 'strict-operation');
  const before = directoryDigest(ledger.location('strict-operation').runDirectory);
  expectLedgerError(() => ledger.append({
    runId: 'strict-operation',
    expectedHead: headRef(opened),
    type: 'provider.requested',
    surface: 'bridge',
    idempotencyKey: 'strict-operation:provider',
    occurredAt: FIXED_TIME,
    payload: {
      operation_id: ' operation ',
      status: 'requested',
      trust: 'product-runtime-observation',
    },
    credential: PARTICIPANT_CREDENTIAL,
  }), 'RUN_SEMANTIC_INVALID');
  assert.equal(directoryDigest(ledger.location('strict-operation').runDirectory), before);
});

test('root, path-component, run, records, and staging symlinks fail closed without following targets', t => {
  const sandbox = tempRoot(t);

  const rootTarget = path.join(sandbox, 'root-target');
  const rootLink = path.join(sandbox, 'root-link');
  fs.mkdirSync(rootTarget);
  fs.symlinkSync(rootTarget, rootLink, 'dir');
  expectLedgerError(() => openRun(ledgerAt(rootLink), 'root-link-run'), 'LEDGER_CORRUPT');
  assert.deepEqual(fs.readdirSync(rootTarget), []);

  const componentTarget = path.join(sandbox, 'component-target');
  const componentLink = path.join(sandbox, 'component-link');
  fs.mkdirSync(componentTarget);
  fs.symlinkSync(componentTarget, componentLink, 'dir');
  expectLedgerError(
    () => openRun(ledgerAt(path.join(componentLink, 'nested-root')), 'component-link-run'),
    'LEDGER_CORRUPT',
  );
  assert.deepEqual(fs.readdirSync(componentTarget), []);

  const root = path.join(sandbox, 'ledger-root');
  fs.mkdirSync(root);
  const runLinkLedger = ledgerAt(root);
  const runTarget = path.join(sandbox, 'run-target');
  fs.mkdirSync(runTarget);
  fs.symlinkSync(runTarget, runLinkLedger.location('run-link').runDirectory, 'dir');
  expectLedgerError(() => openRun(runLinkLedger, 'run-link'), 'LEDGER_CORRUPT');
  assert.equal(runLinkLedger.verify('run-link').issues.some(issue => issue.code === 'SYMLINK_TRUST_BOUNDARY'), true);
  assert.deepEqual(fs.readdirSync(runTarget), []);

  for (const directoryName of ['recordsDirectory', 'stagingDirectory']) {
    const runId = `linked-${directoryName}`;
    const ledger = ledgerAt(root);
    const opened = openRun(ledger, runId);
    const linkedPath = ledger.location(runId)[directoryName];
    const target = path.join(sandbox, `${runId}-target`);
    fs.rmSync(linkedPath, { recursive: true, force: true });
    fs.mkdirSync(target);
    fs.symlinkSync(target, linkedPath, 'dir');

    const report = ledger.verify(runId);
    assert.equal(report.valid, false);
    assert.equal(report.issues.some(issue => issue.code === 'SYMLINK_TRUST_BOUNDARY'), true);
    expectLedgerError(() => appendEvent(ledger, runId, headRef(opened)), 'LEDGER_CORRUPT');
    assert.deepEqual(fs.readdirSync(target), []);
  }
});

test('open, append, read, head, receipt, and idempotency stay inside the diagnostic boundary', t => {
  const root = tempRoot(t);
  const ledger = ledgerAt(root);
  const opened = openRun(ledger);
  assert.equal(opened.idempotent, false);
  assert.equal(opened.event.sequence, 1);
  assert.equal(opened.event.integrity_scope, RUN_EVIDENCE_INTEGRITY_SCOPE);
  assert.equal(opened.event.qualification_eligible, false);
  assert.equal(opened.receipt.qualification_eligible, false);

  const appended = appendEvent(ledger, 'run-1', headRef(opened));
  assert.equal(appended.event.sequence, 2);
  assert.equal(appended.event.previous_event_sha256, opened.event.event_sha256);
  assert.equal(appended.receipt.event_sha256, appended.event.event_sha256);

  const retried = appendEvent(ledger, 'run-1', headRef(opened));
  assert.equal(retried.idempotent, true);
  assert.deepEqual(retried.event, appended.event);
  assert.deepEqual(retried.receipt, appended.receipt);

  const later = appendEvent(ledger, 'run-1', headRef(appended), {
    type: 'provider.requested',
    idempotencyKey: 'run-1:provider:1',
    payload: contractPayload('provider.requested', 1),
  });
  const oldRetry = appendEvent(ledger, 'run-1', headRef(opened));
  assert.equal(oldRetry.committedHead.sequence, 2);
  assert.equal(oldRetry.committedHead.eventSha256, appended.event.event_sha256);
  assert.equal(oldRetry.currentHead.sequence, 3);
  assert.equal(oldRetry.currentHead.eventSha256, later.event.event_sha256);
  assert.equal(ledger.read('run-1').length, 3);
  assert.deepEqual(ledger.head('run-1'), later.currentHead);

  expectLedgerError(
    () => appendEvent(ledger, 'run-1', headRef(opened), { payload: { command: 'different' } }),
    'IDEMPOTENCY_CONFLICT',
  );
  expectLedgerError(
    () => appendEvent(ledger, 'run-1', headRef(opened), { idempotencyKey: 'wrong-head-key' }),
    'EXPECTED_HEAD_MISMATCH',
  );
  expectLedgerError(
    () => appendEvent(ledger, 'run-1', {
      ...headRef(later),
      recordSha256: '0'.repeat(64),
    }, { idempotencyKey: 'wrong-record-head-key' }),
    'EXPECTED_HEAD_MISMATCH',
  );
  expectLedgerError(
    () => ledger.append({
      runId: 'run-1',
      expectedHead: headRef(later),
      type: 'run.opened',
      surface: 'untyped-js-caller',
      idempotencyKey: 'second-open',
      occurredAt: FIXED_TIME,
      payload: {},
      credential: OWNER_CREDENTIAL,
    }),
    'INVALID_INPUT',
  );

  const report = ledger.verify('run-1');
  assert.equal(report.valid, true);
  assert.equal(report.status, 'valid-open');
  assert.equal(report.qualificationEligible, false);
  assert.match(report.limitations.join('\n'), /cannot by itself produce a qualification claim/);
});

test('every raw mutation authenticates durable authority and credentials are never persisted', t => {
  const root = tempRoot(t);
  const ledger = ledgerAt(root);
  expectLedgerError(() => ledger.openRun({
    runId: 'unauthenticated-open',
    surface: 'cli',
    idempotencyKey: 'unauthenticated-open:open',
    occurredAt: FIXED_TIME,
    payload: {},
  }), 'AUTHORITY_DENIED');

  const opened = openRun(ledger, 'authority-run');
  const location = ledger.location('authority-run');
  const before = directoryDigest(location.runDirectory);
  expectLedgerError(() => ledger.openRun({
    runId: 'authority-run',
    surface: 'cli',
    idempotencyKey: 'authority-run:open',
    occurredAt: FIXED_TIME,
    payload: { workspace: '/workspace', source: 'cli' },
    credential: {
      role: 'owner',
      token: PARTICIPANT_TOKEN,
      participantToken: OWNER_TOKEN,
    },
  }), 'AUTHORITY_DENIED');
  const appendRequest = {
    runId: 'authority-run',
    expectedHead: headRef(opened),
    type: 'command.accepted',
    surface: 'cli',
    idempotencyKey: 'authority-run:command',
    occurredAt: FIXED_TIME,
    payload: { command: 'test' },
  };
  expectLedgerError(() => ledger.append(appendRequest), 'AUTHORITY_DENIED');
  expectLedgerError(() => ledger.append({
    ...appendRequest,
    credential: { role: 'owner', token: PARTICIPANT_TOKEN },
  }), 'AUTHORITY_DENIED');
  expectLedgerError(() => ledger.append({
    ...appendRequest,
    type: 'run.settled',
    payload: { status: 'failed' },
    credential: PARTICIPANT_CREDENTIAL,
  }), 'AUTHORITY_DENIED');
  expectLedgerError(() => ledger.seal({
    runId: 'authority-run',
    expectedHead: headRef(opened),
    idempotencyKey: 'authority-run:seal',
    sealedAt: FIXED_TIME,
    credential: PARTICIPANT_CREDENTIAL,
  }), 'AUTHORITY_DENIED');
  expectLedgerError(() => ledger.append({
    ...appendRequest,
    type: 'provider.completed',
    idempotencyKey: 'authority-run:terminal-before-request',
    payload: contractPayload('provider.completed', 99),
    credential: PARTICIPANT_CREDENTIAL,
  }), 'RUN_SEMANTIC_INVALID');
  assert.equal(directoryDigest(location.runDirectory), before);
  assert.equal(ledger.head('authority-run').sequence, 1);

  const persisted = fs.readdirSync(location.recordsDirectory)
    .map(name => fs.readFileSync(path.join(location.recordsDirectory, name), 'utf8'))
    .join('\n');
  assert.equal(persisted.includes(OWNER_TOKEN), false);
  assert.equal(persisted.includes(PARTICIPANT_TOKEN), false);
  assert.equal(persisted.includes('participantToken'), false);
  assert.equal(persisted.includes('credential'), false);
});

test('persisted capability guard rejects every durable text boundary before filesystem or head mutation', t => {
  const root = tempRoot(t);
  const ledger = ledgerAt(root);
  const embedded = `before:${OWNER_TOKEN}:after`;
  const expectSecretBoundary = fn => assert.throws(fn, error => {
    assert.equal(error?.name, 'RunEvidenceLedgerError');
    assert.equal(error?.code, 'INVALID_INPUT');
    assert.equal(String(error?.message).includes(OWNER_TOKEN), false);
    return true;
  });

  const rejectedOpenRequests = [
    { runId: OWNER_TOKEN, surface: 'cli', idempotencyKey: 'open', occurredAt: FIXED_TIME, payload: {} },
    { runId: 'secret-open-surface', surface: embedded, idempotencyKey: 'open', occurredAt: FIXED_TIME, payload: {} },
    { runId: 'secret-open-idempotency', surface: 'cli', idempotencyKey: embedded, occurredAt: FIXED_TIME, payload: {} },
    { runId: 'secret-open-time', surface: 'cli', idempotencyKey: 'open', occurredAt: embedded, payload: {} },
    {
      runId: 'secret-open-payload',
      surface: 'cli',
      idempotencyKey: 'open',
      occurredAt: FIXED_TIME,
      payload: { nested: [{ value: embedded }], [`key:${OWNER_TOKEN}`]: true },
    },
  ];
  for (const request of rejectedOpenRequests) {
    const before = directoryDigest(root);
    expectSecretBoundary(() => ledger.openRun({ ...request, credential: OWNER_OPEN_CREDENTIAL }));
    assert.equal(directoryDigest(root), before);
  }

  const opened = openRun(ledger, 'secret-boundary');
  const appendBase = {
    runId: 'secret-boundary',
    expectedHead: headRef(opened),
    type: 'command.accepted',
    surface: 'cli',
    idempotencyKey: 'secret-boundary:command',
    occurredAt: FIXED_TIME,
    payload: { command: 'test' },
    credential: OWNER_CREDENTIAL,
  };
  const rejectedAppends = [
    { ...appendBase, surface: embedded },
    { ...appendBase, idempotencyKey: embedded },
    { ...appendBase, occurredAt: embedded },
    { ...appendBase, payload: { nested: [embedded] } },
    { ...appendBase, payload: { [`key:${OWNER_TOKEN}`]: true } },
  ];
  for (const request of rejectedAppends) {
    const before = directoryDigest(ledger.location('secret-boundary').runDirectory);
    const beforeHead = ledger.head('secret-boundary');
    expectSecretBoundary(() => ledger.append(request));
    assert.deepEqual(ledger.head('secret-boundary'), beforeHead);
    assert.equal(directoryDigest(ledger.location('secret-boundary').runDirectory), before);
  }

  const command = appendEvent(ledger, 'secret-boundary', headRef(opened));
  const settled = settleRun(ledger, 'secret-boundary', headRef(command));
  for (const override of [
    { reason: embedded },
    { idempotencyKey: embedded },
    { sealedAt: embedded },
  ]) {
    const before = directoryDigest(ledger.location('secret-boundary').runDirectory);
    const beforeHead = ledger.head('secret-boundary');
    expectSecretBoundary(() => ledger.seal({
      runId: 'secret-boundary',
      expectedHead: headRef(settled),
      idempotencyKey: 'secret-boundary:seal',
      reason: 'complete',
      sealedAt: FIXED_TIME,
      credential: OWNER_CREDENTIAL,
      ...override,
    }));
    assert.deepEqual(ledger.head('secret-boundary'), beforeHead);
    assert.equal(directoryDigest(ledger.location('secret-boundary').runDirectory), before);
  }

  const persisted = fs.readdirSync(ledger.location('secret-boundary').recordsDirectory)
    .map(name => fs.readFileSync(path.join(ledger.location('secret-boundary').recordsDirectory, name), 'utf8'))
    .join('\n');
  assert.equal(persisted.includes(OWNER_TOKEN), false);
  assert.equal(persisted.includes(PARTICIPANT_TOKEN), false);
});

test('run lookup and verification boundaries never return persisted capabilities in errors or reports', t => {
  const root = tempRoot(t);
  const ledger = ledgerAt(root);
  const expectSecretBoundary = fn => assert.throws(fn, error => {
    assert.equal(error?.name, 'RunEvidenceLedgerError');
    assert.equal(error?.code, 'INVALID_INPUT');
    assert.equal(JSON.stringify(error).includes(OWNER_TOKEN), false);
    assert.equal(String(error?.message).includes(OWNER_TOKEN), false);
    return true;
  });

  for (const lookup of [
    () => ledger.location(OWNER_TOKEN),
    () => ledger.head(OWNER_TOKEN),
    () => ledger.read(OWNER_TOKEN),
    () => ledger.readSnapshot(OWNER_TOKEN),
    () => ledger.getSeal(OWNER_TOKEN),
    () => ledger.verify(OWNER_TOKEN),
    () => ledger.recover(OWNER_TOKEN),
  ]) {
    expectSecretBoundary(lookup);
  }

  openRun(ledger, 'verify-redaction');
  const capabilityArtifact = path.join(
    ledger.location('verify-redaction').recordsDirectory,
    `artifact-${OWNER_TOKEN}.json`,
  );
  fs.writeFileSync(capabilityArtifact, '{}');

  const report = ledger.verify('verify-redaction');
  assert.equal(report.valid, false);
  assert.equal(report.issues.some(issue => issue.code === 'UNRECOGNIZED_RECORD_ARTIFACT'), true);
  assert.equal(JSON.stringify(report).includes(OWNER_TOKEN), false);
  assert.equal(JSON.stringify(report).includes('[REDACTED-DEVSEEK-CAPABILITY]'), true);

  const recovery = ledger.recover('verify-redaction');
  assert.equal(JSON.stringify(recovery).includes(OWNER_TOKEN), false);
  assert.equal(JSON.stringify(recovery).includes('[REDACTED-DEVSEEK-CAPABILITY]'), true);
});

test('the complete event taxonomy has an appendable deterministic valid prefix across mixed product surfaces', t => {
  const roots = [tempRoot(t), tempRoot(t)];
  const digests = [];
  const serializedRuns = [];

  for (const root of roots) {
    const ledger = ledgerAt(root);
    const snapshots = [];
    const seen = new Set();
    for (const [index, targetType] of RUN_EVIDENCE_EVENT_TYPES.entries()) {
      const runId = `taxonomy-run-${index}`;
      let result = openRun(ledger, runId, 'cli');
      seen.add('run.opened');
      const sequence = taxonomySequence(targetType, index);
      for (const [offset, step] of sequence.entries()) {
        result = ledger.append({
          runId,
          expectedHead: headRef(result),
          type: step.type,
          surface: ['cli', 'vscode', 'bridge', 'shared'][index % 4],
          idempotencyKey: `taxonomy:${index}:${offset}:${step.type}`,
          occurredAt: new Date(Date.parse(FIXED_TIME) + index * 100 + offset + 1).toISOString(),
          payload: step.payload,
          credential: step.type === 'run.settled' ? OWNER_CREDENTIAL : PARTICIPANT_CREDENTIAL,
        });
        seen.add(step.type);
      }
      const snapshot = ledger.readSnapshot(runId);
      assert.equal(snapshot.records.every(record => (
        record.record_kind !== 'event' || record.receipt.qualification_eligible === false
      )), true);
      snapshots.push(snapshot);
    }
    assert.deepEqual([...seen].sort(), [...RUN_EVIDENCE_EVENT_TYPES].sort());
    digests.push(sha256RunEvidence(snapshots.map(runEvidenceReplayDigest)));
    serializedRuns.push(canonicalRunEvidenceJson(snapshots));
  }

  assert.equal(digests[0], digests[1]);
  assert.equal(serializedRuns[0], serializedRuns[1]);
});

test('seal competes at the next CAS slot, is idempotent, and blocks later append', t => {
  const ledger = ledgerAt(tempRoot(t));
  const opened = openRun(ledger, 'sealed-run');
  const command = appendEvent(ledger, 'sealed-run', headRef(opened));
  const settled = settleRun(ledger, 'sealed-run', headRef(command));
  const sealRequest = {
    runId: 'sealed-run',
    expectedHead: headRef(settled),
    idempotencyKey: 'sealed-run:seal',
    sealedAt: FIXED_TIME,
    reason: 'verified-complete',
    credential: OWNER_CREDENTIAL,
  };

  const sealed = ledger.seal(sealRequest);
  assert.equal(sealed.idempotent, false);
  assert.equal(sealed.head.sealed, true);
  assert.equal(sealed.seal.qualification_eligible, false);
  assert.equal(ledger.verify('sealed-run').status, 'valid-sealed');
  assert.deepEqual(ledger.getSeal('sealed-run'), sealed.seal);
  const snapshot = ledger.readSnapshot('sealed-run');
  assert.equal(snapshot.records.length, 3);
  assert.equal(snapshot.seal.seal.seal_sha256, sealed.seal.seal_sha256);
  assert.notEqual(
    runEvidenceReplayDigest({ ...snapshot, seal: null, head: { ...snapshot.head, sealed: false } }),
    runEvidenceReplayDigest(snapshot),
  );

  const retry = ledger.seal(sealRequest);
  assert.equal(retry.idempotent, true);
  assert.deepEqual(retry.seal, sealed.seal);
  expectLedgerError(
    () => ledger.seal({ ...sealRequest, idempotencyKey: 'another-seal' }),
    'RUN_SEALED',
  );
  expectLedgerError(
    () => appendEvent(ledger, 'sealed-run', headRef(settled), { idempotencyKey: 'after-seal' }),
    'RUN_SEALED',
  );
});

test('an independently retained seal anchor detects complete local tail deletion', t => {
  const ledger = ledgerAt(tempRoot(t));
  const opened = openRun(ledger, 'anchored-run');
  const command = appendEvent(ledger, 'anchored-run', headRef(opened));
  const settled = settleRun(ledger, 'anchored-run', headRef(command));
  const sealed = ledger.seal({
    runId: 'anchored-run',
    expectedHead: headRef(settled),
    idempotencyKey: 'anchored-run:seal',
    sealedAt: FIXED_TIME,
    credential: OWNER_CREDENTIAL,
  });
  const anchor = anchorFromSeal(sealed);
  fs.unlinkSync(recordPath(ledger, 'anchored-run', 4));

  const localOnly = ledger.verify('anchored-run');
  assert.equal(localOnly.valid, true);
  assert.equal(localOnly.status, 'valid-open');
  assert.match(localOnly.limitations.join('\n'), /including deletion of the seal itself/);

  const anchored = ledger.verify('anchored-run', anchor);
  assert.equal(anchored.valid, false);
  assert.equal(anchored.expectedAnchorChecked, true);
  assert.equal(anchored.issues.some(issue => issue.code === 'EXPECTED_SEAL_MISSING'), true);
  const recovery = ledger.recover('anchored-run', anchor);
  assert.equal(recovery.recoveryAction, 'manual-intervention-required');
  assert.equal(recovery.mutated, false);

  fs.rmSync(ledger.location('anchored-run').runDirectory, { recursive: true, force: true });
  const missing = ledger.verify('anchored-run', anchor);
  assert.equal(missing.found, false);
  assert.equal(missing.issues.some(issue => issue.code === 'EXPECTED_RUN_MISSING'), true);
  assert.equal(ledger.recover('anchored-run', anchor).recoveryAction, 'manual-intervention-required');
});

test('receipt rewrite, duplicate run.opened, and non-canonical numeric input are rejected by replay verification', async t => {
  await t.test('receipt rewrite breaks the record chain', child => {
    const ledger = ledgerAt(tempRoot(child));
    const opened = openRun(ledger, 'receipt-rewrite');
    const command = appendEvent(ledger, 'receipt-rewrite', headRef(opened));
    const settled = settleRun(ledger, 'receipt-rewrite', headRef(command));
    ledger.seal({
      runId: 'receipt-rewrite',
      expectedHead: headRef(settled),
      idempotencyKey: 'receipt-rewrite:seal',
      sealedAt: FIXED_TIME,
      credential: OWNER_CREDENTIAL,
    });

    const firstPath = recordPath(ledger, 'receipt-rewrite', 1);
    const first = JSON.parse(fs.readFileSync(firstPath, 'utf8'));
    first.receipt.committed_at = '2026-07-12T08:00:01.000Z';
    first.receipt.receipt_sha256 = hashWithout(first.receipt, 'receipt_sha256');
    first.record_sha256 = hashWithout(first, 'record_sha256');
    writeRecord(firstPath, first);

    const report = ledger.verify('receipt-rewrite');
    assert.equal(report.valid, false);
    assert.equal(report.issues.some(issue => issue.code === 'RECORD_PREVIOUS_HASH_MISMATCH'), true);
  });

  await t.test('a fully rehashed second run.opened is still a protocol violation', child => {
    const ledger = ledgerAt(tempRoot(child));
    const opened = openRun(ledger, 'duplicate-open');
    appendEvent(ledger, 'duplicate-open', headRef(opened));
    const secondPath = recordPath(ledger, 'duplicate-open', 2);
    const second = JSON.parse(fs.readFileSync(secondPath, 'utf8'));
    second.event.type = 'run.opened';
    second.event.payload = opened.event.payload;
    second.event.idempotency_fingerprint_sha256 = sha256RunEvidence({
      protocol: 'devseek.run-evidence-idempotency/v1',
      run_id: second.event.run_id,
      type: second.event.type,
      surface: second.event.surface,
      idempotency_key: second.event.idempotency_key,
      payload: second.event.payload,
    });
    second.event.event_sha256 = hashWithout(second.event, 'event_sha256');
    second.receipt.event_sha256 = second.event.event_sha256;
    second.receipt.receipt_sha256 = hashWithout(second.receipt, 'receipt_sha256');
    second.record_sha256 = hashWithout(second, 'record_sha256');
    writeRecord(secondPath, second);

    const report = ledger.verify('duplicate-open');
    assert.equal(report.valid, false);
    assert.equal(report.issues.some(issue => issue.code === 'DUPLICATE_RUN_OPENED'), true);
  });

  await t.test('a fully rehashed qualification claim remains a protocol violation', child => {
    const ledger = ledgerAt(tempRoot(child));
    const opened = openRun(ledger, 'qualification-claim-rehash');
    appendEvent(ledger, 'qualification-claim-rehash', headRef(opened));
    const secondPath = recordPath(ledger, 'qualification-claim-rehash', 2);
    const second = JSON.parse(fs.readFileSync(secondPath, 'utf8'));
    second.event.payload.qualification_claims = [{ capability_id: 'C0-RUN-EVIDENCE-LEDGER', level: 'L2' }];
    second.event.idempotency_fingerprint_sha256 = sha256RunEvidence({
      protocol: 'devseek.run-evidence-idempotency/v1',
      run_id: second.event.run_id,
      type: second.event.type,
      surface: second.event.surface,
      idempotency_key: second.event.idempotency_key,
      payload: second.event.payload,
    });
    second.event.event_sha256 = hashWithout(second.event, 'event_sha256');
    second.receipt.event_sha256 = second.event.event_sha256;
    second.receipt.receipt_sha256 = hashWithout(second.receipt, 'receipt_sha256');
    second.record_sha256 = hashWithout(second, 'record_sha256');
    writeRecord(secondPath, second);

    const report = ledger.verify('qualification-claim-rehash');
    assert.equal(report.valid, false);
    assert.equal(report.issues.some(issue => issue.code === 'RECORD_SCHEMA_INVALID'), true);
  });

  await t.test('Infinity parsed from 1e400 becomes a stable issue instead of an exception', child => {
    const ledger = ledgerAt(tempRoot(child));
    openRun(ledger, 'non-finite');
    const firstPath = recordPath(ledger, 'non-finite', 1);
    fs.chmodSync(firstPath, 0o644);
    const original = fs.readFileSync(firstPath, 'utf8').trim();
    fs.writeFileSync(firstPath, `{"poison":1e400,${original.slice(1)}\n`);
    const report = ledger.verify('non-finite');
    assert.equal(report.valid, false);
    assert.equal(report.issues.some(issue => issue.code === 'RECORD_SCHEMA_INVALID'), true);
    assert.doesNotThrow(() => ledger.recover('non-finite'));
  });

  await t.test('a rehashed null event fails closed without crashing report generation', child => {
    const ledger = ledgerAt(tempRoot(child));
    openRun(ledger, 'null-event');
    const firstPath = recordPath(ledger, 'null-event', 1);
    const first = JSON.parse(fs.readFileSync(firstPath, 'utf8'));
    first.event = null;
    first.record_sha256 = hashWithout(first, 'record_sha256');
    writeRecord(firstPath, first);
    const report = ledger.verify('null-event');
    assert.equal(report.valid, false);
    assert.equal(report.issues.some(issue => issue.code === 'RECORD_SCHEMA_INVALID'), true);
    assert.doesNotThrow(() => ledger.recover('null-event'));
  });
});

test('tamper, gap, sealed-tail truncation, fork, torn record, and orphan staging all fail closed', async t => {
  const cases = [
    {
      name: 'tamper',
      mutate(ledger, runId) {
        const file = recordPath(ledger, runId, 2);
        fs.chmodSync(file, 0o644);
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        value.event.payload.command = 'tampered';
        fs.writeFileSync(file, JSON.stringify(value));
      },
      expected: ['RECORD_HASH_MISMATCH'],
    },
    {
      name: 'gap-and-truncate',
      mutate(ledger, runId) {
        fs.unlinkSync(recordPath(ledger, runId, 2));
      },
      expected: ['RECORD_SLOT_GAP', 'SEAL_COUNT_MISMATCH', 'SEAL_HEAD_MISMATCH'],
    },
    {
      name: 'fork',
      mutate(ledger, runId) {
        fs.copyFileSync(
          recordPath(ledger, runId, 2),
          path.join(ledger.location(runId).recordsDirectory, '00000000000000000002.fork.json'),
        );
      },
      expected: ['FORK_RECORD_ARTIFACT'],
    },
    {
      name: 'torn',
      mutate(ledger, runId) {
        const target = recordPath(ledger, runId, 4);
        fs.chmodSync(target, 0o644);
        fs.writeFileSync(target, '{"protocol":');
      },
      expected: ['TORN_RECORD'],
    },
    {
      name: 'orphan',
      mutate(ledger, runId) {
        fs.writeFileSync(path.join(ledger.location(runId).stagingDirectory, 'orphan.tmp'), 'complete-but-uncommitted');
      },
      expected: ['ORPHAN_STAGING_RECORD'],
    },
    {
      name: 'forged-active-pid',
      mutate(ledger, runId) {
        const forged = `00000000000000000004.json.${process.pid}.0000000000000000.aaaaaaaaaaaaaaaa.tmp`;
        fs.writeFileSync(path.join(ledger.location(runId).stagingDirectory, forged), 'forged-writer-token');
      },
      expected: ['ORPHAN_STAGING_RECORD'],
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, child => {
      const ledger = ledgerAt(tempRoot(child));
      const runId = `corrupt-${scenario.name}`;
      const opened = openRun(ledger, runId);
      const command = appendEvent(ledger, runId, headRef(opened));
      const settled = settleRun(ledger, runId, headRef(command));
      ledger.seal({
        runId,
        expectedHead: headRef(settled),
        idempotencyKey: `${runId}:seal`,
        sealedAt: FIXED_TIME,
        credential: OWNER_CREDENTIAL,
      });
      scenario.mutate(ledger, runId);

      const before = directoryDigest(ledger.location(runId).runDirectory);
      const report = ledger.verify(runId);
      assert.equal(report.valid, false);
      const issueCodes = report.issues.map(issue => issue.code);
      for (const code of scenario.expected) assert.equal(issueCodes.includes(code), true, `${scenario.name}: ${code}`);
      expectLedgerError(() => ledger.read(runId), 'LEDGER_CORRUPT');
      expectLedgerError(
        () => appendEvent(ledger, runId, headRef(settled), { idempotencyKey: `${runId}:after-corruption` }),
        'LEDGER_CORRUPT',
      );

      const recovery = ledger.recover(runId);
      assert.equal(recovery.recoveryAction, 'manual-intervention-required');
      assert.equal(recovery.mutated, false);
      assert.equal(directoryDigest(ledger.location(runId).runDirectory), before, 'recover() must not mutate evidence');
    });
  }
});

test('different cross-process appends use one immutable CAS slot and produce exactly one winner', async t => {
  const root = tempRoot(t);
  const ledger = ledgerAt(root);
  const opened = openRun(ledger, 'process-race');
  const expectedHead = headRef(opened);
  const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
  const script = `
    import { FileSystemRunEvidenceLedger } from ${JSON.stringify(moduleUrl)};
    const request = JSON.parse(process.env.REQUEST);
    const ledger = new FileSystemRunEvidenceLedger({ rootDir: process.env.ROOT, now: () => new Date(${JSON.stringify(FIXED_TIME)}) });
    try {
      const result = ledger.append(request);
      process.stdout.write(JSON.stringify({ ok: true, idempotent: result.idempotent, hash: result.event.event_sha256 }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code }));
    }
  `;

  const attempts = Array.from({ length: 10 }, (_, index) => runChild(script, {
    ROOT: root,
    REQUEST: JSON.stringify({
      runId: 'process-race',
      expectedHead,
      type: 'provider.requested',
      surface: index % 2 === 0 ? 'bridge' : 'vscode',
      idempotencyKey: `race:${index}`,
      occurredAt: FIXED_TIME,
      payload: {
        ...contractPayload('provider.requested', index),
        contender: index,
      },
      credential: PARTICIPANT_CREDENTIAL,
    }),
  }));
  const results = await Promise.all(attempts);
  const winners = results.filter(result => result.ok);
  assert.equal(winners.length, 1, JSON.stringify(results));
  assert.equal(ledger.read('process-race').length, 2);
  assert.equal(ledger.verify('process-race').valid, true);
  assert.equal(fs.readdirSync(ledger.location('process-race').stagingDirectory).length, 0);
});

test('seal is rejected before settlement while valid cross-process appends still share one CAS slot', async t => {
  const root = tempRoot(t);
  const ledger = ledgerAt(root);
  const opened = openRun(ledger, 'append-seal-race');
  const expectedHead = headRef(opened);
  const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
  const script = `
    import { FileSystemRunEvidenceLedger } from ${JSON.stringify(moduleUrl)};
    const ledger = new FileSystemRunEvidenceLedger({ rootDir: process.env.ROOT, now: () => new Date(${JSON.stringify(FIXED_TIME)}) });
    const input = JSON.parse(process.env.INPUT);
    try {
      const result = input.operation === 'seal' ? ledger.seal(input.request) : ledger.append(input.request);
      process.stdout.write(JSON.stringify({ ok: true, operation: input.operation, idempotent: result.idempotent }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, operation: input.operation, code: error.code }));
    }
  `;
  const attempts = Array.from({ length: 12 }, (_, index) => {
    const operation = index % 2 === 0 ? 'append' : 'seal';
    const request = operation === 'append'
      ? {
          runId: 'append-seal-race',
          expectedHead,
          type: 'provider.requested',
          surface: 'vscode',
          idempotencyKey: `append-race:${index}`,
          occurredAt: FIXED_TIME,
          payload: {
            ...contractPayload('provider.requested', index),
            contender: index,
          },
          credential: PARTICIPANT_CREDENTIAL,
        }
      : {
          runId: 'append-seal-race',
          expectedHead,
          idempotencyKey: `seal-race:${index}`,
          sealedAt: FIXED_TIME,
          reason: 'race',
          credential: OWNER_CREDENTIAL,
        };
    return runChild(script, {
      ROOT: root,
      INPUT: JSON.stringify({ operation, request }),
    });
  });
  const results = await Promise.all(attempts);
  const winners = results.filter(result => result.ok);
  assert.equal(winners.length, 1, JSON.stringify(results));
  assert.equal(winners[0].operation, 'append');
  assert.equal(results.filter(result => result.operation === 'seal').every(result => (
    result.ok === false && result.code === 'RUN_SEMANTIC_INVALID'
  )), true, JSON.stringify(results));
  const report = ledger.verify('append-seal-race');
  assert.equal(report.valid, true);
  assert.equal(report.status, 'valid-open');
  assert.equal(report.eventCount, 2);
});

test('same cross-process seal idempotency key resolves to one durable seal', async t => {
  const root = tempRoot(t);
  const ledger = ledgerAt(root);
  const opened = openRun(ledger, 'seal-race');
  const command = appendEvent(ledger, 'seal-race', headRef(opened));
  const settled = settleRun(ledger, 'seal-race', headRef(command));
  const request = {
    runId: 'seal-race',
    expectedHead: headRef(settled),
    idempotencyKey: 'seal-race:shared',
    sealedAt: FIXED_TIME,
    reason: 'complete',
    credential: OWNER_CREDENTIAL,
  };
  const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
  const script = `
    import { FileSystemRunEvidenceLedger } from ${JSON.stringify(moduleUrl)};
    const ledger = new FileSystemRunEvidenceLedger({ rootDir: process.env.ROOT, now: () => new Date(${JSON.stringify(FIXED_TIME)}) });
    try {
      const result = ledger.seal(JSON.parse(process.env.REQUEST));
      process.stdout.write(JSON.stringify({ ok: true, idempotent: result.idempotent, seal: result.seal.seal_sha256 }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code }));
    }
  `;
  const results = await Promise.all(Array.from({ length: 8 }, () => runChild(script, {
    ROOT: root,
    REQUEST: JSON.stringify(request),
  })));
  assert.equal(results.every(result => result.ok), true, JSON.stringify(results));
  assert.equal(new Set(results.map(result => result.seal)).size, 1);
  assert.equal(results.filter(result => result.idempotent === false).length, 1);
  assert.equal(ledger.verify('seal-race').status, 'valid-sealed');
});

test('same cross-process idempotency key returns the one durable event and receipt', async t => {
  const root = tempRoot(t);
  const ledger = ledgerAt(root);
  const opened = openRun(ledger, 'idempotent-race');
  const requested = ledger.append({
    runId: 'idempotent-race',
    expectedHead: headRef(opened),
    type: 'provider.requested',
    surface: 'bridge',
    idempotencyKey: 'provider:request:1',
    occurredAt: FIXED_TIME,
    payload: contractPayload('provider.requested', 1),
    credential: PARTICIPANT_CREDENTIAL,
  });
  const request = {
    runId: 'idempotent-race',
    expectedHead: headRef(requested),
    type: 'provider.completed',
    surface: 'bridge',
    idempotencyKey: 'provider:complete:1',
    occurredAt: FIXED_TIME,
    payload: {
      ...contractPayload('provider.completed', 1),
      responseSha256: 'a'.repeat(64),
    },
    credential: PARTICIPANT_CREDENTIAL,
  };
  const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
  const script = `
    import { FileSystemRunEvidenceLedger } from ${JSON.stringify(moduleUrl)};
    const ledger = new FileSystemRunEvidenceLedger({ rootDir: process.env.ROOT, now: () => new Date(${JSON.stringify(FIXED_TIME)}) });
    try {
      const result = ledger.append(JSON.parse(process.env.REQUEST));
      process.stdout.write(JSON.stringify({ ok: true, idempotent: result.idempotent, event: result.event.event_sha256, receipt: result.receipt.receipt_sha256 }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code }));
    }
  `;

  const results = await Promise.all(Array.from({ length: 8 }, () => runChild(script, {
    ROOT: root,
    REQUEST: JSON.stringify(request),
  })));
  assert.equal(results.every(result => result.ok), true, JSON.stringify(results));
  assert.equal(new Set(results.map(result => result.event)).size, 1);
  assert.equal(new Set(results.map(result => result.receipt)).size, 1);
  assert.equal(results.filter(result => result.idempotent === false).length, 1);
  assert.equal(ledger.read('idempotent-race').length, 3);
});

function runChild(script, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`child exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`invalid child output: ${stdout}\n${stderr}\n${error.message}`));
      }
    });
  });
}

function directoryDigest(root) {
  const hash = crypto.createHash('sha256');
  const visit = current => {
    for (const name of fs.readdirSync(current).sort()) {
      const target = path.join(current, name);
      const relative = path.relative(root, target);
      const stat = fs.lstatSync(target);
      hash.update(relative);
      hash.update(stat.isDirectory() ? 'directory' : 'file');
      if (stat.isDirectory()) visit(target);
      else hash.update(fs.readFileSync(target));
    }
  };
  visit(root);
  return hash.digest('hex');
}

function hashWithout(value, field) {
  const base = { ...value };
  delete base[field];
  return sha256RunEvidence(base);
}

function writeRecord(target, value) {
  fs.chmodSync(target, 0o644);
  fs.writeFileSync(target, `${canonicalRunEvidenceJson(value)}\n`);
}
