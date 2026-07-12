#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unsupported = process.argv.slice(2).filter(argument => argument !== '--write');
const errors = unsupported.map(argument => `argument:unsupported:${argument}`);
const schemaNames = ['event', 'receipt', 'seal', 'record', 'snapshot', 'expected-anchor'];
const schemaPaths = new Map(schemaNames.map(name => [
  name,
  path.join(repoRoot, 'docs', 'process', `devseek-run-evidence-${name}.schema.json`),
]));
const generatedPath = path.join(repoRoot, 'docs', 'process', 'generated', 'devseek-run-evidence-contract.md');
const protocolSourcePath = path.join(repoRoot, 'packages', 'shared', 'src', 'run-evidence-protocol.ts');
const productSourceRoots = ['bridge', 'cli', 'vscode-extension'].map(name => (
  path.join(repoRoot, 'packages', name, 'src')
));
let schemaAttackCount = 0;

const schemas = new Map();
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const [name, schemaPath] of schemaPaths) {
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    schemas.set(name, schema);
    ajv.addSchema(schema);
  } catch (error) {
    errors.push(`schema:${name}:read-or-add:${error.message}`);
  }
}
for (const name of schemaNames) {
  const schema = schemas.get(name);
  if (!schema) continue;
  try {
    if (!ajv.getSchema(schema.$id)) throw new Error(`schema-not-resolved:${schema.$id}`);
  } catch (error) {
    errors.push(`schema:${name}:strict-compile:${error.message}`);
  }
}

const eventSchema = schemas.get('event');
const schemaEventTypes = eventSchema?.properties?.type?.enum ?? [];
const operationStatuses = new Map([
  ['provider.requested', 'requested'],
  ['provider.completed', 'completed'],
  ['provider.failed', 'failed'],
  ['side_effect.requested', 'requested'],
  ['side_effect.authorized', 'authorized'],
  ['side_effect.started', 'started'],
  ['side_effect.committed', 'committed'],
  ['side_effect.failed', 'failed'],
  ['side_effect.indeterminate', 'indeterminate'],
  ['verification.started', 'started'],
  ['verification.completed', 'completed'],
  ['verification.failed', 'failed'],
  ['quality_gate.started', 'started'],
  ['quality_gate.passed', 'passed'],
  ['quality_gate.failed', 'failed'],
  ['quality_gate.vetoed', 'vetoed'],
  ['recovery.detected', 'detected'],
  ['recovery.completed', 'completed'],
  ['recovery.failed', 'failed'],
]);

try {
  const source = fs.readFileSync(protocolSourcePath, 'utf8');
  const sourceEventTypes = extractStringArray(source, 'RUN_EVIDENCE_EVENT_TYPES');
  if (JSON.stringify(sourceEventTypes) !== JSON.stringify(schemaEventTypes)) {
    errors.push('protocol:event-type-taxonomy-drift');
  }
  assertSourceConstant(source, 'RUN_EVIDENCE_INTEGRITY_SCOPE', 'product-run-diagnostics');
  assertSourceConstant(source, 'RUN_EVIDENCE_EVENT_PROTOCOL', 'devseek.run-evidence-event/v1');
  assertSourceConstant(source, 'RUN_EVIDENCE_RECEIPT_PROTOCOL', 'devseek.run-evidence-receipt/v1');
  assertSourceConstant(source, 'RUN_EVIDENCE_RECORD_PROTOCOL', 'devseek.run-evidence-record/v1');
  assertSourceConstant(source, 'RUN_EVIDENCE_SEAL_PROTOCOL', 'devseek.run-evidence-seal/v1');
  if (!/RUN_EVIDENCE_QUALIFICATION_ELIGIBLE\s*=\s*false\s+as const/.test(source)) {
    errors.push('protocol:qualification-eligible-must-remain-false');
  }
} catch (error) {
  errors.push(`protocol:source:${error.message}`);
}
assertProductRawWriterBoundary();

