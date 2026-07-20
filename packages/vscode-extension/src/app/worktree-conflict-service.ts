import * as nodePath from 'path';

const WORKTREE_CONFLICT_PROTOCOL = {
  version: 'devseek.worktree-conflict/v1',
} as const;

export const WORKTREE_CONFLICT_PROTOCOL_VERSION = WORKTREE_CONFLICT_PROTOCOL.version;

export type WorktreeState =
  | 'clean'
  | 'dirty'
  | 'staged'
  | 'staged-and-dirty'
  | 'untracked'
  | 'deleted'
  | 'renamed'
  | 'conflicted';

export type WorktreeWriteDecisionKind = 'allow' | 'needs-user-approval' | 'block';
export type WorktreeTargetOwner = 'handwritten' | 'generated' | 'unknown';
export type WorktreeProposedOwner = 'handwritten-source' | 'generated-output' | 'unknown';

export type WorktreeWriteReason =
  | 'clean-owner-aligned-write'
  | 'dirty-user-changes-require-approval'
  | 'staged-user-changes-require-approval'
  | 'staged-and-dirty-user-changes-require-approval'
  | 'untracked-target-requires-approval'
  | 'deleted-target-requires-approval'
  | 'conflicted-worktree-state'
  | 'generated-boundary-owner-mismatch'
  | 'handwritten-owner-mismatch'
  | 'target-outside-workspace';

export interface WorktreeStatusEntry {
  relPath: string;
  originalRelPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  state: WorktreeState;
  raw: string;
}

export interface WorktreeConflictServiceOptions {
  workspaceRoot: string;
  generatedBoundaries?: readonly string[];
}

export interface WorktreeWriteInput {
  targetAbsPath: string;
  statusEntries: readonly WorktreeStatusEntry[];
  proposedOwner: WorktreeProposedOwner;
  generatedBoundaries?: readonly string[];
}

export interface WorktreeWriteDecision {
  version: typeof WORKTREE_CONFLICT_PROTOCOL.version;
  targetAbsPath: string;
  targetRelPath: string;
  targetOwner: WorktreeTargetOwner;
  proposedOwner: WorktreeProposedOwner;
  generatedBoundaryRelPath?: string;
  worktreeState: WorktreeState;
  statusEvidence: string;
  decision: WorktreeWriteDecisionKind;
  reason: WorktreeWriteReason;
}

export class WorktreeConflictService {
  private readonly workspaceRoot: string;
  private readonly generatedBoundaries: readonly string[];

  constructor(options: WorktreeConflictServiceOptions) {
    this.workspaceRoot = nodePath.resolve(options.workspaceRoot);
    this.generatedBoundaries = options.generatedBoundaries ?? [];
  }

  evaluateWrite(input: WorktreeWriteInput): WorktreeWriteDecision {
    const targetAbsPath = nodePath.resolve(input.targetAbsPath);
    const targetRelPath = toRelPath(this.workspaceRoot, targetAbsPath);
    const statusEntry = input.statusEntries.find(entry =>
      entry.relPath === targetRelPath || entry.originalRelPath === targetRelPath);
    const owner = classifyTargetOwner(
      targetRelPath,
      input.generatedBoundaries ?? this.generatedBoundaries,
    );
    const base = {
      version: WORKTREE_CONFLICT_PROTOCOL.version,
      targetAbsPath,
      targetRelPath,
      targetOwner: owner.targetOwner,
      proposedOwner: input.proposedOwner,
      ...(owner.generatedBoundaryRelPath ? { generatedBoundaryRelPath: owner.generatedBoundaryRelPath } : {}),
      worktreeState: statusEntry?.state ?? 'clean',
      statusEvidence: statusEntry?.raw ?? 'clean',
    };

    if (isOutsideWorkspace(targetRelPath)) {
      return { ...base, targetOwner: 'unknown', decision: 'block', reason: 'target-outside-workspace' };
    }
    if (owner.targetOwner === 'generated' && input.proposedOwner === 'handwritten-source') {
      return { ...base, decision: 'block', reason: 'generated-boundary-owner-mismatch' };
    }
    if (owner.targetOwner === 'handwritten' && input.proposedOwner === 'generated-output') {
      return { ...base, decision: 'block', reason: 'handwritten-owner-mismatch' };
    }

    const worktreeState = statusEntry?.state ?? 'clean';
    if (worktreeState === 'conflicted') {
      return { ...base, decision: 'block', reason: 'conflicted-worktree-state' };
    }
    if (worktreeState === 'dirty') {
      return { ...base, decision: 'needs-user-approval', reason: 'dirty-user-changes-require-approval' };
    }
    if (worktreeState === 'staged' || worktreeState === 'renamed') {
      return { ...base, decision: 'needs-user-approval', reason: 'staged-user-changes-require-approval' };
    }
    if (worktreeState === 'staged-and-dirty') {
      return { ...base, decision: 'needs-user-approval', reason: 'staged-and-dirty-user-changes-require-approval' };
    }
    if (worktreeState === 'untracked') {
      return { ...base, decision: 'needs-user-approval', reason: 'untracked-target-requires-approval' };
    }
    if (worktreeState === 'deleted') {
      return { ...base, decision: 'needs-user-approval', reason: 'deleted-target-requires-approval' };
    }
    return { ...base, decision: 'allow', reason: 'clean-owner-aligned-write' };
  }
}

