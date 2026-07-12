import {
  assertRunEvidenceEventObservationContract,
  assertRunEvidencePayloadQualificationBoundary,
  canonicalRunEvidenceJson,
  RUN_EVIDENCE_EVENT_PROTOCOL,
  RUN_EVIDENCE_EVENT_TYPES,
  RUN_EVIDENCE_INTEGRITY_SCOPE,
  RUN_EVIDENCE_QUALIFICATION_ELIGIBLE,
  RUN_EVIDENCE_RECEIPT_PROTOCOL,
  RUN_EVIDENCE_RECORD_PROTOCOL,
  RUN_EVIDENCE_SEAL_PROTOCOL,
  RUN_EVIDENCE_TEXT_MAX_LENGTH,
  RunEvidenceCommittedRecord,
  RunEvidenceEvent,
  RunEvidenceExpectedAnchor,
  RunEvidenceHead,
  RunEvidenceIssueKind,
  RunEvidenceLedgerError,
  RunEvidenceReceipt,
  RunEvidenceSeal,
  RunEvidenceSealSnapshot,
  RunEvidenceSnapshot,
  RunEvidenceVerificationIssue,
  RunEvidenceVerificationReport,
  runEvidenceEventIdempotencyFingerprint,
  runEvidenceSealIdempotencyFingerprint,
  sha256RunEvidence,
} from './run-evidence-protocol';
import { redactDevSeekAuthorityCapabilities } from './persisted-secret';
import {
  assertRunEvidenceEventEnvelope,
  assertRunEvidenceReceiptEnvelope,
  assertRunEvidenceRecordEnvelope,
  assertRunEvidenceSealEnvelope,
} from './run-evidence-envelope';

export interface RunEvidenceEventRecord {
  protocol: typeof RUN_EVIDENCE_RECORD_PROTOCOL;
  record_kind: 'event';
  slot_sequence: number;
  previous_record_sha256: string | null;
  event: RunEvidenceEvent;
  receipt: RunEvidenceReceipt;
  record_sha256: string;
}

export interface RunEvidenceSealRecord {
  protocol: typeof RUN_EVIDENCE_RECORD_PROTOCOL;
  record_kind: 'seal';
  slot_sequence: number;
  previous_record_sha256: string;
  seal: RunEvidenceSeal;
  record_sha256: string;
}

export type RunEvidenceRecord = RunEvidenceEventRecord | RunEvidenceSealRecord;

const SHA256_RE = /^[a-f0-9]{64}$/;
const EVENT_TYPE_SET = new Set<string>(RUN_EVIDENCE_EVENT_TYPES);
const VERIFICATION_LIMITATIONS = Object.freeze([
  'Local hashes and filesystem CAS do not provide trusted time, external WORM retention, signer independence, or physical non-repudiation.',
  'Any complete local tail deletion, including deletion of the seal itself, requires an independently retained expected seal anchor to detect.',
  'This product-run ledger is diagnostic input only and cannot by itself produce a qualification claim.',
]);

export interface RunInspection {
  runId: string;
  found: boolean;
  events: RunEvidenceEvent[];
  eventRecords: RunEvidenceEventRecord[];
  seal: RunEvidenceSeal | null;
  sealRecord: RunEvidenceSealRecord | null;
  head: RunEvidenceHead | null;
  issues: RunEvidenceVerificationIssue[];
}

export function emptyInspection(runId: string, found: boolean): RunInspection {
  return {
    runId,
    found,
    events: [],
    eventRecords: [],
    seal: null,
    sealRecord: null,
    head: null,
    issues: [],
  };
}

