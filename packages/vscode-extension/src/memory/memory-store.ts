import * as fs from 'fs';
import * as nodePath from 'path';
import type { MemoryRecord } from './types';

export const STRUCTURED_MEMORY_REL_PATH = '.devseek/memory.json';
export const LEGACY_MEMORY_REL_PATH = '.devseek/memory.md';

interface MemoryStoreDocument {
  version: 1;
  records: MemoryRecord[];
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
    const filePath = this.getStructuredMemoryPath();
    if (!fs.existsSync(filePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<MemoryStoreDocument> | MemoryRecord[];
      if (Array.isArray(parsed)) return this.normalizeRecords(parsed);
      return this.normalizeRecords(Array.isArray(parsed.records) ? parsed.records : []);
    } catch {
      return [];
    }
  }

  writeAll(records: MemoryRecord[]): void {
    const filePath = this.getStructuredMemoryPath();
    fs.mkdirSync(nodePath.dirname(filePath), { recursive: true });
    const payload: MemoryStoreDocument = { version: 1, records };
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  append(record: MemoryRecord): MemoryRecord {
    const records = this.readAll();
    records.push(record);
    this.writeAll(records);
    return record;
  }

  disable(id: string): boolean {
    const records = this.readAll();
    let changed = false;
    const now = Date.now();
    for (const record of records) {
      if (record.id !== id || record.status === 'disabled') continue;
      record.status = 'disabled';
      record.updatedAt = now;
      changed = true;
    }
    if (changed) this.writeAll(records);
    return changed;
  }

  delete(id: string): boolean {
    const records = this.readAll();
    const next = records.filter((record) => record.id !== id);
    if (next.length === records.length) return false;
    this.writeAll(next);
    return true;
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
}
