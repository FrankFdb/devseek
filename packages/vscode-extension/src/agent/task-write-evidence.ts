import * as nodePath from 'path';
import type { AgentTask, AgentTaskAction } from '../agent-task-decomposer';
import type { WrittenFileEvidence } from './completion-evidence';

export function selectTaskWriteEvidence(
  task: Pick<AgentTask, 'action' | 'file' | 'absPath' | 'visibleTarget'>,
  writtenFiles: WrittenFileEvidence[],
  workspaceRoot?: string,
): WrittenFileEvidence | undefined {
  if (!isMutatingTaskAction(task.action) || writtenFiles.length === 0) return undefined;

  const target = buildTaskWriteTarget(task, workspaceRoot);
  if (!target.hasSpecificTarget) return undefined;

  return writtenFiles.find((evidence) => matchesWriteTarget(evidence, target, workspaceRoot));
}

function isMutatingTaskAction(action: AgentTaskAction): boolean {
  return action === 'create' || action === 'modify' || action === 'delete';
}

interface TaskWriteTarget {
  absPath?: string;
  relPath?: string;
  basename?: string;
  hasSpecificTarget: boolean;
}

function buildTaskWriteTarget(
  task: Pick<AgentTask, 'file' | 'absPath' | 'visibleTarget'>,
  workspaceRoot?: string,
): TaskWriteTarget {
  const rawPath = task.absPath || task.file || task.visibleTarget || '';
  const normalizedRaw = normalizePath(rawPath);
  const basename = normalizedRaw ? nodePath.basename(normalizedRaw) : undefined;
  const absPath = task.absPath
    ? normalizePath(nodePath.resolve(task.absPath))
    : undefined;
  const relPath = makeWorkspaceRelative(normalizedRaw, workspaceRoot);
  const hasSpecificTarget = Boolean(absPath || relPath || basename);
  return { absPath, relPath, basename, hasSpecificTarget };
}

function matchesWriteTarget(
  evidence: WrittenFileEvidence,
  target: TaskWriteTarget,
  workspaceRoot?: string,
): boolean {
  const evidenceAbs = normalizePath(nodePath.resolve(evidence.path));
  if (target.absPath && evidenceAbs === target.absPath) return true;

  const evidenceRel = makeWorkspaceRelative(evidence.path, workspaceRoot);
  if (target.relPath && evidenceRel && evidenceRel === target.relPath) return true;

  // Basename fallback is intentionally last. It handles architect plans such as
  // "Circle.cpp" where the concrete directory is discovered later, while exact
  // abs/relative matching still wins in multi-directory projects.
  if (target.basename && nodePath.basename(evidence.path) === target.basename) return true;

  return false;
}

function makeWorkspaceRelative(filePath: string, workspaceRoot?: string): string | undefined {
  const normalized = normalizePath(filePath);
  if (!normalized) return undefined;
  if (!workspaceRoot) return nodePath.isAbsolute(normalized) ? undefined : normalized;
  const root = normalizePath(workspaceRoot);
  try {
    const rel = nodePath.relative(root, normalized).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel)) return rel;
  } catch {
    return nodePath.isAbsolute(normalized) ? undefined : normalized;
  }
  return nodePath.isAbsolute(normalized) ? undefined : normalized;
}

function normalizePath(filePath: string): string {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
