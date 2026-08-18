import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import * as nodePath from 'node:path';

import { codingSemanticDigest } from './coding-semantic-digest';

export const CODING_WORKTREE_SNAPSHOT_VERSION = 'devseek.coding-worktree-snapshot/v1' as const;
export const CODING_DIRTY_WORKTREE_DECISION_VERSION = 'devseek.coding-dirty-worktree-decision/v1' as const;

export type CodingWorktreeRepositoryState = 'git' | 'not-git' | 'unavailable';
export type CodingWorktreeEntryStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked';
export type CodingDirtyWorktreeOverlapProtection = 'none' | 'optimistic-baseline';

export interface CodingWorktreeEntry {
  readonly path: string;
  readonly status: CodingWorktreeEntryStatus;
  readonly sourcePath?: string;
}

export interface CodingWorktreeSnapshot {
  readonly version: typeof CODING_WORKTREE_SNAPSHOT_VERSION;
  readonly workspaceRoot: string;
  readonly repositoryState: CodingWorktreeRepositoryState;
  readonly entries: readonly CodingWorktreeEntry[];
  readonly snapshotSha256: string;
  readonly evidenceRefs: readonly string[];
  readonly reason?: string;
}

export interface CodingDirtyWorktreeAuthorizationInput {
  readonly actionId: string;
  readonly paths: readonly string[];
  readonly overlapProtection?: CodingDirtyWorktreeOverlapProtection;
}

export interface CodingDirtyWorktreeDecision {
  readonly version: typeof CODING_DIRTY_WORKTREE_DECISION_VERSION;
  readonly runId: string;
  readonly actionId: string;
  readonly decision: 'allow' | 'deny';
  readonly reason:
    | 'clean'
    | 'disjoint-user-changes'
    | 'not-git'
    | 'baseline-protected-user-changes'
    | 'overlapping-user-changes'
    | 'worktree-unavailable';
  readonly paths: readonly string[];
  readonly overlapProtection: CodingDirtyWorktreeOverlapProtection;
  readonly conflictingEntries: readonly CodingWorktreeEntry[];
  readonly snapshotSha256: string;
  readonly evidenceRefs: readonly string[];
}

export interface DirtyWorktreePolicySessionPort {
  readonly snapshot: CodingWorktreeSnapshot;
  authorize(input: CodingDirtyWorktreeAuthorizationInput): CodingDirtyWorktreeDecision;
  decisions(): readonly CodingDirtyWorktreeDecision[];
}

export interface DirtyWorktreePolicyPort {
  bind(input: { readonly runId: string; readonly snapshot: CodingWorktreeSnapshot }): DirtyWorktreePolicySessionPort;
}

export interface GitWorktreeObservationOptions {
  readonly workspaceRoot: string;
  readonly execute?: typeof execFileSync;
}

export class CanonicalDirtyWorktreePolicyService implements DirtyWorktreePolicyPort {
  bind(input: { readonly runId: string; readonly snapshot: CodingWorktreeSnapshot }): DirtyWorktreePolicySessionPort {
    const runId = requireId(input.runId, 'run-id');
    const snapshot = snapshotCodingWorktree(input.snapshot);
    const recorded: CodingDirtyWorktreeDecision[] = [];
    return Object.freeze({
      snapshot,
      authorize(request: CodingDirtyWorktreeAuthorizationInput) {
        const actionId = requireId(request.actionId, 'action-id');
        const paths = normalizePaths(request.paths);
        const overlapProtection = normalizeOverlapProtection(request.overlapProtection);
        const conflicts = snapshot.repositoryState === 'git'
          ? snapshot.entries.filter(entry => paths.some(path => pathsOverlap(path, entry.path)
            || (entry.sourcePath ? pathsOverlap(path, entry.sourcePath) : false)))
          : [];
        const reason = decideReason(snapshot, conflicts, paths, overlapProtection);
        const evidenceRefs = Object.freeze([
          ...snapshot.evidenceRefs,
          `dirty-worktree:${snapshot.snapshotSha256}:${reason}`,
        ]);
        const decision = Object.freeze({
          version: CODING_DIRTY_WORKTREE_DECISION_VERSION,
          runId,
          actionId,
          decision: reason === 'overlapping-user-changes' || reason === 'worktree-unavailable'
            ? 'deny' as const
            : 'allow' as const,
          reason,
          paths,
          overlapProtection,
          conflictingEntries: Object.freeze(conflicts.map(snapshotWorktreeEntry)),
          snapshotSha256: snapshot.snapshotSha256,
          evidenceRefs,
        });
        recorded.push(decision);
        return decision;
      },
      decisions() {
        return Object.freeze([...recorded]);
      },
    });
  }
}

