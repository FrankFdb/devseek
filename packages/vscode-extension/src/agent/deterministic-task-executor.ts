import * as nodePath from 'path';
import type * as vscode from 'vscode';
import type { AgentTask } from '../agent-task-decomposer';
import { readFileContentFull } from '../agent-task-decomposer';
import type { AgentLoopCallbacks } from './loop-types';
import { roughLineDiff } from '../utils';
import { WorkspaceEditService } from '../workspace/edit-service';

export interface DeterministicTaskResult {
  applied: boolean;
  path?: string;
  raw?: string;
  linesAdded?: number;
  linesRemoved?: number;
}

const workspaceEditService = new WorkspaceEditService();

export async function tryExecuteDeterministicCreateTask(input: {
  task: AgentTask;
  taskIndex: number;
  taskTotal: number;
  workspaceRoot: vscode.Uri;
  effectiveAbsPath?: string;
  callbacks: AgentLoopCallbacks;
}): Promise<DeterministicTaskResult | undefined> {
  const { task, callbacks } = input;
  if (task.action !== 'create' || task.expectedContent === undefined) return undefined;

  const basename = nodePath.basename(task.file);
  const absPath = input.effectiveAbsPath || task.absPath;
  if (!absPath) {
    await postDeterministicStatus(input, 'failed', basename, '缺少可写入的目标路径。');
    return { applied: false, raw: 'deterministic create skipped: missing target path' };
  }

  if (callbacks.onBeforeFileWrite && !(await callbacks.onBeforeFileWrite(absPath, {
    purpose: 'deterministic-task',
    userRequested: true,
    taskAction: task.action,
    displayName: task.file,
  }))) {
    await postDeterministicStatus(input, 'failed', basename, '写入被权限或保护规则阻止。');
    return { applied: false, raw: 'deterministic create blocked by write guard' };
  }

  try {
    callbacks.onToolActivity?.('write', task.file);
    const writeResult = workspaceEditService.writeTextFileSync(absPath, task.expectedContent, { validateSourceSanity: true });
    const freshContent = readFileContentFull(absPath);
    const diff = roughLineDiff(writeResult.oldContent, task.expectedContent);
    const relPath = displayPath(input.workspaceRoot, absPath, task.file);

    if (freshContent !== task.expectedContent) {
      await postDeterministicStatus(input, 'failed', basename, '写入后读回内容不一致。', diff);
      return {
        applied: false,
        path: absPath,
        raw: `deterministic create verification failed: ${relPath}`,
        linesAdded: diff.added,
        linesRemoved: diff.removed,
      };
    }

    await callbacks.onAppliedChange({ path: relPath, ...writeResult });
    await postDeterministicStatus(input, 'completed', basename, `${relPath} · 已写入并读回验证`, diff);
    return {
      applied: true,
      path: absPath,
      raw: `deterministic create verified: ${relPath}`,
      linesAdded: diff.added,
      linesRemoved: diff.removed,
    };
  } catch (error) {
    await postDeterministicStatus(input, 'failed', basename, (error as Error).message);
    return { applied: false, path: absPath, raw: (error as Error).message };
  }
}

async function postDeterministicStatus(
  input: {
    task: AgentTask;
    taskIndex: number;
    taskTotal: number;
    callbacks: AgentLoopCallbacks;
  },
  state: 'completed' | 'failed',
  basename: string,
  detail: string,
  diff?: { added: number; removed: number },
): Promise<void> {
  await input.callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    taskId: input.task.id,
    taskFile: basename,
    taskAction: input.task.action,
    taskDesc: input.task.desc,
    taskIndex: input.taskIndex,
    taskTotal: input.taskTotal,
    state,
    title: input.task.desc || basename,
    detail,
    ...(diff ? { linesAdded: diff.added, linesRemoved: diff.removed } : {}),
  });
}

function displayPath(workspaceRoot: vscode.Uri, absPath: string, fallback: string): string {
  const rel = nodePath.relative(workspaceRoot.fsPath, absPath).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) return fallback;
  return rel;
}
