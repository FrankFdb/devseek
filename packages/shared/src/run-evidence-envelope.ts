import {
  assertRunEvidenceEnvelopeQualificationBoundary,
  assertRunEvidenceEventObservationContract,
  normalizeRunEvidenceJson,
  readRunEvidenceAuthorityMetadata,
  RUN_EVIDENCE_EVENT_PROTOCOL,
  RUN_EVIDENCE_EVENT_TYPES,
  RUN_EVIDENCE_INTEGRITY_SCOPE,
  RUN_EVIDENCE_QUALIFICATION_ELIGIBLE,
  RUN_EVIDENCE_RECEIPT_PROTOCOL,
  RUN_EVIDENCE_RECORD_PROTOCOL,
  RUN_EVIDENCE_SEAL_PROTOCOL,
  RUN_EVIDENCE_TEXT_MAX_LENGTH,
  type RunEvidenceEvent,
  type RunEvidenceReceipt,
  type RunEvidenceSeal,
  RunEvidenceLedgerError,
} from './run-evidence-protocol';

const EVENT_KEYS = [
  'protocol',
  'integrity_scope',
  'qualification_eligible',
  'run_id',
  'sequence',
  'previous_event_sha256',
  'type',
  'surface',
  'idempotency_key',
  'idempotency_fingerprint_sha256',
  'occurred_at',
  'payload',
  'event_sha256',
] as const;
const RECEIPT_KEYS = [
  'protocol',
  'integrity_scope',
  'qualification_eligible',
  'run_id',
  'sequence',
  'event_sha256',
  'previous_event_sha256',
  'idempotency_key',
  'committed_at',
  'receipt_sha256',
] as const;
const SEAL_KEYS = [
  'protocol',
  'integrity_scope',
  'qualification_eligible',
  'run_id',
  'slot_sequence',
  'event_count',
  'final_event_sha256',
  'final_record_sha256',
  'idempotency_key',
  'idempotency_fingerprint_sha256',
  'reason',
  'sealed_at',
  'seal_sha256',
] as const;
const EVENT_RECORD_KEYS = [
  'protocol',
  'record_kind',
  'slot_sequence',
  'previous_record_sha256',
  'event',
  'receipt',
  'record_sha256',
] as const;
const SEAL_RECORD_KEYS = [
  'protocol',
  'record_kind',
  'slot_sequence',
  'previous_record_sha256',
  'seal',
  'record_sha256',
] as const;
const EVENT_TYPE_SET = new Set<string>(RUN_EVIDENCE_EVENT_TYPES);

export function assertRunEvidenceEventEnvelope(value: unknown): asserts value is RunEvidenceEvent {
  const event = requireExactObject(normalizeRunEvidenceJson(value), EVENT_KEYS, 'event');
  requireConstant(event.protocol, RUN_EVIDENCE_EVENT_PROTOCOL, 'event.protocol');
  requireDiagnosticBoundary(event, 'event');
  requireBoundedText(event.run_id, 'event.run_id');
  requireSafeInteger(event.sequence, 1, 'event.sequence');
  requireNullableSha256(event.previous_event_sha256, 'event.previous_event_sha256');
  if (typeof event.type !== 'string' || !EVENT_TYPE_SET.has(event.type)) shapeFailure('event.type is invalid');
  requireBoundedText(event.surface, 'event.surface');
  requireBoundedText(event.idempotency_key, 'event.idempotency_key');
  requireSha256(event.idempotency_fingerprint_sha256, 'event.idempotency_fingerprint_sha256');
  requireCanonicalTimestamp(event.occurred_at, 'event.occurred_at');
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    shapeFailure('event.payload must be an object');
  }
  requireSha256(event.event_sha256, 'event.event_sha256');
  const typed = event as unknown as RunEvidenceEvent;
  assertRunEvidenceEnvelopeQualificationBoundary(
    typed as unknown as Parameters<typeof assertRunEvidenceEnvelopeQualificationBoundary>[0],
    typed.type === 'legacy.imported' ? '$.payload.projection' : undefined,
  );
  assertRunEvidenceEventObservationContract(typed.type, typed.payload, typed.sequence);
  if (typed.type === 'run.opened') readRunEvidenceAuthorityMetadata([typed]);
}

export function assertRunEvidenceReceiptEnvelope(value: unknown): asserts value is RunEvidenceReceipt {
  const receipt = requireExactObject(normalizeRunEvidenceJson(value), RECEIPT_KEYS, 'receipt');
  requireConstant(receipt.protocol, RUN_EVIDENCE_RECEIPT_PROTOCOL, 'receipt.protocol');
  requireDiagnosticBoundary(receipt, 'receipt');
  requireBoundedText(receipt.run_id, 'receipt.run_id');
  requireSafeInteger(receipt.sequence, 1, 'receipt.sequence');
  requireSha256(receipt.event_sha256, 'receipt.event_sha256');
  requireNullableSha256(receipt.previous_event_sha256, 'receipt.previous_event_sha256');
  requireBoundedText(receipt.idempotency_key, 'receipt.idempotency_key');
  requireCanonicalTimestamp(receipt.committed_at, 'receipt.committed_at');
  requireSha256(receipt.receipt_sha256, 'receipt.receipt_sha256');
  assertRunEvidenceEnvelopeQualificationBoundary(receipt as never);
}

