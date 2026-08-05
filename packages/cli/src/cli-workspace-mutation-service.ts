import { createHash, randomUUID } from 'crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'fs/promises';
import { basename, dirname, relative, resolve } from 'path';
import type {
  CodingWorkspaceAppliedMutation,
  CodingWorkspaceApplyOutcome,
  CodingWorkspaceBaseline,
  CodingWorkspaceMutationFailure,
  CodingWorkspaceMutationPlan,
  CodingWorkspaceReadback,
  CodingWorkspaceRollback,
  WorkspaceMutationPort,
} from '@devseek-netai/shared';
import type {
  CliCodingArtifactProposal,
  CliUnifiedDiffArtifact,
} from './cli-coding-artifact-interpreter';
import { resolveCliWorkspacePath } from './cli-workspace-path';

export interface CliWorkspaceMutationPayload {
  readonly workspaceRoot: string;
  readonly proposal: CliCodingArtifactProposal;
}

export interface CliWorkspaceBaselineState {
  readonly workspaceRoot: string;
  readonly entries: readonly CliWorkspaceSnapshotEntry[];
  readonly directories: readonly CliWorkspaceDirectoryBaseline[];
}

export interface CliWorkspaceAppliedState {
  readonly expected: readonly CliWorkspaceExpectedEntry[];
  readonly changedPaths: readonly string[];
}

interface CliWorkspaceSnapshotEntry {
  readonly path: string;
  readonly existed: boolean;
  readonly content: string;
}

interface CliWorkspaceDirectoryBaseline {
  readonly path: string;
  readonly existed: boolean;
}

interface CliWorkspaceExpectedEntry {
  readonly path: string;
  readonly content: string;
}

/** Filesystem-only adapter consumed by the shared mutation transaction owner. */
export class CliWorkspaceMutationHostAdapter implements WorkspaceMutationPort<
  CliWorkspaceMutationPayload,
  CliWorkspaceBaselineState,
  CliWorkspaceAppliedState,
  readonly string[]
> {
  async captureBaseline(
    plan: CodingWorkspaceMutationPlan<CliWorkspaceMutationPayload>,
  ): Promise<CodingWorkspaceBaseline<CliWorkspaceBaselineState>> {
    assertPlanPathsMatchProposal(plan);
    const workspaceRoot = resolve(plan.payload.workspaceRoot);
    const entries = await Promise.all(plan.paths.map(path => readSnapshotEntry(workspaceRoot, path)));
    const directories = await captureParentDirectories(workspaceRoot, plan.paths);
    const baselineRef = contentRef('cli-workspace-baseline', { entries, directories });
    return {
      baselineRef,
      state: { workspaceRoot, entries, directories },
      evidenceRefs: [baselineRef],
    };
  }

  async apply(
    plan: CodingWorkspaceMutationPlan<CliWorkspaceMutationPayload>,
    baseline: CodingWorkspaceBaseline<CliWorkspaceBaselineState>,
  ): Promise<CodingWorkspaceApplyOutcome<CliWorkspaceAppliedState, readonly string[]>> {
    if (!await isBaselineCurrent(baseline)) {
      return {
        status: 'rejected',
        mutationState: 'unchanged',
        errorCode: 'workspace-baseline-changed',
        evidenceRefs: [`cli-workspace-baseline:${plan.actionId}:changed`],
      };
    }
    let expected: CliWorkspaceExpectedEntry[];
    try {
      expected = computeExpectedEntries(plan.payload.proposal, baseline.state.entries);
    } catch (error) {
      return {
        status: 'rejected',
        mutationState: 'unchanged',
        errorCode: mutationPreparationErrorCode(error),
        evidenceRefs: [`cli-workspace-prepare:${plan.actionId}:rejected`],
      };
    }
    let staged: Array<{ tempPath: string; targetPath: string }>;
    try {
      staged = await stageExpectedEntries(baseline.state.workspaceRoot, expected, plan.actionId);
    } catch {
      return {
        status: 'rejected',
        mutationState: 'possibly-changed',
        errorCode: 'workspace-stage-failed',
        evidenceRefs: [`cli-workspace-stage:${plan.actionId}:failed`],
      };
    }
    try {
      for (const entry of staged) await rename(entry.tempPath, entry.targetPath);
    } catch {
      await cleanupStagedFiles(staged);
      return {
        status: 'rejected',
        mutationState: 'possibly-changed',
        errorCode: 'workspace-commit-failed',
        evidenceRefs: [`cli-workspace-commit:${plan.actionId}:failed`],
      };
    }
    const changedPaths = expected.map(entry => entry.path);
    return {
      status: 'applied',
      applied: {
        state: { expected, changedPaths },
        result: changedPaths,
        evidenceRefs: [contentRef('cli-workspace-apply', expected)],
      },
    };
  }

  async readback(
    _plan: CodingWorkspaceMutationPlan<CliWorkspaceMutationPayload>,
    baseline: CodingWorkspaceBaseline<CliWorkspaceBaselineState>,
    applied: CodingWorkspaceAppliedMutation<CliWorkspaceAppliedState, readonly string[]>,
  ): Promise<CodingWorkspaceReadback> {
    const actual = await Promise.all(
      applied.state.expected.map(entry => readSnapshotEntry(baseline.state.workspaceRoot, entry.path)),
    );
    const matches = actual.every((entry, index) => (
      entry.existed && entry.content === applied.state.expected[index]?.content
    ));
    const readbackRef = contentRef('cli-workspace-readback', actual);
    return { matches, readbackRef, evidenceRefs: [readbackRef] };
  }

  async rollback(
    _plan: CodingWorkspaceMutationPlan<CliWorkspaceMutationPayload>,
    baseline: CodingWorkspaceBaseline<CliWorkspaceBaselineState>,
    _applied: CodingWorkspaceAppliedMutation<CliWorkspaceAppliedState, readonly string[]> | undefined,
    cause: CodingWorkspaceMutationFailure,
  ): Promise<CodingWorkspaceRollback> {
    try {
      await restoreBaselineEntries(baseline.state);
      const restored = await Promise.all(
        baseline.state.entries.map(entry => readSnapshotEntry(baseline.state.workspaceRoot, entry.path)),
      );
      const rolledBack = canonicalEntries(restored) === canonicalEntries(baseline.state.entries);
      const rollbackRef = contentRef('cli-workspace-rollback', { cause, restored });
      return {
        rolledBack,
        ...(rolledBack ? { rollbackRef } : {}),
        evidenceRefs: [rollbackRef],
      };
    } catch {
      return {
        rolledBack: false,
        evidenceRefs: [`cli-workspace-rollback:${cause}:failed`],
      };
    }
  }
}

