import * as crypto from 'crypto';

import {
  containsDevSeekAuthorityCapability,
  containsPersistedDevSeekAuthorityCapability,
  DEVSEEK_AUTHORITY_CAPABILITY_BYTES,
  DEVSEEK_AUTHORITY_CAPABILITY_PREFIX,
} from './persisted-secret';

export const RUN_EVIDENCE_INTEGRITY_SCOPE = 'product-run-diagnostics' as const;
export const RUN_EVIDENCE_QUALIFICATION_ELIGIBLE = false as const;
export const RUN_EVIDENCE_EVENT_PROTOCOL = 'devseek.run-evidence-event/v1' as const;
export const RUN_EVIDENCE_RECEIPT_PROTOCOL = 'devseek.run-evidence-receipt/v1' as const;
export const RUN_EVIDENCE_RECORD_PROTOCOL = 'devseek.run-evidence-record/v1' as const;
export const RUN_EVIDENCE_SEAL_PROTOCOL = 'devseek.run-evidence-seal/v1' as const;
export const RUN_EVIDENCE_REPLAY_PROTOCOL = 'devseek.run-evidence-replay/v1' as const;
export const RUN_EVIDENCE_TEXT_MAX_LENGTH = 512 as const;
export const RUN_EVIDENCE_RUNTIME_TRUST = 'product-runtime-observation' as const;
export const RUN_EVIDENCE_LEGACY_TRUST = 'legacy-unverified' as const;
export const RUN_EVIDENCE_AUTHORITY_PROTOCOL = 'devseek.product-run-evidence-authority/v1' as const;
export const RUN_EVIDENCE_AUTHORITY_PAYLOAD_KEY = '_devseek_run_evidence_authority' as const;
export const RUN_EVIDENCE_AUTHORITY_TOKEN_PREFIX = DEVSEEK_AUTHORITY_CAPABILITY_PREFIX;
export const RUN_EVIDENCE_AUTHORITY_TOKEN_BYTES = DEVSEEK_AUTHORITY_CAPABILITY_BYTES;

/**
 * Product-run facts intentionally cover every execution boundary used by the
 * CLI, VS Code extension, bridge, and future adapters. Adding a new event kind
 * is a protocol change: unknown kinds fail verification.
 */
export const RUN_EVIDENCE_EVENT_TYPES = [
  'run.opened',
  'run.recovered',
  'run.settled',
  'run.metrics',
  'command.accepted',
  'agent.status',
  'tool.activity',
  'provider.requested',
  'provider.completed',
  'provider.failed',
  'side_effect.requested',
  'side_effect.authorized',
  'side_effect.started',
  'side_effect.committed',
  'side_effect.failed',
  'side_effect.indeterminate',
  'verification.started',
  'verification.completed',
  'verification.failed',
  'quality_gate.started',
  'quality_gate.passed',
  'quality_gate.failed',
  'quality_gate.vetoed',
  'checkpoint.created',
  'checkpoint.restored',
  'recovery.detected',
  'recovery.completed',
  'recovery.failed',
  'evidence.degraded',
  'legacy.imported',
] as const;

export type RunEvidenceEventType = typeof RUN_EVIDENCE_EVENT_TYPES[number];
export type RunEvidenceSettlementStatus = 'completed' | 'failed' | 'blocked' | 'cancelled';
export const RUN_METRICS_SCHEMA = 'devseek.run-metrics/v1' as const;
export const RUN_METRICS_UNKNOWN = 'unknown' as const;
export type RunEvidenceJson =
  | null
  | boolean
  | number
  | string
  | RunEvidenceJson[]
  | { [key: string]: RunEvidenceJson };

export interface RunEvidenceHeadReference {
  sequence: number;
  eventSha256: string;
  recordSha256: string;
}

/** Bearer capability supplied only to a mutation call; it is never serialized. */
export type RunEvidenceMutationCredential =
  | { role: 'owner'; token: string; participantToken?: string }
  | { role: 'participant'; token: string };

export interface RunEvidenceAuthorityMetadata {
  protocol: typeof RUN_EVIDENCE_AUTHORITY_PROTOCOL;
  owner_token_sha256: string;
  participant_token_sha256: string;
}

