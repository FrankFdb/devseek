import type { ApplyWorkflowStatus } from '../workspace-applier';
import type { AgentEvent } from '../agent/events';
import type {
  AgentCheckpointAvailableMessage,
  SessionLoadedMessage,
  TaskHistoryOutboundMessage,
  WebviewOutboundMessage,
} from './webview-protocol';
import { getWebviewOutboundSanitizer } from './webview-message-sanitizer';

export interface WebviewPostTarget {
  postMessage(message: WebviewOutboundMessage): unknown;
}

export type WebviewDomainEvent =
  | { kind: 'workflow'; status: ApplyWorkflowStatus }
  | { kind: 'agent'; event: AgentEvent }
  | { kind: 'sessionLoaded'; message: SessionLoadedMessage }
  | { kind: 'taskHistory'; message: TaskHistoryOutboundMessage }
  | { kind: 'checkpointAvailable'; message: AgentCheckpointAvailableMessage };

export class WebviewEventAdapter {
  constructor(private readonly target: WebviewPostTarget) {}

  post(message: WebviewOutboundMessage): void {
    const sanitized = getWebviewOutboundSanitizer(this.target).sanitize(message);
    if (sanitized) void this.target.postMessage(sanitized);
  }

  postEvent(event: WebviewDomainEvent): void {
    this.post(toWebviewMessage(event));
  }
}

export function postWebviewMessage(target: WebviewPostTarget, message: WebviewOutboundMessage): void {
  new WebviewEventAdapter(target).post(message);
}

export function postWebviewEvent(target: WebviewPostTarget, event: WebviewDomainEvent): void {
  new WebviewEventAdapter(target).postEvent(event);
}

export function toWebviewMessage(event: WebviewDomainEvent): WebviewOutboundMessage {
  switch (event.kind) {
    case 'workflow':
      return { type: 'workflowStatus', ...event.status };
    case 'agent':
      return event.event;
    case 'sessionLoaded':
    case 'taskHistory':
    case 'checkpointAvailable':
      return event.message;
  }
}
