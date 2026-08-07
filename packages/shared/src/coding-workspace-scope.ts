import * as nodePath from 'path';

export interface CodingWorkspaceTargetProjection {
  readonly decision: 'accepted' | 'denied';
  readonly targets: readonly string[];
  readonly reason?: string;
}

/** Projects concrete host paths into one workspace-relative authority namespace. */
export function projectCodingWorkspaceTargets(
  paths: readonly string[],
  workspaceRoot: string,
): CodingWorkspaceTargetProjection {
  const root = nodePath.resolve(requireText(workspaceRoot));
  if (!Array.isArray(paths) || paths.length === 0) {
    return deniedProjection('change-plan-target-required');
  }

  const targets: string[] = [];
  for (const candidate of paths) {
    const raw = typeof candidate === 'string' ? candidate.trim() : '';
    if (!raw || raw.includes('\0') || /[*?]/u.test(raw)) {
      return deniedProjection('workspace-path-invalid');
    }
    // Treat both separators as workspace syntax so projection and later host I/O
    // cannot disagree about whether a proposed target traverses the root.
    const hostCandidate = raw.replace(/[\\/]/gu, nodePath.sep);
    const resolved = nodePath.resolve(root, hostCandidate);
    const relative = nodePath.relative(root, resolved);
    if (!relative || relative === '..' || relative.startsWith(`..${nodePath.sep}`)
      || nodePath.isAbsolute(relative)) {
      return deniedProjection(`workspace-path-outside-root:${raw}`);
    }
    targets.push(normalizeCodingWorkspacePath(relative));
  }

  return Object.freeze({
    decision: 'accepted',
    targets: Object.freeze([...new Set(targets)]),
  });
}

/** Matches a concrete target against an exact path or structured glob scope. */
export function codingWorkspaceTargetMatchesScope(target: string, scope: string): boolean {
  const normalizedTarget = normalizeCodingWorkspacePath(target);
  const normalizedScope = normalizeCodingWorkspacePath(scope).replace(/\/$/u, '');
  if (!normalizedTarget || !normalizedScope) return false;
  if (normalizedTarget === normalizedScope) return true;
  if (!/[*?]/u.test(normalizedScope)) return false;
  return matchPathSegments(
    normalizedScope.split('/'),
    normalizedTarget.split('/'),
    0,
    0,
    new Map(),
  );
}

export function normalizeCodingWorkspacePath(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/\\/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/\/{2,}/gu, '/');
}

function matchPathSegments(
  pattern: readonly string[],
  target: readonly string[],
  patternIndex: number,
  targetIndex: number,
  memo: Map<string, boolean>,
): boolean {
  const key = `${patternIndex}:${targetIndex}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  let matches: boolean;
  if (patternIndex === pattern.length) {
    matches = targetIndex === target.length;
  } else if (pattern[patternIndex] === '**') {
    matches = matchPathSegments(pattern, target, patternIndex + 1, targetIndex, memo)
      || (targetIndex < target.length
        && matchPathSegments(pattern, target, patternIndex, targetIndex + 1, memo));
  } else if (targetIndex === target.length
    || !matchPathSegment(pattern[patternIndex] ?? '', target[targetIndex] ?? '')) {
    matches = false;
  } else {
    matches = matchPathSegments(pattern, target, patternIndex + 1, targetIndex + 1, memo);
  }
  memo.set(key, matches);
  return matches;
}

function matchPathSegment(pattern: string, target: string): boolean {
  let patternIndex = 0;
  let targetIndex = 0;
  let starIndex = -1;
  let starTargetIndex = -1;
  while (targetIndex < target.length) {
    const token = pattern[patternIndex];
    if (token === '?' || token === target[targetIndex]) {
      patternIndex += 1;
      targetIndex += 1;
      continue;
    }
    if (token === '*') {
      starIndex = patternIndex;
      starTargetIndex = targetIndex;
      patternIndex += 1;
      continue;
    }
    if (starIndex >= 0) {
      patternIndex = starIndex + 1;
      starTargetIndex += 1;
      targetIndex = starTargetIndex;
      continue;
    }
    return false;
  }
  while (pattern[patternIndex] === '*') patternIndex += 1;
  return patternIndex === pattern.length;
}

function deniedProjection(reason: string): CodingWorkspaceTargetProjection {
  return Object.freeze({ decision: 'denied', targets: Object.freeze([]), reason });
}

function requireText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error('coding-workspace-scope:missing-workspace-root');
  return text;
}
