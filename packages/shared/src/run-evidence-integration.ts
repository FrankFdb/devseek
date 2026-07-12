import * as crypto from 'crypto';
import * as nodePath from 'path';

import {
  assertRunEvidenceMutationAuthorized,
  assertRunEvidenceEventObservationContract,
  assertRunEvidencePersistedSecretBoundary,
  FileSystemRunEvidenceLedger,
  normalizeRunEvidenceMutationCredential,
  normalizeRunEvidenceJson,
  snapshotRunEvidenceInputObject,
  requireRunEvidenceBoundedText,
  RUN_EVIDENCE_AUTHORITY_PROTOCOL,
  RUN_EVIDENCE_AUTHORITY_TOKEN_BYTES,
  RUN_EVIDENCE_AUTHORITY_TOKEN_PREFIX,
  RUN_EVIDENCE_LEGACY_TRUST,
  RUN_EVIDENCE_RUNTIME_TRUST,
  RUN_EVIDENCE_TEXT_MAX_LENGTH,
  type RunEvidenceAppendResult,
  type RunEvidenceEvent,
  type RunEvidenceEventType,
  type RunEvidenceHead,
  type RunEvidenceJson,
  RunEvidenceLedgerError,
  type RunEvidenceLedgerPort,
  type RunEvidenceMutationCredential,
  type RunEvidenceExpectedAnchor,
  type RunEvidenceRecoveryReport,
  type RunEvidenceSealResult,
  type RunEvidenceVerificationReport,
  sha256RunEvidence,
} from './run-evidence-ledger';
import { assertRunEvidencePrefixCandidate } from './run-evidence-prefix-reducer';

export const PRODUCT_RUN_EVIDENCE_DIRECTORY = nodePath.join('.devseek', 'run-evidence', 'v1');
export const LEGACY_EVIDENCE_TRUST = RUN_EVIDENCE_LEGACY_TRUST;
export const PRODUCT_RUNTIME_OBSERVATION_TRUST = RUN_EVIDENCE_RUNTIME_TRUST;
export const PRODUCT_RUN_EVIDENCE_AUTHORITY_PROTOCOL = RUN_EVIDENCE_AUTHORITY_PROTOCOL;

export type ProductRunEvidenceAuthority = RunEvidenceMutationCredential;

export interface ProductRunEvidenceSessionOptions {
  ledger: RunEvidenceLedgerPort;
  runId: string;
  surface: string;
  /** Explicit capability. `openIfMissing` alone never grants owner authority. */
  authority: ProductRunEvidenceAuthority;
  /** Only an owner with both provisioned secrets may create a missing run. */
  openIfMissing?: boolean;
  openPayload?: RunEvidenceJson;
  openIdempotencyKey?: string;
  maxAppendAttempts?: number;
}

export interface ProductRunEvidenceWorkspaceOptions
  extends Omit<ProductRunEvidenceSessionOptions, 'ledger'> {
  workspaceRoot: string;
}

export interface ProductRunEvidenceRecordInput {
  type: Exclude<RunEvidenceEventType, 'run.opened' | 'run.settled'>;
  idempotencyKey: string;
  payload?: RunEvidenceJson;
  occurredAt?: string | Date;
}

export interface LegacyEvidenceImportInput {
  sourceKind: 'task-history' | 'review-ledger' | 'diagnostic-jsonl' | 'other';
  sourceRef: string;
  sourceSha256: string;
  recordCount: number;
  projection: RunEvidenceJson;
  importedAt?: string | Date;
}

/**
 * A process-safe product integration boundary around RunEvidenceLedgerPort.
 *
 * It deliberately re-reads the durable head before every transition. This
 * allows the VS Code process, CLI process and bridge process to participate in
 * one run without sharing memory. Qualification code must consume a sealed
 * snapshot plus an independently retained anchor; this diagnostic session does
 * not mint qualification claims.
 */
export class ProductRunEvidenceSession {
  readonly runId: string;
  readonly surface: string;
  readonly authorityRole: ProductRunEvidenceAuthority['role'];
  private readonly maxAppendAttempts: number;
  private readonly authority: ProductRunEvidenceAuthority;

  constructor(
    private readonly ledger: RunEvidenceLedgerPort,
    options: Omit<ProductRunEvidenceSessionOptions, 'ledger'>,
  ) {
    const input = snapshotRunEvidenceInputObject(options, 'Product run evidence session options must be an object');
    this.runId = requireContractText(input.runId, 'runId');
    this.surface = requireContractText(input.surface, 'surface');
    this.authority = normalizeAuthority(input.authority as ProductRunEvidenceAuthority | undefined);
    this.authorityRole = this.authority.role;
    this.maxAppendAttempts = normalizeAttemptCount(input.maxAppendAttempts);
    this.connect(input);
  }