export interface RunEvidenceEvent {
  protocol: typeof RUN_EVIDENCE_EVENT_PROTOCOL;
  integrity_scope: typeof RUN_EVIDENCE_INTEGRITY_SCOPE;
  qualification_eligible: typeof RUN_EVIDENCE_QUALIFICATION_ELIGIBLE;
  run_id: string;
  sequence: number;
  previous_event_sha256: string | null;
  type: RunEvidenceEventType;
  surface: string;
  idempotency_key: string;
  idempotency_fingerprint_sha256: string;
  occurred_at: string;
  payload: RunEvidenceJson;
  event_sha256: string;
}

export interface RunEvidenceReceipt {
  protocol: typeof RUN_EVIDENCE_RECEIPT_PROTOCOL;
  integrity_scope: typeof RUN_EVIDENCE_INTEGRITY_SCOPE;
  qualification_eligible: typeof RUN_EVIDENCE_QUALIFICATION_ELIGIBLE;
  run_id: string;
  sequence: number;
  event_sha256: string;
  previous_event_sha256: string | null;
  idempotency_key: string;
  committed_at: string;
  receipt_sha256: string;
}

export interface RunEvidenceSeal {
  protocol: typeof RUN_EVIDENCE_SEAL_PROTOCOL;
  integrity_scope: typeof RUN_EVIDENCE_INTEGRITY_SCOPE;
  qualification_eligible: typeof RUN_EVIDENCE_QUALIFICATION_ELIGIBLE;
  run_id: string;
  slot_sequence: number;
  event_count: number;
  final_event_sha256: string;
  final_record_sha256: string;
  idempotency_key: string;
  idempotency_fingerprint_sha256: string;
  reason: string;
  sealed_at: string;
  seal_sha256: string;
}

export interface RunEvidenceHead {
  runId: string;
  sequence: number;
  eventSha256: string;
  recordSha256: string;
  sealed: boolean;
  sealSha256?: string;
}

export interface OpenRunEvidenceRequest {
  runId: string;
  surface: string;
  idempotencyKey: string;
  occurredAt?: string | Date;
  payload?: RunEvidenceJson;
  credential: RunEvidenceMutationCredential;
}

export interface AppendRunEvidenceRequest {
  runId: string;
  expectedHead: RunEvidenceHeadReference;
  type: Exclude<RunEvidenceEventType, 'run.opened'>;
  surface: string;
  idempotencyKey: string;
  occurredAt?: string | Date;
  payload?: RunEvidenceJson;
  credential: RunEvidenceMutationCredential;
}

export interface SealRunEvidenceRequest {
  runId: string;
  expectedHead: RunEvidenceHeadReference;
  idempotencyKey: string;
  sealedAt?: string | Date;
  reason?: string;
  credential: RunEvidenceMutationCredential;
}

export interface RunEvidenceAppendResult {
  event: RunEvidenceEvent;
  receipt: RunEvidenceReceipt;
  /** Head produced by this event, even when an old idempotency key is retried later. */
  committedHead: RunEvidenceHead;
  /** Current ledger head observed after resolving the append or retry. */
  currentHead: RunEvidenceHead;
  idempotent: boolean;
}

export interface RunEvidenceSealResult {
  seal: RunEvidenceSeal;
  head: RunEvidenceHead;
  idempotent: boolean;
}

export type RunEvidenceIssueKind =
  | 'orphan'
  | 'fork'
  | 'torn'
  | 'tamper'
  | 'gap'
  | 'truncate'
  | 'protocol';

export interface RunEvidenceVerificationIssue {
  kind: RunEvidenceIssueKind;
  code: string;
  path?: string;
  message: string;
}

export interface RunEvidenceVerificationReport {
  runId: string;
  valid: boolean;
  found: boolean;
  status: 'not-found' | 'valid-open' | 'valid-sealed' | 'invalid';
  integrityScope: typeof RUN_EVIDENCE_INTEGRITY_SCOPE;
  qualificationEligible: typeof RUN_EVIDENCE_QUALIFICATION_ELIGIBLE;
  eventCount: number;
  head: RunEvidenceHead | null;
  expectedAnchorChecked: boolean;
  issues: RunEvidenceVerificationIssue[];
  limitations: readonly string[];
}

export interface RunEvidenceRecoveryReport extends RunEvidenceVerificationReport {
  recoveryAction: 'none' | 'manual-intervention-required';
  mutated: false;
}

export interface RunEvidenceLedgerLocation {
  runDirectory: string;
  recordsDirectory: string;
  stagingDirectory: string;
}

export interface RunEvidenceLedgerOptions {
  rootDir: string;
  now?: () => Date;
}

