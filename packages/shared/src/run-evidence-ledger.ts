import * as crypto from 'crypto';
import * as fs from 'fs';
import * as nodePath from 'path';

import {
  AppendRunEvidenceRequest,
  assertRunEvidenceEventObservationContract,
  assertRunEvidenceMutationAuthorized,
  assertRunEvidencePayloadQualificationBoundary,
  assertRunEvidencePersistedSecretBoundary,
  canonicalRunEvidenceJson,
  OpenRunEvidenceRequest,
  RUN_EVIDENCE_AUTHORITY_PAYLOAD_KEY,
  RUN_EVIDENCE_EVENT_PROTOCOL,
  RUN_EVIDENCE_EVENT_TYPES,
  RUN_EVIDENCE_INTEGRITY_SCOPE,
  RUN_EVIDENCE_QUALIFICATION_ELIGIBLE,
  RUN_EVIDENCE_RECEIPT_PROTOCOL,
  RUN_EVIDENCE_RECORD_PROTOCOL,
  RUN_EVIDENCE_SEAL_PROTOCOL,
  normalizeRunEvidenceMutationCredential,
  normalizeRunEvidenceJson,
  requireRunEvidenceBoundedText,
  runEvidenceAuthorityMetadata,
  runEvidenceEventIdempotencyFingerprint,
  runEvidenceSealIdempotencyFingerprint,
  RunEvidenceAppendResult,
  RunEvidenceCommittedRecord,
  RunEvidenceEvent,
  RunEvidenceEventType,
  RunEvidenceHead,
  RunEvidenceHeadReference,
  RunEvidenceExpectedAnchor,
  RunEvidenceIssueKind,
  RunEvidenceJson,
  RunEvidenceLedgerError,
  RunEvidenceLedgerLocation,
  RunEvidenceLedgerOptions,
  RunEvidenceLedgerPort,
  RunEvidenceMutationCredential,
  RunEvidenceReceipt,
  RunEvidenceRecoveryReport,
  RunEvidenceSeal,
  RunEvidenceSealSnapshot,
  RunEvidenceSealResult,
  RunEvidenceSnapshot,
  RunEvidenceVerificationIssue,
  RunEvidenceVerificationReport,
  SealRunEvidenceRequest,
  sha256RunEvidence,
  snapshotRunEvidenceInputObject,
} from './run-evidence-protocol';
import {
  assertRunEvidencePrefixCandidate,
  assertRunEvidencePrefixSealable,
  reduceRunEvidencePrefix,
} from './run-evidence-prefix-reducer';
import {
  applyExpectedAnchor,
  emptyInspection,
  RunEvidenceEventRecord,
  RunEvidenceRecord,
  RunEvidenceSealRecord,
  RunInspection,
  snapshotFromInspection,
  toVerificationReport,
  validateEventRecord,
  validateRecordEnvelope,
  validateSealRecord,
} from './run-evidence-validation';

export * from './run-evidence-protocol';

const SHA256_RE = /^[a-f0-9]{64}$/;
const SLOT_FILE_RE = /^(\d{20})\.json$/;
const FORK_FILE_RE = /^(\d{20})[.-].+\.json$/;
const STAGING_FILE_RE = /^\d{20}\.json\.(\d+)\.([a-f0-9]{16})\.[a-f0-9]{16}\.tmp$/;
const PROCESS_START_TOKEN = processStartToken(process.pid);
const EVENT_TYPE_SET = new Set<string>(RUN_EVIDENCE_EVENT_TYPES);
export class FileSystemRunEvidenceLedger implements RunEvidenceLedgerPort {
  readonly rootDir: string;
  private readonly now: () => Date;

