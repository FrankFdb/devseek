import * as nodePath from 'path';
import { isCppBuildArtifactDirName } from '../cpp-build-layout';

const INTERNAL_OR_GENERATED_DIRS = new Set([
  '.devseek',
  '.git',
  '.cache',
  '.vscode',
  'node_modules',
  'dist',
  'out',
  'coverage',
  'tmp',
  'temp',
]);

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
      const lower = segment.toLowerCase();
      return INTERNAL_OR_GENERATED_DIRS.has(lower) || isCppBuildArtifactDirName(segment);
    });
  }
  return false;
}
