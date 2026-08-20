import type { AgentStatusEvent, AgentToolActivityEvent } from '../agent/events';
import type { ChatMessage } from '../llm/types';
import type { TaskHistoryLifecycleReceipt, TaskRunRecord, TaskRunTimelineItem } from '../app/task-history-store';
export type { AgentEditedFileEvent, AgentEvent, AgentStatusEvent, AgentToolActivityEvent } from '../agent/events';

export type ChatProviderMode = 'fast' | 'r1';

export interface PlanReviewRequest {
  id: string;
  title: string;
  body: string;
  details: string[];
  options: unknown[];
}

export const WEBVIEW_TASK_HISTORY_COMMANDS = [
  'listTasks',
  'openTask',
  'continueTask',
  'archiveTask',
  'deleteTask',
  'exportTask',
] as const;

export type WebviewTaskHistoryCommand = typeof WEBVIEW_TASK_HISTORY_COMMANDS[number];

export interface SessionLoadedMessage {
  type: 'sessionLoaded';
  id: string;
  history: ChatMessage[];
  summary: string;
  changedFiles: string[];
  messageCount: number;
  createdAt: number;
}

export interface AgentCheckpointAvailableMessage {
  type: 'agentCheckpointAvailable';
  resumeTaskIndex: number;
  totalTasks: number;
  userPrompt: string;
  savedAt: number;
  recoveryKind?: string;
  pauseReason?: string;
}

export type TaskHistoryOutboundMessage =
  | { type: 'taskHistoryList'; tasks: TaskRunRecord[] }
  | { type: 'taskHistoryDetail'; task?: TaskRunRecord; id?: string; timeline?: TaskRunTimelineItem[] }
  | { type: 'taskHistoryContinueRequested'; task?: TaskRunRecord; id: string; checkpointRef?: string; resumeStatus?: 'resumable' | 'blocked'; blockedReason?: string; lifecycleReceipt?: TaskHistoryLifecycleReceipt }
  | { type: 'taskHistoryArchived'; task?: TaskRunRecord; id: string; lifecycleReceipt?: TaskHistoryLifecycleReceipt }
  | { type: 'taskHistoryDeleted'; id: string; lifecycleReceipt?: TaskHistoryLifecycleReceipt }
  | { type: 'taskHistoryExported'; id: string; data?: string; lifecycleReceipt?: TaskHistoryLifecycleReceipt };

export type WebviewInboundType =
  | 'chat' | 'cancel' | 'clearHistory' | 'ready' | 'insertCode' | 'relogin'
  | 'runCommand' | 'getProblems' | 'resolveFile' | 'getStatus' | 'setMode'
  | 'openGeneratedPath'
  | 'keepPendingEdit' | 'undoPendingEdit' | 'openPendingEdit'
  | 'keepPendingHunk' | 'undoPendingHunk'
  | 'keepAllPendingEdits' | 'undoAllPendingEdits'
  | 'setAutopilot' | 'clearContext' | 'agentToggle'
  | 'terminalConfirmReply' | 'runInVsTerminal' | 'agentSteer'
  | 'listSessions' | 'loadSession' | 'deleteSession' | 'saveSession'
  | WebviewTaskHistoryCommand
  | 'resumeAgentCheckpoint' | 'dismissAgentCheckpoint';

export interface WebviewInboundMessage {
  type: WebviewInboundType;
  text?: string;
  code?: string;
  newSession?: boolean;
  command?: string;
  path?: string;
  editId?: string;
  hunkId?: string;
  hunkLine?: number;
  line?: number;
  prompt?: string;
  mode?: ChatProviderMode;
  files?: string[];
  images?: string[];
  autopilot?: boolean;
  enabled?: boolean;
  forceNoAgent?: boolean;
  intentConfirmed?: boolean;
  suppressUserMessage?: boolean;
  confirmId?: string;
  allow?: boolean;
  alwaysAllow?: boolean;
  exitCode?: number | null;
  activityKind?: string;
  activityLabel?: string;
  activityTotal?: number;
  id?: string;
  submissionId?: string;
  expectedRunId?: string;
}

export type AgentPresentationMode = 'progress' | 'direct-response' | 'model-led';

export type WebviewOutboundMessage =
  | {
      type: 'startResponse';
      prompt?: string;
      expectGeneratedArtifacts?: boolean;
      agentMode?: boolean;
      agentPresentation?: AgentPresentationMode;
    }
  | { type: 'delta'; text: string }
  | { type: 'resetResponse'; text: string }
  | { type: 'endResponse' }
  | { type: 'error'; text: string; loginRequired?: boolean }
  | AgentStatusEvent
  | AgentToolActivityEvent
  | { type: 'agentAnnouncement'; text: string }
  | { type: 'agentNotice'; kind: 'info' | 'warn' | 'error'; text: string }
  | { type: 'todoUpdate'; items: unknown[] }
  | { type: 'contextFiles'; files: string[] }
  | { type: 'terminalConfirm'; command: string; workdir: string; confirmId: string }
  | { type: 'planReview'; request: PlanReviewRequest }
  | { type: 'intentConfirmation'; request: unknown }
  | SessionLoadedMessage
  | AgentCheckpointAvailableMessage
  | TaskHistoryOutboundMessage
  | { type: string; [key: string]: unknown };
