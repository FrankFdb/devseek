import * as fs from 'fs';
import * as nodePath from 'path';
import {
  resolveRepositoryMemoryLocation,
  type RepositoryMemoryLocation,
  type RepositoryMemoryLocationOptions,
} from './repository-memory-location';
import type { MemoryLifecycleReceipt, MemoryRecord } from './types';

export const MEMORY_STORE_VERSION = 3 as const;
const LOCK_STALE_MS = 60_000;

export interface MemoryStoreDocument {
  version: typeof MEMORY_STORE_VERSION;
  revision: number;
  repositoryId: string;
  records: MemoryRecord[];
  lifecycleReceipts: MemoryLifecycleReceipt[];
}

export interface MemoryStoreOptions extends RepositoryMemoryLocationOptions {
  location?: RepositoryMemoryLocation;
}

export class MemoryStore {
  readonly location: RepositoryMemoryLocation;

  constructor(workspaceRoot: string, options: MemoryStoreOptions = {}) {
    this.location = options.location
      ?? resolveRepositoryMemoryLocation(workspaceRoot, { memoryHome: options.memoryHome });
  }

  getStructuredMemoryPath(): string {
    return this.location.statePath;
  }

  getLegacyMemoryPath(): string {
    return this.location.legacyMarkdownPath;
  }

  getMemoryRoot(): string {
    return this.location.memoryRoot;
  }

  getSummaryPath(): string {
    return this.location.summaryPath;
  }

  getIndexPath(): string {
    return this.location.indexPath;
  }

  getRolloutsRoot(): string {
    return this.location.rolloutsRoot;
  }

  readAll(): MemoryRecord[] {
    return this.readDocument().records;
  }

  readSnapshot(): MemoryStoreDocument {
    return this.readDocument();
  }

  commit(records: MemoryRecord[], receipts: readonly MemoryLifecycleReceipt[] = []): void {
    this.withLock(() => {
      const document = this.readDocument();
      this.writeDocument({
        version: MEMORY_STORE_VERSION,
        revision: document.revision + 1,
        repositoryId: this.location.repositoryId,
        records,
        lifecycleReceipts: [...document.lifecycleReceipts, ...receipts],
      });
    });
  }

  update(
    mutate: (document: Readonly<MemoryStoreDocument>) => Pick<MemoryStoreDocument, 'records' | 'lifecycleReceipts'>,
  ): MemoryStoreDocument {
    return this.withLock(() => {
      const current = this.readDocument();
      const next = mutate(current);
      const committed: MemoryStoreDocument = {
        version: MEMORY_STORE_VERSION,
        revision: current.revision + 1,
        repositoryId: this.location.repositoryId,
        records: this.normalizeRecords([...next.records]),
        lifecycleReceipts: this.normalizeLifecycleReceipts([...next.lifecycleReceipts]),
      };
      this.writeDocument(committed);
      return committed;
    });
  }

  readLifecycleReceipts(): MemoryLifecycleReceipt[] {
    return this.readDocument().lifecycleReceipts;
  }

  ensureSummaryFile(): string {
    const filePath = this.getSummaryPath();
    fs.mkdirSync(nodePath.dirname(filePath), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        '# DevSeek Memory Summary\n\nNo consolidated memory is available yet.\n',
        { encoding: 'utf8', mode: 0o600 },
      );
    }
    return filePath;
  }

  /** Compatibility alias for the existing command surface. */
  ensureLegacyMarkdownFile(): string {
    return this.ensureSummaryFile();
  }

  private readDocument(): MemoryStoreDocument {
    const filePath = this.getStructuredMemoryPath();
    if (!fs.existsSync(filePath)) return this.readLegacyDocument();
    rejectSymbolicLink(filePath);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<MemoryStoreDocument> | MemoryRecord[];
      if (Array.isArray(parsed)) return this.emptyDocument(this.normalizeRecords(parsed));
      return {
        version: MEMORY_STORE_VERSION,
        revision: normalizeRevision(parsed.revision),
        repositoryId: this.location.repositoryId,
        records: this.normalizeRecords(Array.isArray(parsed.records) ? parsed.records : []),
        lifecycleReceipts: this.normalizeLifecycleReceipts(parsed.lifecycleReceipts),
      };
    } catch (error) {
      throw memoryDocumentFailure(filePath, error);
    }
  }

  private readLegacyDocument(): MemoryStoreDocument {
    const legacyPath = this.location.legacyStructuredPath;
    if (!fs.existsSync(legacyPath)) return this.emptyDocument();
    try {
      const parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf8')) as { records?: MemoryRecord[] } | MemoryRecord[];
      const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.records) ? parsed.records : [];
      return this.emptyDocument(this.normalizeRecords(records).map(record => ({
        ...record,
        repositoryId: this.location.repositoryId,
        source: { kind: 'legacy-import' as const, ref: legacyPath },
        provenance: {
          ...record.provenance,
          sourceKind: 'legacy-import' as const,
          sourceRef: legacyPath,
          externalContent: true,
          trusted: false,
          approvalState: 'required' as const,
        },
      })));
    } catch {
      return this.emptyDocument();
    }
  }

  private emptyDocument(records: MemoryRecord[] = []): MemoryStoreDocument {
    return {
      version: MEMORY_STORE_VERSION,
      revision: 0,
      repositoryId: this.location.repositoryId,
      records,
      lifecycleReceipts: [],
    };
  }

  private writeDocument(document: MemoryStoreDocument): void {
    const filePath = this.getStructuredMemoryPath();
    fs.mkdirSync(nodePath.dirname(filePath), { recursive: true, mode: 0o700 });
    if (fs.existsSync(filePath)) rejectSymbolicLink(filePath);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(tempPath, filePath);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  private withLock<T>(operation: () => T): T {
    fs.mkdirSync(this.location.memoryRoot, { recursive: true, mode: 0o700 });
    const lockPath = `${this.getStructuredMemoryPath()}.lock`;
    removeStaleLock(lockPath);
    let fd: number;
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw new Error('memory-store:locked');
      throw error;
    }
    try {
      fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, 'utf8');
      return operation();
    } finally {
      fs.closeSync(fd);
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // A stale-lock recovery in another process must not mask the operation result.
      }
    }
  }

  private normalizeRecords(records: MemoryRecord[]): MemoryRecord[] {
    return records
      .filter(record => Boolean(record?.id && record.content && record.status))
      .map(record => ({
        ...record,
        repositoryId: record.repositoryId || this.location.repositoryId,
      }));
  }

  private normalizeLifecycleReceipts(receipts: unknown): MemoryLifecycleReceipt[] {
    if (!Array.isArray(receipts)) return [];
    return receipts.filter((receipt): receipt is MemoryLifecycleReceipt => {
      const candidate = receipt as Partial<MemoryLifecycleReceipt>;
      return Boolean(candidate?.id && candidate.action && candidate.recordId && candidate.reason && candidate.at);
    });
  }
}

function normalizeRevision(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function rejectSymbolicLink(path: string): void {
  if (fs.lstatSync(path).isSymbolicLink()) throw new Error(`memory-store:symlink-rejected:${path}`);
}

function removeStaleLock(lockPath: string): void {
  try {
    const stat = fs.lstatSync(lockPath);
    if (stat.isSymbolicLink()) throw new Error(`memory-store:symlink-rejected:${lockPath}`);
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function memoryDocumentFailure(path: string, cause: unknown): Error {
  const failure = new Error(`memory-store:invalid-document:${path}`) as Error & { cause?: unknown };
  failure.cause = cause;
  return failure;
}