  constructor(options: RunEvidenceLedgerOptions) {
    const input = snapshotRunEvidenceInputObject(options, 'Run evidence ledger options must be an object');
    this.rootDir = nodePath.resolve(requireNonEmpty(input.rootDir, 'rootDir'));
    if (input.now !== undefined && typeof input.now !== 'function') {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'now must be a function');
    }
    this.now = input.now as (() => Date) | undefined ?? (() => new Date());
  }

  location(runId: string): RunEvidenceLedgerLocation {
    const normalizedRunId = requireRunId(runId);
    const runDirectory = nodePath.join(this.rootDir, sha256Text(normalizedRunId));
    return {
      runDirectory,
      recordsDirectory: nodePath.join(runDirectory, 'records'),
      stagingDirectory: nodePath.join(runDirectory, 'staging'),
    };
  }

  openRun(request: OpenRunEvidenceRequest): RunEvidenceAppendResult {
    const input = snapshotRunEvidenceInputObject(request, 'openRun request must be an object');
    const credential = normalizeRunEvidenceMutationCredential(input.credential, true);
    if (credential.role !== 'owner' || credential.participantToken === undefined) {
      throw new RunEvidenceLedgerError('AUTHORITY_DENIED', 'Only an owner with a participant token may create a run');
    }
    const runId = requireRunId(input.runId);
    const surface = requireRunEvidenceBoundedText(input.surface, 'surface');
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const suppliedPayload = normalizeRunEvidenceJson(input.payload ?? {});
    if (!suppliedPayload || typeof suppliedPayload !== 'object' || Array.isArray(suppliedPayload)) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'run.opened payload must be an object');
    }
    if (Object.prototype.hasOwnProperty.call(suppliedPayload, RUN_EVIDENCE_AUTHORITY_PAYLOAD_KEY)) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', `${RUN_EVIDENCE_AUTHORITY_PAYLOAD_KEY} is reserved`);
    }
    const payload: RunEvidenceJson = {
      ...suppliedPayload,
      [RUN_EVIDENCE_AUTHORITY_PAYLOAD_KEY]: runEvidenceAuthorityMetadata(
        credential.token,
        credential.participantToken,
      ) as unknown as RunEvidenceJson,
    };
    assertRunEvidencePersistedSecretBoundary(payload);
    assertRunEvidencePayloadQualificationBoundary('run.opened', payload);
    assertRunEvidenceEventObservationContract('run.opened', payload);
    const occurredAt = normalizeTimestamp(input.occurredAt ?? this.now(), 'occurredAt');
    const committedAt = normalizeTimestamp(this.now(), 'committedAt');

    const inspection = this.inspect(runId);
    if (inspection.issues.length > 0 && !isOnlyMissingOpenEvent(inspection)) {
      throw corruptLedger(runId, inspection.issues);
    }

    if (inspection.events.length > 0) {
      assertRunEvidenceMutationAuthorized(inspection.events, credential, true);
      const existing = findEventByIdempotency(inspection.events, idempotencyKey);
      const fingerprint = runEvidenceEventIdempotencyFingerprint(runId, 'run.opened', surface, idempotencyKey, payload);
      if (existing && existing.idempotency_fingerprint_sha256 === fingerprint) {
        return this.resultForExistingEvent(inspection, existing);
      }
      if (existing) {
        throw new RunEvidenceLedgerError(
          'IDEMPOTENCY_CONFLICT',
          `Idempotency key ${idempotencyKey} already names different run evidence`,
        );
      }
      throw new RunEvidenceLedgerError('RUN_ALREADY_OPEN', `Run ${runId} is already open`);
    }

    return this.appendEvent({
      runId,
      expectedHead: null,
      type: 'run.opened',
      surface,
      idempotencyKey,
      occurredAt,
      committedAt,
      payload,
      credential,
    }, true);
  }

  append(request: AppendRunEvidenceRequest): RunEvidenceAppendResult {
    const input = snapshotRunEvidenceInputObject(request, 'append request must be an object');
    const type = requireEventType(input.type, false);
    const payload = normalizeRunEvidenceJson(input.payload ?? {});
    assertRunEvidencePayloadQualificationBoundary(type, payload);
    assertRunEvidenceEventObservationContract(type, payload);
    return this.appendEvent({
      runId: requireRunId(input.runId),
      expectedHead: requireExpectedHead(input.expectedHead),
      type,
      surface: requireRunEvidenceBoundedText(input.surface, 'surface'),
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey),
      occurredAt: normalizeTimestamp(input.occurredAt ?? this.now(), 'occurredAt'),
      committedAt: normalizeTimestamp(this.now(), 'committedAt'),
      payload,
      credential: normalizeRunEvidenceMutationCredential(input.credential),
    }, false);
  }

  head(runId: string): RunEvidenceHead {
    const inspection = this.requireValidRun(runId);
    if (!inspection.head) {
      throw new RunEvidenceLedgerError('RUN_NOT_OPEN', `Run ${runId} has no run.opened event`);
    }
    return cloneJson(inspection.head) as unknown as RunEvidenceHead;
  }

  read(runId: string): RunEvidenceEvent[] {
    const inspection = this.requireValidRun(runId);
    return cloneJson(inspection.events) as unknown as RunEvidenceEvent[];
  }

  readSnapshot(runId: string): RunEvidenceSnapshot {
    return snapshotFromInspection(this.requireValidRun(runId));
  }

  getSeal(runId: string): RunEvidenceSeal | null {
    const inspection = this.requireValidRun(runId);
    return inspection.seal ? cloneJson(inspection.seal) as unknown as RunEvidenceSeal : null;
  }

  seal(request: SealRunEvidenceRequest): RunEvidenceSealResult {
    const input = snapshotRunEvidenceInputObject(request, 'seal request must be an object');
    const credential = normalizeRunEvidenceMutationCredential(input.credential);
    const runId = requireRunId(input.runId);
    const expectedHead = requireExpectedHead(input.expectedHead);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const reason = requireRunEvidenceBoundedText(input.reason ?? 'run-complete', 'reason');
    const sealedAt = normalizeTimestamp(input.sealedAt ?? this.now(), 'sealedAt');

    let inspection = this.requireValidRun(runId);
    if (!inspection.head) {
      throw new RunEvidenceLedgerError('RUN_NOT_OPEN', `Run ${runId} has no run.opened event`);
    }
    assertRunEvidenceMutationAuthorized(inspection.events, credential, true);
    assertRunEvidencePrefixSealable(inspection.events);

    const fingerprint = runEvidenceSealIdempotencyFingerprint(runId, expectedHead, idempotencyKey, reason);
    if (inspection.seal) {
      if (
        inspection.seal.idempotency_key === idempotencyKey
        && inspection.seal.idempotency_fingerprint_sha256 === fingerprint
      ) {
        return {
          seal: cloneJson(inspection.seal) as unknown as RunEvidenceSeal,
          head: cloneJson(inspection.head) as unknown as RunEvidenceHead,
          idempotent: true,
        };
      }
      if (inspection.seal.idempotency_key === idempotencyKey) {
        throw new RunEvidenceLedgerError('IDEMPOTENCY_CONFLICT', 'Seal idempotency key was reused with different input');
      }
      throw new RunEvidenceLedgerError('RUN_SEALED', `Run ${runId} is already sealed`);
    }
    assertExpectedHead(runId, inspection.head, expectedHead);

    const sealBase: Omit<RunEvidenceSeal, 'seal_sha256'> = {
      protocol: RUN_EVIDENCE_SEAL_PROTOCOL,
      integrity_scope: RUN_EVIDENCE_INTEGRITY_SCOPE,
      qualification_eligible: RUN_EVIDENCE_QUALIFICATION_ELIGIBLE,
      run_id: runId,
      slot_sequence: inspection.events.length + 1,
      event_count: inspection.events.length,
      final_event_sha256: inspection.head.eventSha256,
      final_record_sha256: inspection.head.recordSha256,
      idempotency_key: idempotencyKey,
      idempotency_fingerprint_sha256: fingerprint,
      reason,
      sealed_at: sealedAt,
    };
    const seal: RunEvidenceSeal = {
      ...sealBase,
      seal_sha256: sha256RunEvidence(sealBase),
    };
    const recordBase: Omit<RunEvidenceSealRecord, 'record_sha256'> = {
      protocol: RUN_EVIDENCE_RECORD_PROTOCOL,
      record_kind: 'seal',
      slot_sequence: seal.slot_sequence,
      previous_record_sha256: inspection.head.recordSha256,
      seal,
    };
    const record: RunEvidenceSealRecord = {
      ...recordBase,
      record_sha256: sha256RunEvidence(recordBase),
    };

    if (!this.compareAndCreateRecord(runId, record)) {
      inspection = this.requireValidRun(runId);
      assertRunEvidenceMutationAuthorized(inspection.events, credential, true);
      assertRunEvidencePrefixSealable(inspection.events);
      if (
        inspection.seal
        && inspection.seal.idempotency_key === idempotencyKey
        && inspection.seal.idempotency_fingerprint_sha256 === fingerprint
        && inspection.head
      ) {
        return {
          seal: cloneJson(inspection.seal) as unknown as RunEvidenceSeal,
          head: cloneJson(inspection.head) as unknown as RunEvidenceHead,
          idempotent: true,
        };
      }
      throw new RunEvidenceLedgerError('SEAL_CONFLICT', `Another transition won slot ${seal.slot_sequence}`);
    }

    inspection = this.requireValidRun(runId);
    assertRunEvidenceMutationAuthorized(inspection.events, credential, true);
    assertRunEvidencePrefixSealable(inspection.events);
    if (!inspection.seal || !inspection.head) {
      throw new RunEvidenceLedgerError('LEDGER_CORRUPT', 'Durable seal was not readable after commit');
    }
    return {
      seal: cloneJson(inspection.seal) as unknown as RunEvidenceSeal,
      head: cloneJson(inspection.head) as unknown as RunEvidenceHead,
      idempotent: false,
    };
  }

  verify(runId: string, expectedAnchor?: RunEvidenceExpectedAnchor): RunEvidenceVerificationReport {
    const normalizedRunId = requireRunId(runId);
    const normalizedAnchor = expectedAnchor === undefined ? undefined : requireExpectedAnchor(expectedAnchor);
    const inspection = this.inspect(normalizedRunId);
    if (normalizedAnchor) applyExpectedAnchor(inspection, normalizedAnchor);
    return toVerificationReport(inspection, Boolean(normalizedAnchor));
  }

  recover(runId: string, expectedAnchor?: RunEvidenceExpectedAnchor): RunEvidenceRecoveryReport {
    const report = this.verify(runId, expectedAnchor);
    return {
      ...report,
      recoveryAction: report.valid || (!report.found && !expectedAnchor)
        ? 'none'
        : 'manual-intervention-required',
      mutated: false,
    };
  }

  private appendEvent(
    request: {
      runId: string;
      expectedHead: RunEvidenceHeadReference | null;
      type: RunEvidenceEventType;
      surface: string;
      idempotencyKey: string;
      occurredAt: string;
      committedAt: string;
      payload: RunEvidenceJson;
      credential: RunEvidenceMutationCredential;
    },
    allowCreate: boolean,
  ): RunEvidenceAppendResult {
    if (!EVENT_TYPE_SET.has(request.type)) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', `Unknown run evidence type: ${String(request.type)}`);
    }
    if ((request.type === 'run.opened') !== allowCreate) {
      throw new RunEvidenceLedgerError(
        'INVALID_INPUT',
        'run.opened can only be written as the atomic first transition through openRun()',
      );
    }
    assertRunEvidenceEventObservationContract(request.type, request.payload);
    if (!allowCreate && !fs.existsSync(this.location(request.runId).runDirectory)) {
      throw new RunEvidenceLedgerError('RUN_NOT_FOUND', `Run ${request.runId} was not found`);
    }

    let inspection = this.inspect(request.runId);
    if (inspection.issues.length > 0 && !(allowCreate && isOnlyMissingOpenEvent(inspection))) {
      throw corruptLedger(request.runId, inspection.issues);
    }
    if (inspection.events.length > 0) {
      assertRunEvidenceMutationAuthorized(
        inspection.events,
        request.credential,
        allowCreate || request.type === 'run.settled',
      );
    }

    const fingerprint = runEvidenceEventIdempotencyFingerprint(
      request.runId,
      request.type,
      request.surface,
      request.idempotencyKey,
      request.payload,
    );
    const existing = findEventByIdempotency(inspection.events, request.idempotencyKey);
    if (existing) {
      if (existing.idempotency_fingerprint_sha256 === fingerprint) {
        return this.resultForExistingEvent(inspection, existing);
      }
      throw new RunEvidenceLedgerError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with different input');
    }

    if (inspection.seal) {
      throw new RunEvidenceLedgerError('RUN_SEALED', `Run ${request.runId} is sealed`);
    }
    if (!allowCreate && inspection.events.length === 0) {
      throw new RunEvidenceLedgerError('RUN_NOT_OPEN', `Run ${request.runId} has no run.opened event`);
    }
    assertExpectedHead(request.runId, inspection.head, request.expectedHead);

    const sequence = inspection.events.length + 1;
    const previousEventSha256 = inspection.head?.eventSha256 ?? null;
    const eventBase: Omit<RunEvidenceEvent, 'event_sha256'> = {
      protocol: RUN_EVIDENCE_EVENT_PROTOCOL,
      integrity_scope: RUN_EVIDENCE_INTEGRITY_SCOPE,
      qualification_eligible: RUN_EVIDENCE_QUALIFICATION_ELIGIBLE,
      run_id: request.runId,
      sequence,
      previous_event_sha256: previousEventSha256,
      type: request.type,
      surface: request.surface,
      idempotency_key: request.idempotencyKey,
      idempotency_fingerprint_sha256: fingerprint,
      occurred_at: request.occurredAt,
      payload: request.payload,
    };
    assertRunEvidencePersistedSecretBoundary(eventBase);
    const event: RunEvidenceEvent = {
      ...eventBase,
      event_sha256: sha256RunEvidence(eventBase),
    };
    if (allowCreate) assertRunEvidenceMutationAuthorized([event], request.credential, true);
    assertRunEvidencePrefixCandidate(inspection.events, event);
    const receiptBase: Omit<RunEvidenceReceipt, 'receipt_sha256'> = {
      protocol: RUN_EVIDENCE_RECEIPT_PROTOCOL,
      integrity_scope: RUN_EVIDENCE_INTEGRITY_SCOPE,
      qualification_eligible: RUN_EVIDENCE_QUALIFICATION_ELIGIBLE,
      run_id: request.runId,
      sequence,
      event_sha256: event.event_sha256,
      previous_event_sha256: previousEventSha256,
      idempotency_key: request.idempotencyKey,
      committed_at: request.committedAt,
    };
    const receipt: RunEvidenceReceipt = {
      ...receiptBase,
      receipt_sha256: sha256RunEvidence(receiptBase),
    };
    const recordBase: Omit<RunEvidenceEventRecord, 'record_sha256'> = {
      protocol: RUN_EVIDENCE_RECORD_PROTOCOL,
      record_kind: 'event',
      slot_sequence: sequence,
      previous_record_sha256: inspection.head?.recordSha256 ?? null,
      event,
      receipt,
    };
    const record: RunEvidenceEventRecord = {
      ...recordBase,
      record_sha256: sha256RunEvidence(recordBase),
    };
    assertRunEvidencePersistedSecretBoundary(record);

    if (!this.compareAndCreateRecord(request.runId, record)) {
      inspection = this.inspect(request.runId);
      if (inspection.issues.length > 0) {
        throw corruptLedger(request.runId, inspection.issues);
      }
      assertRunEvidenceMutationAuthorized(
        inspection.events,
        request.credential,
        allowCreate || request.type === 'run.settled',
      );
      const winner = findEventByIdempotency(inspection.events, request.idempotencyKey);
      if (winner && winner.idempotency_fingerprint_sha256 === fingerprint) {
        return this.resultForExistingEvent(inspection, winner);
      }
      throw new RunEvidenceLedgerError('APPEND_CONFLICT', `Another transition won slot ${sequence}`);
    }

    inspection = this.requireValidRun(request.runId);
    assertRunEvidenceMutationAuthorized(
      inspection.events,
      request.credential,
      allowCreate || request.type === 'run.settled',
    );
    const committed = inspection.events.find(item => item.event_sha256 === event.event_sha256);
    if (!committed) {
      throw new RunEvidenceLedgerError('LEDGER_CORRUPT', 'Durable event was not readable after commit');
    }
    return this.resultForExistingEvent(inspection, committed, false);
  }

  private resultForExistingEvent(
    inspection: RunInspection,
    event: RunEvidenceEvent,
    idempotent = true,
  ): RunEvidenceAppendResult {
    const record = inspection.eventRecords.find(item => item.event.event_sha256 === event.event_sha256);
    if (!record || !inspection.head) {
      throw new RunEvidenceLedgerError('LEDGER_CORRUPT', 'Event receipt or head is missing');
    }
    const committedHead: RunEvidenceHead = {
      runId: event.run_id,
      sequence: event.sequence,
      eventSha256: event.event_sha256,
      recordSha256: record.record_sha256,
      sealed: false,
    };
    return {
      event: cloneJson(event) as unknown as RunEvidenceEvent,
      receipt: cloneJson(record.receipt) as unknown as RunEvidenceReceipt,
      committedHead,
      currentHead: cloneJson(inspection.head) as unknown as RunEvidenceHead,
      idempotent,
    };
  }

  private compareAndCreateRecord(runId: string, record: RunEvidenceRecord): boolean {
    assertRunEvidencePersistedSecretBoundary({ runId, record });
    const location = this.location(runId);
    this.ensureRunDirectories(runId);
    const destination = nodePath.join(location.recordsDirectory, slotFileName(record.slot_sequence));
    const temporary = nodePath.join(
      location.stagingDirectory,
      `${slotFileName(record.slot_sequence)}.${process.pid}.${PROCESS_START_TOKEN}.${crypto.randomBytes(8).toString('hex')}.tmp`,
    );
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${canonicalRunEvidenceJson(record)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.chmodSync(temporary, 0o444);
      try {
        fs.linkSync(temporary, destination);
      } catch (error) {
        if (isNodeError(error, 'EEXIST')) {
          // A CAS loser still fsyncs the shared directory before it can
          // acknowledge the winning record as durable.
          fsyncDirectory(location.recordsDirectory);
          return false;
        }
        throw error;
      }
      fsyncDirectory(location.recordsDirectory);
      return true;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error;
      }
      fsyncDirectory(location.stagingDirectory);
    }
  }

  private requireValidRun(runId: string): RunInspection {
    const normalizedRunId = requireRunId(runId);
    const inspection = this.inspect(normalizedRunId);
    if (!inspection.found) {
      throw new RunEvidenceLedgerError('RUN_NOT_FOUND', `Run ${normalizedRunId} was not found`);
    }
    if (inspection.issues.length > 0) {
      throw corruptLedger(normalizedRunId, inspection.issues);
    }
    return inspection;
  }

  private ensureRunDirectories(runId: string): void {
    const location = this.location(runId);
    assertEvidencePathHasNoSymlink(location.stagingDirectory);
    assertEvidencePathHasNoSymlink(location.recordsDirectory);
    ensureDurableDirectory(location.recordsDirectory);
    ensureDurableDirectory(location.stagingDirectory);
    assertEvidencePathHasNoSymlink(location.stagingDirectory);
    assertEvidencePathHasNoSymlink(location.recordsDirectory);
  }

  private inspect(runId: string): RunInspection {
    const location = this.location(runId);
    const symlinkPath = firstSymbolicLink([
      this.rootDir,
      location.runDirectory,
      location.recordsDirectory,
      location.stagingDirectory,
    ]);
    if (symlinkPath) {
      const compromised = emptyInspection(runId, true);
      compromised.issues.push({
        kind: 'tamper',
        code: 'SYMLINK_TRUST_BOUNDARY',
        path: symlinkPath,
        message: 'Run evidence paths must not contain or target symbolic links',
      });
      return compromised;
    }
    if (!fs.existsSync(location.runDirectory)) {
      return emptyInspection(runId, false);
    }

    const result = emptyInspection(runId, true);
    const stagingNames = safeReadDirectory(location.stagingDirectory);
    for (const name of stagingNames) {
      const stagingMatch = STAGING_FILE_RE.exec(name);
      // Another process may be between fsync(temp) and link(temp, slot).  That
      // is an in-flight CAS contender, not crash debris.  Once its owning PID
      // is gone the exact same immutable file is reported as an orphan and all
      // product actions fail closed; recover() never deletes it.
      if (
        stagingMatch
        && isWriterActive(Number(stagingMatch[1]), stagingMatch[2])
      ) continue;
      result.issues.push({
        kind: 'orphan',
        code: 'ORPHAN_STAGING_RECORD',
        path: nodePath.join(location.stagingDirectory, name),
        message: 'A staged transition was not atomically committed or removed',
      });
    }

    const recordNames = safeReadDirectory(location.recordsDirectory);
    const slots: Array<{ slot: number; name: string }> = [];
    for (const name of recordNames) {
      const match = SLOT_FILE_RE.exec(name);
      if (match) {
        slots.push({ slot: Number(match[1]), name });
        continue;
      }
      const forkMatch = FORK_FILE_RE.exec(name);
      result.issues.push({
        kind: forkMatch ? 'fork' : 'protocol',
        code: forkMatch ? 'FORK_RECORD_ARTIFACT' : 'UNRECOGNIZED_RECORD_ARTIFACT',
        path: nodePath.join(location.recordsDirectory, name),
        message: forkMatch
          ? `Competing artifact exists for slot ${Number(forkMatch[1])}`
          : 'Records directory contains an unrecognized artifact',
      });
    }
    slots.sort((left, right) => left.slot - right.slot || left.name.localeCompare(right.name));

    let expectedSlot = 1;
    let previousEventSha256: string | null = null;
    let previousEventRecordSha256: string | null = null;
    let sealed = false;
    const idempotencyKeys = new Set<string>();

    for (const item of slots) {
      const recordPath = nodePath.join(location.recordsDirectory, item.name);
      if (item.slot !== expectedSlot) {
        result.issues.push({
          kind: item.slot > expectedSlot ? 'gap' : 'fork',
          code: item.slot > expectedSlot ? 'RECORD_SLOT_GAP' : 'DUPLICATE_RECORD_SLOT',
          path: recordPath,
          message: `Expected record slot ${expectedSlot}, found ${item.slot}`,
        });
        expectedSlot = item.slot;
      }
      expectedSlot += 1;

      let record: RunEvidenceRecord;
      try {
        const stat = fs.lstatSync(recordPath);
        if (!stat.isFile()) throw new Error('record is not a regular file');
        record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as RunEvidenceRecord;
      } catch (error) {
        result.issues.push({
          kind: 'torn',
          code: 'TORN_RECORD',
          path: recordPath,
          message: errorMessage(error),
        });
        continue;
      }

      const basicIssue = validateRecordEnvelope(record, item.slot, recordPath);
      if (basicIssue) {
        result.issues.push(basicIssue);
        continue;
      }
      if (record.record_kind === 'event') {
        if (sealed) {
          result.issues.push({
            kind: 'fork',
            code: 'EVENT_AFTER_SEAL',
            path: recordPath,
            message: 'An event record exists after the immutable seal transition',
          });
        }
        const issues = validateEventRecord(
          record,
          runId,
          result.events.length + 1,
          previousEventSha256,
          previousEventRecordSha256,
          recordPath,
        );
        result.issues.push(...issues);
        if (issues.length > 0) continue;
        if (idempotencyKeys.has(record.event.idempotency_key)) {
          result.issues.push({
            kind: 'fork',
            code: 'DUPLICATE_IDEMPOTENCY_KEY',
            path: recordPath,
            message: `Idempotency key ${record.event.idempotency_key} appears more than once`,
          });
        }
        idempotencyKeys.add(record.event.idempotency_key);
        result.events.push(record.event);
        result.eventRecords.push(record);
        previousEventSha256 = record.event.event_sha256;
        previousEventRecordSha256 = record.record_sha256;
      } else {
        if (sealed) {
          result.issues.push({
            kind: 'fork',
            code: 'DUPLICATE_SEAL',
            path: recordPath,
            message: 'More than one seal transition exists',
          });
        }
        sealed = true;
        const issues = validateSealRecord(
          record,
          runId,
          result.events.length,
          previousEventSha256,
          previousEventRecordSha256,
          recordPath,
        );
        result.issues.push(...issues);
        if (issues.length > 0) continue;
        result.seal = record.seal;
        result.sealRecord = record;
      }
    }

    if (result.events.length === 0) {
      result.issues.push({
        kind: 'protocol',
        code: 'OPEN_EVENT_MISSING',
        message: 'A run directory exists without its atomic run.opened transition',
      });
    } else if (result.events[0].type !== 'run.opened') {
      result.issues.push({
        kind: 'protocol',
        code: 'FIRST_EVENT_NOT_RUN_OPENED',
        message: 'The first run event must be run.opened',
      });
    }

    if (result.events.length > 0) {
      try {
        if (result.seal) assertRunEvidencePrefixSealable(result.events);
        else reduceRunEvidencePrefix(result.events);
      } catch (error) {
        result.issues.push({
          kind: 'protocol',
          code: 'RUN_PREFIX_SEMANTIC_INVALID',
          message: errorMessage(error),
        });
      }
    }

    if (result.events.length > 0 && previousEventRecordSha256) {
      result.head = {
        runId,
        sequence: result.events.length,
        eventSha256: previousEventSha256 as string,
        recordSha256: previousEventRecordSha256,
        sealed,
        ...(result.seal ? { sealSha256: result.seal.seal_sha256 } : {}),
      };
    }
    return result;
  }
}