export interface RunEvidenceExpectedAnchor {
  eventCount: number;
  finalEventSha256: string;
  finalRecordSha256: string;
  sealSha256: string;
}

export interface RunEvidenceCommittedRecord {
  slotSequence: number;
  previousRecordSha256: string | null;
  event: RunEvidenceEvent;
  receipt: RunEvidenceReceipt;
  recordSha256: string;
}

export interface RunEvidenceSealSnapshot {
  slotSequence: number;
  previousRecordSha256: string;
  seal: RunEvidenceSeal;
  recordSha256: string;
}

export interface RunEvidenceSnapshot {
  runId: string;
  integrityScope: typeof RUN_EVIDENCE_INTEGRITY_SCOPE;
  qualificationEligible: typeof RUN_EVIDENCE_QUALIFICATION_ELIGIBLE;
  records: RunEvidenceCommittedRecord[];
  seal: RunEvidenceSealSnapshot | null;
  head: RunEvidenceHead;
}

export interface RunEvidenceLedgerPort {
  openRun(request: OpenRunEvidenceRequest): RunEvidenceAppendResult;
  append(request: AppendRunEvidenceRequest): RunEvidenceAppendResult;
  head(runId: string): RunEvidenceHead;
  read(runId: string): RunEvidenceEvent[];
  readSnapshot(runId: string): RunEvidenceSnapshot;
  getSeal(runId: string): RunEvidenceSeal | null;
  seal(request: SealRunEvidenceRequest): RunEvidenceSealResult;
  recover(runId: string, expectedAnchor?: RunEvidenceExpectedAnchor): RunEvidenceRecoveryReport;
  verify(runId: string, expectedAnchor?: RunEvidenceExpectedAnchor): RunEvidenceVerificationReport;
}

export type RunEvidenceLedgerErrorCode =
  | 'AUTHORITY_DENIED'
  | 'RUN_NOT_FOUND'
  | 'RUN_ALREADY_OPEN'
  | 'RUN_NOT_OPEN'
  | 'RUN_SEALED'
  | 'EXPECTED_HEAD_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'APPEND_CONFLICT'
  | 'SEAL_CONFLICT'
  | 'RUN_SEMANTIC_INVALID'
  | 'LEDGER_CORRUPT'
  | 'INVALID_INPUT';

export class RunEvidenceLedgerError extends Error {
  readonly code: RunEvidenceLedgerErrorCode;
  readonly details?: RunEvidenceJson;

