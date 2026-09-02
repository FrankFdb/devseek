import * as fs from 'fs';
import * as nodePath from 'path';
import {
  codingSemanticDigest,
  type CodingToolCall,
  type CodingToolExecutionReceipt,
  type CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';

export interface CompletedActionReplayScreen {
  readonly blockedToolIndexes: ReadonlySet<number>;
  readonly warnings: readonly string[];
}

export interface CompletedActionReplayInput {
  readonly tools: readonly CodingToolCall[];
  readonly alreadyBlockedToolIndexes?: ReadonlySet<number>;
  readonly toolExecutionReceipts: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
}

interface WorkspaceStateSnapshot {
  readonly absPath: string;
  readonly existed: boolean;
  readonly content?: string;
  readonly canonicalPath?: string;
  readonly device?: string;
  readonly inode?: string;
}

/** Blocks only exact completed side effects whose committed state is still independently observable. */
export class AgenticCompletedActionReplayGuard {
  constructor(private readonly workspaceRoot: string) {}

  screen(input: CompletedActionReplayInput): CompletedActionReplayScreen {
    const blockedToolIndexes = new Set<number>();
    const warnings: string[] = [];
    input.tools.forEach((tool, toolIndex) => {
      if (input.alreadyBlockedToolIndexes?.has(toolIndex)) return;
      const completed = findCompletedReplay(tool, input.toolExecutionReceipts);
      if (!completed) return;
      if (completed.purpose === 'workspace-mutation') {
        const mutation = findCommittedMutation(completed, input.changeReceipts);
        if (!mutation
          || !isLatestMutationForPaths(mutation, input.changeReceipts, this.workspaceRoot)
          || !committedWorkspaceStateIsCurrent(mutation, this.workspaceRoot)) {
          return;
        }
      } else if (completed.purpose !== 'external-effect') {
        return;
      }
      blockedToolIndexes.add(toolIndex);
      warnings.push([
        `【系统反馈】已跳过重复的已完成动作：${tool.name}。`,
        `本次提议与 ${completed.actionId} 的规范化输入和副作用完全相同，且已有${completed.purpose === 'workspace-mutation' ? '当前状态匹配的 committed mutation' : '完成'}回执。`,
        '不要重新执行该动作；请依据 Provider Recovery Progress 继续未完成义务。',
      ].join('\n'));
    });
    return Object.freeze({ blockedToolIndexes, warnings: Object.freeze(warnings) });
  }
}

function findCompletedReplay(
  tool: CodingToolCall,
  receipts: readonly CodingToolExecutionReceipt<unknown>[],
): CodingToolExecutionReceipt<unknown> | undefined {
  const inputSha256 = safeSemanticDigest(tool.input);
  if (!inputSha256) return undefined;
  const effects = canonicalEffects(tool.effects);
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index];
    if (receipt.tool === tool.name
      && receipt.purpose === tool.purpose
      && receipt.inputSha256 === inputSha256
      && canonicalEffects(receipt.effects) === effects) {
      return receipt.status === 'completed' ? receipt : undefined;
    }
  }
  return undefined;
}

function findCommittedMutation(
  action: CodingToolExecutionReceipt<unknown>,
  receipts: readonly CodingWorkspaceMutationReceipt<unknown>[],
): CodingWorkspaceMutationReceipt<unknown> | undefined {
  return receipts.find(receipt => receipt.actionId === action.actionId && receipt.status === 'committed');
}

function isLatestMutationForPaths(
  candidate: CodingWorkspaceMutationReceipt<unknown>,
  receipts: readonly CodingWorkspaceMutationReceipt<unknown>[],
  workspaceRoot: string,
): boolean {
  const candidatePaths = candidate.paths.map(path => canonicalWorkspacePath(path, workspaceRoot));
  return !receipts.some(receipt => (
    receipt.status === 'committed'
    && receipt.sequence > candidate.sequence
    && receipt.paths.some(path => {
      const laterPath = canonicalWorkspacePath(path, workspaceRoot);
      return candidatePaths.some(candidatePath => pathsOverlap(candidatePath, laterPath));
    })
  ));
}

function committedWorkspaceStateIsCurrent(
  receipt: CodingWorkspaceMutationReceipt<unknown>,
  workspaceRoot: string,
): boolean {
  const snapshot = extractCommittedWorkspaceState(receipt.result);
  if (!snapshot || !isWithinWorkspace(snapshot.absPath, workspaceRoot)) return false;
  try {
    if (!snapshot.existed) return !fs.existsSync(snapshot.absPath);
    if (!fs.existsSync(snapshot.absPath)) return false;
    if (fs.lstatSync(snapshot.absPath).isSymbolicLink()) return false;
    if (snapshot.content !== undefined) {
      const stat = fs.statSync(snapshot.absPath, { bigint: true });
      return stat.isFile()
        && (!snapshot.device || stat.dev.toString() === snapshot.device)
        && (!snapshot.inode || stat.ino.toString() === snapshot.inode)
        && fs.readFileSync(snapshot.absPath, 'utf8') === snapshot.content;
    }
    if (!snapshot.canonicalPath || !snapshot.device || !snapshot.inode) return false;
    const stat = fs.statSync(snapshot.absPath, { bigint: true });
    return stat.isDirectory()
      && fs.realpathSync(snapshot.absPath) === snapshot.canonicalPath
      && stat.dev.toString() === snapshot.device
      && stat.ino.toString() === snapshot.inode;
  } catch {
    return false;
  }
}

function extractCommittedWorkspaceState(value: unknown): WorkspaceStateSnapshot | undefined {
  const result = asRecord(value);
  const commitToken = asRecord(result?.commitToken);
  const after = asRecord(commitToken?.after);
  const snapshot = asRecord(after?.snapshot);
  if (!snapshot || typeof snapshot.absPath !== 'string' || typeof snapshot.existed !== 'boolean') return undefined;
  return {
    absPath: nodePath.resolve(snapshot.absPath),
    existed: snapshot.existed,
    ...(typeof snapshot.content === 'string' ? { content: snapshot.content } : {}),
    ...(typeof snapshot.canonicalPath === 'string' ? { canonicalPath: snapshot.canonicalPath } : {}),
    ...(typeof snapshot.device === 'string'
      ? { device: snapshot.device }
      : typeof after?.leafDevice === 'string' ? { device: after.leafDevice } : {}),
    ...(typeof snapshot.inode === 'string'
      ? { inode: snapshot.inode }
      : typeof after?.leafInode === 'string' ? { inode: after.leafInode } : {}),
  };
}

function safeSemanticDigest(value: unknown): string | undefined {
  try {
    return codingSemanticDigest(value);
  } catch {
    return undefined;
  }
}

function canonicalEffects(effects: readonly string[]): string {
  return [...effects].sort().join('\u0000');
}

function canonicalWorkspacePath(value: string, workspaceRoot: string): string {
  return nodePath.resolve(workspaceRoot, String(value ?? '').trim());
}

function pathsOverlap(left: string, right: string): boolean {
  const relative = nodePath.relative(left, right);
  const reverseRelative = nodePath.relative(right, left);
  return relative === ''
    || (!relative.startsWith('..') && !nodePath.isAbsolute(relative))
    || (!reverseRelative.startsWith('..') && !nodePath.isAbsolute(reverseRelative));
}

function isWithinWorkspace(absPath: string, workspaceRoot: string): boolean {
  const root = nodePath.resolve(workspaceRoot);
  const relative = nodePath.relative(root, nodePath.resolve(absPath));
  return relative === '' || (!relative.startsWith('..') && !nodePath.isAbsolute(relative));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