export function assertRunEvidenceSealEnvelope(value: unknown): asserts value is RunEvidenceSeal {
  const seal = requireExactObject(normalizeRunEvidenceJson(value), SEAL_KEYS, 'seal');
  requireConstant(seal.protocol, RUN_EVIDENCE_SEAL_PROTOCOL, 'seal.protocol');
  requireDiagnosticBoundary(seal, 'seal');
  requireBoundedText(seal.run_id, 'seal.run_id');
  requireSafeInteger(seal.slot_sequence, 2, 'seal.slot_sequence');
  requireSafeInteger(seal.event_count, 1, 'seal.event_count');
  requireSha256(seal.final_event_sha256, 'seal.final_event_sha256');
  requireSha256(seal.final_record_sha256, 'seal.final_record_sha256');
  requireBoundedText(seal.idempotency_key, 'seal.idempotency_key');
  requireSha256(seal.idempotency_fingerprint_sha256, 'seal.idempotency_fingerprint_sha256');
  requireBoundedText(seal.reason, 'seal.reason');
  requireCanonicalTimestamp(seal.sealed_at, 'seal.sealed_at');
  requireSha256(seal.seal_sha256, 'seal.seal_sha256');
  assertRunEvidenceEnvelopeQualificationBoundary(seal as never);
}

export function assertRunEvidenceRecordEnvelope(value: unknown): void {
  const candidate = requireObject(normalizeRunEvidenceJson(value), 'record');
  if (candidate.record_kind === 'event') {
    const record = requireExactObject(candidate, EVENT_RECORD_KEYS, 'event record');
    requireConstant(record.protocol, RUN_EVIDENCE_RECORD_PROTOCOL, 'record.protocol');
    requireSafeInteger(record.slot_sequence, 1, 'record.slot_sequence');
    requireNullableSha256(record.previous_record_sha256, 'record.previous_record_sha256');
    assertRunEvidenceEventEnvelope(record.event);
    assertRunEvidenceReceiptEnvelope(record.receipt);
    requireSha256(record.record_sha256, 'record.record_sha256');
    const event = record.event as RunEvidenceEvent;
    assertRunEvidenceEnvelopeQualificationBoundary(
      record as never,
      event.type === 'legacy.imported' ? '$.event.payload.projection' : undefined,
    );
    return;
  }
  if (candidate.record_kind === 'seal') {
    const record = requireExactObject(candidate, SEAL_RECORD_KEYS, 'seal record');
    requireConstant(record.protocol, RUN_EVIDENCE_RECORD_PROTOCOL, 'record.protocol');
    requireSafeInteger(record.slot_sequence, 2, 'record.slot_sequence');
    requireSha256(record.previous_record_sha256, 'record.previous_record_sha256');
    assertRunEvidenceSealEnvelope(record.seal);
    requireSha256(record.record_sha256, 'record.record_sha256');
    assertRunEvidenceEnvelopeQualificationBoundary(record as never);
    return;
  }
  shapeFailure('record.record_kind is invalid');
}

function requireDiagnosticBoundary(value: Record<string, unknown>, path: string): void {
  requireConstant(value.integrity_scope, RUN_EVIDENCE_INTEGRITY_SCOPE, `${path}.integrity_scope`);
  requireConstant(value.qualification_eligible, RUN_EVIDENCE_QUALIFICATION_ELIGIBLE, `${path}.qualification_eligible`);
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) shapeFailure(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function requireExactObject(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  const object = requireObject(value, path);
  const actual = Object.keys(object).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    shapeFailure(`${path} has missing or additional properties`);
  }
  return object;
}

function requireConstant(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) shapeFailure(`${path} is invalid`);
}

function requireBoundedText(value: unknown, path: string): void {
  if (
    typeof value !== 'string'
    || Array.from(value).length < 1
    || Array.from(value).length > RUN_EVIDENCE_TEXT_MAX_LENGTH
    || value !== value.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) shapeFailure(`${path} must be bounded non-empty text`);
}

function requireSafeInteger(value: unknown, minimum: number, path: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) shapeFailure(`${path} must be an integer >= ${minimum}`);
}

function requireSha256(value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) shapeFailure(`${path} must be a lowercase SHA-256`);
}

function requireNullableSha256(value: unknown, path: string): void {
  if (value !== null) requireSha256(value, path);
}

function requireCanonicalTimestamp(value: unknown, path: string): void {
  if (
    typeof value !== 'string'
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-5][0-9]\.[0-9]{3}Z$/.test(value)
  ) shapeFailure(`${path} must be a canonical timestamp`);
  const date = new Date(value as string);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    shapeFailure(`${path} must be canonical UTC with milliseconds`);
  }
}

function shapeFailure(message: string): never {
  throw new RunEvidenceLedgerError('RUN_SEMANTIC_INVALID', message);
}
