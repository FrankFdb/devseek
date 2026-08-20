import * as nodePath from 'path';

export type AgentTaskAction =
  | 'modify'
  | 'analyze'
  | 'create'
  | 'delete'
  | 'explain'
  | 'explore'
  | 'respond';

/** Durable task shape used by checkpoints, UI projection, and recovery. */
export interface AgentTask {
  readonly id: string;
  readonly file: string;
  readonly action: AgentTaskAction;
  readonly desc: string;
  readonly targetKind?: 'workspace-file' | 'provider-response' | 'agent-session';
  readonly visibleTarget?: string;
  readonly absPath?: string;
  readonly expectedContent?: string;
}

export function getAgentTaskDisplayTarget(
  task: Pick<AgentTask, 'file' | 'visibleTarget'>,
): string {
  return task.visibleTarget || (task.file ? nodePath.basename(task.file) : 'Agent 任务');
}