function assertExpectedHead(
  runId: string,
  actual: RunEvidenceHead | null,
  expected: RunEvidenceHeadReference | null,
): void {
  const matches = actual === null
    ? expected === null
    : expected !== null
      && actual.sequence === expected.sequence
      && actual.eventSha256 === expected.eventSha256
      && actual.recordSha256 === expected.recordSha256;
  if (!matches) {
    throw new RunEvidenceLedgerError(
      'EXPECTED_HEAD_MISMATCH',
      `Expected head does not match run ${runId}`,
      {
        expected: expected
          ? {
              sequence: expected.sequence,
              eventSha256: expected.eventSha256,
              recordSha256: expected.recordSha256,
            }
          : null,
        actual: actual
          ? {
              sequence: actual.sequence,
              eventSha256: actual.eventSha256,
              recordSha256: actual.recordSha256,
            }
          : null,
      },
    );
  }
}

function requireExpectedHead(value: unknown): RunEvidenceHeadReference {
  const candidate = normalizeRunEvidenceJson(value);
  if (
    !candidate
    || typeof candidate !== 'object'
    || Array.isArray(candidate)
    || !hasExactObjectKeys(candidate, ['sequence', 'eventSha256', 'recordSha256'])
    || !Number.isSafeInteger(candidate.sequence)
    || (candidate.sequence as number) < 1
    || typeof candidate.eventSha256 !== 'string'
    || !SHA256_RE.test(candidate.eventSha256)
    || typeof candidate.recordSha256 !== 'string'
    || !SHA256_RE.test(candidate.recordSha256)
  ) {
    throw new RunEvidenceLedgerError(
      'INVALID_INPUT',
      'expectedHead must contain a positive sequence plus lowercase event and record SHA-256 hashes',
    );
  }
  return {
    sequence: candidate.sequence as number,
    eventSha256: candidate.eventSha256,
    recordSha256: candidate.recordSha256,
  };
}

