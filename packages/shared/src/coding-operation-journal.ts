import * as fs from 'fs';
import * as nodePath from 'path';

import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
} from './coding-contract-utils';
import { codingSemanticDigest } from './coding-semantic-digest';

export const CODING_OPERATION_JOURNAL_VERSION = 'devseek.coding-operation-journal/v1' as const;
export const CODING_OPERATION_JOURNAL_DIRECTORY = nodePath.join('.devseek', 'coding-operations', 'v1');

export type CodingOperationKind = 'tool-execution' | 'workspace-mutation' | 'external-effect';

export interface CodingOperationPreparation<TPreparation = unknown> {
  readonly kind: CodingOperationKind;
  readonly runId: string;
  readonly actionId: string;
  readonly operationSha256: string;
  readonly preparation: TPreparation;
}

interface CodingOperationRecordBase<TPreparation> extends CodingOperationPreparation<TPreparation> {
  readonly version: typeof CODING_OPERATION_JOURNAL_VERSION;
  readonly state: 'prepared' | 'settled';
  readonly recordSha256: string;
}

export interface CodingOperationPreparedRecord<TPreparation = unknown>
  extends CodingOperationRecordBase<TPreparation> {
  readonly state: 'prepared';
}

export interface CodingOperationSettledRecord<TPreparation = unknown, TReceipt = unknown>
  extends CodingOperationRecordBase<TPreparation> {
  readonly state: 'settled';
  readonly receipt: TReceipt;
}

export type CodingOperationJournalRecord<TPreparation = unknown, TReceipt = unknown> =
  | CodingOperationPreparedRecord<TPreparation>
  | CodingOperationSettledRecord<TPreparation, TReceipt>;

export interface CodingOperationJournalPort {
  load<TPreparation = unknown, TReceipt = unknown>(
    kind: CodingOperationKind,
    runId: string,
    actionId: string,
  ): Promise<CodingOperationJournalRecord<TPreparation, TReceipt> | undefined>;
  prepare<TPreparation>(input: CodingOperationPreparation<TPreparation>): Promise<void>;
  settle<TPreparation, TReceipt>(
    input: CodingOperationPreparation<TPreparation> & { readonly receipt: TReceipt },
  ): Promise<void>;
}

/** Immutable in-memory adapter used by contract tests and embedded callers. */
export class InMemoryCodingOperationJournal implements CodingOperationJournalPort {
  private readonly prepared = new Map<string, CodingOperationPreparedRecord>();
  private readonly settled = new Map<string, CodingOperationSettledRecord>();

  async load<TPreparation = unknown, TReceipt = unknown>(
    kind: CodingOperationKind,
    runId: string,
    actionId: string,
  ): Promise<CodingOperationJournalRecord<TPreparation, TReceipt> | undefined> {
    const identity = operationIdentity(kind, runId, actionId);
    const record = this.settled.get(identity) ?? this.prepared.get(identity);
    return record
      ? snapshotRecord(record, { kind, runId, actionId }) as CodingOperationJournalRecord<TPreparation, TReceipt>
      : undefined;
  }

  async prepare<TPreparation>(input: CodingOperationPreparation<TPreparation>): Promise<void> {
    const record = createPreparedRecord(input);
    const identity = operationIdentity(record.kind, record.runId, record.actionId);
    const existing = this.settled.get(identity) ?? this.prepared.get(identity);
    if (existing) {
      assertSamePreparation(existing, record);
      return;
    }
    this.prepared.set(identity, record as CodingOperationPreparedRecord);
  }

  async settle<TPreparation, TReceipt>(
    input: CodingOperationPreparation<TPreparation> & { readonly receipt: TReceipt },
  ): Promise<void> {
    const prepared = createPreparedRecord(input);
    const identity = operationIdentity(prepared.kind, prepared.runId, prepared.actionId);
    const existingPreparation = this.prepared.get(identity);
    if (!existingPreparation) throw operationJournalFailure('settlement-without-preparation');
    assertSamePreparation(existingPreparation, prepared);
    const record = createSettledRecord(input);
    const existing = this.settled.get(identity);
    if (existing) {
      assertSameRecord(existing, record);
      return;
    }
    this.settled.set(identity, record as CodingOperationSettledRecord);
  }
}

