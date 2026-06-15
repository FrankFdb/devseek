import type { ApplyWorkflowStatus } from '../workspace-applier';
import type { AgentStatusEvent } from '../agent/events';
export type { AgentEditedFileEvent, AgentEvent, AgentStatusEvent } from '../agent/events';

export type ChatProviderMode = 'fast' | 'r1';

export type WebviewInboundType =
  | 'chat' | 'cancel' | 'clearHistory' | 'ready' | 'insertCode' | 'relogin'
  | 'runCommand' | 'getProblems' | 'resolveFile' | 'getStatus' | 'setMode'
  | 'previewGeneratedFiles' | 'applyGeneratedFiles' | 'openGeneratedPath'
  | 'previewGeneratedPath' | 'applyGeneratedPath'
  | 'keepPendingEdit' | 'undoPendingEdit' | 'openPendingEdit'
  | 'keepPendingHunk' | 'undoPendingHunk'
  | 'keepAllPendingEdits' | 'undoAllPendingEdits'
  | 'setAutopilot' | 'clearContext' | 'agentToggle'
  | 'terminalConfirmReply' | 'runInVsTerminal' | 'agentSteer'
  | 'listSessions' | 'loadSession' | 'deleteSession' | 'saveSession'
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
  autoApply?: boolean;
  autopilot?: boolean;
  enabled?: boolean;
  forceNoAgent?: boolean;
  confirmId?: string;
  allow?: boolean;
  alwaysAllow?: boolean;
  exitCode?: number | null;
  activityKind?: string;
  activityLabel?: string;
  activityTotal?: number;
  id?: string;
}

export type WebviewOutboundMessage =
  | { type: 'startResponse'; prompt?: string; expectGeneratedArtifacts?: boolean; agentMode?: boolean }
  | { type: 'delta'; text: string }
  | { type: 'resetResponse'; text: string }
  | { type: 'endResponse' }
  | { type: 'error'; text: string }
  | { type: 'workflowStatus' } & ApplyWorkflowStatus
  | AgentStatusEvent
  | { type: 'agentToolActivity'; activityKind: string; activityLabel: string; activityTotal?: number }
  | { type: 'agentAnnouncement'; text: string }
  | { type: 'agentNotice'; kind: 'info' | 'warn' | 'error'; text: string }
  | { type: 'todoUpdate'; items: unknown[] }
  | { type: 'contextFiles'; files: string[] }
  | { type: 'terminalConfirm'; command: string; workdir: string; confirmId: string }
  | { type: string; [key: string]: unknown };