function requireExpectedAnchor(value: unknown): RunEvidenceExpectedAnchor {
  const candidate = normalizeRunEvidenceJson(value);
  if (
    !candidate
    || typeof candidate !== 'object'
    || Array.isArray(candidate)
    || !hasExactObjectKeys(candidate, [
      'eventCount',
      'finalEventSha256',
      'finalRecordSha256',
      'sealSha256',
    ])
    || !Number.isSafeInteger(candidate.eventCount)
    || (candidate.eventCount as number) < 1
    || typeof candidate.finalEventSha256 !== 'string'
    || !SHA256_RE.test(candidate.finalEventSha256)
    || typeof candidate.finalRecordSha256 !== 'string'
    || !SHA256_RE.test(candidate.finalRecordSha256)
    || typeof candidate.sealSha256 !== 'string'
    || !SHA256_RE.test(candidate.sealSha256)
  ) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'Expected seal anchor is incomplete or malformed');
  }
  return {
    eventCount: candidate.eventCount as number,
    finalEventSha256: candidate.finalEventSha256,
    finalRecordSha256: candidate.finalRecordSha256,
    sealSha256: candidate.sealSha256,
  };
}

function hasExactObjectKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requireRunId(value: unknown): string {
  return requireRunEvidenceBoundedText(value, 'runId');
}

