import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const names = ['event', 'receipt', 'seal', 'record', 'snapshot', 'expected-anchor'];
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemas = new Map(names.map(name => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'docs', 'process', `devseek-run-evidence-${name}.schema.json`),
    'utf8',
  ));
  ajv.addSchema(schema);
  return [name, schema];
}));
const validate = Object.fromEntries([...schemas].map(([name, schema]) => [name, ajv.getSchema(schema.$id)]));
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

function openedEvent() {
  return {
    protocol: 'devseek.run-evidence-event/v1',
    integrity_scope: 'product-run-diagnostics',
    qualification_eligible: false,
    run_id: 'run-schema-test',
    sequence: 1,
    previous_event_sha256: null,
    type: 'run.opened',
    surface: 'node-contract-test',
    idempotency_key: 'run-open:test',
    idempotency_fingerprint_sha256: SHA_A,
    occurred_at: '2026-07-12T00:00:00.000Z',
    payload: {
      correlation_id: 'run-schema-test',
      _devseek_run_evidence_authority: {
        protocol: 'devseek.product-run-evidence-authority/v1',
        owner_token_sha256: 'a'.repeat(64),
        participant_token_sha256: 'b'.repeat(64),
      },
    },
    event_sha256: SHA_B,
  };
}

function operationEvent(type, status) {
  const opened = openedEvent();
  return {
    ...opened,
    sequence: 2,
    previous_event_sha256: opened.event_sha256,
    type,
    idempotency_key: `${type}:test`,
    payload: {
      correlation_id: opened.run_id,
      operation_id: 'operation-test-1',
      status,
      trust: 'product-runtime-observation',
      diagnostic_detail: 'payload extensions remain diagnostic data',
    },
  };
}

function receipt() {
  return {
    protocol: 'devseek.run-evidence-receipt/v1',
    integrity_scope: 'product-run-diagnostics',
    qualification_eligible: false,
    run_id: 'run-schema-test',
    sequence: 1,
    event_sha256: SHA_B,
    previous_event_sha256: null,
    idempotency_key: 'run-open:test',
    committed_at: '2026-07-12T00:00:00.001Z',
    receipt_sha256: SHA_C,
  };
}

function seal() {
  return {
    protocol: 'devseek.run-evidence-seal/v1',
    integrity_scope: 'product-run-diagnostics',
    qualification_eligible: false,
    run_id: 'run-schema-test',
    slot_sequence: 2,
    event_count: 1,
    final_event_sha256: SHA_B,
    final_record_sha256: SHA_D,
    idempotency_key: 'seal:test',
    idempotency_fingerprint_sha256: SHA_A,
    reason: 'test-complete',
    sealed_at: '2026-07-12T00:00:00.002Z',
    seal_sha256: SHA_C,
  };
}

test('all G0-D schemas compile in Ajv 2020 strict mode', () => {
  for (const name of names) assert.equal(typeof validate[name], 'function', `${name} did not compile`);
});

test('event schema accepts the closed taxonomy and operation-correlated boundary states', () => {
  assert.equal(validate.event(openedEvent()), true, ajv.errorsText(validate.event.errors));
  const statusByType = {
    'provider.requested': 'requested',
    'provider.completed': 'completed',
    'provider.failed': 'failed',
    'side_effect.requested': 'requested',
    'side_effect.authorized': 'authorized',
    'side_effect.started': 'started',
    'side_effect.committed': 'committed',
    'side_effect.failed': 'failed',
    'side_effect.indeterminate': 'indeterminate',
    'verification.started': 'started',
    'verification.completed': 'completed',
    'verification.failed': 'failed',
    'quality_gate.started': 'started',
    'quality_gate.passed': 'passed',
    'quality_gate.failed': 'failed',
    'quality_gate.vetoed': 'vetoed',
    'recovery.detected': 'detected',
    'recovery.completed': 'completed',
    'recovery.failed': 'failed',
  };
  for (const [type, status] of Object.entries(statusByType)) {
    const event = operationEvent(type, status);
    assert.equal(validate.event(event), true, `${type}: ${ajv.errorsText(validate.event.errors)}`);
  }
  for (const type of ['agent.status', 'tool.activity']) {
    const event = operationEvent(type, 'started');
    assert.equal(validate.event(event), true, `${type}: ${ajv.errorsText(validate.event.errors)}`);
  }
  const degraded = operationEvent('evidence.degraded', 'degraded');
  degraded.payload.reason = 'ledger-unavailable';
  assert.equal(validate.event(degraded), true, ajv.errorsText(validate.event.errors));

  const command = operationEvent('command.accepted', 'completed');
  assert.equal(validate.event(command), true, ajv.errorsText(validate.event.errors));
  const legacy = operationEvent('legacy.imported', 'completed');
  legacy.payload = {
    correlation_id: legacy.run_id,
    trust: 'legacy-unverified',
    qualification_eligible: false,
    source_kind: 'task-history',
    source_ref: 'vscode-workspace-state:devseek.taskHistory',
    source_sha256: SHA_A,
    record_count: 0,
    projection: { status_counts: {} },
  };
  assert.equal(validate.event(legacy), true, ajv.errorsText(validate.event.errors));
  legacy.payload.source_kind = 'other';
  legacy.payload.projection = { qualification_claims: [{ legacy_only: true }] };
  assert.equal(validate.event(legacy), true, ajv.errorsText(validate.event.errors));
});

