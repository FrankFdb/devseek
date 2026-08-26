import type { AgentTaskAction } from './agent-task';

export interface AgentEditedFileEvent {
  path: string;
  basename: string;
  linesAdded?: number;
  linesRemoved?: number;
  action: string;
}

export type AgentProgressStage =
  | 'planning'
  | 'context'
  | 'implementation'
  | 'validation'
  | 'recovery'
  | 'delivery';

export type AgentRecoveryReason =
  | 'provider-short-intent'
  | 'provider-response-corruption';

export interface AgentProgressPresentation {
  progressStage?: AgentProgressStage;
  progressTitle?: string;
  progressDetail?: string;
  progressState?: 'started' | 'completed' | 'failed' | 'skipped';
}

export interface AgentStatusEvent extends AgentProgressPresentation {
  type: 'agentStatus';
  phase: 'plan' | 'execute' | 'validate' | 'quality' | 'repair' | 'done' | 'error' | 'analyzeFile' | 'analyzeSummary';
  /**
   * Stable evidence operation shared by verification and its subsequently
   * evaluated quality gate. Product workflow adapters must never infer this
   * correlation from display text or arrival order.
   */
  evidenceOperationId?: string;
  /** Workspace-relative files covered by this verification operation. */
  verificationScopePaths?: readonly string[];
  /** Stable machine-readable reason for a host-owned recovery transition. */
  recoveryReason?: AgentRecoveryReason;
  /** Exact failed provider operations owned by this provider-only recovery. */
  recoveryTargetOperationIds?: readonly string[];
  /** Accepted provider operation that proves this provider-only recovery. */
  recoveryResultOperationId?: string;
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

export interface AgentToolActivityEvent extends AgentProgressPresentation {
  type: 'agentToolActivity';
  activityKind: string;
  activityLabel: string;
  activityTotal?: number;
}

export type AgentEvent =
  | AgentStatusEvent
  | { type: 'agentDelta'; text: string }
  | AgentToolActivityEvent
  | { type: 'agentAnnouncement'; text: string }
  | { type: 'agentNotice'; kind: 'info' | 'warn' | 'error'; text: string }
  | { type: 'todoUpdate'; items: unknown[] };