function requireIdempotencyKey(value: unknown): string {
  return requireRunEvidenceBoundedText(value, 'idempotencyKey');
}

function requireNonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} is required`);
  }
  assertRunEvidencePersistedSecretBoundary(value);
  return value;
}

function normalizeTimestamp(value: unknown, name: string): string {
  let canonical: string;
  if (typeof value === 'string') {
    if (!isCanonicalTimestamp(value)) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} must be canonical UTC with milliseconds`);
    }
    canonical = value;
  } else if (value instanceof Date && Object.getPrototypeOf(value) === Date.prototype) {
    let milliseconds: number;
    try {
      milliseconds = Date.prototype.getTime.call(value);
    } catch {
      throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} is not a valid timestamp`);
    }
    if (!Number.isFinite(milliseconds)) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} is not a valid timestamp`);
    }
    canonical = new Date(milliseconds).toISOString();
  } else {
    throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} is not a valid timestamp`);
  }
  if (!isCanonicalTimestamp(canonical)) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} must use a four-digit UTC year and seconds 00-59`);
  }
  return canonical;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-5][0-9]\.[0-9]{3}Z$/.test(value)
  ) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function requireEventType(value: unknown, allowOpen: boolean): RunEvidenceEventType {
  if (typeof value !== 'string' || !EVENT_TYPE_SET.has(value) || (!allowOpen && value === 'run.opened')) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'Run evidence type is invalid for this operation');
  }
  return value as RunEvidenceEventType;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalRunEvidenceJson(value)) as T;
}

