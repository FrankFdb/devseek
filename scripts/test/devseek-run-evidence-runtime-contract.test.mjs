import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import {
  FileSystemRunEvidenceLedger,
  ProductRunEvidenceSession,
  RUN_EVIDENCE_TEXT_MAX_LENGTH,
  createProductRunEvidenceAuthorityToken,
  sha256RunEvidence,
} from '../../packages/shared/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schemaNames = ['event', 'receipt', 'seal', 'record', 'snapshot', 'expected-anchor'];
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validators = {};
for (const name of schemaNames) {
  const schema = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'docs', 'process', `devseek-run-evidence-${name}.schema.json`),
    'utf8',
  ));
  ajv.addSchema(schema);
  validators[name] = schema.$id;
}
for (const name of schemaNames) validators[name] = ajv.getSchema(validators[name]);

function tempLedger(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-runtime-schema-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return new FileSystemRunEvidenceLedger({ rootDir });
}

function authoritySet() {
  const ownerToken = createProductRunEvidenceAuthorityToken();
  return {
    owner: {
      role: 'owner',
      token: ownerToken,
      participantToken: createProductRunEvidenceAuthorityToken(),
    },
  };
}

function headReference(ledger, runId) {
  const head = ledger.head(runId);
  return {
    sequence: head.sequence,
    eventSha256: head.eventSha256,
    recordSha256: head.recordSha256,
  };
}

function assertSchema(name, value) {
  assert.equal(validators[name](value), true, `${name}: ${ajv.errorsText(validators[name].errors)}`);
}

function expectCode(fn, code) {
  assert.throws(fn, error => error?.code === code);
}

function rehashRecord(record) {
  if (record.record_kind === 'event') {
    record.event.idempotency_fingerprint_sha256 = attackerSha256({
      protocol: 'devseek.run-evidence-idempotency/v1',
      run_id: record.event.run_id,
      type: record.event.type,
      surface: record.event.surface,
      idempotency_key: record.event.idempotency_key,
      payload: record.event.payload,
    });
    record.event.event_sha256 = attackerHashWithout(record.event, 'event_sha256');
    record.receipt.event_sha256 = record.event.event_sha256;
    record.receipt.receipt_sha256 = attackerHashWithout(record.receipt, 'receipt_sha256');
  } else {
    record.seal.seal_sha256 = attackerHashWithout(record.seal, 'seal_sha256');
  }
  record.record_sha256 = attackerHashWithout(record, 'record_sha256');
}

function attackerHashWithout(value, field) {
  const base = { ...value };
  delete base[field];
  return attackerSha256(base);
}

function attackerSha256(value) {
  return crypto.createHash('sha256').update(attackerCanonicalJson(value), 'utf8').digest('hex');
}

function attackerCanonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(attackerCanonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => (
    `${JSON.stringify(key)}:${attackerCanonicalJson(value[key])}`
  )).join(',')}}`;
}

test('real Shared runtime artifacts conform to all six machine schemas', t => {
  const ledger = tempLedger(t);
  const runId = 'runtime-schema-positive';
  const session = new ProductRunEvidenceSession(ledger, {
    runId,
    surface: 'runtime-contract-test',
    authority: authoritySet().owner,
    openIfMissing: true,
    openPayload: { purpose: 'runtime-schema-cross-check' },
  });
  session.record({
    type: 'command.accepted',
    idempotencyKey: 'command:accepted',
    payload: { command_digest: 'a'.repeat(64) },
  });
  session.record({
    type: 'checkpoint.created',
    idempotencyKey: 'checkpoint:qualification-boundary',
    payload: {
      nested: {
        QUALIFICATION_ELIGIBLE: false,
        q_u_a_l_i_f_i_c_a_t_i_o_n_e_l_i_g_i_b_l_e_: false,
      },
    },
  });
  session.record({
    type: 'provider.requested',
    idempotencyKey: 'provider:requested',
    payload: {
      operation_id: 'provider-operation-1',
      status: 'requested',
      trust: 'product-runtime-observation',
    },
  });
  session.record({
    type: 'provider.failed',
    idempotencyKey: 'provider:failed',
    payload: {
      operation_id: 'provider-operation-1',
      status: 'failed',
      trust: 'product-runtime-observation',
    },
  });
  session.record({
    type: 'recovery.detected',
    idempotencyKey: 'recovery:detected',
    payload: {
      operation_id: 'recovery-operation-1',
      status: 'detected',
      trust: 'product-runtime-observation',
    },
  });
  for (const [type, status, extra] of [
    ['side_effect.requested', 'requested', { recovery_operation_id: 'recovery-operation-1' }],
    ['side_effect.authorized', 'authorized', { recovery_operation_id: 'recovery-operation-1' }],
    ['side_effect.started', 'started', { recovery_operation_id: 'recovery-operation-1' }],
    ['side_effect.committed', 'committed', { recovery_operation_id: 'recovery-operation-1' }],
  ]) {
    session.record({
      type,
      idempotencyKey: `recovery-fix:${status}`,
      payload: {
        operation_id: 'recovery-side-effect-1',
        status,
        trust: 'product-runtime-observation',
        ...extra,
      },
    });
  }
  for (const [type, status] of [
    ['verification.started', 'started'],
    ['verification.completed', 'completed'],
    ['quality_gate.started', 'started'],
    ['quality_gate.passed', 'passed'],
  ]) {
    session.record({
      type,
      idempotencyKey: `recovery-proof:${type}`,
      payload: {
        operation_id: 'recovery-verification-1',
        status,
        trust: 'product-runtime-observation',
      },
    });
  }
  session.record({
    type: 'recovery.completed',
    idempotencyKey: 'recovery:completed',
    payload: {
      operation_id: 'recovery-operation-1',
      status: 'completed',
      trust: 'product-runtime-observation',
      resolves_operation_ids: ['provider-operation-1'],
      verification_operation_id: 'recovery-verification-1',
    },
  });
  session.importLegacy({
    sourceKind: 'other',
    sourceRef: 'explicit-runtime-contract-fixture',
    sourceSha256: 'b'.repeat(64),
    recordCount: 1,
    projection: { qualification_claims: [{ preserved_as_untrusted_legacy: true }] },
  });
  const sealed = session.settleAndSeal({
    status: 'completed',
    idempotencyKey: 'run:settled',
    sealReason: 'runtime-contract-complete',
  });

  const events = ledger.read(runId);
  for (const event of events) assertSchema('event', event);
  assertSchema('seal', sealed.seal);

  const recordFiles = fs.readdirSync(ledger.location(runId).recordsDirectory).sort();
  for (const filename of recordFiles) {
    const record = JSON.parse(fs.readFileSync(path.join(ledger.location(runId).recordsDirectory, filename), 'utf8'));
    assertSchema('record', record);
    if (record.record_kind === 'event') assertSchema('receipt', record.receipt);
  }

  const snapshot = ledger.readSnapshot(runId);
  assertSchema('snapshot', snapshot);
  assertSchema('expected-anchor', {
    eventCount: sealed.seal.event_count,
    finalEventSha256: sealed.seal.final_event_sha256,
    finalRecordSha256: sealed.seal.final_record_sha256,
    sealSha256: sealed.seal.seal_sha256,
  });
});

test('real Shared runtime rejects schema-invalid lifecycle, qualification and length attacks', t => {
  const ledger = tempLedger(t);
  const runId = 'runtime-schema-negative';
  const authority = authoritySet().owner;
  const session = new ProductRunEvidenceSession(ledger, {
    runId,
    surface: 'runtime-contract-test',
    authority,
    openIfMissing: true,
  });
  session.record({ type: 'command.accepted', idempotencyKey: 'command:accepted' });

  for (const payload of [
    { status: 'detected', trust: 'product-runtime-observation' },
    { operation_id: 'recovery-1', status: 'completed', trust: 'product-runtime-observation' },
    { operation_id: 'recovery-1', status: 'detected', trust: 'qualification-attested' },
  ]) {
    expectCode(() => session.record({
      type: 'recovery.detected',
      idempotencyKey: `invalid-recovery:${JSON.stringify(payload)}`,
      payload,
    }), 'RUN_SEMANTIC_INVALID');
  }

  for (const payload of [
    { qualification_claims: [] },
    { nested: { qualificationLevelView: 'L2' } },
    { nested: { QUALIFICATION_CLAIMS: [] } },
    { nested: [{ qualification_eligible: true }] },
  ]) {
    expectCode(() => session.record({
      type: 'checkpoint.created',
      idempotencyKey: `reserved:${JSON.stringify(payload)}`,
      payload,
    }), 'RUN_SEMANTIC_INVALID');
  }

  const tooLong = 'x'.repeat(RUN_EVIDENCE_TEXT_MAX_LENGTH + 1);
  const codePointBoundary = '😀'.repeat(RUN_EVIDENCE_TEXT_MAX_LENGTH);
  const codePointOverflow = `${codePointBoundary}😀`;
  const boundaryRunId = 'runtime-code-point-boundary';
  ledger.openRun({
    runId: boundaryRunId,
    surface: codePointBoundary,
    idempotencyKey: 'open',
    credential: authority,
  });
  assertSchema('event', ledger.read(boundaryRunId)[0]);
  expectCode(() => ledger.openRun({
    runId: 'too-long-surface',
    surface: tooLong,
    idempotencyKey: 'open',
    credential: authority,
  }), 'INVALID_INPUT');
  expectCode(() => ledger.openRun({
    runId: 'too-many-code-points',
    surface: codePointOverflow,
    idempotencyKey: 'open',
    credential: authority,
  }), 'INVALID_INPUT');
  expectCode(() => ledger.append({
    runId,
    expectedHead: headReference(ledger, runId),
    type: 'command.accepted',
    surface: 'runtime-contract-test',
    idempotencyKey: tooLong,
    payload: {},
    credential: authority,
  }), 'INVALID_INPUT');
  expectCode(() => session.record({
    type: 'provider.requested',
    idempotencyKey: 'provider:too-long-operation',
    payload: {
      operation_id: tooLong,
      status: 'requested',
      trust: 'product-runtime-observation',
    },
  }), 'RUN_SEMANTIC_INVALID');
  expectCode(() => session.record({
    type: 'evidence.degraded',
    idempotencyKey: 'degraded:too-long-reason',
    payload: {
      status: 'degraded',
      trust: 'product-runtime-observation',
      reason: tooLong,
    },
  }), 'RUN_SEMANTIC_INVALID');
  expectCode(() => session.importLegacy({
    sourceKind: 'other',
    sourceRef: tooLong,
    sourceSha256: 'c'.repeat(64),
    recordCount: 0,
    projection: {},
  }), 'INVALID_INPUT');

  expectCode(() => session.settleAndSeal({
    status: 'failed',
    idempotencyKey: 'run:settled',
    sealReason: tooLong,
  }), 'INVALID_INPUT');
  assert.equal(ledger.read(runId).some(event => event.type === 'run.settled'), false);
});

test('runtime array snapshots read length once and reject drifting numeric-key boundaries before directory creation', t => {
  const ledger = tempLedger(t);
  const authority = authoritySet().owner;
  let lengthReads = 0;
  const driftingArray = new Proxy(['must-not-be-dropped'], {
    get(target, key, receiver) {
      if (key === 'length') {
        lengthReads += 1;
        return 0;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const before = fs.readdirSync(ledger.rootDir).sort();
  expectCode(() => ledger.openRun({
    runId: 'runtime-array-length-drift',
    surface: 'runtime-contract-test',
    idempotencyKey: 'open',
    payload: { values: driftingArray },
    credential: authority,
  }), 'INVALID_INPUT');
  assert.equal(lengthReads, 1);
  assert.deepEqual(fs.readdirSync(ledger.rootDir).sort(), before);
});

test('persisted observation text is strictly typed and every rejection leaves the durable prefix unchanged', t => {
  const ledger = tempLedger(t);
  const runId = 'runtime-strict-text-matrix';
  const authority = authoritySet().owner;
  const session = new ProductRunEvidenceSession(ledger, {
    runId,
    surface: 'runtime-contract-test',
    authority,
    openIfMissing: true,
  });
  session.record({ type: 'command.accepted', idempotencyKey: 'command:accepted' });

  const durableState = () => ({
    head: ledger.head(runId),
    records: fs.readdirSync(ledger.location(runId).recordsDirectory).sort().map(filename => ({
      filename,
      content: fs.readFileSync(path.join(ledger.location(runId).recordsDirectory, filename), 'utf8'),
    })),
  });
  const invalidText = [null, true, 7, [], {}, 'x'.repeat(RUN_EVIDENCE_TEXT_MAX_LENGTH + 1)];
  let caseIndex = 0;
  const assertRejectedWithoutMutation = fn => {
    const before = durableState();
    expectCode(fn, 'RUN_SEMANTIC_INVALID');
    assert.deepEqual(durableState(), before);
  };

  for (const value of invalidText) {
    const index = caseIndex++;
    assertRejectedWithoutMutation(() => session.record({
      type: 'provider.requested',
      idempotencyKey: `strict:operation-id:${index}`,
      payload: { operation_id: value, status: 'requested', trust: 'product-runtime-observation' },
    }));
    assertRejectedWithoutMutation(() => session.record({
      type: 'evidence.degraded',
      idempotencyKey: `strict:reason:${index}`,
      payload: { status: 'degraded', trust: 'product-runtime-observation', reason: value },
    }));

    for (const field of ['correlation_id', 'source_ref']) {
      assertRejectedWithoutMutation(() => ledger.append({
        runId,
        expectedHead: headReference(ledger, runId),
        type: 'legacy.imported',
        surface: 'runtime-contract-test',
        idempotencyKey: `strict:legacy:${field}:${index}`,
        payload: {
          correlation_id: field === 'correlation_id' ? value : runId,
          trust: 'legacy-unverified',
          qualification_eligible: false,
          source_kind: 'other',
          source_ref: field === 'source_ref' ? value : 'strict-fixture',
          source_sha256: 'd'.repeat(64),
          record_count: 0,
          projection: {},
        },
        credential: authority,
      }));
    }
  }
});

test('runtime and expected-anchor schema share exact-key and strict-type semantics', t => {
  const ledger = tempLedger(t);
  const runId = 'runtime-anchor-exactness';
  const session = new ProductRunEvidenceSession(ledger, {
    runId,
    surface: 'runtime-contract-test',
    authority: authoritySet().owner,
    openIfMissing: true,
  });
  session.record({ type: 'command.accepted', idempotencyKey: 'command:accepted' });
  const sealed = session.settleAndSeal({
    status: 'completed',
    idempotencyKey: 'run:settled',
    sealReason: 'anchor-fixture',
  });
  const anchor = {
    eventCount: sealed.seal.event_count,
    finalEventSha256: sealed.seal.final_event_sha256,
    finalRecordSha256: sealed.seal.final_record_sha256,
    sealSha256: sealed.seal.seal_sha256,
  };
  assert.equal(validators['expected-anchor'](anchor), true);
  assert.equal(ledger.verify(runId, anchor).valid, true);

  for (const attack of [
    { ...anchor, qualificationEligible: false },
    { ...anchor, unexpected: 'forged' },
    { ...anchor, eventCount: String(anchor.eventCount) },
  ]) {
    assert.equal(validators['expected-anchor'](attack), false);
    expectCode(() => ledger.verify(runId, attack), 'INVALID_INPUT');
  }
});

test('fully rehashed schema attacks are rejected identically by Ajv and durable replay', async t => {
  const attacks = [
    {
      name: 'event-root-qualification-claim',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => { record.event.qualification_claims = []; },
    },
    {
      name: 'event-extra-key',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => { record.event.unexpected_field = 'forged'; },
    },
    {
      name: 'event-primitive-payload',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => { record.event.payload = 'forged'; },
    },
    {
      name: 'lifecycle-operation-id-number',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => {
        record.event.type = 'provider.requested';
        record.event.payload = {
          correlation_id: record.event.run_id,
          operation_id: 7,
          status: 'requested',
          trust: 'product-runtime-observation',
        };
      },
    },
    {
      name: 'legacy-extra-key',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => {
        record.event.type = 'legacy.imported';
        record.event.payload = {
          correlation_id: record.event.run_id,
          trust: 'legacy-unverified',
          qualification_eligible: false,
          source_kind: 'other',
          source_ref: 'rehash-fixture',
          source_sha256: 'e'.repeat(64),
          record_count: 0,
          projection: {},
          unexpected: 'forged',
        };
      },
    },
    ...[
      'qual_ification_claim',
      '_qualification_level',
      'q_u_a_l_i_f_i_c_a_t_i_o_nClaims',
      '__QUALIFICATION__LEVEL__VIEW__',
    ].map(key => ({
      name: `qualification-obfuscated-${key}`,
      schema: 'event',
      envelope: record => record.event,
      mutate: record => {
        record.event.payload = {
          correlation_id: record.event.run_id,
          nested: [{ [key]: 'R3' }],
        };
      },
    })),
    {
      name: 'qualification-eligible-obfuscated-true',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => {
        record.event.payload = {
          correlation_id: record.event.run_id,
          q_u_a_l_i_f_i_c_a_t_i_o_n_e_l_i_g_i_b_l_e_: true,
        };
      },
    },
    {
      name: 'payload-embedded-capability',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => {
        record.event.payload = {
          correlation_id: record.event.run_id,
          nested: [`before:${createProductRunEvidenceAuthorityToken()}:after`],
        };
      },
    },
    {
      name: 'payload-capability-object-key',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => {
        record.event.payload = {
          correlation_id: record.event.run_id,
          [`key:${createProductRunEvidenceAuthorityToken()}`]: true,
        };
      },
    },
    {
      name: 'event-surface-capability',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => { record.event.surface = `surface:${createProductRunEvidenceAuthorityToken()}`; },
    },
    {
      name: 'event-surface-edge-whitespace',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => { record.event.surface = ' runtime-contract-attack'; },
    },
    {
      name: 'payload-edge-whitespace',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => { record.event.payload.note = 'trailing-whitespace '; },
    },
    {
      name: 'payload-control-character',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => { record.event.payload.note = 'nul\u0000text'; },
    },
    {
      name: 'event-leap-second',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => { record.event.occurred_at = '2026-07-12T08:00:60.000Z'; },
    },
    {
      name: 'event-extended-year',
      schema: 'event',
      envelope: record => record.event,
      mutate: record => { record.event.occurred_at = '+010000-01-01T00:00:00.000Z'; },
    },
    {
      name: 'receipt-root-qualification-claim',
      schema: 'receipt',
      envelope: record => record.receipt,
      mutate: record => { record.receipt.qualification_claims = []; },
    },
    {
      name: 'receipt-extra-key',
      schema: 'receipt',
      envelope: record => record.receipt,
      mutate: record => { record.receipt.unexpected_field = 'forged'; },
    },
    {
      name: 'receipt-idempotency-capability',
      schema: 'receipt',
      envelope: record => record.receipt,
      mutate: record => { record.receipt.idempotency_key = `receipt:${createProductRunEvidenceAuthorityToken()}`; },
    },
    {
      name: 'record-root-qualification-claim',
      schema: 'record',
      envelope: record => record,
      mutate: record => { record.qualification_claims = []; },
    },
    {
      name: 'record-extra-key',
      schema: 'record',
      envelope: record => record,
      mutate: record => { record.unexpected_field = 'forged'; },
    },
    {
      name: 'seal-root-qualification-claim',
      schema: 'seal',
      seal: true,
      envelope: record => record.seal,
      mutate: record => { record.seal.qualification_claims = []; },
    },
    {
      name: 'seal-extra-key',
      schema: 'seal',
      seal: true,
      envelope: record => record.seal,
      mutate: record => { record.seal.unexpected_field = 'forged'; },
    },
    {
      name: 'seal-reason-capability',
      schema: 'seal',
      seal: true,
      envelope: record => record.seal,
      mutate: record => { record.seal.reason = `seal:${createProductRunEvidenceAuthorityToken()}`; },
    },
  ];

  for (const attack of attacks) {
    await t.test(attack.name, child => {
      const ledger = tempLedger(child);
      const runId = `rehash-${attack.name}`;
      const session = new ProductRunEvidenceSession(ledger, {
        runId,
        surface: 'runtime-contract-attack',
        authority: authoritySet().owner,
        openIfMissing: true,
      });
      session.record({
        type: 'command.accepted',
        idempotencyKey: 'command:accepted',
        payload: { attack: attack.name },
      });
      if (attack.seal) {
        session.settleAndSeal({
          status: 'completed',
          idempotencyKey: 'run:settled',
          sealReason: 'attack-fixture',
        });
      }

      const recordsDirectory = ledger.location(runId).recordsDirectory;
      const filename = fs.readdirSync(recordsDirectory).sort().at(-1);
      const target = path.join(recordsDirectory, filename);
      const record = JSON.parse(fs.readFileSync(target, 'utf8'));
      attack.mutate(record);
      rehashRecord(record);

      const envelope = attack.envelope(record);
      assert.equal(
        validators[attack.schema](envelope),
        false,
        `${attack.name} unexpectedly passed ${attack.schema} schema`,
      );
      assert.equal(validators.record(record), false, `${attack.name} unexpectedly passed record schema`);

      fs.chmodSync(target, 0o644);
      fs.writeFileSync(target, `${attackerCanonicalJson(record)}\n`);
      const report = ledger.verify(runId);
      assert.equal(report.valid, false);
      assert.equal(
        report.issues.some(issue => issue.code === 'RECORD_SCHEMA_INVALID'),
        true,
        `${attack.name}: ${JSON.stringify(report.issues)}`,
      );
    });
  }
});