  static forWorkspace(options: ProductRunEvidenceWorkspaceOptions): ProductRunEvidenceSession {
    const input = snapshotRunEvidenceInputObject(options, 'Product workspace evidence options must be an object');
    const ledger = new FileSystemRunEvidenceLedger({
      rootDir: productRunEvidenceRoot(input.workspaceRoot),
    });
    return new ProductRunEvidenceSession(
      ledger,
      input as unknown as Omit<ProductRunEvidenceSessionOptions, 'ledger'>,
    );
  }

  verify(): RunEvidenceVerificationReport {
    return this.ledger.verify(this.runId);
  }

  /** Recovery is diagnostic and non-mutating; invalid runs require manual intervention. */
  recover(expectedAnchor?: RunEvidenceExpectedAnchor): RunEvidenceRecoveryReport {
    return this.ledger.recover(this.runId, expectedAnchor);
  }

  head(): RunEvidenceHead {
    return this.ledger.head(this.runId);
  }

  /** Read-only replay view used by surfaces to check cross-boundary completeness. */
  readEvents(): readonly RunEvidenceEvent[] {
    return this.ledger.read(this.runId);
  }

  record(input: ProductRunEvidenceRecordInput): RunEvidenceAppendResult {
    const value = snapshotRunEvidenceInputObject(input, 'Product run evidence record input must be an object');
    const runtimeType = value.type as RunEvidenceEventType;
    if (runtimeType === 'run.opened') {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'run.opened can only be created by the owner connection');
    }
    if (runtimeType === 'run.settled') {
      const code = this.authorityRole === 'participant' ? 'AUTHORITY_DENIED' : 'INVALID_INPUT';
      throw new RunEvidenceLedgerError(code, 'run.settled can only be written by owner settleAndSeal');
    }
    const idempotencyKey = requireContractText(value.idempotencyKey, 'idempotencyKey');
    const payload = withRunCorrelation(this.runId, (value.payload ?? {}) as RunEvidenceJson);
    assertRecordObservationEnvelope(runtimeType, payload);
    for (let attempt = 1; attempt <= this.maxAppendAttempts; attempt += 1) {
      const events = this.ledger.read(this.runId);
      assertRunEvidencePrefixCandidate(events, {
        type: runtimeType,
        surface: this.surface,
        idempotency_key: idempotencyKey,
        payload,
        sequence: events.length + 1,
      });
      const head = this.ledger.head(this.runId);
      if (head.sealed) {
        throw new RunEvidenceLedgerError('RUN_SEALED', `Run ${this.runId} is sealed`);
      }
      if (this.ledger.read(this.runId).some(event => event.type === 'run.settled')) {
        throw new RunEvidenceLedgerError('RUN_SEALED', `Run ${this.runId} has already settled`);
      }
      try {
        return this.ledger.append({
          runId: this.runId,
          expectedHead: headReference(head),
          type: runtimeType,
          surface: this.surface,
          idempotencyKey,
          occurredAt: value.occurredAt as string | Date | undefined,
          payload,
          credential: this.authority,
        });
      } catch (error) {
        if (!isRetryableAppendConflict(error) || attempt === this.maxAppendAttempts) throw error;
      }
    }
    throw new RunEvidenceLedgerError('APPEND_CONFLICT', 'Run evidence append retry budget was exhausted');
  }

  importLegacy(input: LegacyEvidenceImportInput): RunEvidenceAppendResult {
    const value = snapshotRunEvidenceInputObject(input, 'Legacy evidence import input must be an object');
    const sourceRef = requireContractText(value.sourceRef, 'sourceRef');
    const sourceSha256 = requireSha256(value.sourceSha256, 'sourceSha256');
    const recordCount = requireRecordCount(value.recordCount);
    return this.record({
      type: 'legacy.imported',
      idempotencyKey: productRunEvidenceIdempotencyKey('legacy-import', {
        sourceKind: value.sourceKind,
        sourceRef,
        sourceSha256,
      }),
      occurredAt: value.importedAt as string | Date | undefined,
      payload: {
        trust: LEGACY_EVIDENCE_TRUST,
        qualification_eligible: false,
        source_kind: value.sourceKind as LegacyEvidenceImportInput['sourceKind'],
        source_ref: sourceRef,
        source_sha256: sourceSha256,
        record_count: recordCount,
        projection: value.projection as RunEvidenceJson,
      },
    });
  }

  settleAndSeal(input: {
    status: 'completed' | 'failed' | 'cancelled';
    idempotencyKey: string;
    payload?: RunEvidenceJson;
    occurredAt?: string | Date;
    sealReason?: string;
    sealIdempotencyKey?: string;
  }): RunEvidenceSealResult {
    const value = snapshotRunEvidenceInputObject(input, 'Run settlement input must be an object');
    if (this.authorityRole !== 'owner') {
      throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Only the run owner may settle and seal evidence');
    }
    const status = requireSettlementStatus(value.status);
    const settlementKey = requireContractText(value.idempotencyKey, 'idempotencyKey');
    const derivedSealKey = `${settlementKey}:seal`;
    const sealKey = value.sealIdempotencyKey
      ? requireContractText(value.sealIdempotencyKey, 'sealIdempotencyKey')
      : derivedSealKey.length <= RUN_EVIDENCE_TEXT_MAX_LENGTH
        ? derivedSealKey
        : productRunEvidenceIdempotencyKey('run-seal', { runId: this.runId, settlementKey });
    const reason = requireContractText(value.sealReason ?? `run-${status}`, 'sealReason');
    const settlementPayload = withRunCorrelation(this.runId, {
      status,
      details: (value.payload ?? {}) as RunEvidenceJson,
    });

    let settlementCommitted = false;
    for (let attempt = 1; attempt <= this.maxAppendAttempts; attempt += 1) {
      const events = this.ledger.read(this.runId);
      const existingSettlement = events.find(event => event.type === 'run.settled');
      if (existingSettlement) {
        if (
          existingSettlement !== events[events.length - 1]
          || existingSettlement.idempotency_key !== settlementKey
          || sha256RunEvidence(existingSettlement.payload) !== sha256RunEvidence(settlementPayload)
        ) {
          throw new RunEvidenceLedgerError('RUN_SEMANTIC_INVALID', 'The run already has a conflicting settlement');
        }
        settlementCommitted = true;
        break;
      }
      assertRunEvidencePrefixCandidate(events, {
        type: 'run.settled',
        surface: this.surface,
        idempotency_key: settlementKey,
        payload: settlementPayload,
        sequence: events.length + 1,
      });
      const head = this.ledger.head(this.runId);
      if (head.sealed) break;
      try {
        this.ledger.append({
          runId: this.runId,
          expectedHead: headReference(head),
          type: 'run.settled',
          surface: this.surface,
          idempotencyKey: settlementKey,
          occurredAt: value.occurredAt as string | Date | undefined,
          payload: settlementPayload,
          credential: this.authority,
        });
        settlementCommitted = true;
        break;
      } catch (error) {
        if (!isRetryableAppendConflict(error) || attempt === this.maxAppendAttempts) throw error;
      }
    }
    if (!settlementCommitted && !this.ledger.head(this.runId).sealed) {
      throw new RunEvidenceLedgerError('APPEND_CONFLICT', 'Run settlement retry budget was exhausted');
    }

    for (let attempt = 1; attempt <= this.maxAppendAttempts; attempt += 1) {
      const head = this.ledger.head(this.runId);
      if (head.sealed) {
        const seal = this.ledger.getSeal(this.runId);
        if (!seal) throw new RunEvidenceLedgerError('LEDGER_CORRUPT', 'Sealed head has no seal record');
        if (seal.idempotency_key !== sealKey || seal.reason !== reason) {
          throw new RunEvidenceLedgerError('SEAL_CONFLICT', `Run ${this.runId} was sealed by another transition`);
        }
        return { seal, head, idempotent: true };
      }
      try {
        return this.ledger.seal({
          runId: this.runId,
          expectedHead: headReference(head),
          idempotencyKey: sealKey,
          sealedAt: value.occurredAt as string | Date | undefined,
          reason,
          credential: this.authority,
        });
      } catch (error) {
        if (!isRetryableSealConflict(error) || attempt === this.maxAppendAttempts) throw error;
      }
    }
    throw new RunEvidenceLedgerError('SEAL_CONFLICT', 'Run evidence seal retry budget was exhausted');
  }

  private connect(options: Record<string, unknown>): void {
    const report = this.ledger.verify(this.runId);
    if (report.found) {
      if (!report.valid) {
        throw new RunEvidenceLedgerError('LEDGER_CORRUPT', `Run ${this.runId} failed replay verification`, {
          issues: report.issues.map(issue => ({
            kind: issue.kind,
            code: issue.code,
            path: issue.path ?? null,
            message: issue.message,
          })),
        });
      }
      assertRunEvidenceMutationAuthorized(this.ledger.read(this.runId), this.authority);
      if (report.status === 'valid-sealed') {
        throw new RunEvidenceLedgerError('RUN_SEALED', `Run ${this.runId} is already sealed`);
      }
      return;
    }
    if (options.openIfMissing !== true) {
      throw new RunEvidenceLedgerError('RUN_NOT_FOUND', `Run ${this.runId} was not opened by its owning surface`);
    }
    if (this.authority.role !== 'owner') {
      throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'A participant cannot create a product evidence run');
    }
    const participantToken = this.authority.participantToken;
    if (!participantToken) {
      throw new RunEvidenceLedgerError(
        'AUTHORITY_DENIED',
        'Creating a run requires a distinct participant authority token',
      );
    }
    this.ledger.openRun({
      runId: this.runId,
      surface: this.surface,
      idempotencyKey: options.openIdempotencyKey === undefined
        ? productRunEvidenceIdempotencyKey('run-open', { runId: this.runId })
        : requireContractText(options.openIdempotencyKey, 'openIdempotencyKey'),
      payload: withRunCorrelation(this.runId, (options.openPayload ?? {}) as RunEvidenceJson),
      credential: this.authority,
    });
  }
}

