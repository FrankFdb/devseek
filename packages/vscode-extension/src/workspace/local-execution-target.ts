import * as fs from 'fs';
import * as nodePath from 'path';
import {
  CPP_BUILD_DIR_NAME,
  LEGACY_CPP_BUILD_DIR_NAMES,
} from '../cpp-build-layout';

const LOCAL_EXECUTION_PROJECT_MARKERS = [
  'CMakeLists.txt',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
];

const MAX_LOCAL_EXECUTION_ROOT_ASCENT = 10;

export function isExistingDirectory(absPath: string | undefined): boolean {
  if (!absPath) return false;
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

export function resolveLocalExecutionWorkdir(absPath: string | undefined): string | undefined {
  if (!absPath) return undefined;
  const initialDir = inferInitialExecutionDir(absPath);
  return findLocalExecutionProjectRoot(initialDir) ?? initialDir;
}

export function resolveLocalExecutionProjectDirFromCandidate(
  candidatePath: string | undefined,
  workspaceRoots: string[],
): string | undefined {
  if (!candidatePath) return undefined;
  const normalized = candidatePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const candidates = nodePath.isAbsolute(normalized)
    ? [normalized]
    : workspaceRoots.map(root => nodePath.join(root, ...normalized.split('/')));

  for (const candidate of candidates) {
    const projectDir = findLocalExecutionProjectRoot(inferInitialExecutionDir(candidate));
    if (projectDir) return projectDir;
  }
  return undefined;
}

function inferInitialExecutionDir(absPath: string): string {
  const resolved = nodePath.resolve(absPath);
  try {
    return fs.statSync(resolved).isDirectory() ? resolved : nodePath.dirname(resolved);
  } catch {
    return looksLikeFileTarget(resolved) ? nodePath.dirname(resolved) : resolved;
  }
}

function findLocalExecutionProjectRoot(startDir: string): string | undefined {
  let current = nodePath.resolve(startDir);
  const seen = new Set<string>();
  let depth = 0;
  while (!seen.has(current) && depth <= MAX_LOCAL_EXECUTION_ROOT_ASCENT) {
    seen.add(current);
    if (hasLocalExecutionProjectMarker(current)) return current;
    const parent = nodePath.dirname(current);
    if (parent === current) break;
    current = parent;
    depth += 1;
  }
  return undefined;
}

function hasLocalExecutionProjectMarker(dir: string): boolean {
  return LOCAL_EXECUTION_PROJECT_MARKERS.some(marker => fs.existsSync(nodePath.join(dir, marker)));
}

function looksLikeFileTarget(absPath: string): boolean {
  const base = nodePath.basename(absPath);
  if (base === 'Makefile' || base === 'Dockerfile' || base === 'CMakeLists.txt') return true;
  if (nodePath.extname(base)) return true;
  const parts = absPath.replace(/\\/g, '/').split('/').map(part => part.toLowerCase());
  const legacyBuildNames = LEGACY_CPP_BUILD_DIR_NAMES.map(name => name.toLowerCase());
  return parts.includes('bin') || parts.includes(CPP_BUILD_DIR_NAME) || legacyBuildNames.some(name => parts.includes(name));
}
