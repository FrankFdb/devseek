import * as fs from 'fs';
import * as nodePath from 'path';
import type { MemoryLifecycleReceipt, MemoryRecord } from './types';

export const STRUCTURED_MEMORY_REL_PATH = '.devseek/memory.json';
export const LEGACY_MEMORY_REL_PATH = '.devseek/memory.md';

export interface MemoryStoreDocument {
  version: 1;
  records: MemoryRecord[];
  lifecycleReceipts: MemoryLifecycleReceipt[];
}

export class MemoryStore {
  constructor(private readonly workspaceRoot: string) {}

  getStructuredMemoryPath(): string {
    return nodePath.join(this.workspaceRoot, STRUCTURED_MEMORY_REL_PATH);
  }

  getLegacyMemoryPath(): string {
    return nodePath.join(this.workspaceRoot, LEGACY_MEMORY_REL_PATH);
  }

  readAll(): MemoryRecord[] {
    return this.readDocument().records;
  }

  writeAll(records: MemoryRecord[]): void {
    const document = this.readDocument();
    this.writeDocument({
      version: 1,
      records,
      lifecycleReceipts: document.lifecycleReceipts,
    });
  }

  readLifecycleReceipts(): MemoryLifecycleReceipt[] {
    return this.readDocument().lifecycleReceipts;
  }

  appendLifecycleReceipt(receipt: MemoryLifecycleReceipt): MemoryLifecycleReceipt {
    const document = this.readDocument();
    document.lifecycleReceipts.push(receipt);
    this.writeDocument(document);
    return receipt;
  }

  private readDocument(): MemoryStoreDocument {
    const filePath = this.getStructuredMemoryPath();
    if (!fs.existsSync(filePath)) {
      return { version: 1, records: [], lifecycleReceipts: [] };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<MemoryStoreDocument> | MemoryRecord[];
      if (Array.isArray(parsed)) {
        return { version: 1, records: this.normalizeRecords(parsed), lifecycleReceipts: [] };
      }
      return {
        version: 1,
        records: this.normalizeRecords(Array.isArray(parsed.records) ? parsed.records : []),
        lifecycleReceipts: this.normalizeLifecycleReceipts(parsed.lifecycleReceipts),
      };
    } catch {
      return { version: 1, records: [], lifecycleReceipts: [] };
    }
  }

  private writeDocument(document: MemoryStoreDocument): void {
    const filePath = this.getStructuredMemoryPath();
    fs.mkdirSync(nodePath.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }

  readLegacyMarkdown(maxChars = 3000): string | null {
    const filePath = this.getLegacyMemoryPath();
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      return content.slice(0, maxChars) || null;
    } catch {
      return null;
    }
  }

  ensureLegacyMarkdownFile(): string {
    const filePath = this.getLegacyMemoryPath();
    fs.mkdirSync(nodePath.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        '# DevSeek Agent Memory\n\n<!-- Legacy memory import file. New agent memories are stored in memory.json. -->\n',
        'utf8',
      );
    }
    return filePath;
  }

  private normalizeRecords(records: MemoryRecord[]): MemoryRecord[] {
    return records.filter((record) => Boolean(record?.id && record.content && record.status));
  }

  private normalizeLifecycleReceipts(receipts: unknown): MemoryLifecycleReceipt[] {
    if (!Array.isArray(receipts)) return [];
    return receipts.filter((receipt): receipt is MemoryLifecycleReceipt => {
      const candidate = receipt as Partial<MemoryLifecycleReceipt>;
      return Boolean(candidate?.id && candidate.action && candidate.recordId && candidate.reason && candidate.at);
    });
  }
}