/** Generates a 256-bit, versioned bearer capability for one product run role. */
export function createProductRunEvidenceAuthorityToken(): string {
  return `${RUN_EVIDENCE_AUTHORITY_TOKEN_PREFIX}${crypto.randomBytes(RUN_EVIDENCE_AUTHORITY_TOKEN_BYTES).toString('base64url')}`;
}

export function productRunEvidenceRoot(workspaceRoot: unknown): string {
  return nodePath.join(nodePath.resolve(requireText(workspaceRoot, 'workspaceRoot')), PRODUCT_RUN_EVIDENCE_DIRECTORY);
}

function assertRecordObservationEnvelope(type: RunEvidenceEventType, payload: RunEvidenceJson): void {
  // The durable replay check remains authoritative; this early guard prevents
  // normal product surfaces from poisoning an append-only run with malformed
  // observation envelopes.
  assertRunEvidenceEventObservationContract(type, payload, 0);
}

function normalizeAuthority(authority: ProductRunEvidenceAuthority | undefined): ProductRunEvidenceAuthority {
  return normalizeRunEvidenceMutationCredential(authority);
}

/** Timestamp remains operator-readable; entropy prevents same-second run aliasing. */
export function createProductRunEvidenceId(
  now = new Date(),
  randomSuffix = () => crypto.randomBytes(8).toString('hex'),
): string {
  if (!Number.isFinite(now.getTime())) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'now must be a valid Date');
  }
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${iso.slice(20, 23)}`;
  const suffix = requireText(randomSuffix(), 'randomSuffix').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!suffix) throw new RunEvidenceLedgerError('INVALID_INPUT', 'randomSuffix has no safe characters');
  return `${stamp}-${suffix.slice(0, 64)}`;
}

export function productRunEvidenceIdempotencyKey(prefix: string, value: unknown): string {
  const normalizedPrefix = requireText(prefix, 'prefix').replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 80);
  return `${normalizedPrefix}:${sha256RunEvidence(value)}`;
}

function headReference(head: RunEvidenceHead): { sequence: number; eventSha256: string; recordSha256: string } {
  return {
    sequence: head.sequence,
    eventSha256: head.eventSha256,
    recordSha256: head.recordSha256,
  };
}

function withRunCorrelation(runId: string, payload: RunEvidenceJson): RunEvidenceJson {
  const normalizedPayload = normalizeRunEvidenceJson(payload);
  if (normalizedPayload && typeof normalizedPayload === 'object' && !Array.isArray(normalizedPayload)) {
    const existing = normalizedPayload.correlation_id;
    if (existing !== undefined && existing !== runId) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'payload correlation_id does not match runId');
    }
    return { ...normalizedPayload, correlation_id: runId };
  }
  return { correlation_id: runId, value: normalizedPayload };
}

function isRetryableAppendConflict(error: unknown): boolean {
  return error instanceof RunEvidenceLedgerError
    && (error.code === 'APPEND_CONFLICT' || error.code === 'EXPECTED_HEAD_MISMATCH');
}

function isRetryableSealConflict(error: unknown): boolean {
  return error instanceof RunEvidenceLedgerError
    && (error.code === 'SEAL_CONFLICT' || error.code === 'EXPECTED_HEAD_MISMATCH');
}

function normalizeAttemptCount(value: unknown): number {
  if (value === undefined) return 32;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'maxAppendAttempts must be an integer from 1 to 1000');
  }
  return value;
}

function requireText(value: unknown, name: string): string {
  assertRunEvidencePersistedSecretBoundary(value);
  if (typeof value !== 'string') throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} must be primitive text`);
  const normalized = value.trim();
  if (!normalized) throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} is required`);
  return normalized;
}

function requireContractText(value: unknown, name: string): string {
  return requireRunEvidenceBoundedText(value, name);
}

function requireSettlementStatus(value: unknown): 'completed' | 'failed' | 'cancelled' {
  if (value !== 'completed' && value !== 'failed' && value !== 'cancelled') {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'status must be completed, failed, or cancelled');
  }
  return value;
}

function requireSha256(value: unknown, name: string): string {
  const normalized = requireText(value, name);
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} must be a lowercase SHA-256 digest`);
  }
  return normalized;
}

function requireRecordCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'recordCount must be a non-negative safe integer');
  }
  return value;
}