test('event schema rejects unknown kinds, extras, qualification escalation and noncanonical time', () => {
  assertRejected(validate.event, { ...openedEvent(), type: 'provider.unknown' });
  assertRejected(validate.event, { ...openedEvent(), injected_claim: 'R3' });
  assertRejected(validate.event, { ...openedEvent(), qualification_eligible: true });
  assertRejected(validate.event, { ...openedEvent(), integrity_scope: 'qualification-evidence' });
  assertRejected(validate.event, {
    ...openedEvent(),
    payload: { correlation_id: 'run-schema-test', qualification_claim: 'R3' },
  });
  assertRejected(validate.event, {
    ...openedEvent(),
    payload: { correlation_id: 'run-schema-test', qualification_claims: [] },
  });
  assertRejected(validate.event, {
    ...openedEvent(),
    payload: { correlation_id: 'run-schema-test', nested: { qualificationLevelView: 'L2' } },
  });
  assertRejected(validate.event, {
    ...openedEvent(),
    payload: { correlation_id: 'run-schema-test', nested: { QUALIFICATION_CLAIMS: [] } },
  });
  assertRejected(validate.event, {
    ...openedEvent(),
    payload: { correlation_id: 'run-schema-test', qualification_eligible: true },
  });
  assert.equal(validate.event({
    ...openedEvent(),
    payload: {
      ...openedEvent().payload,
      nested: { QUALIFICATION_ELIGIBLE: false },
    },
  }), true, ajv.errorsText(validate.event.errors));
  assertRejected(validate.event, { ...openedEvent(), occurred_at: '2026-07-12T08:00:00+08:00' });
});

test('critical payloads reject missing operation_id, wrong status and elevated trust', () => {
  const missingOperation = operationEvent('provider.requested', 'requested');
  delete missingOperation.payload.operation_id;
  assertRejected(validate.event, missingOperation);

  assertRejected(validate.event, operationEvent('provider.requested', 'completed'));

  const elevatedTrust = operationEvent('quality_gate.passed', 'passed');
  elevatedTrust.payload.trust = 'qualification-attested';
  assertRejected(validate.event, elevatedTrust);

  const missingReason = operationEvent('evidence.degraded', 'degraded');
  assertRejected(validate.event, missingReason);
});

test('receipt, immutable records and seal are closed qualification-ineligible envelopes', () => {
  const event = openedEvent();
  const committedReceipt = receipt();
  const eventRecord = {
    protocol: 'devseek.run-evidence-record/v1',
    record_kind: 'event',
    slot_sequence: 1,
    previous_record_sha256: null,
    event,
    receipt: committedReceipt,
    record_sha256: SHA_D,
  };
  const committedSeal = seal();
  const sealRecord = {
    protocol: 'devseek.run-evidence-record/v1',
    record_kind: 'seal',
    slot_sequence: 2,
    previous_record_sha256: SHA_D,
    seal: committedSeal,
    record_sha256: SHA_A,
  };
  assert.equal(validate.receipt(committedReceipt), true, ajv.errorsText(validate.receipt.errors));
  assert.equal(validate.record(eventRecord), true, ajv.errorsText(validate.record.errors));
  assert.equal(validate.record(sealRecord), true, ajv.errorsText(validate.record.errors));
  assert.equal(validate.seal(committedSeal), true, ajv.errorsText(validate.seal.errors));

  assertRejected(validate.receipt, { ...committedReceipt, qualification_eligible: true });
  assertRejected(validate.receipt, { ...committedReceipt, unexpected: true });
  assertRejected(validate.record, { ...eventRecord, qualification_claim: 'R3' });
  assertRejected(validate.seal, { ...committedSeal, qualification_eligible: true });
  assertRejected(validate.seal, { ...committedSeal, status: 'qualified' });
});

test('snapshot and independently retained anchor preserve the diagnostic boundary', () => {
  const event = openedEvent();
  const committedReceipt = receipt();
  const committedSeal = seal();
  const snapshot = {
    runId: event.run_id,
    integrityScope: 'product-run-diagnostics',
    qualificationEligible: false,
    records: [{
      slotSequence: 1,
      previousRecordSha256: null,
      event,
      receipt: committedReceipt,
      recordSha256: SHA_D,
    }],
    seal: {
      slotSequence: 2,
      previousRecordSha256: SHA_D,
      seal: committedSeal,
      recordSha256: SHA_A,
    },
    head: {
      runId: event.run_id,
      sequence: 1,
      eventSha256: SHA_B,
      recordSha256: SHA_D,
      sealed: true,
      sealSha256: SHA_C,
    },
  };
  const anchor = {
    eventCount: 1,
    finalEventSha256: SHA_B,
    finalRecordSha256: SHA_D,
    sealSha256: SHA_C,
  };
  assert.equal(validate.snapshot(snapshot), true, ajv.errorsText(validate.snapshot.errors));
  assert.equal(validate['expected-anchor'](anchor), true, ajv.errorsText(validate['expected-anchor'].errors));

  assertRejected(validate.snapshot, { ...snapshot, qualificationEligible: true });
  assertRejected(validate.snapshot, { ...snapshot, qualificationClaim: 'R3' });
  assertRejected(validate['expected-anchor'], { ...anchor, qualificationEligible: false });
  assertRejected(validate['expected-anchor'], { ...anchor, sealSha256: 'not-a-sha256' });

  const openSnapshot = structuredClone(snapshot);
  openSnapshot.seal = null;
  openSnapshot.head = { ...snapshot.head, sealed: false };
  delete openSnapshot.head.sealSha256;
  assert.equal(validate.snapshot(openSnapshot), true, ajv.errorsText(validate.snapshot.errors));
  openSnapshot.head.sealSha256 = SHA_C;
  assertRejected(validate.snapshot, openSnapshot);
});

function assertRejected(schemaValidator, value) {
  assert.equal(schemaValidator(value), false, 'malformed contract value was accepted');
}