function slotFileName(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'Record sequence must be a positive safe integer');
  }
  return `${String(sequence).padStart(20, '0')}.json`;
}

function sha256Text(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeReadDirectory(path: string): string[] {
  try {
    return fs.readdirSync(path).sort();
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return [];
    throw error;
  }
}

function ensureDurableDirectory(path: string): void {
  let existing: fs.Stats | undefined;
  try {
    existing = fs.lstatSync(path);
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
  if (existing) {
    if (existing.isSymbolicLink()) {
      throw new RunEvidenceLedgerError('LEDGER_CORRUPT', `Evidence directory path is a symbolic link: ${path}`);
    }
    if (!existing.isDirectory()) {
      throw new RunEvidenceLedgerError('LEDGER_CORRUPT', `Evidence directory path is not a directory: ${path}`);
    }
    return;
  }
  const parent = nodePath.dirname(path);
  if (parent !== path) ensureDurableDirectory(parent);
  try {
    fs.mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, 'EEXIST')) throw error;
  }
  const created = fs.lstatSync(path);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new RunEvidenceLedgerError('LEDGER_CORRUPT', `Evidence directory was replaced during creation: ${path}`);
  }
  fsyncDirectory(path);
  if (parent !== path) fsyncDirectory(parent);
}

function assertEvidencePathHasNoSymlink(path: string): void {
  const symbolicLink = firstSymbolicLink([path]);
  if (symbolicLink) {
    throw new RunEvidenceLedgerError(
      'LEDGER_CORRUPT',
      `Run evidence trust boundary contains a symbolic link: ${symbolicLink}`,
    );
  }
}