export function validateRecordEnvelope(
  record: RunEvidenceRecord,
  slot: number,
  path: string,
): RunEvidenceVerificationIssue | null {
  try {
    assertRunEvidenceRecordEnvelope(record);
  } catch (error) {
    return issue('protocol', 'RECORD_SCHEMA_INVALID', path, errorMessage(error));
  }
  if (!record || typeof record !== 'object') {
    return issue('torn', 'INVALID_RECORD_OBJECT', path, 'Record is not an object');
  }
  if (record.protocol !== RUN_EVIDENCE_RECORD_PROTOCOL) {
    return issue('protocol', 'RECORD_PROTOCOL_MISMATCH', path, 'Record protocol is not supported');
  }
  if (record.record_kind !== 'event' && record.record_kind !== 'seal') {
    return issue('protocol', 'RECORD_KIND_MISMATCH', path, 'Record kind is not supported');
  }
  if (record.slot_sequence !== slot) {
    return issue('gap', 'RECORD_SLOT_MISMATCH', path, `Record declares slot ${record.slot_sequence}, filename declares ${slot}`);
  }
  if (!SHA256_RE.test(String(record.record_sha256 || ''))) {
    return issue('tamper', 'RECORD_HASH_INVALID', path, 'Record hash is not a lowercase SHA-256 value');
  }
  const base = { ...record } as Record<string, unknown>;
  delete base.record_sha256;
  try {
    if (sha256RunEvidence(base) !== record.record_sha256) {
      return issue('tamper', 'RECORD_HASH_MISMATCH', path, 'Record content does not match record_sha256');
    }
  } catch (error) {
    return issue('protocol', 'RECORD_CANONICALIZATION_FAILED', path, errorMessage(error));
  }
  return null;
}