const fixtures = buildFixtures();
validatePositive('event', fixtures.event);
validatePositive('receipt', fixtures.receipt);
validatePositive('seal', fixtures.seal);
validatePositive('record', fixtures.eventRecord);
validatePositive('record', fixtures.sealRecord);
validatePositive('snapshot', fixtures.snapshot);
validatePositive('expected-anchor', fixtures.anchor);
for (const [type, status] of operationStatuses) {
  validatePositive('event', operationEvent(fixtures.event, type, status));
}
validatePositive('event', {
  ...nextEvent(fixtures.event, 'evidence.degraded'),
  payload: {
    correlation_id: fixtures.event.run_id,
    status: 'degraded',
    trust: 'product-runtime-observation',
    reason: 'diagnostic-write-failed',
  },
});
validatePositive('event', {
  ...nextEvent(fixtures.event, 'legacy.imported'),
  payload: {
    correlation_id: fixtures.event.run_id,
    trust: 'legacy-unverified',
    qualification_eligible: false,
    source_kind: 'other',
    source_ref: 'explicit-legacy-source',
    source_sha256: 'b'.repeat(64),
    record_count: 1,
    projection: { qualification_claims: [{ legacy_only: true }] },
  },
});
validatePositive('event', nextEvent(fixtures.event, 'agent.status'));
validatePositive('event', nextEvent(fixtures.event, 'tool.activity'));
validatePositive('event', nextEvent(fixtures.event, 'command.accepted'));
validatePositive('event', {
  ...nextEvent(fixtures.event, 'checkpoint.created'),
  payload: {
    correlation_id: fixtures.event.run_id,
    q_u_a_l_i_f_i_c_a_t_i_o_n_e_l_i_g_i_b_l_e_: false,
    I_N_T_E_G_R_I_T_Y_S_C_O_P_E_: 'product-run-diagnostics',
  },
});
validatePositive('event', {
  ...nextEvent(fixtures.event, 'legacy.imported'),
  payload: {
    correlation_id: fixtures.event.run_id,
    trust: 'legacy-unverified',
    qualification_eligible: false,
    source_kind: 'task-history',
    source_ref: 'vscode-workspace-state:devseek.taskHistory',
    source_sha256: 'a'.repeat(64),
    record_count: 0,
    projection: { status_counts: {} },
  },
});