export function collectCliWorkspaceMutationPaths(proposal: CliCodingArtifactProposal): string[] {
  return [...new Set([
    ...proposal.fileToolCalls.map(call => normalizeRelativePath(call.filePath)),
    ...proposal.unifiedDiffs.map(diff => normalizeRelativePath(diff.filePath)),
  ])];
}

async function readSnapshotEntry(workspaceRoot: string, relativePath: string): Promise<CliWorkspaceSnapshotEntry> {
  const target = resolveCliWorkspacePath(workspaceRoot, relativePath);
  try {
    return {
      path: toPosixPath(relative(workspaceRoot, target)),
      existed: true,
      content: await readFile(target, 'utf8'),
    };
  } catch (error) {
    if (isMissing(error)) return { path: normalizeRelativePath(relativePath), existed: false, content: '' };
    throw error;
  }
}

async function captureParentDirectories(
  workspaceRoot: string,
  paths: readonly string[],
): Promise<CliWorkspaceDirectoryBaseline[]> {
  const candidates = new Set<string>();
  for (const relativePath of paths) {
    let current = dirname(normalizeRelativePath(relativePath));
    while (current !== '.' && current !== '') {
      candidates.add(toPosixPath(current));
      current = dirname(current);
    }
  }
  const directories = await Promise.all([...candidates].sort().map(async path => ({
    path,
    existed: await directoryExists(resolveCliWorkspacePath(workspaceRoot, path)),
  })));
  return directories;
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function isBaselineCurrent(baseline: CodingWorkspaceBaseline<CliWorkspaceBaselineState>): Promise<boolean> {
  const current = await Promise.all(
    baseline.state.entries.map(entry => readSnapshotEntry(baseline.state.workspaceRoot, entry.path)),
  );
  return canonicalEntries(current) === canonicalEntries(baseline.state.entries);
}

function computeExpectedEntries(
  proposal: CliCodingArtifactProposal,
  baselineEntries: readonly CliWorkspaceSnapshotEntry[],
): CliWorkspaceExpectedEntry[] {
  const contentByPath = new Map(
    baselineEntries.map(entry => [entry.path, entry.existed ? entry.content : undefined] as const),
  );
  for (const call of proposal.fileToolCalls) {
    contentByPath.set(normalizeRelativePath(call.filePath), call.content);
  }
  for (const diff of proposal.unifiedDiffs) {
    const path = normalizeRelativePath(diff.filePath);
    const current = contentByPath.get(path);
    if (current === undefined) throw new Error(`Patch target does not exist: ${path}`);
    contentByPath.set(path, applyUnifiedDiff(current, diff));
  }
  return collectCliWorkspaceMutationPaths(proposal).map(path => {
    const content = contentByPath.get(path);
    if (content === undefined) throw new Error(`No mutation content resolved for ${path}`);
    return { path, content };
  });
}

function applyUnifiedDiff(originalText: string, diff: CliUnifiedDiffArtifact): string {
  const hadTrailingNewline = originalText.endsWith('\n');
  const originalLines = originalText.replace(/\n$/, '').split('\n');
  let originalIndex = 0;
  const outputLines: string[] = [];
  for (const hunk of diff.hunks) {
    const hunkStartIndex = Math.max(0, hunk.oldStart - 1);
    while (originalIndex < hunkStartIndex) outputLines.push(originalLines[originalIndex++] ?? '');
    for (const line of hunk.lines) {
      const marker = line[0];
      const text = line.slice(1);
      if (marker === ' ') {
        assertPatchLine(originalLines[originalIndex], text, diff.filePath);
        outputLines.push(originalLines[originalIndex++] ?? '');
      } else if (marker === '-') {
        assertPatchLine(originalLines[originalIndex], text, diff.filePath);
        originalIndex++;
      } else if (marker === '+') {
        outputLines.push(text);
      }
    }
  }
  while (originalIndex < originalLines.length) outputLines.push(originalLines[originalIndex++] ?? '');
  return outputLines.join('\n') + (hadTrailingNewline ? '\n' : '');
}

async function stageExpectedEntries(
  workspaceRoot: string,
  expected: readonly CliWorkspaceExpectedEntry[],
  actionId: string,
): Promise<Array<{ tempPath: string; targetPath: string }>> {
  const staged: Array<{ tempPath: string; targetPath: string }> = [];
  try {
    for (const entry of expected) {
      const targetPath = resolveCliWorkspacePath(workspaceRoot, entry.path);
      await mkdir(dirname(targetPath), { recursive: true });
      const tempPath = resolve(
        dirname(targetPath),
        `.${basename(targetPath)}.devseek-${safeActionId(actionId)}-${randomUUID()}.tmp`,
      );
      await writeFile(tempPath, entry.content, { encoding: 'utf8', flag: 'wx' });
      staged.push({ tempPath, targetPath });
    }
    return staged;
  } catch (error) {
    await cleanupStagedFiles(staged);
    throw error;
  }
}

async function cleanupStagedFiles(staged: readonly { tempPath: string }[]): Promise<void> {
  await Promise.all(staged.map(entry => rm(entry.tempPath, { force: true }).catch(() => undefined)));
}

async function restoreBaselineEntries(state: CliWorkspaceBaselineState): Promise<void> {
  for (const entry of state.entries) {
    const target = resolveCliWorkspacePath(state.workspaceRoot, entry.path);
    if (entry.existed) {
      await mkdir(dirname(target), { recursive: true });
      const tempPath = resolve(dirname(target), `.${basename(target)}.devseek-rollback-${randomUUID()}.tmp`);
      await writeFile(tempPath, entry.content, { encoding: 'utf8', flag: 'wx' });
      await rename(tempPath, target);
    } else {
      await rm(target, { force: true });
    }
  }
  const removable = state.directories
    .filter(directory => !directory.existed)
    .sort((left, right) => right.path.split('/').length - left.path.split('/').length);
  for (const directory of removable) {
    await rmdir(resolveCliWorkspacePath(state.workspaceRoot, directory.path)).catch(error => {
      if (!isMissing(error) && errorCode(error) !== 'ENOTEMPTY') throw error;
    });
  }
}

function assertPlanPathsMatchProposal(plan: CodingWorkspaceMutationPlan<CliWorkspaceMutationPayload>): void {
  const proposalPaths = collectCliWorkspaceMutationPaths(plan.payload.proposal);
  if (JSON.stringify([...plan.paths].sort()) !== JSON.stringify([...proposalPaths].sort())) {
    throw new Error('CLI mutation plan paths do not match artifact proposal');
  }
}

function assertPatchLine(actual: string | undefined, expected: string, filePath: string): void {
  if (actual !== expected) {
    throw new Error(
      `Patch context mismatch in ${filePath}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function mutationPreparationErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('Patch context mismatch')) return 'workspace-patch-context-mismatch';
  if (message.startsWith('Patch target does not exist')) return 'workspace-patch-target-missing';
  return 'workspace-mutation-invalid';
}

function contentRef(prefix: string, value: unknown): string {
  return `${prefix}:sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function canonicalEntries(entries: readonly CliWorkspaceSnapshotEntry[]): string {
  return JSON.stringify([...entries].sort((left, right) => left.path.localeCompare(right.path)));
}

function normalizeRelativePath(path: string): string {
  return toPosixPath(path.trim()).replace(/^\.\//, '');
}

function safeActionId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'mutation';
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}