  constructor(code: RunEvidenceLedgerErrorCode, message: string, details?: RunEvidenceJson) {
    super(message);
    this.name = 'RunEvidenceLedgerError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Product-run evidence is diagnostic-only. Payloads may repeat that boundary
 * as `qualification_eligible=false`, but may never carry a verdict, claim, or
 * level which a downstream reader could mistake for qualification evidence.
 * Legacy projections are preserved verbatim only below the explicitly
 * untrusted `legacy.imported.payload.projection` envelope.
 */
export function assertRunEvidencePayloadQualificationBoundary(
  type: RunEvidenceEventType,
  payload: RunEvidenceJson,
): void {
  visitQualificationBoundary(
    payload,
    '$.payload',
    type === 'legacy.imported' ? '$.payload.projection' : undefined,
  );
}

/** Scans a complete persisted envelope; only the named legacy projection is opaque. */
export function assertRunEvidenceEnvelopeQualificationBoundary(
  value: RunEvidenceJson,
  legacyProjectionPath?: string,
): void {
  visitQualificationBoundary(value, '$', legacyProjectionPath);
}

/**
 * A bearer capability is mutation-only state. This guard is shared by every
 * durable write boundary and replay so neither normal writes nor fully
 * re-hashed artifacts can serialize one. The error deliberately omits the
 * offending value and path because errors may themselves be traced.
 */
export function assertRunEvidencePersistedSecretBoundary(value: unknown): void {
  if (containsPersistedDevSeekAuthorityCapability(value)) {
    throw new RunEvidenceLedgerError(
      'INVALID_INPUT',
      'Persisted run evidence cannot contain a DevSeek authority capability',
    );
  }
}

export function normalizeRunEvidenceMutationCredential(
  value: unknown,
  requireParticipantToken = false,
): RunEvidenceMutationCredential {
  const candidate = snapshotRunEvidenceInputObject(
    value,
    'A mutation credential is required',
    'AUTHORITY_DENIED',
  );
  if (candidate.role !== 'owner' && candidate.role !== 'participant') {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Mutation credential role is invalid');
  }
  const expectedKeys = candidate.role === 'participant'
    ? ['role', 'token']
    : candidate.participantToken === undefined
      ? ['role', 'token']
      : ['participantToken', 'role', 'token'];
  if (!hasExactKeys(candidate, expectedKeys)) {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Mutation credential shape is invalid');
  }
  const token = requireRunEvidenceAuthorityToken(candidate.token);
  if (candidate.role === 'participant') {
    if (requireParticipantToken) {
      throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Only an owner may create a run');
    }
    return { role: 'participant', token };
  }
  const participantToken = candidate.participantToken === undefined
    ? undefined
    : requireRunEvidenceAuthorityToken(candidate.participantToken);
  if (requireParticipantToken && participantToken === undefined) {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Creating a run requires a participant token');
  }
  if (participantToken && safeDigestEqual(
    runEvidenceAuthorityTokenSha256(token),
    runEvidenceAuthorityTokenSha256(participantToken),
  )) {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Owner and participant tokens must be distinct');
  }
  return participantToken === undefined
    ? { role: 'owner', token }
    : { role: 'owner', token, participantToken };
}

export function requireRunEvidenceAuthorityToken(value: unknown): string {
  if (typeof value !== 'string') {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Authority token is malformed');
  }
  const token = value;
  const encodedLength = Math.ceil(RUN_EVIDENCE_AUTHORITY_TOKEN_BYTES * 4 / 3);
  if (
    token.length !== RUN_EVIDENCE_AUTHORITY_TOKEN_PREFIX.length + encodedLength
    || !token.startsWith(RUN_EVIDENCE_AUTHORITY_TOKEN_PREFIX)
    || !/^[A-Za-z0-9_-]+$/.test(token.slice(RUN_EVIDENCE_AUTHORITY_TOKEN_PREFIX.length))
  ) {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Authority token is malformed');
  }
  return token;
}

export function runEvidenceAuthorityTokenSha256(token: string): string {
  return crypto.createHash('sha256').update(requireRunEvidenceAuthorityToken(token), 'utf8').digest('hex');
}

export function runEvidenceAuthorityMetadata(
  ownerToken: string,
  participantToken: string,
): RunEvidenceAuthorityMetadata {
  const ownerDigest = runEvidenceAuthorityTokenSha256(ownerToken);
  const participantDigest = runEvidenceAuthorityTokenSha256(participantToken);
  if (safeDigestEqual(ownerDigest, participantDigest)) {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Owner and participant tokens must be distinct');
  }
  return {
    protocol: RUN_EVIDENCE_AUTHORITY_PROTOCOL,
    owner_token_sha256: ownerDigest,
    participant_token_sha256: participantDigest,
  };
}

export function assertRunEvidenceMutationAuthorized(
  events: readonly RunEvidenceEvent[],
  credentialValue: unknown,
  ownerOnly = false,
): RunEvidenceMutationCredential {
  const credential = normalizeRunEvidenceMutationCredential(credentialValue);
  if (ownerOnly && credential.role !== 'owner') {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Only the run owner may perform this mutation');
  }
  const metadata = readRunEvidenceAuthorityMetadata(events);
  const expected = credential.role === 'owner'
    ? metadata.owner_token_sha256
    : metadata.participant_token_sha256;
  if (!safeDigestEqual(runEvidenceAuthorityTokenSha256(credential.token), expected)) {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Run authority token was rejected');
  }
  if (credential.role === 'owner' && credential.participantToken !== undefined) {
    if (!safeDigestEqual(
      runEvidenceAuthorityTokenSha256(credential.participantToken),
      metadata.participant_token_sha256,
    )) {
      throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Participant token does not match the run');
    }
  }
  return credential;
}

export function readRunEvidenceAuthorityMetadata(
  events: readonly RunEvidenceEvent[],
): RunEvidenceAuthorityMetadata {
  const opened = events[0];
  const payload = opened?.payload;
  if (!opened || opened.type !== 'run.opened' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Run authority metadata is unavailable');
  }
  const value = payload[RUN_EVIDENCE_AUTHORITY_PAYLOAD_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Run authority metadata is unavailable');
  }
  const metadata = value as unknown as RunEvidenceAuthorityMetadata;
  if (
    metadata.protocol !== RUN_EVIDENCE_AUTHORITY_PROTOCOL
    || !isSha256(metadata.owner_token_sha256)
    || !isSha256(metadata.participant_token_sha256)
    || safeDigestEqual(metadata.owner_token_sha256, metadata.participant_token_sha256)
    || !hasExactKeys(metadata as unknown as Record<string, unknown>, [
      'protocol',
      'owner_token_sha256',
      'participant_token_sha256',
    ])
  ) {
    throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Run authority metadata is invalid');
  }
  return metadata;
}

/**
 * One bounded-text authority for every persisted protocol identity/reason.
 * The raw input is bounded before trimming so runtime acceptance cannot emit a
 * value which the machine schema rejects solely because of hidden whitespace.
 */
export function requireRunEvidenceBoundedText(
  value: unknown,
  name: string,
  errorCode: RunEvidenceLedgerErrorCode = 'INVALID_INPUT',
): string {
  if (typeof value !== 'string') {
    throw new RunEvidenceLedgerError(errorCode, `${name} must be text`);
  }
  const raw = value;
  if (containsDevSeekAuthorityCapability(raw)) {
    throw new RunEvidenceLedgerError(errorCode, `${name} contains forbidden secret material`);
  }
  if (Array.from(raw).length > RUN_EVIDENCE_TEXT_MAX_LENGTH) {
    throw new RunEvidenceLedgerError(errorCode, `${name} exceeds ${RUN_EVIDENCE_TEXT_MAX_LENGTH} characters`);
  }
  if (!raw) throw new RunEvidenceLedgerError(errorCode, `${name} is required`);
  if (raw !== raw.trim()) {
    throw new RunEvidenceLedgerError(errorCode, `${name} cannot have leading or trailing whitespace`);
  }
  if (hasForbiddenRunEvidenceControl(raw)) {
    throw new RunEvidenceLedgerError(errorCode, `${name} cannot contain control characters`);
  }
  return raw;
}

/** Strict persisted payload strings never normalize away observable bytes. */
export function assertRunEvidencePayloadTextBoundary(value: RunEvidenceJson): void {
  visitPayloadTextBoundary(value, '$.payload');
}

/**
 * Converts arbitrary input to one detached, strict-JSON snapshot. Getters and
 * Proxy data are observed at most once; cycles and non-JSON values fail with a
 * controlled ledger error rather than being coerced or recursed indefinitely.
 */
export function normalizeRunEvidenceJson(value: unknown): RunEvidenceJson {
  try {
    return snapshotRunEvidenceJson(value, new WeakSet<object>());
  } catch (error) {
    if (error instanceof RunEvidenceLedgerError) throw error;
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence value must be strict JSON data');
  }
}

/** Shallow single-read snapshot for public request and credential envelopes. */
export function snapshotRunEvidenceInputObject(
  value: unknown,
  message = 'Run evidence input must be an object',
  errorCode: RunEvidenceLedgerErrorCode = 'INVALID_INPUT',
): Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new RunEvidenceLedgerError(errorCode, message);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RunEvidenceLedgerError(errorCode, message);
    }
    const output: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new RunEvidenceLedgerError(errorCode, message);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable) throw new RunEvidenceLedgerError(errorCode, message);
      const nested = Reflect.get(value, key);
      Object.defineProperty(output, key, {
        value: nested,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  } catch (error) {
    if (error instanceof RunEvidenceLedgerError) throw error;
    throw new RunEvidenceLedgerError(errorCode, message);
  }
}