assertInvalid('unknown-event-type', 'event', { ...fixtures.event, type: 'provider.unknown' });
assertInvalid('extra-event-field', 'event', { ...fixtures.event, injected_claim: true });
assertInvalid('event-root-qualification-claim', 'event', { ...fixtures.event, qualification_claims: [] });
assertInvalid('event-primitive-payload', 'event', { ...nextEvent(fixtures.event, 'command.accepted'), payload: 'forged' });
assertInvalid('qualification-escalation-event', 'event', { ...fixtures.event, qualification_eligible: true });
assertInvalid('payload-qualification-claim', 'event', {
  ...nextEvent(fixtures.event, 'command.accepted'),
  payload: { correlation_id: fixtures.event.run_id, qualification_claim: 'R3' },
});
assertInvalid('payload-qualification-claims', 'event', {
  ...nextEvent(fixtures.event, 'command.accepted'),
  payload: { correlation_id: fixtures.event.run_id, qualification_claims: [] },
});
assertInvalid('payload-qualification-level-view', 'event', {
  ...nextEvent(fixtures.event, 'command.accepted'),
  payload: { correlation_id: fixtures.event.run_id, nested: { qualificationLevelView: 'L2' } },
});
assertInvalid('payload-qualification-uppercase-claim', 'event', {
  ...nextEvent(fixtures.event, 'command.accepted'),
  payload: { correlation_id: fixtures.event.run_id, nested: { QUALIFICATION_CLAIMS: [] } },
});
for (const [index, key] of [
  'qual_ification_claim',
  '_qualification_level',
  'q_u_a_l_i_f_i_c_a_t_i_o_nClaims',
  '__QUALIFICATION__LEVEL__VIEW__',
].entries()) {
  assertInvalid(`payload-qualification-obfuscated-${index}`, 'event', {
    ...nextEvent(fixtures.event, 'checkpoint.created'),
    payload: { correlation_id: fixtures.event.run_id, nested: [{ [key]: 'R3' }] },
  });
}
assertInvalid('payload-qualification-eligible-obfuscated-true', 'event', {
  ...nextEvent(fixtures.event, 'checkpoint.created'),
  payload: {
    correlation_id: fixtures.event.run_id,
    q_u_a_l_i_f_i_c_a_t_i_o_n_e_l_i_g_i_b_l_e_: true,
  },
});
assertInvalid('payload-integrity-scope-obfuscated', 'event', {
  ...nextEvent(fixtures.event, 'checkpoint.created'),
  payload: { correlation_id: fixtures.event.run_id, I_N_T_E_G_R_I_T_Y_S_C_O_P_E_: 'qualification-evidence' },
});
assertInvalid('qualification-escalation-receipt', 'receipt', { ...fixtures.receipt, qualification_eligible: true });
assertInvalid('receipt-extra-field', 'receipt', { ...fixtures.receipt, unexpected_field: 'forged' });
assertInvalid('receipt-root-qualification-claim', 'receipt', { ...fixtures.receipt, qualification_claims: [] });
assertInvalid('qualification-escalation-seal', 'seal', { ...fixtures.seal, qualification_eligible: true });
assertInvalid('seal-extra-field', 'seal', { ...fixtures.seal, unexpected_field: 'forged' });
assertInvalid('seal-root-qualification-claim', 'seal', { ...fixtures.seal, qualification_claims: [] });
assertInvalid('record-extra-field', 'record', { ...fixtures.eventRecord, unexpected_field: 'forged' });
assertInvalid('record-root-qualification-claim', 'record', { ...fixtures.eventRecord, qualification_claims: [] });
assertInvalid('qualification-escalation-snapshot', 'snapshot', { ...fixtures.snapshot, qualificationEligible: true });
assertInvalid('critical-status-mismatch', 'event', operationEvent(fixtures.event, 'provider.requested', 'completed'));
const missingOperation = operationEvent(fixtures.event, 'verification.started', 'started');
delete missingOperation.payload.operation_id;
assertInvalid('critical-operation-id-missing', 'event', missingOperation);
assertInvalid('critical-trust-invalid', 'event', {
  ...operationEvent(fixtures.event, 'quality_gate.passed', 'passed'),
  payload: {
    ...operationEvent(fixtures.event, 'quality_gate.passed', 'passed').payload,
    trust: 'qualification-attested',
  },
});
for (const [index, value] of [null, true, 7, [], {}].entries()) {
  assertInvalid(`critical-operation-id-type-${index}`, 'event', {
    ...operationEvent(fixtures.event, 'provider.requested', 'requested'),
    payload: {
      ...operationEvent(fixtures.event, 'provider.requested', 'requested').payload,
      operation_id: value,
    },
  });
}
assertInvalid('degraded-reason-number', 'event', {
  ...nextEvent(fixtures.event, 'evidence.degraded'),
  payload: { status: 'degraded', trust: 'product-runtime-observation', reason: 7 },
});
const exactLegacy = {
  correlation_id: fixtures.event.run_id,
  trust: 'legacy-unverified',
  qualification_eligible: false,
  source_kind: 'other',
  source_ref: 'legacy-source',
  source_sha256: 'b'.repeat(64),
  record_count: 1,
  projection: {},
};
assertInvalid('legacy-extra-field', 'event', {
  ...nextEvent(fixtures.event, 'legacy.imported'),
  payload: { ...exactLegacy, unexpected: 'forged' },
});
assertInvalid('legacy-correlation-id-number', 'event', {
  ...nextEvent(fixtures.event, 'legacy.imported'),
  payload: { ...exactLegacy, correlation_id: 7 },
});
assertInvalid('legacy-source-ref-number', 'event', {
  ...nextEvent(fixtures.event, 'legacy.imported'),
  payload: { ...exactLegacy, source_ref: 7 },
});
assertInvalid('legacy-source-kind-number', 'event', {
  ...nextEvent(fixtures.event, 'legacy.imported'),
  payload: { ...exactLegacy, source_kind: 7 },
});
const capability = `devseek-ra1_${'Z'.repeat(43)}`;
assertInvalid('payload-embedded-capability', 'event', {
  ...nextEvent(fixtures.event, 'command.accepted'),
  payload: { correlation_id: fixtures.event.run_id, nested: [`before:${capability}:after`] },
});
assertInvalid('payload-capability-key', 'event', {
  ...nextEvent(fixtures.event, 'command.accepted'),
  payload: { correlation_id: fixtures.event.run_id, [`key:${capability}`]: true },
});
assertInvalid('legacy-projection-capability', 'event', {
  ...nextEvent(fixtures.event, 'legacy.imported'),
  payload: { ...exactLegacy, projection: { nested: [capability] } },
});
assertInvalid('event-surface-capability', 'event', { ...fixtures.event, surface: `surface:${capability}` });
assertInvalid('receipt-idempotency-capability', 'receipt', {
  ...fixtures.receipt,
  idempotency_key: `receipt:${capability}`,
});
assertInvalid('seal-reason-capability', 'seal', { ...fixtures.seal, reason: `seal:${capability}` });
assertInvalid('snapshot-run-id-capability', 'snapshot', { ...fixtures.snapshot, runId: `snapshot:${capability}` });
const overlongText = 'x'.repeat(513);
assertInvalid('event-surface-overlength', 'event', { ...fixtures.event, surface: overlongText });
assertInvalid('event-idempotency-overlength', 'event', { ...fixtures.event, idempotency_key: overlongText });
assertInvalid('critical-operation-id-overlength', 'event', {
  ...operationEvent(fixtures.event, 'recovery.detected', 'detected'),
  payload: {
    ...operationEvent(fixtures.event, 'recovery.detected', 'detected').payload,
    operation_id: overlongText,
  },
});
assertInvalid('degraded-reason-overlength', 'event', {
  ...nextEvent(fixtures.event, 'evidence.degraded'),
  payload: {
    status: 'degraded',
    trust: 'product-runtime-observation',
    reason: overlongText,
  },
});
assertInvalid('legacy-source-ref-overlength', 'event', {
  ...nextEvent(fixtures.event, 'legacy.imported'),
  payload: {
    correlation_id: fixtures.event.run_id,
    trust: 'legacy-unverified',
    qualification_eligible: false,
    source_kind: 'other',
    source_ref: overlongText,
    source_sha256: 'b'.repeat(64),
    record_count: 1,
    projection: {},
  },
});
assertInvalid('seal-reason-overlength', 'seal', { ...fixtures.seal, reason: overlongText });
assertInvalid('event-sequence-unsafe-integer', 'event', { ...fixtures.event, sequence: 9007199254740992 });
assertInvalid('receipt-sequence-unsafe-integer', 'receipt', { ...fixtures.receipt, sequence: 9007199254740992 });
assertInvalid('record-slot-unsafe-integer', 'record', { ...fixtures.eventRecord, slot_sequence: 9007199254740992 });
assertInvalid('seal-count-unsafe-integer', 'seal', { ...fixtures.seal, event_count: 9007199254740992 });
assertInvalid('expected-anchor-extra-field', 'expected-anchor', { ...fixtures.anchor, qualificationEligible: false });