function firstSymbolicLink(paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const resolved = nodePath.resolve(path);
    const parsed = nodePath.parse(resolved);
    let current = parsed.root;
    const components = resolved.slice(parsed.root.length).split(nodePath.sep).filter(Boolean);
    for (const component of components) {
      current = nodePath.join(current, component);
      try {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) return current;
        if (!stat.isDirectory() && current !== resolved) break;
      } catch (error) {
        if (isNodeError(error, 'ENOENT') || isNodeError(error, 'ENOTDIR')) break;
        throw error;
      }
    }
  }
  return undefined;
}

function fsyncDirectory(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(path, 'r');
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === code);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error, 'EPERM');
  }
}

function processStartToken(pid: number): string {
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const closingParen = stat.lastIndexOf(')');
      const fieldsFromState = stat.slice(closingParen + 2).trim().split(/\s+/);
      const startTicks = fieldsFromState[19];
      if (closingParen > 0 && startTicks) return sha256Text(`${pid}:${startTicks}`).slice(0, 16);
    } catch {
      // The process may have exited between kill(0) and reading /proc.
    }
  }
  const ownStartEpoch = pid === process.pid
    ? Math.floor(Date.now() / 1000 - process.uptime())
    : 0;
  return sha256Text(`${pid}:${ownStartEpoch}`).slice(0, 16);
}

