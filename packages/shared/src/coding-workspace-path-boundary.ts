import * as nodePath from 'node:path';
import { canonicalizeThroughExistingAncestor } from './coding-workspace-path-containment';

export type CodingWorkspacePathBoundaryDecision = 'accepted' | 'denied';
export type CodingWorkspacePathBoundaryFailure =
  | 'path-outside-root'
  | 'path-resolves-outside-root'
  | 'path-canonicalization-failed';

export interface CodingWorkspacePathBoundaryResult {
  readonly decision: CodingWorkspacePathBoundaryDecision;
  readonly lexicalPath: string;
  readonly canonicalPath?: string;
  readonly reason?: CodingWorkspacePathBoundaryFailure;
}

/**
 * Resolves an effect path against the workspace and, when the workspace exists,
 * checks the nearest existing ancestor so a symbolic-link route cannot escape.
 */
export function inspectCodingWorkspacePathBoundary(input: {
  readonly workspaceRoot: string;
  readonly candidatePath: string;
  readonly baseDir?: string;
}): CodingWorkspacePathBoundaryResult {
  const root = nodePath.resolve(requirePath(input.workspaceRoot));
  const rawBase = String(input.baseDir ?? root).trim();
  const base = nodePath.isAbsolute(rawBase)
    ? nodePath.resolve(rawBase)
    : nodePath.resolve(root, rawBase);
  const candidate = requirePath(input.candidatePath);
  const lexicalPath = nodePath.isAbsolute(candidate)
    ? nodePath.resolve(candidate)
    : nodePath.resolve(base, candidate);

  if (!isInsideOrEqual(root, base) || !isInsideOrEqual(root, lexicalPath)) {
    return denied(lexicalPath, 'path-outside-root');
  }

  const canonicalRoot = canonicalizeThroughExistingAncestor(root);
  if (!canonicalRoot) {
    return accepted(lexicalPath);
  }

  const canonicalBase = canonicalizeThroughExistingAncestor(base);
  const canonicalTarget = canonicalizeThroughExistingAncestor(lexicalPath);
  if (!canonicalBase || !canonicalTarget) {
    return denied(lexicalPath, 'path-canonicalization-failed');
  }
  if (!isInsideOrEqual(canonicalRoot, canonicalBase)
    || !isInsideOrEqual(canonicalRoot, canonicalTarget)) {
    return denied(lexicalPath, 'path-resolves-outside-root', canonicalTarget);
  }

  return accepted(lexicalPath, canonicalTarget);
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const relative = nodePath.relative(root, candidate);
  return relative === '' || (relative !== '..'
    && !relative.startsWith(`..${nodePath.sep}`)
    && !nodePath.isAbsolute(relative));
}

function accepted(lexicalPath: string, canonicalPath?: string): CodingWorkspacePathBoundaryResult {
  return Object.freeze({
    decision: 'accepted',
    lexicalPath,
    ...(canonicalPath ? { canonicalPath } : {}),
  });
}

function denied(
  lexicalPath: string,
  reason: CodingWorkspacePathBoundaryFailure,
  canonicalPath?: string,
): CodingWorkspacePathBoundaryResult {
  return Object.freeze({
    decision: 'denied',
    lexicalPath,
    ...(canonicalPath ? { canonicalPath } : {}),
    reason,
  });
}

function requirePath(value: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.includes('\0')) {
    throw new Error('coding-workspace-path-boundary:invalid-path');
  }
  return normalized;
}
