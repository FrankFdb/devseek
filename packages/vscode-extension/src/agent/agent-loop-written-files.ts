import * as nodePath from 'path';
import { coalesceWrittenFileEvidence, type WrittenFileEvidence } from './completion-evidence';
import type { TaskExecutionResult } from './task-execution-result';

function buildWrittenFileEvidence(
  filePath: string,
  action: string,
  linesAdded = 0,
  linesRemoved = 0,
): WrittenFileEvidence {
  return {
    path: filePath,
    basename: nodePath.basename(filePath),
    linesAdded,
    linesRemoved,
    action,
  };
}

export function buildWrittenFileEvidenceForPaths(
  filePaths: string[],
  action: string,
  workspaceRoot: string,
  diff?: { added: number; removed: number },
): WrittenFileEvidence[] {
  return coalesceWrittenFileEvidence(
    filePaths.map((filePath, index) => buildWrittenFileEvidence(
      nodePath.isAbsolute(filePath) ? filePath : nodePath.join(workspaceRoot, filePath),
      action,
      index === 0 ? diff?.added ?? 0 : 0,
      index === 0 ? diff?.removed ?? 0 : 0,
    )),
    workspaceRoot,
  );
}

export function collectTaskResultWrittenFiles(
  result: TaskExecutionResult,
  fallbackAction: string,
  workspaceRoot: string,
): WrittenFileEvidence[] {
  const files = result.writtenFiles?.length
    ? result.writtenFiles
    : result.path
      ? [buildWrittenFileEvidence(result.path, fallbackAction, result.linesAdded ?? 0, result.linesRemoved ?? 0)]
      : [];
  return coalesceWrittenFileEvidence(
    files.map(file => ({
      ...file,
      path: nodePath.isAbsolute(file.path) ? file.path : nodePath.join(workspaceRoot, file.path),
      basename: file.basename || nodePath.basename(file.path),
      linesAdded: file.linesAdded ?? 0,
      linesRemoved: file.linesRemoved ?? 0,
      action: file.action || fallbackAction,
    })),
    workspaceRoot,
  );
}

export function appendAgentLoopWrittenFiles(
  changedPaths: string[],
  editedFileRecords: WrittenFileEvidence[],
  writtenFiles: WrittenFileEvidence[],
  workspaceRoot: string,
): void {
  const existingPaths = new Set(changedPaths.map(pathValue => normalizePathForSet(pathValue, workspaceRoot)));
  for (const file of writtenFiles) {
    const key = normalizePathForSet(file.path, workspaceRoot);
    if (!existingPaths.has(key)) {
      changedPaths.push(toWorkspaceRelativeChangedPath(file.path, workspaceRoot));
      existingPaths.add(key);
    }
  }

  const coalesced = coalesceWrittenFileEvidence([...editedFileRecords, ...writtenFiles], workspaceRoot);
  editedFileRecords.splice(0, editedFileRecords.length, ...coalesced);
}

export function summarizeWrittenFileBasenames(writtenFiles: WrittenFileEvidence[]): string {
  const basenames = [...new Set(writtenFiles.map(file => file.basename || nodePath.basename(file.path)))];
  if (basenames.length <= 3) return basenames.join('、');
  return `${basenames.slice(0, 3).join('、')} 等 ${basenames.length} 个文件`;
}

export function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean).map(pathValue => nodePath.normalize(pathValue)))];
}

export function uniqueStringValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function countByValue(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) {
    result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

function normalizePathForSet(filePath: string, workspaceRoot: string): string {
  return nodePath.normalize(nodePath.isAbsolute(filePath) ? filePath : nodePath.join(workspaceRoot, filePath));
}

function toWorkspaceRelativeChangedPath(filePath: string, workspaceRoot: string): string {
  const absPath = nodePath.isAbsolute(filePath) ? filePath : nodePath.join(workspaceRoot, filePath);
  const relPath = nodePath.relative(workspaceRoot, absPath).replace(/\\/g, '/');
  return relPath && !relPath.startsWith('..') && !nodePath.isAbsolute(relPath)
    ? relPath
    : filePath.replace(/\\/g, '/');
}