/**
 * Machine-observation semantics shared by append-time guards and replay.
 * Lifecycle transitions are validated separately; this function freezes the
 * payload shape which every individual event must satisfy.
 */
export function assertRunEvidenceEventObservationContract(
  type: RunEvidenceEventType,
  payloadValue: RunEvidenceJson,
  sequence = 0,
): void {
  assertRunEvidencePayloadTextBoundary(payloadValue);
  assertRunEvidencePayloadQualificationBoundary(type, payloadValue);
  const at = `${type} at sequence ${sequence}`;
  const payload = requireObservationPayload(payloadValue, at);
  if (type === 'evidence.degraded') {
    if (payload.status !== 'degraded') observationFailure(`${at} must declare status=degraded`);
    if (payload.trust !== RUN_EVIDENCE_RUNTIME_TRUST) observationFailure(`${at} has invalid trust`);
    requireRunEvidenceBoundedText(payload.reason, `${at} reason`, 'RUN_SEMANTIC_INVALID');
    return;
  }
  if (type === 'run.metrics') {
    assertRunMetricsPayloadContract(payload, at);
    return;
  }
  if (type === 'legacy.imported') {
    if (!hasExactKeys(payload, [
      'correlation_id',
      'trust',
      'qualification_eligible',
      'source_kind',
      'source_ref',
      'source_sha256',
      'record_count',
      'projection',
    ])) observationFailure(`${at} has missing or additional properties`);
    if (payload.trust !== RUN_EVIDENCE_LEGACY_TRUST) observationFailure(`${at} has invalid legacy trust`);
    if (payload.qualification_eligible !== false) observationFailure(`${at} must remain qualification-ineligible`);
    requireRunEvidenceBoundedText(payload.correlation_id, `${at} correlation_id`, 'RUN_SEMANTIC_INVALID');
    if (typeof payload.source_kind !== 'string'
      || !['task-history', 'review-ledger', 'diagnostic-jsonl', 'other'].includes(payload.source_kind)) {
      observationFailure(`${at} has an unsupported source_kind`);
    }
    requireRunEvidenceBoundedText(payload.source_ref, `${at} source_ref`, 'RUN_SEMANTIC_INVALID');
    if (typeof payload.source_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.source_sha256)) {
      observationFailure(`${at} has an invalid source_sha256`);
    }
    if (typeof payload.record_count !== 'number'
      || !Number.isSafeInteger(payload.record_count)
      || payload.record_count < 0) {
      observationFailure(`${at} has an invalid record_count`);
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'projection')) {
      observationFailure(`${at} requires projection`);
    }
    return;
  }
  if (!isRunEvidenceLifecycleObservation(type)) return;
  requireRunEvidenceBoundedText(payload.operation_id, `${at} operation_id`, 'RUN_SEMANTIC_INVALID');
  const expectedStatus = type.slice(type.indexOf('.') + 1);
  if (payload.status !== expectedStatus) observationFailure(`${at} must declare status=${expectedStatus}`);
  if (payload.trust !== RUN_EVIDENCE_RUNTIME_TRUST) observationFailure(`${at} has invalid trust`);
}

