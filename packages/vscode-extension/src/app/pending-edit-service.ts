export interface PendingEditRecordLike {
  id: string;
  path: string;
  createdAt: number;
}

export class PendingEditService<T extends PendingEditRecordLike> {
  private readonly records = new Map<string, T>();

  get(id: string): T | undefined {
    return this.records.get(id);
  }

  set(id: string, record: T): void {
    this.records.set(id, record);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  delete(id: string): boolean {
    return this.records.delete(id);
  }

  clear(): void {
    this.records.clear();
  }

  values(): IterableIterator<T> {
    return this.records.values();
  }

  findLatestByPath(path: string, normalize: (path: string) => string = p => p): T | undefined {
    const target = normalize(path);
    return Array.from(this.records.values())
      .filter(record => normalize(record.path) === target)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }
}
