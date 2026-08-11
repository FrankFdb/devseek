import * as vscode from 'vscode';
import {
  createChatRequestCommand,
  certifySurfaceAdapter,
  CanonicalSurfaceAccessibilityService,
  CanonicalUserCollaborationService,
  CODING_CANCELLATION_RECEIPT_VERSION,
  CODING_STEERING_RECEIPT_VERSION,
  detectPlatformProfile,
  VSCODE_SURFACE_CAPABILITIES,
  type AgentEvent,
  type PlatformProfile,
  type SurfaceAdapter,
  type SurfaceAdapterConformanceReceipt,
  type SurfaceChatInput,
  type SurfaceCapabilities,
  type CodingSurfaceAccessibilityDecision,
  type CodingUserCollaborationDecision,
} from '@devseek-netai/shared';
import { postWebviewMessage } from './webview-event-adapter';
import type { WebviewOutboundMessage } from './webview-protocol';

export class VSCodeSurfaceAdapter implements SurfaceAdapter {
  readonly kind = 'vscode' as const;
  readonly capabilities: SurfaceCapabilities = VSCODE_SURFACE_CAPABILITIES;
  readonly platform: PlatformProfile;

  constructor(private readonly getWebview: () => vscode.Webview | undefined = () => undefined) {
    this.platform = detectPlatformProfile({
      platform: process.platform,
      env: process.env,
      shellPath: process.env.SHELL ?? process.env.ComSpec,
      workspaceKind: vscode.env.remoteName
        ? vscode.env.remoteName.includes('wsl') ? 'wsl' : 'remote'
        : 'local',
    });
  }

  toChatCommand(input: SurfaceChatInput) {
    return createChatRequestCommand({
      surface: this.kind,
      capabilities: this.capabilities,
      platform: this.platform,
      prompt: input.prompt,
      commandId: input.commandId,
      request: input.request,
    });
  }

  conformance(): SurfaceAdapterConformanceReceipt {
    return certifySurfaceAdapter({
      adapterId: 'vscode-webview',
      kind: this.kind,
      capabilities: this.capabilities,
      platform: this.platform,
      command: this.toChatCommand({
        prompt: 'surface adapter conformance probe',
        commandId: 'vscode-surface-conformance',
      }),
      eventDelivery: {
        channel: 'webview',
        ordering: 'host-ordered',
        backpressure: 'host-managed',
      },
    });
  }

  collaboration(): CodingUserCollaborationDecision {
    return new CanonicalUserCollaborationService().assess({
      surface: this.kind,
      interactions: [
        'clarification',
        'progress',
        'plan-review',
        'diff-review',
        'permission-decision',
        'steering',
        'cancellation',
        'resume',
        'error-explanation',
      ],
      eventTypes: [
        'chat.started',
        'provider.status',
        'permission.requested',
        'fileChanges.proposed',
        'validation.completed',
        'checkpoint.available',
        'error',
      ],
      traceBound: true,
      cancellationProtocol: CODING_CANCELLATION_RECEIPT_VERSION,
      steeringProtocol: CODING_STEERING_RECEIPT_VERSION,
      evidenceRefs: [
        'vscode-surface:event-projection',
        'vscode-surface:run-control',
        'vscode-surface:plan-diff-permission-review',
      ],
    });
  }

  accessibility(): CodingSurfaceAccessibilityDecision {
    return new CanonicalSurfaceAccessibilityService().assess({
      surface: this.kind,
      channels: ['keyboard', 'screen-reader', 'text-status'],
      statusNotColorOnly: true,
      cancellationReachable: true,
      recoveryReachable: true,
      evidenceRefs: [
        'vscode-webview:aria-live-status',
        'vscode-webview:keyboard-actions',
        'vscode-webview:textual-workflow-state',
      ],
    });
  }

  renderEvent(event: AgentEvent): void {
    const webview = this.getWebview();
    if (!webview) return;
    postWebviewMessage(webview, toVSCodeSurfaceMessage(event));
  }
}