export function parseGitStatusPorcelain(raw: string): WorktreeStatusEntry[] {
  const text = String(raw || '');
  if (!text.trim()) return [];
  return text.includes('\0') ? parsePorcelainZ(text) : parsePorcelainLines(text);
}

function parsePorcelainLines(raw: string): WorktreeStatusEntry[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line.length >= 3)
    .map(parsePorcelainLine)
    .filter((entry): entry is WorktreeStatusEntry => Boolean(entry));
}

function parsePorcelainLine(line: string): WorktreeStatusEntry | null {
  const indexStatus = line[0] || ' ';
  const worktreeStatus = line[1] || ' ';
  const pathText = line.slice(3).trim();
  if (!pathText) return null;
  const renameParts = pathText.split(' -> ');
  const originalRelPath = renameParts.length === 2 ? normalizeRelPath(renameParts[0]) : undefined;
  const relPath = normalizeRelPath(renameParts.length === 2 ? renameParts[1] : pathText);
  return {
    relPath,
    ...(originalRelPath ? { originalRelPath } : {}),
    indexStatus,
    worktreeStatus,
    state: classifyWorktreeState(indexStatus, worktreeStatus),
    raw: line,
  };
}

function parsePorcelainZ(raw: string): WorktreeStatusEntry[] {
  const tokens = raw.split('\0').filter(Boolean);
  const entries: WorktreeStatusEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length < 4) continue;
    const indexStatus = token[0] || ' ';
    const worktreeStatus = token[1] || ' ';
    const relPath = normalizeRelPath(token.slice(3));
    let originalRelPath: string | undefined;
    if ((indexStatus === 'R' || indexStatus === 'C') && tokens[index + 1]) {
      originalRelPath = normalizeRelPath(tokens[index + 1]);
      index += 1;
    }
    entries.push({
      relPath,
      ...(originalRelPath ? { originalRelPath } : {}),
      indexStatus,
      worktreeStatus,
      state: classifyWorktreeState(indexStatus, worktreeStatus),
      raw: token,
    });
  }
  return entries;
}

function classifyWorktreeState(indexStatus: string, worktreeStatus: string): WorktreeState {
  if (indexStatus === '?' && worktreeStatus === '?') return 'untracked';
  if (indexStatus === 'U' || worktreeStatus === 'U' || (indexStatus === 'A' && worktreeStatus === 'A')) {
    return 'conflicted';
  }
  if (indexStatus === 'R' || worktreeStatus === 'R') return 'renamed';
  if (indexStatus === 'D' || worktreeStatus === 'D') return 'deleted';
  const staged = indexStatus !== ' ' && indexStatus !== '?';
  const dirty = worktreeStatus !== ' ' && worktreeStatus !== '?';
  if (staged && dirty) return 'staged-and-dirty';
  if (staged) return 'staged';
  if (dirty) return 'dirty';
  return 'clean';
}

function classifyTargetOwner(
  targetRelPath: string,
  generatedBoundaries: readonly string[],
): { targetOwner: WorktreeTargetOwner; generatedBoundaryRelPath?: string } {
  const normalizedTarget = normalizeRelPath(targetRelPath);
  const boundary = generatedBoundaries
    .map(normalizeGeneratedBoundary)
    .find(candidate => candidate.isDirectory
      ? normalizedTarget.startsWith(candidate.relPath)
      : normalizedTarget === candidate.relPath);
  if (boundary) return { targetOwner: 'generated', generatedBoundaryRelPath: boundary.relPath };
  return { targetOwner: isOutsideWorkspace(normalizedTarget) ? 'unknown' : 'handwritten' };
}

function normalizeGeneratedBoundary(value: string): { relPath: string; isDirectory: boolean } {
  const isDirectory = /[\\/]$/.test(value);
  const relPath = normalizeRelPath(value);
  return { relPath: isDirectory && !relPath.endsWith('/') ? `${relPath}/` : relPath, isDirectory };
}

function toRelPath(root: string, absPath: string): string {
  return normalizeRelPath(nodePath.relative(root, absPath));
}

function normalizeRelPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.?\//, '');
}

function isOutsideWorkspace(relPath: string): boolean {
  return relPath === '..' || relPath.startsWith('../') || nodePath.isAbsolute(relPath);
}
