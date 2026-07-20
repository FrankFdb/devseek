export interface PendingEditRecordLike {
  id: string;
  path: string;
  createdAt: number;
  oldContent?: string;
  hunks?: PendingEditHunk[];
}

export type PendingEditHunkResolution = 'pending' | 'kept' | 'undone';
export type PendingEditFinalHunkResolution = Exclude<PendingEditHunkResolution, 'pending'>;

export interface PendingEditHunk {
  id: string;
  index: number;
  title: string;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  oldLines: string[];
  newLines: string[];
  resolution: PendingEditHunkResolution;
}

export interface PendingEditHunkResolutionSummary {
  id: string;
  index: number;
  title: string;
  resolution: PendingEditHunkResolution;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  oldLineCount: number;
  newLineCount: number;
}

interface DiffOp {
  type: 'equal' | 'add' | 'del';
  text: string;
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

  get size(): number {
    return this.records.size;
  }

  resetForNewScope(): T[] {
    const stale = Array.from(this.records.values()).sort((a, b) => a.createdAt - b.createdAt);
    this.records.clear();
    return stale;
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

export function computePendingHunks(recordId: string, oldContent: string, newContent: string): PendingEditHunk[] {
  const oldLines = (oldContent || '').split('\n');
  const newLines = (newContent || '').split('\n');
  const ops = lcsDiffOps(oldLines, newLines);
  const hunks: PendingEditHunk[] = [];

  let oldLine = 1;
  let newLine = 1;
  let idx = 0;

  while (idx < ops.length) {
    const op = ops[idx];
    if (op.type === 'equal') {
      oldLine += 1;
      newLine += 1;
      idx += 1;
      continue;
    }

    const oldStart = oldLine;
    const newStart = newLine;
    const oldSeg: string[] = [];
    const newSeg: string[] = [];

    while (idx < ops.length && ops[idx].type !== 'equal') {
      if (ops[idx].type === 'del') {
        oldSeg.push(ops[idx].text);
        oldLine += 1;
      } else {
        newSeg.push(ops[idx].text);
        newLine += 1;
      }
      idx += 1;
    }

    const hunkIndex = hunks.length + 1;
    hunks.push({
      id: `${recordId}-h${hunkIndex}`,
      index: hunkIndex,
      title: `修改点 ${hunkIndex}`,
      oldStart,
      oldEnd: oldLine,
      newStart,
      newEnd: newLine,
      oldLines: oldSeg,
      newLines: newSeg,
      resolution: 'pending',
    });
  }

  return hunks;
}

export function renderPendingContentFromHunks(record: Pick<PendingEditRecordLike, 'oldContent' | 'hunks'>): string {
  const oldLines = (record.oldContent || '').split('\n');
  const sorted = [...(record.hunks ?? [])].sort((a, b) => a.oldStart - b.oldStart || a.index - b.index);
  const out: string[] = [];
  let cursor = 1;

  for (const hunk of sorted) {
    out.push(...oldLines.slice(Math.max(0, cursor - 1), Math.max(0, hunk.oldStart - 1)));
    if (hunk.resolution === 'undone') out.push(...hunk.oldLines);
    else out.push(...hunk.newLines);
    cursor = hunk.oldEnd;
  }

  out.push(...oldLines.slice(Math.max(0, cursor - 1)));
  return out.join('\n');
}

export function allHunksResolved(record: Pick<PendingEditRecordLike, 'hunks'>): boolean {
  return (record.hunks?.length ?? 0) > 0 && (record.hunks ?? []).every((hunk) => hunk.resolution !== 'pending');
}

export function summarizePendingEditHunkResolution(
  hunk: PendingEditHunk,
  pendingResolution?: PendingEditFinalHunkResolution,
  resolutionOverride?: PendingEditFinalHunkResolution,
): PendingEditHunkResolutionSummary {
  return {
    id: hunk.id,
    index: hunk.index,
    title: hunk.title,
    resolution: resolutionOverride ?? (hunk.resolution === 'pending' && pendingResolution ? pendingResolution : hunk.resolution),
    oldStart: hunk.oldStart,
    oldEnd: hunk.oldEnd,
    newStart: hunk.newStart,
    newEnd: hunk.newEnd,
    oldLineCount: hunk.oldLines.length,
    newLineCount: hunk.newLines.length,
  };
}

export function summarizePendingEditHunkResolutions(
  record: Pick<PendingEditRecordLike, 'hunks'>,
  pendingResolution?: PendingEditFinalHunkResolution,
  resolutionOverride?: PendingEditFinalHunkResolution,
): PendingEditHunkResolutionSummary[] {
  return [...(record.hunks ?? [])]
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
    .map((hunk) => summarizePendingEditHunkResolution(hunk, pendingResolution, resolutionOverride));
}

function lcsDiffOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const reversed: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ type: 'equal', text: oldLines[i - 1] });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      reversed.push({ type: 'del', text: oldLines[i - 1] });
      i -= 1;
    } else {
      reversed.push({ type: 'add', text: newLines[j - 1] });
      j -= 1;
    }
  }

  while (i > 0) {
    reversed.push({ type: 'del', text: oldLines[i - 1] });
    i -= 1;
  }
  while (j > 0) {
    reversed.push({ type: 'add', text: newLines[j - 1] });
    j -= 1;
  }

  return reversed.reverse();
}
