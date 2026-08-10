import * as nodePath from 'path';
import type { WrittenFileEvidence } from './completion-evidence';
import { isInsideWorkspacePath } from './write-guard';

/** Projects workspace mutation evidence into canonical, workspace-relative verification scope. */
export function workspaceRelativeVerificationPaths(
  writtenFiles: readonly WrittenFileEvidence[],
  workspaceRootFsPath: string,
): string[] {
  if (!workspaceRootFsPath) return [];
  const root = nodePath.resolve(workspaceRootFsPath);
  const seen = new Set<string>();
  const relPaths: string[] = [];
  for (const file of writtenFiles) {
    const absPath = nodePath.resolve(
      nodePath.isAbsolute(file.path) ? file.path : nodePath.join(root, file.path),
    );
    if (!isInsideWorkspacePath(absPath, root)) continue;
    const relPath = nodePath.relative(root, absPath).replace(/\\/g, '/');
    if (!relPath || seen.has(relPath)) continue;
    seen.add(relPath);
    relPaths.push(relPath);
  }
  return relPaths;
}