function isWriterActive(pid: number, startToken: string): boolean {
  if (!isProcessAlive(pid)) return false;
  if (pid === process.pid) return startToken === PROCESS_START_TOKEN;
  if (process.platform === 'linux') return startToken === processStartToken(pid);
  // Non-Linux Node does not expose a foreign process start time. This fallback
  // preserves cross-process CAS; the integrity scope remains local diagnostics.
  return true;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function issue(
  kind: RunEvidenceIssueKind,
  code: string,
  path: string,
  message: string,
): RunEvidenceVerificationIssue {
  return { kind, code, path, message };
}

function findEventByIdempotency(events: readonly RunEvidenceEvent[], key: string): RunEvidenceEvent | undefined {
  return events.find(event => event.idempotency_key === key);
}

function isOnlyMissingOpenEvent(inspection: RunInspection): boolean {
  return inspection.events.length === 0
    && inspection.issues.length === 1
    && inspection.issues[0].code === 'OPEN_EVENT_MISSING';
}

function corruptLedger(runId: string, issues: readonly RunEvidenceVerificationIssue[]): RunEvidenceLedgerError {
  return new RunEvidenceLedgerError(
    'LEDGER_CORRUPT',
    `Run ${runId} failed closed with ${issues.length} evidence issue(s)`,
    { issueCodes: issues.map(item => item.code) },
  );
}
