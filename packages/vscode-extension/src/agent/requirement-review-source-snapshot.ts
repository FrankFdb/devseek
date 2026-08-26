import { promises as fs } from 'fs';
import * as nodePath from 'path';
import type { RequirementReviewSourceSnapshot } from './requirement-review-contract';

const MAX_SOURCE_BYTES = 96 * 1024;
const MAX_REVIEW_SOURCE_CHARS = 180_000;
const MAX_MODULE_COHORT_FILES = 24;
const MAX_CONTEXT_BYTES = 48 * 1024;
const MAX_REVIEW_CONTEXT_CHARS = 64_000;
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.cs', '.go', '.java', '.js', '.jsx', '.kt', '.kts', '.mjs',
  '.php', '.py', '.rb', '.rs', '.svelte', '.swift', '.ts', '.tsx', '.vue',
]);

/** Captures the complete, current source cohort at the host boundary. */
export async function captureRequirementReviewSourceSnapshots(
  workspaceRoot: string,
  sourcePaths: readonly string[],
): Promise<RequirementReviewSourceSnapshot[]> {
  const root = nodePath.resolve(workspaceRoot);
  const realRoot = await fs.realpath(root);
  const cohortPaths = await expandBoundedModuleCohort(root, realRoot, sourcePaths);
  const snapshots: RequirementReviewSourceSnapshot[] = [];
  let totalChars = 0;
  for (const sourcePath of cohortPaths) {
    const absolutePath = resolveWorkspacePath(root, sourcePath);
    if (!isInsideWorkspace(root, absolutePath)) throw new Error(`outside-workspace:${sourcePath}`);
    const realPath = await fs.realpath(absolutePath);
    if (!isInsideWorkspace(realRoot, realPath)) throw new Error(`symlink-outside-workspace:${sourcePath}`);
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) throw new Error(`not-a-file:${sourcePath}`);
    if (stat.size > MAX_SOURCE_BYTES) throw new Error(`source-too-large:${sourcePath}`);
    const content = await fs.readFile(realPath, 'utf8');
    if (content.includes('\0')) throw new Error(`binary-source:${sourcePath}`);
    totalChars += content.length;
    if (totalChars > MAX_REVIEW_SOURCE_CHARS) throw new Error('source-cohort-too-large');
    snapshots.push(sourceSnapshot(root, absolutePath, content));
  }
  if (snapshots.length === 0) throw new Error('empty-source-cohort');
  return snapshots;
}

async function expandBoundedModuleCohort(
  root: string,
  realRoot: string,
  sourcePaths: readonly string[],
): Promise<string[]> {
  const authoritative = [...new Set(sourcePaths)].map(sourcePath => resolveWorkspacePath(root, sourcePath));
  const cohort = [...authoritative];
  const known = new Set(cohort);
  let estimatedBytes = await estimateAuthoritativeBytes(root, realRoot, authoritative);
  const directories = moduleCohortDirectories(root, authoritative);

  for (const directory of directories) {
    const siblings = await listBoundedSourceSiblings(root, realRoot, directory);
    if (!siblings || siblings.length > MAX_MODULE_COHORT_FILES) continue;
    const additions = siblings.filter(candidate => !known.has(candidate.path));
    const addedBytes = additions.reduce((total, candidate) => total + candidate.bytes, 0);
    if (estimatedBytes + addedBytes > MAX_REVIEW_SOURCE_CHARS) continue;
    for (const candidate of additions) {
      known.add(candidate.path);
      cohort.push(candidate.path);
    }
    estimatedBytes += addedBytes;
  }
  return cohort;
}

async function estimateAuthoritativeBytes(
  root: string,
  realRoot: string,
  paths: readonly string[],
): Promise<number> {
  let total = 0;
  for (const absolutePath of paths) {
    if (!isInsideWorkspace(root, absolutePath)) throw new Error(`outside-workspace:${absolutePath}`);
    const realPath = await fs.realpath(absolutePath);
    if (!isInsideWorkspace(realRoot, realPath)) throw new Error(`symlink-outside-workspace:${absolutePath}`);
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) throw new Error(`not-a-file:${absolutePath}`);
    if (stat.size > MAX_SOURCE_BYTES) throw new Error(`source-too-large:${absolutePath}`);
    total += stat.size;
  }
  return total;
}