if (eventSchema) {
  if (eventSchema.additionalProperties !== false) errors.push('schema:event:additional-properties-not-closed');
  if (eventSchema.properties?.qualification_eligible?.const !== false) errors.push('schema:event:qualification-boundary-open');
  for (const required of ['protocol', 'integrity_scope', 'qualification_eligible', 'run_id', 'surface', 'idempotency_key', 'type', 'occurred_at', 'event_sha256']) {
    if (!eventSchema.required?.includes(required)) errors.push(`schema:event:required-field-missing:${required}`);
  }
}
for (const name of ['receipt', 'seal', 'snapshot', 'expected-anchor']) {
  const schema = schemas.get(name);
  if (schema?.additionalProperties !== false) errors.push(`schema:${name}:additional-properties-not-closed`);
}

const markdown = renderMarkdown({
  eventTypes: schemaEventTypes,
  operationStatuses,
  schemaAttackCount,
  fingerprints: Object.fromEntries([...schemaPaths].map(([name, schemaPath]) => [name, sha256Bytes(fs.readFileSync(schemaPath))])),
});
if (write) {
  fs.mkdirSync(path.dirname(generatedPath), { recursive: true });
  fs.writeFileSync(generatedPath, markdown, 'utf8');
} else {
  try {
    if (fs.readFileSync(generatedPath, 'utf8') !== markdown) errors.push('generated:run-evidence-contract-view-drift');
  } catch (error) {
    errors.push(`generated:run-evidence-contract-view:${error.message}`);
  }
}

if (errors.length > 0) {
  console.error('[run-evidence-contract] failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`[run-evidence-contract] ok schemas=${schemas.size} event_types=${schemaEventTypes.length} critical_operations=${operationStatuses.size} schema_attacks=${schemaAttackCount} qualification_eligible=false`);

function validatePositive(name, value) {
  const schema = schemas.get(name);
  const validate = schema ? ajv.getSchema(schema.$id) : undefined;
  if (!validate) return;
  if (!validate(value)) errors.push(`fixture:${name}:invalid:${ajv.errorsText(validate.errors, { separator: ' | ' })}`);
}

function assertInvalid(label, name, value) {
  schemaAttackCount += 1;
  const schema = schemas.get(name);
  const validate = schema ? ajv.getSchema(schema.$id) : undefined;
  if (validate?.(value)) errors.push(`attack:${label}:accepted`);
}

function assertProductRawWriterBoundary() {
  const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
  for (const sourceRoot of productSourceRoots) {
    if (!fs.existsSync(sourceRoot)) continue;
    for (const target of walkFiles(sourceRoot)) {
      if (!extensions.has(path.extname(target))) continue;
      const source = fs.readFileSync(target, 'utf8');
      if (/\bFileSystemRunEvidenceLedger\b|run-evidence-ledger/.test(source)) {
        errors.push(`boundary:product-imports-internal-raw-writer:${path.relative(repoRoot, target)}`);
      }
    }
  }
}

function walkFiles(root) {
  const result = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) result.push(target);
    }
  }
  return result;
}