export function validateEventRecord(
  record: RunEvidenceEventRecord,
  runId: string,
  expectedSequence: number,
  expectedPrevious: string | null,
  expectedPreviousRecord: string | null,
  path: string,
): RunEvidenceVerificationIssue[] {
  const issues: RunEvidenceVerificationIssue[] = [];
  const event = record.event;
  const receipt = record.receipt;
  if (!event || typeof event !== 'object') {
    return [issue('torn', 'EVENT_MISSING', path, 'Event record has no event object')];
  }
  try {
    assertRunEvidenceEventEnvelope(event);
  } catch (error) {
    issues.push(issue('protocol', 'EVENT_SCHEMA_INVALID', path, errorMessage(error)));
  }
  if (event.protocol !== RUN_EVIDENCE_EVENT_PROTOCOL) {
    issues.push(issue('protocol', 'EVENT_PROTOCOL_MISMATCH', path, 'Event protocol is not supported'));
  }
  validateDiagnosticBoundary(event, path, 'EVENT', issues);
  if (event.run_id !== runId) issues.push(issue('fork', 'EVENT_RUN_MISMATCH', path, 'Event belongs to another run'));
  if (event.sequence !== expectedSequence || event.sequence !== record.slot_sequence) {
    issues.push(issue('gap', 'EVENT_SEQUENCE_MISMATCH', path, `Expected event sequence ${expectedSequence}`));
  }
  if (event.previous_event_sha256 !== expectedPrevious) {
    issues.push(issue('fork', 'EVENT_PREVIOUS_HASH_MISMATCH', path, 'Event does not extend the current event head'));
  }
  if (record.previous_record_sha256 !== expectedPreviousRecord) {
    issues.push(issue('fork', 'RECORD_PREVIOUS_HASH_MISMATCH', path, 'Record does not extend the receipt-aware record head'));
  }
  if (!EVENT_TYPE_SET.has(String(event.type))) {
    issues.push(issue('protocol', 'EVENT_TYPE_UNKNOWN', path, 'Event type is unknown'));
  }
  if (expectedSequence > 1 && event.type === 'run.opened') {
    issues.push(issue('protocol', 'DUPLICATE_RUN_OPENED', path, 'run.opened is only valid at sequence 1'));
  }
  if (!isBoundedText(event.run_id) || !isBoundedText(event.surface) || !isBoundedText(event.idempotency_key)) {
    issues.push(issue('protocol', 'EVENT_IDENTITY_INVALID', path, 'Event run, surface, and idempotency key must be bounded non-empty text'));
  }
  try {
    assertRunEvidencePayloadQualificationBoundary(event.type, event.payload);
  } catch (error) {
    issues.push(issue('protocol', 'EVENT_QUALIFICATION_BOUNDARY_VIOLATION', path, errorMessage(error)));
  }
  try {
    assertRunEvidenceEventObservationContract(event.type, event.payload, event.sequence);
  } catch (error) {
    issues.push(issue('protocol', 'EVENT_OBSERVATION_CONTRACT_VIOLATION', path, errorMessage(error)));
  }
  if (!isCanonicalTimestamp(event.occurred_at)) {
    issues.push(issue('protocol', 'EVENT_TIME_INVALID', path, 'Event occurred_at must be canonical UTC with milliseconds'));
  }
  try {
    const eventBase = { ...event } as Record<string, unknown>;
    delete eventBase.event_sha256;
    if (sha256RunEvidence(eventBase) !== event.event_sha256) {
      issues.push(issue('tamper', 'EVENT_HASH_MISMATCH', path, 'Event content does not match event_sha256'));
    }
    const expectedFingerprint = runEvidenceEventIdempotencyFingerprint(
      event.run_id,
      event.type,
      event.surface,
      event.idempotency_key,
      event.payload,
    );
    if (event.idempotency_fingerprint_sha256 !== expectedFingerprint) {
      issues.push(issue('tamper', 'EVENT_FINGERPRINT_MISMATCH', path, 'Event idempotency fingerprint is invalid'));
    }
  } catch (error) {
    issues.push(issue('protocol', 'EVENT_CANONICALIZATION_FAILED', path, errorMessage(error)));
  }

  if (!receipt || typeof receipt !== 'object') {
    issues.push(issue('torn', 'RECEIPT_MISSING', path, 'Committed event has no durable receipt'));
    return issues;
  }
  try {
    assertRunEvidenceReceiptEnvelope(receipt);
  } catch (error) {
    issues.push(issue('protocol', 'RECEIPT_SCHEMA_INVALID', path, errorMessage(error)));
  }
  if (receipt.protocol !== RUN_EVIDENCE_RECEIPT_PROTOCOL) {
    issues.push(issue('protocol', 'RECEIPT_PROTOCOL_MISMATCH', path, 'Receipt protocol is not supported'));
  }
  validateDiagnosticBoundary(receipt, path, 'RECEIPT', issues);
  if (
    receipt.run_id !== runId
    || receipt.sequence !== event.sequence
    || receipt.event_sha256 !== event.event_sha256
    || receipt.previous_event_sha256 !== event.previous_event_sha256
    || receipt.idempotency_key !== event.idempotency_key
  ) {
    issues.push(issue('fork', 'RECEIPT_EVENT_MISMATCH', path, 'Receipt does not bind the committed event exactly'));
  }
  if (!isBoundedText(receipt.run_id) || !isBoundedText(receipt.idempotency_key)) {
    issues.push(issue('protocol', 'RECEIPT_IDENTITY_INVALID', path, 'Receipt run and idempotency key must be bounded non-empty text'));
  }
  if (!isCanonicalTimestamp(receipt.committed_at)) {
    issues.push(issue('protocol', 'RECEIPT_TIME_INVALID', path, 'Receipt committed_at must be canonical UTC with milliseconds'));
  }
  try {
    const receiptBase = { ...receipt } as Record<string, unknown>;
    delete receiptBase.receipt_sha256;
    if (sha256RunEvidence(receiptBase) !== receipt.receipt_sha256) {
      issues.push(issue('tamper', 'RECEIPT_HASH_MISMATCH', path, 'Receipt content does not match receipt_sha256'));
    }
  } catch (error) {
    issues.push(issue('protocol', 'RECEIPT_CANONICALIZATION_FAILED', path, errorMessage(error)));
  }
  return issues;
}