function toVSCodeSurfaceMessage(event: AgentEvent): WebviewOutboundMessage {
  return withSurfaceTrace(toVSCodeSurfaceMessageWithoutTrace(event), event);
}

function toVSCodeSurfaceMessageWithoutTrace(event: AgentEvent): WebviewOutboundMessage {
  switch (event.type) {
    case 'chat.started':
      return { type: 'startResponse', prompt: event.prompt, agentMode: true };
    case 'chat.delta':
      return { type: 'delta', text: event.delta };
    case 'chat.completed':
      return { type: 'endResponse' };
    case 'provider.selected':
      return {
        type: 'agentStatus',
        phase: 'plan',
        state: 'completed',
        title: `Provider selected: ${event.providerType}`,
        progressStage: 'planning',
        progressState: 'completed',
      };
    case 'provider.status':
      return {
        type: 'agentStatus',
        phase: 'execute',
        state: event.status === 'completed' ? 'completed' : 'started',
        title: event.message || `Provider ${event.providerType}: ${event.status}`,
        detail: `provider=${event.providerType}; status=${event.status}`,
        progressStage: event.status === 'waiting' ? 'context' : 'implementation',
        progressState: event.status === 'completed' ? 'completed' : 'started',
      };
    case 'provider.recovery':
      return {
        type: 'agentNotice',
        kind: event.recovered ? 'info' : 'warn',
        text: `Provider recovery ${event.recovered ? 'succeeded' : 'blocked'}: ${event.reason}`,
      };
    case 'permission.requested':
      return {
        type: 'agentNotice',
        kind: 'warn',
        text: `Permission requested: ${event.action}${event.target ? ` (${event.target})` : ''}`,
      };
    case 'fileChanges.proposed':
      return {
        type: 'agentStatus',
        phase: 'execute',
        state: 'started',
        title: '文件变更待审阅',
        detail: event.files.join('\n'),
        progressStage: 'implementation',
        progressState: 'started',
        editedFiles: event.files.map(file => ({
          path: file,
          basename: basenameFromPath(file),
          action: 'proposed',
        })),
      };
    case 'validation.completed':
      return {
        type: 'agentStatus',
        phase: 'validate',
        state: event.passed ? 'completed' : 'failed',
        title: event.passed ? '验证通过' : '验证失败',
        detail: event.evidenceRefs.join('\n'),
        progressStage: 'validation',
        progressState: event.passed ? 'completed' : 'failed',
      };
    case 'qualityGate.completed':
      return {
        type: 'agentStatus',
        phase: 'quality',
        state: event.passed ? 'completed' : 'failed',
        title: event.passed ? 'QualityGate 通过' : 'QualityGate 阻塞',
        detail: event.evidenceRefs.join('\n'),
        progressStage: 'validation',
        progressState: event.passed ? 'completed' : 'failed',
      };
    case 'taskHistory.updated':
      return {
        type: 'agentNotice',
        kind: 'info',
        text: `Task history updated: ${event.taskId}`,
      };
    case 'checkpoint.available':
      return {
        type: 'agentCheckpointAvailable',
        resumeTaskIndex: 0,
        totalTasks: 0,
        userPrompt: `checkpoint:${event.checkpointId}`,
        savedAt: event.timestamp,
        recoveryKind: 'surface-event',
        pauseReason: 'checkpoint.available',
      };
    case 'error':
      return { type: 'error', text: event.message };
  }
}

function withSurfaceTrace(message: WebviewOutboundMessage, event: AgentEvent): WebviewOutboundMessage {
  return {
    ...message,
    surfaceTrace: {
      eventId: event.eventId,
      commandId: event.commandId,
      taskId: event.taskId,
      surface: event.surface,
      timestamp: event.timestamp,
      sourceEventType: event.type,
    },
  };
}

function basenameFromPath(filePath: string): string {
  const parts = String(filePath || '').split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : String(filePath || '');
}