/** Node adapter: observes Git once at run start; it owns no conflict policy. */
export function observeGitWorktreeSync(options: GitWorktreeObservationOptions): CodingWorktreeSnapshot {
  const workspaceRoot = nodePath.resolve(options.workspaceRoot);
  const execute = options.execute ?? execFileSync;
  const commandOptions: ExecFileSyncOptionsWithStringEncoding = {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  try {
    const workspacePrefix = String(execute('git', [
      '-C',
      workspaceRoot,
      'rev-parse',
      '--show-prefix',
    ], commandOptions) || '').trim();
    const output = execute('git', [
      '-C',
      workspaceRoot,
      'status',
      '--porcelain=v1',
      '-z',
      '--no-renames',
      '--untracked-files=all',
      '--ignored=no',
      '--',
      '.',
    ], commandOptions);
    return createCodingWorktreeSnapshot({
      workspaceRoot,
      repositoryState: 'git',
      entries: projectGitEntriesToWorkspace(parseGitPorcelainV1Z(String(output || '')), workspacePrefix),
    });
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === 'number'
      ? Number((error as { status: number }).status)
      : undefined;
    const stderr = String((error as { stderr?: unknown })?.stderr ?? '');
    const notGit = status === 128 && /not a git repository/iu.test(stderr);
    return createCodingWorktreeSnapshot({
      workspaceRoot,
      repositoryState: notGit ? 'not-git' : 'unavailable',
      entries: [],
      reason: notGit ? 'workspace-not-git-managed' : 'git-status-observation-failed',
    });
  }
}

function projectGitEntriesToWorkspace(
  entries: readonly CodingWorktreeEntry[],
  rawPrefix: string,
): readonly CodingWorktreeEntry[] {
  const prefix = rawPrefix.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (!prefix) return entries;
  if (prefix.startsWith('/') || prefix.split('/').includes('..')) {
    throw new Error('coding-dirty-worktree:unsafe-workspace-prefix');
  }
  const withSlash = `${prefix}/`;
  return Object.freeze(entries.map(entry => {
    if (!entry.path.startsWith(withSlash)) {
      throw new Error('coding-dirty-worktree:status-path-outside-workspace');
    }
    const projectedPath = entry.path.slice(withSlash.length);
    const projectedSourcePath = entry.sourcePath?.startsWith(withSlash)
      ? entry.sourcePath.slice(withSlash.length)
      : undefined;
    return snapshotWorktreeEntry({
      path: projectedPath,
      status: entry.status,
      ...(projectedSourcePath ? { sourcePath: projectedSourcePath } : {}),
    });
  }));
}

export function createCleanCodingWorktreeSnapshot(workspaceRoot: string): CodingWorktreeSnapshot {
  return createCodingWorktreeSnapshot({
    workspaceRoot,
    repositoryState: 'git',
    entries: [],
  });
}

export function createCodingWorktreeSnapshot(input: {
  readonly workspaceRoot: string;
  readonly repositoryState: CodingWorktreeRepositoryState;
  readonly entries: readonly CodingWorktreeEntry[];
  readonly reason?: string;
}): CodingWorktreeSnapshot {
  const workspaceRoot = nodePath.resolve(input.workspaceRoot);
  const entries = Object.freeze(input.entries
    .map(snapshotWorktreeEntry)
    .sort((left, right) => left.path.localeCompare(right.path) || left.status.localeCompare(right.status)));
  const semantic = {
    version: CODING_WORKTREE_SNAPSHOT_VERSION,
    workspaceRoot,
    repositoryState: input.repositoryState,
    entries,
    ...(input.reason ? { reason: input.reason } : {}),
  };
  const snapshotSha256 = codingSemanticDigest(semantic);
  return Object.freeze({
    ...semantic,
    snapshotSha256,
    evidenceRefs: Object.freeze([`git-worktree-snapshot:${snapshotSha256}`]),
  });
}

export function parseGitPorcelainV1Z(value: string): readonly CodingWorktreeEntry[] {
  if (!value) return Object.freeze([]);
  const fields = value.split('\0');
  const entries: CodingWorktreeEntry[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    if (field.length < 4 || field[2] !== ' ') {
      throw new Error('coding-worktree-observer:invalid-porcelain-record');
    }
    const xy = field.slice(0, 2);
    const path = normalizePath(field.slice(3));
    const status = classifyGitStatus(xy);
    if (status === 'renamed' || status === 'copied') {
      const sourcePath = normalizePath(fields[index + 1] ?? '');
      if (!sourcePath) throw new Error('coding-worktree-observer:missing-rename-source');
      entries.push(snapshotWorktreeEntry({ path, sourcePath, status }));
      index += 1;
    } else {
      entries.push(snapshotWorktreeEntry({ path, status }));
    }
  }
  return Object.freeze(entries);
}

function snapshotCodingWorktree(value: CodingWorktreeSnapshot): CodingWorktreeSnapshot {
  if (!value || value.version !== CODING_WORKTREE_SNAPSHOT_VERSION) {
    throw new Error('coding-dirty-worktree:invalid-snapshot');
  }
  const snapshot = createCodingWorktreeSnapshot({
    workspaceRoot: value.workspaceRoot,
    repositoryState: value.repositoryState,
    entries: value.entries,
    ...(value.reason ? { reason: value.reason } : {}),
  });
  if (snapshot.snapshotSha256 !== value.snapshotSha256) {
    throw new Error('coding-dirty-worktree:snapshot-digest-mismatch');
  }
  return snapshot;
}

function snapshotWorktreeEntry(value: CodingWorktreeEntry): CodingWorktreeEntry {
  const status = value.status;
  if (!['modified', 'added', 'deleted', 'renamed', 'copied', 'untracked'].includes(status)) {
    throw new Error('coding-dirty-worktree:invalid-entry-status');
  }
  const path = normalizePath(value.path);
  if (!path) throw new Error('coding-dirty-worktree:invalid-entry-path');
  const sourcePath = value.sourcePath ? normalizePath(value.sourcePath) : undefined;
  return Object.freeze({ path, status, ...(sourcePath ? { sourcePath } : {}) });
}

function classifyGitStatus(xy: string): CodingWorktreeEntryStatus {
  if (xy === '??') return 'untracked';
  if (xy.includes('R')) return 'renamed';
  if (xy.includes('C')) return 'copied';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('A')) return 'added';
  return 'modified';
}