export function validateSealRecord(
  record: RunEvidenceSealRecord,
  runId: string,
  eventCount: number,
  finalEventSha256: string | null,
  finalRecordSha256: string | null,
  path: string,
): RunEvidenceVerificationIssue[] {
  const issues: RunEvidenceVerificationIssue[] = [];
  const seal = record.seal;
  if (!seal || typeof seal !== 'object') {
    return [issue('torn', 'SEAL_MISSING', path, 'Seal record has no seal object')];
  }
  try {
    assertRunEvidenceSealEnvelope(seal);
  } catch (error) {
    issues.push(issue('protocol', 'SEAL_SCHEMA_INVALID', path, errorMessage(error)));
  }
  if (seal.protocol !== RUN_EVIDENCE_SEAL_PROTOCOL) {
    issues.push(issue('protocol', 'SEAL_PROTOCOL_MISMATCH', path, 'Seal protocol is not supported'));
  }
  validateDiagnosticBoundary(seal, path, 'SEAL', issues);
  if (seal.run_id !== runId) issues.push(issue('fork', 'SEAL_RUN_MISMATCH', path, 'Seal belongs to another run'));
  if (
    seal.slot_sequence !== record.slot_sequence
    || seal.event_count !== eventCount
    || seal.slot_sequence !== eventCount + 1
  ) {
    issues.push(issue('truncate', 'SEAL_COUNT_MISMATCH', path, 'Seal event count does not match the immutable record prefix'));
  }
  if (seal.final_event_sha256 !== finalEventSha256 || seal.final_record_sha256 !== finalRecordSha256) {
    issues.push(issue('truncate', 'SEAL_HEAD_MISMATCH', path, 'Seal final head does not match the immutable event prefix'));
  }
  if (record.previous_record_sha256 !== finalRecordSha256) {
    issues.push(issue('fork', 'SEAL_PREVIOUS_RECORD_MISMATCH', path, 'Seal record does not extend the final event record'));
  }
  if (
    !isCanonicalTimestamp(seal.sealed_at)
    || !isBoundedText(seal.run_id)
    || !isBoundedText(seal.idempotency_key)
    || !isBoundedText(seal.reason)
  ) {
    issues.push(issue('protocol', 'SEAL_FIELDS_INVALID', path, 'Seal time, run, idempotency key, and reason must satisfy the bounded contract'));
  }
  try {
    const sealBase = { ...seal } as Record<string, unknown>;
    delete sealBase.seal_sha256;
    if (sha256RunEvidence(sealBase) !== seal.seal_sha256) {
      issues.push(issue('tamper', 'SEAL_HASH_MISMATCH', path, 'Seal content does not match seal_sha256'));
    }
    if (finalEventSha256) {
      const expectedFingerprint = runEvidenceSealIdempotencyFingerprint(
        runId,
        {
          sequence: eventCount,
          eventSha256: finalEventSha256,
          recordSha256: finalRecordSha256 as string,
        },
        seal.idempotency_key,
        seal.reason,
      );
      if (seal.idempotency_fingerprint_sha256 !== expectedFingerprint) {
        issues.push(issue('tamper', 'SEAL_FINGERPRINT_MISMATCH', path, 'Seal idempotency fingerprint is invalid'));
      }
    }
  } catch (error) {
    issues.push(issue('protocol', 'SEAL_CANONICALIZATION_FAILED', path, errorMessage(error)));
  }
  return issues;
}

function validateDiagnosticBoundary(
  value: { integrity_scope?: unknown; qualification_eligible?: unknown },
  path: string,
  prefix: string,
  issues: RunEvidenceVerificationIssue[],
): void {
  if (value.integrity_scope !== RUN_EVIDENCE_INTEGRITY_SCOPE) {
    issues.push(issue('protocol', `${prefix}_INTEGRITY_SCOPE_INVALID`, path, 'Product evidence has the wrong integrity scope'));
  }
  if (value.qualification_eligible !== RUN_EVIDENCE_QUALIFICATION_ELIGIBLE) {
    issues.push(issue('protocol', `${prefix}_QUALIFICATION_BOUNDARY_VIOLATION`, path, 'Product evidence cannot be qualification eligible'));
  }
}

