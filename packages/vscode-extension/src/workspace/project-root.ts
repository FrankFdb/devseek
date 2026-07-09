import * as fs from 'fs';
import * as nodePath from 'path';

const STRONG_ROOT_MARKERS = ['.devseek', '.git', 'AGENTS.md', 'CLAUDE.md'];
const WEAK_ROOT_MARKERS = [
  'package.json',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'CMakeLists.txt',
  'package.xml',
  'Makefile',
];

export function isInsideOrSamePath(candidate: string, root: string): boolean {
  const rel = nodePath.relative(nodePath.resolve(root), nodePath.resolve(candidate));
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

export function resolveProjectRootFromAnchorPath(
  anchorPath: string | undefined,
  workspaceRoots: readonly string[] = [],
): string | undefined {
  if (!anchorPath || !nodePath.isAbsolute(anchorPath)) return undefined;

  const resolvedAnchor = nodePath.resolve(anchorPath);
  for (const root of workspaceRoots) {
    if (isInsideOrSamePath(resolvedAnchor, root)) return nodePath.resolve(root);
  }

  const startDir = resolveAnchorDirectory(resolvedAnchor);
  if (!startDir) return undefined;

  let firstWeak: string | undefined;
  let current = startDir;
  while (true) {
    if (hasAnyMarker(current, STRONG_ROOT_MARKERS)) return current;
    if (!firstWeak && hasAnyMarker(current, WEAK_ROOT_MARKERS)) firstWeak = current;

    const parent = nodePath.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return firstWeak;
}

export function resolveProjectRootFromAnchors(
  anchorPaths: readonly (string | undefined)[],
  workspaceRoots: readonly string[] = [],
): string | undefined {
  for (const anchorPath of anchorPaths) {
    const root = resolveProjectRootFromAnchorPath(anchorPath, workspaceRoots);
    if (root) return root;
  }
  return undefined;
}

function resolveAnchorDirectory(absPath: string): string | undefined {
  try {
    return fs.statSync(absPath).isDirectory() ? absPath : nodePath.dirname(absPath);
  } catch {
    return nodePath.dirname(absPath);
  }
}

function hasAnyMarker(dir: string, markers: readonly string[]): boolean {
  return markers.some((marker) => fs.existsSync(nodePath.join(dir, marker)));
}
