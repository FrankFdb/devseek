import { promises as fs } from 'fs';
import * as nodePath from 'path';
import type { RequirementReviewSourceSnapshot } from './requirement-review-contract';

const MAX_SOURCE_BYTES = 96 * 1024;
const MAX_REVIEW_SOURCE_CHARS = 180_000;
const MAX_CONTEXT_BYTES = 48 * 1024;
const MAX_REVIEW_CONTEXT_CHARS = 32_000;

/** Captures exactly the mutation-owned final source paths selected by the ledger. */
export async function captureRequirementReviewSourceSnapshots(
  workspaceRoot: string,
  sourcePaths: readonly string[],
): Promise<RequirementReviewSourceSnapshot[]> {
  const root = nodePath.resolve(workspaceRoot);
  const realRoot = await fs.realpath(root);
  const cohortPaths = [...new Set(sourcePaths)];
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