function assertRunMetricsPayloadContract(
  payload: { [key: string]: RunEvidenceJson },
  at: string,
): void {
  if (!hasExactKeys(payload, [
    'correlation_id',
    'trust',
    'schema',
    'token',
    'tool',
    'latency_ms',
    'retry',
    'cost',
    'evidence_size',
  ])) observationFailure(`${at} has missing or additional properties`);
  if (payload.schema !== RUN_METRICS_SCHEMA) observationFailure(`${at} has invalid schema`);
  if (payload.trust !== RUN_EVIDENCE_RUNTIME_TRUST) observationFailure(`${at} has invalid trust`);
  requireRunEvidenceBoundedText(payload.correlation_id, `${at} correlation_id`, 'RUN_SEMANTIC_INVALID');
  assertMetricNumberGroup(payload.token, `${at}.token`, ['input', 'output', 'total'], true);
  assertMetricNumberGroup(payload.tool, `${at}.tool`, ['calls', 'successes', 'failures'], true);
  assertMetricNumberGroup(payload.latency_ms, `${at}.latency_ms`, ['provider', 'tool', 'total'], false);
  assertMetricNumberGroup(payload.retry, `${at}.retry`, ['provider', 'tool', 'total'], true);
  assertMetricCost(payload.cost, `${at}.cost`);
  assertMetricNumberGroup(payload.evidence_size, `${at}.evidence_size`, ['refs', 'bytes'], true);
  assertRunMetricsContainsNoContent(payload, at);
}

function assertMetricNumberGroup(
  value: RunEvidenceJson,
  at: string,
  keys: readonly string[],
  integer: boolean,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    observationFailure(`${at} requires an object`);
  }
  const group = value as Record<string, RunEvidenceJson>;
  if (!hasExactKeys(group, keys)) observationFailure(`${at} has missing or additional properties`);
  for (const key of keys) {
    assertMetricNumber(group[key], `${at}.${key}`, integer);
  }
}

function assertMetricCost(value: RunEvidenceJson, at: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    observationFailure(`${at} requires an object`);
  }
  const cost = value as Record<string, RunEvidenceJson>;
  if (!hasExactKeys(cost, ['currency', 'amount_micros'])) {
    observationFailure(`${at} has missing or additional properties`);
  }
  if (cost.currency !== RUN_METRICS_UNKNOWN) {
    if (typeof cost.currency !== 'string' || !/^[A-Z]{3}$/.test(cost.currency)) {
      observationFailure(`${at}.currency must be ISO-4217 text or unknown`);
    }
  }
  assertMetricNumber(cost.amount_micros, `${at}.amount_micros`, true);
}