/** Process-independent immutable store shared by the VS Code, CLI, and Headless Surfaces. */
export class FileSystemCodingOperationJournal implements CodingOperationJournalPort {
  private readonly workspaceRoot: string;
  private readonly rootDir: string;

  constructor(input: { readonly workspaceRoot: string }) {
    const workspaceRoot = normalizedCodingId(input?.workspaceRoot, 'workspace-root');
    const resolvedRoot = nodePath.resolve(workspaceRoot);
    let canonicalRoot: string;
    try {
      canonicalRoot = fs.realpathSync.native(resolvedRoot);
    } catch {
      throw operationJournalFailure('workspace-root-unavailable');
    }
    if (!fs.statSync(canonicalRoot).isDirectory()) {
      throw operationJournalFailure('workspace-root-not-directory');
    }
    this.workspaceRoot = canonicalRoot;
    this.rootDir = nodePath.join(canonicalRoot, CODING_OPERATION_JOURNAL_DIRECTORY);
  }

  static forWorkspace(workspaceRoot: string): FileSystemCodingOperationJournal {
    return new FileSystemCodingOperationJournal({ workspaceRoot });
  }

  async load<TPreparation = unknown, TReceipt = unknown>(
    kind: CodingOperationKind,
    runId: string,
    actionId: string,
  ): Promise<CodingOperationJournalRecord<TPreparation, TReceipt> | undefined> {
    const identity = snapshotIdentity({ kind, runId, actionId });
    if (!ensureSecureJournalDirectory(this.workspaceRoot, false)) return undefined;
    const paths = this.recordPaths(identity);
    if (pathEntryExists(paths.settled)) {
      const settled = readRecord(paths.settled, identity);
      if (settled.state !== 'settled') throw operationJournalFailure('invalid-settled-state');
      const prepared = readRecord(paths.prepared, identity);
      if (prepared.state !== 'prepared') throw operationJournalFailure('invalid-prepared-state');
      assertSamePreparation(prepared, settled);
      return settled as CodingOperationJournalRecord<TPreparation, TReceipt>;
    }
    if (!pathEntryExists(paths.prepared)) return undefined;
    const prepared = readRecord(paths.prepared, identity);
    if (prepared.state !== 'prepared') throw operationJournalFailure('invalid-prepared-state');
    return prepared as CodingOperationJournalRecord<TPreparation, TReceipt>;
  }

  async prepare<TPreparation>(input: CodingOperationPreparation<TPreparation>): Promise<void> {
    const record = createPreparedRecord(input);
    ensureSecureJournalDirectory(this.workspaceRoot, true);
    const paths = this.recordPaths(record);
    writeImmutableRecord(paths.prepared, record);
  }

  async settle<TPreparation, TReceipt>(
    input: CodingOperationPreparation<TPreparation> & { readonly receipt: TReceipt },
  ): Promise<void> {
    const prepared = createPreparedRecord(input);
    ensureSecureJournalDirectory(this.workspaceRoot, true);
    const paths = this.recordPaths(prepared);
    if (!pathEntryExists(paths.prepared)) throw operationJournalFailure('settlement-without-preparation');
    assertSamePreparation(readRecord(paths.prepared, prepared), prepared);
    writeImmutableRecord(paths.settled, createSettledRecord(input));
  }

  private recordPaths(input: Pick<CodingOperationPreparation, 'kind' | 'runId' | 'actionId'>): {
    readonly prepared: string;
    readonly settled: string;
  } {
    const digest = codingSemanticDigest({
      protocol: CODING_OPERATION_JOURNAL_VERSION,
      kind: input.kind,
      runId: input.runId,
      actionId: input.actionId,
    });
    return {
      prepared: nodePath.join(this.rootDir, `${digest}.prepared.json`),
      settled: nodePath.join(this.rootDir, `${digest}.settled.json`),
    };
  }
}