export function snapshotFromInspection(inspection: RunInspection): RunEvidenceSnapshot {
  if (!inspection.head) {
    throw new RunEvidenceLedgerError('RUN_NOT_OPEN', `Run ${inspection.runId} has no run.opened event`);
  }
  const records: RunEvidenceCommittedRecord[] = inspection.eventRecords.map(record => ({
    slotSequence: record.slot_sequence,
    previousRecordSha256: record.previous_record_sha256,
    event: record.event,
    receipt: record.receipt,
    recordSha256: record.record_sha256,
  }));
  const seal: RunEvidenceSealSnapshot | null = inspection.sealRecord
    ? {
        slotSequence: inspection.sealRecord.slot_sequence,
        previousRecordSha256: inspection.sealRecord.previous_record_sha256,
        seal: inspection.sealRecord.seal,
        recordSha256: inspection.sealRecord.record_sha256,
      }
    : null;
  return cloneJson({
    runId: inspection.runId,
    integrityScope: RUN_EVIDENCE_INTEGRITY_SCOPE,
    qualificationEligible: RUN_EVIDENCE_QUALIFICATION_ELIGIBLE,
    records,
    seal,
    head: inspection.head,
  }) as unknown as RunEvidenceSnapshot;
}

export function applyExpectedAnchor(inspection: RunInspection, expected: RunEvidenceExpectedAnchor): void {
  if (!inspection.found) {
    inspection.issues.push({
      kind: 'truncate',
      code: 'EXPECTED_RUN_MISSING',
      message: 'The independently anchored run directory is missing',
    });
    return;
  }
  if (!inspection.seal || !inspection.head) {
    inspection.issues.push({
      kind: 'truncate',
      code: 'EXPECTED_SEAL_MISSING',
      message: 'The independently anchored seal is missing from the local ledger',
    });
    return;
  }
  if (
    inspection.seal.event_count !== expected.eventCount
    || inspection.seal.final_event_sha256 !== expected.finalEventSha256
    || inspection.seal.final_record_sha256 !== expected.finalRecordSha256
    || inspection.seal.seal_sha256 !== expected.sealSha256
  ) {
    inspection.issues.push({
      kind: 'truncate',
      code: 'EXPECTED_SEAL_ANCHOR_MISMATCH',
      message: 'The local seal does not match the independently retained anchor',
    });
  }
}

export function toVerificationReport(
  inspection: RunInspection,
  expectedAnchorChecked = false,
): RunEvidenceVerificationReport {
  const valid = inspection.found && inspection.issues.length === 0;
  return {
    runId: inspection.runId,
    valid,
    found: inspection.found,
    status: !inspection.found
      ? 'not-found'
      : !valid
        ? 'invalid'
        : inspection.seal
          ? 'valid-sealed'
          : 'valid-open',
    integrityScope: RUN_EVIDENCE_INTEGRITY_SCOPE,
    qualificationEligible: RUN_EVIDENCE_QUALIFICATION_ELIGIBLE,
    eventCount: inspection.events.length,
    head: inspection.head ? cloneJson(inspection.head) as unknown as RunEvidenceHead : null,
    expectedAnchorChecked,
    issues: inspection.issues.map(item => ({
      ...item,
      ...(item.path === undefined
        ? {}
        : { path: redactDevSeekAuthorityCapabilities(item.path) }),
      message: redactDevSeekAuthorityCapabilities(item.message),
    })),
    limitations: VERIFICATION_LIMITATIONS,
  };
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-5][0-9]\.[0-9]{3}Z$/.test(value)
  ) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isBoundedText(value: unknown): value is string {
  return isNonEmpty(value)
    && value === value.trim()
    && Array.from(value).length <= RUN_EVIDENCE_TEXT_MAX_LENGTH
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function errorMessage(error: unknown): string {
  try {
    return redactDevSeekAuthorityCapabilities(error instanceof Error ? error.message : String(error));
  } catch {
    return 'Run evidence validation failed';
  }
}

function issue(
  kind: RunEvidenceIssueKind,
  code: string,
  path: string,
  message: string,
): RunEvidenceVerificationIssue {
  return { kind, code, path, message: redactDevSeekAuthorityCapabilities(message) };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalRunEvidenceJson(value)) as T;
}