function assertMetricNumber(value: RunEvidenceJson, at: string, integer: boolean): void {
  if (value === RUN_METRICS_UNKNOWN) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    observationFailure(`${at} must be a non-negative number or unknown`);
  }
  if (integer && !Number.isSafeInteger(value)) {
    observationFailure(`${at} must be a non-negative integer or unknown`);
  }
}

function assertRunMetricsContainsNoContent(value: RunEvidenceJson, path: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertRunMetricsContainsNoContent(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (
      normalized === 'content'
      || normalized === 'contents'
      || normalized === 'prompt'
      || normalized === 'message'
      || normalized === 'messages'
      || normalized === 'secret'
      || normalized === 'apikey'
      || normalized === 'password'
      || normalized === 'authorization'
      || normalized === 'cookie'
      || normalized === 'raw'
      || normalized === 'text'
    ) {
      observationFailure(`${path} cannot carry content or secret field ${key}`);
    }
    assertRunMetricsContainsNoContent(nested, `${path}.${key}`);
  }
}

function isRunEvidenceLifecycleObservation(type: RunEvidenceEventType): boolean {
  return type.startsWith('provider.')
    || type.startsWith('side_effect.')
    || type.startsWith('verification.')
    || type.startsWith('quality_gate.')
    || type.startsWith('recovery.');
}

function requireObservationPayload(
  value: RunEvidenceJson,
  at: string,
): { [key: string]: RunEvidenceJson } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    observationFailure(`${at} requires an object payload`);
  }
  return value as { [key: string]: RunEvidenceJson };
}

function observationFailure(message: string): never {
  throw new RunEvidenceLedgerError('RUN_SEMANTIC_INVALID', message);
}

function visitQualificationBoundary(
  value: RunEvidenceJson,
  path: string,
  legacyProjectionPath?: string,
): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitQualificationBoundary(item, `${path}[${index}]`, legacyProjectionPath));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (nestedPath === legacyProjectionPath) continue;
    const normalizedKey = key.replace(/_/g, '').toLowerCase();
    if (normalizedKey === 'qualificationeligible') {
      if (nested !== false) {
        throw new RunEvidenceLedgerError(
          'RUN_SEMANTIC_INVALID',
          `Product evidence cannot set ${path}.${key} to a qualification-eligible value`,
        );
      }
    } else if (normalizedKey.startsWith('qualification')) {
      throw new RunEvidenceLedgerError(
        'RUN_SEMANTIC_INVALID',
        `Product evidence cannot carry reserved qualification field ${path}.${key}`,
      );
    }
    if (normalizedKey === 'integrityscope' && nested !== RUN_EVIDENCE_INTEGRITY_SCOPE) {
      throw new RunEvidenceLedgerError(
        'RUN_SEMANTIC_INVALID',
        `Product evidence cannot override ${path}.${key}`,
      );
    }
    visitQualificationBoundary(nested, nestedPath, legacyProjectionPath);
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

/** The single shared canonical JSON authority used by product evidence hashes. */
export function canonicalRunEvidenceJson(value: unknown): string {
  return canonicalize(normalizeRunEvidenceJson(value));
}

export function sha256RunEvidence(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalRunEvidenceJson(value), 'utf8').digest('hex');
}

export function runEvidenceReplayDigest(snapshot: RunEvidenceSnapshot): string {
  return sha256RunEvidence({
    protocol: RUN_EVIDENCE_REPLAY_PROTOCOL,
    integrity_scope: RUN_EVIDENCE_INTEGRITY_SCOPE,
    qualification_eligible: RUN_EVIDENCE_QUALIFICATION_ELIGIBLE,
    run_id: snapshot.runId,
    records: snapshot.records.map(record => ({
      slot_sequence: record.slotSequence,
      previous_record_sha256: record.previousRecordSha256,
      event_sha256: record.event.event_sha256,
      receipt_sha256: record.receipt.receipt_sha256,
      record_sha256: record.recordSha256,
    })),
    seal: snapshot.seal
      ? {
          slot_sequence: snapshot.seal.slotSequence,
          previous_record_sha256: snapshot.seal.previousRecordSha256,
          seal_sha256: snapshot.seal.seal.seal_sha256,
          record_sha256: snapshot.seal.recordSha256,
        }
      : null,
  });
}

