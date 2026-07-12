import * as crypto from 'crypto';
import type { ChatOptions as BridgeChatOptions } from '../bridge-client';
import type { AgentApplicationServiceDeps } from './agent-application-service';
import { AgentApplicationService } from './agent-application-service';
import type { AgentChatRequest } from './agent-protocol';
import { invokeProviderWithRunEvidence } from './provider-run-evidence';
import { createDevSeekRunContext, type DevSeekRunContext } from './run-context';

export interface EvidenceAwareChatRouterDependencies extends AgentApplicationServiceDeps {
  getWorkspaceRoot: () => string;
  getSessionId: () => string;
  getTraceLevel: () => string;
  warn?: (message: string) => void;
}

export function createAgentApplicationBridgeAdapter(
  transport: (options: BridgeChatOptions) => Promise<string>,
): AgentApplicationServiceDeps['bridgeChat'] {
  return request => transport({
    prompt: request.prompt,
    newSession: request.newSession,
    timeoutMs: request.timeoutMs,
    stream: request.stream,
    mode: request.mode,
    onDelta: request.onDelta,
    files: request.files,
    traceRunId: request.traceRunId,
    traceWorkspaceRoot: request.traceWorkspaceRoot,
    traceOperationId: request.traceOperationId,
    traceEvidenceParticipantToken: request.evidenceCapability?.token,
  });
}

/** Owns provider evidence envelopes and standalone provider-run settlement. */
export class EvidenceAwareChatRouter {
  private readonly application: AgentApplicationService;

  constructor(private readonly deps: EvidenceAwareChatRouterDependencies) {
    this.application = new AgentApplicationService(deps);
  }

  async route(requestInput: AgentChatRequest): Promise<string> {
    const traceParts = [
      requestInput.traceRunId?.trim(),
      requestInput.traceWorkspaceRoot?.trim(),
      requestInput.traceEvidenceParticipantToken?.trim(),
    ];
    const hasTrace = traceParts.some(Boolean);
    const hasCompleteTrace = traceParts.every(Boolean);
    let ownedContext: DevSeekRunContext | undefined;
    if (!hasTrace) {
      ownedContext = createDevSeekRunContext({
        workspaceRoot: this.deps.getWorkspaceRoot(),
        source: 'vscode-extension.standalone-provider',
        userPrompt: requestInput.prompt,
        sessionId: this.deps.getSessionId(),
        mode: requestInput.mode,
        traceLevel: this.deps.getTraceLevel(),
      });
    } else if (!hasCompleteTrace) {
      requestInput.onTraceEvidenceError?.(new Error('Partial run evidence trace context is not allowed'));
    }
    const request: AgentChatRequest = {
      ...requestInput,
      traceRunId: requestInput.traceRunId ?? ownedContext?.runId,
      traceWorkspaceRoot: requestInput.traceWorkspaceRoot ?? ownedContext?.workspaceRoot,
      traceEvidenceParticipantToken: requestInput.traceEvidenceParticipantToken ?? ownedContext?.evidenceParticipantToken,
      onTraceEvidenceError: requestInput.onTraceEvidenceError ?? (error => ownedContext?.markEvidenceDegraded(error)),
      traceOperationId: requestInput.traceOperationId ?? crypto.randomUUID(),
    };
    try {
      const response = await invokeProviderWithRunEvidence({
        request,
        providerType: this.deps.getProviderType(),
        invoke: () => this.application.routeChat(request),
        onEvidenceError: (error) => {
          request.onTraceEvidenceError?.(error);
          const message = error instanceof Error ? error.message : String(error);
          (this.deps.warn ?? console.warn)(`[DevSeek] product run evidence provider event failed: ${message}`);
        },
      });
      if (ownedContext && ownedContext.complete('completed', { reason: 'standalone-provider-completed' }) !== 'completed') {
        throw new Error('standalone-provider-settlement-failed: provider response cannot be returned as a completed run');
      }
      return response;
    } catch (error) {
      ownedContext?.complete('failed', { reason: 'standalone-provider-failed' });
      throw error;
    }
  }
}