function createPreparedRecord<TPreparation>(
  input: CodingOperationPreparation<TPreparation>,
): CodingOperationPreparedRecord<TPreparation> {
  const preparation = snapshotPreparation(input);
  return freezeRecord({
    version: CODING_OPERATION_JOURNAL_VERSION,
    state: 'prepared',
    ...preparation,
    recordSha256: codingSemanticDigest({
      version: CODING_OPERATION_JOURNAL_VERSION,
      state: 'prepared',
      ...preparation,
    }),
  }) as CodingOperationPreparedRecord<TPreparation>;
}

function createSettledRecord<TPreparation, TReceipt>(
  input: CodingOperationPreparation<TPreparation> & { readonly receipt: TReceipt },
): CodingOperationSettledRecord<TPreparation, TReceipt> {
  const preparation = snapshotPreparation(input);
  const receipt = snapshotCodingValue(input.receipt, 'operation-receipt') as TReceipt;
  const payload = {
    version: CODING_OPERATION_JOURNAL_VERSION,
    state: 'settled' as const,
    ...preparation,
    receipt,
  };
  return freezeRecord({ ...payload, recordSha256: codingSemanticDigest(payload) }) as
    CodingOperationSettledRecord<TPreparation, TReceipt>;
}

function snapshotRecord(
  value: unknown,
  expected?: Pick<CodingOperationPreparation, 'kind' | 'runId' | 'actionId'>,
): CodingOperationJournalRecord {
  if (!value || typeof value !== 'object') throw operationJournalFailure('invalid-record');
  const candidate = value as Partial<CodingOperationJournalRecord>;
  if (candidate.version !== CODING_OPERATION_JOURNAL_VERSION) {
    throw operationJournalFailure('unsupported-version');
  }
  const state = candidate.state;
  if (state !== 'prepared' && state !== 'settled') throw operationJournalFailure('invalid-state');
  const preparation = snapshotPreparation(candidate as CodingOperationPreparation);
  const payload = state === 'settled'
    ? {
        version: CODING_OPERATION_JOURNAL_VERSION,
        state,
        ...preparation,
        receipt: snapshotCodingValue((candidate as CodingOperationSettledRecord).receipt, 'operation-receipt'),
      }
    : { version: CODING_OPERATION_JOURNAL_VERSION, state, ...preparation };
  if (candidate.recordSha256 !== codingSemanticDigest(payload)) {
    throw operationJournalFailure('record-sha256-mismatch');
  }
  if (expected) {
    const identity = snapshotIdentity(expected);
    if (preparation.kind !== identity.kind
      || preparation.runId !== identity.runId
      || preparation.actionId !== identity.actionId) {
      throw operationJournalFailure('record-identity-mismatch');
    }
  }
  return freezeRecord({ ...payload, recordSha256: candidate.recordSha256 });
}

function snapshotPreparation<TPreparation>(
  input: CodingOperationPreparation<TPreparation>,
): CodingOperationPreparation<TPreparation> {
  const identity = snapshotIdentity(input);
  const operationSha256 = requireSha256(input.operationSha256);
  const preparation = snapshotCodingValue(input.preparation, 'operation-preparation') as TPreparation;
  if (preparation === undefined) throw operationJournalFailure('missing-preparation');
  return freezeRecord({ ...identity, operationSha256, preparation });
}

function snapshotIdentity(
  input: Pick<CodingOperationPreparation, 'kind' | 'runId' | 'actionId'>,
): Pick<CodingOperationPreparation, 'kind' | 'runId' | 'actionId'> {
  if (!input || !['tool-execution', 'workspace-mutation', 'external-effect'].includes(input.kind)) {
    throw operationJournalFailure('invalid-kind');
  }
  return Object.freeze({
    kind: input.kind,
    runId: normalizedCodingId(input.runId, 'operation-run-id'),
    actionId: normalizedCodingId(input.actionId, 'operation-action-id'),
  });
}