function decideReason(
  snapshot: CodingWorktreeSnapshot,
  conflicts: readonly CodingWorktreeEntry[],
  paths: readonly string[],
  overlapProtection: CodingDirtyWorktreeOverlapProtection,
): CodingDirtyWorktreeDecision['reason'] {
  if (snapshot.repositoryState === 'unavailable') return 'worktree-unavailable';
  if (snapshot.repositoryState === 'not-git') return 'not-git';
  if (conflicts.length > 0) {
    if (overlapProtection === 'optimistic-baseline' && conflictsAreExact(paths, conflicts)) {
      return 'baseline-protected-user-changes';
    }
    return 'overlapping-user-changes';
  }
  return snapshot.entries.length > 0 ? 'disjoint-user-changes' : 'clean';
}

function conflictsAreExact(
  paths: readonly string[],
  conflicts: readonly CodingWorktreeEntry[],
): boolean {
  return paths.every(path => conflicts.every(entry => {
    const related = [entry.path, entry.sourcePath]
      .filter((candidate): candidate is string => Boolean(candidate))
      .filter(candidate => pathsOverlap(path, candidate));
    return related.every(candidate => candidate === path);
  }));
}

function normalizeOverlapProtection(
  value: CodingDirtyWorktreeOverlapProtection | undefined,
): CodingDirtyWorktreeOverlapProtection {
  if (value === undefined || value === 'none') return 'none';
  if (value === 'optimistic-baseline') return value;
  throw new Error('coding-dirty-worktree:invalid-overlap-protection');
}

function normalizePaths(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error('coding-dirty-worktree:missing-paths');
  return Object.freeze([...new Set(values.map(normalizePath))]);
}

function normalizePath(value: string): string {
  const normalized = String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/{2,}/gu, '/');
  const segments = normalized.split('/');
  if (!normalized
    || normalized.startsWith('/')
    || /^[a-zA-Z]:\//u.test(normalized)
    || normalized.includes('\0')
    || segments.includes('..')
    || segments.includes('')) {
    throw new Error('coding-dirty-worktree:unsafe-path');
  }
  return segments.filter(segment => segment !== '.').join('/');
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function requireId(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.includes('\0')) throw new Error(`coding-dirty-worktree:invalid-${label}`);
  return normalized;
}
