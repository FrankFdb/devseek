import type { ChatMessage, TokenUsage } from './llm-types';

export type AgentSurfaceKind = 'vscode' | 'cli' | 'jsonl' | 'desktop' | 'test';

export interface SurfaceCapabilities {
  supportsHunkReview: boolean;
  supportsInlineSelection: boolean;
  supportsTerminalEmbedding: boolean;
  supportsBrowserPreview: boolean;
  supportsJsonl: boolean;
  supportsDiagnostics: boolean;
}

export interface PlatformProfile {
  os: 'linux' | 'darwin' | 'win32' | 'unknown';
  shell: 'posix' | 'powershell' | 'cmd' | 'git-bash' | 'unknown';
  pathStyle: 'posix' | 'windows';
  lineEnding: 'lf' | 'crlf' | 'mixed' | 'unknown';
  caseSensitive: boolean;
  workspaceKind: 'local' | 'wsl' | 'remote' | 'container' | 'unknown';
}

export interface AgentCommandBase {
  commandId: string;
  surface: AgentSurfaceKind;
  capabilities?: SurfaceCapabilities;
  platform?: PlatformProfile;
  createdAt?: number;
}

export interface AgentChatRequest {
  prompt: string;
  newSession?: boolean;
  mode?: 'fast' | 'r1';
  files?: string[];
  stream?: boolean;
  onDelta?: (delta: string) => void;
  timeoutMs?: number;
  trackHistory?: boolean;
  displayPrompt?: string;
  onUsage?: (usage: TokenUsage) => void;
  signal?: AbortSignal;
  images?: string[];
}

export interface ChatRequestCommand extends AgentCommandBase {
  type: 'chat.request';
  request: AgentChatRequest;
}

export interface PlanReviewDecisionCommand extends AgentCommandBase {
  type: 'plan.reviewDecision';
  taskId: string;
  decision: 'approve' | 'revise' | 'cancel';
  comment?: string;
}

export interface PermissionDecisionCommand extends AgentCommandBase {
  type: 'permission.decision';
  requestId: string;
  decision: 'allow' | 'deny';
}

export interface TaskResumeCommand extends AgentCommandBase {
  type: 'task.resume';
  checkpointId?: string;
}

export interface TaskCancelCommand extends AgentCommandBase {
  type: 'task.cancel';
  taskId?: string;
}

export type AgentCommand =
  | ChatRequestCommand
  | PlanReviewDecisionCommand
  | PermissionDecisionCommand
  | TaskResumeCommand
  | TaskCancelCommand;

export interface AgentEventBase {
  eventId: string;
  commandId?: string;
  taskId?: string;
  surface?: AgentSurfaceKind;
  timestamp: number;
  severity?: 'info' | 'warning' | 'error';
}

export interface ChatStartedEvent extends AgentEventBase {
  type: 'chat.started';
  prompt: string;
}

export interface ChatDeltaEvent extends AgentEventBase {
  type: 'chat.delta';
  delta: string;
}

export interface ChatCompletedEvent extends AgentEventBase {
  type: 'chat.completed';
  response: string;
}

export interface ProviderSelectedEvent extends AgentEventBase {
  type: 'provider.selected';
  providerType: string;
}

export interface ProviderStatusEvent extends AgentEventBase {
  type: 'provider.status';
  providerType: string;
  status: 'waiting' | 'streaming' | 'completed';
  message?: string;
}

export interface ProviderRecoveryEvent extends AgentEventBase {
  type: 'provider.recovery';
  reason: string;
  recovered: boolean;
}

export interface PermissionRequestEvent extends AgentEventBase {
  type: 'permission.requested';
  requestId: string;
  action: string;
  target?: string;
}

export interface FileChangesEvent extends AgentEventBase {
  type: 'fileChanges.proposed';
  files: readonly string[];
}

export interface ValidationEvent extends AgentEventBase {
  type: 'validation.completed';
  passed: boolean;
  evidenceRefs: readonly string[];
}

export interface QualityGateEvent extends AgentEventBase {
  type: 'qualityGate.completed';
  passed: boolean;
  evidenceRefs: readonly string[];
}

export interface TaskHistoryEvent extends AgentEventBase {
  type: 'taskHistory.updated';
  taskId: string;
}

export interface CheckpointEvent extends AgentEventBase {
  type: 'checkpoint.available';
  checkpointId: string;
}

export interface AgentErrorEvent extends AgentEventBase {
  type: 'error';
  errorType: string;
  message: string;
}

export type AgentEvent =
  | ChatStartedEvent
  | ChatDeltaEvent
  | ChatCompletedEvent
  | ProviderSelectedEvent
  | ProviderStatusEvent
  | ProviderRecoveryEvent
  | PermissionRequestEvent
  | FileChangesEvent
  | ValidationEvent
  | QualityGateEvent
  | TaskHistoryEvent
  | CheckpointEvent
  | AgentErrorEvent;

export function buildTextUserMessage(prompt: string, images?: readonly string[]): ChatMessage {
  if (!images || images.length === 0) {
    return { role: 'user', content: prompt };
  }
  return {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      ...images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
    ],
  };
}