function moduleCohortDirectories(root: string, authoritative: readonly string[]): string[] {
  const directories = new Set(authoritative.map(sourcePath => nodePath.dirname(sourcePath)));
  for (const directory of [...directories]) {
    const basename = nodePath.basename(directory).toLowerCase();
    if (basename !== 'src' && basename !== 'include') continue;
    const companion = nodePath.join(nodePath.dirname(directory), basename === 'src' ? 'include' : 'src');
    if (isInsideWorkspace(root, companion)) directories.add(companion);
  }
  return [...directories];
}

async function listBoundedSourceSiblings(
  root: string,
  realRoot: string,
  directory: string,
): Promise<Array<{ path: string; bytes: number }> | undefined> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const sourceEntries = entries
      .filter(entry => entry.isFile() && SOURCE_EXTENSIONS.has(nodePath.extname(entry.name).toLowerCase()))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (sourceEntries.length > MAX_MODULE_COHORT_FILES) return undefined;
    const siblings: Array<{ path: string; bytes: number }> = [];
    for (const entry of sourceEntries) {
      const absolutePath = nodePath.join(directory, entry.name);
      const realPath = await fs.realpath(absolutePath);
      if (!isInsideWorkspace(root, absolutePath) || !isInsideWorkspace(realRoot, realPath)) continue;
      const stat = await fs.stat(realPath);
      if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) return undefined;
      siblings.push({ path: absolutePath, bytes: stat.size });
    }
    return siblings;
  } catch {
    return undefined;
  }
}

/** Captures bounded project context without weakening the authoritative source cohort. */
export async function captureRequirementReviewContextSnapshots(
  workspaceRoot: string,
  contextPaths: readonly string[],
  sourceSnapshots: readonly RequirementReviewSourceSnapshot[],
): Promise<RequirementReviewSourceSnapshot[]> {
  const root = nodePath.resolve(workspaceRoot);
  const realRoot = await fs.realpath(root);
  const sourcePaths = new Set(sourceSnapshots.map(snapshot => snapshot.absolutePath));
  const snapshots: RequirementReviewSourceSnapshot[] = [];
  let totalChars = 0;
  for (const contextPath of [...new Set(contextPaths)]) {
    const absolutePath = resolveWorkspacePath(root, contextPath);
    if (!isInsideWorkspace(root, absolutePath) || sourcePaths.has(absolutePath)) continue;
    try {
      const realPath = await fs.realpath(absolutePath);
      if (!isInsideWorkspace(realRoot, realPath) || sourcePaths.has(realPath)) continue;
      const stat = await fs.stat(realPath);
      if (!stat.isFile() || stat.size > MAX_CONTEXT_BYTES) continue;
      const content = await fs.readFile(realPath, 'utf8');
      if (content.includes('\0') || totalChars + content.length > MAX_REVIEW_CONTEXT_CHARS) continue;
      totalChars += content.length;
      snapshots.push(sourceSnapshot(root, absolutePath, content));
    } catch {
      // Supplemental context may disappear; the final source cohort remains authoritative.
    }
  }
  return snapshots;
}

export function renderRequirementReviewSnapshots(
  snapshots: readonly RequirementReviewSourceSnapshot[],
): string {
  return snapshots.map(snapshot => [
    `--- ${snapshot.absolutePath} ---`,
    addLineNumbers(snapshot.content),
  ].join('\n')).join('\n\n');
}

function resolveWorkspacePath(root: string, candidate: string): string {
  return nodePath.isAbsolute(candidate)
    ? nodePath.resolve(candidate)
    : nodePath.resolve(root, candidate);
}

function sourceSnapshot(
  root: string,
  absolutePath: string,
  content: string,
): RequirementReviewSourceSnapshot {
  return {
    path: nodePath.relative(root, absolutePath).replace(/\\/g, '/'),
    absolutePath,
    content,
    lineCount: Math.max(1, content.split('\n').length),
  };
}

function addLineNumbers(content: string): string {
  return content.split('\n').map((line, index) => `${index + 1}: ${line}`).join('\n');
}

function isInsideWorkspace(root: string, target: string): boolean {
  const relative = nodePath.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !nodePath.isAbsolute(relative));
}
