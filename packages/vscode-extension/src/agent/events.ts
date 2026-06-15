import type { AgentTaskAction } from '../agent-task-decomposer';

export interface AgentEditedFileEvent {
  path: string;
  basename: string;
  linesAdded?: number;
  linesRemoved?: number;
  action: string;
}

export interface AgentStatusEvent {
  type: 'agentStatus';
  phase: 'plan' | 'execute' | 'validate' | 'done' | 'error' | 'analyzeFile' | 'analyzeSummary';
  taskId?: string;
  taskFile?: string;
  taskAction?: AgentTaskAction;
  taskDesc?: string;
  taskIndex?: number;
  taskTotal?: number;
  state: 'started' | 'completed' | 'failed' | 'skipped';
  title: string;
  detail?: string;
  linesAdded?: number;
  linesRemoved?: number;
  planningText?: string;
  planningDetail?: string;
  editedFiles?: AgentEditedFileEvent[];
}

export type AgentEvent =
  | AgentStatusEvent
  | { type: 'agentDelta'; text: string }
  | { type: 'agentToolActivity'; activityKind: string; activityLabel: string; activityTotal?: number }
  | { type: 'agentAnnouncement'; text: string }
  | { type: 'agentNotice'; kind: 'info' | 'warn' | 'error'; text: string }
  | { type: 'todoUpdate'; items: unknown[] };