function extractStringArray(source, constantName) {
  const pattern = new RegExp(`export const ${constantName}\\s*=\\s*\\[([\\s\\S]*?)\\] as const`);
  const match = pattern.exec(source);
  if (!match) throw new Error(`${constantName}-not-found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
}

function assertSourceConstant(source, name, expected) {
  const pattern = new RegExp(`export const ${name}\\s*=\\s*'([^']+)'\\s+as const`);
  const actual = pattern.exec(source)?.[1];
  if (actual !== expected) errors.push(`protocol:${name}:expected-${expected}:actual-${actual ?? 'missing'}`);
}

function nextEvent(opened, type) {
  return {
    ...opened,
    sequence: 2,
    previous_event_sha256: opened.event_sha256,
    type,
    idempotency_key: `${type}:fixture`,
    payload: { correlation_id: opened.run_id },
  };
}

function operationEvent(opened, type, status) {
  return {
    ...nextEvent(opened, type),
    payload: {
      correlation_id: opened.run_id,
      operation_id: 'operation-fixture-1',
      status,
      trust: 'product-runtime-observation',
    },
  };
}

function buildFixtures() {
  const hashA = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);
  const hashC = 'c'.repeat(64);
  const hashD = 'd'.repeat(64);
  const runId = 'run-contract-fixture';
  const event = {
    protocol: 'devseek.run-evidence-event/v1',
    integrity_scope: 'product-run-diagnostics',
    qualification_eligible: false,
    run_id: runId,
    sequence: 1,
    previous_event_sha256: null,
    type: 'run.opened',
    surface: 'contract-checker',
    idempotency_key: 'open:contract-fixture',
    idempotency_fingerprint_sha256: hashA,
    occurred_at: '2026-07-12T00:00:00.000Z',
    payload: {
      correlation_id: runId,
      _devseek_run_evidence_authority: {
        protocol: 'devseek.product-run-evidence-authority/v1',
        owner_token_sha256: hashA,
        participant_token_sha256: hashB,
      },
    },
    event_sha256: hashB,
  };
  const receipt = {
    protocol: 'devseek.run-evidence-receipt/v1',
    integrity_scope: 'product-run-diagnostics',
    qualification_eligible: false,
    run_id: runId,
    sequence: 1,
    event_sha256: hashB,
    previous_event_sha256: null,
    idempotency_key: 'open:contract-fixture',
    committed_at: '2026-07-12T00:00:00.001Z',
    receipt_sha256: hashC,
  };
  const eventRecord = {
    protocol: 'devseek.run-evidence-record/v1',
    record_kind: 'event',
    slot_sequence: 1,
    previous_record_sha256: null,
    event,
    receipt,
    record_sha256: hashD,
  };
  const seal = {
    protocol: 'devseek.run-evidence-seal/v1',
    integrity_scope: 'product-run-diagnostics',
    qualification_eligible: false,
    run_id: runId,
    slot_sequence: 2,
    event_count: 1,
    final_event_sha256: hashB,
    final_record_sha256: hashD,
    idempotency_key: 'seal:contract-fixture',
    idempotency_fingerprint_sha256: hashA,
    reason: 'fixture-complete',
    sealed_at: '2026-07-12T00:00:00.002Z',
    seal_sha256: hashC,
  };
  const sealRecord = {
    protocol: 'devseek.run-evidence-record/v1',
    record_kind: 'seal',
    slot_sequence: 2,
    previous_record_sha256: hashD,
    seal,
    record_sha256: hashA,
  };
  const snapshot = {
    runId,
    integrityScope: 'product-run-diagnostics',
    qualificationEligible: false,
    records: [{
      slotSequence: 1,
      previousRecordSha256: null,
      event,
      receipt,
      recordSha256: hashD,
    }],
    seal: {
      slotSequence: 2,
      previousRecordSha256: hashD,
      seal,
      recordSha256: hashA,
    },
    head: {
      runId,
      sequence: 1,
      eventSha256: hashB,
      recordSha256: hashD,
      sealed: true,
      sealSha256: hashC,
    },
  };
  const anchor = {
    eventCount: 1,
    finalEventSha256: hashB,
    finalRecordSha256: hashD,
    sealSha256: hashC,
  };
  return { event, receipt, eventRecord, seal, sealRecord, snapshot, anchor };
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function renderMarkdown({ eventTypes, operationStatuses, schemaAttackCount, fingerprints }) {
  return `${[
    '# DevSeek G0-D Product Run Evidence Machine Contract',
    '',
    '> Generated by `npm run generate:run-evidence-contract`. Do not edit manually.',
    '>',
    '> Scope is `product-run-diagnostics`; `qualification_eligible=false`. This contract records product facts and grants no qualification claim.',
    '',
    '## Closed envelopes',
    '',
    '| Envelope | Protocol / public shape | Schema SHA-256 |',
    '|---|---|---|',
    `| Event | \`devseek.run-evidence-event/v1\` | \`${fingerprints.event}\` |`,
    `| Receipt | \`devseek.run-evidence-receipt/v1\` | \`${fingerprints.receipt}\` |`,
    `| Immutable record | \`devseek.run-evidence-record/v1\` | \`${fingerprints.record}\` |`,
    `| Seal | \`devseek.run-evidence-seal/v1\` | \`${fingerprints.seal}\` |`,
    `| Replay snapshot | \`RunEvidenceSnapshot\` | \`${fingerprints.snapshot}\` |`,
    `| Independently retained anchor | \`RunEvidenceExpectedAnchor\` | \`${fingerprints['expected-anchor']}\` |`,
    '',
    '## Closed event taxonomy',
    '',
    ...eventTypes.map(type => `- \`${type}\``),
    '',
    '## Operation-correlated high-risk boundaries',
    '',
    '| Event | Required status | Required trust |',
    '|---|---|---|',
    ...[...operationStatuses].map(([type, status]) => `| \`${type}\` | \`${status}\` | \`product-runtime-observation\` |`),
    '',
    'Every row above requires a non-empty `operation_id`. `evidence.degraded` separately requires `status=degraded`, diagnostic trust, and a non-empty reason. Legacy imports remain `legacy-unverified` and qualification-ineligible.',
    '',
    '## Mutation authority and prefix safety',
    '',
    '- Every raw mutation carries a runtime-only owner or participant credential. `run.opened` persists only distinct SHA-256 token digests; plaintext credentials are never part of an event, receipt, record, snapshot, or seal.',
    '- Each append re-reads the durable `run.opened` authority metadata and authenticates again after a lost CAS. Only the owner can append `run.settled` or create a seal.',
    '- One pure prefix reducer is applied before every record CAS and again during replay. It permits pending work, but rejects terminal-before-request, duplicate/conflicting terminals, unauthorized side effects, invalid recovery resolution, settlement without closure, and every event after settlement before the head or record directory changes.',
    '- Bridge, CLI, and VS Code product source may use the product session boundary, but a static gate rejects imports or references to the internal filesystem raw writer.',
    '',
    '## Runtime/schema convergence gate',
    '',
    '- `npm run verify:run-evidence-contract` first builds Shared, then creates real runtime events, receipts, immutable records, seals, snapshots, and expected anchors and validates all six envelope kinds with Ajv 2020 strict mode.',
    '- The same gate proves that Shared rejects malformed recovery states, recursive reserved qualification fields, and values beyond the common 512-character boundary before they can commit a poisoned event.',
    `- The checker independently runs ${schemaAttackCount} negative schema attacks. An expanded bidirectional runtime matrix then fully rehashes event, payload, receipt, record, and seal mutations and proves both Ajv and durable replay reject the same malformed envelope.`,
    '',
    '## Boundary limitations',
    '',
    '- Strict JSON Schema and local replay detect malformed envelopes, unknown event kinds, hash-shape drift, illegal status transitions, and attempted qualification escalation.',
    '- Reserved qualification claim/level fields are forbidden inside payloads; an optional nested qualification_eligible marker can only be false.',
    '- Schema conformance does not prove that hashes are externally retained, that time is trusted, or that a complete local tail was never deleted.',
    '- An expected anchor detects tail deletion only when a different trust domain retains it. A same-host copy is not an independent anchor.',
    '- G0-C may reference a sealed snapshot and anchor, but this product ledger cannot issue a verdict or claim.',
  ].join('\n')}\n`;
}
