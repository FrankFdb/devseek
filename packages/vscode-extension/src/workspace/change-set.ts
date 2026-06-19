export type WorkspaceChangeKind = 'create' | 'overwrite' | 'patch';

export interface WorkspaceChangeInput {
  path: string;
  existed?: boolean;
  oldContent?: string;
  newContent?: string;
  actionType?: string;
}

export interface WorkspaceChangeRecord {
  path: string;
  kind: WorkspaceChangeKind;
  existed: boolean;
  oldContent: string;
  newContent: string;
  addedLines: number;
  removedLines: number;
}

export interface ChangeSetSummary {
  total: number;
  creates: number;
  overwrites: number;
  patches: number;
  changedPaths: string[];
}

export class ChangeSet {
  constructor(readonly changes: WorkspaceChangeRecord[]) {}

  get changedPaths(): string[] {
    return this.changes.map(change => change.path);
  }

  summary(): ChangeSetSummary {
    return this.changes.reduce<ChangeSetSummary>((summary, change) => {
      summary.total += 1;
      summary.changedPaths.push(change.path);
      if (change.kind === 'create') summary.creates += 1;
      else if (change.kind === 'patch') summary.patches += 1;
      else summary.overwrites += 1;
      return summary;
    }, { total: 0, creates: 0, overwrites: 0, patches: 0, changedPaths: [] });
  }
}

export function createChangeSet(inputs: WorkspaceChangeInput[]): ChangeSet {
  return new ChangeSet(inputs.map(input => {
    const oldContent = input.oldContent ?? '';
    const newContent = input.newContent ?? '';
    const delta = estimateLineDelta(oldContent, newContent);
    return {
      path: input.path,
      kind: inferChangeKind(input),
      existed: !!input.existed,
      oldContent,
      newContent,
      addedLines: delta.added,
      removedLines: delta.removed,
    };
  }));
}

function inferChangeKind(input: WorkspaceChangeInput): WorkspaceChangeKind {
  if (input.actionType === 'patch-file') return 'patch';
  if (input.actionType === 'create-file') return 'create';
  if (input.actionType === 'overwrite-file') return 'overwrite';
  return input.existed ? 'overwrite' : 'create';
}

function estimateLineDelta(oldContent: string, newContent: string): { added: number; removed: number } {
  const oldLines = countLines(oldContent);
  const newLines = countLines(newContent);
  return {
    added: Math.max(0, newLines - oldLines),
    removed: Math.max(0, oldLines - newLines),
  };
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}