function readRecord(
  filePath: string,
  expected: Pick<CodingOperationPreparation, 'kind' | 'runId' | 'actionId'>,
): CodingOperationJournalRecord {
  if (!pathEntryExists(filePath)) throw operationJournalFailure('record-file-missing');
  let descriptor: number | undefined;
  try {
    const entry = fs.lstatSync(filePath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw operationJournalFailure('record-not-regular-file');
    }
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    if (!fs.fstatSync(descriptor).isFile()) throw operationJournalFailure('record-not-regular-file');
    return snapshotRecord(JSON.parse(fs.readFileSync(descriptor, 'utf8')), expected);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('coding-operation-journal:')) throw error;
    throw operationJournalFailure('record-file-invalid');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeImmutableRecord(filePath: string, record: CodingOperationJournalRecord): void {
  const serialized = `${canonicalCodingJson(record)}\n`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fs.writeFileSync(descriptor, serialized, { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
    const existing = readRecord(filePath, record);
    assertSameRecord(existing, record);
    return;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  fsyncDirectory(nodePath.dirname(filePath));
}

function ensureSecureJournalDirectory(workspaceRoot: string, create: boolean): boolean {
  let current = workspaceRoot;
  for (const segment of CODING_OPERATION_JOURNAL_DIRECTORY.split(nodePath.sep)) {
    const next = nodePath.join(current, segment);
    let entry: fs.Stats;
    try {
      entry = fs.lstatSync(next);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw operationJournalFailure('journal-directory-unavailable');
      if (!create) return false;
      try {
        fs.mkdirSync(next, { mode: 0o700 });
        fsyncDirectory(current);
      } catch (mkdirError) {
        if (errorCode(mkdirError) !== 'EEXIST') {
          throw operationJournalFailure('journal-directory-create-failed');
        }
      }
      entry = fs.lstatSync(next);
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw operationJournalFailure('unsafe-journal-directory');
    }
    if (fs.realpathSync.native(next) !== nodePath.resolve(next)) {
      throw operationJournalFailure('unsafe-journal-directory');
    }
    current = next;
  }
  return true;
}

function pathEntryExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw operationJournalFailure('record-file-unavailable');
  }
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (process.platform === 'win32'
      && ['EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(errorCode(error))) {
      return;
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertSamePreparation(
  existing: CodingOperationJournalRecord,
  candidate: CodingOperationJournalRecord,
): void {
  const left = {
    kind: existing.kind,
    runId: existing.runId,
    actionId: existing.actionId,
    operationSha256: existing.operationSha256,
    preparation: existing.preparation,
  };
  const right = {
    kind: candidate.kind,
    runId: candidate.runId,
    actionId: candidate.actionId,
    operationSha256: candidate.operationSha256,
    preparation: candidate.preparation,
  };
  if (canonicalCodingJson(left) !== canonicalCodingJson(right)) {
    throw operationJournalFailure('conflicting-operation-identity');
  }
}

function assertSameRecord(existing: CodingOperationJournalRecord, candidate: CodingOperationJournalRecord): void {
  if (canonicalCodingJson(existing) !== canonicalCodingJson(candidate)) {
    throw operationJournalFailure('conflicting-operation-record');
  }
}

function operationIdentity(kind: CodingOperationKind, runId: string, actionId: string): string {
  const identity = snapshotIdentity({ kind, runId, actionId });
  return `${identity.kind}\u0000${identity.runId}\u0000${identity.actionId}`;
}

function requireSha256(value: unknown): string {
  const digest = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw operationJournalFailure('invalid-operation-sha256');
  return digest;
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}

function freezeRecord<T>(value: T): T {
  return snapshotCodingValue(value, 'operation-record') as T;
}

function operationJournalFailure(reason: string): Error {
  return new Error(`coding-operation-journal:${reason}`);
}
