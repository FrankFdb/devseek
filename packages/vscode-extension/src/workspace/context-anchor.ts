import * as nodePath from 'path';
import { isWorkspaceInternalOrGeneratedDirName } from './generated-path-policy';

export function sanitizeWorkspaceContextAnchorPath(
  absPath: string | undefined,
  workspaceRoots: readonly string[],
): string | undefined {
  if (!absPath) return undefined;
  return isWorkspaceInternalOrGeneratedPath(absPath, workspaceRoots) ? undefined : absPath;
}

export function isWorkspaceInternalOrGeneratedPath(
  absPath: string,
  workspaceRoots: readonly string[],
): boolean {
  const resolved = nodePath.resolve(absPath);
  for (const root of workspaceRoots) {
    const rel = nodePath.relative(nodePath.resolve(root), resolved).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) continue;
    const segments = rel.split('/').filter(Boolean);
    return segments.some((segment) => {
      return isWorkspaceInternalOrGeneratedDirName(segment);
    });
  }
  return false;
}