export function runEvidenceEventIdempotencyFingerprint(
  runId: string,
  type: RunEvidenceEventType,
  surface: string,
  idempotencyKey: string,
  payload: RunEvidenceJson,
): string {
  return sha256RunEvidence({
    protocol: 'devseek.run-evidence-idempotency/v1',
    run_id: runId,
    type,
    surface,
    idempotency_key: idempotencyKey,
    payload,
  });
}

export function runEvidenceSealIdempotencyFingerprint(
  runId: string,
  head: RunEvidenceHeadReference,
  idempotencyKey: string,
  reason: string,
): string {
  return sha256RunEvidence({
    protocol: 'devseek.run-evidence-seal-idempotency/v1',
    run_id: runId,
    expected_head: {
      sequence: head.sequence,
      event_sha256: head.eventSha256,
      record_sha256: head.recordSha256,
    },
    idempotency_key: idempotencyKey,
    reason,
  });
}

function canonicalize(value: RunEvidenceJson): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalize(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function snapshotRunEvidenceJson(value: unknown, ancestors: WeakSet<object>): RunEvidenceJson {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (containsDevSeekAuthorityCapability(value)) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence cannot contain secret material');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence numbers must be finite');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object') {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence value must be strict JSON data');
  }
  if (ancestors.has(value)) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence value cannot contain cycles');
  }
  const prototype = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence value must use plain JSON containers');
  }
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (isArray) {
      const array = value as unknown[];
      const output: RunEvidenceJson[] = [];
      const length = Reflect.get(array, 'length');
      if (
        typeof length !== 'number'
        || !Number.isSafeInteger(length)
        || length < 0
        || length > 0xffff_ffff
      ) {
        throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence arrays require a valid array length');
      }
      const numericKeys: Array<{ index: number; key: string }> = [];
      for (const key of keys) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) {
          throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence arrays cannot have additional properties');
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
          throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence arrays cannot have additional properties');
        }
        numericKeys.push({ index, key });
      }
      if (numericKeys.length !== length) {
        throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence arrays cannot be sparse');
      }
      numericKeys.sort((left, right) => left.index - right.index);
      for (let index = 0; index < numericKeys.length; index += 1) {
        const entry = numericKeys[index];
        if (entry.index !== index) {
          throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence arrays cannot be sparse');
        }
        const descriptor = Object.getOwnPropertyDescriptor(array, entry.key);
        if (!descriptor || !descriptor.enumerable) {
          throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence arrays require enumerable elements');
        }
        output.push(snapshotRunEvidenceJson(Reflect.get(array, entry.key), ancestors));
      }
      return output;
    }
    const output: { [key: string]: RunEvidenceJson } = {};
    for (const key of keys) {
      if (typeof key !== 'string') {
        throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence objects cannot have symbol properties');
      }
      if (containsDevSeekAuthorityCapability(key)) {
        throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence cannot contain secret material');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable) {
        throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence objects require enumerable properties');
      }
      const nested = snapshotRunEvidenceJson(Reflect.get(value, key), ancestors);
      Object.defineProperty(output, key, {
        value: nested,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  } catch (error) {
    if (error instanceof RunEvidenceLedgerError) throw error;
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence value must be strict JSON data');
  } finally {
    ancestors.delete(value);
  }
}

function visitPayloadTextBoundary(value: RunEvidenceJson, path: string): void {
  if (typeof value === 'string') {
    if (value !== value.trim()) {
      throw new RunEvidenceLedgerError('RUN_SEMANTIC_INVALID', `${path} cannot have leading or trailing whitespace`);
    }
    if (hasForbiddenRunEvidenceControl(value)) {
      throw new RunEvidenceLedgerError('RUN_SEMANTIC_INVALID', `${path} cannot contain control characters`);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((nested, index) => visitPayloadTextBoundary(nested, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key !== key.trim() || hasForbiddenRunEvidenceControl(key)) {
      throw new RunEvidenceLedgerError('RUN_SEMANTIC_INVALID', 'Payload property names cannot contain edge whitespace or control characters');
    }
    visitPayloadTextBoundary(nested, `${path}.${key}`);
  }
}

function hasForbiddenRunEvidenceControl(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
